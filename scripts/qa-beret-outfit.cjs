// Renders every flat-chibi action in both outfits from the production build,
// checks that the beret is not cut off at the top of the normal 512 view, and
// times frames with each outfit. Output: .cache/beret-outfit-qa/.
// Run after `npm run build`: npx electron scripts/qa-beret-outfit.cjs
const {app, BrowserWindow} = require('electron');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const {mkdirSync, writeFileSync} = require('node:fs');
const assert = require('node:assert/strict');
const root = join(__dirname, '..'), out = join(root, '.cache/beret-outfit-qa');
mkdirSync(out, {recursive: true}); app.setPath('userData', join(root, '.cache/beret-outfit-qa-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ACTIONS = [['idle', 0], ['nap', 1.2], ['water', 2], ['water-happy', 1], ['work', 1.5], ['power-work', 1.5], ['touch', .7], ['tearful', 1],
  ['drag', .8], ['drag', 1.65], ['drag', 2.33], ['ask', 1.2], ['dizzy', 1], ['read-paper', 2], ['guitar', 2], ['guitar-solo', 2],
  ['celebrate-poppers', 1], ['celebrate-clap', 1], ['claude-type', 1], ['claude-write', 1], ['quota-board', 2]];

app.whenReady().then(async () => {
  const w = new BrowserWindow({show: false, width: 1100, height: 1300, webPreferences: {offscreen: true, backgroundThrottling: false}});
  w.webContents.setFrameRate(60);
  await w.loadURL(pathToFileURL(join(root, 'out/renderer/index.html')).href + '?review');
  for (let i = 0; i < 300 && !await w.webContents.executeJavaScript('!!window.v41Review?.ready'); i++) await sleep(100);
  const js = code => w.webContents.executeJavaScript(code);
  assert(await js('!!window.v41Review?.ready'), 'review rig did not load');
  const result = {frames: [], topClipped: {}, timing: {}};
  for (const outfit of ['uniform', 'beret']) {
    for (const [action, t] of ACTIONS) {
      const shot = await js(`(()=>{const r=window.v41Review.rig;r.setPaused(true);r.setOutfit('${outfit}');r.look.snap(0,0);r.renderAt('${action}',${t});
        const c=r.canvas,x=c.getContext('2d');const top=c.height-512;let clipped=0;
        let bottom=0;const normal=c.width===1024&&c.height===768&&c.dataset.wide!=='true'&&!['quota-board'].includes(r.action);
        if(normal){const row=x.getImageData(256,top,512,1).data;for(let i=3;i<row.length;i+=4)if(row[i]>8)clipped++;
          const low=x.getImageData(256,c.height-1,512,1).data;for(let i=3;i<low.length;i+=4)if(low[i]>8)bottom++;}
        return {url:c.toDataURL(),clipped,bottom,w:c.width,h:c.height,normal};})()`);
      const name = `${outfit}-${action}-${t}.png`;
      writeFileSync(join(out, name), Buffer.from(shot.url.split(',')[1], 'base64'));
      result.frames.push({outfit, action, t, canvas: [shot.w, shot.h], normalView: shot.normal, topRowPixels: shot.clipped, bottomRowPixels: shot.bottom});
      if (shot.clipped || shot.bottom) result.topClipped[`${outfit} ${action} ${t}`] = [shot.clipped, shot.bottom];
    }
    // Same frame many times: render plus a GPU sync, so the number reflects the extra geometry.
    result.timing[outfit] = await js(`(()=>{const r=window.v41Review.rig;r.setOutfit('${outfit}');const gl=r.renderer.getContext();
      for(let i=0;i<20;i++)r.renderAt('idle',i/30);gl.finish();const t0=performance.now();
      for(let i=0;i<240;i++){r.renderAt('idle',i/30);gl.finish();}return (performance.now()-t0)/240;})()`);
  }
  await js(`window.v41Review.rig.setOutfit('uniform')`);
  writeFileSync(join(out, 'qa-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({edgeClipped: result.topClipped, timingMs: result.timing}));
  assert.deepEqual(result.topClipped, {}, 'a normal-view frame touches the top or bottom edge');
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
