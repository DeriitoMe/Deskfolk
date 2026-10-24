import test from 'node:test';
import assert from 'node:assert/strict';
import {READING_LINE_SECONDS,READING_LINES_PER_PAGE,READING_PAGE_SECONDS,readingScan} from './reading-motion.ts';

const step=1/240,samples=Array.from({length:Math.ceil(READING_PAGE_SECONDS*2/step)},(_,i)=>i*step);

test('the eyes never teleport, including across line and page boundaries',()=>{
  for(let i=1;i<samples.length;i++){
    const a=readingScan(samples[i-1]),b=readingScan(samples[i]);
    assert(Math.abs(b.x-a.x)<.06,`x continuous at ${samples[i].toFixed(3)}s`);
    assert(Math.abs(b.y-a.y)<.03,`y continuous at ${samples[i].toFixed(3)}s`);
  }
});

test('each line reads left to right and ends with one quick return sweep',()=>{
  for(let line=0;line<READING_LINES_PER_PAGE;line++){
    const start=line*READING_LINE_SECONDS;
    assert(readingScan(start+.05).x<-.4,`line ${line} starts on the left`);
    assert(readingScan(start+1.35).x>.4,`line ${line} reaches the right`);
    assert(readingScan(start+READING_LINE_SECONDS-.02).x<-.4,`line ${line} sweeps back`);
  }
});

test('lines move down the page, the pause brings the eyes back up and snaps the paper flat',()=>{
  const ys=Array.from({length:READING_LINES_PER_PAGE},(_,line)=>readingScan(line*READING_LINE_SECONDS+.5).y);
  for(let k=1;k<ys.length;k++)assert(ys[k]>ys[k-1],'each line is lower');
  const pause=samples.filter(t=>t>READING_LINES_PER_PAGE*READING_LINE_SECONDS&&t<READING_PAGE_SECONDS);
  assert(Math.max(...pause.map(t=>readingScan(t).snap))>.95,'a sharp pull outward');
  assert(Math.min(...pause.map(t=>readingScan(t).snap))<-.3,'gathered in first');
  assert.equal(readingScan(.8).snap,0);
  assert(Math.abs(readingScan(READING_PAGE_SECONDS-1e-6).snap)<1e-6,'the wobble has settled before the next page');
  assert(Math.abs(readingScan(READING_PAGE_SECONDS-1e-6).y-readingScan(0).y)<1e-3,'the next page starts where the eyes settled');
});

test('the snap repeats every few seconds',()=>{
  assert(READING_PAGE_SECONDS>4&&READING_PAGE_SECONDS<7,`${READING_PAGE_SECONDS}s between snaps`);
  for(let i=1;i<samples.length;i++)assert(Math.abs(readingScan(samples[i]).snap-readingScan(samples[i-1]).snap)<.12,`snap is continuous at ${samples[i].toFixed(3)}s`);
});
