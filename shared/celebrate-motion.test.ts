import test from 'node:test';
import assert from 'node:assert/strict';
import {CELEBRATE_SECONDS,POPPER_SHOTS,celebrateMotion} from './celebrate-motion.ts';
import {CELEBRATION_SECONDS} from './companion-feedback.ts';

const step=1/240,times=Array.from({length:Math.round(CELEBRATE_SECONDS/step)+1},(_,i)=>i*step);
const channels=Object.keys(celebrateMotion(0)) as (keyof ReturnType<typeof celebrateMotion>)[];

test('fits the existing celebration slot and ends exactly at rest',()=>{
  assert.equal(CELEBRATE_SECONDS,CELEBRATION_SECONDS.A);
  const end=celebrateMotion(CELEBRATE_SECONDS);
  for(const c of channels)assert(Math.abs(end[c])<1e-3,`${c} back to rest`);
});

test('every channel moves smoothly (no pops between frames)',()=>{
  const limit:Record<string,number>={armL:.06,armR:.06,reach:.05,kickL:.13,kickR:.13,visible:.05,happy:.05};
  for(let i=1;i<times.length;i++){
    const a=celebrateMotion(times[i-1]),b=celebrateMotion(times[i]);
    for(const c of channels)assert(Math.abs(b[c]-a[c])<(limit[c]??.02),`${c} at ${times[i].toFixed(3)}s`);
  }
});

test('a real jump: dip first, feet leave the floor, poppers fire near the top',()=>{
  const jumpAt=(t:number)=>celebrateMotion(t).jump;
  assert(celebrateMotion(.42).rise<-.05,'knee dip before take-off');
  assert.equal(jumpAt(.45),0);assert.equal(jumpAt(1.0),0);
  const apex=times.reduce((a,t)=>jumpAt(t)>jumpAt(a)?t:a,0);
  assert(jumpAt(apex)>.18,'clear of the ground');
  for(const shot of POPPER_SHOTS)assert(Math.abs(shot-apex)<.08,`shot at ${shot}s is near the apex ${apex.toFixed(2)}s`);
  assert(celebrateMotion(apex).armL>1.8,'poppers overhead when they fire');
});

test('the dance sways both ways with the hair trailing behind',()=>{
  const dance=times.filter(t=>t>1.2&&t<1.8).map(t=>celebrateMotion(t));
  assert(Math.max(...dance.map(m=>m.lean))>.04&&Math.min(...dance.map(m=>m.lean))<-.04);
  assert(Math.max(...dance.map(m=>Math.abs(m.swish)))>.025);
  const reduced=celebrateMotion(.71,true).jump,full=celebrateMotion(.71).jump;
  assert(reduced<full*.5,'reduced motion keeps the jump small');
});
