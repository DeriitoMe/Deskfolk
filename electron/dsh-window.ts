import { execFile } from 'node:child_process';

// Activate the DSH desktop app; the same fixed script shape as Codex, since both
// are Electron apps whose main window needs an explicit foreground request.
// Fixed script: no user/event text is ever interpolated into PowerShell.
export const ACTIVATE_DSH_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshWindow {
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
$target=Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (!$target) {
 foreach ($candidate in @(
  (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
  (Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe')
 )) {
  if (Test-Path -LiteralPath $candidate) { Start-Process -FilePath $candidate; break }
 }
 for($i=0;$i -lt 40;$i++) {
  Start-Sleep -Milliseconds 150
  $target=Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if($target){break}
 }
}
if(!$target){throw 'DeepSeek Harness has no available desktop window.'}
$handle=$target.MainWindowHandle
if([DshWindow]::IsIconic($handle)){[void][DshWindow]::ShowWindowAsync($handle,9)}
else{[void][DshWindow]::ShowWindowAsync($handle,5)}
[void][DshWindow]::SetForegroundWindow($handle)
if([DshWindow]::GetForegroundWindow() -ne $handle) {
 $current=[DshWindow]::GetCurrentThreadId()
 $foreground=[DshWindow]::GetWindowThreadProcessId([DshWindow]::GetForegroundWindow(),[IntPtr]::Zero)
 $attached=$false
 try {
  if($foreground -ne $current){$attached=[DshWindow]::AttachThreadInput($current,$foreground,$true)}
  [void][DshWindow]::BringWindowToTop($handle)
  [void][DshWindow]::SetForegroundWindow($handle)
 } finally {if($attached){[void][DshWindow]::AttachThreadInput($current,$foreground,$false)}}
}
Start-Sleep -Milliseconds 150
@{ok=([DshWindow]::GetForegroundWindow() -eq $handle);pid=$target.Id} | ConvertTo-Json -Compress
`;

export function activateDeepSeekHarness(): Promise<{ok:boolean; error?:string}> {
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ACTIVATE_DSH_SCRIPT,'utf16le').toString('base64')],
    {windowsHide:true,timeout:12000,maxBuffer:16384}, (error,stdout) => {
      if(error) return resolve({ok:false,error:'未能唤起 DeepSeek Harness，请从任务栏打开。'});
      try {const result=JSON.parse(stdout.trim());resolve(result.ok?{ok:true}:{ok:false,error:'请从任务栏切换到 DeepSeek Harness。'});} catch {resolve({ok:false,error:'未能确认 DeepSeek Harness 窗口，请从任务栏打开。'});}
    }));
}
