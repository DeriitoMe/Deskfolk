const {execFileSync}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const {join,resolve}=require('node:path');
if(process.platform!=='win32')process.exit(0);
const root=resolve(__dirname,'..'),output=join(root,'.cache/codex-launcher');
mkdirSync(output,{recursive:true});
const framework=join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319');
execFileSync(join(framework,'csc.exe'),['/nologo','/target:winexe','/optimize+','/debug-',
 '/r:System.Web.Extensions.dll','/out:'+join(output,'DeskfolkCodexLauncher.exe'),join(root,'scripts/CodexLauncher.cs')],{stdio:'inherit',windowsHide:true});
console.log('Built lightweight Windows Codex launcher');
