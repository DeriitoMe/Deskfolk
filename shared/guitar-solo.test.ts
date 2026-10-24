import test from 'node:test';
import assert from 'node:assert/strict';
import {GUITAR_SOLO_SECONDS,SOLO_AUDIO_AT,SOLO_AUDIO_SECONDS,SOLO_LOWER_AT,SOLO_ONSETS,SOLO_RAISE_AT,decideGuitarEgg,guitarEggChance,guitarSoloMotion} from './guitar-solo.ts';
import {guitarMotion} from './guitar-motion.ts';

const step=1/240,times=Array.from({length:Math.round(GUITAR_SOLO_SECONDS/step)+1},(_,i)=>i*step);

test('chance: never on the first guitar pastime, then 50 %, 75 %, and certain on the fourth',()=>{
  assert.deepEqual([0,1,2,3,4].map(guitarEggChance),[0,.5,.75,1,1]);
  let count=0;const seen:boolean[]=[];
  for(let i=0;i<4;i++){const d=decideGuitarEgg(count,.999);seen.push(d.egg);count=d.plainSinceEgg;}
  assert.deepEqual(seen,[false,false,false,true],'an unlucky streak still ends on the fourth');
  assert.equal(count,0,'back to the start after the egg');
  assert.deepEqual(decideGuitarEgg(1,.49),{egg:true,plainSinceEgg:0});
  assert.deepEqual(decideGuitarEgg(1,.5),{egg:false,plainSinceEgg:2});
  assert.deepEqual(decideGuitarEgg(0,0),{egg:false,plainSinceEgg:1});
});

test('the first five seconds match the plain guitar pastime',()=>{
  for(const t of times.filter(t=>t<SOLO_RAISE_AT)){
    const a=guitarSoloMotion(t),b=guitarMotion(t);
    assert.equal(a.inspect,b.inspect);assert.equal(a.eyeX,b.eyeX);assert.equal(a.raise,0);assert.equal(a.pick,0);
  }
});

test('the neck is up for the whole clip and down again before the slot ends',()=>{
  for(const t of times.filter(t=>t>=SOLO_AUDIO_AT&&t<=SOLO_LOWER_AT))assert(guitarSoloMotion(t).raise>.999,`raised at ${t.toFixed(2)}s`);
  assert.equal(guitarSoloMotion(SOLO_AUDIO_AT+SOLO_AUDIO_SECONDS+1).raise,0);
  assert(SOLO_LOWER_AT+.8<=GUITAR_SOLO_SECONDS);
  assert.equal(guitarSoloMotion(GUITAR_SOLO_SECONDS).pick,0);
});

test('a pick on every note of the clip, quiet hands outside it',()=>{
  for(const at of SOLO_ONSETS)assert(guitarSoloMotion(SOLO_AUDIO_AT+at).pick>.9,`pick at ${at}s`);
  for(const t of times.filter(t=>t<SOLO_AUDIO_AT-.2||t>SOLO_LOWER_AT+.4)){const m=guitarSoloMotion(t);assert.equal(m.pick,0);assert.equal(m.fret,0);}
});

test('smooth body motion; only the fingers move quickly',()=>{
  const limit:Record<string,number>={pick:.2,fret:.2,eyeX:.04,eyeY:.02,nod:.05};
  for(let i=1;i<times.length;i++){
    const a=guitarSoloMotion(times[i-1]),b=guitarSoloMotion(times[i]);
    for(const c of Object.keys(a) as (keyof typeof a)[])assert(Math.abs(b[c]-a[c])<(limit[c]??.02),`${c} at ${times[i].toFixed(3)}s`);
  }
});
