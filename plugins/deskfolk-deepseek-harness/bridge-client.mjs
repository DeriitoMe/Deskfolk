import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Local, authenticated, best-effort delivery. Never reads Harness credentials. */
export async function postToPet(body, { fetchImpl = fetch, read = readFile, env = process.env } = {}) {
  try {
    const directory = env.PET_USER_DATA || (env.APPDATA && join(env.APPDATA, 'liquid-glass-pet'));
    if (!directory) return false;
    const bridge = JSON.parse(await read(join(directory, 'bridge.json'), 'utf8'));
    if (!Number.isInteger(bridge.port) || bridge.port < 1 || bridge.port > 65535 ||
        typeof bridge.token !== 'string' || !/^[a-f0-9]{64}$/i.test(bridge.token)) return false;
    const response = await fetchImpl(`http://127.0.0.1:${bridge.port}/deepseek-harness`, {
      method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(750),
    });
    return response.ok;
  } catch { return false; }
}

/** A bounded FIFO keeps turn/question order without awaiting network in hooks. */
export function createSender({ post = postToPet, now = Date.now, limit = 256 } = {}) {
  const queue = [];
  let active = false, closed = false;
  const pump = async () => {
    if (active || closed) return;
    active = true;
    try {
      while (queue.length && !closed) {
        const item = queue.shift();
        if (now() - item.time <= 15_000) await post(item).catch(() => false);
      }
    } finally { active = false; }
  };
  return {
    send(body) {
      if (closed) return;
      if (queue.length >= limit) queue.shift();
      queue.push(body);
      void pump();
    },
    close() { closed = true; queue.length = 0; },
  };
}
