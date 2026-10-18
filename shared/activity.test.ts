import assert from "node:assert/strict";
import test from "node:test";
import { dominantActivity, isSuccessfulCompletion, shouldCelebrateCompletion, shouldDeliverPetEvent, shouldIgnoreHookQuestion, shouldPresentLifecycleEvent, successfulCompletionIdentity, updateSessionActivities, type SessionActivities } from "./activity.ts";
import {projectIdentity,sanitizeStoredActivities,shouldDeliverBufferedEvent,isUnconfirmedHookWork} from './activity.ts';
import type { PetEvent, PetEventType } from "./types";

function event(type: PetEventType, turnId = "turn-1", sessionId = "session-1"): PetEvent {
  const input=type==='needs_input'||type==='input_resolved';
  return { id: `${type}-${turnId}`, source: input?'codex-log':'hook', type, sessionId, turnId,
    nativeQuestion:type==='needs_input',nativeCallId:input?'question':undefined,
    createdAt: "2026-09-25T12:00:00.000Z", read: false };
}

test('hook work requires the same turn confirmed by native lifecycle evidence',()=>{
 const hook=event('work_started');
 assert.equal(isUnconfirmedHookWork({},hook),true);
 const hookOnly=updateSessionActivities({},hook);
 assert.equal(isUnconfirmedHookWork(hookOnly,hook),true);
 const native=updateSessionActivities({}, {...hook,source:'codex-log'});
 assert.equal(isUnconfirmedHookWork(native,hook),false);
 assert.equal(isUnconfirmedHookWork(native,event('work_progress','turn-2')),true);
 assert.equal(isUnconfirmedHookWork(native,{...hook,turnId:undefined}),true);
 for(const type of ['turn_ended','interrupted','task_complete'] as const)
  assert.equal(isUnconfirmedHookWork({},event(type)),false);
 assert.equal(isUnconfirmedHookWork({}, {...hook,source:'mcp'}),false);
});

test('an orphan hook cannot hold work open or create an extra working project',()=>{
 let sessions:SessionActivities={};
 const receive=(e:PetEvent)=>{if(!isUnconfirmedHookWork(sessions,e))sessions=updateSessionActivities(sessions,e)};
 receive({...event('work_started','browser-hook','orphan'),projectPath:'D:/Browser'});
 assert.equal(dominantActivity(sessions).phase,'idle');
 receive({...event('work_started','native-turn','real'),source:'codex-log',projectPath:'D:/Real'});
 receive({...event('work_started','browser-hook','orphan'),projectPath:'D:/Browser'});
 assert.equal(dominantActivity(sessions).workingProjectCount,1);
 receive({...event('turn_ended','native-turn','real'),source:'codex-log',outcome:'success'});
 assert.equal(dominantActivity(sessions).phase,'idle');
 receive({...event('work_progress','native-turn','real'),projectPath:'D:/Real'});
 assert.equal(dominantActivity(sessions).phase,'idle');
});

