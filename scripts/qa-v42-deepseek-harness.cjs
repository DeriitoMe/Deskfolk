// Isolated Electron + real loopback bridge + Harness plugin smoke test. No live
// Harness profile, API call, conversation, or installed Deskfolk is modified.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const root = join(__dirname, '..'), data = join(root, '.cache', 'deepseek-qa-' + Date.now());
mkdirSync(data, { recursive: true });
process.env.PET_USER_DATA = data; process.env.PET_TEST_MODE = '1';
process.env.CODEX_HOME=join(data,'fixture-codex');process.env.CLAUDE_CONFIG_DIR=join(data,'fixture-claude');
writeFileSync(join(data, 'preferences.json'), JSON.stringify({ followAgent:'deepseek', startWithCodex:false }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const restartFixture=process.argv.includes('--restart-fixture');
if(restartFixture){
  const createdAt=new Date().toISOString(),sessionId='deepseek-harness:qa-harness';
  writeFileSync(join(data,'activity.json'),JSON.stringify({[sessionId]:{sessionId,turnId:'turn:3',nativeTurnId:'turn:3',
    phase:'asking',terminal:true,waitingFor:'input',pendingInputIds:['restored'],updatedAt:createdAt,projectPath:'d:/sample-harness'}}));
  writeFileSync(join(data,'history.json'),JSON.stringify([{id:'restore-fixture',source:'deepseek-harness',type:'needs_input',
    sessionId,turnId:'turn:3',nativeCallId:'restored',nativeQuestion:true,createdAt,read:false}]));
}
(async () => {
  await import(pathToFileURL(join(root, 'out/main/index.js')).href);
  let pet;
  for (let i=0; i<200; i++) {
    pet=BrowserWindow.getAllWindows()[0];
    if(pet && await pet.webContents.executeJavaScript('!!document.querySelector("canvas[data-ready=true]")').catch(()=>false))break;
    await pause(100);
  }
  assert(pet); pet.hide();
  const js=code=>pet.webContents.executeJavaScript(code);
  const bootstrap=()=>js('window.petBridge.getBootstrap()');
  const action=()=>js('document.querySelector(".figure").dataset.action');
  const bridge=JSON.parse(readFileSync(join(data,'bridge.json'),'utf8'));
  const endpoint=`http://127.0.0.1:${bridge.port}/deepseek-harness`;
  assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+bridge.token},body:'{}'})).status,400);
  checks.push('bridge authorization and envelope validation');
  const {HarnessObserver}=await import(pathToFileURL(join(root,'plugins/deskfolk-deepseek-harness/plugin.mjs')).href);
  const {postToPet}=await import(pathToFileURL(join(root,'plugins/deskfolk-deepseek-harness/bridge-client.mjs')).href);
  const events=[],active=[];
  const session={id:'qa-harness',header:{cwd:'D:/sample-harness'},inheritedEventCount:0,snapshotEvents:from=>events.slice(from)};
  const agent={session,status:'idle'};
  let transport=Promise.resolve();
  const observer=new HarnessObserver({agents:{get:()=>agent,list:()=>[agent]},sessions:{list:()=>[session]},
    sessionProjections:{snapshot:()=>({values:{userQuestions:{active}}})}},payload=>{
    transport=transport.then(async()=>assert.equal(await postToPet(payload),true));
  });
  const flush=async()=>{await transport;await pause(200);};
  const append=async(type,eventData)=>{
    const event={type,data:eventData,seq:events.length,time:Date.now()};events.push(event);observer.observe(session,event);await flush();
  };
  if(restartFixture){
    assert.equal((await bootstrap()).activity.phase,'idle','cached state is quarantined before native evidence');
    events.push({type:'turn/start',data:{turn:3},seq:0,time:Date.now()},
      {type:'turn/end',data:{turn:3,reason:{kind:'completed'}},seq:1,time:Date.now()});
    active.push({callId:'restored',state:'continued'});
    observer.heartbeat();await flush();
    assert.equal((await bootstrap()).activity.phase,'asking');
    assert.equal((await bootstrap()).quota.source,'deepseek-harness');
    assert.equal((await bootstrap()).history.length,1,'native restart snapshot stays silent');
    if(process.argv.includes('--lease-recovery')){
      await pause(26_000);
      assert.equal((await bootstrap()).activity.phase,'idle','lost heartbeat clears the cached question');
      observer.heartbeat();await flush();
      assert.equal((await bootstrap()).activity.phase,'asking','native question returns after reconnection');
      checks.push('heartbeat loss and native question recovery');
    }
    active.length=0;await append('user/message',{source:{kind:'user-question-reply'},content:'PRIVATE_ANSWER'});
    assert.equal((await bootstrap()).activity.phase,'idle');
    const report={passed:true,checks:['cold pet startup quarantines cached state','live terminal Harness projection restores continued question',
      'followed DeepSeek quota selected on adoption','no replayed celebration or history entry','native late reply returns to idle',...checks]};
    writeFileSync(join(data,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,artifacts:data}));app.quit();return;
  }
  observer.heartbeat();await flush();
  assert.equal((await bootstrap()).activity.phase,'idle');
  assert.equal((await bootstrap()).history.length,0);
  agent.status='running';await append('turn/start',{turn:1});
  assert.equal((await bootstrap()).activity.phase,'working');assert.equal(await action(),'work');
  const quota=await js('window.petBridge.getQuota()');
  assert.equal(quota.source,'deepseek-harness');assert.equal(quota.remainingPercent,null);
  checks.push('real plugin transport starts work and selects unavailable DeepSeek quota');
  let finishTool;
  const running=observer.tool({agent,callId:'cmd',name:'bash'},()=>new Promise(resolve=>{finishTool=resolve;}));await flush();
  assert.equal(await action(),'claude-type');finishTool({});await running;await flush();
  await append('approval/asked',{id:'permission',reason:'PRIVATE_TOOL_ARGUMENTS'});
  assert.equal((await bootstrap()).activity.phase,'asking');assert.equal(await action(),'ask');
  assert.equal(await js('document.querySelector("#answer-button").hidden'),true);
  assert.equal((await js('window.petBridge.openCodex()')).ok,false);
  await append('approval/decided',{id:'permission',outcome:'allowed-once'});
  assert.equal((await bootstrap()).activity.phase,'working');
  checks.push('command pose, native permission, correct source routing and resolution');
  let answer;
  const question=observer.question({agent,wait:{callId:'continued',timed:true}},()=>new Promise(resolve=>{answer=resolve;}));await flush();
  active.push({callId:'continued',state:'continued'});answer({pending:true});await question;await flush();
  await append('turn/end',{turn:1,reason:{kind:'completed'}});agent.status='idle';
  assert.equal((await bootstrap()).activity.phase,'asking');
  const celebrationsBefore=(await bootstrap()).history.filter(e=>e.type==='task_complete').length;
  assert.equal(celebrationsBefore,0);
  active.length=0;await append('user/message',{source:{kind:'user-question-reply'},content:'PRIVATE_ANSWER'});
  assert.equal((await bootstrap()).activity.phase,'idle');
  checks.push('continued question outlives its turn without false celebration');
  agent.status='running';await append('turn/start',{turn:2});
  await js('window.petBridge.savePreferences({followAgent:"codex"})');
  assert.equal((await bootstrap()).activity.phase,'idle');
  await js('window.petBridge.savePreferences({followAgent:"deepseek"})');
  assert.equal((await bootstrap()).activity.phase,'working');
  await append('turn/end',{turn:2,reason:{kind:'completed'}});agent.status='idle';
  assert.equal((await bootstrap()).history.filter(e=>e.type==='task_complete').length,1);
  checks.push('follow filters retain source state and successful native turn celebrates once');
  // A fresh stream reconstructs current native state, as after either process restarts.
  events.push({type:'turn/start',data:{turn:3},seq:events.length,time:Date.now()});
  agent.status='running';active.push({callId:'restored',state:'continued'});
  const restored=new HarnessObserver(observer.ctx,payload=>{transport=transport.then(async()=>assert.equal(await postToPet(payload),true));});
  restored.heartbeat();await flush();
  assert.equal((await bootstrap()).activity.phase,'asking');
  assert.equal((await bootstrap()).history.filter(e=>e.type==='task_complete').length,1);
  checks.push('fresh plugin stream restores pending native state silently');
  await js('window.petBridge.openSettings()');await pause(500);
  const settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings=1'));
  assert(settings);
  const options=await settings.webContents.executeJavaScript('Array.from(document.querySelectorAll("[data-follow-choice]")).map(e=>e.dataset.followChoice)');
  assert.deepEqual(options,['deepseek','codex','claude']);
  writeFileSync(join(data,'settings.png'),(await settings.capturePage()).toPNG());
  settings.destroy();checks.push('three follow choices and DeepSeek connection visible in settings');
  assert.doesNotMatch(readFileSync(join(data,'history.json'),'utf8'),/PRIVATE_/);
  const report={passed:true,checks};
  writeFileSync(join(data,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,artifacts:data}));app.quit();
})().catch(error=>{console.error(error);app.exit(1);});
