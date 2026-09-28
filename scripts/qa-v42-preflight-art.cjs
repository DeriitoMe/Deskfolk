// Fixed-time pixel baseline; runs separately after the memory/FPS benchmark.
const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');
const {join}=require('node:path');const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync}=require('node:fs');const {createHash}=require('node:crypto');
const root=join(__dirname,'..'),label=process.env.QA_PERF_LABEL||'before';
const cache=join(root,'.cache'),reviewHtml=process.env.QA_REVIEW_HTML||join(root,'out/renderer/index.html');
const output=join(cache,'preflight-art-'+label+'-'+Date.now());mkdirSync(output,{recursive:true});
app.setPath('userData',join(output,'user-data'));app.commandLine.appendSwitch('disable-renderer-backgrounding');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 await app.whenReady();const w=new BrowserWindow({show:false,width:800,height:800,webPreferences:{offscreen:true,backgroundThrottling:false}});
 await w.loadURL(pathToFileURL(reviewHtml).href+'?review');const js=s=>w.webContents.executeJavaScript(s);
 for(let i=0;i<150 && !await js('!!window.v41Review?.ready');i++)await sleep(100);assert(await js('!!window.v41Review?.ready'));
 await js('window.v41Review.rig.setPaused(true);true');const entries=[];
 const capture=async(name,expression)=>{const result=await js(`(()=>{const r=window.v41Review.rig;r.look.snap(0,0);${expression};return {png:r.canvas.toDataURL(),pose:r.exportPose(),resources:{...r.renderer.info.memory}}})()`);const bytes=Buffer.from(result.png.split(',')[1],'base64'),path=join(output,name+'.png');writeFileSync(path,bytes);delete result.png;entries.push({name,path,pngSha256:createHash('sha256').update(bytes).digest('hex'),...result});};
 for(const action of ['idle','nap','water','water-happy','work','power-work','ask','touch','drag'])for(const t of [0,.65,2])await capture(action+'-'+t,`r.renderAt('${action}',${t})`);
 for(const action of ['idle','work'])for(const [name,x,y] of [['center',0,0],['left',-1,0],['right',1,0],['up',0,-1],['down',0,1],['up-left',-1,-1],['down-right',1,1]])await capture(action+'-gaze-'+name,`r.look.snap(${x},${y});r.renderAt('${action}',2)`);
 for(const [from,to] of [['idle','work'],['work','idle'],['work','power-work'],['power-work','work'],['idle','nap'],['nap','water'],['idle','water'],['water','idle'],['idle','drag'],['drag','idle'],['work','ask'],['ask','work'],['drag','work'],['drag','ask'],['water','work'],['nap','work']])for(const t of [.15,.45,.85])await capture(from+'-to-'+to+'-'+t,`r.renderTransitionAt('${from}','${to}',${t})`);
 const report={passed:true,label,output,count:entries.length,entries};const path=join(cache,'preflight-art-'+label+'.json');writeFileSync(path,JSON.stringify(report,null,2));console.log('PASS '+JSON.stringify({path,count:entries.length,output}));app.quit();
})().catch(error=>{console.error(error);app.exit(1)});
