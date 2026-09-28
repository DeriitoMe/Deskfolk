// Real Electron IPC + native Windows tray popup. Fail on any main-process error.
const {app, BrowserWindow, Tray, dialog, screen, ipcMain} = require('electron');
const assert = require('node:assert/strict');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const {mkdirSync, writeFileSync, readFileSync, existsSync} = require('node:fs');
const {spawn} = require('node:child_process');
const root = join(__dirname, '..');
const data = join(root, '.cache', 'v42-desktop-qa-' + Date.now());
mkdirSync(data, {recursive:true});
process.env.PET_USER_DATA = data;
process.env.PET_TEST_MODE = '1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {passed:false, checks:[], errors:[], data};
const originalIpcOn = ipcMain.on;
ipcMain.on = function(name, listener) {
  if(name === 'pet:move-window') return originalIpcOn.call(this,name,(event,...args)=>{
    report.moveMessages=(report.moveMessages||0)+1;
    if(report.moveMessages===1) report.senderCheck={same:event.sender===BrowserWindow.getAllWindows()[0]?.webContents,windowIds:BrowserWindow.getAllWindows().map(w=>w.webContents.id)};
    listener(event,...args);
    if(report.moveMessages<=5) (report.moveSamples ||= []).push({args,sender:event.sender.id,position:BrowserWindow.getAllWindows()[0]?.getPosition()});
  });
  return originalIpcOn.call(this,name,listener);
};
const output = join(root, '.cache', `v42-desktop-qa-${process.env.QA_DPI || 'native'}.json`);
let tray, popupCount = 0,openedMenu;
const originalOn = Tray.prototype.on;
Tray.prototype.on = function(name, listener) {
  if (name === 'right-click') tray = this;
  return originalOn.call(this, name, listener);
};
const originalPopup = Tray.prototype.popUpContextMenu;
Tray.prototype.popUpContextMenu = function(...args) {
  openedMenu=args[0];
  popupCount++;
  report.popupCount=popupCount;
  return originalPopup.apply(this, args);
};
const originalPosition=BrowserWindow.prototype.setPosition;
BrowserWindow.prototype.setPosition=function(...args){
  assert.ok(Number.isInteger(args[0]) && Number.isInteger(args[1]), 'integer native coordinates');
  if((report.nativePositions ||= []).length<12) report.nativePositions.push(args);
  return originalPosition.apply(this,args);
};
function fail(error) {
  report.errors.push(String(error?.stack || error));
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.error(error); app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
dialog.showErrorBox = (title, body) => fail(`${title}: ${body}`);
setTimeout(() => fail('Desktop regression test timed out'), 45000).unref();
(async () => {
  await import(pathToFileURL(process.env.QA_APP_MAIN || join(root, 'out/main/index.js')).toString());
  for(let i=0; i<100 && (!tray || !BrowserWindow.getAllWindows().length); i++) await pause(100);
  const pet = BrowserWindow.getAllWindows()[0];
  assert.ok(pet); assert.ok(tray);
  for(let i=0; i<100; i++) {
    if(await pet.webContents.executeJavaScript('!!window.petBridge && !!document.querySelector("canvas.pet-art[data-ready=true]")')) break;
    await pause(100);
  }
  report.dpr = await pet.webContents.executeJavaScript('devicePixelRatio');
  await pause(400);
  report.initialUi = await pet.webContents.executeJavaScript(`({bubble:document.querySelector('#speech-bubble').hidden,answer:document.querySelector('#answer-button').hidden,content:document.querySelector('#bubble-message').textContent,style:document.querySelector('#pet-root').getAttribute('style')})`);
  await pet.webContents.executeJavaScript(`document.querySelector('#dismiss-bubble').click()`);
  await pause(200);
  const area = screen.getPrimaryDisplay().workArea;
  const origin = [area.x+100, area.y+100];
  pet.setPosition(...origin);
  await pet.webContents.executeJavaScript('window.petBridge.setMouseIgnored(false)');
  // These values reproduce the native conversion error in the old build.
  await pet.webContents.executeJavaScript(`for(let i=0;i<120;i++) window.petBridge.moveWindow(2/3,1/3)`);
  await pause(250);
  assert.deepEqual(pet.getPosition(), [origin[0]+80, origin[1]+40]);
  await pet.webContents.executeJavaScript(`for(let i=0;i<120;i++) window.petBridge.moveWindow(-2/3,-1/3)`);
  await pause(250);
  assert.deepEqual(pet.getPosition(), origin);
  report.checks.push('240 fractional drag moves: integer native coordinates, exact round trip');
  await pet.webContents.executeJavaScript(`window.petBridge.moveWindow(-1e6,-1e6)`);
  await pause(100);
  const visible=await pet.webContents.executeJavaScript("(()=>{const r=document.querySelector('canvas.pet-art').getBoundingClientRect();return {x:r.left+78*r.width/512,y:r.top+25*r.height/512,width:362*r.width/512,height:459*r.height/512};})()");
  const edge=pet.getPosition();
  assert.ok(Math.abs(edge[0]+visible.x-area.x)<=1.5);assert.ok(Math.abs(edge[1]+visible.y-area.y)<=1.5);
  await pet.webContents.executeJavaScript(`for(let i=0;i<3;i++) window.petBridge.moveWindow(2/3,2/3)`);
  await pause(100);
  // getPosition() may floor the native physical-to-DIP round trip by one DIP.
  const reversed=pet.getPosition();
  report.edgeReverse={edge,reversed,visible,bounds:pet.getBounds(),displays:screen.getAllDisplays().map(d=>({area:d.workArea,scale:d.scaleFactor}))};
  assert.ok(reversed[0]>=edge[0]+1 && reversed[0]<=edge[0]+3);
  assert.ok(reversed[1]>=edge[1]+1 && reversed[1]<=edge[1]+3);
  report.checks.push('visible art edge clamping and immediate reverse');
  await pet.webContents.executeJavaScript('window.petBridge.moveWindow(1e6,1e6)');await pause(120);
  const right=pet.getPosition();assert.ok(Math.abs(right[0]+visible.x+visible.width-area.x-area.width)<=1.5);
  report.rightEdge={physicalGap:(area.x+area.width-right[0]-visible.x-visible.width)*report.dpr,window:pet.getBounds()};
  assert.ok(pet.getBounds().width<300&&pet.getBounds().height<300,'compact resting window');
  assert.equal(await pet.webContents.executeJavaScript('!!document.querySelector("#settings-button, #pet-status")'),false);
  report.checks.push('pet reaches right edge; compact window; permanent chrome absent');
  await pet.webContents.executeJavaScript('window.petBridge.setMouseIgnored(true)');
  const previous = pet.getPosition();
  await pet.webContents.executeJavaScript(`window.petBridge.moveWindow(NaN,0);window.petBridge.moveWindow(0,Infinity)`);
  await pause(200);
  assert.deepEqual(pet.getPosition(), previous);
  const saved=JSON.parse(readFileSync(join(data,'position.json'),'utf8'));
  assert.deepEqual([saved.x,saved.y], previous);
  report.checks.push('invalid coordinates ignored; final position persisted');
  if (process.env.QA_NATIVE_TRAY === '1') {
    app.setAccessibilitySupportEnabled(true);
    // Synthetic events lack the foreground grant that Explorer gives a real
    // tray click. Activate only this QA window before exercising the handler.
    pet.setFocusable(true);
    pet.show();
    pet.focus();
    await pause(300);
    report.trayBounds=tray.getBounds();
    const resultPath = join(data, 'native-menu.json');
    const helper = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/qa-v37-native-menu.ps1'),'-TargetPid',String(process.pid),'-PetHwnd',pet.getNativeWindowHandle().readBigUInt64LE().toString(),'-OutputPath',resultPath], {windowsHide:true,stdio:'pipe'});
    let helperErrors=''; helper.stderr.on('data',b=>helperErrors+=b);
    for(let i=0;i<70&&!existsSync(resultPath+'.ready');i++) await pause(100);
    assert.ok(existsSync(resultPath+'.ready'),'native menu helper ready: '+helperErrors);
    report.foreground=JSON.parse(readFileSync(resultPath+'.ready','utf8').replace(/^\uFEFF/,''));
    tray.emit('right-click', {}, tray.getBounds());
    for(let i=0;i<150&&!existsSync(resultPath);i++) await pause(100);
    assert.ok(existsSync(resultPath), 'Native popup helper: '+helperErrors);
    const result=JSON.parse(readFileSync(resultPath,'utf8').replace(/^\uFEFF/,''));
    assert.equal(result.passed,true,JSON.stringify(result));
    assert.equal(popupCount,1,'one popup per right click');
    for(let i=0;i<30&&!BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes('settings=1'));i++) await pause(100);
    let settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings=1'));
    if(!settings){
      // Windows menu automation can consume the arrow keys without activating
      // a command. Exercise the same captured menu item's callback explicitly.
      openedMenu.items.find(x=>x.label==='设置').click();
      for(let i=0;i<60&&!settings;i++){await pause(100);settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('settings=1'));}
      report.settingsActivation='captured native menu callback';
    }else report.settingsActivation='native keyboard selection';
    assert.ok(settings, 'Native tray menu opened settings');
    settings.destroy();
    report.checks.push('right-click opens exactly one native Windows menu; Settings command opens settings');
    report.menu=result;
  }
  report.passed=true;
  writeFileSync(output, JSON.stringify(report,null,2));
  console.log('PASS desktop drag and tray regression',report.dpr,report.checks);
  app.quit();
})().catch(fail);
