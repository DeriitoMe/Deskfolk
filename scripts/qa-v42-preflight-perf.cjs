// Isolated production-state memory/FPS benchmark, then fixed-time rig inventory.
const {app,BrowserWindow,screen}=require('electron');
const {join,dirname}=require('node:path');const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');const assert=require('node:assert/strict');
const root=join(__dirname,'..'),label=process.env.QA_PERF_LABEL||'before';
const cache=join(root,'.cache');
const sourceMain=process.env.QA_APP_MAIN||join(root,'out/main/index.js');
const reviewHtml=process.env.QA_REVIEW_HTML||join(dirname(sourceMain),'../renderer/index.html');
const output=join(cache,'preflight-perf-'+label+'-'+Date.now()),data=join(output,'user-data');
const reportPath=join(cache,'preflight-memory-'+label+'.json');
mkdirSync(data,{recursive:true});writeFileSync(join(data,'preferences.json'),JSON.stringify({model:'flat-chibi',scale:1}));
process.env.PET_USER_DATA=data;process.env.PET_TEST_MODE='1';app.setPath('userData',data);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('enable-precise-memory-info');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));const started=Date.now();
let cursor={x:0,y:0};
const report={label,output,platform:process.platform,architecture:process.arch,electronVersion:process.versions.electron,chromeVersion:process.versions.chrome,sourceMain,at:new Date().toISOString(),
 methodology:{profile:'separate PET_USER_DATA; PET_TEST_MODE=1; opacity-zero shown native window',memoryUnit:'KiB from Electron app/process metrics; JS heap bytes',sampling:'native actual output-canvas draw timestamps; state settles 1500ms, then 6 memory samples at 500ms intervals',review:'same window navigated to review only after all production-state memory samples; fixed-time captures and renderer.info are separate from native totals',cursor:'screen.getCursorScreenPoint mocked only inside this QA process'},launch:[],states:[],review:{}};
