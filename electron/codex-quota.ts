import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {open, readdir, stat} from 'node:fs/promises';
import {delimiter, join} from 'node:path';
import {createInterface} from 'node:readline';
import {currentCodexQuota, parseCodexQuota, unknownCodexQuota} from '../shared/quota.ts';
import type {CodexQuotaSnapshot} from '../shared/quota.ts';

/** Locate the official CLI without reading auth/config or invoking a shell command. */
export async function resolveCodexQuotaExecutable(): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const executable = join(directory.replace(/^"|"$/g, ''), process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (existsSync(executable)) return executable;
  }
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return undefined;
  const directory = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  const candidates = [] as {file: string; modified: number}[];
  for (const entry of await readdir(directory, {withFileTypes: true}).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const file = join(directory, entry.name, 'codex.exe');
    const info = await stat(file).catch(() => undefined);
    if (info?.isFile()) candidates.push({file, modified: info.mtimeMs});
  }
  return candidates.sort((a, b) => b.modified - a.modified)[0]?.file;
}

/** Short-lived, read-only official RPC. Never starts/resumes a thread or turn. */
export async function readCodexAppServerQuota(home: string, timeoutMs = 3000): Promise<CodexQuotaSnapshot | null> {
  // Isolated UI QA must not touch the real signed-in account.
  if (process.env.PET_TEST_MODE === '1' || process.env.PET_QUOTA_LOG_ONLY === '1') return null;
  const executable = await resolveCodexQuotaExecutable();
  if (!executable) return null;
  return new Promise(resolve => {
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: {...process.env, CODEX_HOME: home},
    });
    let settled = false;
    const lines = createInterface({input: child.stdout});
    const finish = (value: CodexQuotaSnapshot | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); lines.close();
      child.stdin.end(); child.kill(); resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const send = (message: unknown) => {
      if (!settled && !child.stdin.destroyed) child.stdin.write(JSON.stringify(message) + '\n');
    };
    child.once('error', () => finish(null));
    child.once('exit', () => finish(null));
    child.stdin.on('error', () => finish(null));
    child.stdout.on('error', () => finish(null));
    lines.on('line', line => {
      // Discard unrelated notifications and raw error text; expose quota fields only.
      if (line.length > 1024 * 1024) {finish(null); return;}
      let value: any; try {value = JSON.parse(line);} catch {return;}
      if (value.id === 1) {
        if (value.error || !value.result) {finish(null); return;}
        send({method: 'initialized', params: {}});
        send({method: 'account/rateLimits/read', id: 2});
      } else if (value.id === 2) {
        finish(value.error ? null : parseCodexQuota(value, 'codex-app-server', new Date().toISOString()));
      }
    });
    send({method: 'initialize', id: 1, params: {clientInfo: {
      name: 'deskfolk_quota', title: 'Deskfolk quota monitor', version: '0.1.0',
    }}});
  });
}

export class CodexQuotaMonitor {
  private home: string;
  private emit: (quota: CodexQuotaSnapshot) => void;
  private value = unknownCodexQuota();
  private published = '';
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private polling?: Promise<void>;
  private refreshing?: Promise<CodexQuotaSnapshot>;
  private signatures = new Map<string, string>();
  private files: string[] = [];
  private cataloguedAt = 0;

  constructor(home: string, emit: (quota: CodexQuotaSnapshot) => void = () => {}) {
    this.home = home; this.emit = emit;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.poll(), 5000);
    this.timer.unref(); void this.poll();
  }
  stop(): void {this.stopped = true; clearInterval(this.timer); this.timer = undefined;}
  snapshot(): CodexQuotaSnapshot {return currentCodexQuota(this.value);}
  private publish(): void {
    if (this.stopped) return;
    const value = this.snapshot(), signature = JSON.stringify(value);
    if (signature === this.published) return;
    this.published = signature; this.emit(value);
  }
  private accept(value: CodexQuotaSnapshot | null): void {
    if (!value || this.stopped) return;
    const old = this.value.observedAt ? Date.parse(this.value.observedAt) : -Infinity;
    if (value.observedAt && Date.parse(value.observedAt) >= old) this.value = value;
  }
  private async catalog(directory: string, depth = 0): Promise<string[]> {
    if (depth > 4) return [];
    const result: string[] = [];
    for (const entry of await readdir(directory, {withFileTypes: true}).catch(() => [])) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) result.push(...await this.catalog(file, depth + 1));
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(file);
    }
    return result;
  }

  /** Poll event_msg/token_count windows; no transcript, token totals or IDs retained. */
  poll(): Promise<void> {
    if (this.polling) return this.polling;
    const pending = this.readLogs().catch(() => {}).finally(() => {
      if (this.polling === pending) this.polling = undefined;
      this.publish();
    });
    this.polling = pending; return pending;
  }

  private async readLogs(): Promise<void> {
    if (Date.now() - this.cataloguedAt > 10000) {
      this.files = await this.catalog(join(this.home, 'sessions')); this.cataloguedAt = Date.now();
    }
    const entries = await Promise.all(this.files.map(async file => {
      const info = await stat(file).catch(() => undefined);
      return info ? {file, size: info.size, modified: info.mtimeMs} : null;
    }));
    // Recent file time only schedules reads. The actual native timestamp decides freshness.
    const latest = entries.filter((entry): entry is NonNullable<typeof entry> => !!entry)
      .sort((a, b) => b.modified - a.modified).slice(0, 48);
    for (const entry of latest) {
      if (this.stopped) return;
      const signature = `${entry.modified}:${entry.size}`;
      if (this.signatures.get(entry.file) === signature) continue;
      const handle = await open(entry.file, 'r').catch(() => undefined);
      if (!handle) continue;
      try {
        const size = Math.min(entry.size, 2 * 1024 * 1024), offset = entry.size - size;
        const buffer = Buffer.alloc(size);
        const {bytesRead} = await handle.read(buffer, 0, size, offset);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        // A partial first/last JSONL line is simply retried once the file grows.
        for (const line of text.split('\n')) {
          if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
          let event: any; try {event = JSON.parse(line);} catch {continue;}
          if (typeof event.timestamp !== 'string') continue;
          this.accept(parseCodexQuota(event, 'codex-log', event.timestamp));
        }
        this.signatures.set(entry.file, signature);
      } finally {await handle.close();}
    }
    const present = new Set(this.files);
    for (const file of this.signatures.keys()) if (!present.has(file)) this.signatures.delete(file);
  }

  /** On user request, refresh real service data within 3 s; fall back to recorded evidence. */
  refresh(): Promise<CodexQuotaSnapshot> {
    if (this.refreshing) return this.refreshing;
    const pending = (async () => {
      await this.poll();
      this.accept(await readCodexAppServerQuota(this.home).catch(() => null));
      this.publish(); return this.snapshot();
    })().finally(() => {if (this.refreshing === pending) this.refreshing = undefined;});
    this.refreshing = pending; return pending;
  }
}