test("question remains visible after Stop and resumes on next user prompt", () => {
  let sessions: SessionActivities = {};
  const now = Date.parse("2026-09-25T12:00:00.000Z");
  sessions = updateSessionActivities(sessions, event("work_started"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("needs_input"), now);
  sessions = updateSessionActivities(sessions, event("work_progress"), now);
  sessions = updateSessionActivities(sessions, event("turn_ended"), now);
  assert.equal(dominantActivity(sessions).phase, "asking");
  sessions = updateSessionActivities(sessions, {...event("work_started", "turn-2"),source:'codex-log'}, now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("turn_ended", "turn-1"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("turn_ended", "turn-2"), now);
  assert.equal(dominantActivity(sessions).phase, "idle");
});

test("generic permission notices leave work running and unrelated native questions stay independent", () => {
  const now = Date.parse("2026-09-25T12:00:00.000Z");
  let sessions = updateSessionActivities({}, event("work_started"), now);
  sessions = updateSessionActivities(sessions, event("approval_needed"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("work_progress"), now);
  assert.equal(dominantActivity(sessions).phase, "working");
  sessions = updateSessionActivities(sessions, event("approval_resolved"), now);
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
 s=updateSessionActivities(s,{...event('input_resolved','new'),source:'hook'});
 assert.equal(dominantActivity(s).phase,'asking');
 s=updateSessionActivities(s,native('input_resolved','new','2026-09-28T00:00:14Z'));
 assert.equal(shouldIgnoreHookQuestion(s,{...event('needs_input','new'),source:'hook'}),true);
 s=updateSessionActivities(s,{...event('needs_input','new'),source:'hook'});
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

test('native directory context preserves a pending question until its own reply arrives',()=>{
 let s=updateSessionActivities({}, {...event('work_started'),source:'codex-log',projectPath:'D:/Initial'});
 s=updateSessionActivities(s,event('needs_input'));
 s=updateSessionActivities(s,{...event('work_progress'),source:'codex-log',projectPath:'E:/Current'});
 assert.equal(dominantActivity(s).phase,'asking');assert.equal(s['session-1'].waitingFor,'input');
 assert.equal(s['session-1'].projectPath,'e:/current');
 s=updateSessionActivities(s,event('work_progress'));
 assert.equal(dominantActivity(s).phase,'asking');
 s=updateSessionActivities(s,event('input_resolved'));
 assert.equal(dominantActivity(s).phase,'working');
});

test('multiple pending native questions require their own exact resolution and ignore permission notices',()=>{
 const native=(type:PetEventType,key:string)=>({...event(type),source:'codex-log' as const,nativeCallId:key});
 let sessions=updateSessionActivities({}, {...event('work_started'),source:'codex-log'});
 for(const key of ['question-a','question-b'])sessions=updateSessionActivities(sessions,native('needs_input',key));
 for(const key of ['approval-a','approval-b'])sessions=updateSessionActivities(sessions,{...event('approval_needed'),nativeCallId:key,nativeApproval:true});
 // Duplicate delivery and unrelated tool progress change no pending requests.
 sessions=updateSessionActivities(sessions,native('needs_input','question-a'));
 sessions=updateSessionActivities(sessions,event('work_progress'));
 sessions=updateSessionActivities(sessions,native('input_resolved','unrelated-question'));
 sessions=updateSessionActivities(sessions,{...event('approval_resolved'),nativeCallId:'unrelated-approval'});
 assert.deepEqual(sessions['session-1'].pendingInputIds,['question-a','question-b']);
 assert.deepEqual(sessions['session-1'].pendingApprovalIds,[]);
 sessions=updateSessionActivities(sessions,native('input_resolved','question-a'));
 assert.equal(sessions['session-1'].waitingFor,'input');
 sessions=updateSessionActivities(sessions,native('input_resolved','question-b'));
 assert.equal(sessions['session-1'].waitingFor,undefined);
 sessions=updateSessionActivities(sessions,{...event('approval_resolved'),nativeCallId:'approval-a'});
 assert.equal(sessions['session-1'].phase,'working');
 sessions=updateSessionActivities(sessions,{...event('approval_resolved'),nativeCallId:'approval-b'});
 assert.equal(sessions['session-1'].phase,'working');
});

test('missing request identity and hook replies cannot dismiss identified pending native questions',()=>{
 let sessions=updateSessionActivities({},event('work_started'));
 sessions=updateSessionActivities(sessions,{...event('needs_input'),nativeCallId:'question'});
 sessions=updateSessionActivities(sessions,{...event('approval_needed'),nativeCallId:'approval'});
 for(const type of ['input_resolved','approval_resolved'] as const)sessions=updateSessionActivities(sessions,{...event(type),nativeCallId:undefined});
 sessions=updateSessionActivities(sessions,{...event('input_resolved'),source:'hook'});
 assert.deepEqual(sessions['session-1'].pendingInputIds,['question']);
 assert.deepEqual(sessions['session-1'].pendingApprovalIds,[]);
 assert.equal(sessions['session-1'].phase,'asking');
});

test('duplicate starts and delayed resolved question notices cannot rewind the same turn',()=>{
 let sessions=updateSessionActivities({},event('work_started'));
 sessions=updateSessionActivities(sessions,{...event('needs_input'),nativeCallId:'question'});
 sessions=updateSessionActivities(sessions,event('work_started'));
 assert.equal(sessions['session-1'].phase,'asking');
 sessions=updateSessionActivities(sessions,{...event('input_resolved'),nativeCallId:'question'});
 sessions=updateSessionActivities(sessions,{...event('needs_input'),nativeCallId:'question'});
 assert.equal(sessions['session-1'].phase,'working');
 sessions=updateSessionActivities(sessions,{...event('work_started','next'),source:'codex-log'});
 sessions=updateSessionActivities(sessions,{...event('needs_input','next'),nativeCallId:'question'});
 assert.equal(sessions['session-1'].phase,'asking');
});

test('terminal outcome clears approvals, success preserves unanswered input and replies stay terminal',()=>{
 for(const outcome of ['success','failed','quota_exhausted','interrupted'] as const){
  let sessions=updateSessionActivities({},event('work_started'));
  sessions=updateSessionActivities(sessions,{...event('needs_input'),nativeCallId:'question'});
  sessions=updateSessionActivities(sessions,{...event('approval_needed'),nativeCallId:'approval'});
  sessions=updateSessionActivities(sessions,{...event('turn_ended'),outcome});
  assert.deepEqual(sessions['session-1'].pendingApprovalIds,[]);
  assert.equal(sessions['session-1'].phase,outcome==='success'?'asking':'idle');
  sessions=updateSessionActivities(sessions,{...event('input_resolved'),nativeCallId:'question'});
  sessions=updateSessionActivities(sessions,event('work_progress'));
  assert.equal(sessions['session-1'].phase,'idle');
  assert.equal(sessions['session-1'].terminal,true);
 }
});

test('buffer flush delivers only the individual native question that is still pending',()=>{
 let sessions=updateSessionActivities({},event('work_started'));
 const question={...event('needs_input'),nativeCallId:'question',nativeQuestion:true};
 const approval={...event('approval_needed'),nativeCallId:'approval',nativeApproval:true};
 const otherQuestion={...question,nativeCallId:'other-question'};
 sessions=updateSessionActivities(sessions,question);sessions=updateSessionActivities(sessions,otherQuestion);sessions=updateSessionActivities(sessions,approval);
 sessions=updateSessionActivities(sessions,{...event('input_resolved'),nativeCallId:'question'});
 assert.equal(shouldDeliverBufferedEvent(sessions,question),false);
 assert.equal(shouldDeliverBufferedEvent(sessions,approval),false);
 assert.equal(shouldDeliverBufferedEvent(sessions,otherQuestion),true);
});

test('verified success settles residual approval and persistent terminal outcome survives request cleanup',()=>{
 let sessions=updateSessionActivities({},event('work_started'));
 sessions=updateSessionActivities(sessions,{...event('approval_needed'),nativeCallId:'approval'});
 const success={...event('turn_ended'),source:'codex-log' as const,outcome:'success' as const};
 assert.equal(shouldCelebrateCompletion(sessions,success),true);
 sessions=updateSessionActivities(sessions,success);
 assert.equal(sessions['session-1'].phase,'idle');assert.equal(sessions['session-1'].terminalOutcome,'success');
 sessions=updateSessionActivities(sessions,{...event('approval_resolved'),nativeCallId:'approval'});
 assert.equal(sessions['session-1'].terminalOutcome,'success');
 sessions=updateSessionActivities(sessions,{...event('work_started','next'),source:'codex-log'});
 assert.equal(sessions['session-1'].terminalOutcome,undefined);
 sessions=updateSessionActivities(sessions,{...event('interrupted','next'),source:'codex-log',outcome:'quota_exhausted'});
 assert.equal(sessions['session-1'].terminalOutcome,'quota_exhausted');
 assert.equal(sessions['session-1'].lastEventType,'interrupted');
 sessions=updateSessionActivities(sessions,event('work_progress','next'));
 assert.equal(sessions['session-1'].terminalOutcome,'quota_exhausted');
 assert.equal(sessions['session-1'].lastEventType,'interrupted');
});

test('confirmed completion is delivered while another project works or awaits input',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started','a','a'),projectPath:'D:/Project-A'});
 sessions=updateSessionActivities(sessions,{...event('work_started','b','b'),projectPath:'E:/Project-B'});
 const success={...event('turn_ended','a','a'),source:'codex-log' as const,outcome:'success' as const,replayed:false};
 sessions=updateSessionActivities(sessions,success);
 assert.equal(dominantActivity(sessions).phase,'working');
 assert.equal(shouldDeliverPetEvent(success,dominantActivity(sessions)),true);
 sessions=updateSessionActivities(sessions,event('needs_input','b','b'));
 assert.equal(shouldDeliverPetEvent(success,dominantActivity(sessions)),true);
 assert.equal(shouldDeliverPetEvent(event('turn_ended','a','a'),dominantActivity(sessions)),false);
 assert.equal(dominantActivity(sessions).phase,'asking');
});

test('successful native completion survives hook Stop and an unchanged aggregate',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started','a','a'),source:'codex-log',projectPath:'D:/Project-A'});
 sessions=updateSessionActivities(sessions,{...event('work_started','b','b'),source:'codex-log',projectPath:'D:/Project-A',createdAt:'2026-09-25T12:00:01.000Z'});
 // Both chats work in one project, so ending a does not change the project count.
 const before=dominantActivity(sessions);
 sessions=updateSessionActivities(sessions,event('turn_ended','a','a'));
 const success={...event('turn_ended','a','a'),source:'codex-log' as const,outcome:'success' as const,replayed:false};
 sessions=updateSessionActivities(sessions,success);
 const after=dominantActivity(sessions);
 assert.deepEqual([after.phase,after.sessionId,after.workingProjectCount,after.fullPower],
  [before.phase,before.sessionId,before.workingProjectCount,before.fullPower]);
 assert.equal(shouldPresentLifecycleEvent(success,false,Date.parse(success.createdAt)+86_400_000),true);
 assert.equal(shouldDeliverPetEvent(success,after),true);
 assert.equal(shouldPresentLifecycleEvent({...success,replayed:true},true,Date.parse(success.createdAt)),false);
});

test('only verified whole-task success qualifies and completion identity spans native and MCP notices',()=>{
 for(const type of ['stage_complete','turn_ended','interrupted','task_complete'] as const){
  assert.equal(isSuccessfulCompletion(event(type)),false);
 }
 const native={...event('turn_ended'),source:'codex-log' as const,outcome:'success' as const,projectPath:'D:\\Project\\'};
 assert.equal(isSuccessfulCompletion(native),true);
 for(const outcome of ['interrupted','failed','quota_exhausted'] as const)assert.equal(isSuccessfulCompletion({...native,outcome}),false);
 assert.equal(isSuccessfulCompletion({...native,replayed:true}),false);
 assert.equal(isSuccessfulCompletion({...native,isSubagent:true}),false);
 assert.equal(isSuccessfulCompletion({...native,type:'stage_complete'}),false);
 const mcp={...native,type:'task_complete' as const,source:'mcp' as const,id:'another-event',projectPath:'d:/project'};
 assert.equal(successfulCompletionIdentity(native),successfulCompletionIdentity(mcp));
 assert.notEqual(successfulCompletionIdentity(native),successfulCompletionIdentity({...mcp,turnId:'next-turn'}));
 assert.notEqual(successfulCompletionIdentity(native),successfulCompletionIdentity({...mcp,sessionId:'another-session'}));
});

test('a fresh native question call reaches the renderer while the session is already asking',()=>{
 const question={...event('needs_input'),source:'codex-log' as const,nativeQuestion:true,nativeCallId:'new-call',replayed:false};
 assert.equal(shouldPresentLifecycleEvent(question,false,Date.parse(question.createdAt)+86_400_000),true);
 assert.equal(shouldPresentLifecycleEvent({...question,replayed:true},false,Date.parse(question.createdAt)),false);
 assert.equal(shouldPresentLifecycleEvent({...question,nativeCallId:undefined},false,Date.parse(question.createdAt)),false);
});

test('clean completion of its own pending question turn preserves input and cannot celebrate',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started'),source:'codex-log'});
 sessions=updateSessionActivities(sessions,{...event('needs_input'),source:'codex-log',nativeQuestion:true,nativeCallId:'pending-call'});
 for(const type of ['turn_ended','task_complete'] as const){
  const completion={...event(type),source:'codex-log' as const,outcome:'success' as const};
  assert.equal(shouldCelebrateCompletion(sessions,completion),false);
  sessions=updateSessionActivities(sessions,completion);
  assert.equal(sessions['session-1'].phase,'asking');
  assert.equal(sessions['session-1'].waitingFor,'input');
  assert.equal(sessions['session-1'].terminal,true);
 }
 sessions=updateSessionActivities(sessions,{...event('interrupted'),source:'codex-log',outcome:'interrupted'});
 assert.equal(sessions['session-1'].phase,'idle');assert.equal(sessions['session-1'].waitingFor,undefined);
});

test('pending input in another session or a newer turn cannot suppress genuine completion',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started','waiting-turn','waiting'),source:'codex-log'});
 sessions=updateSessionActivities(sessions,{...event('needs_input','waiting-turn','waiting'),source:'codex-log',nativeQuestion:true});
 const otherProject={...event('turn_ended','complete-turn','complete'),source:'codex-log' as const,outcome:'success' as const};
 assert.equal(dominantActivity(sessions).phase,'asking');
 assert.equal(shouldCelebrateCompletion(sessions,otherProject),true);
 assert.equal(shouldCelebrateCompletion(sessions,{...otherProject,sessionId:'waiting',turnId:'older-turn'}),true);
 sessions=updateSessionActivities(sessions,otherProject);
 assert.equal(dominantActivity(sessions).phase,'asking');
 assert.equal(sessions.waiting.waitingFor,'input');
});

test('failed task completion still clears its pending input',()=>{
 for(const outcome of ['failed','quota_exhausted','interrupted'] as const){
  let sessions=updateSessionActivities({},event('needs_input'));
  const completion={...event('task_complete'),outcome};
  assert.equal(shouldCelebrateCompletion(sessions,completion),false);
  sessions=updateSessionActivities(sessions,completion);
  assert.equal(sessions['session-1'].phase,'idle');assert.equal(sessions['session-1'].waitingFor,undefined);
 }
});

test('different sidebar project IDs in one directory enter full power and stopping one restores normal work',()=>{
 const start=(sessionId:string,projectId:string)=>({...event('work_started','turn-1',sessionId),
  source:'codex-log' as const,projectPath:'D:/CodexProjects',projectId});
 let sessions=updateSessionActivities({},start('a','project-a'));
 sessions=updateSessionActivities(sessions,start('b','project-b'));
 assert.equal(dominantActivity(sessions).workingProjectCount,2);
 assert.equal(dominantActivity(sessions).fullPower,true);
 sessions=updateSessionActivities(sessions,{...event('interrupted','turn-1','b'),source:'codex-log'});
 assert.equal(dominantActivity(sessions).phase,'working');
 assert.equal(dominantActivity(sessions).workingProjectCount,1);
 assert.equal(dominantActivity(sessions).fullPower,false);
});

test('multiple chats with the same sidebar project ID count once even after a project rename or directory change',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started','turn-a','a'),source:'codex-log',
  projectId:'stable-project',project:'Original name',projectPath:'D:/Original'});
 sessions=updateSessionActivities(sessions,{...event('work_started','turn-b','b'),source:'codex-log',
  projectId:'stable-project',project:'Renamed project',projectPath:'E:/Moved'});
 assert.equal(dominantActivity(sessions).workingProjectCount,1);
 assert.equal(dominantActivity(sessions).fullPower,false);
 sessions=updateSessionActivities(sessions,{...event('work_started','turn-c','child'),source:'codex-log',
  projectId:'other-project',projectPath:'F:/Child',isSubagent:true});
 assert.equal(dominantActivity(sessions).workingProjectCount,1);
});

