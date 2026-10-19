// Lays out README promo images from qa-v42-promo-capture.cjs output.
// Usage: electron scripts/qa-v42-promo-compose.cjs <.cache/promo-*/>
// Writes docs/images/promo/deskfolk-hero.png and deskfolk-features.png.
const { app, BrowserWindow } = require('electron');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const root = resolve(__dirname, '..'), source = resolve(process.argv[process.argv.length - 1]);
const out = join(root, 'docs/images/promo');
mkdirSync(out, { recursive: true });
const url = path => pathToFileURL(path).href;
const art = name => url(join(source, 'frames', name + '-art.png'));
const font = url(join(root, 'renderer/fonts/ChillRoundF-Regular.ttf'));

const style = `
@font-face{font-family:ChillRoundF;src:url("${font}")}
*{box-sizing:border-box;margin:0}
body{font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;color:#24402c;background:#f3f6ef}
.pet{position:relative;width:430px;height:478px;overflow:hidden}
.pet img{position:absolute;left:-300px;top:-270px;width:1024px;height:768px}
.bubble{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
 width:248px;height:150px;border:2.5px solid #6a8d63;border-radius:50%;background:#fbfdf8;
 box-shadow:0 5px 14px #3c5a2e26;font-family:ChillRoundF,"YouYuan",sans-serif;padding:0 26px}
.bubble b{font-size:23px;font-weight:700;color:#1f4d35;line-height:1.35}
.bubble small{font-size:14px;color:#658368;margin-bottom:4px}
.dot{position:absolute;border:2px solid #6a8d63;border-radius:50%;background:#fbfdf8}
`;
// A thought bubble up and to the left of the head, like the pet's own.
const bubble = (x, y, message, kicker = '', scale = 1) => !message ? '' : `
 <div style="position:absolute;left:${x}px;top:${y}px;transform:scale(${scale});transform-origin:left top">
  <div class="bubble" style="left:0;top:0">${kicker ? `<small>${kicker}</small>` : ''}<b>${message}</b></div>
  <div class="dot" style="left:166px;top:156px;width:18px;height:14px"></div>
  <div class="dot" style="left:184px;top:178px;width:11px;height:9px"></div>
  <div class="dot" style="left:196px;top:193px;width:7px;height:6px"></div>
 </div>`;

const hero = `<!doctype html><html><head><meta charset="utf-8"><style>${style}
body{width:1600px;height:800px;overflow:hidden;background:linear-gradient(135deg,#f6f9f1 0%,#e9f1e1 100%)}
.copy{position:absolute;left:110px;top:150px;width:720px}
.brand{display:flex;align-items:center;gap:18px;font-size:30px;font-weight:700;color:#4f7046;letter-spacing:.5px}
.brand i{display:block;width:12px;height:12px;border-radius:50%;background:#8faa77}
h1{font-size:76px;line-height:1.15;margin:26px 0 30px;font-weight:800;color:#1f3a26}
p{font-size:30px;line-height:1.65;color:#4a6450}
.chips{display:flex;gap:14px;margin-top:44px}
.chips span{padding:10px 22px;border-radius:999px;background:#ffffffcc;border:1.5px solid #c9d9bd;font-size:22px;font-weight:600;color:#3d5c40}
.stage{position:absolute;right:120px;bottom:0;width:560px;height:700px}
.glow{position:absolute;left:70px;bottom:40px;width:420px;height:90px;border-radius:50%;background:radial-gradient(#cfdfc2 0%,#cfdfc200 70%)}
</style></head><body>
<div class="copy">
 <div class="brand"><i></i>Deskfolk</div>
 <h1>住在桌面上的<br>若叶睦</h1>
 <p>陪你等 AI 编程助手干活：开始工作、<br>需要你回答、任务完成，她都会告诉你。</p>
 <div class="chips"><span>Codex</span><span>Claude Code</span><span>DeepSeek Harness</span></div>
</div>
<div class="stage"><div class="glow"></div>
 <div class="pet" style="position:absolute;left:65px;bottom:30px;transform:scale(1.25);transform-origin:bottom center"><img src="${art('work')}"></div>
 ${bubble(-40, 60, '祥，工作', '', 1.25)}
</div>
</body></html>`;

const cards = [
  ['work', '开始工作', '眼睛亮起代码流光', '祥，工作'],
  ['type', '跑命令', '敲键盘，旁边弹出小终端'],
  ['write', '改文件', '拿出笔记本写字'],
  ['ask', '等你回复', '有提问或权限请求时提醒你', '唔，出现问题了', '等你回复'],
  ['celebrate-4', '任务完成', '确认成功后拍手庆祝', '可以休息了……'],
  ['power-work', '多项目同时进行', '两个以上项目时全力工作', '！！！！！'],
];
const features = `<!doctype html><html><head><meta charset="utf-8"><style>${style}
body{width:1600px;height:1262px;overflow:hidden;padding:70px 80px}
h2{font-size:46px;font-weight:800;color:#1f3a26}
.sub{font-size:24px;color:#5b7560;margin:14px 0 44px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}
.card{position:relative;height:490px;border-radius:28px;background:#fff;border:1.5px solid #e0e8d8;overflow:hidden}
.card .pet{position:absolute;left:50%;bottom:92px;margin-left:-185px;transform:scale(.66);transform-origin:bottom center}
.label{position:absolute;left:28px;bottom:22px;right:28px}
.label b{display:block;font-size:26px;color:#24402c}
.label span{font-size:19px;color:#6a8270}
.card .bubble-wrap{position:absolute;left:24px;top:20px}
</style></head><body>
<h2>她会告诉你 Agent 在做什么</h2>
<div class="sub">Codex、Claude Code 和 DeepSeek Harness 的真实工作状态，都会变成桌宠的动作和气泡。</div>
<div class="grid">${cards.map(([frame, title, text, message, kicker]) => `
 <div class="card">
  <div class="pet"><img src="${art(frame)}"></div>
  <div class="bubble-wrap">${bubble(0, 0, message, kicker, .86)}</div>
  <div class="label"><b>${title}</b><span>${text}</span></div>
 </div>`).join('')}
</div>
</body></html>`;

async function render(html, width, height, name) {
  const page = join(source, name + '.html');
  writeFileSync(page, html);
  const window = new BrowserWindow({ width, height, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  window.webContents.setZoomFactor(1);
  await window.loadURL(url(page));
  await window.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode())))');
  await new Promise(done => setTimeout(done, 400));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width, height });
  writeFileSync(join(out, name + '.png'), image.toPNG());
  window.destroy();
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  await render(hero, 1600, 800, 'deskfolk-hero');
  await render(features, 1600, 1262, 'deskfolk-features');
  console.log(JSON.stringify({ passed: true, output: out }));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
