import test from 'node:test';import assert from 'node:assert/strict';
import {projectDashboard} from './project-dashboard.ts';
import type {PetEvent,PetPreferences} from './types';
import type {SessionActivities} from './activity.ts';
const preferences:PetPreferences={language:'system',model:'flat-chibi',outfit:'uniform',scale:1,idleDance:true,reducedMotion:false,bubbleSeconds:8,startWithCodex:false,startWithClaudeCode:false,followAgent:'all',doNotDisturb:false,notificationsEnabled:true};
const options={preferences,bridgeReady:true,monitor:{state:'watching' as const,lastPollAt:null,lastEventAt:null,observedSessions:4,discoveryPending:0}};
const time='2026-10-06T00:00:00Z';
const worker=(id:string,projectId?:string)=>({sessionId:id,phase:'working' as const,turnId:id,nativeTurnId:id,projectPath:'D:/Fixture/Shared',projectId,updatedAt:time});
test('sidebar projects sharing a directory remain two; multiple chats per project count once',()=>{const data=projectDashboard({a:worker('a','one'),b:worker('b','two'),c:worker('c','one'),child:{...worker('child','three'),isSubagent:true}},[],options);assert.equal(data.workingProjectCount,2);assert.equal(data.projects.length,2);assert.equal(data.projects.find(p=>p.key==='project:one')?.workingSessionCount,2);});
test('directory fallback dedupes aliases; unknown project workers remain visibly unidentified',()=>{const data=projectDashboard({a:worker('a'),b:{...worker('b'),projectPath:'d:\\fixture\\shared\\'},u:{...worker('u'),projectPath:undefined}},[],options);assert.equal(data.workingProjectCount,1);assert.equal(data.projects.length,2);assert.equal(data.projects.find(p=>p.key.startsWith('unknown:'))?.name,'未归属项目');});
test('asking project does not hide another project still working',()=>{const data=projectDashboard({a:{...worker('a','one'),phase:'asking',waitingFor:'input',pendingInputIds:['question']},b:worker('b','two')},[],options);assert.equal(data.workingProjectCount,1);assert.equal(data.pendingRequestCount,1);assert.equal(data.projects[0].state,'asking');});
test('a newer successful inactive chat supersedes an old pause in the same project',()=>{const sessions:SessionActivities={a:{...worker('a','one'),phase:'idle'},b:{...worker('b','one'),phase:'idle',updatedAt:'2026-10-06T00:01:00Z'}};const e=(id:string,type:'interrupted'|'turn_ended',outcome:'interrupted'|'success'):PetEvent=>({id,sessionId:id,turnId:id,type,outcome,source:'codex-log',createdAt:sessions[id].updatedAt,read:false});const data=projectDashboard(sessions,[e('b','turn_ended','success'),e('a','interrupted','interrupted')],options);assert.equal(data.projects[0].state,'completed');});
test('panel events exclude demo and replay and never expose tool bodies',()=>{const e:PetEvent={id:'a',type:'interrupted',outcome:'failed',source:'codex-log',createdAt:time,read:false,message:'private tool text'};const data=projectDashboard({},[e,{...e,id:'b',source:'demo'},{...e,id:'c',replayed:true}],options);assert.equal(data.recentEvents.length,1);assert.equal(data.recentEvents[0].label,'任务失败');assert(!JSON.stringify(data).includes('private tool text'));});
test('pending request count reflects only unresolved native questions',()=>{const data=projectDashboard({a:{...worker('a','one'),phase:'asking',pendingInputIds:['q1','q2','legacy:input'],pendingApprovalIds:['p1']}},[],options);assert.equal(data.pendingRequestCount,2);assert.equal(data.approvalSupport,'native-questions-only');});
test('terminal outcome remains available after bounded event history is gone',()=>{const data=projectDashboard({a:{...worker('a','one'),phase:'idle',terminalOutcome:'quota_exhausted'}},[],options);assert.equal(data.projects[0].state,'quota_exhausted');});
test('pending counts require individual current native IDs and ignore placeholders, approvals and previews',()=>{
 const data=projectDashboard({
  empty:{...worker('empty','empty'),phase:'asking'},
  legacy:{...worker('legacy','legacy'),phase:'asking',pendingInputIds:['legacy:input'],pendingApprovalIds:['approval'],terminal:true,terminalOutcome:'success'},
  unknown:{...worker('unknown','unknown'),nativeTurnId:undefined,phase:'asking',pendingInputIds:['question']},
  outdated:{...worker('outdated','outdated'),nativeTurnId:'older-turn',phase:'asking',pendingInputIds:['question']},
  native:{...worker('native','native'),phase:'asking',pendingInputIds:['q1','q2','q1'],resolvedInputIds:['q1']},
  child:{...worker('child','child'),isSubagent:true,phase:'asking',pendingInputIds:['child-question']},
  demo:{...worker('demo','demo'),phase:'asking',pendingInputIds:['demo-question']},
 },[],options);
 assert.equal(data.pendingRequestCount,1);
 assert.equal(data.projects.find(p=>p.key==='project:native')?.state,'asking');
 assert.equal(data.projects.find(p=>p.key==='project:legacy')?.state,'completed');
 for(const key of ['empty','unknown','outdated'])assert.equal(data.projects.find(p=>p.key===`project:${key}`)?.state,'idle');
 assert.equal(data.projects.some(p=>p.key==='project:demo'||p.key==='project:child'),false);
});
test('internal native snapshots stay out of recent events and do not imply approval support',()=>{
 const snapshot:PetEvent={id:'snapshot',type:'input_sync',source:'codex-log',sessionId:'a',turnId:'a',nativeTurnTerminal:false,nativePendingInputIds:[],createdAt:time,read:false};
 const approval:PetEvent={...snapshot,id:'approval',type:'approval_needed',source:'hook',nativeApproval:true};
 const data=projectDashboard({a:worker('a')},[snapshot,approval],options);
 assert.equal(data.recentEvents.some(e=>e.id==='snapshot'),false);
 assert.equal(data.approvalSupport,'native-questions-only');assert.equal(data.pendingRequestCount,0);
});