test('unassigned sessions retain directory fallback without confusing project IDs with directory identities',()=>{
 const start=(sessionId:string,path?:string,projectId?:string)=>({...event('work_started','turn-1',sessionId),
  source:'codex-log' as const,projectPath:path,projectId});
 let sessions=updateSessionActivities({},start('a','D:/Shared'));
 sessions=updateSessionActivities(sessions,start('b','d:\\shared\\'));
 sessions=updateSessionActivities(sessions,start('unknown'));
 assert.equal(dominantActivity(sessions).workingProjectCount,1);
 sessions=updateSessionActivities(sessions,start('c','D:/Shared','d:/shared'));
 assert.equal(dominantActivity(sessions).workingProjectCount,2);
 assert.equal(dominantActivity(sessions).fullPower,true);
});

test('native sidebar assignment remains authoritative through delayed matching hooks and replayed starts',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started'),source:'codex-log',
  projectId:'original',projectPath:'D:/Shared'});
 sessions=updateSessionActivities(sessions,{...event('work_progress'),source:'codex-log',projectId:'current'});
 sessions=updateSessionActivities(sessions,{...event('work_progress'),projectId:'late-hook'});
 sessions=updateSessionActivities(sessions,{...event('work_started'),source:'codex-log',projectId:'original'});
 assert.equal(sessions['session-1'].projectId,'current');
 assert.equal(sessions['session-1'].nativeProjectIdConfirmed,true);
 assert.equal(sessions['session-1'].phase,'working');
});

