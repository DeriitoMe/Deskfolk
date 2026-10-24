// Live check of the Skills Morning Brief link in an isolated profile.
// The real main process runs with a temporary userData folder and an empty
// Codex home. The brief install is found the normal way (its daily task) and
// only read. Opening the browser and starting the brief's launcher are
// intercepted, so nothing outside the profile is changed.
//
// Run after a build: npx electron scripts/qa-morning-brief.cjs  (QA_APP_MAIN=<out>/main/index.js)
const electron=require('electron'),{app,BrowserWindow,Tray,screen,shell}=electron;
const childProcess=require('node:child_process'),http=require('node:http');
const assert=require('node:assert/strict');const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const root=resolve(__dirname,'..'),output=process.env.QA_OUTPUT||join(root,'.cache/morning-brief-live-'+Date.now());
const profile=join(output,'profile'),codex=join(output,'codex'),shelf=join(output,'shelf');
for(const d of [profile,join(codex,'sessions'),shelf])mkdirSync(d,{recursive:true});
writeFileSync(join(profile,'preferences.json'),JSON.stringify({model:'flat-chibi',scale:1,startWithCodex:false,startWithClaudeCode:false}));
process.env.PET_USER_DATA=profile;process.env.CODEX_HOME=codex;process.env.PET_QUOTA_LOG_ONLY='1';delete process.env.PET_TEST_MODE;
// The brief's own data folder is replaced by an empty one: no service record yet.
process.env.MORNINGPAPER_DATA_DIR=shelf;
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const originalShow=BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.showInactive=function(){this.setOpacity(0);return originalShow.call(this);};
let tray,menu;const trayOn=Tray.prototype.on;
Tray.prototype.on=function(name,callback){if(name==='right-click')tray=this;return trayOn.call(this,name,callback);};
Tray.prototype.popUpContextMenu=function(m){menu=m;};
const opened=[],launched=[];
shell.openExternal=async url=>{opened.push(url);};
const realSpawn=childProcess.spawn;
childProcess.spawn=function(file,args,options){
  if(Array.isArray(args)&&args.join(' ')==='-m morningpaper open'){launched.push({file,args,cwd:options?.cwd});return realSpawn(process.execPath,['-e','0'],{stdio:'ignore',env:{ELECTRON_RUN_AS_NODE:'1'}});}
  return realSpawn.apply(this,arguments);
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let pet;const checks=[];
const snap=()=>pet.webContents.executeJavaScript(`(()=>{const b=document.querySelector('#speech-bubble');return {ready:document.querySelector('canvas')?.dataset.ready==='true',
  action:document.querySelector('.figure')?.dataset.action,bubble:!b.hidden&&!b.classList.contains('bubble-out'),kind:b.dataset.kind,
  message:document.querySelector('#bubble-message').textContent,meta:document.querySelector('#bubble-meta').textContent,
  button:!document.querySelector('#brief-button').hidden,actions:window.qaActions||[]};})()`);
async function wait(label,predicate,limit=15000){const until=Date.now()+limit;let s;do{s=await snap();if(s.ready&&predicate(s)){checks.push({label,at:Date.now()-started,action:s.action,message:s.message,meta:s.meta});return s;}await sleep(50);}while(Date.now()<until);throw Error(label+': '+JSON.stringify(s));}
async function capture(name){writeFileSync(join(output,name+'.png'),(await pet.webContents.capturePage()).toPNG());}
let started=0;
(async()=>{
 await app.whenReady();screen.getCursorScreenPoint=()=>({x:0,y:0});
 started=Date.now();
 await import(pathToFileURL(process.env.QA_APP_MAIN||join(root,'out/main/index.js')).href);
 for(let i=0;i<300;i++){pet=BrowserWindow.getAllWindows()[0];if(pet&&await snap().then(s=>s.ready).catch(()=>false))break;await sleep(50);}
 assert(pet);pet.webContents.setBackgroundThrottling(false);
 await pet.webContents.executeJavaScript(`window.qaActions=[];new MutationObserver(()=>{const a=document.querySelector('.figure')?.dataset.action;if(a&&a!==window.qaActions.at(-1)?.action)window.qaActions.push({action:a,at:performance.now()});}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-action']});true`);
 // 1. About fifteen seconds after start-up she reads once by herself.
 const auto=await wait('reads the brief by herself after start-up',s=>s.action==='read-paper',30000);
 assert(auto.ready&&checks.at(-1).at>=14000,'not before about fifteen seconds');
 const first=await wait('a brief note with the way into the brief',s=>s.bubble&&s.kind==='brief'&&s.button,6000);
 await sleep(1300);await capture('auto-reading-note');
 await wait('back to idle after one page',s=>s.action==='idle',12000);
 // 2. The tray item reads again; the note moves down the priority list.
 tray.emit('right-click');assert(menu,'tray menu built');
 const item=menu.items.find(i=>i.label==='看晨报');assert(item,'tray has 看晨报');item.click();
 await wait('tray request starts reading',s=>s.action==='read-paper',3000);
 const second=await wait('a different note on the second reading',s=>s.bubble&&s.kind==='brief'&&s.message!==first.message||s.bubble&&s.kind==='brief'&&s.meta!==first.meta,6000);
 await sleep(1300);await capture('tray-reading-note');
 // 3. No service yet: the button starts the brief's own launcher in its folder.
 await pet.webContents.executeJavaScript(`document.querySelector('#brief-button').click();true`);
 await wait('the bubble closes after opening the brief',s=>!s.bubble,3000);
 assert.equal(launched.length,1);assert.deepEqual(launched[0].args,['-m','morningpaper','open']);
 assert.equal(opened.length,0,'nothing opened directly without a verified service');
 // 4. With a verified running service the browser opens its home page directly.
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/instance'?{instance_id:'qa-instance'}:{}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 writeFileSync(join(shelf,'reader-session.json'),JSON.stringify({instance_id:'qa-instance',port,pid:1,launch_token:'qa-private-token'}));
 item.click();await wait('third reading',s=>s.bubble&&s.kind==='brief'&&s.button,9000);
 await pet.webContents.executeJavaScript(`document.querySelector('#brief-button').click();true`);
 await wait('closes again',s=>!s.bubble,3000);
 assert.deepEqual(opened,[`http://127.0.0.1:${port}/`]);assert(!opened.join().includes('qa-private-token'));
 assert.equal(launched.length,1,'no second launcher when the service is running');
 server.close();
 const state=JSON.parse(readFileSync(join(profile,'morning-brief.json'),'utf8'));
 assert(state.seen.length>=2,'mentioned notes are remembered in the isolated profile');
 const report={brief:checks,launched:launched.map(l=>({args:l.args,cwdIsBrief:!!l.cwd})),opened:opened.map(u=>u.replace(/\d+\/$/,'<port>/')),seen:state.seen.length};
 writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,1));
 app.exit(0);
})().catch(e=>{console.error(e);app.exit(1);});
