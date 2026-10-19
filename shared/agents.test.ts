import test from 'node:test';
import assert from 'node:assert/strict';
import {FOLLOW_AGENTS,eventAgent,follows,normalizeFollowAgent,sessionAgent,visibleSessions} from './agents.ts';
import {dominantActivity,type SessionActivities} from './activity.ts';

const now=new Date().toISOString();
const working=(sessionId:string,projectPath:string)=>({phase:'working' as const,sessionId,projectPath,updatedAt:now});

test('events and sessions are assigned to their agent',()=>{
  assert.equal(eventAgent('claude-code'),'claude');
  assert.equal(eventAgent('deepseek-harness'),'deepseek');
  for(const source of ['codex-log','hook','mcp'] as const)assert.equal(eventAgent(source),'codex');
  assert.equal(eventAgent('demo'),undefined,'previews belong to no agent');
  assert.equal(sessionAgent('claude-code:abc'),'claude');
  assert.equal(sessionAgent('deepseek-harness:abc'),'deepseek');
  assert.equal(sessionAgent('deepseek-harness-other'),'codex','only the explicit adapter namespace is special');
  assert.equal(sessionAgent('019a-codex-session'),'codex');
});

test('the follow choice filters presentation, demo is always shown',()=>{
  assert.equal(follows('deepseek','deepseek'),true);
  assert.equal(follows('deepseek','codex'),false);assert.equal(follows('codex','deepseek'),false);
  assert.equal(follows('claude','deepseek'),false);assert.equal(follows('deepseek','claude'),false);
  assert.equal(follows('codex','claude'),false);assert.equal(follows('claude','codex'),false);
  assert.equal(follows('codex',undefined),true);
  assert.equal(normalizeFollowAgent('claude'),'claude');
  assert.equal(normalizeFollowAgent('deepseek'),'deepseek');
  assert.equal(normalizeFollowAgent('nope'),'codex');
  assert.equal(normalizeFollowAgent('all'),'codex','the retired all choice migrates to the default');
  assert.deepEqual(FOLLOW_AGENTS,['deepseek','codex','claude']);
  assert.equal(normalizeFollowAgent(undefined,'codex'),'codex');
});

test('following one agent hides the others from the aggregate state',()=>{
  const sessions:SessionActivities={
    'codex-1':working('codex-1','d:/one'),
    'claude-code:x':working('claude-code:x','d:/two'),
    'deepseek-harness:x':working('deepseek-harness:x','d:/three'),
  };
  const codex=dominantActivity(visibleSessions(sessions,'codex'));
  assert.equal(codex.workingProjectCount,1);assert.equal(codex.sessionId,'codex-1');
  const claude=dominantActivity(visibleSessions(sessions,'claude'));
  assert.equal(claude.workingProjectCount,1);assert.equal(claude.sessionId,'claude-code:x');
  const deepseek=dominantActivity(visibleSessions(sessions,'deepseek'));
  assert.equal(deepseek.workingProjectCount,1);assert.equal(deepseek.sessionId,'deepseek-harness:x');
  assert.equal(Object.keys(sessions).length,3,'the stored sessions are not modified');
});