test('matching native context explicitly clears an assignment and omitted metadata preserves it',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started'),source:'codex-log',
  projectId:'assigned',projectPath:'D:/Fallback'});
 sessions=updateSessionActivities(sessions,{...event('work_progress'),source:'codex-log'});
 assert.equal(sessions['session-1'].projectId,'assigned');
 sessions=updateSessionActivities(sessions,{...event('work_progress'),source:'codex-log',projectId:undefined});
 assert.equal(sessions['session-1'].projectId,undefined);
 assert.equal(sessions['session-1'].nativeProjectIdConfirmed,true);
 sessions=updateSessionActivities(sessions,{...event('work_progress'),projectId:'late-hook'});
 sessions=updateSessionActivities(sessions,{...event('work_started'),source:'codex-log',projectId:'assigned'});
 assert.equal(sessions['session-1'].projectId,undefined);
 assert.equal(dominantActivity(sessions).workingProjectCount,1);
});

test('native context cannot change a different turn and old terminal metadata cannot change current project identity',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started','new'),source:'codex-log',projectId:'current'});
 sessions=updateSessionActivities(sessions,{...event('work_progress','old'),source:'codex-log',projectId:'old'});
 sessions=updateSessionActivities(sessions,{...event('turn_ended','old'),source:'codex-log',projectId:'old'});
 assert.equal(sessions['session-1'].projectId,'current');
 assert.equal(sessions['session-1'].turnId,'new');
 assert.equal(sessions['session-1'].phase,'working');
});

