// Clipping check for the reading action. Each sample is rendered twice: once
// normally and once with the newspaper forced on top. Any pixel that differs
// means something sits in front of the sheet. Only the mitten tips may pinch
// the side edges in front of it, so the mittens are hidden in both renders;
// sleeves and cuffs, face, hair, dress and props must never show through.
//
// Run after a build: npx electron scripts/qa-read-paper.cjs [renderer-out-dir]
const {app,BrowserWindow}=require('electron');
const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=join(__dirname,'..'),out=resolve(process.argv.find(a=>a.endsWith('out'))||join(root,'out'));
app.setPath('userData',join(root,'.cache/qa-read-paper'));app.commandLine.appendSwitch('force-device-scale-factor','1');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
 await w.loadURL(pathToFileURL(join(out,'renderer/index.html')).href+'?review');
 for(let i=0;i<300&&!await w.webContents.executeJavaScript('!!window.v41Review?.ready');i++)await sleep(100);
 const result=await w.webContents.executeJavaScript(`(()=>{
  const r=window.v41Review.rig,R=r.renderer,paper=r.newspaper;r.setPaused(true);r.look.snap(0,0);
  const snap=()=>{const c=document.createElement('canvas');c.width=R.domElement.width;c.height=R.domElement.height;const x=c.getContext('2d');x.drawImage(R.domElement,0,0);return x.getImageData(0,0,c.width,c.height);};
  const onTop=on=>{paper.group.traverse(o=>{if(o.isMesh){o.renderOrder=on?999:0;o.material.depthTest=!on;}});};
  const mittens=[];r.scene.traverse(o=>{if(o.isMesh&&/^HandMitten/.test(o.name.replace(/[._]/g,'')))mittens.push(o);});
  const diff=(a,b)=>{let n=0,first=null;for(let k=0;k<a.data.length;k+=4){
    const d=Math.abs(a.data[k]-b.data[k])+Math.abs(a.data[k+1]-b.data[k+1])+Math.abs(a.data[k+2]-b.data[k+2]);
    if(d>=48){n++;first??=[(k/4)%a.width,Math.floor(k/4/a.width)];}}return {n,first};};
  const check=(label,draw)=>{
   const hidden=new Map(mittens.map(o=>[o,o.visible]));
   // apply() resets the arm meshes' visibility only through their parents, so
   // hide them after each draw has posed the rig, then draw the frame again.
   const pose=()=>{draw();for(const o of mittens)o.visible=false;R.render(r.scene,r.camera);};
   pose();const a=snap();onTop(true);pose();const b=snap();onTop(false);
   for(const [o,v] of hidden)o.visible=v;
   draw();const c=snap();onTop(true);draw();const d=snap();onTop(false);
   const stray=diff(a,b),gripped=diff(c,d).n-stray.n;
   return {label,stray:stray.n,first:stray.first,mitten:gripped};
  };
  const rows=[];
  // One full page at 50 Hz, so the 0.1 s flick between pages is covered.
  for(let t=0;t<6.25;t+=.02)rows.push(check('read '+t.toFixed(2),()=>r.renderAt('read-paper',t)));
  for(const from of ['idle','work','water'])for(let t=.1;t<1.6;t+=.15)rows.push(check(from+'→read '+t.toFixed(2),()=>r.renderTransitionAt(from,'read-paper',t)));
  return rows;})()`);
 const bad=result.filter(r=>r.stray>0);
 console.log(JSON.stringify({samples:result.length,worst:result.reduce((a,b)=>b.stray>a.stray?b:a),mittenPixels:Math.max(...result.map(r=>r.mitten)),bad:bad.slice(0,12)},null,1));
 assert.equal(bad.length,0,'sleeves, body or props in front of the newspaper');
 app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
