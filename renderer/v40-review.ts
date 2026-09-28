import { MutsumiRig, type RigAction } from './mutsumi-rig';
const actions: [RigAction,string,string][] = [
  ['idle','安静待机','呼吸、眼神与发梢轻微滞后'],['nap','小憩','15 秒小憩 · 深蓝 Zzz 向右上飘'],
  ['water-happy','浇水后的满足','开心眼睛 · 旋转花朵 · 暖色柔光'],['water','给黄瓜浇水','侧身、双手持壶、并脚与透视花盆'],['work','认真工作','分脚、手部用力，浅金色自上而下流动'],
  ['ask','等你回答','向左转脸，经典眼睛与圆润问号'],['touch','护住脸颊','>< 表情，双手短暂抬向脸颊'],
  ['drag','被拎起来','衣服后背受力，后背受力 · 手脚挣扎 · 释放恢复'],['transform','转身切换','连续旋转 · 白光 · 呼吸展示 2 秒 · 回到 Q 版']
];
export async function setupReview(){
  document.body.dataset.view='review';document.body.replaceChildren();
  document.body.innerHTML=`<main class="review-page"><header><span class="review-eyebrow">WAKABA MUTSUMI · V40</span><h1>小睦的日常</h1><p>基于最终 Q 版原稿 · 独立部件动画评审</p></header><nav class="review-toolbar"><label>背景 <select id="review-bg"><option value="light">浅色</option><option value="dark">深色</option><option value="desktop">桌面</option></select></label><label>主体尺寸 <select id="review-size"><option value="150">较小 · 150 px</option><option value="195" selected>默认 · 195 px</option><option value="270">较大 · 270 px</option></select></label><label>播放 <select id="review-fps"><option value="60">60 FPS</option><option value="30">30 FPS</option></select></label><button id="review-pause">暂停</button><span id="review-measured"></span></nav><section class="review-grid"></section><footer>点击卡片可重播。主体尺寸按当前屏幕物理像素换算；浏览器缩放会影响观感。转场演示结束后恢复 Q 版。</footer></main>`;
  const grid=document.querySelector<HTMLElement>('.review-grid')!;
  const rigs:MutsumiRig[]=[];
  for(const [action,title,detail] of actions){
    const card=document.createElement('article');card.className='review-card';card.dataset.action=action;
    const stage=document.createElement('div');stage.className='review-stage';
    const rig=new MutsumiRig();rig.canvas.removeAttribute('data-drag-handle');rig.setAction(action);rigs.push(rig);
    if(action==='touch'||action==='transform')rig.onTransientEnd=()=>rig.setAction('idle');
    stage.append(rig.canvas);const h=document.createElement('h2');h.textContent=title;const p=document.createElement('p');p.textContent=detail;card.append(stage,h,p);grid.append(card);
    card.addEventListener('click',()=>{rig.setAction('idle');rig.setAction(action);});
  }
  const resize=()=>document.documentElement.style.setProperty('--review-art-size',`${Number((document.querySelector('#review-size') as HTMLSelectElement).value)*512/449/devicePixelRatio}px`);
  document.querySelector('#review-size')!.addEventListener('change',resize);resize();
  document.querySelector('#review-bg')!.addEventListener('change',event=>document.body.dataset.background=(event.target as HTMLSelectElement).value);
  document.querySelector('#review-fps')!.addEventListener('change',event=>rigs.forEach(r=>r.frameLimit=Number((event.target as HTMLSelectElement).value) as 30|60));
  let paused=false;document.querySelector('#review-pause')!.addEventListener('click',event=>{paused=!paused;rigs.forEach(r=>r.setPaused(paused));(event.target as HTMLButtonElement).textContent=paused?'继续':'暂停';});
  await Promise.all(rigs.map(r=>r.ready));
  document.addEventListener('pointermove',event=>rigs.forEach(r=>{const b=r.canvas.getBoundingClientRect();r.setLookTarget(Math.tanh((event.clientX-b.left-b.width/2)/(b.width*1.5)),Math.tanh((event.clientY-b.top-b.height/2)/(b.width*1.65)));}));
  const transitions: [RigAction,RigAction,string][]=[['nap','water','小憩 → 准备 → 浇水'],['nap','work','小憩 → 站稳 → 工作'],['drag','idle','挣扎 → 释放 → 恢复'],['water','ask','放下水壶 → 等待回答']];
  const nav=document.createElement('nav');nav.className='review-toolbar';
  for(const [from,to,label] of transitions){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{const r=rigs[0];r.setAction(from);setTimeout(()=>r.setAction(to),1800);};nav.append(b);}
  grid.before(nav);
  // Expose only in the dedicated local review page for reproducible captures/exports.
  (window as unknown as {v40Review:unknown}).v40Review={rigs,actions,ready:true};
  setInterval(()=>{const times=rigs[0].frameIntervals.slice(-120);const fps=times.length?1000/(times.reduce((a,b)=>a+b,0)/times.length):0;
    document.querySelector('#review-measured')!.textContent=`本机采样 ${fps.toFixed(1)} FPS`;},1000);
}
