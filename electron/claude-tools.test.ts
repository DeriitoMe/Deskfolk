import test from 'node:test';
import assert from 'node:assert/strict';
import {CLAUDE_TOOL_MIN_HOLD_MS,CLAUDE_TOOL_STALE_MS,ClaudeToolTracker,claudeToolGesture} from './claude-tools.ts';

const S='11111111-2222-3333-4444-555555555555',S2='99999999-2222-3333-4444-555555555555';
const hook=(hook_event_name:string,extra:Record<string,unknown>={},session=S)=>({hook_event_name,session_id:session,...extra});
const working=()=>true;

test('commands map to typing, file edits to writing, everything else to plain work',()=>{
  assert.equal(claudeToolGesture('Bash'),'type');
  assert.equal(claudeToolGesture('PowerShell'),'type');
  for(const name of ['Edit','Write','MultiEdit','NotebookEdit'])assert.equal(claudeToolGesture(name),'write');
  for(const name of ['Read','Grep','Glob','WebSearch','WebFetch','Task','AskUserQuestion',undefined,42])assert.equal(claudeToolGesture(name),undefined);
});

test('a long command keeps typing until it ends, then holds briefly',()=>{
  const t=new ClaudeToolTracker();
  assert.equal(t.observe(hook('PreToolUse',{tool_name:'Bash',tool_use_id:'b1'}),0),true);
  assert.equal(t.current(10_000,working),'type');
  t.observe(hook('PostToolUse',{tool_name:'Bash',tool_use_id:'b1'}),12_000);
  assert.equal(t.current(12_001,working),null,'hold measured from the start, already over');
});

test('a quick edit is still shown for the minimum hold',()=>{
  const t=new ClaudeToolTracker();
  t.observe(hook('PreToolUse',{tool_name:'Edit',tool_use_id:'e1'}),0);
  t.observe(hook('PostToolUse',{tool_name:'Edit',tool_use_id:'e1'}),40);
  assert.equal(t.current(1000,working),'write');
  assert.equal(t.current(CLAUDE_TOOL_MIN_HOLD_MS+1,working),null);
  assert.equal(t.nextChangeAt(),undefined,'expired holds are dropped');
});

test('the newest gesture wins across tools and sessions',()=>{
  const t=new ClaudeToolTracker();
  t.observe(hook('PreToolUse',{tool_name:'Bash',tool_use_id:'b1'}),0);
  t.observe(hook('PreToolUse',{tool_name:'Write',tool_use_id:'w1'},S2),500);
  assert.equal(t.current(600,working),'write');
  t.observe(hook('PostToolUse',{tool_name:'Write',tool_use_id:'w1'},S2),700);
  assert.equal(t.current(CLAUDE_TOOL_MIN_HOLD_MS+600,working),'type','the still-running command remains');
});

test('only sessions that are really working may show a gesture',()=>{
  const t=new ClaudeToolTracker();
  t.observe(hook('PreToolUse',{tool_name:'Bash',tool_use_id:'b1'}),0);
  assert.equal(t.current(100,id=>id!=='claude-code:'+S),null,'asking or idle sessions stay quiet');
});

test('Stop, a new prompt, idle and session end clear the session',()=>{
  for(const end of [hook('Stop'),hook('UserPromptSubmit'),hook('SessionEnd'),hook('Notification',{notification_type:'idle_prompt'})]){
    const t=new ClaudeToolTracker();
    t.observe(hook('PreToolUse',{tool_name:'Bash',tool_use_id:'b1'}),0);
    assert.equal(t.observe(end,10),true);
    assert.equal(t.current(20,working),null);
  }
});

test('older installs without PreToolUse still get a short gesture after the tool',()=>{
  const t=new ClaudeToolTracker();
  t.observe(hook('PostToolUse',{tool_name:'Bash',tool_use_id:'b9'}),1000);
  assert.equal(t.current(1500,working),'type');
  assert.equal(t.nextChangeAt(),1000+CLAUDE_TOOL_MIN_HOLD_MS);
});

test('a lost PostToolUse cannot pin a gesture forever',()=>{
  const t=new ClaudeToolTracker();
  t.observe(hook('PreToolUse',{tool_name:'Bash',tool_use_id:'b1'}),0);
  assert.equal(t.current(CLAUDE_TOOL_STALE_MS+1,working),null);
});

test('malformed or unrelated payloads are ignored',()=>{
  const t=new ClaudeToolTracker();
  for(const raw of [null,[],'x',{},{hook_event_name:'PreToolUse'},hook('PreToolUse',{tool_name:'Read'}),hook('Notification',{notification_type:'permission_prompt'})])
    assert.equal(t.observe(raw,0),false);
});
