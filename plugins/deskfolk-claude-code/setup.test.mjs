import test from 'node:test';
import assert from 'node:assert/strict';
import { applySettings, GESTURE_MATCHER, HOOK_EVENTS } from './setup.mjs';
import { CLAUDE_GESTURE_TOOLS } from '../../electron/claude-tools.ts';
import { hookSummary, statusSummary } from './bridge-client.mjs';

test('install keeps user hooks, is idempotent, and uninstall removes only Deskfolk', () => {
  const user = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] }, model: 'opus' };
  const once = applySettings(user).settings;
  const twice = applySettings(once).settings;
  assert.deepEqual(twice, once);
  assert.equal(once.model, 'opus');
  assert.equal(once.hooks.Stop.length, 2);
  for (const [event] of HOOK_EVENTS) assert.ok(once.hooks[event], event);
  assert.deepEqual(once.hooks.PreToolUse.map(group => group.matcher), ['AskUserQuestion', GESTURE_MATCHER]);
  assert.equal(once.hooks.PreToolUse[1].hooks[0].async, true, 'gesture hooks never delay a tool');
  assert.match(once.statusLine.command, /deskfolk-claude-code\/statusline\.mjs/);
  const removed = applySettings(once, { uninstall: true }).settings;
  assert.deepEqual(removed, user);
});

test('the gesture matcher covers exactly the tools the pet animates', () => {
  assert.deepEqual(GESTURE_MATCHER.split('|').sort(), [...CLAUDE_GESTURE_TOOLS].sort());
});

test('a foreign status line is kept unless replacement is requested', () => {
  const user = { statusLine: { type: 'command', command: 'my-line' } };
  const kept = applySettings(user);
  assert.equal(kept.settings.statusLine.command, 'my-line');
  assert.equal(kept.notes.length, 1);
  assert.match(applySettings(user, { replaceStatusline: true }).settings.statusLine.command, /statusline\.mjs/);
});

test('only lifecycle identity is forwarded', () => {
  const summary = hookSummary({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt_id: 'p',
    cwd: 'D:/x', prompt: 'secret prompt', transcript_path: 'C:/t.jsonl', last_assistant_message: 'text' });
  assert.deepEqual(summary, { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt_id: 'p', cwd: 'D:/x' });
  assert.equal(hookSummary({ session_id: 's' }), null);
  assert.deepEqual(statusSummary({ cost: 1, rate_limits: { five_hour: { used_percentage: 5, resets_at: 9 }, seven_day: {} } }),
    { rate_limits: { five_hour: { used_percentage: 5, resets_at: 9 } } });
});

test('SessionStart can start the pet, honoring settings and a cooldown', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { launchPet } = await import('./bridge-client.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'deskfolk-launch-')), previous = process.env.PET_USER_DATA;
  process.env.PET_USER_DATA = dir;
  try {
    const exe = 'C:/Programs/Liquid Glass Pet/Deskfolk.exe', calls = [];
    const run = (command, args) => { calls.push([command, ...args]); return { unref() {} }; };
    writeFileSync(join(dir, 'launch.json'), JSON.stringify({ exe }));
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ startWithClaudeCode: false }));
    assert.equal(await launchPet({ run, exists: () => true }), 'disabled');
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ startWithClaudeCode: true, followAgent: 'codex' }));
    assert.equal(await launchPet({ run, exists: () => true }), 'disabled', 'only following Codex');
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ startWithClaudeCode: true, followAgent: 'all' }));
    assert.equal(await launchPet({ run, exists: () => false }), 'missing');
    writeFileSync(join(dir, 'launch.json'), JSON.stringify({ exe: 'C:/Windows/notepad.exe' }));
    assert.equal(await launchPet({ run, exists: () => true }), 'missing', 'never launches another program');
    writeFileSync(join(dir, 'launch.json'), JSON.stringify({ exe }));
    assert.equal(await launchPet({ now: 100_000, run, exists: () => true }), 'launched');
    assert.deepEqual(calls, [['explorer.exe', exe]]);
    assert.equal(await launchPet({ now: 110_000, run, exists: () => true }), 'recent');
    assert.equal(await launchPet({ now: 140_001, run, exists: () => true }), 'launched');
    assert.equal(calls.length, 2);
  } finally {
    if (previous === undefined) delete process.env.PET_USER_DATA; else process.env.PET_USER_DATA = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
