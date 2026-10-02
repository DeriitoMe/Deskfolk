const {app,BrowserWindow,Tray,screen}=require('electron');
const assert=require('node:assert/strict');const {join}=require('node:path');const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync,appendFileSync,readFileSync}=require('node:fs');const {randomUUID}=require('node:crypto');
const root=require('node:path').resolve(__dirname,'..'),output=process.env.QA_OUTPUT||join(root,'.cache/celebration-20261002/live-'+Date.now());
const profile=join(output,'profile'),sessions=join(output,'codex/sessions/2026/10/02');
mkdirSync(profile,{recursive:true});mkdirSync(sessions,{recursive:true});
writeFileSync(join(profile,'preferences.json'),JSON.stringify({model:'flat-chibi',scale:1,startWithCodex:false}));
process.env.PET_USER_DATA=profile;process.env.CODEX_HOME=join(output,'codex');delete process.env.PET_TEST_MODE;
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const originalShow=BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.showInactive=function(){this.setOpacity(0);return originalShow.call(this);};
let tray,menu;const trayOn=Tray.prototype.on;
Tray.prototype.on=function(name,callback){if(name==='right-click')tray=this;return trayOn.call(this,name,callback);};
Tray.prototype.popUpContextMenu=function(m){menu=m;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let pet;
const checks=[];
const line=(type,payload)=>JSON.stringify({timestamp:new Date().toISOString(),type,payload})+'\n';
function fixture(project){const f={id:randomUUID(),turn:randomUUID(),project};f.file=join(sessions,'rollout-'+f.id+'.jsonl');writeFileSync(f.file,line('session_meta',{id:f.id,cwd:project,source:'vscode'}));return f;}
const a=fixture('D:/Fixture/ProjectA'),b=fixture('E:/Fixture/ProjectB');
const append=(f,type,payload)=>appendFileSync(f.file,line(type,payload));
const event=(f,type,extra={})=>append(f,'event_msg',{type,turn_id:f.turn,...extra});
event(a,'task_started');
async function snap(){return pet.webContents.executeJavaScript(`(async()=>{const b=await window.petBridge.getBootstrap();return {phase:b.activity.phase,count:b.activity.workingProjectCount,terminal:b.activity.terminal===true,action:document.querySelector('.figure')?.dataset.action,ready:!!document.querySelector('canvas.pet-art[data-ready=true]'),bubble:!document.querySelector('#speech-bubble').hidden,message:document.querySelector('#bubble-message').textContent,actions:window.qaActions??[]};})()`);}
async function wait(label,predicate,limit=12000){const until=Date.now()+limit;let state;do{state=await snap();if(state.ready&&predicate(state)){checks.push({label,...state});return state;}await sleep(50);}while(Date.now()<until);throw Error(label+': '+JSON.stringify(state));}
const action=(label,value,count)=>wait(label,s=>s.action===value&&(count===undefined||s.count===count));
async function capture(name){writeFileSync(join(output,name+'.png'),(await pet.webContents.capturePage()).toPNG());}
async function clearActions(){await pet.webContents.executeJavaScript('window.qaActions=[];true');}
async function checkQuiet(label){await sleep(1400);const s=await snap();assert(!s.actions.some(x=>x.action.startsWith('celebrate-')),label);checks.push({label,passed:true});}
(async()=>{
 await app.whenReady();screen.getCursorScreenPoint=()=>({x:0,y:0});await import(pathToFileURL(process.env.QA_APP_MAIN||join(root,'out/main/index.js')).href);
 for(let i=0;i<240;i++){pet=BrowserWindow.getAllWindows()[0];if(pet&&await snap().then(s=>s.ready).catch(()=>false))break;await sleep(50);}
 assert(pet);pet.webContents.setBackgroundThrottling(false);
 await pet.webContents.executeJavaScript(`window.qaActions=[];window.qaRenders=[];window.qaLastAction='';new MutationObserver(()=>{const a=document.querySelector('.figure')?.dataset.action;if(a!==window.qaLastAction){window.qaLastAction=a;window.qaActions.push({action:a,time:performance.now()});}}).observe(document.querySelector('.figure'),{attributes:true,attributeFilter:['data-action']});window.qaDrawImage=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args){if(this.canvas.dataset.renderer==='three-v05')window.qaRenders.push(performance.now());return window.qaDrawImage.apply(this,args);};true`);
 await action('native startup work preserved','work',1);
 event(b,'task_started');await action('two real project directories enter full power','power-work',2);
 await clearActions();event(a,'task_complete');
 const first=await wait('one project succeeds while another remains working',s=>s.action.startsWith('celebrate-'));
 await sleep(800);await capture(first.action);
 await action('celebration restores remaining project work','work',1);
 const secondBefore=(await snap()).actions.filter(x=>x.action.startsWith('celebrate-')).length;
 event(a,'task_complete');await sleep(900);assert.equal((await snap()).actions.filter(x=>x.action.startsWith('celebrate-')).length,secondBefore,'duplicate success is not celebrated');
 event(b,'task_complete');const second=await wait('second completion alternates celebration',s=>s.action.startsWith('celebrate-'));
 assert.notEqual(first.action,second.action);await sleep(800);await capture(second.action);
 await action('second completion restores idle','idle',0);
 const layout=await pet.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;const node=document.querySelector('#speech-bubble'),text=document.querySelector('#bubble-message'),k=document.querySelector('#bubble-kicker'),s=getComputedStyle(node),t=getComputedStyle(text);return {closePresent:!!document.querySelector('#dismiss-bubble'),kickerHidden:k.hidden,message:text.textContent,width:node.getBoundingClientRect().width,background:s.backgroundColor,fontSize:t.fontSize,fontFamily:t.fontFamily,fontLoaded:document.fonts.check('20px ChillRoundF'),fontFaces:Array.from(document.fonts).map(f=>({family:f.family,status:f.status})),textClipped:text.scrollHeight>text.clientHeight+1};})()`);
 assert.equal(layout.closePresent,false);assert.equal(layout.kickerHidden,true);assert.equal(layout.message,'结束了……');assert.equal(layout.background,'rgb(255, 255, 255)');assert.equal(layout.textClipped,false);assert(layout.fontLoaded&&layout.fontFaces.some(f=>f.family==='ChillRoundF'&&f.status==='loaded'));
 checks.push({label:'completion bubble layout',...layout});await capture('completion-bubble');
 await clearActions();a.turn=randomUUID();event(a,'task_started');await action('new task still starts normal work','work',1);event(a,'turn_aborted',{reason:'interrupted'});await action('manual stop returns idle without celebration','idle',0);await checkQuiet('stop not celebrated');
 for(const [label,error] of [['failure',{codex_error_info:'other'}],['quota',{codex_error_info:'usage_limit_exceeded'}]]){
  await clearActions();a.turn=randomUUID();event(a,'task_started');await action(label+' start','work',1);event(a,'task_complete',{error});await action(label+' returns idle','idle',0);await checkQuiet(label+' not celebrated');
 }
 a.turn=randomUUID();event(a,'task_started');await action('question task running','work',1);
 const ask=id=>{append(a,'response_item',{type:'function_call',name:'functions.request_user_input_async',call_id:id,arguments:JSON.stringify({questions:[{title:'请选择你希望的测试方案。'}]})});append(a,'response_item',{type:'function_call_output',call_id:id,output:JSON.stringify({accepted:true})});};
 const call='call_'+randomUUID().replaceAll('-','');ask(call);
 await action('actual pending question displays reminder','ask',0);const askingAt=performance.now();await capture('question-bubble');
 await sleep(2500);
 const bridge=JSON.parse(readFileSync(join(profile,'bridge.json'),'utf8'));
 const duplicate=await fetch('http://127.0.0.1:'+bridge.port+'/notify',{method:'POST',headers:{authorization:'Bearer '+bridge.token,'content-type':'application/json'},body:JSON.stringify({source:'hook',type:'needs_input',nativeQuestion:true,sessionId:a.id,turnId:a.turn,id:'hook:needs_input:'+a.id+':'+a.turn+':'+call,message:'Codex 有一个问题等你回答。'})});assert.equal(duplicate.status,202);
 await wait('question reminder exits without answering native question',s=>s.action==='idle'&&s.phase==='asking'&&!s.bubble,11000);
 const elapsed=performance.now()-askingAt;assert(elapsed>=7500&&elapsed<9500);checks.push({label:'question reminder elapsed',milliseconds:elapsed,nativeStillPending:true});
 await sleep(1000);assert.equal((await snap()).action,'idle');
 const call2='call_'+randomUUID().replaceAll('-','');ask(call2);await action('new call in same pending turn is reminded','ask',0);
 await clearActions();event(a,'task_complete');
 await wait('clean turn end while awaiting input preserves actual question',s=>s.phase==='asking'&&s.terminal);
 await wait('questioning turn does not celebrate after reminder expires',s=>s.action==='idle'&&s.phase==='asking'&&!s.bubble,11000);
 await checkQuiet('awaiting-answer turn not celebrated');
 for(const id of [call,call2])append(a,'response_item',{type:'message',role:'user',content:[{type:'input_text',text:'<send_user_message_question_reply>\n'+JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',id,0]),answer:'fixture answer'}])+'\n</send_user_message_question_reply>'}]});
 await action('actual answer clears completed question without restarting work','idle',0);
 a.turn=randomUUID();event(a,'task_started');await action('next actual turn resumes work','work',1);
 await pet.webContents.executeJavaScript('window.qaRenders=[];true');await sleep(4000);
 const fps=await pet.webContents.executeJavaScript(`(()=>{const a=window.qaRenders,d=a.slice(1).map((x,i)=>x-a[i]);return {frames:a.length,fps:(a.length-1)*1000/(a.at(-1)-a[0]),p95FrameMs:d.sort((a,b)=>a-b)[Math.floor(d.length*.95)]};})()`);
 assert(fps.fps>=30);checks.push({label:'actual production 3D working frame rate',...fps});
 const point=await pet.webContents.executeJavaScript(`(()=>{const c=document.querySelector('canvas.pet-art'),b=c.getBoundingClientRect();window.petBridge.setMouseIgnored(false);return {x:Math.round(b.left+b.width*.5),y:Math.round(b.top+b.height*.51)};})()`);
 pet.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});pet.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
 await action('actual mouse touch enters continuous panic motion','touch');await sleep(400);await capture('touch');
 event(a,'task_complete');const third=await wait('completion during touch waits then celebrates',s=>s.action.startsWith('celebrate-'));
 assert.equal(third.action,first.action,'third celebration preserves alternation');await action('touch and completion recover to idle','idle',0);
 assert(tray);tray.emit('right-click',{},tray.getBounds());assert(menu);menu.items.find(i=>i.label==='设置').click();await sleep(400);const settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings=1'));assert(settings);settings.destroy();checks.push({label:'tray settings preserved',passed:true});
 writeFileSync(join(output,'verification.json'),JSON.stringify({passed:true,checks,firstCelebration:first.action,secondCelebration:second.action,method:'Private native JSONL fixtures through actual observer, IPC/preload and production 3D renderer; real chats untouched'},null,2));writeFileSync(join(root,'.cache/celebration-20261002/live-report-path.txt'),join(output,'verification.json'));console.log('Live QA passed '+checks.length+' checks; FPS '+fps.fps.toFixed(1));app.quit();
})().catch(e=>{console.error(e.stack||e);writeFileSync(join(output,'failure.txt'),String(e.stack||e));app.exit(1);});
