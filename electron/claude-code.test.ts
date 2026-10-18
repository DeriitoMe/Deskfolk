import test from 'node:test';
import assert from 'node:assert/strict';
import type { PetEvent } from '../shared/types';
import {dominantActivity,shouldCelebrateCompletion,shouldDeliverBufferedEvent,shouldDeliverPetEvent,
  updateSessionActivities,type SessionActivities} from '../shared/activity.ts';
import {isQuestionReminder,shouldShowBubble} from '../shared/reminders.ts';
import {shouldPresentAcceptedEvent} from './event-presentation.ts';
import {CurrentQuestionLedger} from './current-questions.ts';
import {ClaudeCodeAdapter,claudeFailureType,type ClaudeEventInput} from './claude-code.ts';

const S='11111111-2222-3333-4444-555555555555';
const P1='aaaaaaaa-0000-0000-0000-000000000001',P2='aaaaaaaa-0000-0000-0000-000000000002';
const hook=(hook_event_name:string,extra:Record<string,unknown>={})=>({hook_event_name,session_id:S,
  cwd:'D:\\Work\\Deskfolk',...extra});
let ids=0;
const adapter=()=>new ClaudeCodeAdapter(()=>'gen-'+(++ids));
const toEvent=(input:ClaudeEventInput,at=Date.now()):PetEvent=>({...input,source:'claude-code',
  createdAt:new Date(at).toISOString(),read:false,replayed:false});

/** Mirror electron/main.ts acceptEvent for presentation decisions. */
function run(a:ClaudeCodeAdapter,payloads:Record<string,unknown>[],start:SessionActivities={}) {
  let sessions=start;const shown:PetEvent[]=[];const celebrated:PetEvent[]=[];const now=Date.now();
  for(const payload of payloads)for(const input of a.translate(payload)){
    const event=toEvent(input,now);
    const before=sessions,beforeAgg=JSON.stringify(dominantActivity(sessions));
    const celebrate=shouldCelebrateCompletion(sessions,event);
    sessions=updateSessionActivities(sessions,event,now);
    const changed=beforeAgg!==JSON.stringify(dominantActivity(sessions));
    if(shouldPresentAcceptedEvent(event,before,sessions,changed,now)&&
      shouldDeliverPetEvent(event,dominantActivity(sessions))&&shouldDeliverBufferedEvent(sessions,event)){
      shown.push(event);if(celebrate)celebrated.push(event);
    }
  }
  return {sessions,shown,celebrated,activity:dominantActivity(sessions)};
}

test('prompt starts work with a live bubble; Stop celebrates once and returns to idle',()=>{
  const a=adapter();
  let r=run(a,[hook('SessionStart',{source:'startup'}),hook('UserPromptSubmit',{prompt_id:P1})]);
  assert.equal(r.activity.phase,'working');
  assert.equal(r.activity.workingProjectCount,1);
  assert.deepEqual(r.shown.map(e=>e.type),['work_started']);
  assert.equal(shouldShowBubble(r.shown[0]),true);
  assert.equal(r.shown[0].project,'Deskfolk');
  r=run(a,[hook('PostToolUse',{prompt_id:P1,tool_name:'Bash'}),hook('Stop',{prompt_id:P1})],r.sessions);
  assert.equal(r.activity.phase,'idle');
  assert.deepEqual(r.celebrated.map(e=>e.type),['task_complete']);
});

test('subagent stops never end or celebrate the parent turn',()=>{
  const a=adapter();
  let r=run(a,[hook('UserPromptSubmit',{prompt_id:P1}),hook('Stop',{prompt_id:P1,agent_id:'sub-1'})]);
  assert.equal(r.activity.phase,'working');
  assert.equal(r.celebrated.length,0);
});

test('permission prompt asks, a finished tool resolves it, and no celebration happens while asking',()=>{
  const a=adapter();
  let r=run(a,[hook('UserPromptSubmit',{prompt_id:P1}),hook('Notification',{prompt_id:P1,notification_type:'permission_prompt'})]);
  assert.equal(r.activity.phase,'asking');
  const ask=r.shown.find(e=>e.type==='needs_input')!;
  assert.ok(ask&&isQuestionReminder(ask));
  // A second notice for the same open dialog does not stack.
  assert.equal(a.translate(hook('Notification',{prompt_id:P1,notification_type:'permission_prompt'})).length,0);
  r=run(a,[hook('PostToolUse',{prompt_id:P1,tool_name:'Bash'})],r.sessions);
  assert.equal(r.activity.phase,'working');
  r=run(a,[hook('Stop',{prompt_id:P1})],r.sessions);
  assert.equal(r.activity.phase,'idle');
  assert.equal(r.celebrated.length,1);
});

