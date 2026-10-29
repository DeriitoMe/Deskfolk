import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LAUNCH_COOLDOWN_MS, dataDir, ensurePetRunning, findExecutable } from './launch-pet.mjs';

const EXE = 'C:\\Apps\\Deskfolk\\Deskfolk.exe';

/** 一个只存在于内存里的 AppData，测试不会碰真实偏好。 */
async function sandbox({ preferences, bridge, launch } = {}) {
  const appdata = await mkdtemp(join(tmpdir(), 'deskfolk-launch-'));
  const dir = join(appdata, 'liquid-glass-pet');
  await mkdir(dir, { recursive: true });
  if (preferences) await writeFile(join(dir, 'preferences.json'), JSON.stringify(preferences));
  if (bridge) await writeFile(join(dir, 'bridge.json'), JSON.stringify(bridge));
  if (launch) await writeFile(join(dir, 'launch.json'), JSON.stringify(launch));
  return { appdata, dir, env: { APPDATA: appdata, LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' } };
}

test('dataDir 优先用 PET_USER_DATA', () => {
  assert.equal(dataDir({ PET_USER_DATA: 'D:\\pet' }), 'D:\\pet');
  assert.equal(dataDir({ APPDATA: 'C:\\Roaming' }), join('C:\\Roaming', 'liquid-glass-pet'));
});

test('launch.json 里记录的 exe 优先', async () => {
  const box = await sandbox({ launch: { exe: EXE } });
  try {
    assert.equal(await findExecutable({ env: box.env, exists: path => path === EXE }), EXE);
  } finally { await rm(box.appdata, { recursive: true, force: true }); }
});

test('没有安装时返回 missing，不启动任何进程', async () => {
  const box = await sandbox();
  const spawned = [];
  try {
    const result = await ensurePetRunning({
      env: box.env, exists: () => false, probe: async () => false,
      run: (...args) => spawned.push(args),
    });
    assert.equal(result, 'missing');
    assert.equal(spawned.length, 0);
  } finally { await rm(box.appdata, { recursive: true, force: true }); }
});

test('开关关掉时不拉起', async () => {
  const box = await sandbox({ preferences: { startWithDeepSeekHarness: false }, launch: { exe: EXE } });
  const spawned = [];
  try {
    const result = await ensurePetRunning({
      env: box.env, exists: () => true, probe: async () => false,
      run: (...args) => spawned.push(args),
    });
    assert.equal(result, 'disabled');
    assert.equal(spawned.length, 0);
  } finally { await rm(box.appdata, { recursive: true, force: true }); }
});

test('跟随 Codex 时不替 Harness 拉起', async () => {
  const box = await sandbox({ preferences: { followAgent: 'codex' }, launch: { exe: EXE } });
  const spawned = [];
  try {
    const result = await ensurePetRunning({
      env: box.env, exists: () => true, probe: async () => false,
      run: (...args) => spawned.push(args),
    });
    assert.equal(result, 'disabled');
    assert.equal(spawned.length, 0);
  } finally { await rm(box.appdata, { recursive: true, force: true }); }
});

test('桥接端口通着就认为已经在跑', async () => {
  const box = await sandbox({ bridge: { port: 61234 }, launch: { exe: EXE } });
  const spawned = [];
  try {
    const result = await ensurePetRunning({
      env: box.env, exists: () => true, probe: async port => port === 61234,
      run: (...args) => spawned.push(args),
    });
    assert.equal(result, 'running');
    assert.equal(spawned.length, 0);
  } finally { await rm(box.appdata, { recursive: true, force: true }); }
});

test('没在跑时通过 explorer.exe 启动，并写冷却锁', async () => {
  const box = await sandbox({ bridge: { port: 61234 }, launch: { exe: EXE } });
  const spawned = [];
  const child = { unref() {} };
  try {
    const result = await ensurePetRunning({
      env: box.env, exists: () => true, probe: async () => false, now: 1_700_000_000_000,
      run: (...args) => { spawned.push(args); return child; },
    });
    assert.equal(result, 'launched');
    assert.deepEqual(spawned[0].slice(0, 2), ['explorer.exe', [EXE]]);
    assert.equal(await readFile(join(box.dir, 'dsh-launch.lock'), 'utf8'), '1700000000000');
  } finally { await rm(box.appdata, { recursive: true, force: true }); }
});

test('冷却窗口内不重复拉起', async () => {
  const box = await sandbox({ launch: { exe: EXE } });
  const now = 1_700_000_000_000;
  const spawned = [];
  try {
    await writeFile(join(box.dir, 'dsh-launch.lock'), String(now - 1_000));
    const result = await ensurePetRunning({
      env: box.env, exists: () => true, probe: async () => false, now,
      run: (...args) => spawned.push(args),
    });
    assert.equal(result, 'recent');
    assert.equal(spawned.length, 0);
  } finally { await rm(box.appdata, { recursive: true, force: true }); }
});

test('冷却是 30 秒', () => {
  assert.equal(LAUNCH_COOLDOWN_MS, 30_000);
});

test('仓库里有 launch-pet.mjs 才能被 files 收录', () => {
  assert.equal(existsSync(new URL('./launch-pet.mjs', import.meta.url)), true);
});
