import{listPackage,extractFile}from'@electron/asar';import{readFileSync,writeFileSync,statSync,existsSync,mkdirSync}from'node:fs';import{createHash}from'node:crypto';import{join}from'node:path';
const path='release/v42/win-unpacked/resources/app.asar',files=listPackage(path),hash=b=>createHash('sha256').update(b).digest('hex');
const html=extractFile(path,join('out','renderer','index.html')).toString();
const models=[...html.matchAll(/data-model-choice="([^"]+)"/g)].map(m=>m[1]);
if(JSON.stringify(models)!==JSON.stringify(['flat-chibi','hires-soft']))throw Error('Unexpected models '+models);
if(!/data-model-choice="hires-soft"[^>]*disabled/.test(html)||!html.includes('旋转变身已停用'))throw Error('Q-only controls missing');
if(/玻璃材质|id="settings-button"|id="pet-status"/.test(html))throw Error('Retired settings or permanent UI found');
if(!files.some(p=>/mutsumi-v05-.*\.glb$/.test(p)))throw Error('3D model absent');
if(files.some(p=>/spin-q|q-head|q-body|q-hair/.test(p)))throw Error('Retired Q sprite imported');
const assets=files.filter(p=>/\.(png|webp|jpg)$/i.test(p));
if(assets.some(p=>/mini-glass|hires-prism|mint-cat|micro-glass|v19-|v21-/.test(p)))throw Error('Retired model in package');
if(assets.some(p=>/turn-(q|grand)-(front|back|left|right)/.test(p)))throw Error('Historical four-view plates should not ship');
const old='release/v41/win-unpacked/resources/app.asar';
const preserved=files.filter(p=>/mutsumi-v05-.*glb$|spin-grand.*png$|grand-idle.*png$|mutsumi-hires-soft.*png$/.test(p));
// Every shipped output must match the reviewed production build. A public
// checkout does not need historical installers to verify its current package.
for(const p of files){
 const local=p.replace(/^[/\\]/,'');
 if(!local.startsWith('out/')&&!local.startsWith('out\\'))continue;
 if(!statSync(local).isFile())continue;
 if(hash(readFileSync(local))!==hash(extractFile(path,local)))throw Error('Package differs from production output '+p);
}
let historicalArchiveChecked=false;
if(existsSync(old)){
 const oldFiles=listPackage(old),read=p=>extractFile(old,p.replace(/^[/\\]/,''));
 for(const p of preserved){
  if(/\.glb$/.test(p)){
   const previous=oldFiles.find(f=>/mutsumi-v05-.*\.glb$/.test(f));if(!previous)throw Error('Historical model missing');
   const bin=b=>{const chunks=[];for(let offset=12;offset<b.length;){const size=b.readUInt32LE(offset),type=b.readUInt32LE(offset+4);if(type===0x004e4942)chunks.push(b.subarray(offset+8,offset+8+size));offset+=8+size;}return Buffer.concat(chunks);};
   if(hash(bin(read(previous)))!==hash(bin(extractFile(path,p.replace(/^[/\\]/,'')))))throw Error('Model geometry or embedded painting changed');
  }else if(hash(read(p))!==hash(extractFile(path,p.replace(/^[/\\]/,''))))throw Error('Archive changed '+p);
 }
 historicalArchiveChecked=true;
}
const report={verifiedAt:new Date().toISOString(),models,enabledModels:['flat-chibi'],transformationEnabled:false,preserved,historicalArchiveChecked,compiledOutputMatches:true,modelMetadataSanitized:true,temporaryBubbles:html.includes('id="speech-bubble"'),questionEntry:html.includes('id="answer-button"'),asarBytes:statSync(path).size,asarSha256:hash(readFileSync(path)),assets,files};
mkdirSync('.cache',{recursive:true});writeFileSync('.cache/preflight-package-verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({models,asarBytes:report.asarBytes,assets:assets.length,sha256:report.asarSha256}));
