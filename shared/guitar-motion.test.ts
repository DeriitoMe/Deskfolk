import test from 'node:test';
import assert from 'node:assert/strict';
import {GUITAR_INSPECTIONS,GUITAR_SECONDS,guitarMotion} from './guitar-motion.ts';
import {IDLE_SEQUENCE} from './idle-cadence.ts';

const step=1/240,times=Array.from({length:Math.round(GUITAR_SECONDS/step)+1},(_,i)=>i*step);

test('the guitar pastime lasts as long as napping and watering',()=>{
  const slot=(action:string)=>IDLE_SEQUENCE.find(s=>s.action===action)!.milliseconds;
  assert.equal(slot('guitar'),GUITAR_SECONDS*1000);
  assert.equal(slot('guitar'),slot('nap'));assert.equal(slot('guitar'),slot('water'));
});

test('no twitches: breath and turns are slow, only the eyes make quick small moves',()=>{
  const limit:Record<string,number>={eyeX:.04,eyeY:.02};
  for(let i=1;i<times.length;i++){
    const a=guitarMotion(times[i-1]),b=guitarMotion(times[i]);
    for(const c of Object.keys(a) as (keyof typeof a)[])assert(Math.abs(b[c]-a[c])<(limit[c]??.01),`${c} at ${times[i].toFixed(3)}s`);
  }
});

test('two inspection turns, one each way, settling back in between and at the end',()=>{
  const values=times.map(t=>guitarMotion(t).inspect);
  assert(Math.max(...values)>.99&&Math.min(...values)<-.99,'up once and down once');
  assert(Math.abs(guitarMotion(GUITAR_INSPECTIONS[0].at).inspect)<1e-9);
  assert(Math.abs(guitarMotion(GUITAR_INSPECTIONS[1].at-.1).inspect)<1e-9,'level between the turns');
  assert.equal(guitarMotion(GUITAR_SECONDS).inspect,0);
});

test('the eyes stay on the guitar and look toward the headstock while the neck is up',()=>{
  for(const t of times){const m=guitarMotion(t);assert(m.eyeY>.4&&m.eyeX>.1&&m.eyeX<.6);}
  const xs=new Set(times.map(t=>guitarMotion(t).eyeX.toFixed(2)));
  assert(xs.size>6,'the eyes move between several spots');
  assert(guitarMotion(5).eyeX>.5,'headstock during the upward turn');
  assert(Math.abs(guitarMotion(5,true).inspect)<.5,'reduced motion keeps the turns small');
});