test('AskUserQuestion is a native question keyed by its tool call',()=>{
  const a=adapter();
  const ledger=new CurrentQuestionLedger();
  let r=run(a,[hook('UserPromptSubmit',{prompt_id:P1}),
    hook('PreToolUse',{prompt_id:P1,tool_name:'AskUserQuestion',tool_use_id:'toolu_ask'})]);
  const ask=r.shown.find(e=>e.type==='needs_input')!;
  assert.equal(ask.nativeCallId,'toolu_ask');
  ledger.accepted(ask);
  assert.equal(r.activity.phase,'asking');
  // Stop with an answered-or-abandoned dialog clears it before completing.
  r=run(a,[hook('Stop',{prompt_id:P1})],r.sessions);
  assert.equal(r.activity.phase,'idle');
});

test('StopFailure maps rate limits to quota exhaustion and other errors to failure',()=>{
  for(const [error_type,outcome] of [['rate_limit','quota_exhausted'],['server_error','failed']] as const){
    const a=adapter();
    const r=run(a,[hook('UserPromptSubmit',{prompt_id:P1}),hook('StopFailure',{prompt_id:P1,error_type})]);
    assert.equal(r.activity.phase,'idle');
    assert.equal(r.shown.at(-1)?.outcome,outcome);
    assert.equal(r.celebrated.length,0);
  }
  assert.equal(claudeFailureType({error:{type:'rate_limit'}}),'rate_limit');
  assert.equal(claudeFailureType({error:'billing_error'}),'billing_error');
});

test('Esc leaves no Stop; the later idle notice ends the glow as a pause',()=>{
  const a=adapter();
  let r=run(a,[hook('UserPromptSubmit',{prompt_id:P1})]);
  r=run(a,[hook('Notification',{notification_type:'idle_prompt'})],r.sessions);
  assert.equal(r.activity.phase,'idle');
  assert.equal(r.shown.at(-1)?.outcome,'interrupted');
  // After a normal Stop, the idle notice is ignored.
  r=run(a,[hook('UserPromptSubmit',{prompt_id:P2}),hook('Stop',{prompt_id:P2})],r.sessions);
  assert.equal(a.translate(hook('Notification',{notification_type:'idle_prompt'})).length,0);
});

test('a delayed Stop for an older prompt cannot stop the newer prompt',()=>{
  const a=adapter();
  let r=run(a,[hook('UserPromptSubmit',{prompt_id:P1}),hook('UserPromptSubmit',{prompt_id:P2}),hook('Stop',{prompt_id:P1})]);
  assert.equal(r.activity.phase,'working');
  assert.equal(r.celebrated.length,0);
});

test('Claude and Codex sessions in different projects make super work',()=>{
  const a=adapter();
  let r=run(a,[hook('UserPromptSubmit',{prompt_id:P1})]);
  const codex:PetEvent={id:'c',source:'codex-log',type:'work_started',sessionId:'codex-session-0000000000001',
    turnId:'t1',projectPath:'D:/Work/other',createdAt:new Date().toISOString(),read:false};
  const sessions=updateSessionActivities(r.sessions,codex);
  assert.equal(dominantActivity(sessions).fullPower,true);
});

test('session end while running is a pause; without a turn nothing is emitted',()=>{
  const a=adapter();
  assert.equal(a.translate(hook('SessionEnd',{reason:'other'})).length,0);
  a.translate(hook('UserPromptSubmit',{prompt_id:P1}));
  const end=a.translate(hook('SessionEnd',{reason:'prompt_input_exit'}));
  assert.deepEqual(end.map(e=>[e.type,e.outcome]),[['interrupted','interrupted']]);
});

test('missing prompt_id still pairs start and end; malformed payloads are ignored',()=>{
  const a=adapter();
  const [start]=a.translate(hook('UserPromptSubmit'));
  const [end]=a.translate(hook('Stop'));
  assert.equal(start.turnId,end.turnId);
  assert.deepEqual(a.translate(null),[]);
  assert.deepEqual(a.translate({hook_event_name:'Stop'}),[]);
  assert.ok(start.sessionId.startsWith('claude-code:'));
});
