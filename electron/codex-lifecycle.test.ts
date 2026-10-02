import test from 'node:test';import assert from 'node:assert/strict';
import {lifecycleEvent,CodexLifecycleObserver} from './codex-lifecycle.ts';
import {mkdtemp,mkdir,writeFile,appendFile,utimes,rm} from 'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import {dominantActivity,updateSessionActivities,type SessionActivities} from '../shared/activity.ts';
test('verified normal completion, stop, failure and quota records carry distinct outcomes',()=>{
 for(const [payload,expect,outcome] of [
  [{type:'task_complete',turn_id:'t'},'turn_ended','success'],
  [{type:'turn_aborted',turn_id:'t',reason:'interrupted'},'interrupted','interrupted'],
  [{type:'task_complete',turn_id:'t',error:{codex_error_info:'usage_limit_exceeded'}},'interrupted','quota_exhausted'],
  [{type:'task_complete',turn_id:'t',error:{codex_error_info:'server_error'}},'interrupted','failed'],
 ] as const){
  const e=lifecycleEvent({type:'event_msg',timestamp:'2026-09-27T11:25:16.970Z',payload},'s','D:/Code/one');
  assert.equal(e?.type,expect);assert.equal(e?.turnId,'t');assert.equal(e?.outcome,outcome);
 }
 assert.equal(lifecycleEvent({type:'response_item',payload:{type:'task_complete',turn_id:'t'}},'s'),null);
});

