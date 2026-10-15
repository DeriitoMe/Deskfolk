import test from 'node:test';
import assert from 'node:assert/strict';
import {RepeatedTouchResponse,TOUCH_GAP_MS,TEARFUL_SECONDS} from './touch-response.ts';

test('only the tenth consecutive tap starts the reaction',()=>{
 const r=new RepeatedTouchResponse();
 for(let i=0;i<9;i++){assert.equal(r.tap(i*120),false);assert.equal(r.active(i*120),false);}
 assert.equal(r.count,9);assert.equal(r.tap(1080),true);assert.equal(r.count,0);
 assert.equal(r.deadline,1080+TEARFUL_SECONDS*1000);
});
test('a pause or clock reset starts a new count',()=>{
 const r=new RepeatedTouchResponse();for(let i=0;i<9;i++)r.tap(i*120);
 assert.equal(r.tap(960+TOUCH_GAP_MS+1),false);assert.equal(r.count,1);
 r.tap(0);assert.equal(r.count,1);
});
test('reaction does not extend on extra taps and can trigger again after recovery',()=>{
 const r=new RepeatedTouchResponse();for(let i=0;i<10;i++)r.tap(i*70);
 const until=r.deadline;
 for(let i=0;i<20;i++)assert.equal(r.tap(700+i*100),false);
 assert.equal(r.deadline,until);assert.equal(r.active(until-1),true);assert.equal(r.active(until),false);
 for(let i=0;i<9;i++)assert.equal(r.tap(until+i*70),false);
 assert.equal(r.tap(until+630),true);
});
test('cancelling an interaction clears both partial taps and the reaction',()=>{
 const r=new RepeatedTouchResponse();for(let i=0;i<9;i++)r.tap(i*100);
 r.clear();assert.equal(r.count,0);assert.equal(r.tap(1000),false);
 for(let i=0;i<9;i++)r.tap(1100+i*100);assert.equal(r.active(2000),true);
 r.clear();assert.equal(r.active(2000),false);assert.equal(r.count,0);
});
