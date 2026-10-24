// Real Electron/IPC smoke test in an isolated profile. Never touches live data.
// node node_modules/electron/cli.js scripts/qa-language.cjs [--restart|--system-en]
const {app,BrowserWindow,Tray,screen}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const output=process.env.QA_OUTPUT||path.join(root,'.cache/language-20261024/qa');
const restarting=process.argv.includes('--restart'),systemEn=process.argv.includes('--system-en');
const profile=path.join(output,systemEn?'system-en-profile':'profile');
fs.mkdirSync(profile,{recursive:true});
if(!restarting) {
  fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({model:'flat-chibi',scale:1.08,startWithCodex:false,startWithClaudeCode:false,followAgent:'codex'}));
  fs.writeFileSync(path.join(profile,'history.json'),JSON.stringify([{id:'external-copy',source:'mcp',type:'info',message:'通知原文 {project}',project:'中文项目',createdAt:new Date().toISOString(),read:true}]));
}
process.env.PET_USER_DATA=profile;process.env.PET_TEST_MODE='1';process.env.PET_QUOTA_LOG_ONLY='1';
process.env.CODEX_HOME=path.join(output,'codex');process.env.CLAUDE_CONFIG_DIR=path.join(output,'claude');
process.env.DESKFOLK_MORNING_BRIEF_DIR=path.join(output,'missing-brief');
app.getLocale=()=>systemEn?'en-US':'zh-CN';
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let tray,menu;
const originalOn=Tray.prototype.on;
Tray.prototype.on=function(event,fn){if(event==='right-click')tray=this;return originalOn.call(this,event,fn);};
Tray.prototype.popUpContextMenu=function(value){menu=value;};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checks=[],errors=[];
app.on('web-contents-created',(_,contents)=>{
  contents.on('console-message',(_event,level,message)=>{if(level>=3&&!message.includes('WebGL'))errors.push(message);});
  contents.on('render-process-gone',(_,details)=>errors.push('renderer gone: '+details.reason));
});
async function until(label,fn,timeout=18000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await fn().catch(()=>false)){checks.push(label);return;}await sleep(50);}throw Error('Timed out: '+label);}
const js=(window,source)=>window.webContents.executeJavaScript(source);
const lang=window=>js(window,'document.documentElement.lang');
const snapshot=window=>js(window,`({action:document.querySelector('.figure')?.dataset.action,visible:!document.querySelector('#speech-bubble').hidden,message:document.querySelector('#bubble-message').textContent,quota:document.querySelector('canvas')?.dataset.quotaLabel,plays:window.qaPlays?.length||0})`);
const openMenu=()=>{tray.emit('right-click');assert(menu);return menu.items.map(item=>item.label);};
const capture=async(window,name)=>{
  // Resized hidden Chromium views may defer painting indefinitely.
  window.setOpacity(0);window.showInactive();await sleep(250);
  const shot=await Promise.race([window.webContents.capturePage(),sleep(8000).then(()=>{throw Error('Capture timeout: '+name);})]);
  fs.writeFileSync(path.join(output,name+'.png'),shot.toPNG());
};
async function choose(settings,value){await js(settings,`document.querySelector('[data-language-choice="${value}"]').click();true`);await until('selected '+value,()=>js(settings,`document.querySelector('[data-language-choice="${value}"]').getAttribute('aria-pressed')==='true' && !document.querySelector('[data-language-choice="${value}"]').disabled`));}
async function layout(window,label){
  const result=await js(window,`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflows:[...document.querySelectorAll('button:not([hidden]),h1,h2,.toggle-row strong,.toggle-row small,.language-current')].filter(e=>e.getClientRects().length&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.textContent)})`);
  assert(result.scrollWidth<=result.width+1,label+' page overflows');assert.deepEqual(result.overflows,[],label+' text overflows');checks.push(label+' fits');
}
(async()=>{
  await app.whenReady();screen.getCursorScreenPoint=()=>({x:0,y:0});
  await import(pathToFileURL(process.env.QA_APP_MAIN||path.join(root,'out/main/index.js')).href);
  let pet;
  await until('pet ready',async()=>{pet=BrowserWindow.getAllWindows().find(w=>!/[?&](settings|projects)=1/.test(w.webContents.getURL()));return pet&&await js(pet,'document.querySelector("canvas")?.dataset.ready==="true"');});
  pet.hide();pet.webContents.setBackgroundThrottling(false);
  let bootstrap=await js(pet,'window.petBridge.getBootstrap()');
  assert.equal(bootstrap.preferences.language,restarting?'en':'system');
  assert.equal(await lang(pet),restarting||systemEn?'en':'zh-CN');
  openMenu();menu.items.find(item=>item.label===(restarting||systemEn?'Settings':'设置')).click();
  let settings;
  await until('settings ready',async()=>{settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings=1'));return settings&&await js(settings,'!!document.querySelector(".window-titlebar")');});
  settings.hide();settings.webContents.setBackgroundThrottling(false);
  if(restarting||systemEn) {
    assert.equal(await lang(settings),'en');assert(openMenu().includes('Projects'));
    checks.push(restarting?'English persists across process restart':'system locale resolves to English');
    assert.equal(bootstrap.preferences.followAgent,'codex');assert.equal(bootstrap.preferences.scale,1.08);
    if(systemEn){await choose(settings,'zh-CN');assert.equal(await lang(settings),'zh-CN');}
  } else {
    const before=await js(pet,'window.petBridge.getBootstrap()');
    await js(pet,`window.qaPlays=[];const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.qaPlays.push(this.src);return original.call(this);};true`);
    // Show a real demo question, then switch the existing bubble in place.
    await js(settings,'window.petBridge.sendTest("needs_input")');
    await until('Chinese question bubble',async()=>{const s=await snapshot(pet);return s.visible&&s.message==='唔，出现问题了';});
    await sleep(1500);const playsBefore=(await snapshot(pet)).plays;
    await choose(settings,'en');
    await until('all windows switch to English',async()=>await lang(settings)==='en'&&await lang(pet)==='en');
    const switched=await snapshot(pet);assert.equal(switched.message,'Um…\nI need your help.');assert.equal(switched.plays,playsBefore);
    checks.push('visible bubble translated without replaying audio');
    assert.equal(await js(settings,'document.activeElement?.id==="scale-range"'),false);
    assert(openMenu().includes('Settings'));assert(openMenu().includes('Read morning brief'));assert(openMenu().includes('Quit'));
    await capture(pet,'question-en');
    await layout(settings,'English settings 520px');
    await capture(settings,'settings-en');
    await js(settings,'scrollTo(0,700);true');await capture(settings,'settings-en-notifications');
    await js(settings,'scrollTo(0,document.body.scrollHeight);true');await capture(settings,'settings-en-history');
    assert((await js(settings,'document.querySelector("#history-list").textContent')).includes('通知原文 {project}'));
    assert((await js(settings,'document.querySelector("#history-list").textContent')).includes('中文项目'));
    const untranslated=await js(settings,`[...document.querySelectorAll('[data-i18n]')].filter(e=>/\\p{Script=Han}/u.test(e.textContent)).map(e=>e.dataset.i18n)`);
    assert.deepEqual(untranslated,[]);
    settings.setContentSize(400,760);await js(settings,'scrollTo(0,0);true');await layout(settings,'English settings 400px');await capture(settings,'settings-en-narrow');settings.setContentSize(520,760);
    const after=await js(pet,'window.petBridge.getBootstrap()');
    for(const key of Object.keys(before.preferences).filter(key=>key!=='language'))assert.equal(after.preferences[key],before.preferences[key],key+' preserved');
    assert.equal(after.history.length,before.history.length+1,'language change does not add notifications');
    for(const key of ['phase','workingProjectCount','fullPower','sessionId'])assert.equal(after.activity[key],before.activity[key],'language change preserves activity '+key);
    // An open project dashboard receives the same language switch.
    openMenu();menu.items.find(item=>item.label==='Projects').click();let projects;
    await until('projects ready',async()=>{projects=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('projects=1'));return projects&&await js(projects,'!!document.querySelector(".projects-page")');});
    projects.hide();projects.webContents.setBackgroundThrottling(false);
    await layout(projects,'English projects 760px');await capture(projects,'projects-en');
    await choose(settings,'zh-CN');
    await until('open projects switch to Chinese',()=>js(projects,'document.querySelector(".projects-title").textContent==="当前项目"'));
    assert.equal((await snapshot(pet)).message,'唔，出现问题了');assert(openMenu().includes('设置'));
    await choose(settings,'system');assert.equal(await lang(settings),'zh-CN');
    await choose(settings,'en');
    await until('open projects return to English',()=>js(projects,'document.querySelector(".projects-title").textContent==="Projects"'));
    // Unrelated updates keep the bridge status and localized copy intact.
    await js(settings,'window.petBridge.savePreferences({scale:1.09})');
    assert.equal(await js(settings,'document.querySelector("#bridge-status").textContent'),'Connected');
    await js(settings,'window.petBridge.savePreferences({scale:1.08,language:"invalid"})');
    assert.equal((await js(pet,'window.petBridge.getBootstrap()')).preferences.language,'en');
    checks.push('invalid language preserves current preference');
    // Genuine quota board uses translated status; no invented percentage.
    await sleep(7000);
    await js(pet,`(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let y=Math.floor(c.height*.45);y<c.height;y+=4)for(let x=Math.floor(c.width*.4);x<c.width*.6;x+=4)if(pixels[(y*c.width+x)*4+3]>200){c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+x/c.width*r.width,clientY:r.top+y/c.height*r.height}));return true;}throw Error('No opaque pet pixel');})()`);
    await until('English quota board',async()=>{const s=await snapshot(pet);return s.action==='quota-board'&&s.quota==='5-hour remaining: Unavailable';});
    await sleep(600);await capture(pet,'quota-en');
    checks.push('quota unavailability stays explicit');
    const saved=JSON.parse(fs.readFileSync(path.join(profile,'preferences.json'),'utf8'));assert.equal(saved.language,'en');
    checks.push('English saved to preferences');
    projects.destroy();
  }
  assert.deepEqual(errors,[],'renderer errors');
  const report={passed:true,mode:restarting?'restart':systemEn?'system-en':'switch',checks,rendererErrors:errors};
  fs.writeFileSync(path.join(output,report.mode+'-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  app.exit(0);
})().catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));app.exit(1);});
