import assert from "node:assert/strict";
import test from "node:test";
import { dominantActivity, shouldIgnoreHookQuestion, updateSessionActivities, type SessionActivities } from "./activity.ts";
import {projectIdentity} from './activity.ts';
import type { PetEvent, PetEventType } from "./types";

function event(type: PetEventType, turnId = "turn-1", sessionId = "session-1"): PetEvent {
  return { id: `${type}-${turnId}`, source: "hook", type, sessionId, turnId,
    createdAt: "2026-09-25T12:00:00.000Z", read: false };
}

test("question remains visible after Stop and resumes on next user prompt", () => {
  let sessions: SessionActivities = {};
  const now = Date.parse("2026-09-25T12:00:00.000Z");
  sessions = updateSessionActivities(sessions, event("work_started"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("needs_input"), now);
  sessions = updateSessionActivities(sessions, event("work_progress"), now);
  sessions = updateSessionActivities(sessions, event("turn_ended"), now);
  assert.equal(dominantActivity(sessions).phase, "asking");
  sessions = updateSessionActivities(sessions, event("work_started", "turn-2"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("turn_ended", "turn-1"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("turn_ended", "turn-2"), now);
  assert.equal(dominantActivity(sessions).phase, "idle");
});

test("permission resumes after a tool proceeds and unrelated sessions stay independent", () => {
  const now = Date.parse("2026-09-25T12:00:00.000Z");
  let sessions = updateSessionActivities({}, event("approval_needed"), now);
  assert.equal(dominantActivity(sessions).phase, "asking");
  sessions = updateSessionActivities(sessions, event("work_progress"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("needs_input", "turn-x", "session-2"), now);
  assert.equal(dominantActivity(sessions).phase, "asking");
  sessions = updateSessionActivities(sessions, event("interrupted", "turn-x", "session-2"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
});

test('finished turn cannot be resurrected by delayed tool progress or duplicate start',()=>{
 let s=updateSessionActivities({},event('work_started'));
 for(const ending of ['turn_ended','interrupted','task_complete'] as const){
  s=updateSessionActivities(s,event(ending));
  s=updateSessionActivities(s,event('work_progress'));
  s=updateSessionActivities(s,event('work_started'));
  assert.equal(dominantActivity(s).phase,'idle');
 }
 s=updateSessionActivities(s,event('work_started','turn-2'));
 s=updateSessionActivities(s,event('turn_ended','turn-1'));
 assert.equal(dominantActivity(s).phase,'working');
});

test('full power counts canonical directories, not session names or basenames',()=>{
 const start=(id:string,path:string)=>({...event('work_started','turn-1',id),projectPath:path});
 let s=updateSessionActivities({},start('a','D:\\Code\\one\\'));
 s=updateSessionActivities(s,start('b','d:/code/ONE'));
 assert.equal(dominantActivity(s).workingProjectCount,1);
 s=updateSessionActivities(s,start('c','E:/Code/one'));
 assert.equal(dominantActivity(s).fullPower,true);
 s=updateSessionActivities(s,event('turn_ended','turn-1','c'));
 assert.equal(dominantActivity(s).fullPower,false);
 s=updateSessionActivities(s,{...start('child','D:/Other'),isSubagent:true});
 assert.equal(dominantActivity(s).workingProjectCount,1);
 assert.equal(projectIdentity('\\\\?\\D:\\Code\\one'), 'd:/code/one');
 assert.equal(projectIdentity('one'),undefined);
});

test('a real long-running task does not expire by elapsed time',()=>{
 const s=updateSessionActivities({},event('work_started'));
 const next=updateSessionActivities(s,event('info'),Date.now()+86400000*10);
 assert.equal(dominantActivity(next).phase,'working');
});

test('earlier native start enriches hook project identity without rewinding activity',()=>{
 const start={...event('work_started'),createdAt:'2026-09-28T00:00:01Z'};
 let s=updateSessionActivities({},start);
 s=updateSessionActivities(s,{...start,source:'codex-log',projectPath:'D:/Code/one',createdAt:'2026-09-28T00:00:00Z'});
 assert.equal(dominantActivity(s).workingProjectCount,1);
 assert.equal(s['session-1'].startedAt,start.createdAt);
});

test('native pause ends a real task even with V41 anonymous work residue and delayed tools',()=>{
 let s=updateSessionActivities({},event('work_started'));
 s.codex={phase:'working',sessionId:'codex',updatedAt:event('info').createdAt};
 s=updateSessionActivities(s,{...event('interrupted'),source:'codex-log'});
 assert.equal(dominantActivity(s).phase,'idle');
 assert.equal(s.codex,undefined);
 for(const type of ['work_started','work_progress','input_resolved'] as const){
  s=updateSessionActivities(s,{...event(type),sessionId:undefined,turnId:undefined});
  assert.equal(dominantActivity(s).phase,'idle');
 }
 s=updateSessionActivities(s,{...event('work_progress'),turnId:undefined});
 assert.equal(dominantActivity(s).phase,'idle');
 s=updateSessionActivities(s,event('work_started','new-turn'));
 assert.equal(dominantActivity(s).phase,'working');
});

test('unattributed progress never starts a task; pausing one project preserves another',()=>{
 let s=updateSessionActivities({},event('work_progress'));
 assert.equal(dominantActivity(s).phase,'idle');
 s=updateSessionActivities(s,{...event('work_started'),projectPath:'D:/A'});
 s=updateSessionActivities(s,{...event('work_started','turn-2','session-2'),projectPath:'D:/B'});
 assert.equal(dominantActivity(s).fullPower,true);
 s=updateSessionActivities(s,event('interrupted'));
 assert.equal(dominantActivity(s).phase,'working');assert.equal(dominantActivity(s).fullPower,false);
 s=updateSessionActivities(s,event('interrupted','turn-2','session-2'));
 assert.equal(dominantActivity(s).phase,'idle');
});

test('a native reply clears a completed question without restarting its terminal turn',()=>{
 let s=updateSessionActivities({},event('work_started'));
 s=updateSessionActivities(s,event('needs_input'));
 s=updateSessionActivities(s,event('turn_ended'));
 assert.equal(dominantActivity(s).phase,'asking');
 s=updateSessionActivities(s,{...event('input_resolved'),source:'codex-log'});
 assert.equal(dominantActivity(s).phase,'idle');assert.equal(s['session-1'].terminal,true);
 s=updateSessionActivities(s,event('work_progress'));
 assert.equal(dominantActivity(s).phase,'idle');
 assert.equal(dominantActivity(updateSessionActivities({},event('input_resolved'))).phase,'idle');
});

test('native turn order survives delayed hook starts and late question hooks',()=>{
 const native=(type:PetEventType,turn:string,time:string)=>({...event(type,turn),source:'codex-log' as const,createdAt:time});
 let s=updateSessionActivities({},native('work_started','new','2026-09-28T00:00:10Z'));
 s=updateSessionActivities(s,{...event('work_started','old'),createdAt:'2026-09-28T00:00:11Z'});
 assert.equal(s['session-1'].turnId,'new');
 s=updateSessionActivities(s,native('needs_input','new','2026-09-28T00:00:12Z'));
 s=updateSessionActivities(s,{...event('work_started','new'),createdAt:'2026-09-28T00:00:13Z'});
 s=updateSessionActivities(s,event('input_resolved','new'));
 assert.equal(dominantActivity(s).phase,'asking');
 s=updateSessionActivities(s,native('input_resolved','new','2026-09-28T00:00:14Z'));
 assert.equal(shouldIgnoreHookQuestion(s,event('needs_input','new')),true);
 s=updateSessionActivities(s,event('needs_input','new'));
 assert.equal(dominantActivity(s).phase,'working');
 s=updateSessionActivities(s,native('turn_ended','new','2026-09-28T00:00:15Z'));
 for(const type of ['work_started','work_progress','needs_input','input_resolved'] as const)s=updateSessionActivities(s,event(type,'new'));
 assert.equal(dominantActivity(s).phase,'idle');
 assert.equal(shouldIgnoreHookQuestion({},event('needs_input')),false);
 assert.equal(shouldIgnoreHookQuestion(s,event('approval_needed','new')),false);
});

test('an actual native start replaces an unseen old hook regardless of receipt timestamp',()=>{
 let s=updateSessionActivities({},{...event('work_started','old'),createdAt:'2026-09-28T00:00:11Z'});
 s=updateSessionActivities(s,{...event('work_started','new'),source:'codex-log',createdAt:'2026-09-28T00:00:10Z'});
 assert.equal(s['session-1'].turnId,'new');assert.equal(dominantActivity(s).phase,'working');
 s=updateSessionActivities(s,{...event('work_started','older-native'),source:'codex-log',createdAt:'2026-09-28T00:00:09Z'});
 assert.equal(s['session-1'].turnId,'new');
});

test('native context directory remains authoritative through delayed matching hooks',()=>{
 let s=updateSessionActivities({},{...event('work_started'),source:'codex-log',projectPath:'D:/Initial'});
 s=updateSessionActivities(s,{...event('work_progress'),source:'codex-log',projectPath:'E:/Current'});
 s=updateSessionActivities(s,{...event('work_progress'),projectPath:'D:/Initial'});
 assert.equal(s['session-1'].projectPath,'e:/current');
 s=updateSessionActivities(s,{...event('work_started'),source:'codex-log',projectPath:'D:/Initial'});
 assert.equal(s['session-1'].projectPath,'e:/current');
});

test('directory identity resolves aliases and preserves distinct POSIX directories',()=>{
 assert.equal(projectIdentity('D:/Example/./Child/../'),projectIdentity('d:\\example'));
 assert.equal(projectIdentity('\\\\server\\share\\dir\\..'),projectIdentity('//SERVER/share'));
 assert.equal(projectIdentity('\\\\?\\UNC\\server\\share\\dir'),projectIdentity('//server/share/dir'));
 assert.equal(projectIdentity('D:/'),'d:/');
 assert.notEqual(projectIdentity('/Example/A'),projectIdentity('/example/A'));
});

test('unattributed hook endings do not stop a native turn and hooks cannot change native subagent identity',()=>{
 let s=updateSessionActivities({},{...event('work_started'),source:'codex-log',isSubagent:true});
 s=updateSessionActivities(s,{...event('work_progress'),isSubagent:false});
 assert.equal(s['session-1'].isSubagent,true);assert.equal(dominantActivity(s).phase,'idle');
 s=updateSessionActivities({}, {...event('work_started'),source:'codex-log',isSubagent:false});
 for(const type of ['turn_ended','interrupted','task_complete'] as const)s=updateSessionActivities(s,{...event(type),turnId:undefined});
 assert.equal(dominantActivity(s).phase,'working');
 s=updateSessionActivities(s,{...event('interrupted'),source:'codex-log'});
 assert.equal(dominantActivity(s).phase,'idle');
});

test('native directory context preserves a pending approval until a tool proceeds',()=>{
 let s=updateSessionActivities({}, {...event('work_started'),source:'codex-log',projectPath:'D:/Initial'});
 s=updateSessionActivities(s,event('approval_needed'));
 s=updateSessionActivities(s,{...event('work_progress'),source:'codex-log',projectPath:'E:/Current'});
 assert.equal(dominantActivity(s).phase,'asking');assert.equal(s['session-1'].waitingFor,'approval');
 assert.equal(s['session-1'].projectPath,'e:/current');
 s=updateSessionActivities(s,event('work_progress'));
 assert.equal(dominantActivity(s).phase,'working');
});
