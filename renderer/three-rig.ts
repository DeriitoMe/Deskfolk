import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import modelUrl from '../assets/characters/wakaba-mutsumi/v41-3d/runtime/mutsumi-v05.glb?url';
import {GazeSpring} from '../shared/gaze';
import {GrandTransition} from './grand-transition';
import {presentationPolicy} from '../shared/runtime-policy';
import {dragCycle} from '../shared/drag-motion';
import squeezeLeft from '../assets/characters/wakaba-mutsumi/v42-motion/source/art/squeeze-left.png?url';
import squeezeRight from '../assets/characters/wakaba-mutsumi/v42-motion/source/art/squeeze-right.png?url';
export const TURN_SECONDS=10.2;
export type RigAction='idle'|'nap'|'water'|'water-happy'|'work'|'power-work'|'ask'|'touch'|'drag'|'transform';
const maps=import.meta.glob<string>('../assets/characters/wakaba-mutsumi/v41-3d/runtime/{hair-paint,hair_all_visible,back-hair-paint,back-hair-mask,side-hair-clean,question-eye,flame-atlas}.png',{eager:true,query:'?url',import:'default'});
const urls=Object.fromEntries(Object.entries(maps).map(([p,u])=>[p.split('/').pop()!,u]));
const clamp=T.MathUtils.clamp, mix=T.MathUtils.lerp,TAU=Math.PI*2;
const smooth=(v:number)=>{v=clamp(v,0,1);return v*v*(3-2*v);};
type Pose={rise:number;lean:number;pitch:number;yaw:number;head:number;headYaw:number;armL:number;armR:number;reach:number;footL:number;footR:number;spread:number;liftFoot:number;open:number;nap:number;water:number;flow:number;happy:number;work:number;power:number;ask:number;touch:number;drag:number;squeeze:number;gaze:number;followBody:number;kick:number};
const neutral=():Pose=>({rise:0,lean:0,pitch:0,yaw:0,head:0,headYaw:0,armL:0,armR:0,reach:0,footL:0,footR:0,spread:0,liftFoot:0,open:1,nap:0,water:0,flow:0,happy:0,work:0,power:0,ask:0,touch:0,drag:0,squeeze:0,gaze:0,followBody:0,kick:0});
const blend=(a:Pose,b:Pose,u:number)=>Object.fromEntries(Object.keys(a).map(k=>[k,mix(a[k as keyof Pose],b[k as keyof Pose],u)])) as Pose;
type Rest={position:T.Vector3;quaternion:T.Quaternion;scale:T.Vector3};

