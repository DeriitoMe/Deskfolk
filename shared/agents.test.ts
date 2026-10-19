import test from 'node:test';
import assert from 'node:assert/strict';
import {eventAgent,follows,normalizeFollowAgent,sessionAgent,visibleSessions} from './agents.ts';
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
  assert.equal(follows('all','codex'),true);assert.equal(follows('all','claude'),true);
  assert.equal(follows('all','deepseek'),true);assert.equal(follows('deepseek','deepseek'),true);
  assert.equal(follows('deepseek','codex'),false);assert.equal(follows('codex','deepseek'),false);
  assert.equal(follows('claude','deepseek'),false);assert.equal(follows('deepseek','claude'),false);
  assert.equal(follows('codex','claude'),false);assert.equal(follows('claude','codex'),false);
  assert.equal(follows('codex',undefined),true);
  assert.equal(normalizeFollowAgent('claude'),'claude');
  assert.equal(normalizeFollowAgent('deepseek'),'deepseek');
  assert.equal(normalizeFollowAgent('nope'),'all');
  assert.equal(normalizeFollowAgent(undefined,'codex'),'codex');
});

test('following one agent hides the others from the aggregate state',()=>{
  const sessions:SessionActivities={
    'codex-1':working('codex-1','d:/one'),
    'claude-code:x':working('claude-code:x','d:/two'),
    'deepseek-harness:x':working('deepseek-harness:x','d:/three'),
  };
  assert.equal(dominantActivity(visibleSessions(sessions,'all')).workingProjectCount,3,'three projects across agents');
  assert.equal(dominantActivity(visibleSessions(sessions,'all')).fullPower,true);
  const codex=dominantActivity(visibleSessions(sessions,'codex'));
  assert.equal(codex.workingProjectCount,1);assert.equal(codex.sessionId,'codex-1');
  const claude=dominantActivity(visibleSessions(sessions,'claude'));
  assert.equal(claude.workingProjectCount,1);assert.equal(claude.sessionId,'claude-code:x');
  const deepseek=dominantActivity(visibleSessions(sessions,'deepseek'));
  assert.equal(deepseek.workingProjectCount,1);assert.equal(deepseek.sessionId,'deepseek-harness:x');
  assert.equal(Object.keys(sessions).length,3,'the stored sessions are not modified');
});
