$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskFixtureRoot=Join-Path $taskRoot '.cache/launcher-e2e'
$taskDesktopDirectory=Join-Path $taskFixtureRoot 'OpenAI.Codex_fixture/app'
New-Item -ItemType Directory -Path $taskDesktopDirectory -Force | Out-Null
$taskCompiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$taskDesktopFixture=Join-Path $taskDesktopDirectory 'ChatGPT.exe'
$taskPetFixture=Join-Path $taskFixtureRoot 'PetProbe.exe'
& $taskCompiler /nologo /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll ("/out:"+$taskDesktopFixture) (Join-Path $taskRoot 'scripts/qa-v42-codex-startup-fixture.cs')
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
Copy-Item -LiteralPath $taskDesktopFixture -Destination $taskPetFixture
$taskHelper=Join-Path $taskRoot '.cache/codex-launcher/DeskfolkCodexLauncher.exe'
$taskOutput=Join-Path $taskRoot '.cache/companion-polish-checks'
$taskNative=Start-Process -FilePath $taskHelper -ArgumentList @('--self-test',('"'+(Join-Path $taskOutput 'launcher-paths.json')+'"')) -WindowStyle Hidden -Wait -PassThru
if($taskNative.ExitCode -ne 0){throw 'Path tests failed'}
$taskNative=Start-Process -FilePath $taskHelper -ArgumentList @('--probe',('"'+(Join-Path $taskOutput 'launcher-probe.json')+'"')) -WindowStyle Hidden -Wait -PassThru
if($taskNative.ExitCode -ne 0){throw 'Actual Codex desktop not detected'}
$taskCounter=Join-Path $taskFixtureRoot 'counter.txt'
[IO.File]::WriteAllText($taskCounter,'0')
$taskConfig=Join-Path $taskFixtureRoot 'config.json'
$taskConfiguration=@{enabled=$true;executable=$taskPetFixture}
$taskConfiguration|ConvertTo-Json|Set-Content -LiteralPath $taskConfig -Encoding utf8
$taskWatcher=$null;$taskDesktop=$null;$taskDuplicate=$null
try {
 $taskWatcher=Start-Process -FilePath $taskHelper -ArgumentList @('--watch',('"'+$taskConfig+'"')) -WindowStyle Hidden -PassThru
 Start-Sleep -Milliseconds 1500
 $taskFirst=[int](Get-Content -LiteralPath $taskCounter)
 if($taskFirst -lt 1){throw 'Startup edge failed to launch probe'}
 $taskDesktop=Start-Process -FilePath $taskDesktopFixture -WindowStyle Hidden -PassThru
 Start-Sleep -Milliseconds 1600
 $taskSecond=[int](Get-Content -LiteralPath $taskCounter)
 if($taskSecond -le $taskFirst){throw 'New desktop process failed to launch probe'}
 Start-Sleep -Milliseconds 1600
 if([int](Get-Content -LiteralPath $taskCounter) -ne $taskSecond){throw 'Existing desktop repeatedly launched pet'}
 $taskDuplicate=Start-Process -FilePath $taskHelper -ArgumentList @('--watch',('"'+$taskConfig+'"')) -WindowStyle Hidden -PassThru
 if(-not $taskDuplicate.WaitForExit(1500)){throw 'Duplicate watcher did not exit'}
 $taskMemory=(Get-Process -Id $taskWatcher.Id).WorkingSet64
 $taskConfiguration.enabled=$false
 $taskConfiguration|ConvertTo-Json|Set-Content -LiteralPath $taskConfig -Encoding utf8
 if(-not $taskWatcher.WaitForExit(1800)){throw 'Disabled watcher did not stop'}
 Stop-Process -Id $taskDesktop.Id -ErrorAction SilentlyContinue
 $taskDesktop=Start-Process -FilePath $taskDesktopFixture -WindowStyle Hidden -PassThru
 Start-Sleep -Milliseconds 1200
 if([int](Get-Content -LiteralPath $taskCounter) -ne $taskSecond){throw 'Disabled watcher still launched pet'}
 $taskReport=@{passed=$true;realDesktopDetected=$true;newDesktopTriggers=$true;existingDesktopDoesNotRespawn=$true;duplicateWatcherExits=$true;disabledWatcherStops=$true;disabledDoesNotLaunch=$true;workingSetBytes=$taskMemory;method='Compiled native helper with private invisible desktop/probe fixtures; no real Codex process closed and no Run key modified'}
 $taskReport|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskOutput 'launcher-e2e.json') -Encoding utf8
 $taskReport|ConvertTo-Json -Compress
} finally {
 foreach($taskProcess in @($taskWatcher,$taskDesktop,$taskDuplicate)){
  if($taskProcess -and -not $taskProcess.HasExited){Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue}
 }
}
