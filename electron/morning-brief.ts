import {execFile, spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {get} from 'node:http';
import {pickBriefNote, rememberNote, type BriefData, type BriefNote} from '../shared/morning-brief.ts';

/**
 * Local link to the Skills Morning Brief (a separate, user-installed project).
 *
 * Only its whitelisted public snapshots under `data/public/` are read, straight
 * from disk, so the brief's own web service does not need to be running.
 * Opening the brief reuses a running service when its identity checks out,
 * otherwise the brief's own launcher starts one. From the service record only
 * the port is used; its private launch token is never read into a request.
 */
export const BRIEF_TASK = 'Skills Morning Brief - Daily';

type Exec = (file: string, args: string[]) => Promise<Buffer>;
type Options = {
  statePath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exec?: Exec;
  openExternal: (url: string) => Promise<void>;
  launch?: (python: string, cwd: string) => Promise<void>;
  probe?: (port: number) => Promise<unknown>;
  readState?: () => {seen?: string[]};
  writeState?: (state: {seen: string[]}) => void;
  now?: () => number;
};

const defaultExec: Exec = (file, args) => new Promise((resolve, reject) =>
  execFile(file, args, {windowsHide: true, encoding: 'buffer', timeout: 5000}, (error, stdout) => error ? reject(error) : resolve(stdout)));

/** schtasks writes its XML as UTF-16 when redirected; accept either encoding. */
export function taskWorkingDirectory(output: Buffer): string | null {
  const text = output.includes(0) ? output.toString('utf16le') : output.toString('utf8');
  const match = /<WorkingDirectory>([^<]+)<\/WorkingDirectory>/i.exec(text);
  return match ? match[1].trim().replace(/&amp;/g, '&') : null;
}

export const isBriefRoot = (root: string) =>
  existsSync(join(root, 'morningpaper', '__init__.py')) && existsSync(join(root, 'data', 'public'));

/** The brief's per-user data directory, matching its own default_private_root(). */
export function briefDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home = homedir()) {
  if (env.MORNINGPAPER_DATA_DIR) return env.MORNINGPAPER_DATA_DIR;
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData/Local'), 'AgentSkillShelf');
  if (platform === 'darwin') return join(home, 'Library/Application Support/AgentSkillShelf');
  return join(env.XDG_DATA_HOME || join(home, '.local/share'), 'agent-skill-shelf');
}

const readJson = (path: string): any => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const rows = (value: any): any[] => Array.isArray(value?.items) ? value.items : [];
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Public snapshots reduced to the fields the bubble needs. */
export function readBriefData(root: string): BriefData | null {
  const dir = join(root, 'data', 'public');
  const tibo = readJson(join(dir, 'tibo.json')), news = readJson(join(dir, 'news.json')), catalog = readJson(join(dir, 'catalog.json'));
  if (!tibo && !news && !catalog) return null;
  return {
    tibo: rows(tibo).filter(r => text(r?.id)).map(r => ({id: r.id, title: text(r.title), event_status: text(r.event_status), published_at: text(r.published_at) ?? null, collected_at: text(r.collected_at)})),
    news: rows(news).filter(r => text(r?.id)).map(r => ({id: r.id, title: text(r.title), source: text(r.source), published_at: text(r.published_at) ?? null, collected_at: text(r.collected_at)})),
    skills: rows(catalog).filter(r => text(r?.id)).map(r => ({id: r.id, name: text(r.name), repository: text(r.repository), stars: count(r.stars), stars_delta_7d: count(r.stars_delta_7d)})),
  };
}

const defaultProbe = (port: number) => new Promise<unknown>((resolve, reject) => {
  const request = get({host: '127.0.0.1', port, path: '/api/instance', timeout: 1500}, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(); });
    response.on('end', () => { try { resolve(response.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); } });
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', reject);
});

const defaultLaunch = (python: string, cwd: string) => new Promise<void>((resolve, reject) => {
  const child = spawn(python, ['-m', 'morningpaper', 'open'], {cwd, detached: true, stdio: 'ignore', windowsHide: true});
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(); });
});

export class MorningBriefLink {
  private root: string | null | undefined;
  private options: Options; private env: NodeJS.ProcessEnv; private platform: NodeJS.Platform;
  constructor(options: Options) {
    this.options = options; this.env = options.env ?? process.env; this.platform = options.platform ?? process.platform;
  }
  /** Locate the install: explicit setting, then the brief's own daily task. */
  async findRoot(): Promise<string | null> {
    if (this.root && isBriefRoot(this.root)) return this.root;
    const explicit = this.env.DESKFOLK_MORNING_BRIEF_DIR;
    if (explicit) return this.root = isBriefRoot(explicit) ? explicit : null;
    if (this.platform !== 'win32') return this.root = null;
    try {
      const dir = taskWorkingDirectory(await (this.options.exec ?? defaultExec)('schtasks', ['/query', '/tn', BRIEF_TASK, '/xml', 'ONE']));
      return this.root = dir && isBriefRoot(dir) ? dir : null;
    } catch {
      return this.root = null;
    }
  }
  private seen(): string[] {
    const state = this.options.readState ? this.options.readState() : readJson(this.options.statePath);
    return Array.isArray(state?.seen) ? state.seen.filter((id: unknown) => typeof id === 'string') : [];
  }
  /** The note for this reading; it is remembered so the next one moves on. */
  async nextNote(): Promise<BriefNote> {
    const root = await this.findRoot();
    const seen = this.seen();
    const note = pickBriefNote(root ? readBriefData(root) : null, seen, (this.options.now ?? Date.now)());
    this.options.writeState?.({seen: rememberNote(seen, note.id)});
    return note;
  }
  /** Open the brief's home page in the browser. */
  async open(): Promise<{ok: boolean; error?: string}> {
    const root = await this.findRoot();
    if (!root) return {ok: false, error: '没有找到晨报......'};
    const record = readJson(join(briefDataDir(this.env, this.platform), 'reader-session.json'));
    const port = Number(record?.port);
    if (Number.isInteger(port) && port > 0 && port < 65536 && typeof record?.instance_id === 'string') {
      // Only a service reporting the same instance as its record is the brief.
      const identity = await (this.options.probe ?? defaultProbe)(port).catch(() => null) as {instance_id?: unknown} | null;
      if (identity?.instance_id === record.instance_id) {
        await this.options.openExternal(`http://127.0.0.1:${port}/`);
        return {ok: true};
      }
    }
    try {
      await (this.options.launch ?? defaultLaunch)(this.env.MORNINGPAPER_PYTHON || (this.platform === 'win32' ? 'python' : 'python3'), root);
      return {ok: true};
    } catch {
      return {ok: false, error: '晨报需要 Python 3.11 才能打开......'};
    }
  }
}
