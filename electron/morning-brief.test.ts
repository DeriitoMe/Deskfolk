import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MorningBriefLink,briefDataDir,readBriefData,taskWorkingDirectory} from './morning-brief.ts';

async function fixture(){
  const base=await mkdtemp(join(tmpdir(),'deskfolk-brief-')),root=join(base,'Skills-Morning-Brief'),data=join(base,'shelf');
  await mkdir(join(root,'morningpaper'),{recursive:true});await mkdir(join(root,'data','public'),{recursive:true});await mkdir(data,{recursive:true});
  await writeFile(join(root,'morningpaper','__init__.py'),'');
  await writeFile(join(root,'data','public','tibo.json'),JSON.stringify({items:[{id:'x:1',event_status:'announced',published_at:'2026-10-20',secret_field:'not copied'}]}));
  await writeFile(join(root,'data','public','news.json'),JSON.stringify({items:[{id:'n1',title:'Codex 新功能',source:'Codex',collected_at:'2026-10-20T01:00:00Z'}]}));
  await writeFile(join(root,'data','public','catalog.json'),JSON.stringify({items:[{id:'s1',name:'hot-skill',stars:10,stars_delta_7d:3,source_text:'long'}]}));
  return {root,data};
}
const xml=(dir:string)=>`<?xml version="1.0" encoding="UTF-16"?><Task><Actions><Exec><Command>powershell.exe</Command><WorkingDirectory>${dir}</WorkingDirectory></Exec></Actions></Task>`;

test('the install folder comes from the brief daily task, in UTF-16 or UTF-8 output',()=>{
  assert.equal(taskWorkingDirectory(Buffer.from(xml('D:\\A & B'),'utf16le')),'D:\\A & B'.replace('&','&'));
  assert.equal(taskWorkingDirectory(Buffer.from(xml('D:\\Tools\\Skills-Morning-Brief'),'utf8')),'D:\\Tools\\Skills-Morning-Brief');
  assert.equal(taskWorkingDirectory(Buffer.from('ERROR: not found')),null);
});

test('only the needed public fields are read',async()=>{
  const {root}=await fixture(),data=readBriefData(root)!;
  assert.deepEqual(Object.keys(data.tibo[0]).sort(),['collected_at','event_status','id','published_at','title']);
  assert.equal((data.skills[0] as Record<string,unknown>).source_text,undefined);
});

test('the brief data folder matches the brief own defaults',()=>{
  assert.equal(briefDataDir({LOCALAPPDATA:'C:\\L'},'win32'),join('C:\\L','AgentSkillShelf'));
  assert.equal(briefDataDir({MORNINGPAPER_DATA_DIR:'/x'},'linux'),'/x');
  assert.equal(briefDataDir({},'darwin','/home/u'),join('/home/u','Library/Application Support/AgentSkillShelf'));
});

test('notes are found through the task and remembered for the next reading',async()=>{
  const {root,data}=await fixture();let state:{seen:string[]}={seen:[]};
  const link=new MorningBriefLink({statePath:'',platform:'win32',env:{MORNINGPAPER_DATA_DIR:data},exec:async()=>Buffer.from(xml(root),'utf16le'),
    openExternal:async()=>{},readState:()=>state,writeState:s=>{state=s;},now:()=>Date.parse('2026-10-21T00:00:00Z')});
  assert.equal((await link.nextNote()).kind,'tibo');
  assert.equal((await link.nextNote()).kind,'news');
  assert.deepEqual(state.seen,['tibo:x:1','news:n1']);
});

test('a running service is reused only when its identity matches the record',async()=>{
  const {root,data}=await fixture();
  await writeFile(join(data,'reader-session.json'),JSON.stringify({instance_id:'abc',port:8765,launch_token:'private',pid:1}));
  const opened:string[]=[],launched:string[]=[],probed:number[]=[];
  const make=(identity:unknown)=>new MorningBriefLink({statePath:'',platform:'win32',env:{DESKFOLK_MORNING_BRIEF_DIR:root,MORNINGPAPER_DATA_DIR:data},
    openExternal:async url=>{opened.push(url);},probe:async port=>{probed.push(port);return identity;},launch:async(_p,cwd)=>{launched.push(cwd);}});
  assert.deepEqual(await make({instance_id:'abc'}).open(),{ok:true});
  assert.deepEqual(opened,['http://127.0.0.1:8765/']);
  assert(!opened.some(url=>url.includes('private')),'the private launch token never reaches the URL');
  assert.deepEqual(await make({instance_id:'other'}).open(),{ok:true});
  assert.deepEqual(launched,[root],'an unrelated service on that port falls back to the brief launcher');
});

test('a missing install or Python reports a short reason',async()=>{
  const {root}=await fixture();
  const none=new MorningBriefLink({statePath:'',platform:'linux',env:{},openExternal:async()=>{}});
  assert.equal((await none.open()).ok,false);
  const noPython=new MorningBriefLink({statePath:'',platform:'win32',env:{DESKFOLK_MORNING_BRIEF_DIR:root,MORNINGPAPER_DATA_DIR:join(root,'missing')},
    openExternal:async()=>{},launch:async()=>{throw new Error('ENOENT');}});
  assert.deepEqual(await noPython.open(),{ok:false,error:'晨报需要 Python 3.11 才能打开......'});
});
