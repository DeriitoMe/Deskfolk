import test from 'node:test';
import assert from 'node:assert/strict';
import type { PetEvent } from '../shared/types';
import {dominantActivity,shouldDeliverPetEvent,updateSessionActivities,type SessionActivities} from '../shared/activity.ts';
import {sessionPresentationFingerprint,shouldPresentAcceptedEvent} from './event-presentation.ts';

const time=Date.parse('2026-10-06T00:00:00Z');
const event=(type:PetEvent['type'],sessionId='a',turnId='turn-a',extra:Partial<PetEvent>={}):PetEvent=>({
 id:'fixture:'+type+':'+sessionId+':'+turnId,source:'codex-log',type,sessionId,turnId,projectId:'shared-project',
 createdAt:new Date(time).toISOString(),read:false,replayed:false,...extra,
});
const aggregate=(sessions:SessionActivities)=>{const a=dominantActivity(sessions);return JSON.stringify([a.phase,a.sessionId,a.workingProjectCount,a.fullPower]);};
function transition(previous:SessionActivities,e:PetEvent,now=time){
 const next=updateSessionActivities(previous,e,now);
 return {next,present:shouldPresentAcceptedEvent(e,previous,next,aggregate(previous)!==aggregate(next),now)};
}

test('same-project non-dominant termination still delivers feedback while another chat works',()=>{
 let sessions=updateSessionActivities({},event('work_started'));
 sessions=updateSessionActivities(sessions,event('work_started','b','turn-b',{createdAt:new Date(time+1).toISOString()}));
 assert.equal(dominantActivity(sessions).sessionId,'b');
 for(const outcome of ['interrupted','failed','quota_exhausted','success'] as const){
  const terminated=event(outcome==='success'?'turn_ended':'interrupted','a','turn-a',{outcome});
  const {next,present}=transition(sessions,terminated);
  assert.equal(aggregate(next),aggregate(sessions));assert.equal(present,true);
  assert.equal(next.a.terminalOutcome,outcome);assert.equal(next.b.phase,'working');
 }
});

test('all supported live negative terminal event types reach the renderer while another project continues',()=>{
 let sessions=updateSessionActivities({},event('work_started'));
 sessions=updateSessionActivities(sessions,event('work_started','b','turn-b',{projectId:'other-project',createdAt:new Date(time+1).toISOString()}));
 for(const type of ['turn_ended','task_complete','interrupted'] as const){
  for(const outcome of ['interrupted','failed','quota_exhausted'] as const){
   const terminal=event(type,'a','turn-a',{outcome});
   const {next,present}=transition(sessions,terminal);
   assert.equal(present,true);assert.equal(dominantActivity(next).phase,'working');
   assert.equal(shouldDeliverPetEvent(terminal,dominantActivity(next)),true);
  }
 }
});

test('old-turn terminal bookkeeping cannot produce feedback over a newer active turn',()=>{
 let sessions=updateSessionActivities({},event('work_started','a','old'));
 sessions=updateSessionActivities(sessions,event('work_started','a','new',{createdAt:new Date(time+1).toISOString()}));
 for(const outcome of ['interrupted','failed','quota_exhausted','success'] as const){
  const {next,present}=transition(sessions,event(outcome==='success'?'turn_ended':'interrupted','a','old',{outcome}));
  assert.equal(present,false);assert.equal(next.a.turnId,'new');assert.equal(next.a.phase,'working');
  assert.equal(next.a.terminalOutcome,undefined);assert.ok(next.a.endedTurns?.includes('old'));
  assert.equal(sessionPresentationFingerprint(next.a),sessionPresentationFingerprint(sessions.a));
 }
});

test('live delayed terminal evidence is delivered but recent startup replay only reconciles state',()=>{
 const sessions=updateSessionActivities({},event('work_started'));
 for(const outcome of ['interrupted','failed','quota_exhausted','success'] as const){
  const terminal=event(outcome==='success'?'turn_ended':'interrupted','a','turn-a',{outcome,createdAt:new Date(time-86_400_000).toISOString()});
  assert.equal(transition(sessions,terminal).present,true);
  const replay=transition(sessions,{...terminal,createdAt:new Date(time).toISOString(),replayed:true});
  assert.equal(replay.present,false);assert.equal(replay.next.a.terminalOutcome,outcome);
 }
});

