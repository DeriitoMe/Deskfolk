/**
 * "随 DeepSeek Harness 启动"：Harness 起来时如果 Deskfolk 没在跑，就把它拉起来。
 *
 * 与 Deskfolk 官方 Claude Code 接入（plugins/deskfolk-claude-code）的做法保持一致：
 *   - 只启动进程，不写 Deskfolk 的业务状态，偏好文件只读；
 *   - 通过 explorer.exe 启动，让桌宠挂在桌面会话下而不是 Harness 的进程树里，
 *     这样 Harness 退出时桌宠不会被连带杀掉；
 *   - 30 秒冷却锁，多个 Host 同时起来也只启动一次。
 *
 * 所有函数都接受注入参数（run/exists/probe/now/env），测试不会真的启动桌宠。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';

export const LAUNCH_COOLDOWN_MS = 30_000;
const PROBE_TIMEOUT_MS = 500;
const EXE_PATTERN = /[\\/]Deskfolk\.exe$/iu;

/** Deskfolk 的数据目录（沿用 Liquid Glass Pet 的名字）。 */
export function dataDir(env = process.env) {
  return env.PET_USER_DATA || join(env.APPDATA ?? '', 'liquid-glass-pet');
}

const readJson = async file => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return undefined; }
};

/** 端口是否有进程在监听：有 = 桌宠已经在跑。 */
export function portOpen(port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise(resolve => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return resolve(false);
    const socket = net.connect({ port, host: '127.0.0.1' });
    const settle = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/**
 * 找 Deskfolk.exe：安装器写过的 launch.json 优先，其次环境变量、默认安装位置。
 * @returns {Promise<string|undefined>}
 */
export async function findExecutable({ env = process.env, exists = existsSync } = {}) {
  const dir = dataDir(env);
  const candidates = [
    (await readJson(join(dir, 'launch.json')))?.exe,
    env.DESKFOLK_EXE,
    join(env.LOCALAPPDATA ?? '', 'Programs', 'Liquid Glass Pet', 'Deskfolk.exe'),
    'C:\\Program Files\\Deskfolk\\Deskfolk.exe',
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && EXE_PATTERN.test(candidate) && exists(candidate)) return candidate;
  }
  return undefined;
}

/**
 * @returns {Promise<'running'|'launched'|'disabled'|'missing'|'recent'>}
 */
export async function ensurePetRunning({
  env = process.env,
  now = Date.now(),
  run = spawn,
  exists = existsSync,
  probe = portOpen,
} = {}) {
  const dir = dataDir(env);
  const preferences = (await readJson(join(dir, 'preferences.json'))) ?? {};
  // 用户在设置里关掉开关，或把桌宠固定成只跟随 Codex 时，不要替 Harness 拉起。
  if (preferences.startWithDeepSeekHarness === false) return 'disabled';
  if (preferences.followAgent === 'codex') return 'disabled';

  const exe = await findExecutable({ env, exists });
  if (!exe) return 'missing';

  const bridge = await readJson(join(dir, 'bridge.json'));
  if (bridge && await probe(bridge.port)) return 'running';

  const lock = join(dir, 'dsh-launch.lock');
  const last = Number(await readFile(lock, 'utf8').catch(() => '0'));
  if (Number.isFinite(last) && now - last >= 0 && now - last < LAUNCH_COOLDOWN_MS) return 'recent';

  await writeFile(lock, String(now)).catch(() => {});
  run('explorer.exe', [exe], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return 'launched';
}
