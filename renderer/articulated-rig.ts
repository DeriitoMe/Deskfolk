import { GazeSpring } from '../shared/gaze';
/** V39: editable anatomy, measured idle cadence, authored angle keys and registered spin frames. */
export type RigAction = 'idle' | 'nap' | 'water' | 'water-happy' | 'work' | 'ask' | 'touch' | 'drag' | 'transform';
export const TURN_SECONDS=10.2;
export const GRAND_SCALE=2.0; // Supplied original: 390 physical pixels tall at default scale.
export const EXPORT_LAYERS=['hair_back','foot_left','foot_right','body','arm_left','arm_right','head','hair_front','eye_left','eye_right','props','hand_left','hand_right','question','celebration','sleep','turn'];
const files=import.meta.glob<string>(['../assets/characters/wakaba-mutsumi/v40-motion/layers/*.png','!../assets/characters/wakaba-mutsumi/v40-motion/layers/turn-*.png'],{eager:true,query:'?url',import:'default'});
const urls=Object.fromEntries(Object.entries(files).map(([p,u])=>[p.split('/').pop()!.replace('.png',''),u]));
const TAU=Math.PI*2;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ease=(v:number)=>{v=clamp(v);return v*v*(3-2*v);};
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
type Pose={lift:number;bodyY:number;bodyAngle:number;headAngle:number;headX:number;headY:number;yaw:number;
 armL:number;armR:number;footL:number;footR:number;spread:number;nap:number;water:number;work:number;ask:number;touch:number;drag:number;happy:number;kick:number;open:number;gaze:number};
