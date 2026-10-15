import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexQuotaMonitor} from './codex-quota.ts';
import type {CodexQuotaSnapshot} from '../shared/quota.ts';

const line = (timestamp: string, used: number, window = 300, reset = Math.floor(Date.now() / 1000) + 3600) =>
  JSON.stringify({type: 'event_msg', timestamp, payload: {type: 'token_count',
    info: {total_token_usage: {total_tokens: 12345}}, rate_limits: {
      limit_id: 'codex', primary: {used_percent: used, window_minutes: window, resets_at: reset},
    }}}) + '\n';

test('monitor restores the newest native quota and follows genuine appended changes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'deskfolk-quota-'));
  const directory = join(home, 'sessions', '2026', '10', '14');
  await mkdir(directory, {recursive: true});
  const file = join(directory, 'fixture.jsonl');
  const now = Date.now();
  await writeFile(file, line(new Date(now - 1000).toISOString(), 20) + line(new Date(now).toISOString(), 47));
  const updates: CodexQuotaSnapshot[] = [];
  const monitor = new CodexQuotaMonitor(home, value => updates.push(value));
  try {
    await monitor.poll();
    assert.equal(monitor.snapshot().remainingPercent, 53);
    assert.equal(updates.length, 1);
    await monitor.poll();
    assert.equal(updates.length, 1, 'unchanged files and values emit no redundant updates');
    await appendFile(file, line(new Date(now + 1000).toISOString(), 49));
    await monitor.poll();
    assert.equal(monitor.snapshot().remainingPercent, 51);
    await appendFile(file, line(new Date(now - 5000).toISOString(), 1));
    await monitor.poll();
    assert.equal(monitor.snapshot().remainingPercent, 51, 'late old records cannot replace newer account evidence');
    await appendFile(file, '{"type":"event_msg","payload":');
    await monitor.poll();
    assert.equal(monitor.snapshot().remainingPercent, 51, 'partially written JSONL preserves verified data');
  } finally {monitor.stop(); await rm(home, {recursive: true, force: true});}
});

test('isolated right-click refresh reads fixture logs without contacting the real account', async () => {
  const previous = process.env.PET_TEST_MODE;
  process.env.PET_TEST_MODE = '1';
  const home = await mkdtemp(join(tmpdir(), 'deskfolk-quota-test-mode-'));
  const directory = join(home, 'sessions');
  await mkdir(directory);
  await writeFile(join(directory, 'fixture.jsonl'), line(new Date().toISOString(), 88));
  const monitor = new CodexQuotaMonitor(home);
  try {
    const refreshed = await monitor.refresh();
    assert.equal(refreshed.remainingPercent, 12);
    assert.equal(refreshed.source, 'codex-log');
  } finally {
    monitor.stop(); await rm(home, {recursive: true, force: true});
    if (previous === undefined) delete process.env.PET_TEST_MODE;
    else process.env.PET_TEST_MODE = previous;
  }
});

test('no five-hour source stays unknown and a passed reset stays expired', async () => {
  const home = await mkdtemp(join(tmpdir(), 'deskfolk-quota-unknown-'));
  await mkdir(join(home, 'sessions'));
  const file = join(home, 'sessions', 'fixture.jsonl');
  await writeFile(file, line(new Date().toISOString(), 3, 10080));
  const monitor = new CodexQuotaMonitor(home);
  try {
    await monitor.poll();
    assert.equal(monitor.snapshot().status, 'unavailable');
    assert.equal(monitor.snapshot().remainingPercent, null);
    await appendFile(file, line(new Date().toISOString(), 100, 300, Math.floor(Date.now() / 1000) - 1));
    await monitor.poll();
    assert.equal(monitor.snapshot().status, 'expired');
    assert.equal(monitor.snapshot().remainingPercent, null);
  } finally {monitor.stop(); await rm(home, {recursive: true, force: true});}
});
