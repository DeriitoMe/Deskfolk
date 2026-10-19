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

test('the files the installer ships work from an install path with spaces, CJK and a junction', async () => {
  const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const shipped = pkg.build.extraResources.find(entry => entry.to === 'plugins/deskfolk-claude-code');
  assert.ok(shipped, 'package.json ships the Claude Code plugin');
  const root = mkdtempSync(join(tmpdir(), 'deskfolk 桌宠-'));
  const programs = join(root, 'Programs');
  const plugin = join(programs, 'Liquid Glass Pet', 'resources', 'plugins', 'deskfolk-claude-code');
  const env = { ...process.env, PET_USER_DATA: join(root, 'pet data') };
  const run = (command, args, options) => spawnSync(command, args, { env, encoding: 'utf8', timeout: 15_000, ...options });
  try {
    mkdirSync(plugin, { recursive: true });
    for (const name of shipped.filter) copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(plugin, name));
    const real = realpathSync(plugin).replace(/\\/g, '/');

    // As the README says: run setup.mjs from the installed plugin folder.
    const settingsFile = join(root, 'settings.json');
    const setup = run('node', ['setup.mjs', '--settings', settingsFile], { cwd: plugin });
    assert.equal(setup.status, 0, setup.stderr);
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    const hooks = Object.values(settings.hooks).flat().flatMap(group => group.hooks);
    assert.equal(hooks.length, HOOK_EVENTS.length);
    for (const hook of hooks) assert.deepEqual([hook.command, hook.args], ['node', [`${real}/hook.mjs`]]);
    assert.equal(settings.statusLine.command, `node "${real}/statusline.mjs"`);

    // Claude Code spawns hooks without a shell (args) and the status line through one.
    const hook = run(hooks[0].command, hooks[0].args, { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }) });
    assert.deepEqual([hook.status, hook.stdout, hook.stderr], [0, '', '']);
    const status = run(settings.statusLine.command, [], { shell: true,
      input: JSON.stringify({ model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 12 } } }) });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(status.stdout.trim(), 'Opus · Current session: 12%');

    // Through a junction (e.g. a relocated AppData) setup still writes the real path.
    const linked = join(root, 'Linked Programs');
    symlinkSync(programs, linked, 'junction');
    const viaLink = join(root, 'via-link.json');
    const linkedSetup = run('node', [join(linked, 'Liquid Glass Pet', 'resources', 'plugins', 'deskfolk-claude-code', 'setup.mjs'), '--settings', viaLink]);
    assert.equal(linkedSetup.status, 0, linkedSetup.stderr);
    assert.equal(JSON.parse(readFileSync(viaLink, 'utf8')).statusLine.command, settings.statusLine.command);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
