import {MutsumiRig,type RigAction} from './three-rig';
import {presentationPolicy} from '../shared/runtime-policy';
export async function setupReview(){
 document.body.dataset.view='review';document.body.innerHTML=`<main class="review-page"><header><span class="review-eyebrow">WAKABA MUTSUMI · V42</span><h1>小睦的日常</h1><p>实时 3D · 动作与表情预览</p></header><nav class="review-toolbar"><select id="action"></select><button id="play">暂停</button><label>时间 <input id="time" type="range" min="0" max="15" step=".033333" value="0"></label><select id="background"><option value="light">浅色</option><option value="dark">深色</option></select><span id="fps"></span></nav><div id="stage" style="min-height:640px;display:flex;justify-content:center;align-items:flex-end;background:#f5f8f0;border-radius:24px"></div></main>`;
 const names:Record<RigAction,string>={idle:'待机',nap:'小憩',water:'浇水','water-happy':'浇水后的开心',work:'工作','power-work':'全力工作',ask:'疑惑',touch:'触碰',drag:'被拎起',transform:'双形态转场','celebrate-poppers':'庆祝 A · 双手礼花','celebrate-clap':'庆祝 D · 鼓掌星光'};
 const select=document.querySelector<HTMLSelectElement>('#action')!;for(const [v,n] of Object.entries(names)){if(v==='transform'&&!presentationPolicy.transformation)continue;select.add(new Option(n,v));}
 const rig=new MutsumiRig();const stage=document.querySelector<HTMLElement>('#stage')!;stage.append(rig.canvas);rig.canvas.style.cssText='width:512px;height:512px;animation:none;filter:none';
 rig.onViewportChange=()=>{rig.canvas.style.width=rig.canvas.width+'px';rig.canvas.style.height=rig.canvas.height+'px';};
 select.onchange=()=>rig.setAction(select.value as RigAction);let paused=false;
 document.querySelector<HTMLButtonElement>('#play')!.onclick=e=>{paused=!paused;rig.setPaused(paused);(e.target as HTMLElement).textContent=paused?'继续':'暂停';};
 document.querySelector<HTMLInputElement>('#time')!.oninput=e=>{paused=true;rig.setPaused(true);rig.renderAt(select.value as RigAction,Number((e.target as HTMLInputElement).value));};
 document.querySelector<HTMLSelectElement>('#background')!.onchange=e=>stage.style.background=(e.target as HTMLSelectElement).value==='dark'?'#263237':'#f5f8f0';
 await rig.ready;rig.onTransientEnd=()=>rig.setAction('idle');
 stage.onpointermove=e=>{const b=rig.canvas.getBoundingClientRect();rig.setLookTarget(Math.tanh((e.clientX-b.left-b.width/2)/b.width),Math.tanh((e.clientY-b.top-b.height/2)/b.height));};
 (window as any).v41Review={rig,ready:true};setInterval(()=>{const a=rig.frameIntervals.slice(-120);document.querySelector('#fps')!.textContent=a.length?(1000*a.length/a.reduce((x,y)=>x+y,0)).toFixed(1)+' FPS':'';},1000);
}