export class MutsumiRig {
 readonly canvas=document.createElement('canvas');readonly ready:Promise<void>;
 private context:CanvasRenderingContext2D;private renderer:T.WebGLRenderer;private scene=new T.Scene();
 private camera=new T.OrthographicCamera(-2.56,2.56,2.56,-2.56,.01,100);
 private model?:T.Group;private controls=new Map<string,T.Object3D>();private rest=new Map<T.Object3D,Rest>();
 private look=new GazeSpring();private from=neutral();private pose=neutral();private routed=false;private releasing=false;
 private start=performance.now();private previous=0;private raf=0;private pausedAt=0;private disposed=false;private finished=false;private velocity=0;
 private grand=presentationPolicy.transformation?new GrandTransition():undefined;private eyeSurfaces:T.Mesh[]=[];
 private eyeCanvases:HTMLCanvasElement[]=[];private eyeTextures:T.CanvasTexture[]=[];
 private questionArt?:HTMLImageElement;private auraTexture?:T.Texture;
 private squeezeArt:HTMLImageElement[]=[];
 private watering=new T.Group();private can=new T.Group();private flowers=new T.Group();
 private aura=new T.Group();private drops:T.Mesh[]=[];private projected=new T.Vector3();
 action:RigAction='idle';reducedMotion=false;frameLimit:30|60=60;frames=0;frameIntervals:number[]=[];
 onTransientEnd?:()=>void;onViewportChange?:()=>void;
 constructor(){
  this.canvas.width=this.canvas.height=512;this.canvas.className='pet-art mutsumi-canvas';this.canvas.dataset.dragHandle='';
  this.canvas.dataset.renderer='three-v05';this.canvas.setAttribute('aria-label','若叶睦');
  this.context=this.canvas.getContext('2d',{willReadFrequently:true})!;
  this.renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
  this.renderer.setSize(512,512,false);this.renderer.setPixelRatio(1);this.renderer.setClearColor(0,0);this.renderer.outputColorSpace=T.SRGBColorSpace;
  this.renderer.toneMapping=T.NoToneMapping;this.camera.position.set(0,2.28,12);this.camera.lookAt(0,2.28,0);
  this.ready=this.load().then(()=>{this.canvas.dataset.ready='true';this.start=performance.now();this.tick(this.start);});
 }
 private async load(){
  const gltf=await new GLTFLoader().loadAsync(modelUrl);this.model=gltf.scene;this.scene.add(this.model);
  this.model.traverse(o=>{this.controls.set(o.name,o);this.rest.set(o,{position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone()});
    if(o instanceof T.Mesh){o.frustumCulled=false;const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms)m.toneMapped=false;}});
  const hair=[...this.controls.values()].find(o=>o.name.startsWith('HairUnified'))??[...this.controls.values()].find(o=>o.userData.runtime_part?.startsWith('Hair.Unified'));
  if(!(hair instanceof T.Mesh))throw Error('V05 hair mesh missing');
  const loader=new T.TextureLoader();const textures=await Promise.all(['hair-paint.png','hair_all_visible.png','back-hair-paint.png','back-hair-mask.png','side-hair-clean.png'].map(async n=>{
   const texture=await loader.loadAsync(urls[n]);texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.ClampToEdgeWrapping;return texture;
  }));
  // glTF converts mesh coordinates to Y-up. Rest coordinates stay attached to
  // the hair when the head rotates; no view-dependent image morphing is used.
  hair.material=new T.ShaderMaterial({uniforms:{front:{value:textures[0]},frontMask:{value:textures[1]},back:{value:textures[2]},backMask:{value:textures[3]},sideMap:{value:textures[4]}},
   vertexShader:`attribute vec3 _paint; varying vec4 paint; varying vec3 restP;
    void main(){paint=vec4(_paint,1.);restP=position+vec3(.01,3.12,-.2);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`uniform sampler2D front,frontMask,back,backMask,sideMap;varying vec4 paint;varying vec3 restP;
    float knots(float z,float a,float b,float c,float d,float e,float f,float g,float h,float i){
     if(z<.5)return mix(a,b,clamp(z/.5,0.,1.));if(z<1.)return mix(b,c,(z-.5)/.5);if(z<1.5)return mix(c,d,(z-1.)/.5);
     if(z<2.)return mix(d,e,(z-1.5)/.5);if(z<2.8)return mix(e,f,(z-2.)/.8);if(z<3.4)return mix(f,g,(z-2.8)/.6);
     if(z<4.)return mix(g,h,(z-3.4)/.6);return mix(h,i,clamp((z-4.)/.6,0.,1.));}
    void main(){vec2 uv=vec2(.5+restP.x/5.12,1.-(4.84-restP.y)/5.12);vec2 sideUV=vec2(.5-restP.z/5.12,uv.y);
     vec3 base=vec3(.584078431,.73791039,.479320168);
     float fm=dot(texture2D(frontMask,uv).rgb,vec3(.2126,.7152,.0722));float bm=dot(texture2D(backMask,uv).rgb,vec3(.2126,.7152,.0722));
     vec3 col=mix(base,texture2D(front,uv).rgb,fm)*paint.r+mix(base,texture2D(back,uv).rgb,bm)*paint.g+base*paint.b;
     float f=knots(restP.y,.9,.65,.4,0.,-.55,-.78,-.78,-.7,-.1),b=knots(restP.y,1.8,1.8,1.85,1.97,2.,1.6,1.42,1.02,.25);
     float w=smoothstep(f-.08,f+.08,-restP.z)*(1.-smoothstep(b-.08,b+.08,-restP.z));
     gl_FragColor=vec4(mix(col,texture2D(sideMap,sideUV).rgb,w),1.);
     #include <colorspace_fragment>
    }`,side:T.DoubleSide,toneMapped:false});
  this.questionArt=new Image();this.questionArt.src=urls['question-eye.png'];await this.questionArt.decode();
  this.squeezeArt=await Promise.all([squeezeLeft,squeezeRight].map(async src=>{const art=new Image();art.src=src;await art.decode();return art;}));
  this.auraTexture=await loader.loadAsync(urls['flame-atlas.png']);this.auraTexture.colorSpace=T.SRGBColorSpace;this.auraTexture.repeat.set(1/6,1/6);
  this.buildEyes();this.buildProps();await this.grand?.ready;
  // Upload every prop and compile its shader before the first visible action.
  this.apply(this.target('water',2),2);this.flowers.visible=this.aura.visible=true;
  await this.renderer.compileAsync(this.scene,this.camera);this.renderer.render(this.scene,this.camera);
  this.apply(this.target('idle',0),0);
 }
 private control(name:string){return this.controls.get(name.replace(/\./g,''))??this.controls.get(name)??[...this.controls.values()].find(o=>o.name===name.replace(/\./g,'_'))!;}
 private basic(color:string|number,opacity=1){return new T.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1,toneMapped:false});}
 private mesh(g:T.BufferGeometry,color:string|number,parent:T.Object3D,pos:number[],scale?:number[]){const m=new T.Mesh(g,this.basic(color));m.position.set(pos[0],pos[1],pos[2]);if(scale)m.scale.set(scale[0],scale[1],scale[2]);parent.add(m);return m;}
 private buildEyes(){
  const replaced:T.Object3D[]=[];
  for(const side of ['R','L']){
   const joint=this.control('CTRL_Eye.'+side);if(!joint)throw Error('Eye control missing '+side);
   // The fitted source lenses are superseded by the existing animated eye
   // surfaces. Keep their controllers and the editable GLB source, but release
   // the invisible lens meshes and full-size decoded paintings at runtime.
   for(const ch of [...joint.children]){replaced.push(ch);joint.remove(ch);}
   const canvas=document.createElement('canvas');canvas.width=192;canvas.height=256;
   const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
   const mesh=new T.Mesh(new T.PlaneGeometry(.53,.61),new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:T.DoubleSide,toneMapped:false}));
   mesh.position.z=.009;joint.add(mesh);this.eyeSurfaces.push(mesh);this.eyeCanvases.push(canvas);this.eyeTextures.push(texture);
  }
  this.releaseReplacedParts(replaced);
 }
 private releaseReplacedParts(parts:T.Object3D[]){
  const oldGeometry=new Set<T.BufferGeometry>(),oldMaterials=new Set<T.Material>();
  for(const part of parts)part.traverse(o=>{
   this.rest.delete(o);if(this.controls.get(o.name)===o)this.controls.delete(o.name);
   if(o instanceof T.Mesh){oldGeometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])oldMaterials.add(m);}
  });
  const retainedGeometry=new Set<T.BufferGeometry>(),retainedMaterials=new Set<T.Material>();
  this.scene.traverse(o=>{if(o instanceof T.Mesh){retainedGeometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])retainedMaterials.add(m);}});
  const materialTextures=(material:T.Material)=>{
   const values=Object.values(material);
   if(material instanceof T.ShaderMaterial)values.push(...Object.values(material.uniforms).map(u=>u.value));
   return values.filter((value):value is T.Texture=>value instanceof T.Texture);
  };
  const retainedTextures=new Set([...retainedMaterials].flatMap(materialTextures));
  const retainedImages=new Set([...retainedTextures].map(texture=>texture.source.data));
  const releasedImages=new Set<unknown>();
  for(const geometry of oldGeometry)if(!retainedGeometry.has(geometry))geometry.dispose();
  for(const material of oldMaterials){
   if(retainedMaterials.has(material))continue;
   for(const texture of materialTextures(material)){
    if(retainedTextures.has(texture))continue;
    const image=texture.source.data;
    texture.dispose();
    // glTF material clones can share an ImageBitmap with a retained texture.
    // Close only bitmaps that have no remaining scene reference.
    if(!retainedImages.has(image)&&!releasedImages.has(image)&&typeof ImageBitmap!=='undefined'&&image instanceof ImageBitmap){image.close();releasedImages.add(image);}
   }
   material.dispose();
  }
 }
 private buildProps(){
  this.watering.name='WateringProps';this.can.name='WateringCan';this.flowers.name='HappyFlowers';this.aura.name='FullPowerAura';
  this.scene.add(this.watering,this.flowers,this.aura);this.watering.add(this.can);
  const pot=new T.Group();pot.name='CucumberPlanter';pot.position.set(-1.52,.2,.8);this.watering.add(pot);
  this.mesh(new T.BoxGeometry(.75,.32,.42),'#96624a',pot,[0,0,0]);this.mesh(new T.BoxGeometry(.8,.07,.47),'#bd8869',pot,[0,.15,0]);this.mesh(new T.BoxGeometry(.69,.025,.34),'#604c35',pot,[0,.195,0]);
  for(let i=0;i<3;i++){
   const x=(i-1)*.21;this.mesh(new T.CylinderGeometry(.019,.024,.38,8),'#58834d',pot,[x,.39,0]);
   this.mesh(new T.SphereGeometry(1,12,8),'#6ca45e',pot,[x-.045,.5,.01],[.1,.035,.06]).rotation.z=.45;
   this.mesh(new T.SphereGeometry(1,12,8),'#8bbb6a',pot,[x+.055,.43,.04],[.1,.035,.06]).rotation.z=-.45;
   this.mesh(new T.CapsuleGeometry(.045,.16,4,8),'#537c48',pot,[x,.36,.065]);
  }
  this.mesh(new T.CylinderGeometry(.16,.18,.28,24),'#65939a',this.can,[0,0,0]);
  const handle=this.mesh(new T.TorusGeometry(.27,.027,8,32),'#476f7c',this.can,[0,.13,0]);handle.scale.y=.65;
  const spout=this.mesh(new T.CylinderGeometry(.026,.055,.35,12),'#739fa6',this.can,[-.26,.04,0]);spout.rotation.z=-1.1;
  const rose=this.mesh(new T.CylinderGeometry(.09,.035,.055,16),'#aac8c7',this.can,[-.42,.12,0]);rose.rotation.z=-1.1;
  this.can.position.set(-.38,1.05,1.02);this.can.rotation.z=.45;
  for(let i=0;i<36;i++){const d=new T.Mesh(new T.SphereGeometry(.016,6,6),this.basic('#b9eaf2',.8));d.name='WaterDrop_'+i;this.watering.add(d);this.drops.push(d);}
  for(let i=0;i<5;i++){const flower=new T.Group();for(let p=0;p<5;p++)this.mesh(new T.SphereGeometry(.055,10,6),i%2?'#f2bfcb':'#ffe1a2',flower,[Math.cos(p*TAU/5)*.06,Math.sin(p*TAU/5)*.06,0],[1,.8,.35]);this.mesh(new T.SphereGeometry(.035,10,6),'#e8b45e',flower,[0,0,.025]);this.flowers.add(flower);}
  // Flame ribbons wrap around the actual model volume; rear tongues are occluded.
  for(let i=0;i<7;i++){
   const geometry=new T.PlaneGeometry(.65,1.15);geometry.translate(0,.575,0);
   const flame=new T.Mesh(geometry,new T.MeshBasicMaterial({map:this.auraTexture,transparent:true,opacity:.26,depthWrite:false,side:T.DoubleSide,toneMapped:false}));this.aura.add(flame);
  }
 }
 private target(action:RigAction,t:number):Pose{
  const p=neutral(),wave=Math.sin(t*TAU/3.8);p.rise=wave*.008;
  if(action==='idle'){p.gaze=1;p.followBody=1;}
  const b=t%4.3;p.open=b<3.78?1:b<3.94?1-smooth((b-3.78)/.16):b<4.01?0:smooth((b-4.01)/.23);
  if(action==='nap'){p.nap=1;p.open=.02;p.pitch=.035;p.head=.035;p.rise=-.025+wave*.014;}
  if(action==='water'){const prepare=smooth((t-.25)/.95);p.water=smooth((t-.7)/.55);p.flow=smooth((t-1.4)/.4);p.yaw=-.23;p.headYaw=-.1;p.pitch=.018;p.armL=-.58*prepare;p.armR=.45*prepare;p.reach=-.82*prepare;p.spread=-.025;p.rise=wave*.006;}
  if(action==='water-happy'){p.happy=1-smooth((t-2.7)/.9);p.open=.5;p.rise+=Math.sin(t*3)*.015;p.armL=.08;p.armR=-.08;}
  if(action==='work'||action==='power-work'){p.work=1;p.gaze=action==='work'?1:0;p.followBody=action==='work'?1:0;p.spread=.045;p.armL=.12;p.armR=-.12;p.open=1;p.rise=wave*.005;}
  if(action==='power-work'){p.power=1;p.spread=.17;p.footL=-.2;p.footR=.2;p.rise=-.09+wave*.01;p.armL=.25;p.armR=-.25;p.reach=-.3;}
  if(action==='ask'){p.ask=1;p.headYaw=-.24;p.yaw=-.06;p.open=1;}
  if(action==='touch'){p.touch=1;p.squeeze=1;p.armL=2.1;p.armR=-2.1;p.reach=.95;p.open=1;}
  if(action==='drag'){const cycle=dragCycle(t),k=cycle.kick;
    // Lift from the upper back: the torso tips forward and the head nods over
    // the chest, while the face stays nearly frontal.
    p.drag=1;p.rise=.17;p.pitch=.24+k*.055;p.yaw=-.10;p.lean=.035+this.velocity*.012;p.head=.10-k*.08;p.headYaw=.03;
    p.armL=.10+k*.46;p.armR=-.08-k*.40;p.reach=-.32+k*.62;
    p.footL=-.08-k*.27;p.footR=.08+k*.30;p.open=.85;p.squeeze=cycle.squeeze;p.kick=k;}
  return p;
 }
 private apply(p:Pose,t:number,eyeTime=t){
  for(const [o,r] of this.rest){o.position.copy(r.position);o.quaternion.copy(r.quaternion);o.scale.copy(r.scale);}
  const gx=this.look.x*p.gaze,gy=this.look.y*p.gaze;
  const bx=gx*p.followBody,by=gy*p.followBody;
  const body=this.control('CTRL_Body'),head=this.control('CTRL_Head');
  body.quaternion.setFromEuler(new T.Euler(p.pitch+by*.018,p.yaw+bx*.035,0,'YXZ'));
  body.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),p.lean-bx*.026));
  const collarPivot=new T.Vector3(0,.40,-.16).multiplyScalar(p.drag);
  body.position.add(collarPivot).sub(collarPivot.clone().applyQuaternion(body.quaternion));
  body.position.y+=p.rise;body.position.x+=bx*.045;
  head.rotation.set(p.head+by*.012,p.headYaw+bx*.055,-p.drag*.045);
  this.control('CTRL_Arm.L').rotation.set(p.reach,0,p.armL);this.control('CTRL_Arm.R').rotation.set(p.reach,0,p.armR);
  for(const s of ['L','R']){const arm=this.control('CTRL_Arm.'+s);arm.position.z+=p.touch*.45;arm.position.y+=p.touch*.12;}
  for(const [s,sign,a] of [['R',-1,p.footR],['L',1,p.footL]] as const){const foot=this.control('CTRL_Foot.'+s);foot.position.x+=sign*p.spread;foot.position.y-=p.rise*(1-p.drag);foot.rotation.set(p.drag*(-.18+p.kick*(s==='R'?.7:.52)),0,a);if(s==='R')foot.position.y+=p.liftFoot;}
  for(let i=0;i<2;i++){
   const joint=this.control('CTRL_Eye.'+(i?'L':'R'));joint.position.x+=gx*.105;joint.position.y-=gy*.065;
   joint.rotation.y=gx*.035;this.drawEye(i,p,eyeTime);
  }
  this.model!.updateMatrixWorld(true);
  this.watering.visible=p.water>.005;this.watering.scale.setScalar(1);
  this.can.rotation.set(0,p.yaw,.35+Math.sin(t*2)*.035);
  const palmL=this.control('CTRL_Hand.L').getWorldPosition(new T.Vector3()),palmR=this.control('CTRL_Hand.R').getWorldPosition(new T.Vector3());
  this.can.position.copy(palmL.add(palmR).multiplyScalar(.5));this.can.position.y-=.14;this.can.position.z=Math.max(1.02,this.can.position.z+.025);
  this.can.updateMatrixWorld(true);const spout=this.can.localToWorld(new T.Vector3(-.42,.12,0));
  this.watering.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshBasicMaterial;m.transparent=true;m.opacity=(o.name.startsWith('WaterDrop_')?.8*p.flow:1)*p.water;}});
  for(let i=0;i<this.drops.length;i++){const q=(t*1.9+i/36)%1;this.drops[i].position.set(mix(spout.x,-1.52,q)+Math.sin(i*8)*.035,mix(spout.y,.45,q*q),mix(spout.z,.8,q)+Math.cos(i*5)*.028);this.drops[i].scale.set(1,1.8,1);}
  this.flowers.visible=p.happy>.005;for(let i=0;i<5;i++){const f=this.flowers.children[i],a=t*1.1+i*TAU/5;f.position.set(Math.cos(a)*1.65,2.6+Math.sin(a)*.7,.6+Math.sin(a)*.3);f.rotation.z=t*1.8+i;f.scale.setScalar(p.happy);}
  this.aura.visible=p.power>.005;for(let i=0;i<7;i++){const a=i*TAU/7;const f=this.aura.children[i] as T.Mesh;f.position.set(Math.cos(a)*1.65,.06,Math.sin(a)*1.1);f.rotation.y=0;f.scale.set(1.5,1.7+Math.sin(t*5+i)*.25+Math.abs(Math.cos(a))*.6,1);(f.material as T.MeshBasicMaterial).opacity=p.power*(.18+.04*Math.sin(t*4+i));}
  const frame=Math.floor(t*30)%36;this.auraTexture?.offset.set((frame%6)/6,(5-Math.floor(frame/6))/6);
  this.scene.updateMatrixWorld(true);
 }
 private drawEye(i:number,p:Pose,t:number){
  const c=this.eyeCanvases[i].getContext('2d')!;c.clearRect(0,0,192,256);c.save();c.translate(96,128);
  const ask=p.ask,side=i?1.1:.87;
  const open=Math.max(.025,p.open);c.scale(mix(1,side,ask),open);
  c.globalAlpha=(1-p.squeeze)*(1-p.happy);
  {
   const rx=mix(35,61,ask),ry=mix(88,82,ask);c.beginPath();if(ask<.01)c.ellipse(0,0,rx,ry,0,0,TAU);else c.roundRect(-rx,-ry,rx*2,ry*2,[rx*.8,rx*.8,rx*.85,rx*.85]);
   const gold=c.createLinearGradient(0,-ry,0,ry);gold.addColorStop(0,ask>.1?'#c5a570':'#b87925');gold.addColorStop(1,ask>.1?'#efdbaa':'#ca8b30');c.fillStyle=gold;c.fill();
   if(ask>.001&&this.questionArt){c.save();c.globalAlpha=ask;c.drawImage(this.questionArt,-96,-128);c.restore();}
   if(p.work>.001){c.save();c.clip();c.globalAlpha=p.work*(1-p.squeeze)*(1-p.happy);this.drawCodeFlow(c,t);c.restore();}
  }
  if(p.happy>.001){c.globalAlpha=p.happy*(1-p.squeeze);c.strokeStyle='#b98537';c.lineWidth=10;c.lineCap='round';c.beginPath();c.arc(0,5,28,Math.PI*1.13,Math.PI*1.87);c.stroke();}
  if(p.squeeze>.001){c.globalAlpha=p.squeeze;c.drawImage(this.squeezeArt[i],-96,-128);}
  c.restore();this.eyeTextures[i].needsUpdate=true;
 }
 private drawCodeFlow(c:CanvasRenderingContext2D,t:number){
  // Shared seeds and time keep both eyes synchronized. The multiplier speeds
  // up glyph columns and glow bands together while preserving the gold shape.
  t*=1.5;
  const hash=(n:number)=>{const x=Math.sin(n*127.1)*43758.5453;return x-Math.floor(x);};
  // The desktop eye is only about 8 pixels wide. Broader, fading code ribbons
  // keep the work indicator readable after downsampling without changing the
  // gold silhouette.
  for(let band=0;band<2;band++){
   const travel=t*(98+band*25)+band*117,pass=Math.floor(travel/228),y=-114+travel%228;
   const center=(hash(pass*41+band*79+5003)-.5)*18,width=44+hash(pass*37+band*61+7021)*16;
   const glow=c.createLinearGradient(0,y-27,0,y+9);
   glow.addColorStop(0,'#fff8d400');glow.addColorStop(.55,'#fff8d438');
   glow.addColorStop(.78,'#fffbe0c4');glow.addColorStop(1,'#fff8d400');
   c.fillStyle=glow;c.fillRect(center-width/2,y-27,width,36);
   c.fillStyle='#fffce4b3';c.fillRect(center-width/2,y-1,width*(.55+hash(pass+band*97+8123)*.3),3);
  }
  c.font='bold 21px monospace';c.textAlign='center';c.textBaseline='middle';
  for(let col=0;col<3;col++){
   const speed=82+col*17,travel=t*speed+col*73,row=Math.floor(travel/27),offset=travel%27;
   for(let j=-1;j<9;j++){
    const seed=row-j+col*107+100003,r=hash(seed),y=-114+j*27+offset;
    if(r<.21)continue;
    c.fillStyle=`rgba(255,250,220,${.58+hash(seed+31)*.37})`;
    c.fillText(['0','1','{','}','/',';','·'][Math.floor(r*7)],(col-1)*22,y);
    if(r>.83){c.fillStyle='#fffbe0bd';c.fillRect((col-1)*22-8,y+11,16,3);}
   }
  }
 }
 private resize(tall:boolean){const h=tall?1152:512;if(this.canvas.height===h)return;this.canvas.width=tall?768:512;this.canvas.height=h;this.canvas.dataset.tall=String(tall);this.onViewportChange?.();}
 private draw(p:Pose,t:number,eyeTime=t){
  this.apply(p,t,eyeTime);this.renderer.render(this.scene,this.camera);const c=this.context;c.clearRect(0,0,this.canvas.width,this.canvas.height);
  const x=this.canvas.height===1152?128:0,y=this.canvas.height===1152?640:0;c.drawImage(this.renderer.domElement,x,y);
  if(p.happy>.001){c.save();c.globalCompositeOperation='source-atop';c.fillStyle=`rgba(255,204,113,${p.happy*.09})`;c.fillRect(0,0,this.canvas.width,this.canvas.height);c.restore();}
  c.save();c.translate(x,y);
  if(p.nap>.01){for(let i=0;i<3;i++){const u=(t/2.7+i/3)%1;c.save();c.globalAlpha=p.nap*Math.sin(Math.PI*u);c.fillStyle='#344b75';c.font=`600 ${13+u*18}px "YouYuan",sans-serif`;c.fillText(i?'z':'Z',337+u*53,190-u*147);c.restore();}}
  if(p.ask>.01){c.globalAlpha=p.ask;c.fillStyle='#40523e';c.font='bold 43px "YouYuan",sans-serif';c.fillText('?',360,92-Math.sin(Math.min(t,.6)/.6*Math.PI)*8);}
  c.restore();
 }
 private drawTurn(t:number){
  this.resize(true);const c=this.context;
  if(t>=2.3&&t<8.7){this.grand?.draw(c,t);return;}
  const p=neutral();const raise=t<2.3?smooth(t/.55):1-smooth((t-9.6)/.6);p.armL=.45*raise;p.armR=-.45*raise;p.liftFoot=.12*raise;
  if(t<2.3){const u=clamp((t-.7)/1.6,0,1);p.yaw=TAU*u*u*(2-u);}else p.yaw=Math.PI+Math.PI*smooth((t-8.7)/.9);
  this.pose=p;this.draw(p,t);const flash=t<2.3?smooth((t-1.85)/.45):1-smooth((t-8.7)/.45);
  if(flash){c.save();c.globalCompositeOperation='source-atop';c.globalAlpha=flash;c.fillStyle='#fff';c.fillRect(0,0,768,1152);c.restore();}
 }
 private tick=(now:number)=>{
  if(this.disposed)return;this.raf=requestAnimationFrame(this.tick);if(this.pausedAt)return;const dt=now-this.previous;if(dt<1000/this.frameLimit-2)return;
  if(this.previous&&dt<1000){this.frameIntervals.push(dt);if(this.frameIntervals.length>600)this.frameIntervals.shift();}
  this.look.step(dt/1000);this.previous=now;this.frames++;const age=(now-this.start)/1000;
  if(this.action==='transform')this.drawTurn(age);else{
   const t=this.reducedMotion?.65:age,route=this.routed?.38:0;
   this.pose=age<route?blend(this.from,neutral(),smooth(age/route)):blend(this.routed?neutral():this.from,this.target(this.action,t),smooth((age-route)/(this.releasing?.65:this.action==='water'?1.4:this.action==='drag'?.23:.55)));
   if(this.releasing&&age<.65)this.pose.rise-=Math.sin(age/.65*Math.PI)*.03;this.draw(this.pose,t,age);
  }
  this.velocity*=Math.exp(-Math.min(dt,100)*.007);
  if(!this.finished&&((this.action==='transform'&&age>=TURN_SECONDS)||(this.action==='touch'&&age>=1.15))){this.finished=true;this.onTransientEnd?.();}
 };
 setAction(action:RigAction){if(action==='transform'&&!presentationPolicy.transformation)return;if(action===this.action)return;this.from={...this.pose};this.releasing=this.action==='drag';this.routed=this.action==='nap'&&['work','power-work','water'].includes(action);this.action=action;this.start=performance.now();this.finished=false;this.canvas.dataset.action=action;if(!['idle','work'].includes(action))this.look.target(0,0);this.resize(action==='transform');
  this.onViewportChange?.();
 }
 setLookTarget(x:number,y:number){const follows=this.action==='idle'||this.action==='work';this.look.target(follows?x:0,follows?y:0);}
 setDragVelocity(dx:number){this.velocity=mix(this.velocity,clamp(dx,-12,12),.45);}
 cancelToIdle(){this.setAction('idle');}
 setPaused(value:boolean){if(value&&!this.pausedAt)this.pausedAt=performance.now();else if(!value&&this.pausedAt){this.start+=performance.now()-this.pausedAt;this.pausedAt=0;}}
 renderAt(action:RigAction,t:number,_weight=1,_layer?:string){if(action==='transform'&&!presentationPolicy.transformation)action='idle';this.action=action;this.resize(action==='transform');this.canvas.dataset.action=action;if(action==='transform')this.drawTurn(t);else{this.pose=this.target(action,t);this.draw(this.pose,t);}}
 renderTransitionAt(from:RigAction,to:RigAction,t:number){this.action=to;this.resize(false);const route=from==='nap'&&['work','power-work','water'].includes(to)?.38:0;
  this.pose=t<route?blend(this.target(from,1),neutral(),smooth(t/route)):blend(route?neutral():this.target(from,1),this.target(to,t),smooth((t-route)/(from==='drag'?.65:to==='water'?1.4:to==='drag'?.23:.55)));
  if(from==='drag'&&t<.65)this.pose.rise-=Math.sin(t/.65*Math.PI)*.03;this.draw(this.pose,t);}
 renderGazeAt(x:number,y:number,t=0){this.look.snap(x,y);this.renderAt('idle',t);}
 exportPose(){return {pose:this.pose,controls:[...this.controls.values()].filter(o=>o.name.startsWith('CTRL')).map(o=>({name:o.name,position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray()})),can:{position:this.can.position.toArray(),quaternion:this.can.quaternion.toArray()},grand:this.action==='transform'&&this.canvas.height===1152};}
 async exportProps(){this.renderAt('water',2);return await new GLTFExporter().parseAsync(this.watering,{binary:true,onlyVisible:false});}
 hit(cx:number,cy:number){const r=this.canvas.getBoundingClientRect(),x=Math.floor((cx-r.left)*this.canvas.width/r.width),y=Math.floor((cy-r.top)*this.canvas.height/r.height);return x>=0&&y>=0&&x<this.canvas.width&&y<this.canvas.height&&this.context.getImageData(x,y,1,1).data[3]>40;}
 dispose(){this.disposed=true;cancelAnimationFrame(this.raf);const textures=new Set<T.Texture>();this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const v of Object.values(m))if(v instanceof T.Texture)textures.add(v);if(m instanceof T.ShaderMaterial)for(const u of Object.values(m.uniforms))if(u.value instanceof T.Texture)textures.add(u.value);m.dispose();}}});for(const tex of textures)tex.dispose();this.renderer.dispose();this.renderer.forceContextLoss();}
}
