import test from 'node:test';
import assert from 'node:assert/strict';
import {QUOTA_BOARD_SECONDS,quotaBoardGripHeight,quotaBoardMotion} from './quota-board-motion.ts';

const samples=Array.from({length:381},(_,i)=>i/100);

test('the board is only visible while both hands are up holding it',()=>{
  for(const t of samples){
    const m=quotaBoardMotion(t);
    assert.equal(m.height,quotaBoardGripHeight(m.arm),`height follows the hands at ${t}s`);
    if(m.arm<.42)assert.equal(m.opacity,0,`hidden once the hands drop at ${t}s`);
  }
});

test('the board never hangs in the air after the hands start down',()=>{
  // Hands start returning at about 2.727 s; once they are below the head the
  // board must already be gone (the old curve kept it up until 3.285 s).
  for(const t of samples.filter(t=>t>=2.73)){
    const m=quotaBoardMotion(t);
    if(m.arm<.45)assert(m.opacity<.02,`faded with the hands at ${t}s`);
  }
  assert.equal(quotaBoardMotion(3.2).opacity,0);
});

test('full lift with a light overshoot, a readable hold and a clean finish',()=>{
  const peak=Math.max(...samples.filter(t=>t<1).map(t=>quotaBoardMotion(t).arm));
  assert(peak>1&&peak<1.1,'small overshoot above the rest height');
  for(const t of [1.2,2,2.6])assert(quotaBoardMotion(t).opacity>.99,`fully readable at ${t}s`);
  const end=quotaBoardMotion(QUOTA_BOARD_SECONDS);
  assert.equal(end.arm,0);assert.equal(end.opacity,0);
});

test('the knee dip comes before the lift and the sway only during the hold',()=>{
  assert(quotaBoardMotion(.12).dip>.5,'anticipation dip at the start');
  assert(Math.abs(quotaBoardMotion(.4).sway)<1e-9);
  assert(Math.abs(quotaBoardMotion(3.3).sway)<1e-9);
  assert(Math.max(...samples.filter(t=>t>1&&t<2.6).map(t=>Math.abs(quotaBoardMotion(t).sway)))>.5);
});
