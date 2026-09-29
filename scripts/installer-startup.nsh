!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DeskfolkCodexCompanion"
    Delete "$LOCALAPPDATA\Deskfolk\CodexLauncher\config.json"
    Sleep 850
    Delete "$LOCALAPPDATA\Deskfolk\CodexLauncher\DeskfolkCodexLauncher.exe"
    RMDir "$LOCALAPPDATA\Deskfolk\CodexLauncher"
  ${EndIf}
!macroend
