// Real Electron/IPC check of the outfit setting in an isolated profile. Never touches live data.
// node node_modules/electron/cli.js scripts/qa-beret-outfit-settings.cjs
// Opens Settings from the tray, picks the beret outfit, checks it is saved and
// worn by the pet, then switches back. Screenshots go to .cache/beret-outfit-qa/settings/.
const {app, BrowserWindow, Tray, screen} = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache/beret-outfit-qa/settings');
const profile = path.join(output, 'profile');
fs.rmSync(profile, {recursive: true, force: true}); fs.mkdirSync(profile, {recursive: true});
// An older preferences file without `outfit` must fall back to the uniform.
fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({model: 'flat-chibi', scale: 1.2, startWithCodex: false, startWithClaudeCode: false}));
process.env.PET_USER_DATA = profile; process.env.PET_TEST_MODE = '1'; process.env.PET_QUOTA_LOG_ONLY = '1';
process.env.CODEX_HOME = path.join(output, 'codex'); process.env.CLAUDE_CONFIG_DIR = path.join(output, 'claude');
process.env.DESKFOLK_MORNING_BRIEF_DIR = path.join(output, 'missing-brief');
app.getLocale = () => 'zh-CN';
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
let tray, menu;
const originalOn = Tray.prototype.on;
Tray.prototype.on = function (event, fn) { if (event === 'right-click') tray = this; return originalOn.call(this, event, fn); };
Tray.prototype.popUpContextMenu = function (value) { menu = value; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [];
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('WebGL')) errors.push(message); });
  contents.on('render-process-gone', (_, details) => errors.push('renderer gone: ' + details.reason));
});
async function until(label, fn, timeout = 18000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await fn().catch(() => false)) { checks.push(label); return; } await sleep(50); }
  throw Error('Timed out: ' + label);
}
const js = (window, source) => window.webContents.executeJavaScript(source);
const capture = async (window, name) => {
  window.setOpacity(0); window.showInactive(); await sleep(400);
  const shot = await Promise.race([window.webContents.capturePage(), sleep(8000).then(() => { throw Error('Capture timeout: ' + name); })]);
  fs.writeFileSync(path.join(output, name + '.png'), shot.toPNG());
};
const saved = () => JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
const pressed = (settings, value) => js(settings, `document.querySelector('[data-outfit-choice="${value}"]').getAttribute('aria-pressed')==='true'`);

(async () => {
  await app.whenReady(); screen.getCursorScreenPoint = () => ({x: 0, y: 0});
  await import(pathToFileURL(path.join(root, 'out/main/index.js')).href);
  let pet;
  await until('pet ready', async () => {
    pet = BrowserWindow.getAllWindows().find(w => !/[?&](settings|projects)=1/.test(w.webContents.getURL()));
    return pet && await js(pet, 'document.querySelector("canvas")?.dataset.ready==="true"');
  });
  pet.webContents.setBackgroundThrottling(false);
  assert.equal((await js(pet, 'window.petBridge.getBootstrap()')).preferences.outfit, 'uniform');
  checks.push('old preferences default to the uniform');
  await capture(pet, 'pet-uniform');
  tray.emit('right-click'); menu.items.find(item => item.label === '设置').click();
  let settings;
  await until('settings ready', async () => {
    settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('settings=1'));
    return settings && await js(settings, '!!document.querySelector("[data-outfit-choice]")');
  });
  settings.webContents.setBackgroundThrottling(false);
  await until('uniform shown as selected', () => pressed(settings, 'uniform'));
  await capture(settings, 'settings-uniform');
  await js(settings, `document.querySelector('[data-outfit-choice="beret"]').click();true`);
  await until('beret selected', () => pressed(settings, 'beret'));
  await until('beret saved', async () => saved().outfit === 'beret');
  await until('pet told', async () => (await js(pet, 'window.petBridge.getBootstrap()')).preferences.outfit === 'beret');
  await sleep(600);
  await js(settings, `document.querySelector('.outfit-setting').scrollIntoView({block:'center'});true`);
  await capture(settings, 'settings-beret');
  await capture(pet, 'pet-beret');
  await js(settings, `document.querySelector('[data-outfit-choice="uniform"]').click();true`);
  await until('back to the uniform', async () => saved().outfit === 'uniform' && await pressed(settings, 'uniform'));
  const layout = await js(settings, `({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    overflows:[...document.querySelectorAll('[data-outfit-choice] span,[data-outfit-choice] small,.outfit-label')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)})`);
  assert(layout.scrollWidth <= layout.width + 1, 'settings page overflows'); assert.deepEqual(layout.overflows, [], 'outfit text overflows');
  checks.push('outfit buttons fit');
  assert.deepEqual(errors, [], 'console errors');
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({checks, errors}, null, 2));
  console.log(JSON.stringify({checks}));
  app.exit(0);
})().catch(error => { console.error(error); console.error(JSON.stringify({checks, errors})); app.exit(1); });