const neutral=():Pose=>({lift:0,bodyY:0,bodyAngle:0,headAngle:0,headX:0,headY:0,yaw:0,armL:0,armR:0,footL:0,footR:0,spread:0,nap:0,water:0,work:0,ask:0,touch:0,drag:0,happy:0,kick:0,open:1,gaze:0});
const mixPose=(a:Pose,b:Pose,t:number):Pose=>Object.fromEntries(Object.keys(a).map(k=>[k,lerp(a[k as keyof Pose],b[k as keyof Pose],t)])) as Pose;
type Transform={x?:number;y?:number;angle?:number;sx?:number;sy?:number;px?:number;py?:number;alpha?:number};
export class MutsumiRig {
 readonly canvas=document.createElement('canvas'); readonly ready:Promise<void>;
 readonly images=new Map<string,HTMLImageElement>();
 private bounds=new Map<string,[number,number,number,number]>();
 private ctx:CanvasRenderingContext2D; private loaded=false;private running=true;private raf=0;
 private turnSurface=document.createElement('canvas');
 private look=new GazeSpring();
 private viewportTall=false;onViewportChange?:()=>void;
 private previous=0;private actionStart=performance.now();private pausedAt=0;private velocity=0;
 private from=neutral();private current=neutral();private routeNeutral=false;private release=false;private finished=false;
 action:RigAction='idle';reducedMotion=false;frameLimit:30|60=60;frames=0;frameIntervals:number[]=[];
 onTransientEnd?:()=>void;
 constructor(){
  this.canvas.width=512;this.canvas.height=512;this.canvas.className='pet-art mutsumi-canvas';this.canvas.dataset.dragHandle='';this.canvas.setAttribute('aria-label','若叶睦');
  this.ctx=this.canvas.getContext('2d',{willReadFrequently:true})!;
  this.turnSurface.width=512;this.turnSurface.height=512;
  this.ready=Promise.all(Object.entries(urls).map(async([name,url])=>{
   const img=new Image();img.src=url;await img.decode();this.images.set(name,img);
   if(name.startsWith('spin-'))return;
   const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d')!;x.drawImage(img,0,0);
   const a=x.getImageData(0,0,img.width,img.height).data;let x1=img.width,y1=img.height,x2=-1,y2=-1;
   for(let y=0;y<img.height;y++)for(let xx=0;xx<img.width;xx++)if(a[(y*img.width+xx)*4+3]>16){x1=Math.min(x1,xx);x2=Math.max(x2,xx);y1=Math.min(y1,y);y2=Math.max(y2,y);}
   this.bounds.set(name,[x1,y1,Math.max(0,x2-x1+1),Math.max(0,y2-y1+1)]);
  })).then(()=>{this.loaded=true;this.actionStart=performance.now();this.loop(this.actionStart);});
 }
 dispose(){this.running=false;cancelAnimationFrame(this.raf);}
 setPaused(p:boolean){if(p&&!this.pausedAt)this.pausedAt=performance.now();else if(!p&&this.pausedAt){this.actionStart+=performance.now()-this.pausedAt;this.pausedAt=0;}}
 setAction(action:RigAction){
  if(action===this.action)return;
  this.from={...this.current};this.release=this.action==='drag';
  this.routeNeutral=(this.action==='nap'&&(action==='water'||action==='work'))||(this.action==='water'&&action!=='drag'&&action!=='water'&&action!=='water-happy');
  this.resizeCanvas(action==='transform');
  this.action=action;this.actionStart=performance.now();this.finished=false;this.canvas.dataset.action=action;
 }
 private resizeCanvas(tall:boolean){if(tall===this.viewportTall)return;this.viewportTall=tall;this.canvas.width=tall?768:512;this.canvas.height=tall?1152:512;this.canvas.dataset.tall=String(tall);this.onViewportChange?.();}
 setLookTarget(x:number,y:number){this.look.target(x,y);}
 cancelToIdle(){this.from=neutral();this.current=neutral();this.routeNeutral=false;this.release=false;this.action='idle';this.actionStart=performance.now();this.finished=false;this.canvas.dataset.action='idle';this.resizeCanvas(false);this.draw(this.current,0);}
 /** Deterministic editorial pose for native eye-layer exports, separate from live smoothing. */
 renderGazeAt(x:number,y:number,t=0,only?:string){this.look.snap(x,y);this.renderAt('idle',t,1,only);}
 setDragVelocity(dx:number){this.velocity=lerp(this.velocity,Math.max(-12,Math.min(12,dx)),.45);}
 hit(cx:number,cy:number){const r=this.canvas.getBoundingClientRect();const x=Math.floor((cx-r.left)*this.canvas.width/r.width),y=Math.floor((cy-r.top)*this.canvas.height/r.height);return x>=0&&y>=0&&x<this.canvas.width&&y<this.canvas.height&&this.ctx.getImageData(x,y,1,1).data[3]>40;}
 private loop=(now:number)=>{
  if(!this.running)return;this.raf=requestAnimationFrame(this.loop);if(this.pausedAt)return;
  const dt=now-this.previous;if(dt<1000/this.frameLimit-2)return;
  if(this.previous&&dt<1000){this.frameIntervals.push(dt);if(this.frameIntervals.length>600)this.frameIntervals.shift();}
  this.look.step(this.previous?dt/1000:1/60);
  this.previous=now;this.frames++;const age=(now-this.actionStart)/1000;
  if(this.action==='transform')this.renderAt('transform',age);
  else {this.current=this.transition(this.from,this.action,age,this.routeNeutral,this.release);this.draw(this.current,this.reducedMotion?.65:age);}
  this.velocity*=.9;
  if(!this.finished&&((this.action==='transform'&&age>=TURN_SECONDS)||(this.action==='touch'&&age>=1.15))){this.finished=true;this.onTransientEnd?.();}
 };
 private target(action:RigAction,t:number):Pose{
  if(this.reducedMotion)t=.65;
  const p=neutral(),w=Math.sin(t*TAU/3.7);p.bodyY=w*.8;p.headY=w*.35;p.gaze=w*.65;
  const b=t%4.3;p.open=b<3.78?1:b<3.94?1-ease((b-3.78)/.16):b<4.01?0:ease((b-4.01)/.23);
  if(action==='nap'){p.nap=1;p.open=.015;p.headAngle=.025;p.bodyY=2+w*1.7;p.headY=2+w*.6;}
  if(action==='water'){p.water=1;p.yaw=-.21;p.headX=-3;p.gaze=-3;p.spread=-1.5;p.bodyAngle=-.025;p.armL=Math.sin(t*1.9)*.018;p.armR=Math.sin(t*1.9+.4)*.014;}
  if(action==='water-happy'){p.happy=1-ease((t-2.6)/1);p.open=lerp(1,.48,p.happy);p.headY-=p.happy*1.2;p.bodyY-=p.happy*.8;}
  if(action==='work'){p.work=1;p.spread=4;p.armL=.12;p.armR=-.12;p.open=1;p.bodyY=Math.sin(t*TAU/2.8)*.4;}
  if(action==='ask'){p.ask=1;p.yaw=-.22;p.headX=-4;p.gaze=-4;p.open=1;p.headAngle=-.025;}
  if(action==='touch'){p.touch=1;p.open=1;p.bodyY=-1;}
  if(action==='drag'){
   p.drag=1;p.lift=-14;p.bodyAngle=.12+Math.sin(t*7)*.07-this.velocity*.003;
   p.headAngle=-.18+Math.sin(t*6+.8)*.035;p.headX=-3;p.headY=2;
   p.armL=-.42+Math.sin(t*14)*.25;p.armR=.40+Math.sin(t*12+.9)*.27;
   p.footL=.18+Math.sin(t*13)*.27;p.footR=-.19+Math.sin(t*15+1.5)*.25;
   p.open=.68+Math.sin(t*8)*.18;p.gaze=Math.sin(t*6)*2;
  }
  return p;
 }
 private transition(from:Pose,action:RigAction,t:number,route:boolean,release:boolean){
  if(route&&t<.38)return mixPose(from,neutral(),ease(t/.38));
  const start=route?neutral():from,age=Math.max(0,t-(route?.38:0));
  const duration=release?.65:action==='drag'?.24:action==='water'?1.6:action==='nap'?.85:action==='water-happy'?.55:.42;
  const p=mixPose(start,this.target(action,age),ease(age/duration));
  if(release&&age<.65)p.bodyY+=Math.sin(Math.PI*age/.65)*3;
  return p;
 }
 /** Export includes entering poses. Use transition sampler to review exits/interruption. */
 renderAt(action:RigAction,t:number,_blend=1,only?:string){
  if(!this.loaded)return;
  this.resizeCanvas(action==='transform');
  if(action==='transform'){this.clear();this.turn(t,only);return;}
  this.current=this.transition(neutral(),action,t,false,false);this.draw(this.current,t,only);
 }
 renderTransitionAt(from:RigAction,to:RigAction,t:number,only?:string){
  this.resizeCanvas(false);
  const route=(from==='nap'&&(to==='water'||to==='work'))||(from==='water'&&to!=='drag'&&to!=='water-happy');
  this.current=this.transition(this.target(from,2),to,t,route,from==='drag');this.draw(this.current,t,only);
 }
 private clear(){const c=this.ctx;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,this.canvas.width,this.canvas.height);c.imageSmoothingEnabled=true;}
 private part(name:string,tr:Transform={}){
  const key='front-'+name,img=this.images.get(key);if(!img)return;
  const [x,y,w,h]=this.bounds.get(key)!;if(!w||!h)return;
  const c=this.ctx,px=tr.px??256,py=tr.py??310;c.save();c.globalAlpha*=tr.alpha??1;c.translate(px+(tr.x??0),py+(tr.y??0));c.rotate(tr.angle??0);c.scale(tr.sx??1,tr.sy??1);c.drawImage(img,x,y,w,h,x-px,y-py,w,h);c.restore();
 }
 private asset(name:string,x:number,y:number,w:number,h=w){const img=this.images.get(name);if(img)this.ctx.drawImage(img,x,y,w,h);}
 private draw(p:Pose,t:number,only?:string){
  this.clear();const c=this.ctx,yes=(name:string)=>!only||only===name;
  c.save();c.translate(256,325+p.lift+p.bodyY);c.rotate(p.bodyAngle);c.translate(-256,-325);
  const headSpace=()=>{c.translate(256+p.headX,305+p.headY);c.rotate(p.headAngle);c.scale(1-Math.abs(p.yaw)*.42,1);c.translate(-256,-305);};
  if(yes('hair_back')){c.save();headSpace();this.part('hair_back_left',{x:p.yaw*9});this.part('hair_back_right',{x:p.yaw*9});c.restore();}
  if(yes('foot_left'))this.part('leg_left',{x:-p.spread,angle:p.footL,px:236,py:427});
  if(yes('foot_right'))this.part('leg_right',{x:p.spread,y:-p.kick,angle:p.footR,px:275,py:427});
  if(yes('body')){this.part('body');if(p.drag>.01){c.save();c.globalAlpha=p.drag;c.fillStyle='#47495f';c.beginPath();c.moveTo(280,333);c.quadraticCurveTo(292,307,303,316);c.lineTo(296,341);c.fill();c.strokeStyle='#68677d';c.lineWidth=2;c.beginPath();c.moveTo(299,319);c.lineTo(287,335);c.stroke();c.restore();}}
  const arm=(left:boolean)=>{
   const px=left?210:298,py=344,wx=left?193:318,wy=405;
   let angle=left?p.armL:p.armR,scale=1;
   let targetX=lerp(wx,left?223:263,p.water),targetY=lerp(wy,left?363:385,p.water);
   targetX=lerp(targetX,left?198:311,p.touch);targetY=lerp(targetY,298,p.touch);
   if(p.water>.001||p.touch>.001){angle+=Math.atan2(targetY-py,targetX-px)-Math.atan2(wy-py,wx-px);scale=Math.hypot(targetX-px,targetY-py)/Math.hypot(wx-px,wy-py);}
   const x=px+(wx-px)*scale*Math.cos(angle)-(wy-py)*scale*Math.sin(angle),y=py+(wx-px)*scale*Math.sin(angle)+(wy-py)*scale*Math.cos(angle);
   return {sleeve:{px,py,angle,sx:scale,sy:scale},hand:{x:x-wx,y:y-wy,px:wx,py:wy,angle:angle*.25,sx:1+p.work*.06,sy:1-p.work*.07}};
  };
  const l=arm(true),r=arm(false);
  if(yes('arm_left'))this.part('sleeve_left',l.sleeve);if(yes('arm_right'))this.part('sleeve_right',r.sleeve);
  c.save();headSpace();
  if(yes('head'))this.part('face');if(yes('hair_front'))this.part('hair_front',{x:p.yaw*9});
  for(let i=0;i<2;i++)if(yes(i?'eye_right':'eye_left'))this.eye(i,p,t);
  c.restore();
  if(yes('props')&&p.water>.001){
   c.save();c.globalAlpha=p.water;this.asset('planter',96,391,89);c.save();c.translate(225,383);c.rotate(-.18+Math.sin(t*2)*.035);this.asset('watering-can',-39,-34,82);c.restore();
   const pouring=ease((p.water-.8)/.2);c.lineCap='round';
   // Separate bright droplets and coherent fine streams meet the pot rather than hanging in mid-air.
   for(let stream=0;stream<4;stream++){c.globalAlpha=pouring*.35;c.strokeStyle='#70b8cc';c.lineWidth=1.5;c.beginPath();c.moveTo(189,381+stream*1.3);c.quadraticCurveTo(170,389,151+stream*6,410);c.stroke();}
   for(let i=0;i<27;i++){const q=(t*2.65+i/27)%1,fan=(i%5)-2;const x=189-q*(30+fan*4),y=383+q*12+q*q*17;
    c.globalAlpha=pouring*(.5+.45*Math.sin(q*Math.PI));c.strokeStyle=i%3===0?'#e5faff':'#73c4df';c.lineWidth=i%3===0?2.5:2;
    c.beginPath();c.moveTo(x,y);c.lineTo(x-1.7,y+3.8);c.stroke();}
   for(let i=0;i<5;i++){const q=(t*2+i*.2)%1;c.globalAlpha=pouring*(1-q)*.8;c.strokeStyle='#b7eaff';c.lineWidth=1.7;c.beginPath();c.arc(147+i*5+q*3,413-Math.sin(q*Math.PI)*4,1.4,0,TAU);c.stroke();}c.restore();
  }
  if(yes('hand_left'))this.part('hand_left',l.hand);if(yes('hand_right'))this.part('hand_right',r.hand);
  if(yes('question')&&p.ask>.001){c.save();c.globalAlpha=p.ask;const size=57*(.75+.25*p.ask+Math.exp(-t*5)*Math.sin(t*15)*.12);this.asset('question-mark',371+(57-size)/2,88+Math.sin(t*2)*1.5,size);c.restore();}
  if(yes('sleep')&&p.nap>.001){
   for(let i=0;i<3;i++){const age=(t-i*.34)%3.4;if(age<0)continue;const q=age/3.4,size=13+q*17;
    c.save();c.globalAlpha=p.nap*ease(q/.12)*(1-ease((q-.73)/.27));
    this.asset('sleep-z',349+q*48+i*7,217-q*170-i*7,size,size);c.restore();
   }
  }
  c.restore();
  if(p.happy>.001){
   // Warm light affects existing opaque paint only, leaving the desktop transparent.
   c.save();c.globalCompositeOperation='source-atop';c.globalAlpha=p.happy*.13;c.fillStyle='#ffc576';c.fillRect(0,0,512,512);c.restore();
   if(yes('celebration'))for(let i=0;i<5;i++){
    const phase=t*1.5+i*TAU/5,xx=256+Math.cos(phase)*(135+i%2*15),yy=200-i%3*28+Math.sin(phase)*28;
    c.save();c.globalAlpha=p.happy*.9;c.translate(xx,yy);c.rotate(t*1.8+i);c.scale(1,.65+.25*Math.sin(phase));this.asset('happy-flower',-15,-15,30);c.restore();
   }
  }
 }
 private eye(i:number,p:Pose,t:number){
  const c=this.ctx,x=i?307:203,cy=261;
  const tracking=(1-p.nap)*(1-p.touch)*(1-p.happy)*(1-p.water*.65)*(1-p.ask*.5)*(1-p.drag*.55);
  const gx=this.look.x*tracking,gy=this.look.y*tracking;
  const perspective=1+(i?-1:1)*(p.yaw*.6+gx*.04);const scaleX=perspective;
  c.save();c.translate(x+p.gaze+p.yaw*22+gx*7,cy+gy*3.2);c.scale(scaleX,1+(perspective-1)*.5-gy*.015);
  const open=Math.max(.045,p.open);c.scale(1,open);
  const w=lerp(18,i?53:49,p.ask),h=lerp(43,i?60:56,p.ask);
  c.save();c.globalAlpha=1-p.ask;c.fillStyle=p.work>.01?'#dbb055':'#bd8338';
  c.beginPath();c.ellipse(0,0,9,21.5,0,0,TAU);c.fill();
  if(p.work>.001){
   c.clip();c.globalAlpha=p.work;
   for(let band=0;band<3;band++){const y=-36+((t/.42+band/3+i*.055)%1)*78;
    const g=c.createLinearGradient(0,y,0,y+12);g.addColorStop(0,'#fff4c000');g.addColorStop(.55,'#fff7d0');g.addColorStop(1,'#fff4c000');c.fillStyle=g;c.fillRect(-10,y,20,12);}
   c.fillStyle='#fff9dc';for(let lane=0;lane<3;lane++){const y=-28+((t/(.29+lane*.045)+lane*.31+i*.09)%1)*60;c.globalAlpha=p.work*(.5+lane*.1);c.fillRect(-6+lane*5,y,2.5,4.5+lane);}
  }c.restore();
  if(p.happy>.001){c.save();c.globalAlpha=p.happy;c.fillStyle='#ffebe3';c.fillRect(-12,-25,24,50);c.strokeStyle='#ac783a';c.lineWidth=3.5;c.lineCap='round';c.beginPath();c.moveTo(-7,3);c.quadraticCurveTo(0,-9,7,3);c.stroke();c.restore();}
  if(p.ask>.001){c.save();c.globalAlpha=p.ask;this.asset('eye-question',-w/2,-h/2,w,h);c.restore();}
  c.restore();
  if(p.touch>.001){c.save();c.globalAlpha=p.touch;c.fillStyle='#ffebe3';c.beginPath();c.ellipse(x+p.gaze,cy,13,24,0,0,TAU);c.fill();c.strokeStyle='#725735';c.lineWidth=4;c.lineCap='round';c.lineJoin='round';const s=i?-1:1;c.beginPath();c.moveTo(x-6*s,cy-8);c.lineTo(x+4*s,cy);c.lineTo(x-6*s,cy+8);c.stroke();c.restore();}
 }
 /** 16 painted angles per form, registered native Aseprite cels, 30 Hz temporal sampling. */
 private turn(t:number,only?:string){
  if(only&&only!=='turn')return;
  t=Math.min(TURN_SECONDS,Math.floor(t*30)/30);
  const c=this.ctx;let kind:'q'|'grand'='q',angle=0,flash=0,scale=1;
  const qStart=.7,qEnd=2.3,grandEnd=5.5,holdStart=6,holdEnd=8;
  if(t<qEnd){const u=clamp((t-qStart)/(qEnd-qStart));angle=TAU*u*u*(2-u);flash=ease((t-1.85)/.45);}
  else if(t<holdEnd){kind='grand';const u=clamp((t-qEnd)/(grandEnd-qEnd));angle=TAU*(1-Math.pow(1-u,3));flash=1-ease((t-qEnd)/.45);scale=GRAND_SCALE;}
  else if(t<8.7){kind='grand';angle=TAU+Math.PI*ease((t-holdEnd)/.7);scale=GRAND_SCALE;flash=ease((t-8.3)/.4);}
  else{angle=Math.PI+Math.PI*ease((t-8.7)/.9);flash=1-ease((t-8.7)/.45);}
  const drawSpin=(opacity:number)=>{
   const atlas=this.images.get('spin-'+kind+'-atlas');if(!atlas)return;
   let frame=Math.min(95,Math.floor((((angle/TAU)%1+1)%1)*96));const n=384;
   const buffer=this.turnSurface.getContext('2d')!;buffer.clearRect(0,0,512,512);
   const resting=kind==='grand'&&t>=grandEnd&&t<holdEnd+.18;
   if(resting){
    const u=t<holdEnd?ease((t-grandEnd)/(holdStart-grandEnd)):1-ease((t-holdEnd)/.18);
    const rest=this.images.get('spin-grand-rest-atlas');
    if(u>=.999){buffer.drawImage(this.images.get('grand-idle')!,0,0);}
    else if(rest){const f=Math.min(15,Math.floor(u*15));buffer.drawImage(rest,(f%12)*n,Math.floor(f/12)*n,n,n,0,0,512,512);}
    else buffer.drawImage(atlas,0,0,n,n,0,0,512,512);
   } else {
    const settle=kind==='grand'?1-ease((t-4.3)/1.2):1,flutter=kind==='grand'?Math.sin(t*7)*1.6*settle:0;
    for(let row=0;row<64;row++){const y=row*8,shift=flutter*Math.exp(-Math.pow((y-327)/56,2));buffer.drawImage(atlas,(frame%12)*n,Math.floor(frame/12)*n+y/512*n,n,8/512*n,Math.round(shift),y,512,8);}
   }
   const breathing=resting?Math.sin(clamp((t-holdStart)/2)*TAU)*1.6:0;
   c.save();c.globalAlpha=opacity;c.translate(384,1124+breathing);c.scale(scale,scale);c.translate(-256,-484);c.drawImage(this.turnSurface,0,0);c.restore();
  };
  const intro=1-ease((t-.5)/.25),outro=ease((t-9.6)/.6),poseWeight=Math.max(intro,outro);
  if(poseWeight>0){
   const p=neutral(),raise=t<1?ease(t/.55):1-ease((t-9.6)/.6);p.armL=.45*raise;p.armR=-.45*raise;p.kick=10*raise;p.footR=-.15*raise;
   this.draw(p,0);const saved=document.createElement('canvas');saved.width=512;saved.height=512;saved.getContext('2d')!.drawImage(this.canvas,0,0,512,512,0,0,512,512);
   this.clear();c.save();c.globalAlpha=poseWeight;c.drawImage(saved,128,640);c.restore();
  }
  if(poseWeight<1)drawSpin(1-poseWeight);
  if(flash>0){
   c.save();c.globalCompositeOperation='source-atop';c.globalAlpha=flash;c.fillStyle='#fff';c.fillRect(0,0,768,1152);c.restore();
   c.save();const g=c.createRadialGradient(384,775,15,384,775,320);g.addColorStop(0,'rgba(255,255,250,'+(flash*.65)+')');g.addColorStop(1,'rgba(255,255,250,0)');c.fillStyle=g;c.fillRect(0,450,768,660);c.restore();
  }
 }
}
