import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import modelUrl from '../assets/characters/wakaba-mutsumi/v41-3d/runtime/mutsumi-v05.glb?url';
import {GazeSpring} from '../shared/gaze';
import {GrandTransition} from './grand-transition';
import {presentationPolicy} from '../shared/runtime-policy';
import {dragCycle} from '../shared/drag-motion';
import {DragPendulum} from '../shared/drag-physics';
import {HairSway} from '../shared/hair-physics';
import sideHairFlowUrl from '../assets/characters/wakaba-mutsumi/side-hair-lines-20261012/runtime/side-hair-lines.png?url';
import hairGapFillUrl from '../assets/characters/wakaba-mutsumi/water-hair-gap-20261014/runtime/hair-gap-fill-v2.glb?url';
import squeezeLeft from '../assets/characters/wakaba-mutsumi/v42-motion/source/art/squeeze-left.png?url';
import squeezeRight from '../assets/characters/wakaba-mutsumi/v42-motion/source/art/squeeze-right.png?url';
import poppersUrl from '../assets/characters/wakaba-mutsumi/celebration-20261002/runtime/mini-confetti-poppers.glb?url';
import sweatLargeUrl from '../assets/characters/wakaba-mutsumi/celebration-20261002/runtime/sweat-large.png?url';
import sweatSmallUrl from '../assets/characters/wakaba-mutsumi/celebration-20261002/runtime/sweat-small.png?url';
import starUrl from '../assets/characters/wakaba-mutsumi/celebration-20261002/runtime/gentle-star.png?url';
import confettiUrl from '../assets/characters/wakaba-mutsumi/celebration-20261002/runtime/confetti-strip.png?url';
import {CELEBRATION_SECONDS,TOUCH_SECONDS,FEEDBACK_SECONDS,DIZZY_SECONDS} from '../shared/companion-feedback';
import {touchPressure,TOUCH_HEAD_DROP} from '../shared/touch-motion';
import {TEARFUL_SECONDS} from '../shared/touch-response';
import {tearfulReflection,tearfulWeight} from '../shared/tearful-motion';
import tearfulBaseUrl from '../assets/characters/wakaba-mutsumi/tearful-20261009/runtime/tearful-eye-base.png?url';
import boardFrameUrl from '../assets/characters/wakaba-mutsumi/quota-board-20261014/runtime/quota-board-frame.svg?url';
import {quotaBoardMotion,QUOTA_BOARD_SECONDS,QUOTA_BOARD_BLEND_SECONDS,QUOTA_BOARD_FADE_SECONDS} from '../shared/quota-board-motion';
import {currentCodexQuota,unknownCodexQuota,type CodexQuotaSnapshot} from '../shared/quota';
export const TURN_SECONDS=10.2;
export type RigAction='idle'|'nap'|'water'|'water-happy'|'work'|'power-work'|'ask'|'touch'|'tearful'|'drag'|'transform'|'celebrate-poppers'|'celebrate-clap'|'feedback-failed'|'feedback-paused'|'feedback-quota'|'dizzy'|'quota-board';
const maps=import.meta.glob<string>('../assets/characters/wakaba-mutsumi/v41-3d/runtime/{hair-paint,hair_all_visible,back-hair-paint,back-hair-mask,side-hair-clean,question-eye,flame-atlas}.png',{eager:true,query:'?url',import:'default'});
const urls=Object.fromEntries(Object.entries(maps).map(([p,u])=>[p.split('/').pop()!,u]));
const clamp=T.MathUtils.clamp, mix=T.MathUtils.lerp,TAU=Math.PI*2;
const smooth=(v:number)=>{v=clamp(v,0,1);return v*v*(3-2*v);};
type Pose={rise:number;lean:number;pitch:number;yaw:number;head:number;headOffsetY:number;headYaw:number;headRoll:number;armL:number;armR:number;reach:number;footL:number;footR:number;spread:number;liftFoot:number;open:number;nap:number;water:number;flow:number;happy:number;work:number;power:number;ask:number;touch:number;tearful:number;drag:number;squeeze:number;gaze:number;followBody:number;kick:number;popper:number;clap:number;dizzy:number;board:number};
const neutral=():Pose=>({rise:0,lean:0,pitch:0,yaw:0,head:0,headOffsetY:0,headYaw:0,headRoll:0,armL:0,armR:0,reach:0,footL:0,footR:0,spread:0,liftFoot:0,open:1,nap:0,water:0,flow:0,happy:0,work:0,power:0,ask:0,touch:0,tearful:0,drag:0,squeeze:0,gaze:0,followBody:0,kick:0,popper:0,clap:0,dizzy:0,board:0});
const blend=(a:Pose,b:Pose,u:number)=>Object.fromEntries(Object.keys(a).map(k=>[k,mix(a[k as keyof Pose],b[k as keyof Pose],u)])) as Pose;
type Rest={position:T.Vector3;quaternion:T.Quaternion;scale:T.Vector3};
type WaterLane={mouth:T.Vector3;start:T.Vector3;control:T.Vector3;target:T.Vector3;targetY:number;phase:number;speed:number};

