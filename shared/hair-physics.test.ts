import test from 'node:test';
import assert from 'node:assert/strict';
import {HairSway,MAX_HAIR_SWAY_ANGLE} from './hair-physics.ts';

const trace=(fps:number)=>{
  const hair=new HairSway(),samples:number[]=[];
  for(let frame=1;frame<=fps*3;frame++){
    const t=frame/fps,bodyAngle=.5*Math.sin(t*4),bodyVelocity=2*Math.cos(t*4);
    hair.step(1/fps,bodyAngle,bodyVelocity,true);
    assert(Math.abs(hair.angle)<=MAX_HAIR_SWAY_ANGLE);
    if(frame%(fps/30)===0)samples.push(hair.angle);
  }
  return samples;
};

test('hair follows body motion with continuous lag and a visible bounded bend',()=>{
  const hair=new HairSway();
  assert(hair.step(1/60,1.2,2,true)<0);
  assert(Math.abs(hair.angle)<.002,'the first frame does not snap to the bend limit');
  for(let frame=0;frame<120;frame++)hair.step(1/60,1.2,2,true);
  assert(hair.angle<-.17&&hair.angle>=-MAX_HAIR_SWAY_ANGLE,'a sustained large drag produces roughly ten degrees of bend');
  for(let frame=0;frame<120;frame++)hair.step(1/60,-1.2,-2,true);
  assert(hair.angle>.17&&hair.angle<=MAX_HAIR_SWAY_ANGLE);
  const velocityOnly=new HairSway();
  assert(velocityOnly.step(1/60,0,2,true)<0,'angular body motion contributes inertial lag');
});

test('a medium drag produces a larger visible tip sway',()=>{
  const hair=new HairSway();
  for(let frame=0;frame<120;frame++)hair.step(1/60,.35,0,true);
  const bendDegrees=Math.abs(hair.angle)*180/Math.PI;
  assert(bendDegrees>6&&bendDegrees<8,'a twenty-degree body tilt produces six to eight degrees of tip bend');
});

test('the same body motion stays consistent at 30, 60, 120 and 240 Hz',()=>{
  const reference=trace(240);
  // Even a 100-pixel tip radius should stay within a pixel across frame rates.
  const tipRadiusPixels=100;
  for(const fps of [30,60,120]){
    const samples=trace(fps);
    const largestDifference=Math.max(...samples.map((angle,i)=>Math.abs(angle-reference[i])));
    assert(largestDifference*tipRadiusPixels<1,`${fps} Hz diverged by ${largestDifference} radians`);
  }
});

test('stopping and releasing return the tips to rest without an opposite rebound',()=>{
  for(const held of [true,false]){
    const hair=new HairSway();
    for(let frame=0;frame<120;frame++)hair.step(1/60,.8,.4,true);
    let prior=hair.angle;
    for(let frame=0;frame<180;frame++){
      hair.step(1/60,held?0:.8,held?0:.4,held);
      assert(hair.angle>=prior-1e-8&&hair.angle<=1e-8,'the tips settle toward zero');
      prior=hair.angle;
    }
    assert(Math.abs(hair.angle)<.00001);
    assert(Math.abs(hair.angularVelocity)<.0001);
  }
});

test('invalid input leaves the finite state intact and render stalls stay bounded',()=>{
  const hair=new HairSway();hair.step(1/60,.6,1,true);
  const before={angle:hair.angle,angularVelocity:hair.angularVelocity};
  for(const input of [[NaN,.6,1],[Infinity,.6,1],[1/60,NaN,1],[1/60,.6,Infinity],[1/60,-Infinity,1],[0,.6,1],[-1,.6,1]]){
    hair.step(input[0],input[1],input[2],true);
    assert.deepEqual({angle:hair.angle,angularVelocity:hair.angularVelocity},before);
  }
  const stalled=new HairSway();stalled.step(20,1.2,20,true);
  assert(stalled.angle<0&&Math.abs(stalled.angle)<.035,'a stall advances only a short bounded interval');
  for(let frame=0;frame<600;frame++){
    const direction=frame%2?-1:1;
    stalled.step(.1,direction*1e300,direction*1e300,true);
    assert(Number.isFinite(stalled.angle)&&Number.isFinite(stalled.angularVelocity));
    assert(Math.abs(stalled.angle)<=MAX_HAIR_SWAY_ANGLE);
  }
});
