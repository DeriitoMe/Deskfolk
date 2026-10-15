import assert from 'node:assert/strict';
import {DragPendulum,MAX_DRAG_ANGLE} from '../shared/drag-physics.ts';
import {mkdirSync,writeFileSync} from 'node:fs';
const degrees=radians=>radians*180/Math.PI;
const run=(fps,speed,distanceFactor=1)=>{
 const p=new DragPendulum(),samples=[];let x=0;
 for(let i=0;i<fps;i++){x+=speed/fps;p.input(speed/fps,1000/fps,x*distanceFactor);p.step(1/fps,true);samples.push(p.angle);}
 const movingPeak=Math.max(...samples.map(Math.abs));
 for(let i=0;i<fps*4;i++){
  p.step(1/fps,true);samples.push(p.angle);
  assert(Math.abs(p.angle)<=MAX_DRAG_ANGLE+1e-10);
  assert(p.angle<=1e-10,'an overdamped hang settles without crossing upright');
 }
 assert(Math.abs(p.angle)<.001,'gravity returns the suspended pet to upright');
 return {peakDegrees:degrees(Math.max(...samples.map(Math.abs))),movingPeakDegrees:degrees(movingPeak),restDegrees:degrees(p.angle)};
};
const slow=run(60,60),fast=run(60,1600),short=run(60,250,.1),long=run(60,250,3);
assert(fast.peakDegrees>slow.peakDegrees*3);
assert(long.peakDegrees>short.peakDegrees);
assert(fast.peakDegrees>45&&fast.peakDegrees<=70.000001);
const rates=[30,60,120,240].map(fps=>({fps,...run(fps,600)}));
const frameRateSpreadDegrees=Math.max(...rates.map(r=>r.peakDegrees))-Math.min(...rates.map(r=>r.peakDegrees));
assert(frameRateSpreadDegrees<.6,'drag weight stays consistent across display frame rates');
const p=new DragPendulum();for(let i=0;i<60;i++){p.input(15,1000/60,i*15);p.step(1/60,true);}assert(p.angle<0);
for(let i=0;i<60;i++){p.input(-15,1000/60,-i*15);p.step(1/60,true);}assert(p.angle>0);
const before={angle:p.angle,angularVelocity:p.angularVelocity};
p.input(NaN,Infinity,NaN);p.step(0,true);p.step(NaN,true);p.step(Infinity,true);p.step(-1,true);
assert.deepEqual({angle:p.angle,angularVelocity:p.angularVelocity},before,'invalid input and frame durations leave the finite suspension state intact');
p.begin();assert.deepEqual({angle:p.angle,angularVelocity:p.angularVelocity},before,'regrabbing preserves the physical angle and velocity');
const flick=new DragPendulum();let flickDistance=0,flickPeak=0;
for(let i=0;i<7;i++){flickDistance+=3000/60;flick.input(3000/60,1000/60,flickDistance);flick.step(1/60,true);flickPeak=Math.max(flickPeak,Math.abs(flick.angle));}
for(let i=0;i<180;i++){flick.step(1/60,true);flickPeak=Math.max(flickPeak,Math.abs(flick.angle));}
assert(degrees(flickPeak)<25,'brief fast flick stays well below the angle limit');
const sustained=new DragPendulum();let sustainedPeak=0;
for(let i=0;i<180;i++){
 sustained.input(6000/60,1000/60,i*6000/60);sustained.step(1/60,true);
 sustainedPeak=Math.max(sustainedPeak,Math.abs(sustained.angle));
 assert(Math.abs(sustained.angle)<MAX_DRAG_ANGLE,'sustained force approaches the bound without hitting a hard stop');
}
assert(degrees(sustainedPeak)>65,'the full hang remains available during sustained rapid motion');
for(let i=0;i<300;i++){sustained.step(1/60,false);assert(Math.abs(sustained.angle)<=MAX_DRAG_ANGLE);}
assert(Math.abs(sustained.angle)<.0001,'release settles under gravity');
const resumed=new DragPendulum(),fresh=new DragPendulum();
for(let i=0;i<60;i++){resumed.input(1600/60,1000/60,i*1600/60);resumed.step(1/60,true);}
for(let i=0;i<360;i++)resumed.step(1/60,true);
for(const pendulum of [resumed,fresh]){pendulum.input(2,1000/60,2);pendulum.step(1/60,true);}
const resumedDeltaDegrees=degrees(Math.abs(resumed.angle-fresh.angle));
assert(resumedDeltaDegrees<.001,'a resumed drag does not reuse speed from before the pause');
const jitter=new DragPendulum();let elapsed=0,jitterX=0,jitterPeak=0,jitterFrame=0;
const intervals=[1/30,1/120,1/50,1/90];
while(elapsed<1){
 const dt=Math.min(intervals[jitterFrame++%intervals.length],1-elapsed);elapsed+=dt;jitterX+=600*dt;
 jitter.input(600*dt,dt*1000,jitterX);jitter.step(dt,true);jitterPeak=Math.max(jitterPeak,Math.abs(jitter.angle));
}
for(let i=0;i<240;i++){jitter.step(1/60,true);jitterPeak=Math.max(jitterPeak,Math.abs(jitter.angle));}
assert(Math.abs(degrees(jitterPeak)-rates.find(r=>r.fps===60).peakDegrees)<.6,'jittered frame timing preserves the drag curve');
const report={passed:true,maximumDegrees:70,damping:22,spring:44,speedFilterMs:120,inputDecayMs:280,softSaturation:true,continuousDirection:true,briefFlickPeakDegrees:degrees(flickPeak),sustainedPeakDegrees:degrees(sustainedPeak),frameRateSpreadDegrees,resumedDeltaDegrees,jitterPeakDegrees:degrees(jitterPeak),slow,fast,short,long,rates,oppositeDirection:true,invalidInputIgnored:true,regrabContinuity:true};
mkdirSync('.cache/companion-polish-checks',{recursive:true});writeFileSync('.cache/companion-polish-checks/physics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
