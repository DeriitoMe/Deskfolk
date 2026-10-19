// Renders README promo frames from the real built app. Isolated profile and a
// fixture Harness session drive the states; no live agent, profile or desktop
// is captured. Output: .cache/promo-<time>/frames/*.png and gif/*.png.
const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const root = join(__dirname, '..'), data = join(root, '.cache', 'promo-' + Date.now());
const frames = join(data, 'frames'), gif = join(data, 'gif');
for (const dir of [frames, gif]) mkdirSync(dir, { recursive: true });
process.env.PET_USER_DATA = data; process.env.PET_TEST_MODE = '1';
process.env.CODEX_HOME = join(data, 'fixture-codex'); process.env.CLAUDE_CONFIG_DIR = join(data, 'fixture-claude');
writeFileSync(join(data, 'preferences.json'), JSON.stringify({ model: 'flat-chibi', scale: 1.6, bubbleSeconds: 5, followAgent: 'all',
  startWithCodex: false, startWithClaudeCode: false }));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Keep the window off the visible desktop while it still renders.
const originalShow = BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.showInactive = function () { this.setOpacity(0); return originalShow.call(this); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let pet;

(async () => {
  await app.whenReady();
  // The pet looks straight ahead: the cursor sits just in front of its face.
  screen.getCursorScreenPoint = () => {
    const b = pet && !pet.isDestroyed() ? pet.getBounds() : null;
    return b ? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height * 0.62) } : { x: 0, y: 0 };
  };
  await import(pathToFileURL(join(root, 'out/main/index.js')).href);
  for (let i = 0; i < 200; i++) {
    pet = BrowserWindow.getAllWindows()[0];
    if (pet && await pet.webContents.executeJavaScript('!!document.querySelector("canvas[data-ready=true]")').catch(() => false)) break;
    await pause(100);
  }
  assert(pet); pet.webContents.setBackgroundThrottling(false);
  const js = code => pet.webContents.executeJavaScript(code);
  const action = () => js('document.querySelector(".figure").dataset.action');
  const until = async (label, test, limit = 8000) => {
    const end = Date.now() + limit; let value;
    do { value = await action(); if (test(value)) return value; await pause(50); } while (Date.now() < end);
    throw Error(label + ': ' + value);
  };
  const bubbleGone = async () => {
    for (let i = 0; i < 200 && await js('!document.querySelector("#speech-bubble").hidden'); i++) await pause(100);
    await pause(300);
  };
  // The art canvas renders at about twice its on-screen size; bubbles are DOM.
  const art = async () => Buffer.from((await js('document.querySelector("canvas[data-ready=true]").toDataURL("image/png")')).split(',')[1], 'base64');
  const bubbles = {};
  const capture = async name => {
    writeFileSync(join(frames, name + '.png'), (await pet.webContents.capturePage()).toPNG());
    writeFileSync(join(frames, name + '-art.png'), await art());
    bubbles[name] = await js('document.querySelector("#speech-bubble").hidden?null:{kicker:document.querySelector("#bubble-kicker").hidden?"":document.querySelector("#bubble-kicker").textContent,message:document.querySelector("#bubble-message").textContent}');
  };

  const { HarnessObserver } = await import(pathToFileURL(join(root, 'plugins/deskfolk-deepseek-harness/plugin.mjs')).href);
  const { postToPet } = await import(pathToFileURL(join(root, 'plugins/deskfolk-deepseek-harness/bridge-client.mjs')).href);
  const harness = (id, cwd) => {
    const events = [], session = { id, header: { cwd }, inheritedEventCount: 0, snapshotEvents: from => events.slice(from) };
    const agent = { session, status: 'idle' };
    let transport = Promise.resolve();
    const observer = new HarnessObserver({ agents: { get: () => agent, list: () => [agent] }, sessions: { list: () => [session] },
      sessionProjections: { snapshot: () => ({ values: { userQuestions: { active: [] } } }) } }, payload => {
      transport = transport.then(() => postToPet(payload));
    });
    const flush = async () => { await transport; await pause(150); };
    const append = async (type, eventData) => {
      const event = { type, data: eventData, seq: events.length, time: Date.now() };
      events.push(event); observer.observe(session, event); await flush();
    };
    return { observer, agent, flush, append };
  };
  const a = harness('promo-a', 'D:/sample/garden'), b = harness('promo-b', 'D:/sample/notebook');
  a.observer.heartbeat(); b.observer.heartbeat(); await a.flush(); await b.flush();
  await pause(1500); await capture('idle');

  a.agent.status = 'running'; await a.append('turn/start', { turn: 1 });
  await until('work', value => value === 'work'); await pause(1800); await capture('work');

  b.agent.status = 'running'; await b.append('turn/start', { turn: 1 });
  await until('power-work', value => value === 'power-work'); await pause(1800); await capture('power-work');
  b.agent.status = 'idle'; await b.append('turn/end', { turn: 1, reason: { kind: 'aborted' } });
  await until('back to work', value => value === 'work'); await pause(1200);

  // Typing: hold a running PowerShell command and record frames for the GIF.
  let finish;
  const running = a.observer.tool({ agent: a.agent, callId: 'cmd', name: 'pwsh' }, () => new Promise(resolve => { finish = resolve; }));
  await a.flush(); await until('type', value => value === 'claude-type'); await bubbleGone();
  await capture('type');
  const timing = [];
  for (let i = 0, start = Date.now(); Date.now() - start < 3200; i++) {
    const at = Date.now();
    writeFileSync(join(gif, String(i).padStart(3, '0') + '.png'), await art());
    timing.push(at - start);
    await pause(Math.max(0, 70 - (Date.now() - at)));
  }
  writeFileSync(join(gif, 'timing.json'), JSON.stringify(timing));
  finish({}); await running; await a.flush();

  let finishWrite;
  const writing = a.observer.tool({ agent: a.agent, callId: 'edit', name: 'edit' }, () => new Promise(resolve => { finishWrite = resolve; }));
  await a.flush(); await until('write', value => value === 'claude-write'); await bubbleGone(); await capture('write');
  finishWrite({}); await writing; await a.flush();

  await a.append('approval/asked', { id: 'permission' });
  await until('ask', value => value === 'ask'); await pause(1800); await capture('ask');
  await a.append('approval/decided', { id: 'permission', outcome: 'allowed-once' });
  await until('resume', value => value === 'work' || value === 'claude-type' || value === 'claude-write');

  a.agent.status = 'idle'; await a.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await until('celebrate', value => value.startsWith('celebrate-'));
  for (let i = 1; i <= 8; i++) { await pause(250); await capture('celebrate-' + i); }
  await until('idle after celebration', value => value === 'idle', 15000);
  if (await js('!document.querySelector("#speech-bubble").hidden')) { await pause(900); await capture('done'); }
  await bubbleGone(); await pause(700);

  // Headpat: a real left click on the visible art.
  const box = await js('(()=>{const r=document.querySelector("canvas[data-ready=true]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height*0.72};})()');
  const point = { x: Math.round(box.x), y: Math.round(box.y) };
  pet.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  pet.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  await pause(60);
  pet.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await until('touch', value => value === 'touch', 3000); await pause(180); await capture('touch');

  assert.doesNotMatch(readFileSync(join(data, 'history.json'), 'utf8'), /PRIVATE_/);
  writeFileSync(join(frames, 'bubbles.json'), JSON.stringify(bubbles, null, 2));
  console.log(JSON.stringify({ passed: true, output: data }));
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