test('native assignment reconciliation preserves pending questions and terminal activity',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started'),source:'codex-log',projectId:'first'});
 sessions=updateSessionActivities(sessions,{...event('needs_input'),source:'codex-log'});
 sessions=updateSessionActivities(sessions,{...event('work_progress'),source:'codex-log',projectId:'second'});
 assert.equal(sessions['session-1'].phase,'asking');
 assert.equal(sessions['session-1'].waitingFor,'input');
 assert.equal(sessions['session-1'].projectId,'second');
 sessions=updateSessionActivities(sessions,{...event('interrupted'),source:'codex-log'});
 sessions=updateSessionActivities(sessions,{...event('work_progress'),source:'codex-log',projectId:undefined});
 assert.equal(sessions['session-1'].phase,'idle');
 assert.equal(sessions['session-1'].terminal,true);
 assert.equal(sessions['session-1'].projectId,undefined);
 assert.equal(dominantActivity(sessions).workingProjectCount,0);
});

test('a new native turn adopts its current assignment including an explicit removal',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started','old'),source:'codex-log',projectId:'old-project'});
 sessions=updateSessionActivities(sessions,{...event('work_started','new'),source:'codex-log',projectId:'new-project'});
 assert.equal(sessions['session-1'].projectId,'new-project');
 sessions=updateSessionActivities(sessions,{...event('work_started','next'),source:'codex-log',projectId:undefined});
 assert.equal(sessions['session-1'].projectId,undefined);
 assert.equal(sessions['session-1'].nativeProjectIdConfirmed,true);
});

