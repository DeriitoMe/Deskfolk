import test from 'node:test';
import assert from 'node:assert/strict';
import {TouchVoice} from './touch-voice.ts';

function fixture() {
  const calls: string[] = [], audio: Array<{src:string;paused:boolean;currentTime:number}> = [];
  const voice = new TouchVoice({'headpat':'tap.wav','tearful-first':'a.wav','tearful-second':'b.wav'}, () => {
    const element = {src:'',paused:true,currentTime:0,preload:'',loop:false,volume:1,
      load(){},removeAttribute(){this.src='';},
      pause(){this.paused=true;},play(){this.paused=false;calls.push(this.src);return Promise.resolve();}};
    audio.push(element);
    return element as unknown as HTMLAudioElement;
  });
  return {voice,calls,audio};
}

test('ordinary rapid taps reuse the cached short voice with one active clip',()=>{
  const {voice,calls,audio}=fixture();
  for(let i=0;i<30;i++)voice.tap(false,false);
  assert.equal(calls.length,30);assert(calls.every(src=>src==='tap.wav'));
  assert.equal(audio.length,3);assert.equal(audio.filter(a=>!a.paused).length,1);
});

test('four completed reactions use first, second, first, second regardless of ordinary taps',()=>{
  const {voice,calls}=fixture();
  for(let round=0;round<4;round++){
    for(let tap=0;tap<9;tap++)voice.tap(false,false);
    voice.tap(true,true);
    const count=calls.length;
    for(let tap=0;tap<20;tap++)voice.tap(false,true);
    assert.equal(calls.length,count,'reaction clicks cannot restart or replace its voice');
  }
  assert.deepEqual(calls.filter(src=>src!=='tap.wav'),['a.wav','b.wav','a.wav','b.wav']);
});

test('interruptions do not reset the reaction order and partial ordinary taps cannot advance it',()=>{
  const {voice,calls}=fixture();
  voice.tap(true,true);voice.stop();
  for(let i=0;i<4;i++)voice.tap(false,false);
  voice.stop();voice.tap(true,true);
  assert.deepEqual(calls.filter(src=>src!=='tap.wav'),['a.wav','b.wav']);
});

test('do-not-disturb silences clips without changing which reaction was triggered',()=>{
  const {voice,calls}=fixture();
  voice.tap(true,true,false);voice.tap(false,true,false);
  assert.equal(calls.length,0);
  assert.equal(voice.tap(true,true),'tearful-second');assert.deepEqual(calls,['b.wav']);
});
