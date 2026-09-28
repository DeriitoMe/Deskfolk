import test from 'node:test';
import assert from 'node:assert/strict';
import { GazeSpring } from './gaze.ts';
test('a pointer jump settles continuously and stays inside its bounded range at 30 and 60 Hz',()=>{
  for(const fps of [30,60]){
    const g=new GazeSpring();g.target(100,-100);let prior=0,maxStep=0;
    for(let i=0;i<fps;i++){g.step(1/fps);assert.ok(g.x>=prior&&g.x<=1);assert.ok(g.y>=-1&&g.y<=0);maxStep=Math.max(maxStep,g.x-prior);prior=g.x;}
    assert.ok(g.x>.999&&maxStep<.2);
    g.target(-1,1);for(let i=0;i<fps;i++)g.step(1/fps);
    assert.ok(g.x<-.999&&g.y>.999);
  }
});
test('invalid input and a render stall cannot fling the gaze out of range',()=>{
  const g=new GazeSpring();g.target(1,1);g.step(.016);g.target(NaN,Infinity);g.step(20);
  assert.ok(Number.isFinite(g.x)&&g.x<.5);g.step(-1);assert.ok(g.x>=0&&g.x<=1);
});