export class MutsumiRig {
 readonly canvas=document.createElement('canvas');readonly ready:Promise<void>;
 private context:CanvasRenderingContext2D;private renderer:T.WebGLRenderer;private scene=new T.Scene();
 private camera=new T.OrthographicCamera(-2.56,2.56,2.56,-2.56,.01,100);
 private model?:T.Group;private controls=new Map<string,T.Object3D>();private rest=new Map<T.Object3D,Rest>();
 private look=new GazeSpring();private from=neutral();private pose=neutral();private routed=false;private releasing=false;
 private touchInitialPressure=0;
 private tearfulOverlay=false;private tearfulClock=0;private tearfulStartedAt=0;
 private start=performance.now();private previous=0;private raf=0;private pausedAt=0;private disposed=false;private finished=false;private velocity=0;
 private grand=presentationPolicy.transformation?new GrandTransition():undefined;private eyeSurfaces:T.Mesh[]=[];
 private eyeCanvases:HTMLCanvasElement[]=[];private eyeTextures:T.CanvasTexture[]=[];
 private questionArt?:HTMLImageElement;private auraTexture?:T.Texture;
 private tearfulBase?:HTMLImageElement;
 private squeezeArt:HTMLImageElement[]=[];
 private watering=new T.Group();private can=new T.Group();private flowers=new T.Group();
 private aura=new T.Group();private drops:T.Mesh[]=[];private projected=new T.Vector3();
 private waterLanes:WaterLane[]=[];private waterSpray?:T.InstancedMesh;
 private waterSegment=new T.Object3D();private waterPointA=new T.Vector3();private waterPointB=new T.Vector3();
 private waterDirection=new T.Vector3();private waterNormal=new T.Vector3();private waterUp=new T.Vector3(0,1,0);
 private canPalmL=new T.Vector3();private canPalmR=new T.Vector3();
 private feedback=new T.Group();private poppers:T.Object3D[]=[];private paper:T.Mesh[]=[];private stars:T.Mesh[]=[];private sweat:T.Mesh[]=[];
 private suspension=new DragPendulum();private suspensionPivot=new T.Vector3();
 private hairSway=new HairSway();private hairMaterial?:T.ShaderMaterial;
 private modelBounds=new T.Box3();private viewportSignature='';
 private quotaBoard=new T.Group();private quotaBoardMesh?:T.Mesh;private quotaCanvas=document.createElement('canvas');private quotaTexture?:T.CanvasTexture;private quotaFrame?:HTMLImageElement;
 private quota=unknownCodexQuota();private quotaLabel='';private boardViewport=false;private boardReleasing=false;
 private boardRelease={height:0,tilt:0,opacity:0};
 action:RigAction='idle';reducedMotion=false;frameLimit:30|60=60;frames=0;frameIntervals:number[]=[];
 onTransientEnd?:()=>void;onViewportChange?:()=>void;
 constructor(){
  this.canvas.width=1024;this.canvas.height=768;this.canvas.className='pet-art mutsumi-canvas';this.canvas.dataset.dragHandle='';
  this.canvas.dataset.renderer='three-v05';this.canvas.setAttribute('aria-label','若叶睦');
  this.context=this.canvas.getContext('2d',{willReadFrequently:true})!;
  this.renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
  this.renderer.setSize(512,512,false);this.renderer.setPixelRatio(1);this.renderer.setClearColor(0,0);this.renderer.outputColorSpace=T.SRGBColorSpace;
  this.renderer.toneMapping=T.NoToneMapping;this.camera.position.set(0,2.28,12);this.camera.lookAt(0,2.28,0);
  this.ready=this.load().then(()=>{this.canvas.dataset.ready='true';this.start=performance.now();this.tick(this.start);});
 }
 private async load(){
  await this.buildQuotaBoard();
  const gltf=await new GLTFLoader().loadAsync(modelUrl);this.model=gltf.scene;this.scene.add(this.model);
  this.model.traverse(o=>{this.controls.set(o.name,o);this.rest.set(o,{position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone()});
    if(o instanceof T.Mesh){o.frustumCulled=false;const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms)m.toneMapped=false;}});
  this.model.updateMatrixWorld(true);
  const restBounds=new T.Box3().setFromObject(this.model);
  this.suspensionPivot.set(0,restBounds.max.y,0);
  const hair=[...this.controls.values()].find(o=>o.name.startsWith('HairUnified'))??[...this.controls.values()].find(o=>o.userData.runtime_part?.startsWith('Hair.Unified'));
  if(!(hair instanceof T.Mesh))throw Error('V05 hair mesh missing');
  const loader=new T.TextureLoader();const textures=await Promise.all(['hair-paint.png','hair_all_visible.png','back-hair-paint.png','back-hair-mask.png','side-hair-clean.png'].map(async n=>{
   const texture=await loader.loadAsync(n==='side-hair-clean.png'?sideHairFlowUrl:urls[n]);texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.ClampToEdgeWrapping;
   if(n==='side-hair-clean.png')texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
   return texture;
  }));
  // glTF converts mesh coordinates to Y-up. Rest coordinates stay attached to
  // the hair when the head rotates; no view-dependent image morphing is used.
  this.hairMaterial=new T.ShaderMaterial({uniforms:{front:{value:textures[0]},frontMask:{value:textures[1]},back:{value:textures[2]},backMask:{value:textures[3]},sideMap:{value:textures[4]},hairBend:{value:0}},
   vertexShader:`attribute vec3 _paint; uniform float hairBend; varying vec4 paint; varying vec3 restP; varying vec3 restN;
    void main(){paint=vec4(_paint,1.);restP=position+vec3(.01,3.12,-.2);restN=normal;
     vec3 p=position;float lower=1.-smoothstep(1.0,2.6,restP.y),a=hairBend*lower;
     vec2 pivot=vec2(-.01,-.52),strand=p.xy-pivot;
     p.xy=pivot+vec2(cos(a)*strand.x-sin(a)*strand.y,sin(a)*strand.x+cos(a)*strand.y);
     gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
   fragmentShader:`uniform sampler2D front,frontMask,back,backMask,sideMap;varying vec4 paint;varying vec3 restP;varying vec3 restN;
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
     // Side projection fades on forward-facing bends instead of flattening
     // those locks into fragments of the depth-projected colour fields.
     float sideFacing=smoothstep(.15,.85,abs(normalize(restN).x));
     vec3 sideBase=texture2D(sideMap,vec2(.02,sideUV.y)).rgb;
     vec3 sideColour=mix(sideBase,texture2D(sideMap,sideUV).rgb,mix(.22,1.,sideFacing));
     gl_FragColor=vec4(mix(col,sideColour,w),1.);
     #include <colorspace_fragment>
    }`,side:T.DoubleSide,toneMapped:false});
  hair.material=this.hairMaterial;
  // Closed underlays sit behind the two front locks, in the same hair-local
  // coordinates. They share the projection colours and damped lower-hair sway.
  const gapFill=await new GLTFLoader().loadAsync(hairGapFillUrl);
  gapFill.scene.name='HairGapFill';
  gapFill.scene.traverse(o=>{
    if(!(o instanceof T.Mesh))return;
    if(!o.geometry.hasAttribute('_paint'))throw Error('Hair gap fill paint weights missing');
    o.material=this.hairMaterial!;o.frustumCulled=false;
  });
  hair.add(gapFill.scene);
  this.questionArt=new Image();this.questionArt.src=urls['question-eye.png'];await this.questionArt.decode();
  this.tearfulBase=new Image();this.tearfulBase.src=tearfulBaseUrl;await this.tearfulBase.decode();
  this.squeezeArt=await Promise.all([squeezeLeft,squeezeRight].map(async src=>{const art=new Image();art.src=src;await art.decode();return art;}));
  this.auraTexture=await loader.loadAsync(urls['flame-atlas.png']);this.auraTexture.colorSpace=T.SRGBColorSpace;this.auraTexture.repeat.set(1/6,1/6);
  this.buildEyes();this.buildProps();await this.buildFeedback(loader);await this.grand?.ready;
  // Upload every prop and compile its shader before the first visible action.
  this.apply(this.target('water',2),2);this.flowers.visible=this.aura.visible=true;
  this.feedback.traverse(o=>{o.visible=true;});
  await this.renderer.compileAsync(this.scene,this.camera);this.renderer.render(this.scene,this.camera);
  this.apply(this.target('idle',0),0);
 }
 private async buildFeedback(loader:T.TextureLoader){
  const [gltf,...textures]=await Promise.all([new GLTFLoader().loadAsync(poppersUrl),... [sweatLargeUrl,sweatSmallUrl,starUrl,confettiUrl].map(u=>loader.loadAsync(u))]);
  this.feedback.name='CompanionFeedback';this.scene.add(this.feedback);
  for(const name of ['MiniPopper_L','MiniPopper_R']){
   const prop=gltf.scene.getObjectByName(name);if(!prop)throw Error('Celebration prop missing '+name);
   prop.traverse(o=>{if(o instanceof T.Mesh){o.frustumCulled=false;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.toneMapped=false;m.transparent=true;}}});
   this.feedback.add(prop);this.poppers.push(prop);
  }
  const plane=(texture:T.Texture,w:number,h:number,color:string)=>{
   texture.colorSpace=T.SRGBColorSpace;
   const mesh=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:texture,color,transparent:true,depthWrite:false,toneMapped:false}));
   mesh.frustumCulled=false;this.feedback.add(mesh);return mesh;
  };
  this.sweat.push(plane(textures[0],.18,.27,'#ffffff'),plane(textures[1],.12,.18,'#ffffff'));
  for(let i=0;i<5;i++)this.stars.push(plane(textures[2],.16,.16,'#ffffff'));
  const palette=['#b6dcb8','#f0c6cf','#efd89f','#bacde2'];
  for(let i=0;i<32;i++)this.paper.push(plane(textures[3],.085,.13,palette[i%4]));
 }
 private control(name:string){return this.controls.get(name.replace(/\./g,''))??this.controls.get(name)??[...this.controls.values()].find(o=>o.name===name.replace(/\./g,'_'))!;}
 private async buildQuotaBoard(){
  this.quotaCanvas.width=1024;this.quotaCanvas.height=416;
  const image=new Image();image.src=boardFrameUrl;await image.decode();this.quotaFrame=image;
  await document.fonts.load('800 72px ChillRoundF').catch(()=>{});
  this.quotaTexture=new T.CanvasTexture(this.quotaCanvas);this.quotaTexture.colorSpace=T.SRGBColorSpace;
  this.quotaBoard.name='QuotaBoard';this.quotaBoardMesh=new T.Mesh(new T.PlaneGeometry(6.0,2.44),new T.MeshBasicMaterial({map:this.quotaTexture,transparent:true,depthWrite:false,side:T.DoubleSide,toneMapped:false}));
  this.quotaBoardMesh.frustumCulled=false;this.quotaBoard.add(this.quotaBoardMesh);this.scene.add(this.quotaBoard);this.quotaBoard.visible=false;
  this.paintQuotaBoard();
 }
 private paintQuotaBoard(){
  if(!this.quotaFrame||!this.quotaTexture)return;
  this.quota=currentCodexQuota(this.quota);const label=this.quota.label;
  const c=this.quotaCanvas.getContext('2d')!;c.clearRect(0,0,1024,416);c.drawImage(this.quotaFrame,0,0);
  c.fillStyle='#3e2516';c.textAlign='center';c.textBaseline='middle';
  let size=76;c.font=`800 ${size}px "ChillRoundF","Microsoft YaHei",sans-serif`;
  while(c.measureText(label).width>856&&size>44){size-=2;c.font=`800 ${size}px "ChillRoundF","Microsoft YaHei",sans-serif`;}
  c.fillText(label,512,189);this.quotaTexture.needsUpdate=true;this.quotaLabel=label;
  this.canvas.dataset.quotaLabel=label;this.canvas.dataset.quotaStatus=this.quota.status;
 }
 setQuota(quota:CodexQuotaSnapshot){this.quota={...quota};this.paintQuotaBoard();}
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
   const plant=new T.Group();plant.name='CucumberPlant_'+i;plant.position.set((i-1)*.21,.2,0);plant.scale.setScalar(1.14);pot.add(plant);
   this.mesh(new T.CylinderGeometry(.019,.024,.38,8),'#58834d',plant,[0,.19,0]);
   this.mesh(new T.SphereGeometry(1,12,8),'#6ca45e',plant,[-.045,.3,.01],[.1,.035,.06]).rotation.z=.45;
   this.mesh(new T.SphereGeometry(1,12,8),'#8bbb6a',plant,[.055,.23,.04],[.1,.035,.06]).rotation.z=-.45;
   this.mesh(new T.CapsuleGeometry(.045,.16,4,8),'#537c48',plant,[0,.16,.065]);
  }
  this.mesh(new T.CylinderGeometry(.16,.18,.28,24),'#65939a',this.can,[0,0,0]);
  const handle=this.mesh(new T.TorusGeometry(.27,.027,8,32),'#476f7c',this.can,[0,.13,0]);handle.scale.y=.65;
  const spout=this.mesh(new T.CylinderGeometry(.026,.055,.35,12),'#739fa6',this.can,[-.26,.04,0]);spout.rotation.z=-1.1;
  // The rose neck meets the spout's far end; its wide face points outward.
  const rose=this.mesh(new T.CylinderGeometry(.09,.035,.055,16),'#aac8c7',this.can,[-.43,-.047,0]);rose.rotation.z=Math.PI-1.1;
  this.can.position.set(-.38,1.05,1.02);this.can.rotation.z=.45;
  const normalX=-Math.sin(1.1),normalY=-Math.cos(1.1);
  for(let i=0;i<7;i++){
   const lateral=(i-3)*.012,angle=i*2.399963229728653,targetY=[.46,.54,.415,.58,.445,.52,.405][i];
   this.waterLanes.push({
    mouth:new T.Vector3(-.43+normalX*.0275+Math.cos(1.1)*lateral,-.047+normalY*.0275-Math.sin(1.1)*lateral,Math.sin(angle)*.022),
    start:new T.Vector3(),control:new T.Vector3(),
    target:new T.Vector3(-1.52+(i-3)*.08,targetY,.8+Math.sin(angle)*.09),targetY,
    phase:i*.071,speed:1.68+i*.01
   });
  }
  // Forty-two short strands share one instanced draw; the droplets also share
  // their geometry/material. Both layers remain translucent through crossings.
  this.waterSpray=new T.InstancedMesh(new T.CylinderGeometry(.0075,.0075,1,5,1,true),this.basic('#9bcede',.22),42);
  this.waterSpray.name='WaterSprayStrands';this.waterSpray.frustumCulled=false;this.waterSpray.instanceMatrix.setUsage(T.DynamicDrawUsage);this.watering.add(this.waterSpray);
  const dropGeometry=new T.SphereGeometry(.0115,6,6),dropMaterial=this.basic('#a9dce7',.38);
  for(let i=0;i<56;i++){const d=new T.Mesh(dropGeometry,dropMaterial);d.name='WaterDrop_'+i;this.watering.add(d);this.drops.push(d);}
  for(let i=0;i<5;i++){const flower=new T.Group();for(let p=0;p<5;p++)this.mesh(new T.SphereGeometry(.055,10,6),i%2?'#f2bfcb':'#ffe1a2',flower,[Math.cos(p*TAU/5)*.06,Math.sin(p*TAU/5)*.06,0],[1,.8,.35]);this.mesh(new T.SphereGeometry(.035,10,6),'#e8b45e',flower,[0,0,.025]);this.flowers.add(flower);}
  // Flame ribbons wrap around the actual model volume; rear tongues are occluded.
  for(let i=0;i<7;i++){
   const geometry=new T.PlaneGeometry(.65,1.15);geometry.translate(0,.575,0);
   const flame=new T.Mesh(geometry,new T.MeshBasicMaterial({map:this.auraTexture,transparent:true,opacity:.26,depthWrite:false,side:T.DoubleSide,toneMapped:false}));this.aura.add(flame);
  }
 }
 private waterPoint(lane:WaterLane,q:number,out:T.Vector3){
  const u=1-q,a=u*u,b=2*u*q,c=q*q;
  return out.set(a*lane.start.x+b*lane.control.x+c*lane.target.x,a*lane.start.y+b*lane.control.y+c*lane.target.y,a*lane.start.z+b*lane.control.z+c*lane.target.z);
 }
 private updateWaterSpray(t:number){
  this.waterNormal.set(-Math.sin(1.1),-Math.cos(1.1),0).transformDirection(this.can.matrixWorld);
  for(let i=0;i<this.waterLanes.length;i++){
   const lane=this.waterLanes[i];
   lane.start.copy(lane.mouth).applyMatrix4(this.can.matrixWorld);
   // Every branch falls from the current outlet, including during can sway.
   lane.target.y=Math.min(lane.targetY,lane.start.y-.075);
   lane.control.copy(lane.start).addScaledVector(this.waterNormal,clamp(lane.start.distanceTo(lane.target)*.35,.07,.28));
   lane.control.y=clamp(lane.control.y,lane.target.y+.015,lane.start.y-.025);
   for(let j=0;j<6;j++){
    const q=j===0?0:(t*(.91+i*.013)+(j-1)/5+lane.phase)%1;
    this.waterPoint(lane,q,this.waterPointA);
    this.waterPoint(lane,Math.min(1,q+(j===0?.13:.065+j*.003)),this.waterPointB);
    this.waterDirection.subVectors(this.waterPointB,this.waterPointA);
    const length=this.waterDirection.length(),radius=.95-q*.3;
    this.waterSegment.position.copy(this.waterPointA).add(this.waterPointB).multiplyScalar(.5);
    this.waterSegment.quaternion.setFromUnitVectors(this.waterUp,this.waterDirection.normalize());
    this.waterSegment.scale.set(radius,length,radius);this.waterSegment.updateMatrix();
    this.waterSpray!.setMatrixAt(i*6+j,this.waterSegment.matrix);
   }
   for(let j=0;j<8;j++){
    const q=(t*lane.speed+j/8+lane.phase)%1,drop=this.drops[i*8+j];
    this.waterPoint(lane,q,drop.position);
    const envelope=.55+.45*smooth(q/.08)*(1-smooth((q-.9)/.1));
    drop.scale.set(envelope,envelope*(1.4+q*1.25),envelope);
   }
  }
  this.waterSpray!.instanceMatrix.needsUpdate=true;
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
  if(action==='quota-board'){
   const motion=quotaBoardMotion(t);p.board=motion.arm;p.armL=2.25*motion.arm;p.armR=-p.armL;p.reach=.04*motion.arm;
   p.rise=0;p.open=1;p.head=-.012*motion.arm;
  }
  if(action==='touch'){
   const pressure=touchPressure(t,this.touchInitialPressure),motion=this.reducedMotion?.55:1;
   p.rise=0;p.headOffsetY=-TOUCH_HEAD_DROP*pressure*motion;p.head=.035*pressure*motion;
   p.squeeze=clamp(pressure,0,1);p.touch=p.squeeze*(1-smooth((t-.18)/.06));p.open=1;
  }
  if(action==='tearful'){
   const elapsed=this.tearfulOverlay?this.tearfulClock:t,weight=tearfulWeight(elapsed,TEARFUL_SECONDS);
   const settle=Math.exp(-elapsed/1.0),motion=this.reducedMotion?.55:1;
   p.tearful=weight;p.open=1;p.head=(.055+.055*settle)*weight;
   p.headOffsetY=-.065*(.45+.55*settle)*weight*motion;
   p.pitch=.027*weight;p.yaw=0;p.headYaw=0;
   p.headRoll=this.reducedMotion?0:Math.sin(elapsed*TAU/1.0)*Math.exp(-elapsed*3.8)*.012*weight;
   p.rise=(-.034+wave*.003)*weight;p.armL=-.20*weight;p.armR=.20*weight;p.reach=-.21*weight;
  }
  if(action==='celebrate-poppers'){
   const lift=smooth(t/.38)*(1-smooth((t-1.93)/.57));
   p.popper=lift;p.armL=1.98*lift;p.armR=-1.98*lift;p.reach=.95*lift;
   p.happy=lift;p.rise+=Math.sin(t*TAU/1.25)*.018*lift;p.head=-.025*lift;
  }
  if(action==='celebrate-clap'){
   const lift=smooth(t/.30)*(1-smooth((t-1.86)/.54));
   const beat=(at:number)=>Math.max(0,1-Math.abs(t-at)/.16);
   const contact=smooth(Math.max(beat(.66),beat(1.10)));
   p.clap=lift;p.armL=(-.43-.32*contact)*lift;p.armR=-p.armL;p.reach=-1.22*lift;
   p.happy=lift;p.rise+=Math.sin(t*TAU/1.5)*.012*lift;
  }
  if(action.startsWith('feedback-')){
   const kind=action.slice(9) as keyof typeof FEEDBACK_SECONDS,duration=FEEDBACK_SECONDS[kind];
   const weight=smooth(t/.20)*(1-smooth((t-(duration-.50))/.50));
   const strength=kind==='failed'?1:kind==='quota'?.7:.5;
   const shake=this.reducedMotion?0:Math.sin(t*TAU/(kind==='quota'?.36:.27))*Math.exp(-t*3.4)*.025*strength;
   // Only the eye painting is compressed. The head and sleeves stay rigid,
   // with a short settling motion instead of a model squash or hard freeze.
   p.open=1-.82*weight;p.head=(.028+shake)*weight;p.pitch=.012*weight;
   p.rise-=.012*weight;p.armL=.045*weight;p.armR=-.045*weight;
   p.reach=.025*weight;p.headRoll=shake*.40*weight;
  }
  if(action==='dizzy'){
   const weight=smooth(t/.30)*(1-smooth((t-(DIZZY_SECONDS-.65))/.65));
   const sway=this.reducedMotion?0:Math.sin(t*TAU/1.45);
   p.dizzy=weight;p.open=1;p.headRoll=sway*.045*weight;p.head=Math.cos(t*TAU/1.8)*.020*weight;
   p.headYaw=sway*.025*weight;p.lean=-sway*.012*weight;p.armL=.055*weight;p.armR=-.055*weight;
  }
  if(action==='drag'){const cycle=dragCycle(t),k=cycle.kick;
    // Lift from the upper back: the torso tips forward and the head nods over
    // the chest, while the face stays nearly frontal.
    p.drag=1;p.rise=.17;p.pitch=.24+k*.055;p.yaw=-.10;p.lean=.035;p.head=.10-k*.08;p.headYaw=.03;
    p.armL=.10+k*.46;p.armR=-.08-k*.40;p.reach=-.32+k*.62;
    p.footL=-.08-k*.27;p.footR=.08+k*.30;p.open=.85;p.squeeze=cycle.squeeze;p.kick=k;}
  if(action==='touch'&&this.tearfulOverlay){
   const weight=tearfulWeight(this.tearfulClock,TEARFUL_SECONDS);
   const settle=Math.exp(-this.tearfulClock/1.0),motion=this.reducedMotion?.55:1;
   const held=-.065*(.45+.55*settle)*weight*motion;
   p.headOffsetY=held+p.headOffsetY*(1-Math.abs(held)/(TOUCH_HEAD_DROP*motion));
   p.tearful=weight;p.squeeze*=1-weight;p.open=1;p.head+=(.055+.055*settle)*weight;p.headYaw=0;p.yaw=0;
   p.pitch=.027*weight;p.rise=-.034*weight;p.armL=-.20*weight;p.armR=.20*weight;p.reach=-.21*weight;
  }
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
  head.rotation.set(p.head+by*.012,p.headYaw+bx*.055,p.headRoll-p.drag*.045);
  head.position.y+=p.headOffsetY;
  // A small rigid sway uses the existing hair controller and keeps the clip
  // attached. Its weight blends in and out with the full-power pose.
  const hair=this.control('CTRL_Hair');
  hair.rotation.z+=p.power*(Math.sin(t*TAU/1.7)*.023+Math.sin(t*TAU/2.6)*.008);
  // The scalp stays attached; only the lower hair carries a small damped lag.
  if(this.hairMaterial)this.hairMaterial.uniforms.hairBend.value=this.hairSway.angle*p.drag*(this.reducedMotion?.35:1);
  this.control('CTRL_Arm.L').rotation.set(p.reach,0,p.armL);this.control('CTRL_Arm.R').rotation.set(p.reach,0,p.armR);
  // Move each complete sleeve/hand group together behind the hair. All local
  // hand transforms, joint connections, rigid geometry and scales stay intact.
  for(const [side,sign] of [['L',1],['R',-1]] as const){const arm=this.control('CTRL_Arm.'+side);arm.position.y+=1.67*p.board;arm.position.x+=sign*.72*p.board;arm.position.z-=.08*p.board;}
  for(const [s,sign,a] of [['R',-1,p.footR],['L',1,p.footL]] as const){const foot=this.control('CTRL_Foot.'+s);foot.position.x+=sign*p.spread;foot.position.y-=p.rise*(1-p.drag);foot.rotation.set(p.drag*(-.18+p.kick*(s==='R'?.7:.52)),0,a);if(s==='R')foot.position.y+=p.liftFoot;}
  for(let i=0;i<2;i++){
   const joint=this.control('CTRL_Eye.'+(i?'L':'R'));joint.position.x+=gx*.105;joint.position.y-=gy*.065;
   joint.rotation.y=gx*.035;this.drawEye(i,p,eyeTime);
  }
  const root=this.control('CTRL_Root');
  const suspendedAngle=this.suspension.angle*p.drag;
  root.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),suspendedAngle));
  root.position.add(this.suspensionPivot).sub(this.suspensionPivot.clone().applyQuaternion(root.quaternion));
  this.model!.updateMatrixWorld(true);
  this.watering.visible=p.water>.005;this.watering.scale.setScalar(1);
  this.can.rotation.set(0,p.yaw,.35+Math.sin(t*2)*.035);
  const palmL=this.control('CTRL_Hand.L').getWorldPosition(this.canPalmL),palmR=this.control('CTRL_Hand.R').getWorldPosition(this.canPalmR);
  this.can.position.copy(palmL.add(palmR).multiplyScalar(.5));this.can.position.y-=.14;this.can.position.z=Math.max(1.02,this.can.position.z+.025);
  this.can.updateMatrixWorld(true);
  this.watering.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshBasicMaterial;m.transparent=true;m.opacity=(o.name.startsWith('WaterDrop_') ? .38*p.flow : o===this.waterSpray ? .22*p.flow : 1)*p.water;}});
  if(p.water>.005&&p.flow>.001)this.updateWaterSpray(t);
  this.flowers.visible=p.happy>.005&&p.popper<.005&&p.clap<.005;for(let i=0;i<5;i++){const f=this.flowers.children[i],a=t*1.1+i*TAU/5;f.position.set(Math.cos(a)*1.65,2.6+Math.sin(a)*.7,.6+Math.sin(a)*.3);f.rotation.z=t*1.8+i;f.scale.setScalar(p.happy*1.24);}
  this.aura.visible=p.power>.005;for(let i=0;i<7;i++){const a=i*TAU/7;const f=this.aura.children[i] as T.Mesh;f.position.set(Math.cos(a)*1.65,.06,Math.sin(a)*1.1);f.rotation.y=0;f.scale.set(1.5,1.7+Math.sin(t*5+i)*.25+Math.abs(Math.cos(a))*.6,1);(f.material as T.MeshBasicMaterial).opacity=p.power*(.18+.04*Math.sin(t*4+i));}
  const frame=Math.floor(t*30)%36;this.auraTexture?.offset.set((frame%6)/6,(5-Math.floor(frame/6))/6);
  this.applyFeedback(p,t);
  const boardMotion=quotaBoardMotion(t);
  const boardOpacity=this.action==='quota-board'?boardMotion.opacity:this.boardReleasing?this.boardRelease.opacity*(1-smooth(t/QUOTA_BOARD_FADE_SECONDS)):0;
  this.quotaBoard.visible=boardOpacity>.002;
  if(this.quotaBoard.visible){
   this.quotaBoard.position.set(0,this.action==='quota-board'?boardMotion.height:this.boardRelease.height-.45*smooth(t/QUOTA_BOARD_BLEND_SECONDS),-.90);
   this.quotaBoard.rotation.set(this.action==='quota-board'?boardMotion.tilt:this.boardRelease.tilt+.12*smooth(t/QUOTA_BOARD_BLEND_SECONDS),0,0);
   (this.quotaBoardMesh!.material as T.MeshBasicMaterial).opacity=boardOpacity;
   if(currentCodexQuota(this.quota).label!==this.quotaLabel)this.paintQuotaBoard();
  }
  this.scene.updateMatrixWorld(true);
 }
 private applyFeedback(p:Pose,t:number){
  const opacity=(object:T.Object3D,amount:number)=>{object.visible=amount>.005;object.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.opacity=amount;});};
  for(let i=0;i<this.poppers.length;i++){
   const prop=this.poppers[i];prop.position.copy(this.control('CTRL_Hand.'+(i?'R':'L')).getWorldPosition(new T.Vector3()));
   prop.position.z=Math.max(1.15,prop.position.z+.07);prop.rotation.set(0,0,i?.40:-.40);opacity(prop,p.popper);prop.updateMatrixWorld(true);
  }
  for(let i=0;i<this.sweat.length;i++){
   const drop=this.sweat[i],u=clamp((t-.26-i*.10)/1.12,0,1);
   drop.position.set(i?-.91:.91,3.03-u*.27,1.6);drop.rotation.z=i?-.12:.12;
   drop.scale.setScalar(.65+.35*smooth(u/.2));opacity(drop,p.touch*smooth(u/.13)*(1-smooth((u-.72)/.28)));
  }
  for(let i=0;i<this.paper.length;i++){
   const mesh=this.paper[i],side=i%2,delay=.76+Math.floor(i/16)*.22,u=t-delay;
   const seed=(i*.61803398875)%1,spread=(seed-.5)*1.6;
   const aperture=this.poppers[side].localToWorld(new T.Vector3(0,.24,0));
   mesh.position.copy(aperture);mesh.position.x+=spread*u;mesh.position.y+=(1.8+seed*.8)*u-1.2*u*u;
   mesh.position.z+=.15+seed*.3;mesh.rotation.z=i+u*(i%2?3.2:-2.8);
   opacity(mesh,u>0?p.popper*(1-smooth((u-.68)/.55)):0);
  }
  for(let i=0;i<this.stars.length;i++){
   const star=this.stars[i],u=t-.62-i*.065,a=i*TAU/5;
   if(p.dizzy>.005){
    const orbit=a+(this.reducedMotion?0:t*1.9);
    star.position.set(Math.cos(orbit)*.79,4.41+Math.sin(orbit)*.14,1.45+Math.sin(orbit)*.20);
    star.rotation.z=this.reducedMotion?i*.4:t*.8+i*.4;star.scale.setScalar(.86+.09*Math.sin(t*3+i));
    opacity(star,p.dizzy*(.70+.24*(Math.sin(orbit)+1)/2));continue;
   }
   star.position.set(Math.cos(a)*(1.10+Math.max(0,u)*.15),2.48+Math.sin(a)*.48+Math.max(0,u)*.25,1.55);
   star.rotation.z=i*.6+u*.65;star.scale.setScalar(.55+.45*smooth(u/.15));
   opacity(star,u>0?p.clap*smooth(u/.16)*(1-smooth((u-.72)/.65)):0);
  }
 }
 private drawEye(i:number,p:Pose,t:number){
  const c=this.eyeCanvases[i].getContext('2d')!;c.clearRect(0,0,192,256);c.save();c.translate(96,128);
  const tearful=p.tearful;
  const ask=p.ask,squeeze=p.squeeze*(1-tearful),side=i?1.1:.87;
  const open=Math.max(.025,p.open);c.scale(mix(1,side,ask),open);
  c.globalAlpha=(1-squeeze)*(1-p.happy)*(1-p.dizzy)*(1-tearful);
  {
   const rx=mix(35,61,ask),ry=mix(88,82,ask);c.beginPath();if(ask<.01)c.ellipse(0,0,rx,ry,0,0,TAU);else c.roundRect(-rx,-ry,rx*2,ry*2,[rx*.8,rx*.8,rx*.85,rx*.85]);
   const gold=c.createLinearGradient(0,-ry,0,ry);gold.addColorStop(0,ask>.1?'#c5a570':'#b87925');gold.addColorStop(1,ask>.1?'#efdbaa':'#ca8b30');c.fillStyle=gold;c.fill();
   if(ask>.001&&this.questionArt){c.save();c.globalAlpha=ask*(1-squeeze)*(1-p.happy)*(1-p.dizzy)*(1-tearful);c.drawImage(this.questionArt,-96,-128);c.restore();}
   if(p.work>.001){c.save();c.clip();c.globalAlpha=p.work*(1-squeeze)*(1-p.happy)*(1-p.dizzy);this.drawCodeFlow(c,t);c.restore();}
  }
  if(tearful>.001)this.drawTearfulEye(c,tearful*(1-p.happy)*(1-p.dizzy),this.tearfulClock,i);
  if(p.happy>.001){c.globalAlpha=p.happy*(1-squeeze)*(1-p.dizzy);c.strokeStyle='#b98537';c.lineWidth=10;c.lineCap='round';c.beginPath();c.arc(0,5,28,Math.PI*1.13,Math.PI*1.87);c.stroke();}
  if(squeeze>.001){c.globalAlpha=squeeze*(1-p.dizzy);c.drawImage(this.squeezeArt[i],-96,-128);}
  if(p.dizzy>.001){
   c.save();c.globalAlpha=p.dizzy;
   c.rotate(this.reducedMotion?0:t*.95);c.lineWidth=13;c.lineCap='round';c.strokeStyle='#b98537';c.beginPath();
   for(let j=0;j<=224;j++){const u=j/224,a=u*TAU*2.75,r=6+u*60,x=Math.cos(a)*r,y=Math.sin(a)*r;if(j)c.lineTo(x,y);else c.moveTo(x,y);}
   c.stroke();c.restore();
  }
  c.restore();this.eyeTextures[i].needsUpdate=true;
 }
 private drawTearfulEye(c:CanvasRenderingContext2D,weight:number,t:number,i:number){
  const rx=61,ry=82,reflection=tearfulReflection(t+i*.12,this.reducedMotion);
  c.save();c.globalAlpha=weight;
  // The frontal pose uses the reference's rounded gold eyes at equal size.
  // Catchlights follow one clear tear film within the painted dark rim.
  c.beginPath();c.roundRect(-rx,-ry,rx*2,ry*2,[rx*.8,rx*.8,rx*.85,rx*.85]);
  const gold=c.createLinearGradient(0,-ry,0,ry);
  gold.addColorStop(0,'#c5a570');gold.addColorStop(1,'#efdbaa');
  c.fillStyle=gold;c.fill();
  if(this.tearfulBase)c.drawImage(this.tearfulBase,-96,-128);
  c.save();c.clip();
  const waterLine=ry*.40+reflection.water*.35;
  const film=c.createLinearGradient(0,waterLine-14,0,ry);
  film.addColorStop(0,'rgba(247,253,247,0)');film.addColorStop(.42,'rgba(247,253,247,.06)');film.addColorStop(1,'rgba(242,253,247,.16)');
  c.fillStyle=film;c.fillRect(-rx,waterLine-14,rx*2,ry-waterLine+14);
  const x=13+reflection.sheen*.38,y=44+reflection.water*.85;
  const gloss=c.createRadialGradient(x,y,4,x,ry*.63,43);
  gloss.addColorStop(0,'rgba(255,253,241,.12)');gloss.addColorStop(1,'rgba(255,253,241,0)');
  c.fillStyle=gloss;c.fillRect(-rx,0,rx*2,ry);
  // The reference's two rounded catchlights quiver with the clear tear film.
  c.fillStyle='#fffbed';c.beginPath();
  c.ellipse(-21+reflection.sheen*.26,-42+reflection.water*.65,15+reflection.bulge*.12,21-reflection.bulge*.08,reflection.tilt*.015,0,TAU);c.fill();
  c.save();c.filter='blur(1px)';c.globalAlpha=weight*reflection.alpha;c.beginPath();
  c.ellipse(x,y,19+reflection.bulge*.28,9+reflection.bulge*.16,reflection.tilt*.035,0,TAU);c.fill();c.restore();
  c.save();c.filter='blur(2px)';c.globalAlpha=weight*.19;c.lineWidth=3;c.strokeStyle='#fffbed';c.lineCap='round';
  c.beginPath();c.moveTo(-rx*.62,ry*.94);c.quadraticCurveTo(0,ry*1.01,rx*.64,ry*.93);c.stroke();c.restore();
  c.restore();
  c.strokeStyle='#495743';c.lineWidth=12;c.lineCap='round';c.globalAlpha=weight;
  c.beginPath();c.moveTo(-74,-76);c.lineTo(74,-76);c.stroke();
  c.restore();
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
 private resize(tall:boolean){
  const wide=this.action==='drag'||this.releasing,board=this.action==='quota-board'||this.boardReleasing;
  this.boardViewport=board;const w=tall?768:1024,h=tall?1152:768;
  // The public 2D surface stays allocated through every Q-form interaction.
  // Resize only the offscreen WebGL target, then present one complete frame.
  if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
  this.canvas.dataset.tall=String(tall);this.canvas.dataset.wide=String(wide);
  const renderWidth=wide?1024:board?768:512,renderHeight=wide||board?768:512;
  if(this.renderer.domElement.width!==renderWidth||this.renderer.domElement.height!==renderHeight)this.renderer.setSize(renderWidth,renderHeight,false);
  this.camera.left=-renderWidth/200;this.camera.right=renderWidth/200;this.camera.top=wide||board?5.12:2.56;this.camera.updateProjectionMatrix();
 }
 getVisibleBounds(){
  if((this.canvas.width!==1024&&!this.boardViewport)||!this.model)return null;
  this.modelBounds.setFromObject(this.model);
  if(this.boardViewport){this.modelBounds.expandByPoint(new T.Vector3(-3.06,6.35,-.90));this.modelBounds.expandByPoint(new T.Vector3(3.06,3.65,-.90));}
  const left=this.projected.set(this.modelBounds.min.x,this.modelBounds.max.y,0).project(this.camera).clone();
  const right=this.projected.set(this.modelBounds.max.x,this.modelBounds.min.y,0).project(this.camera);
  const rw=this.renderer.domElement.width,rh=this.renderer.domElement.height,ox=(this.canvas.width-rw)/2,oy=this.canvas.height-rh;
  const x=Math.max(0,Math.floor(ox+(left.x+1)*rw/2)-4),y=Math.max(0,Math.floor(oy+(1-left.y)*rh/2)-4);
  return {x,y,width:Math.min(this.canvas.width-x,Math.ceil(ox+(right.x+1)*rw/2)+4-x),height:Math.min(this.canvas.height-y,Math.ceil(oy+(1-right.y)*rh/2)+4-y)};
 }
 private draw(p:Pose,t:number,eyeTime=t){
  this.apply(p,t,eyeTime);this.renderer.render(this.scene,this.camera);const c=this.context;c.clearRect(0,0,this.canvas.width,this.canvas.height);
  const x=(this.canvas.width-this.renderer.domElement.width)/2,y=this.canvas.height-this.renderer.domElement.height;c.drawImage(this.renderer.domElement,x,y);
  if(p.happy>.001){c.save();c.globalCompositeOperation='source-atop';c.fillStyle=`rgba(255,204,113,${p.happy*.09})`;c.fillRect(0,0,this.canvas.width,this.canvas.height);c.restore();}
  c.save();c.translate(this.canvas.width/2-256,this.canvas.height-512);
  if(p.nap>.01){for(let i=0;i<3;i++){const u=(t/2.7+i/3)%1;c.save();c.globalAlpha=p.nap*Math.sin(Math.PI*u);c.fillStyle='#344b75';c.font=`600 ${24+u*32}px "YouYuan",sans-serif`;c.fillText(i?'z':'Z',337+u*53,190-u*147);c.restore();}}
  if(p.ask>.01){c.globalAlpha=p.ask;c.fillStyle='#40523e';c.font='bold 43px "YouYuan",sans-serif';c.fillText('?',360,92-Math.sin(Math.min(t,.6)/.6*Math.PI)*8);}
  c.restore();
  if(this.canvas.width===1024||this.boardViewport){const signature=JSON.stringify(this.getVisibleBounds());if(signature!==this.viewportSignature){this.viewportSignature=signature;this.onViewportChange?.();}}
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
  this.look.step(dt/1000);this.suspension.step(dt/1000,this.action==='drag');
  this.hairSway.step(dt/1000,this.suspension.angle,this.suspension.angularVelocity,this.action==='drag');
  this.previous=now;this.frames++;const age=(now-this.start)/1000;
  if(this.tearfulOverlay)this.tearfulClock=Math.max(0,(now-this.tearfulStartedAt)/1000);
  else if(this.action==='tearful')this.tearfulClock=age;
  else if(this.pose.tearful>.001)this.tearfulClock+=dt/1000;
  if(this.releasing&&age>=.65){this.releasing=false;this.resize(false);}
  if(this.boardReleasing&&age>=QUOTA_BOARD_BLEND_SECONDS){this.boardReleasing=false;this.resize(false);}
  if(this.action==='transform')this.drawTurn(age);else{
   const feedback=this.action.startsWith('feedback-')||this.action==='dizzy'||this.action==='tearful';
   const t=(this.reducedMotion&&!feedback&&this.action!=='touch'&&this.action!=='quota-board')? .65:age,route=this.routed?.38:0;
   this.pose=age<route?blend(this.from,neutral(),smooth(age/route)):blend(this.routed?neutral():this.from,this.target(this.action,t),smooth((age-route)/(this.releasing?.65:this.action==='water'?1.4:this.action==='drag'?.23:this.action==='touch'?.025:feedback?.18:this.action==='quota-board'?QUOTA_BOARD_BLEND_SECONDS:this.action.startsWith('celebrate-')?.22:.55)));
   if(this.boardReleasing){const target=this.target(this.action,t),weight=smooth(age/QUOTA_BOARD_BLEND_SECONDS);for(const key of ['board','armL','armR','reach'] as const)this.pose[key]=mix(this.from[key],target[key],weight);}
   if(this.releasing&&age<.65)this.pose.rise-=Math.sin(age/.65*Math.PI)*.03;this.draw(this.pose,t,age);
  }
  this.velocity*=Math.exp(-Math.min(dt,100)*.007);
  const feedbackDuration=this.action.startsWith('feedback-')?FEEDBACK_SECONDS[this.action.slice(9) as keyof typeof FEEDBACK_SECONDS]:this.action==='dizzy'?DIZZY_SECONDS:this.action==='tearful'?TEARFUL_SECONDS:Infinity;
  if(!this.finished&&(age>=feedbackDuration||(this.action==='quota-board'&&age>=QUOTA_BOARD_SECONDS)||(this.action==='transform'&&age>=TURN_SECONDS)||(this.action==='touch'&&age>=TOUCH_SECONDS)||(this.action==='celebrate-poppers'&&age>=CELEBRATION_SECONDS.A)||(this.action==='celebrate-clap'&&age>=CELEBRATION_SECONDS.D))){this.finished=true;this.onTransientEnd?.();}
 };
 setAction(action:RigAction,restart=false){if(action==='transform'&&!presentationPolicy.transformation)return;if(action===this.action&&!restart)return;if(action==='touch')this.touchInitialPressure=this.action==='touch'?-this.pose.headOffsetY/(TOUCH_HEAD_DROP*(this.reducedMotion?.55:1)):0;
  this.boardReleasing=action!=='quota-board'&&(this.action==='quota-board'||this.boardReleasing)&&this.pose.board>.005;
  if(this.boardReleasing)this.boardRelease={height:this.quotaBoard.position.y,tilt:this.quotaBoard.rotation.x,opacity:(this.quotaBoardMesh!.material as T.MeshBasicMaterial).opacity};
  this.from={...this.pose};this.releasing=this.action==='drag';this.routed=this.action==='nap'&&['work','power-work','water'].includes(action);this.action=action;this.start=performance.now();this.finished=false;this.canvas.dataset.action=action;if(!['idle','work'].includes(action))this.look.target(0,0);this.resize(action==='transform');
  this.onViewportChange?.();
 }
 setLookTarget(x:number,y:number){const follows=this.action==='idle'||this.action==='work';this.look.target(follows?x:0,follows?y:0);}
 setTearful(enabled:boolean){if(enabled===this.tearfulOverlay)return;if(enabled){this.tearfulClock=0;this.tearfulStartedAt=performance.now();}this.tearfulOverlay=enabled;this.canvas.dataset.tearful=String(enabled);}
 setDragVelocity(dx:number){this.velocity=mix(this.velocity,clamp(dx,-12,12),.45);}
 beginDrag(){this.suspension.begin();}
 setDragMotion(dx:number,elapsedMs:number,displacementX:number){this.suspension.input(dx,elapsedMs,displacementX);}
 cancelToIdle(){this.setAction('idle');}
 setPaused(value:boolean){if(value&&!this.pausedAt)this.pausedAt=performance.now();else if(!value&&this.pausedAt){const paused=performance.now()-this.pausedAt;this.start+=paused;if(this.tearfulOverlay)this.tearfulStartedAt+=paused;this.pausedAt=0;}}
 renderAt(action:RigAction,t:number,_weight=1,_layer?:string){if(action==='transform'&&!presentationPolicy.transformation)action='idle';this.action=action;this.touchInitialPressure=0;this.releasing=false;this.boardReleasing=false;if(action==='tearful'||this.tearfulOverlay)this.tearfulClock=t;this.resize(action==='transform');this.canvas.dataset.action=action;if(action==='transform')this.drawTurn(t);else{this.pose=this.target(action,t);this.draw(this.pose,t);}}
 renderTransitionAt(from:RigAction,to:RigAction,t:number){this.action=to;this.releasing=from==='drag'&&t<.65;this.resize(false);const route=from==='nap'&&['work','power-work','water'].includes(to)?.38:0;
  if(to==='touch')this.touchInitialPressure=0;
  if(from==='tearful'||to==='tearful'||this.tearfulOverlay)this.tearfulClock=t;
  this.pose=t<route?blend(this.target(from,1),neutral(),smooth(t/route)):blend(route?neutral():this.target(from,1),this.target(to,t),smooth((t-route)/(from==='drag'?.65:to==='water'?1.4:to==='drag'?.23:to==='touch'?.025:.55)));
  if(from==='drag'&&t<.65)this.pose.rise-=Math.sin(t/.65*Math.PI)*.03;this.draw(this.pose,t);}
 renderGazeAt(x:number,y:number,t=0){this.look.snap(x,y);this.renderAt('idle',t);}
 exportPose(){return {pose:this.pose,quota:this.quota,board:{visible:this.quotaBoard.visible,position:this.quotaBoard.position.toArray(),opacity:(this.quotaBoardMesh?.material as T.MeshBasicMaterial)?.opacity??0},suspension:{angle:this.suspension.angle,angularVelocity:this.suspension.angularVelocity,pivot:this.suspensionPivot.toArray()},controls:[...this.controls.values()].filter(o=>o.name.startsWith('CTRL')).map(o=>({name:o.name,position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray()})),can:{position:this.can.position.toArray(),quaternion:this.can.quaternion.toArray()},grand:this.action==='transform'&&this.canvas.height===1152};}
 async exportProps(){this.renderAt('water',2);return await new GLTFExporter().parseAsync(this.watering,{binary:true,onlyVisible:false});}
 hit(cx:number,cy:number){const r=this.canvas.getBoundingClientRect(),x=Math.floor((cx-r.left)*this.canvas.width/r.width),y=Math.floor((cy-r.top)*this.canvas.height/r.height);return x>=0&&y>=0&&x<this.canvas.width&&y<this.canvas.height&&this.context.getImageData(x,y,1,1).data[3]>40;}
 dispose(){this.disposed=true;cancelAnimationFrame(this.raf);this.waterSpray?.dispose();const textures=new Set<T.Texture>();this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const v of Object.values(m))if(v instanceof T.Texture)textures.add(v);if(m instanceof T.ShaderMaterial)for(const u of Object.values(m.uniforms))if(u.value instanceof T.Texture)textures.add(u.value);m.dispose();}}});for(const tex of textures)tex.dispose();this.renderer.dispose();this.renderer.forceContextLoss();}
}
