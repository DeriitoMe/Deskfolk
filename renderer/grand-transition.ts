import atlasUrl from '../assets/characters/wakaba-mutsumi/v40-motion/layers/spin-grand-atlas.png?url';
import restUrl from '../assets/characters/wakaba-mutsumi/v40-motion/layers/spin-grand-rest-atlas.png?url';
import idleUrl from '../assets/characters/wakaba-mutsumi/v40-motion/layers/grand-idle.png?url';
const clamp=(n:number)=>Math.max(0,Math.min(1,n)),ease=(n:number)=>{n=clamp(n);return n*n*(3-2*n);};
/** Reuse the approved V40 grand artwork and timing, including the two-second hold. */
export class GrandTransition {
 readonly ready:Promise<void>;private images:HTMLImageElement[]=[];private buffer=document.createElement('canvas');
 constructor(){this.buffer.width=this.buffer.height=512;this.ready=Promise.all([atlasUrl,restUrl,idleUrl].map(async url=>{const im=new Image();im.src=url;await im.decode();return im;})).then(images=>{this.images=images;});}
 draw(c:CanvasRenderingContext2D,t:number){
  const [atlas,rest,idle]=this.images;if(!atlas)return;const b=this.buffer.getContext('2d')!;b.clearRect(0,0,512,512);
  const u=clamp((t-2.3)/3.2),angle=t<8?Math.PI*2*(1-Math.pow(1-u,3)):Math.PI*2+Math.PI*ease((t-8)/.7);
  const frame=Math.min(95,Math.floor((((angle/(Math.PI*2))%1+1)%1)*96)),n=384,resting=t>=5.5&&t<8.18;
  if(resting){const q=t<8?ease((t-5.5)/.5):1-ease((t-8)/.18);if(q>=.999)b.drawImage(idle,0,0);else{const f=Math.min(15,Math.floor(q*15));b.drawImage(rest,f%12*n,Math.floor(f/12)*n,n,n,0,0,512,512);}}
  else{const flutter=Math.sin(t*7)*1.6*(1-ease((t-4.3)/1.2));for(let row=0;row<64;row++){const y=row*8,shift=flutter*Math.exp(-Math.pow((y-327)/56,2));b.drawImage(atlas,frame%12*n,Math.floor(frame/12)*n+y/512*n,n,8/512*n,Math.round(shift),y,512,8);}}
  const breathing=resting?Math.sin(clamp((t-6)/2)*Math.PI*2)*1.6:0;
  c.clearRect(0,0,768,1152);c.save();c.translate(384,1124+breathing);c.scale(2,2);c.translate(-256,-484);c.drawImage(this.buffer,0,0);c.restore();
  const flash=t<8?1-ease((t-2.3)/.45):ease((t-8.3)/.4);
  if(flash){c.save();c.globalCompositeOperation='source-atop';c.globalAlpha=flash;c.fillStyle='#fff';c.fillRect(0,0,768,1152);c.restore();}
 }
}