test('initial completed turns are replayed while delayed appended success is live',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-success-replay-')),id='00000000-0000-4000-8000-000000000001';
 const file=join(root,`rollout-${id}.jsonl`),events:any[]=[];
 const record=(type:string,payload:any)=>JSON.stringify({type,timestamp:'2026-09-28T01:00:00Z',payload})+'\n';
 const observer=new CodexLifecycleObserver(root,e=>events.push(e));
 try{
  await writeFile(file,record('session_meta',{id,cwd:'D:/Project',source:'vscode'})+
   record('event_msg',{type:'task_started',turn_id:'old'})+record('event_msg',{type:'task_complete',turn_id:'old'}));
  await observer.poll();
  const initialEnd=events.find(e=>e.type==='turn_ended');
  assert.equal(initialEnd?.outcome,'success');assert.equal(initialEnd?.replayed,true);
  // An old timestamp on newly appended bytes may reflect delayed polling. It
  // cannot cause the confirmed successful completion to be dropped as replay.
  await appendFile(file,record('event_msg',{type:'task_started',turn_id:'live'})+
   record('event_msg',{type:'task_complete',turn_id:'live'}));
  await observer.poll();
  assert.equal(events.at(-1).outcome,'success');assert.equal(events.at(-1).replayed,false);
  assert.equal(events.filter(e=>e.type==='turn_ended'&&!e.replayed).length,1);
  await observer.poll();assert.equal(events.filter(e=>e.type==='turn_ended'&&!e.replayed).length,1);
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});
test('observer reads actual appended JSONL, preserves partial writes and ignores tool error text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-lifecycle-'));const id='00000000-0000-4000-8000-000000000001';const file=join(root,`rollout-${id}.jsonl`);const events:any[]=[];
 const observer=new CodexLifecycleObserver(root,e=>events.push(e));observer.track(id);
 try{
  await writeFile(file,JSON.stringify({type:'session_meta',payload:{id,cwd:'D:/Project',source:'vscode'}})+'\n');
  // Fork filenames can contain a parent's ID while belonging to a different chat.
  await writeFile(join(root,`rollout-${id}_new-fork.jsonl`),JSON.stringify({type:'session_meta',payload:{id:'different-chat',cwd:'D:/Other'}})+'\n');
  await observer.poll();
  const record=JSON.stringify({type:'event_msg',timestamp:'2026-09-28T00:00:00Z',payload:{type:'task_complete',turn_id:'t',error:{codex_error_info:'usage_limit_exceeded'}}});
  await appendFile(file,record.slice(0,60));await observer.poll();assert.equal(events.length,0);
  await appendFile(file,record.slice(60)+'\n');await observer.poll();assert.equal(events.length,1);assert.equal(events[0].type,'interrupted');
  await observer.poll();assert.equal(events.length,1);
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});
test('restart finds lifecycle evidence before a large recent tool body',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-long-log-')),id='00000000-0000-4000-8000-000000000001',events:any[]=[];
 const observer=new CodexLifecycleObserver(root,e=>events.push(e));observer.track(id);
 try{
  const metadata={type:'session_meta',payload:{id,cwd:'D:/LongProject',source:'vscode'}};
  const started={type:'event_msg',timestamp:'2026-09-27T00:00:00Z',payload:{type:'task_started',turn_id:'long-turn'}};
  await writeFile(join(root,`rollout-${id}.jsonl`),JSON.stringify(metadata)+'\n'+JSON.stringify(started)+'\n'+JSON.stringify({type:'response_item',payload:'x'.repeat(5*1024*1024)})+'\n');
  await observer.poll();assert.equal(events.filter(e=>e.type==='work_started').length,1);
  assert.equal(events.find(e=>e.type==='work_started')?.type,'work_started');
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('Desktop metadata beyond 16 KB still restores work and observes native pause',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-long-header-')),id='00000000-0000-4000-8000-000000000001',events:any[]=[];
 const observer=new CodexLifecycleObserver(root,e=>events.push(e));observer.track(id);
 const file=join(root,`rollout-${id}.jsonl`);
 try{
  const meta={type:'session_meta',payload:{id,cwd:'D:/Project',source:'vscode',base_instructions:'常规项目说明'.repeat(18000)}};
  const start={type:'event_msg',timestamp:'2026-09-27T17:44:20.322Z',payload:{type:'task_started',turn_id:'t'}};
  await writeFile(file,JSON.stringify(meta)+'\n'+JSON.stringify(start)+'\n');await observer.poll();
  const started=events.filter(e=>e.type==='work_started');
  assert.equal(started.length,1);assert.equal(started[0].projectPath,'D:/Project');
  await appendFile(file,JSON.stringify({type:'event_msg',timestamp:'2026-09-27T17:45:00.322Z',payload:{type:'turn_aborted',turn_id:'t',reason:'interrupted'}})+'\n');await observer.poll();
  assert.equal(events.filter(e=>e.type==='interrupted').length,1);assert.equal(events.at(-1).type,'interrupted');assert.equal(events.at(-1).sessionId,id);
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('native catalog discovers projects without hooks, validates metadata and excludes subagents',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-discovery-'));
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
 const events:any[]=[];let sessions:SessionActivities={};
 const observer=new CodexLifecycleObserver(root,e=>{events.push(e);sessions=updateSessionActivities(sessions,e)});
 try{
  for(const [i,id] of ids.entries())await writeFile(join(root,`rollout-${id}.jsonl`),
   JSON.stringify({type:'session_meta',payload:{id,cwd:i===0?'D:/Project-A':'E:/Project-B',source:i===2?{subagent:{thread_spawn:{parent_thread_id:ids[0]}}}:'vscode'}})+'\n'+
   JSON.stringify({type:'event_msg',timestamp:'2026-09-28T01:00:00Z',payload:{type:'task_started',turn_id:`turn-${i}`}})+'\n');
  await observer.poll();
  assert.equal(events.filter(e=>e.type==='work_started').length,2);assert.equal(sessions[ids[2]],undefined);assert.equal(dominantActivity(sessions).fullPower,true);
  await appendFile(join(root,`rollout-${ids[1]}.jsonl`),JSON.stringify({type:'event_msg',timestamp:'2026-09-28T01:01:00Z',payload:{type:'turn_aborted',turn_id:'turn-1'}})+'\n');
  await observer.poll();assert.equal(dominantActivity(sessions).phase,'working');assert.equal(dominantActivity(sessions).fullPower,false);
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('startup restores distinct working projects behind more than 32 newer child logs and downgrades on stop',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-discovery-backlog-'));
 const id=(i:number)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 const record=(type:string,payload:any)=>JSON.stringify({type,timestamp:'2026-09-28T01:00:00Z',payload})+'\n';
 let sessions:SessionActivities={};const events:any[]=[];
 const observer=new CodexLifecycleObserver(root,e=>{events.push(e);sessions=updateSessionActivities(sessions,e)});
 const fixture=async(i:number,cwd:string,child:boolean,mtime:number)=>{
  const file=join(root,`rollout-${id(i)}.jsonl`);
  await writeFile(file,record('session_meta',{id:id(i),cwd,source:child?{subagent:{thread_spawn:{parent_thread_id:id(1)}}}:'vscode'})+
   record('event_msg',{type:'task_started',turn_id:`turn-${i}`}));
  await utimes(file,mtime,mtime);return file;
 };
 try{
  const first=await fixture(1,'D:\\Project-A\\',false,1);
  const same=await fixture(2,'d:/PROJECT-a',false,2);
  const second=await fixture(3,'E:/Project-B',false,3);
  for(let i=4;i<44;i++)await fixture(i,'D:/Project-A',true,100+i);
  for(let round=0;round<6;round++)await observer.poll();
  assert.equal(Object.keys(sessions).length,3);assert.equal(events.some(e=>e.isSubagent),false);
  assert.equal(dominantActivity(sessions).workingProjectCount,2);assert.equal(dominantActivity(sessions).fullPower,true);
  await appendFile(second,record('event_msg',{type:'turn_aborted',turn_id:'turn-3'}));await observer.poll();
  assert.equal(dominantActivity(sessions).phase,'working');assert.equal(dominantActivity(sessions).workingProjectCount,1);
  assert.equal(dominantActivity(sessions).fullPower,false);
  await appendFile(first,record('event_msg',{type:'task_complete',turn_id:'turn-1'}));await observer.poll();
  assert.equal(dominantActivity(sessions).workingProjectCount,1);
  await appendFile(same,record('event_msg',{type:'turn_aborted',turn_id:'turn-2'}));await observer.poll();
  assert.equal(dominantActivity(sessions).phase,'idle');assert.equal(dominantActivity(sessions).workingProjectCount,0);
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('continuous new child logs cannot starve queued working main chats across catalog refreshes',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'pet-discovery-fairness-'));
 const id=(i:number)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 let time=Date.now();t.mock.method(Date,'now',()=>time);
 const record=(type:string,payload:any)=>JSON.stringify({type,timestamp:new Date(time).toISOString(),payload})+'\n';
 let sessions:SessionActivities={};const observer=new CodexLifecycleObserver(root,e=>sessions=updateSessionActivities(sessions,e));
 const fixture=async(i:number,cwd:string,child:boolean,mtime:number)=>{
  const file=join(root,`rollout-${id(i)}.jsonl`);
  await writeFile(file,record('session_meta',{id:id(i),cwd,source:child?{subagent:{thread_spawn:{parent_thread_id:id(1)}}}:'vscode'})+
   record('event_msg',{type:'task_started',turn_id:`turn-${i}`}));
  await utimes(file,mtime,mtime);
 };
 try{
  await fixture(1,'D:/Project-A',false,1);await fixture(2,'E:/Project-B',false,2);
  for(let i=3;i<19;i++)await fixture(i,'D:/Project-A',true,100+i);
  await observer.poll();
  for(let round=0;round<2;round++){
   time+=5001;
   for(let i=19+round*8;i<27+round*8;i++)await fixture(i,'D:/Project-A',true,1000+i);
   await observer.poll();
  }
  assert.equal(Object.keys(sessions).length,2);
  assert.equal(dominantActivity(sessions).workingProjectCount,2);assert.equal(dominantActivity(sessions).fullPower,true);
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('native async replies resume their exact turn after every question is answered',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-native-replies-')),id='00000000-0000-4000-8000-000000000001';
 const file=join(root,`rollout-${id}.jsonl`),events:any[]=[];let sessions:SessionActivities={};
 const observer=new CodexLifecycleObserver(root,e=>{events.push(e);sessions=updateSessionActivities(sessions,e)});
 const record=(type:string,payload:any)=>JSON.stringify({type,timestamp:'2026-09-28T01:00:00Z',payload})+'\n';
 const reply=(index:number,callId='native-call',turn='t',answer='Selected option')=>({type:'message',role:'user',
  content:[{type:'input_text',text:'<send_user_message_question_reply>\n'+JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,index]),answer}])+'\n</send_user_message_question_reply>'}],
  internal_chat_message_metadata_passthrough:{turn_id:turn}});
 try{
  await writeFile(file,record('session_meta',{id,cwd:'D:/Project',source:'vscode'})+
   record('event_msg',{type:'task_started',turn_id:'t'})+
   record('response_item',{type:'function_call',name:'request_user_input_async',call_id:'failed-call',arguments:JSON.stringify({questions:[{question:'Not posted'}]})})+
   record('response_item',{type:'function_call_output',call_id:'failed-call',output:JSON.stringify({accepted:false})})+
   record('response_item',{type:'function_call',name:'request_user_input_async',call_id:'error-call',arguments:JSON.stringify({questions:[{question:'Not posted'}]})})+
   record('response_item',{type:'function_call_output',call_id:'error-call',output:'Tool failed'})+
   record('response_item',{type:'function_call',name:'request_user_input_async',call_id:'native-call',arguments:JSON.stringify({questions:[{question:'First choice'},{question:'Second choice'}]})})+
   record('response_item',{type:'function_call_output',call_id:'native-call',output:JSON.stringify({accepted:true})}));
  await observer.poll();assert.equal(dominantActivity(sessions).phase,'asking');assert.equal(events.filter(e=>e.type==='needs_input').length,1);
  assert.equal(events.find(e=>e.type==='needs_input').nativeCallId,'native-call');
  const nativeResolutions=()=>events.filter(e=>e.type==='input_resolved'&&e.id.endsWith(':native-call'));
  const append=async(payload:any)=>{await appendFile(file,record('response_item',payload));await observer.poll()};
  await append({type:'message',role:'user',content:[{type:'input_text',text:'Continue working'}]});
  for(const invalid of [reply(0,'other-call'),reply(0,'native-call','another-turn'),reply(9),reply(0,'native-call','t','')])await append(invalid);
  assert.equal(dominantActivity(sessions).phase,'asking');assert.equal(nativeResolutions().length,0);
  await append(reply(0));await append(reply(0));
  assert.equal(dominantActivity(sessions).phase,'asking');
  await append(reply(1));assert.equal(dominantActivity(sessions).phase,'working');
  const resolved=nativeResolutions();assert.equal(resolved.length,1);assert.equal(resolved[0].turnId,'t');assert.equal(resolved[0].questionId,undefined);
  assert.equal(resolved[0].nativeCallId,'native-call');
  await append(reply(1));assert.equal(nativeResolutions().length,1);
  await appendFile(file,record('event_msg',{type:'turn_aborted',turn_id:'t'}));await observer.poll();
  await append(reply(0));assert.equal(dominantActivity(sessions).phase,'idle');
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('native context switches projects and discovers a chat created after startup without hooks',async(t)=>{
 const root=await mkdtemp(join(tmpdir(),'pet-live-discovery-'));
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 let time=Date.now();t.mock.method(Date,'now',()=>time);
 const record=(type:string,payload:any)=>JSON.stringify({type,timestamp:'2026-09-28T01:00:00Z',payload})+'\n';
 let sessions:SessionActivities={};const observer=new CodexLifecycleObserver(root,e=>sessions=updateSessionActivities(sessions,e));
 try{
  await writeFile(join(root,`rollout-${ids[0]}.jsonl`),record('session_meta',{id:ids[0],cwd:'D:/Project-A',source:'vscode'})+
   record('event_msg',{type:'task_started',turn_id:'a'})+record('turn_context',{turn_id:'a',cwd:'E:/Project-B'}));
  await observer.poll();assert.equal(sessions[ids[0]].projectPath,'e:/project-b');
  await writeFile(join(root,`rollout-${ids[1]}.jsonl`),record('session_meta',{id:ids[1],cwd:'D:/Project-A',source:'vscode'})+record('event_msg',{type:'task_started',turn_id:'b'}));
  time+=5001;await observer.poll();assert.equal(dominantActivity(sessions).workingProjectCount,2);assert.equal(dominantActivity(sessions).fullPower,true);
  await appendFile(join(root,`rollout-${ids[0]}.jsonl`),record('turn_context',{turn_id:'older',cwd:'D:/Project-A'}));
  await observer.poll();assert.equal(dominantActivity(sessions).workingProjectCount,2);
  await appendFile(join(root,`rollout-${ids[0]}.jsonl`),record('event_msg',{type:'turn_aborted',turn_id:'a'}));
  await observer.poll();assert.equal(dominantActivity(sessions).fullPower,false);
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('a native failed async post clears a hook-only question when reconciliation catches up',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-failed-post-')),id='00000000-0000-4000-8000-000000000001';
 let sessions:SessionActivities=updateSessionActivities({}, {id:'fixture-start',type:'work_started',source:'hook',sessionId:id,turnId:'t',createdAt:'2026-09-28T01:00:01Z',read:false});
 sessions=updateSessionActivities(sessions,{id:'fixture-question',type:'needs_input',nativeQuestion:true,source:'hook',sessionId:id,turnId:'t',createdAt:'2026-09-28T01:00:02Z',read:false});
 assert.equal(dominantActivity(sessions).phase,'asking');
 const observer=new CodexLifecycleObserver(root,e=>sessions=updateSessionActivities(sessions,e));
 const record=(type:string,payload:any)=>JSON.stringify({type,timestamp:'2026-09-28T01:00:00Z',payload})+'\n';
 try{
  await writeFile(join(root,`rollout-${id}.jsonl`),record('session_meta',{id,cwd:'D:/Project',source:'vscode'})+record('event_msg',{type:'task_started',turn_id:'t'})+
   record('response_item',{type:'function_call',name:'request_user_input_async',call_id:'failed',arguments:'{"questions":[{}]}'})+
   record('response_item',{type:'function_call_output',call_id:'failed',output:'{"accepted":false}'}));
  await observer.poll();assert.equal(dominantActivity(sessions).phase,'working');assert.equal(sessions[id].nativeTurnId,'t');
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('a question completion from an older turn cannot clear a newer native question',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pet-question-turns-')),id='00000000-0000-4000-8000-000000000001';
 const file=join(root,`rollout-${id}.jsonl`),events:any[]=[];
 const observer=new CodexLifecycleObserver(root,e=>events.push(e));
 const record=(type:string,payload:any)=>JSON.stringify({type,timestamp:'2026-09-28T01:00:00Z',payload})+'\n';
 const question=(call_id:string)=>record('response_item',{type:'function_call',name:'request_user_input',call_id,arguments:JSON.stringify({questions:[{question:'Choose'}]})});
 try{
  await writeFile(file,record('session_meta',{id,cwd:'D:/Project',source:'vscode'})+record('event_msg',{type:'task_started',turn_id:'old'})+question('old-call'));
  await observer.poll();
  await appendFile(file,record('event_msg',{type:'task_started',turn_id:'new'})+question('new-call')+record('response_item',{type:'function_call_output',call_id:'old-call',output:'{}'}));
  await observer.poll();assert.equal(events.filter(e=>e.type==='input_resolved').length,0);
  await appendFile(file,record('response_item',{type:'function_call_output',call_id:'new-call',output:'{"answers":{}}'}));
  await observer.poll();assert.equal(events.at(-1)?.type,'input_resolved');assert.equal(events.at(-1)?.turnId,'new');
 }finally{observer.stop();await rm(root,{recursive:true,force:true});}
});

test('sidebar project assignments split a shared cwd and reconcile changes without new log bytes',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pet-sidebar-lifecycle-')),root=join(home,'sessions');await mkdir(root);
 const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,projectA=id(100),projectB=id(200),file=join(home,'.codex-global-state.json');
 const metadata:any={'local-projects':{[projectA]:{id:projectA,rootPaths:['D:/Workspace']},[projectB]:{id:projectB,rootPaths:['D:/Workspace']}},
  'thread-project-assignments':{[id(1)]:{projectKind:'local',projectId:projectA},[id(2)]:{projectKind:'local',projectId:projectA},[id(3)]:{projectKind:'local',projectId:projectB}}};
 const save=()=>writeFile(file,JSON.stringify(metadata));
 const line=(type:string,payload:any)=>JSON.stringify({timestamp:'2026-10-02T08:00:00Z',type,payload})+'\n';
 let sessions:SessionActivities={};const events:any[]=[];
 const observer=new CodexLifecycleObserver(root,e=>{events.push(e);sessions=updateSessionActivities(sessions,e)});
 try{
  await save();
  for(let n=1;n<=3;n++)await writeFile(join(root,`rollout-${id(n)}.jsonl`),line('session_meta',{id:id(n),cwd:'D:/Workspace',source:'vscode'})+line('event_msg',{type:'task_started',turn_id:`turn-${n}`}));
  await observer.poll();assert.equal(dominantActivity(sessions).workingProjectCount,2);assert.equal(dominantActivity(sessions).fullPower,true);
  assert.equal(sessions[id(1)].projectId,`codex-local:${projectA}`);assert.equal(sessions[id(3)].projectId,`codex-local:${projectB}`);
  metadata['thread-project-assignments'][id(3)].projectId=projectA;await save();await observer.poll();
  assert.equal(dominantActivity(sessions).workingProjectCount,1);assert.equal(dominantActivity(sessions).fullPower,false);
  metadata['thread-project-assignments'][id(3)].projectId=projectB;await save();await observer.poll();
  assert.equal(dominantActivity(sessions).workingProjectCount,2);
  await appendFile(join(root,`rollout-${id(3)}.jsonl`),line('event_msg',{type:'turn_aborted',turn_id:'turn-3'}));await observer.poll();
  assert.equal(dominantActivity(sessions).workingProjectCount,1);
  metadata['thread-project-assignments'][id(3)].projectId=projectA;await save();await observer.poll();
  assert.equal(sessions[id(3)].phase,'idle');assert.equal(sessions[id(3)].terminal,true);
  metadata['thread-project-assignments']={};await save();await observer.poll();
  assert.equal(sessions[id(1)].projectId,undefined);assert.equal(sessions[id(1)].nativeProjectIdConfirmed,true);
  assert.equal(dominantActivity(sessions).workingProjectCount,1,'unassigned same-directory chats use directory fallback');
  assert.equal(events.filter(e=>e.type==='work_started').length,3,'identity changes do not invent a task start');
 }finally{observer.stop();await rm(home,{recursive:true,force:true});}
});

test('restart reconciles a changed sidebar assignment on an already-known pending terminal question',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pet-sidebar-pending-')),root=join(home,'sessions');await mkdir(root);
 const id='00000000-0000-4000-8000-000000000001',oldProject='00000000-0000-4000-8000-000000000100',newProject='00000000-0000-4000-8000-000000000200';
 const line=(type:string,payload:any)=>JSON.stringify({timestamp:'2026-10-02T08:00:00Z',type,payload})+'\n';
 let sessions:SessionActivities={[id]:{sessionId:id,turnId:'t',nativeTurnId:'t',nativeProjectIdConfirmed:true,projectId:`codex-local:${oldProject}`,projectPath:'d:/workspace',phase:'asking',waitingFor:'input',terminal:true,updatedAt:'2026-10-02T08:00:00Z'}};
 const observer=new CodexLifecycleObserver(root,e=>sessions=updateSessionActivities(sessions,e));
 try{
  await writeFile(join(home,'.codex-global-state.json'),JSON.stringify({'local-projects':{[newProject]:{id:newProject,rootPaths:['D:/Workspace']}},'thread-project-assignments':{[id]:{projectKind:'local',projectId:newProject}}}));
  await writeFile(join(root,`rollout-${id}.jsonl`),line('session_meta',{id,cwd:'D:/Workspace',source:'vscode'})+line('event_msg',{type:'task_started',turn_id:'t'})+line('event_msg',{type:'task_complete',turn_id:'t'}));
  await observer.poll();assert.equal(sessions[id].projectId,`codex-local:${newProject}`);
  assert.equal(sessions[id].phase,'asking');assert.equal(sessions[id].waitingFor,'input');assert.equal(sessions[id].terminal,true);
  await writeFile(join(home,'.codex-global-state.json'),JSON.stringify({'local-projects':{},'thread-project-assignments':{}}));
  await observer.poll();assert.equal(sessions[id].projectId,undefined);assert.equal(sessions[id].phase,'asking');assert.equal(sessions[id].terminal,true);
 }finally{observer.stop();await rm(home,{recursive:true,force:true});}
});