test('unconfirmed input and every generic permission event leave task state unchanged',()=>{
 const working=updateSessionActivities({},event('work_started'));
 const question=event('needs_input');
 for(const candidate of [
  {...question,source:'hook' as const}, {...question,source:'mcp' as const},
  {...question,nativeQuestion:false}, {...question,questionId:'pet-question'},
  {...question,sessionId:undefined}, {...question,turnId:undefined},
  {...question,nativeCallId:undefined}, {...question,nativeCallId:'legacy:input'},
  {...question,isSubagent:true},
  ...(['hook','mcp','codex-log'] as const).map(source=>({...question,type:'approval_needed' as const,source,nativeApproval:true})),
 ]){
  assert.deepEqual(updateSessionActivities(working,candidate),working);
  assert.equal(shouldDeliverBufferedEvent(working,candidate),false);
  assert.equal(shouldDeliverPetEvent(candidate,dominantActivity(working)),false);
 }
});

test('demo notifications preview visuals without creating or changing real activities',()=>{
 const working=updateSessionActivities({},event('work_started'));
 for(const type of ['needs_input','approval_needed','work_started','turn_ended','interrupted'] as const){
  assert.deepEqual(updateSessionActivities(working,{...event(type),source:'demo'}),working);
  assert.deepEqual(updateSessionActivities({}, {...event(type),source:'demo'}),{});
 }
 assert.equal(dominantActivity({demo:{sessionId:'demo',phase:'working',projectPath:'D:/Demo',updatedAt:event('info').createdAt}}).phase,'idle');
});

test('stored request migration removes placeholders and approvals while preserving project metadata',()=>{
 const time=event('info').createdAt;
 const previous:SessionActivities={
  old:{sessionId:'old',turnId:'turn-old',phase:'asking',waitingFor:'input',pendingInputIds:['legacy:input'],terminal:true,terminalOutcome:'success',projectId:'project-old',projectPath:'D:/Old',updatedAt:time},
  unknown:{sessionId:'unknown',turnId:'unknown-turn',phase:'asking',pendingInputIds:['unproven-question'],updatedAt:time},
  approval:{sessionId:'approval',turnId:'approval-turn',nativeTurnId:'approval-turn',phase:'asking',waitingFor:'approval',pendingApprovalIds:['call-approval'],updatedAt:time},
  real:{sessionId:'real',turnId:'native-turn',nativeTurnId:'native-turn',phase:'asking',waitingFor:'input',pendingInputIds:['native-question','legacy:input','native-question','resolved-question'],resolvedInputIds:['resolved-question'],terminal:true,terminalOutcome:'success',projectId:'real-project',updatedAt:time},
 };
 const before=structuredClone(previous),clean=sanitizeStoredActivities(previous);
 assert.deepEqual(previous,before);
 for(const id of ['old','unknown','approval']){
  assert.equal(clean[id].phase,'idle');assert.equal(clean[id].waitingFor,undefined);
  assert.deepEqual(clean[id].pendingInputIds,[]);assert.deepEqual(clean[id].pendingApprovalIds,[]);
 }
 assert.equal(clean.old.projectId,'project-old');assert.equal(clean.old.projectPath,'D:/Old');
 assert.equal(clean.old.terminal,true);assert.equal(clean.old.terminalOutcome,'success');
 assert.equal(clean.unknown.terminal,undefined);
 assert.deepEqual(clean.real.pendingInputIds,['native-question']);assert.equal(clean.real.phase,'asking');
});

