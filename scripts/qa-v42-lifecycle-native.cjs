// Native lifecycle -> aggregate -> preload -> production renderer, in a private
// fixture profile. This never reads a real chat or changes the operating-system cursor.
const {app, BrowserWindow, Tray, screen} = require('electron');
const assert = require('node:assert/strict');
const {join, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {mkdirSync, writeFileSync, appendFileSync, readFileSync} = require('node:fs');
const {randomUUID} = require('node:crypto');
const root = resolve(__dirname, '..');
const output = join(root, '.cache', 'preflight-native-' + Date.now());
const profile = join(output, 'user-data');
const sessions = join(output, 'codex', 'sessions', '2026', '01', '01');
mkdirSync(profile, {recursive:true});mkdirSync(sessions, {recursive:true});
writeFileSync(join(profile,'preferences.json'),JSON.stringify({model:'flat-chibi',scale:1}));
process.env.PET_USER_DATA = profile;
process.env.CODEX_HOME = join(output, 'codex');
delete process.env.PET_TEST_MODE; // Exercise the actual observer, not HTTP-only tests.
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const showInactive = BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.showInactive = function(){this.setOpacity(0);return showInactive.call(this);};
let tray, menu;
const trayOn = Tray.prototype.on;
Tray.prototype.on = function(name, callback){if(name==='right-click')tray=this;return trayOn.call(this,name,callback);};
Tray.prototype.popUpContextMenu = function(value){menu=value;};
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const fixtures = new Map();
const stamp = (type,payload) => JSON.stringify({timestamp:new Date().toISOString(),type,payload})+'\n';
const makeSession = (project) => {
 const id=randomUUID(),file=join(sessions,'rollout-fixture-'+id+'.jsonl');
 const turn=randomUUID();
 writeFileSync(file,stamp('session_meta',{id,cwd:project,source:'vscode'})+stamp('event_msg',{type:'task_started',turn_id:turn}));
 fixtures.set(id,{id,file,turn,project});return fixtures.get(id);
};
const append = (fixture,type,payload) => appendFileSync(fixture.file,stamp(type,payload));
const lifecycle = (fixture,type,extra={}) => append(fixture,'event_msg',{type,turn_id:fixture.turn,...extra});
const a=makeSession('D:/Fixture/One'); // Already running when the pet starts.
const checks=[];
let pet;
async function snapshot(){
 return pet.webContents.executeJavaScript(`(async()=>{const b=await window.petBridge.getBootstrap();return {phase:b.activity.phase,projects:b.activity.workingProjectCount,power:b.activity.fullPower,action:document.querySelector('.figure')?.dataset.action,ready:!!document.querySelector('canvas.pet-art[data-ready=true]')};})()`);
}
async function expect(label,action,projects,limit=12000){
 const until=Date.now()+limit;let last;
 do{last=await snapshot();if(last.ready&&last.action===action&&(projects===undefined||last.projects===projects)){checks.push({label,...last});return last;}await sleep(100);}while(Date.now()<until);
 throw Error(label+': '+JSON.stringify(last));
}
(async()=>{
 await app.whenReady();screen.getCursorScreenPoint=()=>({x:0,y:0});
 await import(pathToFileURL(process.env.QA_APP_MAIN || join(root,'out/main/index.js')).href);
 for(let i=0;i<180;i++){pet=BrowserWindow.getAllWindows()[0];if(pet && await snapshot().then(v=>v.ready).catch(()=>false))break;await sleep(100);}
 assert(pet,'pet window exists');pet.webContents.setBackgroundThrottling(false);pet.showInactive();
 await expect('startup during actual native task','work',1);
 const same=makeSession('d:/fixture/one/');
 await sleep(6500);await expect('same directory remains one project','work',1);
 const b=makeSession('E:/Fixture/Two');await expect('different project enters full power','power-work',2);
 lifecycle(b,'turn_aborted');await expect('pause one project returns to normal work','work',1);
 // An ordinary completion from another session cannot terminate the remaining task.
 lifecycle(same,'task_complete');await expect('another session completes while task remains','work',1);
 append(a,'turn_context',{turn_id:a.turn,cwd:'E:/Fixture/Two'});
 b.turn=randomUUID();lifecycle(b,'task_started');
 await expect('same chat directory change is counted','work',1);
 append(a,'turn_context',{turn_id:a.turn,cwd:'D:/Fixture/One'});
 await expect('directory change restores distinct projects','power-work',2);
 lifecycle(b,'task_complete');await expect('full power exits to normal work','work',1);
 const call='call_'+randomUUID().replaceAll('-','');
 append(a,'response_item',{type:'function_call',name:'functions.request_user_input_async',call_id:call,arguments:JSON.stringify({questions:[{title:'Fixture question'}]})});
 append(a,'response_item',{type:'function_call_output',call_id:call,output:JSON.stringify({accepted:true})});
 await expect('native unanswered question enters asking','ask',0);
 append(a,'response_item',{type:'message',role:'user',content:[{type:'input_text',text:'<send_user_message_question_reply>\n'+JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',call,0]),answer:'fixture answer'}])+'\n</send_user_message_question_reply>'}]});
 await expect('native answer restores active work','work',1);
 lifecycle(a,'turn_aborted');await expect('native stop exits work','idle',0);
 a.turn=randomUUID();lifecycle(a,'task_started');await expect('new native turn resumes work','work',1);
 lifecycle(a,'task_complete',{error:{code:'fixture_quota_exhausted'}});await expect('observed terminal error exits work','idle',0);
 // Error fixture verifies the supported terminal path, not a conjectured quota event.
 a.turn=randomUUID();lifecycle(a,'task_started');await expect('work after error','work',1);
 lifecycle(a,'task_complete');await expect('natural native completion exits work','idle',0);
 assert(tray,'tray registered');tray.emit('right-click',{},tray.getBounds());assert(menu,'tray context menu opens');
 const settingsItem=menu.items.find(i=>i.label==='设置');assert(settingsItem);settingsItem.click();await sleep(500);
 const settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings=1'));assert(settings,'settings opens');settings.destroy();
 checks.push({label:'tray settings preserved',passed:true});
 await pet.webContents.executeJavaScript('document.querySelector("#dismiss-bubble").click()');
 const bounds=pet.getBounds();
 await pet.webContents.executeJavaScript('window.qaNow=performance.now.bind(performance);window.qaOffset=76000;Object.defineProperty(performance,"now",{value:()=>window.qaNow()+window.qaOffset});true');
 await expect('idle cadence restores watering','water',0);
 assert.equal(pet.getBounds().width,bounds.width,'water transition keeps native window size');
 const report={passed:true,build:process.env.QA_APP_MAIN?.includes('app.asar')?'packaged-asar':'production-out',checks,method:'Isolated JSONL fixtures through production native observer, main/preload and renderer',output:'Local fixture data excluded from public source export'};
 writeFileSync(join(output,'verification.json'),JSON.stringify(report,null,2));
 writeFileSync(join(root,'.cache','preflight-native-report-path.txt'),join(output,'verification.json'));
 console.log(JSON.stringify(report));app.quit();
})().catch(error=>{console.error(error.stack||error);writeFileSync(join(output,'failure.txt'),String(error.stack||error));app.exit(1);});
