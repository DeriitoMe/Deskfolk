import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rename,rm,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexProjectCatalog,parseCodexProjectAssignments} from './codex-projects.ts';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project=(n:number,rootPaths=['D:/Workspace'])=>({id:id(n),name:'Unused display name',rootPaths});
const fixture=()=>({'local-projects':{[id(1)]:project(1),[id(2)]:project(2)},'thread-project-assignments':{
  [id(11)]:{projectKind:'local',projectId:id(1)},
  [id(12)]:{projectKind:'local',projectId:id(1)},
  [id(13)]:{projectKind:'local',projectId:id(2)}
}});

test('sidebar identities distinguish projects sharing a directory and deduplicate their chats',()=>{
  const assignments=parseCodexProjectAssignments(fixture());
  assert.equal(assignments.get(id(11)),assignments.get(id(12)));
  assert.notEqual(assignments.get(id(11)),assignments.get(id(13)));
  assert.equal(new Set(assignments.values()).size,2);
  assert.equal(assignments.get(id(11)),`codex-local:${id(1)}`);
});

test('only validated existing local project assignments are selected',()=>{
  const value:any=fixture();
  value['local-projects'][id(3)]={id:id(3),rootPaths:['relative/root']};
  value['local-projects'][id(4)]={id:id(5),rootPaths:['D:/Workspace']};
  value['local-projects'][id(5)]={id:id(5),rootPaths:[]};
  value['local-projects']['invalid-id']={id:'invalid-id',rootPaths:['D:/Workspace']};
  value['thread-project-assignments']={
    [id(11)]:{projectKind:'local',projectId:id(1)},
    [id(12)]:{projectKind:'remote',projectId:id(1)},
    [id(13)]:{projectKind:'local',projectId:id(99)},
    [id(14)]:{projectKind:'local',projectId:id(3)},
    [id(15)]:{projectKind:'local',projectId:id(4)},
    [id(16)]:{projectKind:'local',projectId:id(5)},
    [id(17)]:{projectKind:'local',projectId:'invalid-id'},
    [id(18)]:null,
    'invalid-session':{projectKind:'local',projectId:id(1)}
  };
  assert.deepEqual([...parseCodexProjectAssignments(value)],[[id(11),`codex-local:${id(1)}`]]);
  for(const invalid of [null,[],false,'text',{'local-projects':[]},{'thread-project-assignments':null}])
    assert.equal(parseCodexProjectAssignments(invalid).size,0);
});

test('project ID canonicalization permits valid roots without constraining turn cwd',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pet-project-roots-'));
  const catalog=new CodexProjectCatalog(root);
  const projectId='ABCDEF01-2345-6789-ABCD-0123456789AB',sessionId='ABCDEF02-2345-6789-ABCD-0123456789AB';
  try{
    await writeFile(join(root,'.codex-global-state.json'),JSON.stringify({
      'local-projects':{[projectId]:{id:projectId,rootPaths:['D:\\Repository','/worktrees/new']}},
      'thread-project-assignments':{[sessionId]:{projectKind:'local',projectId:projectId.toLowerCase()}}
    }));
    await catalog.refresh();
    assert.equal(catalog.projectId(sessionId,'E:/DifferentWorktree'),`codex-local:${projectId.toLowerCase()}`);
    assert.equal(catalog.projectId(sessionId.toLowerCase()),catalog.projectId(sessionId));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('local or legacy missing host membership is accepted while remote and unknown memberships are excluded',()=>{
  const value:any=fixture();
  value['thread-project-assignments'][id(14)]={projectKind:'local',projectId:id(1)};
  value['thread-project-assignments'][id(15)]={projectKind:'local',projectId:id(1)};
  value['thread-project-assignments'][id(16)]={projectKind:'local',projectId:id(1)};
  value['thread-project-membership-host-ids']={
    [id(11)]:'local',
    [id(12)]:'local:desktop',
    [id(13)]:'remote-host',
    [id(14)]:{id:'local'},
    [id(15)]:null
  };
  const assignments=parseCodexProjectAssignments(value);
  assert.deepEqual([...assignments.keys()],[id(11),id(12),id(16)]);
  const upperSession='ABCDEF02-2345-6789-ABCD-0123456789AB';
  value['thread-project-assignments'][upperSession]={projectKind:'local',projectId:id(1)};
  value['thread-project-membership-host-ids'][upperSession.toLowerCase()]='remote-host';
  assert.equal(parseCodexProjectAssignments(value).has(upperSession.toLowerCase()),false);
});

test('catalog refresh applies assignment changes and valid removals without modifying Codex data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pet-project-refresh-'));
  const file=join(root,'.codex-global-state.json'),catalog=new CodexProjectCatalog(root);
  const write=async(value:unknown,time:number)=>{const text=JSON.stringify(value);await writeFile(file,text);await utimes(file,time,time);return text;};
  try{
    const value=fixture();const initial=await write(value,1);
    await Promise.all([catalog.refresh(),catalog.refresh()]);
    assert.equal(catalog.projectId(id(11)),`codex-local:${id(1)}`);
    assert.equal(await readFile(file,'utf8'),initial);
    value['thread-project-assignments'][id(11)].projectId=id(2);
    await write(value,2);await catalog.refresh();
    assert.equal(catalog.projectId(id(11)),`codex-local:${id(2)}`);
    delete value['thread-project-assignments'][id(11)];
    await write(value,3);await catalog.refresh();assert.equal(catalog.projectId(id(11)),undefined);
    await write({},4);await catalog.refresh();assert.equal(catalog.projectId(id(13)),undefined);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('transient missing or damaged state preserves last verified IDs and retries unchanged failed metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pet-project-retry-'));
  const file=join(root,'.codex-global-state.json'),backup=join(root,'saved.json'),catalog=new CodexProjectCatalog(root);
  try{
    await writeFile(file,JSON.stringify(fixture()));await utimes(file,1,1);await catalog.refresh();
    await rename(file,backup);await catalog.refresh();assert.equal(catalog.projectId(id(11)),`codex-local:${id(1)}`);
    const changed=fixture();changed['thread-project-assignments'][id(11)].projectId=id(2);
    const valid=JSON.stringify(changed);
    await writeFile(file,'!'.repeat(valid.length));await utimes(file,2,2);await catalog.refresh();
    assert.equal(catalog.projectId(id(11)),`codex-local:${id(1)}`);
    // Match the failed read's stat values: a failed attempt must not be cached.
    await writeFile(file,valid);await utimes(file,2,2);await catalog.refresh();
    assert.equal(catalog.projectId(id(11)),`codex-local:${id(2)}`);
    await writeFile(file,JSON.stringify({'local-projects':null,'thread-project-assignments':{}}));
    await utimes(file,3,3);await catalog.refresh();
    assert.equal(catalog.projectId(id(11)),`codex-local:${id(2)}`);
    await writeFile(file,JSON.stringify({'local-projects':fixture()['local-projects'],'thread-project-assignments':{}}));
    await utimes(file,4,4);await catalog.refresh();assert.equal(catalog.projectId(id(11)),undefined);
  }finally{await rm(root,{recursive:true,force:true});}
});
