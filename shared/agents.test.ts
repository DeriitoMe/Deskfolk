import test from 'node:test';
import assert from 'node:assert/strict';
import {eventAgent,follows,normalizeFollowAgent,sessionAgent,visibleSessions} from './agents.ts';
import {dominantActivity,type SessionActivities} from './activity.ts';

const now=new Date().toISOString();
const working=(sessionId:string,projectPath:string)=>({phase:'working' as const,sessionId,projectPath,updatedAt:now});

test('events and sessions are assigned to their agent',()=>{
  assert.equal(eventAgent('claude-code'),'claude');
  for(const source of ['codex-log','hook','mcp'] as const)assert.equal(eventAgent(source),'codex');
  assert.equal(eventAgent('demo'),undefined,'previews belong to no agent');
  assert.equal(sessionAgent('claude-code:abc'),'claude');
  assert.equal(sessionAgent('019a-codex-session'),'codex');
});

test('the follow choice filters presentation, demo is always shown',()=>{
  assert.equal(follows('all','codex'),true);assert.equal(follows('all','claude'),true);
  assert.equal(follows('codex','claude'),false);assert.equal(follows('claude','codex'),false);
  assert.equal(follows('codex',undefined),true);
  assert.equal(normalizeFollowAgent('claude'),'claude');
  assert.equal(normalizeFollowAgent('nope'),'all');
  assert.equal(normalizeFollowAgent(undefined,'codex'),'codex');
});

test('following one agent hides the other from the aggregate state',()=>{
  const sessions:SessionActivities={
    'codex-1':working('codex-1','d:/one'),
    'claude-code:x':working('claude-code:x','d:/two'),
  };
  assert.equal(dominantActivity(visibleSessions(sessions,'all')).fullPower,true,'two projects across agents');
  const codex=dominantActivity(visibleSessions(sessions,'codex'));
  assert.equal(codex.workingProjectCount,1);assert.equal(codex.sessionId,'codex-1');
  const claude=dominantActivity(visibleSessions(sessions,'claude'));
  assert.equal(claude.workingProjectCount,1);assert.equal(claude.sessionId,'claude-code:x');
  assert.equal(Object.keys(sessions).length,2,'the stored sessions are not modified');
});
