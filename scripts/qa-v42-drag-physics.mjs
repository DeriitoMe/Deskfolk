import assert from 'node:assert/strict';
import {DragPendulum,MAX_DRAG_ANGLE} from '../shared/drag-physics.ts';
import {mkdirSync,writeFileSync} from 'node:fs';
const run=(fps,speed,distanceFactor=1)=>{
 const p=new DragPendulum(),samples=[];let x=0;
 for(let i=0;i<fps;i++){x+=speed/fps;p.input(speed/fps,1000/fps,x*distanceFactor);p.step(1/fps,true);samples.push(p.angle);}
 const peak=Math.max(...samples.map(Math.abs));
 for(let i=0;i<fps*4;i++){p.step(1/fps,true);assert(Math.abs(p.angle)<=MAX_DRAG_ANGLE+1e-10);}
 assert(Math.abs(p.angle)<.001,'gravity returns the suspended pet to upright');
 return {peakDegrees:peak*180/Math.PI,restDegrees:p.angle*180/Math.PI};
};
const slow=run(60,60),fast=run(60,1600),short=run(60,250,.1),long=run(60,250,3);
assert(fast.peakDegrees>slow.peakDegrees*3);
assert(long.peakDegrees>short.peakDegrees);
assert(fast.peakDegrees>45&&fast.peakDegrees<=70.000001);
const rates=[30,60,120].map(fps=>({fps,...run(fps,600)}));
assert(Math.max(...rates.map(r=>r.peakDegrees))-Math.min(...rates.map(r=>r.peakDegrees))<2);
const p=new DragPendulum();for(let i=0;i<60;i++){p.input(15,1000/60,i*15);p.step(1/60,true);}assert(p.angle<0);
for(let i=0;i<60;i++){p.input(-15,1000/60,-i*15);p.step(1/60,true);}assert(p.angle>0);
const before=p.angle;p.input(NaN,Infinity,NaN);p.step(0,true);assert.equal(p.angle,before);
const flick=new DragPendulum();let flickDistance=0,flickPeak=0;
for(let i=0;i<7;i++){flickDistance+=3000/60;flick.input(3000/60,1000/60,flickDistance);flick.step(1/60,true);flickPeak=Math.max(flickPeak,Math.abs(flick.angle));}
for(let i=0;i<180;i++){flick.step(1/60,true);flickPeak=Math.max(flickPeak,Math.abs(flick.angle));}
assert(flickPeak*180/Math.PI<40,'brief fast flick stays well below the angle limit');
const report={passed:true,maximumDegrees:70,damping:16,spring:40,speedFilterMs:90,briefFlickPeakDegrees:flickPeak*180/Math.PI,slow,fast,short,long,rates,oppositeDirection:true,invalidInputIgnored:true};
mkdirSync('.cache/companion-polish-checks',{recursive:true});writeFileSync('.cache/companion-polish-checks/physics.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
