import test from 'node:test';
import assert from 'node:assert/strict';
import {tearfulReflection,tearfulWeight} from './tearful-motion.ts';
test('tear surface stays luminous while welling and tilting smoothly',()=>{
 const samples=Array.from({length:181},(_,i)=>tearfulReflection(i/60));
 assert(samples.every(p=>p.alpha===.96&&p.bulge>=2&&p.bulge<=8));
 const range=(key:'water'|'tilt'|'sheen')=>Math.max(...samples.map(p=>p[key]))-Math.min(...samples.map(p=>p[key]));
 assert(range('water')>11&&range('tilt')>9&&range('sheen')>24);
 for(let i=1;i<samples.length;i++)assert(Math.abs(samples[i].water-samples[i-1].water)<.3,'waterline must move continuously');
});
test('reaction blends in and ends at its own deadline',()=>{
 assert.equal(tearfulWeight(0),0);assert.equal(tearfulWeight(.4),1);
 assert(tearfulWeight(3.8)>0&&tearfulWeight(3.8)<1);assert.equal(tearfulWeight(4),0);
});
test('reduced motion keeps a luminous tear surface with gentler slower sway',()=>{
 const a=tearfulReflection(0,true),b=tearfulReflection(1,true),normal=tearfulReflection(1);
 assert.equal(a.alpha,b.alpha);assert(Math.abs(a.water-b.water)<Math.abs(tearfulReflection(0).water-normal.water));
 assert(Math.abs(b.water)<=6*.28&&Math.abs(b.tilt)<=5*.28);
});
