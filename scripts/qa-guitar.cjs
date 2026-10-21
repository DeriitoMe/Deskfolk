// Clipping check for the guitar pastime. Each sample is rendered twice: once
// normally and once with the guitar forced on top. Any differing pixel means
// something sits in front of the guitar. Only the hands may: both mittens,
// and the picking arm's sleeve, whose forearm rests over the top of the body
// as when playing. They are hidden in both renders; the fretting sleeve,
// face, hair, dress and props must never show through.
//
// Run after a build: npx electron scripts/qa-guitar.cjs [renderer-out-dir]
const {app,BrowserWindow}=require('electron');
const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=join(__dirname,'..'),out=resolve(process.argv.find(a=>a.endsWith('out'))||join(root,'out'));
app.setPath('userData',join(root,'.cache/qa-guitar'));app.commandLine.appendSwitch('force-device-scale-factor','1');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
 await w.loadURL(pathToFileURL(join(out,'renderer/index.html')).href+'?review');
 for(let i=0;i<300&&!await w.webContents.executeJavaScript('!!window.v41Review?.ready');i++)await sleep(100);
 const result=await w.webContents.executeJavaScript(`(()=>{
  const r=window.v41Review.rig,R=r.renderer,prop=r.guitar;r.setPaused(true);r.look.snap(0,0);
  const snap=()=>{const c=document.createElement('canvas');c.width=R.domElement.width;c.height=R.domElement.height;const x=c.getContext('2d');x.drawImage(R.domElement,0,0);return x.getImageData(0,0,c.width,c.height);};
  // Guitar on top: draw everything else, clear depth, then the guitar alone
  // with its own depth test so its parts still occlude each other.
  let top=false;const onTop=on=>{top=on;};
  const render=()=>{if(!top){R.render(r.scene,r.camera);return;}
   const others=r.scene.children.filter(c=>c!==prop.group&&c.visible);
   const shown=prop.group.visible;prop.group.visible=false;R.render(r.scene,r.camera);prop.group.visible=shown;
   for(const c of others)c.visible=false;R.autoClear=false;R.clearDepth();R.render(r.scene,r.camera);R.autoClear=true;for(const c of others)c.visible=true;};
  const mittens=[];r.scene.traverse(o=>{if(o.isMesh&&/^(HandMitten|ArmSleeveR)/.test(o.name.replace(/[._]/g,'')))mittens.push(o);});
  const diff=(a,b)=>{let n=0,first=null;for(let k=0;k<a.data.length;k+=4){
    const d=Math.abs(a.data[k]-b.data[k])+Math.abs(a.data[k+1]-b.data[k+1])+Math.abs(a.data[k+2]-b.data[k+2]);
    if(d>=48){n++;first??=[(k/4)%a.width,Math.floor(k/4/a.width)];}}return {n,first};};
  const check=(label,draw)=>{
   const pose=()=>{draw();for(const o of mittens)o.visible=false;render();};
   pose();const a=snap();onTop(true);pose();const b=snap();onTop(false);
   for(const o of mittens)o.visible=true;
   draw();render();const c=snap();onTop(true);render();const d=snap();onTop(false);
   const stray=diff(a,b);
   return {label,stray:stray.n,first:stray.first,mitten:diff(c,d).n-stray.n};
  };
  const rows=[];
  for(let t=0;t<15.01;t+=.05)rows.push(check('guitar '+t.toFixed(2),()=>r.renderAt('guitar',t)));
  for(let t=.05;t<1.4;t+=.1){
   rows.push(check('idle→guitar '+t.toFixed(2),()=>r.renderTransitionAt('idle','guitar',t)));
   rows.push(check('guitar→idle '+t.toFixed(2),()=>r.renderTransitionAt('guitar','idle',t)));
  }
  return rows;})()`);
 const bad=result.filter(r=>r.stray>0);
 console.log(JSON.stringify({samples:result.length,worst:result.reduce((a,b)=>b.stray>a.stray?b:a),mittenPixels:Math.max(...result.map(r=>r.mitten)),bad:bad.slice(0,12)},null,1));
 assert.equal(bad.length,0,'sleeves, body or props in front of the guitar');
 app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
