import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionStore, QUESTION_LEASE_MS } from './questions.ts';
test('answer stays pending until explicitly acknowledged; repeats cannot overwrite',()=>{
  const store=new QuestionStore();const q=store.create({title:'Which model?',options:['A','B'],sessionId:'thread-a',turnId:'turn-a'});
  assert.equal(q.status,'pending');store.answer(q.id,'B');assert.equal(store.live()[0].status,'answered');
  assert.throws(()=>store.answer(q.id,'A'));
  assert.equal(store.poll(q.id,'thread-a','turn-a').answer,'B');
  store.acknowledge(q.id);assert.equal(store.live().length,0);assert.equal(store.acknowledge(q.id).status,'consumed');
});
test('a different task cannot consume a polled answer or cancel another turn',()=>{
  const store=new QuestionStore();const q=store.create({title:'A?',sessionId:'a',turnId:'one'});
  const b=store.create({title:'B?',sessionId:'b',turnId:'one'});
  assert.throws(()=>store.poll(q.id,'b','one'));
  store.cancelSession('a','two');assert.equal(q.status,'pending');
  store.cancelSession('a','one');assert.equal(q.status,'cancelled');assert.equal(b.status,'pending');
  store.cancelSession('b','two',true);assert.equal(b.status,'cancelled');
});
test('expired/orphaned requests never accept late answers and restart has no live requests',()=>{
  let now=1000;const store=new QuestionStore(()=>now);const q=store.create({title:'A?'});
  now+=QUESTION_LEASE_MS-1;store.poll(q.id);now+=QUESTION_LEASE_MS-1;assert.equal(store.get(q.id).status,'pending');
  now+=2;assert.ok(store.sweep());assert.equal(q.status,'expired');assert.throws(()=>store.answer(q.id,'yes'));
  assert.throws(()=>new QuestionStore().get(q.id));
});
test('invalid questions and empty answers are rejected',()=>{
  const store=new QuestionStore();assert.throws(()=>store.create({title:''}));assert.throws(()=>store.create({title:'sudo?',purpose:'approval'}));
  const q=store.create({title:'Choose',options:['A','A','B']});assert.deepEqual(q.options,['A','B']);assert.throws(()=>store.answer(q.id,'  '));
});
