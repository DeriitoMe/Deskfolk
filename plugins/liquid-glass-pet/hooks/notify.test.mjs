import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {hookEvents} from './notify.mjs';

const input = {
  session_id: 'fixture-session', turn_id: 'fixture-turn', cwd: 'D:/Fixture',
  tool_name: 'Bash', tool_use_id: 'opaque-tool-id',
  tool_input: {command: 'fixture-read-only', description: 'fixture-reason'},
  tool_response: {private: 'not-forwarded'},
};

test('installed hooks do not subscribe to generic permission requests', async () => {
  const config = JSON.parse(await readFile(new URL('./hooks.json', import.meta.url), 'utf8'));
  assert.equal(Object.hasOwn(config.hooks, 'PermissionRequest'), false);
  assert.deepEqual(Object.keys(config.hooks), [
    'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt',
  ]);
  assert.equal(JSON.stringify(config).includes('approval_needed'), false);
});

test('retired approval actions are ignored even with fully identified permission input', () => {
  assert.deepEqual(hookEvents('approval_needed', input), []);
  assert.deepEqual(hookEvents('approval_resolved', input), []);
  assert.deepEqual(hookEvents('approval_needed', {...input, tool_use_id: undefined}), []);
  assert.deepEqual(hookEvents('approval_needed', {}), []);
});

test('question attempts only report progress; native acceptance owns waiting reminders', () => {
  for (const tool_name of [
    'request_user_input', 'functions.request_user_input', 'functions.request_user_input_async',
  ]) {
    const events = hookEvents('work_progress', {...input, tool_name});
    assert.deepEqual(events.map(event => event.type), ['work_progress']);
    assert.equal(events[0].nativeQuestion, undefined);
    assert.equal(events[0].nativeCallId, undefined);
    assert.equal(events[0].message, '');
  }
});

test('ordinary tool completion emits progress without an approval resolution', () => {
  const events = hookEvents('tool_finished', input);
  assert.deepEqual(events.map(event => event.type), ['work_progress']);
  assert.equal(events[0].nativeApproval, undefined);
  assert.equal(events[0].nativeCallId, undefined);
});

test('only identified synchronous question completion emits auxiliary input resolution', () => {
  const question = {...input, tool_name: 'functions.request_user_input', tool_use_id: 'question-id'};
  const [resolved] = hookEvents('tool_finished', question);
  assert.equal(resolved.type, 'input_resolved');
  assert.equal(resolved.nativeCallId, 'question-id');
  assert.equal(resolved.sessionId, input.session_id);
  assert.equal(resolved.turnId, input.turn_id);
  assert.equal(resolved.nativeQuestion, undefined);
  for (const missing of ['session_id', 'turn_id', 'tool_use_id']) {
    assert.deepEqual(hookEvents('tool_finished', {...question, [missing]: undefined})
      .map(event => event.type), ['work_progress']);
    assert.deepEqual(hookEvents('tool_finished', {...question, [missing]: ''})
      .map(event => event.type), ['work_progress']);
  }
  assert.deepEqual(hookEvents('tool_finished', {
    ...question, tool_name: 'functions.request_user_input_async',
  }).map(event => event.type), ['work_progress']);
  assert.equal(hookEvents('tool_finished', {...question, session_id: undefined}, 'fallback-session')[0]
    .sessionId, 'fallback-session');
});

test('lifecycle telemetry preserves interruption and does not infer success from Stop', () => {
  assert.deepEqual(hookEvents('turn_ended', {...input, stop_hook_active: true}), []);
  const [ended] = hookEvents('turn_ended', input);
  assert.equal(ended.type, 'turn_ended');
  assert.equal(ended.outcome, undefined);
  const [interrupted] = hookEvents('interrupted', input);
  assert.equal(interrupted.type, 'interrupted');
  assert.equal(interrupted.outcome, 'interrupted');
  assert.equal(hookEvents('work_started', input)[0].type, 'work_started');
});

test('telemetry contains context but carries no tool arguments, output or permission decisions', () => {
  for (const action of ['work_started', 'work_progress', 'tool_finished', 'turn_ended', 'interrupted']) {
    const events = hookEvents(action, {...input, is_subagent: true});
    assert.equal(events[0].project, 'Fixture');
    assert.equal(events[0].projectPath, input.cwd);
    assert.equal(events[0].isSubagent, true);
    const wire = JSON.stringify(events);
    for (const forbidden of [
      'fixture-read-only', 'fixture-reason', 'not-forwarded', 'tool_input', 'tool_response',
      'decision', 'behavior', 'allow', 'deny',
    ]) assert.equal(wire.includes(forbidden), false);
  }
});

async function run(action, data, appData) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./notify.mjs', import.meta.url)), action], {
      env: {...process.env, APPDATA: appData}, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({code, stdout, stderr}));
    child.stdin.end(JSON.stringify(data));
  });
}

test('actual hook keeps stale permission calls silent and leaves official permission flow untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deskfolk-hook-')), events = [];
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + token);
    let body = '';
    for await (const chunk of req) body += chunk;
    events.push(JSON.parse(body));
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end('{}');
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await mkdir(join(root, 'liquid-glass-pet'));
    await writeFile(join(root, 'liquid-glass-pet', 'bridge.json'),
      JSON.stringify({port: server.address().port, token}));
    assert.deepEqual(await run('approval_needed', input, root), {code: 0, stdout: '', stderr: ''});
    assert.deepEqual(await run('approval_resolved', input, root), {code: 0, stdout: '', stderr: ''});
    assert.deepEqual(events, []);
    const question = {...input, tool_name: 'functions.request_user_input', tool_use_id: 'question-id'};
    assert.deepEqual(await run('work_progress', question, root), {code: 0, stdout: '', stderr: ''});
    assert.deepEqual(await run('tool_finished', input, root), {code: 0, stdout: '', stderr: ''});
    assert.deepEqual(await run('tool_finished', question, root), {code: 0, stdout: '', stderr: ''});
    assert.deepEqual(events.map(event => event.type), ['work_progress', 'work_progress', 'input_resolved']);
    assert.equal(events[2].nativeCallId, 'question-id');
    assert.deepEqual(await run('turn_ended', input, root), {code: 0, stdout: '{}\n', stderr: ''});
    assert.equal(events.at(-1).type, 'turn_ended');
    assert.equal(events.at(-1).outcome, undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  }
});

test('missing pet bridge never breaks an interruption or retired permission call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deskfolk-hook-missing-'));
  try {
    assert.deepEqual(await run('approval_needed', input, root), {code: 0, stdout: '', stderr: ''});
    assert.deepEqual(await run('interrupted', input, root), {code: 0, stdout: '{}\n', stderr: ''});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
