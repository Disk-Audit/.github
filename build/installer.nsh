; Custom NSIS hooks for Disk Analyzer.
;
; Registers a "Scan with Disk Analyzer" entry on the right-click menu of:
;   - any folder    (HKCR\Directory\shell\...)
;   - the empty area inside a folder  (HKCR\Directory\Background\shell\...)
;   - drive roots   (HKCR\Drive\shell\...)
;
; Also adds $INSTDIR\resources to the system PATH so the bundled 'ledgeon'
; CLI is available from any terminal after install.
;
; Removed cleanly on uninstall.

!macro customInstall
  ; Folder right-click
  WriteRegStr HKCR "Directory\shell\DiskAnalyzer" "" "Scan with Disk Analyzer"
  WriteRegStr HKCR "Directory\shell\DiskAnalyzer" "Icon" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  WriteRegStr HKCR "Directory\shell\DiskAnalyzer\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'

  ; Empty-area right-click inside an explorer window
  WriteRegStr HKCR "Directory\Background\shell\DiskAnalyzer" "" "Scan with Disk Analyzer"
  WriteRegStr HKCR "Directory\Background\shell\DiskAnalyzer" "Icon" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  WriteRegStr HKCR "Directory\Background\shell\DiskAnalyzer\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%V"'

  ; Drive root right-click
  WriteRegStr HKCR "Drive\shell\DiskAnalyzer" "" "Scan with Disk Analyzer"
  WriteRegStr HKCR "Drive\shell\DiskAnalyzer" "Icon" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  WriteRegStr HKCR "Drive\shell\DiskAnalyzer\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'

  ; Add resources dir to system PATH for the 'ledgeon' CLI
  ReadRegStr $R0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "PATH"
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "PATH" "$R0;$INSTDIR\resources"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  DeleteRegKey HKCR "Directory\shell\DiskAnalyzer"
  DeleteRegKey HKCR "Directory\Background\shell\DiskAnalyzer"
  DeleteRegKey HKCR "Drive\shell\DiskAnalyzer"

  ; Remove resources dir from system PATH
  ExecWait 'powershell -NonInteractive -NoProfile -Command "[Environment]::SetEnvironmentVariable(\"PATH\", (([Environment]::GetEnvironmentVariable(\"PATH\", \"Machine\") -split \";\") | Where-Object { $_ -ne \"$INSTDIR\resources\" }) -join \";\", \"Machine\")"'
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
