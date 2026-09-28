// Production-renderer eye pixels, with OS/application reduce-motion fixtures.
// All profiles are isolated. The operating-system cursor is never moved.
// Run with Electron; QA_APP_MAIN can select an archived app.asar/out/main/index.js.
// Set QA_EXPECT_WORK_FLOW=1 to require animated, visible eyes in both reduce modes.
// The 23x26 eye measurement is a desktop-scale downsampling proxy, not a capture
// of the composited desktop framebuffer. Full production-renderer PNGs are saved.
const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict');const {join}=require('node:path');
const {pathToFileURL}=require('node:url');const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const root=join(__dirname,'..'),output=join(root,'.cache','working-eyes-'+Date.now()),profile=join(output,'user-data');
mkdirSync(profile,{recursive:true});writeFileSync(join(profile,'preferences.json'),JSON.stringify({model:'flat-chibi',scale:1,reducedMotion:false}));
process.env.PET_USER_DATA=profile;process.env.PET_TEST_MODE='1';app.setPath('userData',profile);
app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let cursor={x:0,y:0};
const expectFlowInReduced=process.env.QA_EXPECT_WORK_FLOW==='1';
const sourceMain=process.env.QA_APP_MAIN||join(root,'out/main/index.js');
const report={passed:false,build:sourceMain.includes('app.asar')?'asar':'production-out',expectFlowInReduced,cases:[],method:'actual production eye canvases captured through a transparent fillText observation hook; OS preference emulated with CDP only in this QA renderer; distinct pixel hashes measured over time; physical eye counts are a high-quality desktop-scale downsampling proxy; non-eye hashes exclude the face eye region'};
const measure=`(()=>{
 const q=window.workingEyesQa,c=document.querySelector('canvas.pet-art'),rect=c.getBoundingClientRect();
 const hash=a=>{let h=2166136261;for(let i=0;i<a.length;i++)h=Math.imul(h^a[i],16777619);return (h>>>0).toString(16)};
 const data=c.getContext('2d').getImageData(0,0,512,512).data;
 let bodyHash=2166136261;for(let y=0;y<512;y++)for(let x=0;x<512;x++){
  if(x>=130&&x<385&&y>=200&&y<322)continue;
  const k=(y*512+x)*4;for(let z=0;z<4;z++)bodyHash=Math.imul(bodyHash^data[k+z],16777619);
 }
 const eyeWidth=Math.round(.53*100*rect.width/512*devicePixelRatio),eyeHeight=Math.round(.61*100*rect.width/512*devicePixelRatio);
 const eyes=q.canvases.map(eye=>{
  const pixels=eye.getContext('2d').getImageData(0,0,192,256).data;
  const small=document.createElement('canvas');small.width=eyeWidth;small.height=eyeHeight;
  const ctx=small.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(eye,0,0,eyeWidth,eyeHeight);
  const physical=ctx.getImageData(0,0,eyeWidth,eyeHeight).data;
  const bright=a=>{let n=0;for(let k=0;k<a.length;k+=4)if(a[k+3]>160&&a[k]>210&&a[k+1]>160&&a[k+2]<200)n++;return n};
  return {textureHash:hash(pixels),physicalHash:hash(physical),brightTexturePixels:bright(pixels),brightPhysicalPixels:bright(physical)};
 });
 return {action:document.querySelector('.figure').dataset.action,canvasAction:c.dataset.action,osReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,bodyHash:(bodyHash>>>0).toString(16),eyes,physicalEyePlane:[eyeWidth,eyeHeight],physicalCharacterHeight:195,fillCalls:q.fillCalls};
})()`;
(async()=>{
 await app.whenReady();screen.getCursorScreenPoint=()=>cursor;
 await import(pathToFileURL(sourceMain).href);
 let pet;for(let i=0;i<150;i++){pet=BrowserWindow.getAllWindows()[0];if(pet&&await pet.webContents.executeJavaScript('!!document.querySelector("canvas.pet-art[data-ready=true]")').catch(()=>false))break;await sleep(100);}
 assert(pet);pet.webContents.setBackgroundThrottling(false);pet.setOpacity(0);pet.showInactive();
 const js=s=>pet.webContents.executeJavaScript(s);assert(await js('!!document.querySelector("canvas.pet-art[data-ready=true]")'));
 pet.webContents.debugger.attach('1.3');
 const emulate=async value=>{await pet.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value}]});};
 const center=async()=>{const rect=await js('document.querySelector("canvas.pet-art").getBoundingClientRect().toJSON()'),b=pet.getBounds();cursor={x:Math.round(b.x+rect.left+rect.width/2),y:Math.round(b.y+rect.top+261*rect.width/512)};};
 await js(`(()=>{window.workingEyesQa={canvases:[],fillCalls:0};const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(...args){const q=window.workingEyesQa;if(this.canvas.width===192&&this.canvas.height===256&&this.font.includes('monospace')){if(!q.canvases.includes(this.canvas))q.canvases.push(this.canvas);q.fillCalls++;}return Reflect.apply(fill,this,args)};return true})()`);
 const bridge=JSON.parse(readFileSync(join(profile,'bridge.json'),'utf8'));
 const notify=async type=>{const response=await fetch(`http://127.0.0.1:${bridge.port}/notify`,{method:'POST',headers:{authorization:'Bearer '+bridge.token,'content-type':'application/json'},body:JSON.stringify({id:randomUUID(),source:'hook',type,sessionId:'working-eyes-fixture',turnId:'working-eyes-fixture-turn',projectPath:'D:/Fixture/WorkingEyes'})});assert(response.ok);};
 await emulate('no-preference');await center();await notify('work_started');await sleep(1200);
 assert.equal(await js('window.workingEyesQa.canvases.length'),2,'both actual eye canvases observed');
 for(const [name,osPreference,applicationReduced] of [['default','no-preference',false],['os-reduced','reduce',false],['application-reduced','no-preference',true],['recovered-default','no-preference',false]]){
  await emulate(osPreference);await js(`window.petBridge.savePreferences({reducedMotion:${applicationReduced}})`);await center();await sleep(1000);
  const samples=[];for(let i=0;i<9;i++){samples.push(await js(measure));await sleep(110);}
  const pixels=await js(`(()=>{const q=window.workingEyesQa,c=document.querySelector('canvas.pet-art');return {full:c.toDataURL(),eyes:q.canvases.map(e=>e.toDataURL())}})()`);
  writeFileSync(join(output,name+'.png'),Buffer.from(pixels.full.split(',')[1],'base64'));
  pixels.eyes.forEach((url,i)=>writeFileSync(join(output,name+'-eye-'+i+'.png'),Buffer.from(url.split(',')[1],'base64')));
  const entry={name,applicationReduced,osPreference,bodyUniqueHashes:new Set(samples.map(s=>s.bodyHash)).size,eyes:[0,1].map(i=>({uniqueTextureHashes:new Set(samples.map(s=>s.eyes[i].textureHash)).size,uniquePhysicalHashes:new Set(samples.map(s=>s.eyes[i].physicalHash)).size,brightTexturePixels:samples.map(s=>s.eyes[i].brightTexturePixels),brightPhysicalPixels:samples.map(s=>s.eyes[i].brightPhysicalPixels)})),samples};
  assert(samples.every(s=>s.action==='work'&&s.canvasAction==='work'),'actual working action '+name);
  assert(samples.every(s=>s.osReduced===(osPreference==='reduce')),'emulated OS preference '+name);
  assert(entry.eyes.every(eye=>eye.brightTexturePixels.some(n=>n>0)),'work glyph pixels exist '+name);
  const reduced=applicationReduced||osPreference==='reduce';
  if(!reduced||expectFlowInReduced)assert(entry.eyes.every(eye=>eye.uniqueTextureHashes>=3),'animated eye texture '+name);
  if(expectFlowInReduced)assert(entry.eyes.every(eye=>eye.uniquePhysicalHashes>=3&&eye.brightPhysicalPixels.some(n=>n>0)),'moving visible highlight at desktop-scale proxy '+name);
  if(reduced)assert.equal(entry.bodyUniqueHashes,1,'reduced motion keeps other pose pixels still '+name);
  report.cases.push(entry);console.log(JSON.stringify({name,bodyUniqueHashes:entry.bodyUniqueHashes,eyes:entry.eyes,physicalEyePlane:samples[0].physicalEyePlane}));
 }
 await notify('turn_ended');await js('window.petBridge.savePreferences({reducedMotion:false})');await emulate('no-preference');await center();await sleep(1100);
 report.idle=await js(measure);assert.equal(report.idle.action,'idle');assert(report.idle.eyes.every(eye=>eye.brightTexturePixels===0),'idle has no code glyph pixels');
 report.passed=true;writeFileSync(join(output,'verification.json'),JSON.stringify(report,null,2));
 writeFileSync(join(root,'.cache','working-eyes-report-path.txt'),join(output,'verification.json'));console.log('PASS '+JSON.stringify({output,expectFlowInReduced}));
 pet.webContents.debugger.detach();app.quit();
})().catch(error=>{report.error=String(error.stack||error);writeFileSync(join(output,'verification.json'),JSON.stringify(report,null,2));console.error(error);app.exit(1)});
