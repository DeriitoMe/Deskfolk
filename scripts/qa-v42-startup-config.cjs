const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const ts=require('typescript');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache/companion-polish-checks');
const profile=path.join(root,'.cache','sc-'+Date.now());fs.mkdirSync(profile,{recursive:true});
const source=fs.readFileSync(path.join(root,'electron/codex-startup.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let renameFailures=0,registered=false,spawned=0;
const filesystem={...fs,renameSync(){renameFailures++;throw Object.assign(new Error('Simulated Windows replacement restriction'),{code:'EACCES'});}};
const children={
 execFile(_command,args,_options,callback){
  if(args[0]==='query'){setImmediate(()=>callback(registered?null:new Error('Absent value')));return;}
  if(args[0]==='add')registered=true;
  if(args[0]==='delete')registered=false;
  setImmediate(()=>callback(null));
 },
 spawn(){spawned++;const child=new EventEmitter();child.unref=()=>{};setImmediate(()=>child.emit('spawn'));return child;}
};
const moduleObject={exports:{}};
const context={module:moduleObject,exports:moduleObject.exports,Buffer,setTimeout,
 process:{platform:'win32',env:{LOCALAPPDATA:profile},execPath:path.join(profile,'PetProbe.exe'),resourcesPath:path.join(root,'release/v42/win-unpacked/resources')},
 require(name){if(name==='electron')return {app:{isPackaged:true,getPath:()=>profile}};if(name==='node:fs')return filesystem;if(name==='node:child_process')return children;return require(name);}
};
vm.runInNewContext(compiled,context,{filename:'codex-startup.ts'});
(async()=>{
 await moduleObject.exports.syncCodexStartup(true);
 const configFile=path.join(profile,'Deskfolk/CodexLauncher/config.json');
 assert.equal(JSON.parse(fs.readFileSync(configFile,'utf8')).enabled,true);assert.equal(registered,true);assert.equal(spawned,1);
 assert(fs.existsSync(path.join(profile,'Deskfolk/CodexLauncher/DeskfolkCodexLauncher.exe')));
 await moduleObject.exports.syncCodexStartup(false);
 assert.equal(JSON.parse(fs.readFileSync(configFile,'utf8')).enabled,false);assert.equal(registered,false);assert.equal(spawned,1);
 assert(!fs.existsSync(configFile+'.tmp'));
 const report={passed:true,windowsRenameFailuresHandled:renameFailures,enabledConfigWritten:true,disabledConfigWritten:true,registrationRemovedWhenDisabled:true,temporaryConfigCleaned:true,method:'Production startup controller with isolated files, injected Windows rename failures, and simulated registry/process launch'};
 fs.writeFileSync(path.join(output,'startup-config.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
