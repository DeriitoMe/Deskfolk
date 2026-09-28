import test from 'node:test';
import assert from 'node:assert/strict';
import { IdleCadence } from './idle-cadence.ts';
test('idle cadence gives both actions 15 seconds and separates them by 30 seconds', () => {
  const c = new IdleCadence();
  for (const [t, action] of [[0,'idle'],[29999,'idle'],[30000,'nap'],[44999,'nap'],[45000,'idle'],[74999,'idle'],[75000,'water'],[89999,'water'],[90000,'water-happy'],[93599,'water-happy'],[93600,'idle'],[123600,'nap']] as const)
    assert.equal(c.tick(t, 'idle').action, action, String(t));
});
test('click/drag cancels pastimes; release starts 30 seconds of idle rather than resuming nap', () => {
  const c = new IdleCadence(); c.tick(0,'idle'); c.tick(30000,'idle');
  assert.equal(c.tick(34000,'interaction').elapsed,0);
  assert.equal(c.tick(50000,'interaction').elapsed,0);
  assert.equal(c.tick(70000,'idle').action,'idle');
  assert.equal(c.tick(99999,'idle').action,'idle');
  assert.equal(c.tick(100000,'idle').action,'nap');
  c.tick(110000,'busy'); c.tick(120000,'idle');
  assert.equal(c.tick(149999,'idle').action,'idle');
  assert.equal(c.tick(150000,'idle').action,'nap');
});
test('pointerdown reset immediately cancels watering and prevents its happy finale',()=>{
 const c=new IdleCadence();c.tick(0,'idle');assert.equal(c.tick(79000,'idle').action,'water');
 c.reset(79001);assert.equal(c.tick(79001,'idle').action,'idle');
 assert.equal(c.tick(109000,'idle').action,'idle');assert.equal(c.tick(109001,'idle').action,'nap');
});
