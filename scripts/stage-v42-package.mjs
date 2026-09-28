import {readFileSync,writeFileSync,mkdirSync,cpSync,rmSync} from 'node:fs';import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';
// A clean app directory avoids touching pre-existing malformed path names at the workspace root.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=resolve(root,'.cache/v42-package');mkdirSync(dir,{recursive:true});
const stagedOutput=resolve(dir,'out');
if(stagedOutput!==resolve(root,'.cache/v42-package/out'))throw Error('Unexpected staging location');
// Only disposable compiled output inside this verified staging path is replaced.
rmSync(stagedOutput,{recursive:true,force:true});
cpSync(resolve(root,'out'),dir+'/out',{recursive:true});
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const version=JSON.parse(readFileSync(resolve(root,'node_modules/electron/package.json'),'utf8')).version;
writeFileSync(dir+'/package.json',JSON.stringify({name:pkg.name,version:pkg.version,private:true,type:'module',main:'out/main/index.js',description:pkg.description,author:'Local developer',build:{...pkg.build,electronVersion:version,npmRebuild:false,directories:{output:resolve(root,'release/v42')}}},null,2));
console.log('Staged V42 application using Electron '+version);
