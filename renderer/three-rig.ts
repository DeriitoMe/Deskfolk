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
import {quotaBoardMotion,quotaBoardGripHeight,QUOTA_BOARD_SECONDS,QUOTA_BOARD_BLEND_SECONDS,QUOTA_BOARD_FADE_SECONDS} from '../shared/quota-board-motion';
import {ClaudeProps} from './claude-props';
import {NewspaperProp} from './newspaper-prop';
import {readingScan} from '../shared/reading-motion';
import {CONFETTI_PIECES,POPPER_SHOTS,confettiFlight,confettiPiece,type ConfettiPiece} from '../shared/confetti-motion';
import {celebrateMotion} from '../shared/celebrate-motion';
import {GuitarProp} from './guitar-prop';
import {guitarMotion} from '../shared/guitar-motion';
import {guitarSoloMotion} from '../shared/guitar-solo';
import {currentCodexQuota,unknownCodexQuota,type CodexQuotaSnapshot} from '../shared/quota';
import {quotaLabel} from '../shared/quota-copy';
import {translate, type AppLocale} from '../shared/i18n';
export const TURN_SECONDS=10.2;
export type RigAction='idle'|'nap'|'water'|'water-happy'|'work'|'power-work'|'ask'|'touch'|'tearful'|'drag'|'transform'|'celebrate-poppers'|'celebrate-clap'|'feedback-failed'|'feedback-paused'|'feedback-quota'|'dizzy'|'quota-board'|'claude-type'|'claude-write'|'read-paper'|'guitar'|'guitar-solo';
const maps=import.meta.glob<string>('../assets/characters/wakaba-mutsumi/v41-3d/runtime/{hair-paint,hair_all_visible,back-hair-paint,back-hair-mask,side-hair-clean,question-eye,flame-atlas}.png',{eager:true,query:'?url',import:'default'});
const urls=Object.fromEntries(Object.entries(maps).map(([p,u])=>[p.split('/').pop()!,u]));
const clamp=T.MathUtils.clamp, mix=T.MathUtils.lerp,TAU=Math.PI*2;
const smooth=(v:number)=>{v=clamp(v,0,1);return v*v*(3-2*v);};
type Pose={rise:number;lean:number;pitch:number;yaw:number;head:number;headOffsetY:number;headYaw:number;headRoll:number;armL:number;armR:number;reach:number;footL:number;footR:number;spread:number;liftFoot:number;open:number;nap:number;water:number;flow:number;happy:number;work:number;power:number;ask:number;touch:number;tearful:number;drag:number;squeeze:number;gaze:number;followBody:number;kick:number;popper:number;clap:number;dizzy:number;board:number;type:number;write:number;paper:number;scanX:number;scanY:number;snap:number;popL:number;popR:number;jump:number;swish:number;guitar:number;strum:number;fretting:number};
const neutral=():Pose=>({paper:0,scanX:0,scanY:0,snap:0,popL:0,popR:0,jump:0,swish:0,guitar:0,strum:0,fretting:0,rise:0,lean:0,pitch:0,yaw:0,head:0,headOffsetY:0,headYaw:0,headRoll:0,armL:0,armR:0,reach:0,footL:0,footR:0,spread:0,liftFoot:0,open:1,nap:0,water:0,flow:0,happy:0,work:0,power:0,ask:0,touch:0,tearful:0,drag:0,squeeze:0,gaze:0,followBody:0,kick:0,popper:0,clap:0,dizzy:0,board:0,type:0,write:0});
const blend=(a:Pose,b:Pose,u:number)=>Object.fromEntries(Object.keys(a).map(k=>[k,mix(a[k as keyof Pose],b[k as keyof Pose],u)])) as Pose;
type Rest={position:T.Vector3;quaternion:T.Quaternion;scale:T.Vector3};
type WaterLane={mouth:T.Vector3;start:T.Vector3;control:T.Vector3;target:T.Vector3;targetY:number;phase:number;speed:number;fan:number};
const WATER_DASHES=6;

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
 private aura=new T.Group();private projected=new T.Vector3();
 private waterLanes:WaterLane[]=[];private waterSpray?:T.InstancedMesh;private cucumberPlants:T.Group[]=[];
 private waterSegment=new T.Object3D();private waterPointA=new T.Vector3();private waterPointB=new T.Vector3();
 private waterDirection=new T.Vector3();private waterNormal=new T.Vector3();private waterUp=new T.Vector3(0,1,0);
 private canPalmL=new T.Vector3();private canPalmR=new T.Vector3();
 /** Centre of each visible mitten in its hand controller's space (the pivot sits at the wrist). */
 private mittenCenter={L:new T.Vector3(),R:new T.Vector3()};private gripL=new T.Vector3();private gripR=new T.Vector3();
 /** Distance between the mittens in the resting reading pose; the sheet stretches with any extra pull. */
 private readingSpan=1;
 private claudeProps=new ClaudeProps((color,opacity=1)=>this.basic(color,opacity));
 private newspaper=new NewspaperProp();
 private guitar=new GuitarProp();
 private feedback=new T.Group();private poppers:T.Object3D[]=[];private paper:T.Mesh[]=[];
 private confetti:ConfettiPiece[]=[];
 /** Popper mouth and barrel at each shot, fixed in the scene so flying confetti never follows the hands. */
 private popperMouths:{mouth:T.Vector3;barrel:T.Vector2}[]=[];private stars:T.Mesh[]=[];private sweat:T.Mesh[]=[];
 private suspension=new DragPendulum();private suspensionPivot=new T.Vector3();
 private hairSway=new HairSway();private hairMaterial?:T.ShaderMaterial;
 private modelBounds=new T.Box3();private viewportSignature='';
 private quotaBoard=new T.Group();private quotaBoardMesh?:T.Mesh;private quotaCanvas=document.createElement('canvas');private quotaTexture?:T.CanvasTexture;private quotaFrame?:HTMLImageElement;
 private quota=unknownCodexQuota();private quotaLabel='';private locale:AppLocale='zh-CN';private boardViewport=false;private boardReleasing=false;
 private boardRelease={height:0,tilt:0,roll:0,opacity:0};
 /** Working eyes: soft light streaks (chosen 2026-10-17); 'classic' keeps the glyph flow. */
 codeFlowStyle:'classic'|'soft'='soft';
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
  for(const side of ['L','R'] as const){const hand=this.control('CTRL_Hand.'+side);hand.worldToLocal(new T.Box3().setFromObject(hand).getCenter(this.mittenCenter[side]));}
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
  this.buildEyes();this.buildProps();await this.newspaper.load();await this.guitar.load();await this.buildFeedback(loader);this.measurePopperMouths();this.measureReadingSpan();this.measureGuitarHold();await this.grand?.ready;
  // Upload every prop and compile its shader before the first visible action.
  this.apply(this.target('water',2),2);this.flowers.visible=this.aura.visible=true;this.claudeProps.showAll();this.newspaper.showAll();this.guitar.showAll();
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
  for(let i=0;i<CONFETTI_PIECES;i++){
   const piece=confettiPiece(i),mesh=plane(textures[3],.085,.13,palette[(i*3+(i>>1))%4]);
   // Paper flips through edge-on while it tumbles, so both faces are drawn.
   (mesh.material as T.MeshBasicMaterial).side=T.DoubleSide;mesh.scale.setScalar(piece.scale);
   this.paper.push(mesh);this.confetti.push(piece);
  }
 }
 private measureGuitarHold(){
  const p=this.target('guitar',1);this.apply(p,1);
  const R=this.control('CTRL_Hand.R').localToWorld(this.mittenCenter.R.clone()),L=this.control('CTRL_Hand.L').localToWorld(this.mittenCenter.L.clone());
  this.guitar.fit(R,L);
 }
 private measureReadingSpan(){
  this.apply(this.target('read-paper',1),1);
  const L=this.control('CTRL_Hand.L').localToWorld(this.mittenCenter.L.clone()),R=this.control('CTRL_Hand.R').localToWorld(this.mittenCenter.R.clone());
  this.readingSpan=L.distanceTo(R);
 }
 private measurePopperMouths(){
  this.popperMouths=[0,1].map(side=>{
   this.apply(this.target('celebrate-poppers',POPPER_SHOTS[side]),POPPER_SHOTS[side]);
   const prop=this.poppers[side],base=prop.localToWorld(new T.Vector3(0,0,0)),mouth=prop.localToWorld(new T.Vector3(0,.24,0));
   const barrel=new T.Vector2(mouth.x-base.x,mouth.y-base.y).normalize();
   return {mouth,barrel};
  });
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
  this.quota=currentCodexQuota(this.quota);const label=quotaLabel(this.quota,this.locale);
  const c=this.quotaCanvas.getContext('2d')!;c.clearRect(0,0,1024,416);c.drawImage(this.quotaFrame,0,0);
  c.fillStyle='#3e2516';c.textAlign='center';c.textBaseline='middle';
  let size=76;c.font=`800 ${size}px "ChillRoundF","Microsoft YaHei",sans-serif`;
  while(c.measureText(label).width>856&&size>44){size-=2;c.font=`800 ${size}px "ChillRoundF","Microsoft YaHei",sans-serif`;}
  c.fillText(label,512,189);this.quotaTexture.needsUpdate=true;this.quotaLabel=label;
  this.canvas.dataset.quotaLabel=label;this.canvas.dataset.quotaStatus=this.quota.status;
 }
 setQuota(quota:CodexQuotaSnapshot){this.quota={...quota};this.paintQuotaBoard();}
 setLocale(locale:AppLocale){this.locale=locale;this.canvas.setAttribute('aria-label',translate(locale,'若叶睦'));this.paintQuotaBoard();}
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
  this.scene.add(this.watering,this.flowers,this.aura,this.claudeProps.group,this.newspaper.group,this.guitar.group);this.watering.add(this.can);
  this.newspaper.paint();
  const pot=new T.Group();pot.name='CucumberPlanter';pot.position.set(-1.46,.2,.8);this.watering.add(pot);
  // Terracotta planter: body, darker lip shadow, lighter rim, soil and pebbles.
  this.mesh(new T.BoxGeometry(.74,.32,.42),'#c27454',pot,[0,0,0]);this.mesh(new T.BoxGeometry(.75,.035,.43),'#a65e43',pot,[0,.115,0]);
  this.mesh(new T.BoxGeometry(.8,.07,.47),'#e09a72',pot,[0,.15,0]);this.mesh(new T.BoxGeometry(.8,.012,.47),'#f2bd96',pot,[0,.188,0]);
  this.mesh(new T.BoxGeometry(.69,.03,.34),'#4f3626',pot,[0,.195,0]);
  for(const [x,z,r] of [[-.24,.1,.022],[.19,.12,.018],[.05,.13,.015],[-.08,-.1,.02]])this.mesh(new T.SphereGeometry(r,8,6),'#8d7058',pot,[x,.214,z],[1,.6,1]);
  // A bamboo cane gives the vines something to climb.
  this.mesh(new T.CylinderGeometry(.012,.014,.78,6),'#d8bd84',pot,[.03,.58,-.06]);
  this.mesh(new T.CylinderGeometry(.016,.016,.02,6),'#b99a5f',pot,[.03,.62,-.06]);
  const curve=(points:number[][])=>new T.CatmullRomCurve3(points.map(([x,y,z])=>new T.Vector3(x,y,z)));
  const tube=(c:T.Curve<T.Vector3>,r:number,color:string,parent:T.Object3D)=>{const m=new T.Mesh(new T.TubeGeometry(c,24,r,6,false),this.basic(color));parent.add(m);return m;};
  const leaf=(parent:T.Object3D,pos:number[],size:number,angle:number,color:string)=>{
   // Heart-shaped cucumber leaf: two lobes and a tip, with a darker midrib.
   const g=new T.Group();g.position.set(pos[0],pos[1],pos[2]);g.rotation.set(-.25,0,angle);g.scale.setScalar(size);parent.add(g);
   this.mesh(new T.SphereGeometry(1,14,10),color,g,[-.045,0,0],[.075,.085,.014]);this.mesh(new T.SphereGeometry(1,14,10),color,g,[.045,0,0],[.075,.085,.014]);
   this.mesh(new T.SphereGeometry(1,12,8),color,g,[0,.055,0],[.06,.07,.014]);
   this.mesh(new T.BoxGeometry(.008,.13,.004),'#4c7a39',g,[0,.02,.016]);return g;
  };
  const blossom=(parent:T.Object3D,pos:number[],size:number)=>{
   const g=new T.Group();g.position.set(pos[0],pos[1],pos[2]);g.scale.setScalar(size);parent.add(g);
   for(let k=0;k<5;k++){const a=k*TAU/5+.3;this.mesh(new T.SphereGeometry(1,10,6),'#f9d84c',g,[Math.cos(a)*.026,Math.sin(a)*.026,0],[.022,.016,.006]).rotation.z=a;}
   this.mesh(new T.SphereGeometry(.012,8,6),'#e3a52a',g,[0,0,.006]);return g;
  };
  const fruit=(parent:T.Object3D,pos:number[],angle:number,length:number)=>{
   // Striped, bumpy cucumber hanging from the vine with a blossom at its tip.
   const g=new T.Group();g.position.set(pos[0],pos[1],pos[2]);g.rotation.z=angle;parent.add(g);
   this.mesh(new T.CapsuleGeometry(.036,length,4,10),'#3d7535',g,[0,-length/2,0]);
   for(const x of [-.016,.016])this.mesh(new T.CapsuleGeometry(.006,length*.85,2,6),'#6a9c4f',g,[x,-length/2,.03]);
   for(let k=0;k<7;k++)this.mesh(new T.SphereGeometry(.007,6,4),'#c3dc9c',g,[((k*37)%5-2)*.011,-.025-k*length/7,.036]);
   this.mesh(new T.CylinderGeometry(.008,.012,.035,6),'#5f8f45',g,[0,.02,0]);
   blossom(g,[0,-length-.045,.01],.85);return g;
  };
  const plants:[number,number,number,number][]=[[-.22,.34,-.16,.95],[.02,.5,.05,1.08],[.22,.4,.18,1.0]];
  plants.forEach(([x,height,lean,scale],i)=>{
   const plant=new T.Group();plant.name='CucumberPlant_'+i;plant.position.set(x,.2,.02);plant.scale.setScalar(scale);plant.rotation.z=lean*.4;plant.userData.baseRoll=lean*.4;pot.add(plant);
   const stem=curve([[0,0,0],[lean*.25,height*.35,.01],[-lean*.15,height*.7,.02],[lean*.3,height,.02]]);
   tube(stem,.014,'#5c8c43',plant);
   const top=stem.getPoint(1);
   leaf(plant,[stem.getPoint(.35).x-.07,height*.35,.05],1.05,.65,'#6eaa54');
   leaf(plant,[stem.getPoint(.62).x+.08,height*.62,.06],.95,-.6,'#86bf62');
   leaf(plant,[top.x-.03,top.y+.03,.05],.7,.25,'#7bb45a');
   // Curly tendril reaching toward the cane.
   const spiral:number[][]=[];for(let k=0;k<=14;k++){const u=k/14,a=u*TAU*1.6;spiral.push([top.x+.02+u*.07+Math.cos(a)*.022*(1-u*.4),top.y-.04+u*.05+Math.sin(a)*.022*(1-u*.4),.04]);}
   tube(curve(spiral),.0045,'#8fc063',plant);
   if(i!==0)fruit(plant,[stem.getPoint(.55).x+(i===1?-.02:.03),height*.55,.07],i===1?.28:-.22,i===1?.17:.13);
   else blossom(plant,[top.x+.01,top.y+.08,.07],1.1);
   this.cucumberPlants.push(plant);
  });
  // Apricot enamel can: warm against the navy dress, with a glossy streak.
  this.mesh(new T.CylinderGeometry(.17,.2,.3,28),'#eaa865',this.can,[0,0,0]);
  this.mesh(new T.TorusGeometry(.198,.017,8,32),'#c47e45',this.can,[0,-.135,0]).rotation.x=Math.PI/2;
  this.mesh(new T.TorusGeometry(.172,.015,8,32),'#c47e45',this.can,[0,.148,0]).rotation.x=Math.PI/2;
  this.mesh(new T.SphereGeometry(.17,24,12,0,TAU,0,Math.PI/2),'#f3c084',this.can,[0,.148,0],[1,.42,1]);
  this.mesh(new T.CylinderGeometry(.05,.055,.03,16),'#c47e45',this.can,[0,.2,0]);
  this.mesh(new T.BoxGeometry(.028,.2,.01),'#fff0d2',this.can,[.07,.01,.188]).rotation.y=.35;
  const handle=this.mesh(new T.TorusGeometry(.19,.026,8,32,Math.PI),'#c47e45',this.can,[.03,.16,0]);handle.scale.y=.85;
  const spout=this.mesh(new T.CylinderGeometry(.026,.055,.35,12),'#e39c5a',this.can,[-.26,.04,0]);spout.rotation.z=-1.1;
  // The rose neck meets the spout's far end; its wide face points outward.
  const rose=this.mesh(new T.CylinderGeometry(.09,.035,.055,16),'#f5cd94',this.can,[-.43,-.047,0]);rose.rotation.z=Math.PI-1.1;
  this.can.scale.setScalar(1.16);
  this.can.position.set(-.38,1.05,1.02);this.can.rotation.z=-.12;
  // Six showerhead streams leave the rose face. Upper streams fan out
  // farther; lower ones land close to her side of the planter.
  const normalX=-Math.sin(1.1),normalY=-Math.cos(1.1);
  for(let i=0;i<6;i++){
   const u=i/5,lateral=(u-.5)*.1,depth=Math.sin(i*2.399963229728653)*.03;
   this.waterLanes.push({
    mouth:new T.Vector3(-.43+normalX*.03+Math.cos(1.1)*lateral,-.047+normalY*.03-Math.sin(1.1)*lateral,depth),
    start:new T.Vector3(),control:new T.Vector3(),
    target:new T.Vector3(-1.72+.5*u,.43,.8+depth*3),targetY:.43,
    phase:i*.137,speed:1.05+(i%3)*.07,fan:(u-.5)*.5
   });
  }
  // Thin, slightly transparent dashes; one instanced draw for every stream.
  this.waterSpray=new T.InstancedMesh(new T.CylinderGeometry(.0065,.0065,1,6,1,true),this.basic('#6db9dc',.5),6*WATER_DASHES);
  this.waterSpray.name='WaterSprayDashes';this.waterSpray.frustumCulled=false;this.waterSpray.instanceMatrix.setUsage(T.DynamicDrawUsage);
  (this.waterSpray.material as T.Material).userData.flowOpacity=.5;this.watering.add(this.waterSpray);
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
   lane.target.y=Math.min(lane.targetY,lane.start.y-.12);
   // Leave along the (fanned) rose axis so the stream continues the spout,
   // then curve down under gravity into the soil.
   const c=Math.cos(lane.fan),s=Math.sin(lane.fan),dx=this.waterNormal.x,dy=this.waterNormal.y;
   this.waterDirection.set(dx*c-dy*s,dx*s+dy*c,0).normalize();
   lane.control.copy(lane.start).addScaledVector(this.waterDirection,Math.abs(lane.target.x-lane.start.x)*.5);
   lane.control.z=mix(lane.start.z,lane.target.z,.5);
   for(let j=0;j<WATER_DASHES;j++){
    const q=(t*lane.speed+j/WATER_DASHES+lane.phase)%1;
    this.waterPoint(lane,q,this.waterPointA);
    this.waterPoint(lane,Math.min(1,q+.085),this.waterPointB);
    this.waterDirection.subVectors(this.waterPointB,this.waterPointA);
    // Dashes are born thin at the rose and thin out again as they land.
    const length=this.waterDirection.length(),radius=.35+.65*smooth(q/.15)*(1-smooth((q-.8)/.2));
    this.waterSegment.position.copy(this.waterPointA).add(this.waterPointB).multiplyScalar(.5);
    this.waterSegment.quaternion.setFromUnitVectors(this.waterUp,this.waterDirection.normalize());
    this.waterSegment.scale.set(radius,length*radius,radius);this.waterSegment.updateMatrix();
    this.waterSpray!.setMatrixAt(i*WATER_DASHES+j,this.waterSegment.matrix);
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
  if(action==='claude-type'||action==='claude-write'){
   // Claude Code tool gestures keep the ordinary working eyes.
   const k=this.reducedMotion?.4:1;p.work=1;p.open=1;p.rise=wave*.005;p.spread=.045;
   if(action==='claude-type'){
    const tapL=Math.max(0,Math.sin(t*TAU*3.1))**2,tapR=Math.max(0,Math.sin(t*TAU*3.1+Math.PI*.9))**2;
    p.type=1;p.armL=-.5+.06*tapL*k;p.armR=.43-.06*tapR*k;p.reach=-.7;p.head=.035;p.pitch=.012;p.yaw=.05;p.headYaw=.12;
   }else{p.write=1;p.armL=-.52;p.armR=.5+Math.sin(t*14)*.02*k;p.reach=-.82;p.head=.07;p.headYaw=.05;p.pitch=.02;}
  }
  if(action==='ask'){p.ask=1;p.headYaw=-.24;p.yaw=-.06;p.open=1;}
  if(action==='guitar'||action==='guitar-solo'){
   // Idle pastime: the guitar across her front, the picking forearm over the
   // body and the fretting hand under the neck. One shared slow breath; twice
   // the fretting arm tips the neck up or down a few degrees while she looks
   // the guitar over, the head tilting along. Eyes wander over the guitar.
   // The easter egg lifts the neck into a playing angle and plays a short
   // lead: picks and fret changes are wrist turns, so the guitar stays still.
   const solo=action==='guitar-solo'?guitarSoloMotion(t,this.reducedMotion):null;
   const g=solo??guitarMotion(t,this.reducedMotion),raise=solo?.raise??0;
   // Looking up the raised neck lifts her chin a little, clear of the horn.
   const up=Math.max(0,g.inspect);
   p.guitar=1;p.head=.11+.006*g.breath-.035*up-.04*raise+.012*(solo?.nod??0);p.headRoll=.03*g.inspect;p.rise=-.01+.008*g.breath;p.pitch=.004*g.breath;
   p.armR=.45+.012*g.breath;p.armL=.5+.2*g.inspect-.03*up+.6*raise+.015*g.breath;p.reach=-.55+.25*raise;p.spread=.02;
   p.strum=solo?.pick??0;p.fretting=solo?.fret??0;
   p.scanX=g.eyeX;p.scanY=g.eyeY;p.open*=.86;
  }
  if(action==='read-paper'){
   // Turned a little toward screen-left like watering, the open paper held at
   // chest height below the chin, and the eyes reading it line by line.
   const scan=readingScan(t),k=this.reducedMotion?.4:1;
   p.paper=1;p.yaw=-.2;p.headYaw=-.05;p.pitch=.012;p.head=.1-.035*scan.nod*k;p.rise=wave*.005;
   // Hands spread to grip the side edges, clear of the masthead. Between
   // pages they gather in, then snap outward so the sheet pulls taut.
   const pull=Math.max(0,scan.snap)*k,gather=Math.max(0,-scan.snap)*k;
   p.armL=.6+.1*pull-.05*gather;p.armR=-p.armL;p.reach=-.4-.05*scan.snap*k;p.spread=.02;
   p.scanX=scan.x*k;p.scanY=scan.y;p.snap=scan.snap*k;p.open*=.9;
  }
  if(action==='quota-board'){
   const motion=quotaBoardMotion(t),k=this.reducedMotion?.4:1;p.board=motion.arm;p.armL=2.25*motion.arm;p.armR=-p.armL;p.reach=.04*motion.arm;
   // Knee dip before the lift, chin up toward the board, and a light sway
   // that the head and body follow while the board rolls in her hands.
   p.rise=-.028*motion.dip*k;p.open=1;p.head=-.012*motion.arm-.03*motion.lookUp;
   p.headRoll=-.018*motion.sway*k;p.lean=.010*motion.sway*k;p.footL=-.035*motion.dip*k;p.footR=.035*motion.dip*k;
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
   // Chest hold, knee dip, a jump with both poppers fired near the top, a
   // soft landing and a little sway dance (shared/celebrate-motion.ts).
   const m=celebrateMotion(t,this.reducedMotion);
   p.popper=m.visible;p.popL=m.kickL;p.popR=m.kickR;p.happy=m.happy;
   p.armL=m.armL;p.armR=m.armR;p.reach=m.reach;p.jump=m.jump;p.rise=m.rise;p.pitch=m.pitch;
   p.head=m.head;p.lean=m.lean;p.yaw=m.yaw;p.headRoll=m.headRoll;p.swish=m.swish;
   p.spread=m.spread;p.footL=m.footL;p.footR=m.footR;p.liftFoot=m.liftFoot;
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
  hair.rotation.z+=p.power*(Math.sin(t*TAU/1.7)*.023+Math.sin(t*TAU/2.6)*.008)+p.swish;
  // The scalp stays attached; only the lower hair carries a small damped lag.
  if(this.hairMaterial)this.hairMaterial.uniforms.hairBend.value=this.hairSway.angle*p.drag*(this.reducedMotion?.35:1);
  this.control('CTRL_Arm.L').rotation.set(p.reach,0,p.armL);this.control('CTRL_Arm.R').rotation.set(p.reach,0,p.armR);
  // Move each complete sleeve/hand group together behind the hair. All local
  // hand transforms, joint connections, rigid geometry and scales stay intact.
  for(const [side,sign] of [['L',1],['R',-1]] as const){const arm=this.control('CTRL_Arm.'+side);arm.position.y+=1.67*p.board;arm.position.x+=sign*.72*p.board;arm.position.z-=.08*p.board;}
  for(const [s,sign,a] of [['R',-1,p.footR],['L',1,p.footL]] as const){const foot=this.control('CTRL_Foot.'+s);foot.position.x+=sign*p.spread;foot.position.y-=p.rise*(1-p.drag);foot.rotation.set(p.drag*(-.18+p.kick*(s==='R'?.7:.52)),0,a);if(s==='R')foot.position.y+=p.liftFoot;}
  for(let i=0;i<2;i++){
   const joint=this.control('CTRL_Eye.'+(i?'L':'R'));joint.position.x+=gx*.105+p.scanX*.3;joint.position.y-=gy*.065+p.scanY*.28;
   joint.rotation.y=gx*.035;this.drawEye(i,p,eyeTime);
  }
  const root=this.control('CTRL_Root');
  const suspendedAngle=this.suspension.angle*p.drag;
  root.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),suspendedAngle));
  root.position.add(this.suspensionPivot).sub(this.suspensionPivot.clone().applyQuaternion(root.quaternion));
  // A celebration jump lifts the whole figure, feet included.
  root.position.y+=p.jump;
  this.model!.updateMatrixWorld(true);
  this.watering.visible=p.water>.005;this.watering.scale.setScalar(1);
  // Held level-ish, then tipped until the spout points ~20° below horizontal.
  this.can.rotation.set(0,p.yaw,-.45+.33*p.flow+Math.sin(t*2)*.02);
  const palmL=this.control('CTRL_Hand.L').getWorldPosition(this.canPalmL),palmR=this.control('CTRL_Hand.R').getWorldPosition(this.canPalmR);
  this.can.position.copy(palmL.add(palmR).multiplyScalar(.5));this.can.position.y-=.14;this.can.position.z=Math.max(1.02,this.can.position.z+.025);
  this.can.updateMatrixWorld(true);
  this.watering.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshBasicMaterial,flow=m.userData.flowOpacity;m.transparent=true;m.opacity=(flow===undefined?1:flow*p.flow)*p.water;}});
  // The vines nod a little where the water lands.
  for(let i=0;i<this.cucumberPlants.length;i++){const plant=this.cucumberPlants[i];plant.rotation.z=plant.userData.baseRoll+Math.sin(t*3.1+i*1.7)*.035*p.flow;}
  if(p.water>.005&&p.flow>.001)this.updateWaterSpray(t);
  this.claudeProps.update(p,this.control('CTRL_Hand.L').getWorldPosition(this.canPalmL),this.control('CTRL_Hand.R').getWorldPosition(this.canPalmR),t);
  // The sheet waits until a fading watering can has left the hands.
  if(p.paper>.005)this.newspaper.update(p.paper*(1-smooth(p.water/.15)),this.control('CTRL_Hand.L').localToWorld(this.gripL.copy(this.mittenCenter.L)),this.control('CTRL_Hand.R').localToWorld(this.gripR.copy(this.mittenCenter.R)),p.yaw,p.snap,this.gripL.distanceTo(this.gripR)/this.readingSpan,t);
  else this.newspaper.group.visible=false;
  if(p.guitar>.005)this.guitar.update(p.guitar*(1-smooth(p.water/.15)),this.control('CTRL_Hand.R').localToWorld(this.gripR.copy(this.mittenCenter.R)),this.control('CTRL_Hand.L').localToWorld(this.gripL.copy(this.mittenCenter.L)));
  else this.guitar.group.visible=false;
  // Picking and fretting fingers move after the guitar is placed.
  if(p.strum||p.fretting){this.control('CTRL_Hand.R').rotation.z-=.55*p.strum;this.control('CTRL_Hand.L').rotation.z+=.18*p.fretting;}
  this.flowers.visible=p.happy>.005&&p.popper<.005&&p.clap<.005;for(let i=0;i<5;i++){const f=this.flowers.children[i],a=t*1.1+i*TAU/5;f.position.set(Math.cos(a)*1.65,2.6+Math.sin(a)*.7,.6+Math.sin(a)*.3);f.rotation.z=t*1.8+i;f.scale.setScalar(p.happy*1.24);}
  this.aura.visible=p.power>.005;for(let i=0;i<7;i++){const a=i*TAU/7;const f=this.aura.children[i] as T.Mesh;f.position.set(Math.cos(a)*1.65,.06,Math.sin(a)*1.1);f.rotation.y=0;f.scale.set(1.5,1.7+Math.sin(t*5+i)*.25+Math.abs(Math.cos(a))*.6,1);(f.material as T.MeshBasicMaterial).opacity=p.power*(.18+.04*Math.sin(t*4+i));}
  const frame=Math.floor(t*30)%36;this.auraTexture?.offset.set((frame%6)/6,(5-Math.floor(frame/6))/6);
  this.applyFeedback(p,t);
  const boardMotion=quotaBoardMotion(t);
  const boardOpacity=this.action==='quota-board'?boardMotion.opacity:this.boardReleasing?this.boardRelease.opacity*Math.min(1-smooth(t/QUOTA_BOARD_FADE_SECONDS),smooth((p.board-.42)/.38)):0;
  this.quotaBoard.visible=boardOpacity>.002;
  if(this.quotaBoard.visible){
   // An interrupted board still leaves with the hands that hold it.
   this.quotaBoard.position.set(0,this.action==='quota-board'?boardMotion.height:Math.min(this.boardRelease.height,quotaBoardGripHeight(p.board)),-.90);
   this.quotaBoard.rotation.set(this.action==='quota-board'?boardMotion.tilt:this.boardRelease.tilt+.12*smooth(t/QUOTA_BOARD_BLEND_SECONDS),0,this.action==='quota-board'?boardMotion.roll*(this.reducedMotion?.4:1):this.boardRelease.roll);
   (this.quotaBoardMesh!.material as T.MeshBasicMaterial).opacity=boardOpacity;
   if(quotaLabel(this.quota,this.locale)!==this.quotaLabel)this.paintQuotaBoard();
  }
  this.scene.updateMatrixWorld(true);
 }
 private applyFeedback(p:Pose,t:number){
  const opacity=(object:T.Object3D,amount:number)=>{object.visible=amount>.005;object.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.opacity=amount;});};
  for(let i=0;i<this.poppers.length;i++){
   const prop=this.poppers[i];prop.position.copy(this.control('CTRL_Hand.'+(i?'R':'L')).getWorldPosition(new T.Vector3()));
   // Recoil tips the barrel outward and down a little as it fires.
   const kick=i?p.popR:p.popL;prop.position.z=Math.max(1.15,prop.position.z+.07);prop.position.y-=.03*kick;
   prop.rotation.set(0,0,(i?.40:-.40)+(i?.16:-.16)*kick);opacity(prop,p.popper);prop.updateMatrixWorld(true);
  }
  for(let i=0;i<this.sweat.length;i++){
   const drop=this.sweat[i],u=clamp((t-.26-i*.10)/1.12,0,1);
   drop.position.set(i?-.91:.91,3.03-u*.27,1.6);drop.rotation.z=i?-.12:.12;
   drop.scale.setScalar(.65+.35*smooth(u/.2));opacity(drop,p.touch*smooth(u/.13)*(1-smooth((u-.72)/.28)));
  }
  for(let i=0;i<this.paper.length;i++){
   const mesh=this.paper[i],piece=this.confetti[i],shot=this.popperMouths[piece.side];
   if(!shot||p.popper<.005){opacity(mesh,0);continue;}
   const f=confettiFlight(piece,t,shot.barrel.x,shot.barrel.y);
   mesh.position.copy(shot.mouth);mesh.position.x+=f.x;mesh.position.y+=f.y;mesh.position.z+=.3+f.z;
   mesh.rotation.set(f.rx,f.ry,f.rz);
   opacity(mesh,f.opacity*Math.min(1,p.popper*3));
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
  if(this.codeFlowStyle==='soft'){this.drawSoftFlow(c,t);return;}
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
 /**
  * Working eyes: rounded light streaks with comet tails fall in two
  * columns, a slanted gleam sweeps through, and a warm glow breathes. No thin
  * glyphs, so nothing turns into scratches at the ~8 px desktop eye size.
  */
 private drawSoftFlow(c:CanvasRenderingContext2D,t:number){
  t*=1.5;
  const hash=(n:number)=>{const x=Math.sin(n*127.1)*43758.5453;return x-Math.floor(x);};
  const pulse=.5+.5*Math.sin(t*2.1);
  const glow=c.createRadialGradient(0,12,4,0,12,84);
  glow.addColorStop(0,`rgba(255,238,178,${.20+.12*pulse})`);glow.addColorStop(1,'rgba(255,238,178,0)');
  c.fillStyle=glow;c.fillRect(-70,-120,140,240);
  for(let col=0;col<2;col++){
   const x=col?11:-11,speed=64+col*15;
   for(let k=0;k<4;k++){
    const travel=t*speed+k*58+col*29,pass=Math.floor(travel/236),y=-118+travel%236;
    const length=18+hash(pass*13+k*7+col*31)*20,w=10;
    const tail=c.createLinearGradient(0,y-length,0,y);
    tail.addColorStop(0,'rgba(255,250,224,0)');tail.addColorStop(.65,'rgba(255,250,224,.5)');tail.addColorStop(1,'rgba(255,253,236,1)');
    c.fillStyle=tail;c.beginPath();c.roundRect(x-w/2,y-length,w,length,w/2);c.fill();
   }
  }
  const sweep=(t*1.05)%2.2,band=-150+sweep*150;
  if(sweep<1.9){
   c.save();c.rotate(-.42);
   const gleam=c.createLinearGradient(0,band-16,0,band+16);
   gleam.addColorStop(0,'rgba(255,251,230,0)');gleam.addColorStop(.5,'rgba(255,251,230,.5)');gleam.addColorStop(1,'rgba(255,251,230,0)');
   c.fillStyle=gleam;c.fillRect(-90,band-16,180,32);c.restore();
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
   this.pose=age<route?blend(this.from,neutral(),smooth(age/route)):blend(this.routed?neutral():this.from,this.target(this.action,t),smooth((age-route)/(this.releasing?.65:this.action==='water'?1.4:this.action==='drag'?.23:this.action==='touch'?.025:feedback?.18:this.action==='quota-board'?QUOTA_BOARD_BLEND_SECONDS:this.action.startsWith('celebrate-')?.22:this.action.startsWith('guitar')?.9:.55)));
   if(this.boardReleasing){const target=this.target(this.action,t),weight=smooth(age/QUOTA_BOARD_BLEND_SECONDS);for(const key of ['board','armL','armR','reach'] as const)this.pose[key]=mix(this.from[key],target[key],weight);}
   if(this.releasing&&age<.65)this.pose.rise-=Math.sin(age/.65*Math.PI)*.03;this.draw(this.pose,t,age);
  }
  this.velocity*=Math.exp(-Math.min(dt,100)*.007);
  const feedbackDuration=this.action.startsWith('feedback-')?FEEDBACK_SECONDS[this.action.slice(9) as keyof typeof FEEDBACK_SECONDS]:this.action==='dizzy'?DIZZY_SECONDS:this.action==='tearful'?TEARFUL_SECONDS:Infinity;
  if(!this.finished&&(age>=feedbackDuration||(this.action==='quota-board'&&age>=QUOTA_BOARD_SECONDS)||(this.action==='transform'&&age>=TURN_SECONDS)||(this.action==='touch'&&age>=TOUCH_SECONDS)||(this.action==='celebrate-poppers'&&age>=CELEBRATION_SECONDS.A)||(this.action==='celebrate-clap'&&age>=CELEBRATION_SECONDS.D))){this.finished=true;this.onTransientEnd?.();}
 };
 setAction(action:RigAction,restart=false){if(action==='transform'&&!presentationPolicy.transformation)return;if(action===this.action&&!restart)return;if(action==='touch')this.touchInitialPressure=this.action==='touch'?-this.pose.headOffsetY/(TOUCH_HEAD_DROP*(this.reducedMotion?.55:1)):0;
  this.boardReleasing=action!=='quota-board'&&(this.action==='quota-board'||this.boardReleasing)&&this.pose.board>.005;
  if(this.boardReleasing)this.boardRelease={height:this.quotaBoard.position.y,tilt:this.quotaBoard.rotation.x,roll:this.quotaBoard.rotation.z,opacity:(this.quotaBoardMesh!.material as T.MeshBasicMaterial).opacity};
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