test('duplicate terminal feedback is suppressed across native and hook receipts',()=>{
 const sessions=updateSessionActivities({},event('work_started'));
 const terminal=event('interrupted','a','turn-a',{outcome:'interrupted'});
 const first=transition(sessions,terminal);assert.equal(first.present,true);
 const nativeDuplicate=transition(first.next,{...terminal,id:'duplicate',createdAt:new Date(time+1000).toISOString()});
 assert.equal(nativeDuplicate.present,false);
 assert.equal(transition(first.next,{...terminal,id:'hook-duplicate',source:'hook',createdAt:new Date(time+2000).toISOString()}).present,false);
});

test('native verified result following an outcome-free Stop hook remains presentable',()=>{
 const sessions=updateSessionActivities({},event('work_started'));
 const stopped=transition(sessions,event('turn_ended','a','turn-a',{source:'hook',outcome:undefined}));
 assert.equal(stopped.present,true);assert.equal(stopped.next.a.terminalOutcome,undefined);
 const success=transition(stopped.next,event('turn_ended','a','turn-a',{outcome:'success'}));
 assert.equal(success.present,true);assert.equal(success.next.a.terminalOutcome,'success');
 assert.equal(transition(success.next,event('turn_ended','a','turn-a',{outcome:'success'})).present,false);
});

test('subagent and unattributed hook terminals cannot present feedback for native parent work',()=>{
 const sessions=updateSessionActivities({},event('work_started'));
 assert.equal(transition(sessions,event('interrupted','a','turn-a',{isSubagent:true,outcome:'failed'})).present,false);
 assert.equal(transition(sessions,event('interrupted','a',undefined as unknown as string,{source:'hook',turnId:undefined})).present,false);
 const child=updateSessionActivities({},event('work_started','child','child-turn',{isSubagent:true}));
 assert.equal(transition(child,event('interrupted','child','child-turn',{outcome:'failed'})).present,false);
});

test('explicit previews and standalone verified milestones keep their existing presentation',()=>{
 for(const source of ['mcp','demo'] as const){
  const milestone=event('task_complete','a','turn-a',{source,sessionId:undefined,turnId:undefined,outcome:'success'});
  assert.equal(transition({},milestone).present,true);
 }
});

test('request semantic changes are visible without falsely treating receipt metadata as a transition',()=>{
 const started=updateSessionActivities({},event('work_started'));
 const question=event('needs_input','a','turn-a',{nativeQuestion:true,nativeCallId:'question-a'});
 let sessions=updateSessionActivities(started,question);
 sessions=updateSessionActivities(sessions,{...question,id:'another-question',nativeCallId:'question-b'});
 const resolved=event('input_resolved','a','turn-a',{nativeCallId:'question-a'});
 const {next,present}=transition(sessions,resolved);
 assert.equal(next.a.phase,'asking');assert.deepEqual(next.a.pendingInputIds,['question-b']);assert.equal(present,true);
 const metadataOnly={...next.a,updatedAt:new Date(time+1000).toISOString(),endedTurns:['earlier-turn'],lastEventType:'info' as const};
 assert.equal(sessionPresentationFingerprint(next.a),sessionPresentationFingerprint(metadataOnly));
});

test('native pending-ledger snapshots reconcile without presenting a message',()=>{
 const started=updateSessionActivities({},event('work_started'));
 const snapshot=event('input_sync','a','turn-a',{nativePendingInputIds:['question-a'],nativeTurnTerminal:false});
 const {next,present}=transition(started,snapshot);
 assert.equal(next.a.phase,'asking');assert.equal(present,false);
 assert.equal(shouldDeliverPetEvent(snapshot,dominantActivity(next)),false);
});
