; Custom NSIS hooks for Disk Analyzer.
;
; Registers a "Scan with Ledgeon" entry on the right-click menu of:
;   - any folder    (HKCR\Directory\shell\...)
;   - the empty area inside a folder  (HKCR\Directory\Background\shell\...)
;   - drive roots   (HKCR\Drive\shell\...)
;
; Removed cleanly on uninstall.

!macro customInstall
  ; Folder right-click
  WriteRegStr HKCR "Directory\shell\DiskAnalyzer" "" "Scan with Ledgeon"
  WriteRegStr HKCR "Directory\shell\DiskAnalyzer" "Icon" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  WriteRegStr HKCR "Directory\shell\DiskAnalyzer\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'

  ; Empty-area right-click inside an explorer window
  WriteRegStr HKCR "Directory\Background\shell\DiskAnalyzer" "" "Scan with Ledgeon"
  WriteRegStr HKCR "Directory\Background\shell\DiskAnalyzer" "Icon" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  WriteRegStr HKCR "Directory\Background\shell\DiskAnalyzer\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%V"'

  ; Drive root right-click
  WriteRegStr HKCR "Drive\shell\DiskAnalyzer" "" "Scan with Ledgeon"
  WriteRegStr HKCR "Drive\shell\DiskAnalyzer" "Icon" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  WriteRegStr HKCR "Drive\shell\DiskAnalyzer\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCR "Directory\shell\DiskAnalyzer"
  DeleteRegKey HKCR "Directory\Background\shell\DiskAnalyzer"
  DeleteRegKey HKCR "Drive\shell\DiskAnalyzer"
!macroend
