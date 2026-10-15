import test from 'node:test';import assert from 'node:assert/strict';
import {touchPressure,TOUCH_SECONDS} from './touch-motion.ts';
test('single tap visibly presses within one frame, peaks quickly and settles in a fraction of a second',()=>{
 assert(touchPressure(1/60)>.35);assert.equal(touchPressure(.075),1);
 assert.equal(touchPressure(.095),1);assert(touchPressure(.18)<.5);
 assert(touchPressure(.29)<0);assert.equal(touchPressure(.35),0);assert.equal(touchPressure(TOUCH_SECONDS),0);
});
test('a repeated tap preserves its starting pose and visibly releases then presses again',()=>{
 for(const initial of [.3,.7,1]){
  assert.equal(touchPressure(0,initial),initial);
  assert(touchPressure(.025,initial)<initial*.4);assert.equal(touchPressure(.075,initial),1);
 }
});
test('rapid taps stay bounded, respond at every tap and finish after the last one',()=>{
 for(const spacing of [.05,.07,.12,.25]){
  let initial=0;
  for(let tap=0;tap<30;tap++){
   for(let t=0;t<=spacing;t+=1/120){const p=touchPressure(t,initial);assert(p>=-.11&&p<=1);}
   const next=touchPressure(spacing,initial);assert.equal(touchPressure(0,next),next);initial=next;
  }
  assert.equal(touchPressure(TOUCH_SECONDS,initial),0);
 }
});
