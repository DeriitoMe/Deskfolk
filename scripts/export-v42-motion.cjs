const{app,BrowserWindow}=require('electron');const{join}=require('node:path');const{pathToFileURL}=require('node:url');const{mkdirSync,writeFileSync}=require('node:fs');
const root=join(__dirname,'..'),asset=join(root,'assets/characters/wakaba-mutsumi/v42-motion');
app.setPath('userData',join(root,'.cache/v42-motion-export'));const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clips=[['idle',4.3],['drag',4.6],['drag-release',1.2],['touch',1.15],['water-entry',2.2],['water',3.8],['water-happy',3.6],['work',5.4]];
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});w.webContents.setFrameRate(60);
 await w.loadURL(pathToFileURL(join(root,'out/renderer/index.html')).href+'?review');
 for(let i=0;i<300&&!await w.webContents.executeJavaScript('!!window.v41Review?.ready');i++)await sleep(100);
 const js=s=>w.webContents.executeJavaScript(s);await js('window.v41Review.rig.setPaused(true)');const frames=[];let frame=1;
 for(const [action,duration] of clips){
  const dir=join(asset,'source/review-frames',action);mkdirSync(dir,{recursive:true});const start=frame,count=Math.round(duration*30);
  for(let i=0;i<count;i++){
   const t=i/30,call=action==='water-entry'?`r.renderTransitionAt('idle','water',${t})`:action==='drag-release'?`r.renderTransitionAt('drag','idle',${t})`:`r.renderAt('${action}',${action==='water'?t+2:t})`;
   const v=await js(`(()=>{const r=window.v41Review.rig;r.look.snap(0,0);${call};const c=document.createElement('canvas');c.width=c.height=256;c.getContext('2d').drawImage(r.canvas,0,0,256,256);return {state:r.exportPose(),png:c.toDataURL()}})()`);
   frames.push({frame:frame++,action,t,...v.state});writeFileSync(join(dir,String(i+1).padStart(4,'0')+'.png'),Buffer.from(v.png.split(',')[1],'base64'));
  }
  clips.find(c=>c[0]===action).push(start,frame-1);console.log('CAPTURED',action,count);
 }
 const props=await js('(async()=>Array.from(new Uint8Array(await window.v41Review.rig.exportProps())))()');writeFileSync(join(asset,'source/watering-props.glb'),Buffer.from(props));
 writeFileSync(join(asset,'source/motion-30fps.json'),JSON.stringify({fps:30,clips,frames}));
 writeFileSync(join(asset,'verification/motion-export.json'),JSON.stringify({fps:30,clips,totalFrames:frames.length,rigid:frames.every(f=>f.controls.every(c=>c.scale.every(n=>Math.abs(n-1)<1e-5)))},null,2));
 app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