test('resolved native input cannot be revived by a delayed question or buffered reminder',()=>{
 let sessions=updateSessionActivities({},event('work_started'));
 const question=event('needs_input');
 sessions=updateSessionActivities(sessions,event('input_resolved'));
 sessions=updateSessionActivities(sessions,question);
 assert.equal(sessions['session-1'].phase,'working');
 assert.deepEqual(sessions['session-1'].pendingInputIds,[]);
 assert.equal(shouldDeliverBufferedEvent(sessions,question),false);
});

test('live and buffered delivery reject old turns, missing pending IDs and subagent sessions',()=>{
 const question=event('needs_input');
 let sessions=updateSessionActivities({},question);
 assert.equal(shouldDeliverBufferedEvent(sessions,question),true);
 assert.equal(shouldDeliverBufferedEvent(sessions,{...question,nativeCallId:'absent'}),false);
 assert.equal(shouldDeliverBufferedEvent(sessions,{...question,turnId:'older-turn'}),false);
 assert.equal(shouldDeliverBufferedEvent(sessions,{...question,sessionId:'absent'}),false);
 assert.equal(shouldDeliverBufferedEvent({...sessions,'session-1':{...sessions['session-1'],isSubagent:true}},question),false);
 sessions=updateSessionActivities(sessions,{...event('work_started','next'),source:'codex-log'});
 assert.equal(shouldDeliverBufferedEvent(sessions,question),false);
});

const inputSnapshot=(ids:string[],terminal:boolean,extra:Partial<PetEvent>={}):PetEvent=>({
 ...event('input_sync'),source:'codex-log',nativePendingInputIds:ids,nativeTurnTerminal:terminal,...extra,
});

test('native snapshots restore real work and completed turns without pending questions',()=>{
 let sessions=updateSessionActivities({},inputSnapshot([],false));
 assert.equal(sessions['session-1'].phase,'working');assert.equal(sessions['session-1'].nativeTurnId,'turn-1');
 const completed=inputSnapshot([],true,{outcome:'success'});
 sessions=updateSessionActivities(sessions,completed);
 assert.equal(sessions['session-1'].phase,'idle');assert.equal(sessions['session-1'].terminalOutcome,'success');
 assert.equal(shouldCelebrateCompletion(sessions,completed),false);
 assert.equal(shouldPresentLifecycleEvent(completed,true,Date.parse(completed.createdAt)),false);
 assert.equal(shouldDeliverPetEvent(completed,dominantActivity(sessions)),false);
 assert.equal(shouldDeliverBufferedEvent(sessions,completed),false);
});

test('native snapshots preserve actual unanswered questions after a successful turn',()=>{
 let sessions=updateSessionActivities({},inputSnapshot(['q1','q2','legacy:input'],true,{outcome:'success'}));
 assert.equal(sessions['session-1'].phase,'asking');assert.equal(sessions['session-1'].terminal,true);
 assert.deepEqual(sessions['session-1'].pendingInputIds,['q1','q2']);
 sessions=updateSessionActivities(sessions,{...event('input_resolved'),nativeCallId:'q1'});
 assert.deepEqual(sessions['session-1'].pendingInputIds,['q2']);assert.equal(sessions['session-1'].phase,'asking');
 sessions=updateSessionActivities(sessions,{...event('input_resolved'),nativeCallId:'q2'});
 assert.equal(sessions['session-1'].phase,'idle');assert.equal(sessions['session-1'].terminal,true);
});

test('native snapshots clear answered cached requests and prevent their late notices from reviving them',()=>{
 let sessions=updateSessionActivities({},event('needs_input'));
 sessions=updateSessionActivities(sessions,inputSnapshot([],false));
 assert.equal(sessions['session-1'].phase,'working');assert.deepEqual(sessions['session-1'].pendingInputIds,[]);
 sessions=updateSessionActivities(sessions,event('needs_input'));
 assert.equal(sessions['session-1'].phase,'working');
 sessions=updateSessionActivities(sessions,inputSnapshot(['question'],true,{outcome:'success'}));
 assert.equal(sessions['session-1'].phase,'asking');assert.deepEqual(sessions['session-1'].resolvedInputIds,[]);
});

test('native snapshots reject older turns and unconfirmed producers and recover an unassigned stored turn',()=>{
 const working=updateSessionActivities({}, {...event('work_started','new'),source:'codex-log'});
 for(const snapshot of [inputSnapshot(['old'],true),inputSnapshot([],false,{source:'mcp',turnId:'new'}),inputSnapshot([],false,{turnId:undefined}),inputSnapshot([],false,{nativeTurnTerminal:undefined}),inputSnapshot([],false,{nativePendingInputIds:undefined})])
  assert.deepEqual(updateSessionActivities(working,snapshot),working);
 const unknown:SessionActivities={'session-1':{sessionId:'session-1',phase:'idle',projectId:'preserved',updatedAt:event('info').createdAt}};
 const restored=updateSessionActivities(unknown,inputSnapshot([],false));
 assert.equal(restored['session-1'].phase,'working');assert.equal(restored['session-1'].projectId,'preserved');
 assert.equal(restored['session-1'].turnId,'turn-1');
});

