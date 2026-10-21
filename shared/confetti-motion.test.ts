import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFETTI_END,CONFETTI_PIECES,POPPER_SHOTS,confettiFlight,confettiPiece,popperKick} from './confetti-motion.ts';
import {CELEBRATION_SECONDS} from './companion-feedback.ts';

const pieces=Array.from({length:CONFETTI_PIECES},(_,i)=>confettiPiece(i));
const times=Array.from({length:251},(_,i)=>i/100);

test('the two poppers fire one after the other, each with a short recoil',()=>{
  assert(POPPER_SHOTS[1]-POPPER_SHOTS[0]>=.06,'staggered shots');
  for(const side of [0,1] as const){
    assert.equal(popperKick(POPPER_SHOTS[side]-.01,side),0,'still before its shot');
    const peak=Math.max(...times.map(t=>popperKick(t,side)));
    assert(peak>.8&&peak<1.1,'recoil peaks near one');
    assert(Math.abs(popperKick(POPPER_SHOTS[side]+.8,side))<1e-6,'recoil has settled');
  }
});

test('confetti bursts along the barrel, slows down, then drifts down slowly',()=>{
  for(const piece of pieces){
    assert(confettiFlight(piece,piece.launch+.08,0,1).y>.15,'shoots out of the mouth first');
    const path=Array.from({length:60},(_,k)=>confettiFlight(piece,piece.launch+piece.life*k/59,0,1).y);
    const peak=Math.max(...path),apex=path.indexOf(peak);
    assert(peak>1.2&&peak<2.7,`peaks around the top of her head (${peak.toFixed(2)})`);
    assert(apex<55,'turns over and falls before it fades');
    const end=piece.launch+piece.life,v=(confettiFlight(piece,end,0,1).y-confettiFlight(piece,end-.02,0,1).y)/.02;
    assert(v<0&&v>-1.6,`drifts down slower than a stone (${v.toFixed(2)})`);
  }
});

test('every piece is hidden before launch and gone before the celebration ends',()=>{
  for(const piece of pieces){
    assert.equal(confettiFlight(piece,piece.launch-.01,0,1).opacity,0);
    assert(confettiFlight(piece,piece.launch+.06,0,1).opacity>.9,'pops in at once');
    assert(confettiFlight(piece,CONFETTI_END,0,1).opacity<1e-6,`faded by ${CONFETTI_END}s`);
  }
  assert(CONFETTI_END<=CELEBRATION_SECONDS.A);
});

test('pieces do not move in lockstep',()=>{
  const at=pieces.map(p=>confettiFlight(p,1.2,0,1));
  const xs=new Set(at.map(a=>a.x.toFixed(2))),launches=new Set(pieces.map(p=>p.launch.toFixed(3)));
  assert(xs.size>CONFETTI_PIECES*.8&&launches.size>CONFETTI_PIECES*.8);
});
