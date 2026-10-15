import test from 'node:test';
import assert from 'node:assert/strict';
import {OrbitGesture} from './orbit-gesture.ts';
function circle(gesture:OrbitGesture,laps:number,start=0,sign=1,enabled=true){let triggered=0;for(let i=0;i<=laps*120;i++){const a=i/120*Math.PI*2*sign;if(gesture.sample(Math.cos(a)*100,Math.sin(a)*100,220,start+i*16,enabled))triggered++;}return triggered;}
test('three clockwise and counterclockwise laps each trigger exactly once',()=>{for(const sign of [-1,1])assert.equal(circle(new OrbitGesture(),3,0,sign),1);});
test('two laps are insufficient and a busy action clears partial progress',()=>{const g=new OrbitGesture();assert.equal(circle(g,2),0);g.sample(100,0,220,4000,false);assert.equal(circle(g,1,4200),0);});
test('reversing direction starts a new count',()=>{const g=new OrbitGesture();circle(g,2);assert.equal(circle(g,2,4000,-1),0);assert.equal(circle(g,1,8000,-1),1);});
test('a pause or leaving the pet orbit cancels accumulated laps',()=>{for(const leave of [true,false]){const g=new OrbitGesture();circle(g,2);if(leave)g.sample(800,0,220,4000,true);assert.equal(circle(g,1,leave?4200:5500),0);}});
test('teleports and radial movement do not produce laps',()=>{const g=new OrbitGesture();for(let i=0;i<40;i++){g.sample(i%2?100:-100,0,220,i*20,true);}assert(g.laps<1);});
test('continuous circling cannot immediately retrigger during recovery',()=>{const g=new OrbitGesture();assert.equal(circle(g,3),1);assert.equal(circle(g,3,5800),0);assert.equal(circle(g,3,12000),1);});
test('native cursor quantization and small reversals preserve a real three-lap gesture',()=>{
  for(const sign of [-1,1]){
    const g=new OrbitGesture();let at=0,triggered=0;
    const sample=(a:number)=>{if(g.sample(Math.round(Math.cos(a)*100),Math.round(Math.sin(a)*100),220,at,true))triggered++;at+=16;};
    sample(0);
    for(let i=1;i<=360;i++){
      const a=i/120*Math.PI*2*sign;
      sample(a);
      // Around two degrees of reverse hand movement used to erase all progress.
      if(i%11===0&&i<350){sample(a-.035*sign);sample(a);}
    }
    assert.equal(triggered,1);
  }
});
test('small back-and-forth shaking adds no laps',()=>{
  const g=new OrbitGesture();
  for(let i=0;i<1500;i++){const a=i%2?.05:0;assert.equal(g.sample(Math.cos(a)*100,Math.sin(a)*100,220,i*16,true),false);}
  assert(g.laps<.02);
});
test('a gradual reversal is recognized even when every individual step is tiny',()=>{
  const g=new OrbitGesture();circle(g,2);
  for(let i=1;i<=70;i++){const a=-i*.003;g.sample(Math.cos(a)*100,Math.sin(a)*100,220,3840+i*16,true);}
  assert(g.laps>.025&&g.laps<.04,'the new direction starts at its reverse travel, not the previous two laps');
});
test('stationary native cursor updates cannot keep an interrupted orbit alive',()=>{
  const g=new OrbitGesture();circle(g,2);
  g.sample(100,0,220,4340,true);
  g.sample(100,0,220,4840,true);
  assert.equal(circle(g,1,5000),0);
  assert(g.laps<=1.01);
});
test('normal horizontal cursor traversals cannot trigger dizziness',()=>{
  const g=new OrbitGesture();
  for(let i=0;i<1600;i++){
    const x=-300+(i%120<60?i%120:120-i%120)*10;
    assert.equal(g.sample(x,35,220,i*16,true),false);
  }
});
test('compact face circles and tall elliptical orbits trigger in either direction',()=>{
  for(const [rx,ry] of [[50,50],[120,50],[70,340]])for(const sign of [-1,1]){
    const g=new OrbitGesture();let triggered=0;
    for(let i=0;i<=360;i++){
      const a=i/120*Math.PI*2*sign;
      if(g.sample(Math.round(Math.cos(a)*rx),Math.round(Math.sin(a)*ry),222,i*16,true))triggered++;
    }
    assert.equal(triggered,1,`${rx} by ${ry}, direction ${sign}`);
  }
});
test('tiny near-center loops and distant circles remain outside the gesture range',()=>{
  for(const radius of [35,420]){
    const g=new OrbitGesture();
    for(let i=0;i<=600;i++){const a=i/120*Math.PI*2;assert.equal(g.sample(Math.cos(a)*radius,Math.sin(a)*radius,222,i*16,true),false);}
    assert.equal(g.laps,0);
  }
});
test('slow continuous angular movement counts without becoming a false pause',()=>{
  const g=new OrbitGesture();let triggered=0;
  for(let i=0;i<=10800;i++){const a=i/3600*Math.PI*2;if(g.sample(Math.cos(a)*100,Math.sin(a)*100,222,i*16,true))triggered++;}
  assert.equal(triggered,1);
});