const harnessEvent=(type:PetEventType,turnId='turn-1',extra:Partial<PetEvent>={}):PetEvent=>({
 ...event(type,turnId,'deepseek-harness:session-1'),source:'deepseek-harness',projectPath:'D:/Harness',...extra,
});

test('Harness native work, requests and completion keep distinct host/session identities',()=>{
 let sessions=updateSessionActivities({}, {...event('work_started'),source:'codex-log',projectPath:'D:/Codex'});
 const start=harnessEvent('work_started');
 sessions=updateSessionActivities(sessions,start);
 assert.equal(sessions[start.sessionId!].nativeTurnId,start.turnId);
 assert.equal(dominantActivity(sessions).workingProjectCount,2);
 const question=harnessEvent('needs_input');
 sessions=updateSessionActivities(sessions,question);
 assert.equal(sessions[start.sessionId!].phase,'asking');
 assert.equal(shouldDeliverBufferedEvent(sessions,question),true);
 sessions=updateSessionActivities(sessions,harnessEvent('input_resolved'));
 sessions=updateSessionActivities(sessions,question);
 assert.equal(sessions[start.sessionId!].phase,'working','delayed answered question cannot revive a prompt');
 assert.equal(shouldDeliverBufferedEvent(sessions,question),false);
 const completed=harnessEvent('turn_ended','turn-1',{outcome:'success'});
 assert.equal(shouldCelebrateCompletion(sessions,completed),true);
 sessions=updateSessionActivities(sessions,completed);
 assert.equal(sessions[start.sessionId!].phase,'idle');
 assert.equal(sessions['session-1'].phase,'working','the Codex task still runs');
});

test('Harness replay snapshots reconcile pending input after restart without replaying notices',()=>{
 const start=harnessEvent('work_started','active',{replayed:true});
 let sessions=updateSessionActivities({},start);
 const pending=harnessEvent('input_sync','active',{replayed:true,nativePendingInputIds:['q1','q2'],nativeTurnTerminal:false});
 sessions=updateSessionActivities(sessions,pending);
 assert.equal(sessions[start.sessionId!].phase,'asking');
 assert.deepEqual(sessions[start.sessionId!].pendingInputIds,['q1','q2']);
 assert.equal(shouldPresentLifecycleEvent(start,true,Date.parse(start.createdAt)),false,'a freshly delivered restart snapshot stays silent');
 assert.equal(shouldPresentLifecycleEvent(pending,true,Date.parse(pending.createdAt)),false);
 assert.equal(shouldDeliverPetEvent(pending,dominantActivity(sessions)),false);
 sessions=sanitizeStoredActivities(sessions);
 assert.equal(sessions[start.sessionId!].phase,'asking','stored native IDs survive migration');
 sessions=updateSessionActivities(sessions,{...pending,nativePendingInputIds:[],nativeTurnTerminal:true,outcome:'success'});
 assert.equal(sessions[start.sessionId!].phase,'idle');
 const late=harnessEvent('needs_input','active',{nativeCallId:'q1'});
 sessions=updateSessionActivities(sessions,late);
 assert.equal(sessions[start.sessionId!].phase,'idle');
 assert.equal(shouldDeliverBufferedEvent(sessions,late),false);
});

test('Harness old-turn snapshots and completions cannot stop a newer native turn',()=>{
 const old=harnessEvent('work_started','old');
 let sessions=updateSessionActivities({},old);
 sessions=updateSessionActivities(sessions,harnessEvent('work_started','new',{createdAt:'2026-09-25T12:00:01.000Z'}));
 const newer=sessions;
 sessions=updateSessionActivities(sessions,harnessEvent('input_sync','old',{nativePendingInputIds:['old-call'],nativeTurnTerminal:false}));
 assert.deepEqual(sessions,newer);
 sessions=updateSessionActivities(sessions,harnessEvent('turn_ended','old',{outcome:'success'}));
 assert.equal(sessions[old.sessionId!].turnId,'new');
 assert.equal(sessions[old.sessionId!].phase,'working');
 for(const patch of [{nativePendingInputIds:undefined},{nativeTurnTerminal:undefined},{isSubagent:true}]){
  const invalid=harnessEvent('input_sync','new',{nativePendingInputIds:[],nativeTurnTerminal:false,...patch});
  assert.deepEqual(updateSessionActivities(sessions,invalid),sessions);
 }
});
