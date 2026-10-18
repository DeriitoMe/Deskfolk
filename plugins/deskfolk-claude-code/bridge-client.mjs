import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Deskfolk's user data folder (compatible name kept from Liquid Glass Pet). */
export function dataDir() {
  return process.env.PET_USER_DATA || join(process.env.APPDATA ?? '', 'liquid-glass-pet');
}

/** Same per-launch port and token file that Deskfolk writes for every bridge. */
export function bridgeFile() {
  return join(dataDir(), 'bridge.json');
}

const LAUNCH_COOLDOWN_MS = 30_000;
const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; } };

/**
 * "随 Claude Code 启动": start the installed pet when it is not running.
 * Honors the pet's own settings, only launches a Deskfolk.exe, and at most
 * once per 30 s so several sessions opening together start it once.
 * Goes through explorer.exe so the pet lives in the desktop session, not
 * under Claude Code's process tree.
 */
export async function launchPet({ now = Date.now(), run = spawn, exists = existsSync } = {}) {
  const dir = dataDir();
  const preferences = await readJson(join(dir, 'preferences.json')) ?? {};
  if (preferences.startWithClaudeCode === false || preferences.followAgent === 'codex') return 'disabled';
  const recorded = (await readJson(join(dir, 'launch.json')))?.exe;
  const exe = typeof recorded === 'string' ? recorded
    : join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Liquid Glass Pet', 'Deskfolk.exe');
  if (!/[\\/]Deskfolk\.exe$/i.test(exe) || !exists(exe)) return 'missing';
  const lock = join(dir, 'claude-launch.lock');
  const last = Number(await readFile(lock, 'utf8').catch(() => '0'));
  if (Number.isFinite(last) && now - last >= 0 && now - last < LAUNCH_COOLDOWN_MS) return 'recent';
  await writeFile(lock, String(now)).catch(() => {});
  run('explorer.exe', [exe], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return 'launched';
}

export async function readStdin(limit = 1_048_576) {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.length > limit) return '';
  }
  return data;
}

/** Best effort: a closed pet must never slow down or fail Claude Code. */
export async function postToPet(path, body, timeoutMs) {
  let bridge;
  try { bridge = JSON.parse(await readFile(bridgeFile(), 'utf8')); } catch { return false; }
  if (!Number.isInteger(bridge?.port) || bridge.port < 1 || bridge.port > 65535 ||
      typeof bridge.token !== 'string' || !/^[a-f0-9]{64}$/i.test(bridge.token)) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch { return false; }
}

const pick = (value, limit) => typeof value === 'string' && value ? value.slice(0, limit) : undefined;

/**
 * Only lifecycle identity leaves Claude Code: no prompt, assistant text,
 * tool input/output or transcript content is forwarded to the pet.
 */
export function hookSummary(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const error = input.error && typeof input.error === 'object' ? input.error.type : input.error;
  const summary = {
    hook_event_name: pick(input.hook_event_name, 60),
    session_id: pick(input.session_id, 100),
    prompt_id: pick(input.prompt_id, 100),
    cwd: pick(input.cwd, 1024),
    agent_id: pick(input.agent_id, 100),
    tool_name: pick(input.tool_name, 80),
    tool_use_id: pick(input.tool_use_id, 100),
    notification_type: pick(input.notification_type, 60),
    error_type: pick(input.error_type, 60) ?? pick(error, 60),
  };
  if (!summary.hook_event_name || !summary.session_id) return null;
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined));
}

export function statusSummary(input) {
  const window = input?.rate_limits?.five_hour;
  if (!window || typeof window !== 'object') return { rate_limits: {} };
  return { rate_limits: { five_hour: {
    used_percentage: window.used_percentage, resets_at: window.resets_at,
  } } };
}
