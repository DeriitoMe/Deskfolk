import test from 'node:test';import assert from 'node:assert/strict';
import {lifecycleEvent,CodexLifecycleObserver} from './codex-lifecycle.ts';
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import {dominantActivity,updateSessionActivities,type SessionActivities} from '../shared/activity.ts';
test('verified normal completion, stop and quota records terminate the matching turn',()=>{
 for(const [payload,expect] of [[{type:'task_complete',turn_id:'t'},'turn_ended'],[{type:'turn_aborted',turn_id:'t',reason:'interrupted'},'interrupted'],[{type:'task_complete',turn_id:'t',error:{codex_error_info:'usage_limit_exceeded'}},'interrupted']] as const){
  const e=lifecycleEvent({type:'event_msg',timestamp:'2026-09-27T11:25:16.970Z',payload},'s','D:/Code/one');
  assert.equal(e?.type,expect);assert.equal(e?.turnId,'t');
 }
 assert.equal(lifecycleEvent({type:'response_item',payload:{type:'task_complete',turn_id:'t'}},'s'),null);
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
  await observer.poll();assert.equal(events.length,1);assert.equal(events[0].type,'work_started');
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
  assert.equal(events.length,1);assert.equal(events[0].type,'work_started');assert.equal(events[0].projectPath,'D:/Project');
  await appendFile(file,JSON.stringify({type:'event_msg',timestamp:'2026-09-27T17:45:00.322Z',payload:{type:'turn_aborted',turn_id:'t',reason:'interrupted'}})+'\n');await observer.poll();
  assert.equal(events.length,2);assert.equal(events[1].type,'interrupted');assert.equal(events[1].sessionId,id);
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
  assert.equal(events.length,2);assert.equal(sessions[ids[2]],undefined);assert.equal(dominantActivity(sessions).fullPower,true);
  await appendFile(join(root,`rollout-${ids[1]}.jsonl`),JSON.stringify({type:'event_msg',timestamp:'2026-09-28T01:01:00Z',payload:{type:'turn_aborted',turn_id:'turn-1'}})+'\n');
  await observer.poll();assert.equal(dominantActivity(sessions).phase,'working');assert.equal(dominantActivity(sessions).fullPower,false);
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
  const nativeResolutions=()=>events.filter(e=>e.type==='input_resolved'&&e.id.endsWith(':native-call'));
  const append=async(payload:any)=>{await appendFile(file,record('response_item',payload));await observer.poll()};
  await append({type:'message',role:'user',content:[{type:'input_text',text:'Continue working'}]});
  for(const invalid of [reply(0,'other-call'),reply(0,'native-call','another-turn'),reply(9),reply(0,'native-call','t','')])await append(invalid);
  assert.equal(dominantActivity(sessions).phase,'asking');assert.equal(nativeResolutions().length,0);
  await append(reply(0));await append(reply(0));
  assert.equal(dominantActivity(sessions).phase,'asking');
  await append(reply(1));assert.equal(dominantActivity(sessions).phase,'working');
  const resolved=nativeResolutions();assert.equal(resolved.length,1);assert.equal(resolved[0].turnId,'t');assert.equal(resolved[0].questionId,undefined);
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
