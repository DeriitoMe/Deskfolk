import test from 'node:test';
import assert from 'node:assert/strict';
import { RendererEventQueue } from './renderer-events.ts';
import { shouldDeliverBufferedEvent, updateSessionActivities } from '../shared/activity.ts';
import type { PetEvent } from '../shared/types';

const completion=(id:string):PetEvent=>({id,type:'turn_ended',source:'codex-log',outcome:'success',
  sessionId:id,turnId:id,createdAt:new Date(0).toISOString(),read:false});

test('startup completions wait for listeners, preserve order and flush exactly once',()=>{
  const delivered:PetEvent[]=[];
  const queue=new RendererEventQueue(event=>delivered.push(event));
  const first=Object.freeze(completion('project-a')),second=Object.freeze(completion('project-b'));
  queue.deliver(first);queue.deliver(second);
  assert.equal(delivered.length,0);
  assert.equal(queue.makeReady(),2);
  assert.deepEqual(delivered,[first,second]);
  assert.equal(queue.makeReady(),0);
  queue.deliver(completion('project-c'));
  assert.deepEqual(delivered.map(event=>event.id),['project-a','project-b','project-c']);
});

test('document reload buffers new events until its replacement listeners are ready',()=>{
  const delivered:PetEvent[]=[];
  const queue=new RendererEventQueue(event=>delivered.push(event));
  queue.makeReady();queue.deliver(completion('before-reload'));
  queue.reset();queue.deliver(completion('during-reload'));
  assert.deepEqual(delivered.map(event=>event.id),['before-reload']);
  assert.equal(queue.makeReady(),1);
  assert.deepEqual(delivered.map(event=>event.id),['before-reload','during-reload']);
});

test('startup drops resolved or replaced questions while keeping actual pending input and successes',()=>{
  const delivered:PetEvent[]=[];
  const queue=new RendererEventQueue(event=>delivered.push(event));
  const question=(sessionId:string,turnId:string):PetEvent=>({...completion(sessionId),type:'needs_input',outcome:undefined,
    sessionId,turnId,nativeQuestion:true,nativeCallId:sessionId+'-call'});
  const answered=question('answered','old-turn'),replaced=question('replaced','old-turn'),pending=question('pending','live-turn');
  let sessions=updateSessionActivities({},answered);
  sessions=updateSessionActivities(sessions,{...answered,type:'input_resolved'});
  sessions=updateSessionActivities(sessions,replaced);
  sessions=updateSessionActivities(sessions,{...replaced,type:'work_started',turnId:'new-turn'});
  sessions=updateSessionActivities(sessions,{...replaced,turnId:'new-turn'});
  sessions=updateSessionActivities(sessions,pending);
  for(const event of [answered,replaced,pending,completion('success')])queue.deliver(event);
  assert.equal(queue.makeReady(event=>shouldDeliverBufferedEvent(sessions,event)),2);
  assert.deepEqual(delivered.map(event=>event.id),['pending','success']);
});
