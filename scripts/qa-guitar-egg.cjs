// Live check of the guitar easter egg in an isolated profile: the egg counter
// is preset to three plain guitar pastimes, so the next one must play the
// solo. Waits for the idle loop to reach the guitar (about 2.5 minutes),
// then checks the action, when the clip starts, its volume and the counter.
//
// Run after a build: npx electron scripts/qa-guitar-egg.cjs  (QA_APP_MAIN=<out>/main/index.js)
const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict');const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync}=require('node:fs');
const root=resolve(__dirname,'..'),output=process.env.QA_OUTPUT||join(root,'.cache/guitar-egg-live-'+Date.now());
const profile=join(output,'profile'),codex=join(output,'codex');
for(const d of [profile,join(codex,'sessions')])mkdirSync(d,{recursive:true});
writeFileSync(join(profile,'preferences.json'),JSON.stringify({model:'flat-chibi',scale:1,startWithCodex:false,startWithClaudeCode:false}));
process.env.PET_USER_DATA=profile;process.env.CODEX_HOME=codex;process.env.PET_QUOTA_LOG_ONLY='1';delete process.env.PET_TEST_MODE;
process.env.DESKFOLK_MORNING_BRIEF_DIR=join(output,'no-brief');
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const originalShow=BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.showInactive=function(){this.setOpacity(0);return originalShow.call(this);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let pet;
const state=()=>pet.webContents.executeJavaScript(`({action:document.querySelector('.figure')?.dataset.action,ready:document.querySelector('canvas')?.dataset.ready==='true',
  plays:window.qaPlays||[],count:localStorage.getItem('deskfolk.guitarEgg'),now:performance.now()})`);
(async()=>{
 await app.whenReady();screen.getCursorScreenPoint=()=>({x:0,y:0});
 await import(pathToFileURL(process.env.QA_APP_MAIN||join(root,'out/main/index.js')).href);
 for(let i=0;i<300;i++){pet=BrowserWindow.getAllWindows()[0];if(pet&&await state().then(s=>s.ready).catch(()=>false))break;await sleep(50);}
 assert(pet);pet.webContents.setBackgroundThrottling(false);
 // Preset the counter, then reload so the renderer reads it at start-up.
 await pet.webContents.executeJavaScript(`localStorage.setItem('deskfolk.guitarEgg','3');true`);
 pet.webContents.reload();
 for(let i=0;i<300;i++){if(await state().then(s=>s.ready).catch(()=>false))break;await sleep(50);}
 await pet.webContents.executeJavaScript(`window.qaPlays=[];window.qaActions=[];const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){window.qaPlays.push({src:this.src.split('/').pop(),volume:this.volume,at:performance.now(),action:document.querySelector('.figure')?.dataset.action});return play.call(this);};
  new MutationObserver(()=>{const a=document.querySelector('.figure')?.dataset.action;if(a&&a!==window.qaActions.at(-1)?.action)window.qaActions.push({action:a,at:performance.now()});}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-action']});true`);
 const until=Date.now()+260_000;let s;
 do{s=await state();if(s.action==='guitar-solo'||s.action==='guitar')break;await sleep(250);}while(Date.now()<until);
 assert.equal(s.action,'guitar-solo','the fourth guitar pastime plays the solo');
 const startedAt=s.now;
 await sleep(7000);
 s=await state();
 const play=s.plays.find(p=>/mutsumi-guitar-solo/.test(p.src));
 assert(play,'the clip started');assert.equal(play.action,'guitar-solo');
 const delay=(play.at-startedAt)/1000;
 assert(delay>5.4&&delay<6.3,`clip starts once the neck is up (${delay.toFixed(2)}s)`);
 assert.equal(play.volume,.75);
 assert.equal(s.count,'0','counter back to the start after the egg');
 await sleep(9500);
 s=await state();
 const actions=await pet.webContents.executeJavaScript('window.qaActions');
 const report={soloStartDelay:+delay.toFixed(2),volume:play.volume,counterAfter:s.count,afterSolo:s.action,actions:actions.map(a=>a.action)};
 writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 assert.notEqual(s.action,'guitar-solo','the solo ends with its slot');
 app.exit(0);
})().catch(e=>{console.error(e);app.exit(1);});
