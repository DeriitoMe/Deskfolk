const {app,BrowserWindow}=require('electron');
const {join}=require('node:path');const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync}=require('node:fs');const assert=require('node:assert/strict');
const root=join(__dirname,'..'),out=join(root,'assets/characters/wakaba-mutsumi/v42-motion/preview');
mkdirSync(out,{recursive:true});app.setPath('userData',join(root,'.cache/v42-render-qa'));
app.commandLine.appendSwitch('force-device-scale-factor','1');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});w.webContents.setFrameRate(60);
 w.webContents.on('console-message',(_e,_l,m)=>console.log('PAGE',m));
 await w.loadURL(pathToFileURL(join(root,'out/renderer/index.html')).href+'?review');
 for(let i=0;i<300&&!await w.webContents.executeJavaScript('!!window.v41Review?.ready');i++)await sleep(100);
 assert(await w.webContents.executeJavaScript('!!window.v41Review?.ready'));
 const capture=async(name,expression)=>{const url=await w.webContents.executeJavaScript(`(()=>{const r=window.v41Review.rig;r.setPaused(true);${expression};return r.canvas.toDataURL()})()`);writeFileSync(join(out,name+'.png'),Buffer.from(url.split(',')[1],'base64'));};
 for(const [name,a,t] of [['idle','idle',0],['touch','touch',.7],['drag-passive','drag',.8],['drag-effort-1','drag',1.65],['drag-effort-2','drag',2.33],['drag-relaxed','drag',3.5],['water','water',2],['work','work',1.5],['power-work','power-work',1.5],['nap','nap',1.2],['ask','ask',1.2]])await capture(name,`r.look.snap(0,0);r.renderAt('${a}',${t})`);
 for(const t of [0,.2,.45,.75,1.1,1.5,2])await capture('water-entry-'+t,`r.look.snap(0,0);r.renderTransitionAt('idle','water',${t})`);
 for(const dx of [-12,12])await capture('drag-inertia-'+dx,`r.velocity=${dx};r.renderAt('drag',.8);r.velocity=0`);
 const result=await w.webContents.executeJavaScript(`(()=>{
 const r=window.v41Review.rig,frames=[];r.look.snap(0,0);
 for(let f=0;f<=138;f++){r.renderAt('drag',f/30);frames.push({time:f/30,...r.exportPose().pose});}
 const inertias=[];for(const dx of [-12,0,12]){r.velocity=dx;r.renderAt('drag',.8);const h=r.control('CTRL_Head'),b=r.control('CTRL_Body');const hp=h.getWorldPosition(h.position.clone()),bp=b.getWorldPosition(b.position.clone());inertias.push({dx,headRelativeX:hp.x-bp.x});}r.velocity=0;
 const gaze={};for(const action of ['idle','work','power-work','water','nap','ask','drag']){r.look.snap(1,.6);r.renderAt(action,2);gaze[action]=r.exportPose();}r.look.snap(0,0);
 r.renderAt('idle',0);r.setAction('transform');const guardedAction=r.action;
 return {frames,inertias,gaze,guardedAction,eyeStrokeWidth:20,normalEyeWidth:70,eyeStrokeSpan:102,workScrollPixelsPerSecond:[82,99,116]};})()`);
 let peaks=0;for(let i=1;i<result.frames.length-1;i++)if(result.frames[i].kick>result.frames[i-1].kick&&result.frames[i].kick>=result.frames[i+1].kick)peaks++;
 assert.equal(peaks,2);assert.equal(result.guardedAction,'idle');
 assert(result.inertias[0].headRelativeX>result.inertias[1].headRelativeX);assert(result.inertias[2].headRelativeX<result.inertias[1].headRelativeX);
 for(const action of ['idle','work'])assert.equal(result.gaze[action].pose.gaze,1);
 for(const action of ['power-work','water','nap','ask','drag'])assert.equal(result.gaze[action].pose.gaze,0);
 for(const sample of Object.values(result.gaze))for(const c of sample.controls)assert(c.scale.every(v=>Math.abs(v-1)<.00001),'rigid scale '+c.name);
 await w.webContents.executeJavaScript('window.v41Review.rig.renderAt("idle",0);window.v41Review.rig.setPaused(false)');await sleep(1100);
 await w.webContents.executeJavaScript('window.v41Review.rig.frameIntervals=[];window.v41Review.rig.setAction("water")');await sleep(2600);
 const intervals=await w.webContents.executeJavaScript('window.v41Review.rig.frameIntervals');
 result.waterEntryTiming={count:intervals.length,mean:intervals.reduce((a,b)=>a+b,0)/intervals.length,max:Math.max(...intervals),over50ms:intervals.filter(n=>n>50).length};
 const board=await w.webContents.executeJavaScript(`(()=>{const r=window.v41Review.rig;r.setPaused(true);r.look.snap(0,0);const c=document.createElement('canvas');c.width=1200;c.height=880;const x=c.getContext('2d');x.fillStyle='#e8eee7';x.fillRect(0,0,1200,880);x.fillStyle='#344c40';x.font='600 30px Microsoft YaHei';x.fillText('若叶睦 V42 · 动作预览',35,49);const cells=[['drag',.8,'被拎起 · 放松'],['drag',1.65,'第一次反抗'],['drag',2.33,'第二次反抗'],['touch',.7,'点击表情'],['work',1.5,'代码式工作流光'],['water',2,'浇水']];cells.forEach(([a,t,label],i)=>{const px=20+i%3*395,py=80+Math.floor(i/3)*390;x.fillStyle='#f8faf5';x.fillRect(px,py,375,370);r.renderAt(a,t);x.drawImage(r.canvas,px+22,py+4,330,330);x.fillStyle='#344c40';x.font='19px Microsoft YaHei';x.fillText(label,px+20,py+352);});return c.toDataURL()})()`);
 writeFileSync(join(out,'V42-overview.png'),Buffer.from(board.split(',')[1],'base64'));
 writeFileSync(join(out,'render-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({peaks,inertias:result.inertias,waterEntryTiming:result.waterEntryTiming}));app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