function metrics(tag){
 const processes=app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,name:p.name||'',memory:{...p.memory},cpuPercent:p.cpu.percentCPUUsage}));
 const totals=processes.reduce((s,p)=>{for(const k of ['workingSetSize','privateBytes','peakWorkingSetSize'])s[k]+=p.memory[k]||0;return s;},{workingSetSize:0,privateBytes:0,peakWorkingSetSize:0});
 return {tag,elapsedMs:Date.now()-started,processes,totals,mainNodeMemoryBytes:process.memoryUsage()};
}
const stats=values=>{const a=values.slice().sort((x,y)=>x-y),mean=a.reduce((x,y)=>x+y,0)/a.length;return {samples:a.length,meanMs:mean,fps:1000/mean,p95Ms:a[Math.floor((a.length-1)*.95)],maxMs:a.at(-1),over25ms:a.filter(x=>x>25).length,over50ms:a.filter(x=>x>50).length};};
(async()=>{
 await app.whenReady();screen.getCursorScreenPoint=()=>cursor;
 report.launch.push(metrics('before-main-import'));
 await import(pathToFileURL(report.sourceMain).href);
 let pet,ready=false;
 for(let i=0;i<150;i++){
  pet=BrowserWindow.getAllWindows()[0];
  if(pet){pet.webContents.setBackgroundThrottling(false);pet.setOpacity(0);pet.showInactive();ready=await pet.webContents.executeJavaScript('!!document.querySelector("canvas.pet-art[data-ready=true]")').catch(()=>false);}
  if(i===0||i===3||i===10||i===20)report.launch.push(metrics('loading-'+i));
  if(ready)break;await sleep(100);
 }
 assert(ready,'production canvas/model ready');report.readyMs=Date.now()-started;report.launch.push(metrics('model-ready'));
 const js=code=>pet.webContents.executeJavaScript(code);
 const rectangle=await js('document.querySelector("canvas.pet-art").getBoundingClientRect().toJSON()'),bounds=pet.getBounds();
 cursor={x:Math.round(bounds.x+rectangle.left+rectangle.width/2),y:Math.round(bounds.y+rectangle.top+261*rectangle.width/512)};
 await js(`(()=>{const c=document.querySelector('canvas.pet-art'),ctx=c.getContext('2d'),draw=ctx.drawImage;window.perfQa={intervals:[],last:0,frames:0};ctx.drawImage=function(...args){const now=performance.now(),q=window.perfQa;if(q.last)q.intervals.push(now-q.last);if(q.intervals.length>600)q.intervals.shift();q.last=now;q.frames++;return Reflect.apply(draw,this,args)};return true})()`);
 const bridge=JSON.parse(readFileSync(join(data,'bridge.json'),'utf8'));
 const notify=async(type,extra={})=>{const res=await fetch(`http://127.0.0.1:${bridge.port}/notify`,{method:'POST',headers:{authorization:'Bearer '+bridge.token,'content-type':'application/json'},body:JSON.stringify({id:randomUUID(),source:'hook',type,sessionId:'perf-project-a',turnId:'perf-turn-a',projectPath:'D:/PerfQA/One',...extra})});assert(res.ok);await sleep(150);};
 const stage=async(name,expected)=>{
  await sleep(1500);assert.equal(await js('document.querySelector(".figure").dataset.action'),expected,name+' renderer action');
  await js('window.perfQa.intervals=[];window.perfQa.last=0;window.perfQa.frames=0;true');
  const samples=[];for(let i=0;i<6;i++){await sleep(500);samples.push(metrics(name+'-'+i));}
  const view=await js(`({action:document.querySelector('.figure').dataset.action,canvasAction:document.querySelector('canvas.pet-art').dataset.action,dpr:devicePixelRatio,drawIntervals:window.perfQa.intervals,drawFrames:window.perfQa.frames,jsHeapBytes:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null})`);
  const activity=await js('window.petBridge.getBootstrap().then(s=>({phase:s.activity.phase,workingProjectCount:s.activity.workingProjectCount,fullPower:s.activity.fullPower}))');
  const entry={name,activity,view:{...view,drawStats:stats(view.drawIntervals)},samples};delete entry.view.drawIntervals;
  report.states.push(entry);writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(name,JSON.stringify({action:view.action,fps:entry.view.drawStats.fps,p95:entry.view.drawStats.p95Ms,totals:samples.at(-1).totals,jsHeap:view.jsHeapBytes}));
 };
 await sleep(1000);await stage('idle','idle');
 await notify('work_started');await stage('work','work');
 await notify('work_started',{sessionId:'perf-project-b',turnId:'perf-turn-b',projectPath:'D:/PerfQA/Two'});await stage('power-work','power-work');
 await notify('interrupted',{sessionId:'perf-project-b',turnId:'perf-turn-b'});await stage('recovered-work','work');
 await notify('turn_ended');await js('document.querySelector("#dismiss-bubble").click()');await stage('recovered-idle','idle');
 report.nativeCompleteMs=Date.now()-started;
 // Reuse the window; never allocate a second scene while sampling production RSS.
 await pet.loadURL(pathToFileURL(reviewHtml).href+'?review');
 for(let i=0;i<150 && !await js('!!window.v41Review?.ready');i++)await sleep(100);
 assert(await js('!!window.v41Review?.ready'));await sleep(1600);
 report.review.initial=await js(`(()=>{const r=window.v41Review.rig;r.setPaused(true);const textures=new Map(),geometries=new Set(),materials=new Set();let attributeBytes=0;const add=(tex,owner)=>{if(!tex?.isTexture)return;let item=textures.get(tex.uuid);if(!item){const im=tex.image;item={uuid:tex.uuid,name:tex.name||'',width:im?.width||0,height:im?.height||0,estimatedRgbaBytes:(im?.width||0)*(im?.height||0)*4,owners:[]};textures.set(tex.uuid,item);}item.owners.push(owner);};r.scene.traverse(o=>{if(!o.isMesh)return;if(!geometries.has(o.geometry)){geometries.add(o.geometry);for(const a of Object.values(o.geometry.attributes))attributeBytes+=a.array?.byteLength||0;attributeBytes+=o.geometry.index?.array?.byteLength||0;}for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const [name,v] of Object.entries(m))add(v,o.name+':'+name);for(const [name,u] of Object.entries(m.uniforms||{}))add(u.value,o.name+':uniform:'+name);}});return {rendererInfo:{memory:{...r.renderer.info.memory},render:{...r.renderer.info.render},programCount:r.renderer.info.programs.length},retained:{geometries:geometries.size,materials:materials.size,attributeBytes,textures:[...textures.values()],textureRgbaBytes:[...textures.values()].reduce((s,t)=>s+t.estimatedRgbaBytes,0)},frameLimit:r.frameLimit,rigFrameStats:r.frameIntervals,jsHeapBytes:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null};})()`);
 report.review.initial.rigFrameStats=stats(report.review.initial.rigFrameStats);
 report.review.captures=[];
 for(const [name,action,time] of [['idle','idle',2],['work','work',2],['power-work','power-work',2],['water','water',2],['nap','nap',2],['ask','ask',2],['touch','touch',.7],['drag-passive','drag',.8],['drag-kick','drag',1.65]]){
  const capture=await js(`(()=>{const r=window.v41Review.rig;r.look.snap(0,0);r.renderAt('${action}',${time});const pixels=r.canvas.getContext('2d').getImageData(0,0,r.canvas.width,r.canvas.height).data;let nontransparent=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>40)nontransparent++;return {png:r.canvas.toDataURL(),nontransparent,info:{memory:{...r.renderer.info.memory},render:{...r.renderer.info.render},programCount:r.renderer.info.programs.length},pose:r.exportPose()};})()`);
  const bytes=Buffer.from(capture.png.split(',')[1],'base64'),path=join(output,name+'.png');writeFileSync(path,bytes);delete capture.png;
  report.review.captures.push({name,action,time,path,pngSha256:createHash('sha256').update(bytes).digest('hex'),...capture});
 }
 await js('window.v41Review.rig.look.snap(0,0);window.v41Review.rig.setAction("work");window.v41Review.rig.setPaused(false);window.v41Review.rig.frameIntervals=[];true');
 await sleep(1800);await js('window.v41Review.rig.frameIntervals=[];true');await sleep(2500);
 report.review.workCadence=stats(await js('window.v41Review.rig.frameIntervals'));
 report.passed=true;writeFileSync(reportPath,JSON.stringify(report,null,2));
 console.log('PASS '+JSON.stringify({reportPath,output,readyMs:report.readyMs,reviewResources:report.review.initial.rendererInfo,textureRgbaMiB:report.review.initial.retained.textureRgbaBytes/1048576,reviewWorkFps:report.review.workCadence.fps}));app.quit();
})().catch(error=>{report.error=String(error.stack||error);writeFileSync(reportPath,JSON.stringify(report,null,2));console.error(error);app.exit(1)});
