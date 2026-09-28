import { execFile } from 'node:child_process';

// Activate the official installed desktop app, preserving its selected chat and native question panel.
// Fixed script: no user/event text is ever interpolated into PowerShell.
export const ACTIVATE_CODEX_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodexWindow {
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr pid);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
$target=Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object {
 $_.MainWindowHandle -ne 0 -and $_.Path -match '(OpenAI\.Codex_|OpenAI\\Codex\\.*\\app\\)'
} | Select-Object -First 1
if (!$target) {
 $pkg=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
 if (!$pkg) { throw 'Official Codex desktop app was not found.' }
 Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\'+$pkg.PackageFamilyName+'!App') -WindowStyle Hidden
 for($i=0;$i -lt 30;$i++) {
  Start-Sleep -Milliseconds 150
  $target=Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -match 'OpenAI\.Codex_' } | Select-Object -First 1
  if($target){break}
 }
}
if(!$target){throw 'Codex has no available desktop window.'}
$handle=$target.MainWindowHandle
if([CodexWindow]::IsIconic($handle)){[void][CodexWindow]::ShowWindowAsync($handle,9)}
else{[void][CodexWindow]::ShowWindowAsync($handle,5)}
[void][CodexWindow]::SetForegroundWindow($handle)
if([CodexWindow]::GetForegroundWindow() -ne $handle) {
 $current=[CodexWindow]::GetCurrentThreadId()
 $foreground=[CodexWindow]::GetWindowThreadProcessId([CodexWindow]::GetForegroundWindow(),[IntPtr]::Zero)
 $attached=$false
 try {
  if($foreground -ne $current){$attached=[CodexWindow]::AttachThreadInput($current,$foreground,$true)}
  [void][CodexWindow]::BringWindowToTop($handle)
  [void][CodexWindow]::SetForegroundWindow($handle)
 } finally {if($attached){[void][CodexWindow]::AttachThreadInput($current,$foreground,$false)}}
}
Start-Sleep -Milliseconds 150
@{ok=([CodexWindow]::GetForegroundWindow() -eq $handle);pid=$target.Id} | ConvertTo-Json -Compress
`;

export function activateCodex(): Promise<{ok:boolean; error?:string}> {
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ACTIVATE_CODEX_SCRIPT,'utf16le').toString('base64')],
    {windowsHide:true,timeout:12000,maxBuffer:16384}, (error,stdout) => {
      if(error) return resolve({ok:false,error:'未能唤起 Codex，请从任务栏打开。'});
      try {const result=JSON.parse(stdout.trim());resolve(result.ok?{ok:true}:{ok:false,error:'请从任务栏切换到 Codex。'});} catch {resolve({ok:false,error:'未能确认 Codex 窗口，请从任务栏打开。'});}
    }));
}
