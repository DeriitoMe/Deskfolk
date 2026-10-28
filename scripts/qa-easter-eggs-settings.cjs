// Real Electron/IPC regression in an isolated profile. Run after npm run build:
// node node_modules/electron/cli.js scripts/qa-easter-eggs-settings.cjs
// Run again with --restart to check the saved off state in a new process.
// Idle time is accelerated; audio start/cancellation uses real timers. Audio output is muted.
const {app, BrowserWindow, screen} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const output = process.env.QA_OUTPUT || path.join(root, '.cache/easter-eggs-qa');
const profile = path.join(output, 'profile'), restarting = process.argv.includes('--restart');
fs.mkdirSync(profile, {recursive: true});
if (!restarting) fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh-CN', model: 'flat-chibi', outfit: 'beret', scale: 1.08,
  startWithCodex: false, startWithClaudeCode: false, followAgent: 'all'
}));
process.env.PET_USER_DATA = profile; process.env.PET_TEST_MODE = '1'; process.env.PET_QUOTA_LOG_ONLY = '1';
process.env.CODEX_HOME = path.join(output, 'codex'); process.env.CLAUDE_CONFIG_DIR = path.join(output, 'claude');
process.env.DESKFOLK_MORNING_BRIEF_DIR = path.join(output, 'missing-brief');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('mute-audio');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (win, code) => win.webContents.executeJavaScript(code);
const checks = [], errors = [];
let pet, settings;
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_event, level, message) => {
    if (level >= 3 && !message.includes('WebGL')) errors.push(message);
  });
  contents.on('render-process-gone', (_, details) => errors.push(details.reason));
});
async function until(label, fn, timeout = 18000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn().catch(() => false)) { checks.push(label); return; }
    await sleep(50);
  }
  throw Error('Timed out: ' + label);
}
const bootstrap = () => js(pet, 'window.petBridge.getBootstrap()');
const action = () => js(pet, 'document.querySelector(".figure")?.dataset.action');
const saved = () => JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
async function toggle(enabled) {
  await js(settings, `(()=>{const c=document.querySelector('#easter-eggs-toggle');if(c.checked!==${enabled})c.click();return true;})()`);
  await until('toggle saved: ' + enabled, async () => saved().easterEggsEnabled === enabled &&
    await js(settings, `document.querySelector('#easter-eggs-toggle').checked===${enabled}&&!document.querySelector('#easter-eggs-toggle').disabled`));
  await until('pet received: ' + enabled, async () => (await bootstrap()).preferences.easterEggsEnabled === enabled);
}
async function resetPet() {
  await js(pet, `localStorage.setItem('deskfolk.guitarEgg','3');true`);
  const loaded = new Promise(resolve => pet.webContents.once('did-finish-load', resolve));
  pet.webContents.reload(); await loaded;
  await until('renderer ready after reload', () => js(pet, `document.querySelector('canvas')?.dataset.ready==='true'`));
  await js(pet, `window.qaTime=0;window.qaNow=performance.now.bind(performance);window.qaTarget=window.qaNow();
    Object.defineProperty(performance,'now',{value:()=>window.qaNow()+window.qaTime});
    window.qaPlays=[];window.qaAudio=null;const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){if(this.src.includes('mutsumi-guitar-solo')){window.qaAudio=this;window.qaPlays.push(this.src);}return play.call(this);};true`);
}
async function advance(ms) {
  await js(pet, `window.qaTarget+=${ms};window.qaTime=window.qaTarget-window.qaNow();true`);
  await sleep(200);
}
async function guitarSlot() { await advance(123700); }
const plays = () => js(pet, 'window.qaPlays.length');
async function capture(name) {
  settings.setOpacity(0); settings.showInactive();
  await js(settings, `document.querySelector('#easter-eggs-toggle').closest('section').scrollIntoView({block:'start'});true`);
  await sleep(250);
  const shot = await Promise.race([settings.webContents.capturePage(), sleep(8000).then(() => {throw Error('Capture timeout');})]);
  fs.writeFileSync(path.join(output, name + '.png'), shot.toPNG());
}
(async () => {
  await app.whenReady(); screen.getCursorScreenPoint = () => ({x: 0, y: 0});
  await import(pathToFileURL(process.env.QA_APP_MAIN || path.join(root, 'out/main/index.js')).href);
  await until('pet ready', async () => {
    pet = BrowserWindow.getAllWindows().find(w => !/[?&](settings|projects)=1/.test(w.webContents.getURL()));
    return pet && await js(pet, `document.querySelector('canvas')?.dataset.ready==='true'`);
  });
  pet.hide(); pet.webContents.setBackgroundThrottling(false);
  const before = (await bootstrap()).preferences;
  assert.equal(before.easterEggsEnabled, !restarting);
  checks.push(restarting ? 'off preference survived process restart' : 'old preferences default to enabled');
  await js(pet, 'window.petBridge.openSettings();true');
  await until('settings ready', async () => {
    settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('settings=1'));
    return settings && await js(settings, `!!document.querySelector('#easter-eggs-toggle')&&!document.querySelector('#easter-eggs-toggle').disabled`);
  });
  settings.setOpacity(0); settings.webContents.setBackgroundThrottling(false);
  await until('settings show saved value', () => js(settings, `document.querySelector('#easter-eggs-toggle').checked===${!restarting}`));
  assert.equal(await js(settings, `document.querySelector('#easter-eggs-toggle').closest('section').getAttribute('aria-labelledby')`), 'companion-heading');
  if (restarting) {
    await resetPet(); await guitarSlot(); assert.equal(await action(), 'guitar');
    assert.equal(await js(pet, `localStorage.getItem('deskfolk.guitarEgg')`), '3');
    assert.equal(await plays(), 0); checks.push('restart keeps the guitar daydream and suppresses the egg');
  } else {
    await capture('settings-zh-on');
    await toggle(false);
    await js(settings, `window.petBridge.savePreferences({easterEggsEnabled:'false'})`);
    assert.equal(saved().easterEggsEnabled, false); checks.push('invalid value preserves the current setting');
    await resetPet();
    for (const [ms, expected] of [[30100,'nap'],[15000,'idle'],[30000,'water'],[18600,'idle'],[30000,'guitar']]) {
      await advance(ms); assert.equal(await action(), expected);
    }
    assert.equal(await js(pet, `localStorage.getItem('deskfolk.guitarEgg')`), '3');
    assert.equal(await plays(), 0); checks.push('off keeps everyday actions and does not consume the egg counter');
    await toggle(true); assert.equal(await action(), 'guitar'); checks.push('enabling mid-daydream waits for a new slot');
    await advance(15000); assert.equal(await action(), 'idle');
    await advance(123600); assert.equal(await action(), 'guitar-solo');
    await toggle(false); assert.equal(await action(), 'guitar');
    await sleep(6200); assert.equal(await plays(), 0); checks.push('off cancels a pending audio start');

    await toggle(true); await resetPet(); await guitarSlot(); assert.equal(await action(), 'guitar-solo');
    await until('solo audio playing', () => js(pet, `window.qaAudio&&!window.qaAudio.paused&&window.qaAudio.currentTime>0`), 8000);
    await toggle(false);
    await until('playing audio stopped', () => js(pet, `window.qaAudio.paused`), 1500);
    assert.equal(await action(), 'guitar'); assert.equal(await plays(), 1);
    await toggle(true); await sleep(300); assert.equal(await action(), 'guitar'); assert.equal(await plays(), 1);
    checks.push('off fades live audio and enabling in the same slot does not replay it');

    await js(settings, 'window.petBridge.savePreferences({doNotDisturb:true})');
    await resetPet(); await guitarSlot(); assert.equal(await action(), 'guitar-solo');
    await sleep(6200); assert.equal(await plays(), 0); checks.push('do not disturb still permits a silent solo');
    await js(settings, 'window.petBridge.savePreferences({doNotDisturb:false})');
    await toggle(false);
    await capture('settings-zh-off');
    await js(settings, `document.querySelector('[data-language-choice="en"]').click();true`);
    await until('English labels', () => js(settings, `document.querySelector('label[for="easter-eggs-toggle"] strong').textContent==='Easter egg actions'`));
    await capture('settings-en-off');
    settings.setContentSize(400, 760); await sleep(200);
    const layout = await js(settings, `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      textOverflows:[...document.querySelectorAll('label[for="easter-eggs-toggle"] strong,label[for="easter-eggs-toggle"] small')].filter(e=>e.scrollWidth>e.clientWidth+2).length})`);
    assert(layout.scrollWidth <= layout.width + 1); assert.equal(layout.textOverflows, 0);
    await capture('settings-en-narrow'); checks.push('Chinese and English switch fits a 400px window');
    const after = (await bootstrap()).preferences;
    for (const key of Object.keys(before).filter(k => !['language','easterEggsEnabled'].includes(k))) assert.equal(after[key], before[key], key + ' preserved');
    checks.push('other preferences preserved');
  }
  assert.deepEqual(errors, []);
  const report = {passed: true, mode: restarting ? 'restart' : 'switch', checks, errors,
    scope: 'Real Electron/IPC with isolated profiles, accelerated idle clock and real media timers; speaker output muted.'};
  fs.writeFileSync(path.join(output, report.mode + '-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(0);
})().catch(error => {
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({error: error.stack, checks, errors}, null, 2));
  console.error(error.stack); app.exit(1);
});
