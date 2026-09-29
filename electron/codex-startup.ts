import {app} from 'electron';
import {execFile,spawn} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const RUN_KEY='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_NAME='DeskfolkCodexCompanion';
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function registry(args:string[]){
 return new Promise<void>((resolve,reject)=>execFile('reg.exe',args,{windowsHide:true,maxBuffer:4096},error=>error?reject(new Error('无法更新桌宠随 Codex 启动的设置。')):resolve()));
}
let queue:Promise<void>=Promise.resolve();
function configure(enabled:boolean){
 return async()=>{
  if(process.platform!=='win32'||!app.isPackaged||process.env.PET_TEST_MODE==='1')return;
  const directory=join(process.env.LOCALAPPDATA||join(app.getPath('home'),'AppData','Local'),'Deskfolk','CodexLauncher');
  const configPath=join(directory,'config.json'),helper=join(directory,'DeskfolkCodexLauncher.exe');
  const packaged=join(process.resourcesPath,'launcher','DeskfolkCodexLauncher.exe');
  mkdirSync(directory,{recursive:true});
  const save=async(active:boolean)=>{
   const temp=configPath+'.tmp',payload=JSON.stringify({enabled:active,executable:process.execPath});
   writeFileSync(temp,payload,{encoding:'utf8',mode:0o600});
   for(let retry=0;;retry++){
    try{renameSync(temp,configPath);break;}
    catch(error){
     if(retry<8){await pause(25);continue;}
     const code=(error as NodeJS.ErrnoException).code;
     if(!['EXDEV','EPERM','EACCES','EEXIST','EBUSY'].includes(code||''))throw error;
     // Match the project's preference writer on Windows filesystems that do
     // not support replacement renames, including encrypted profile folders.
     writeFileSync(configPath,payload,{encoding:'utf8',mode:0o600});
     try{unlinkSync(temp);}catch{}
     break;
    }
   }
  };
  if(!enabled){
   await save(false);
   // reg delete returns nonzero for an absent value; query first to distinguish it.
   const present=await new Promise<boolean>(resolve=>execFile('reg.exe',['query',RUN_KEY,'/v',RUN_NAME],{windowsHide:true,maxBuffer:4096},error=>resolve(!error)));
   if(present)await registry(['delete',RUN_KEY,'/v',RUN_NAME,'/f']);
   await pause(850);return;
  }
  if(!existsSync(packaged))throw Error('随 Codex 启动组件缺失，请重新安装 Deskfolk。');
  const hash=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
  if(!existsSync(helper)||hash(helper)!==hash(packaged)){
   await save(false);await pause(850);copyFileSync(packaged,helper);
  }
  const command='"'+helper+'" --watch "'+configPath+'"';
  if(command.length>260)throw Error('自动启动路径过长，请将 Deskfolk 安装到更短的路径。');
  await registry(['add',RUN_KEY,'/v',RUN_NAME,'/t','REG_SZ','/d',command,'/f']);
  await save(true);
  const child=spawn(helper,['--watch',configPath],{detached:true,stdio:'ignore',windowsHide:true});
  await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
 };
}
export function syncCodexStartup(enabled:boolean){
 const result=queue.catch(()=>{}).then(configure(enabled));queue=result;return result;
}
