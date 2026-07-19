!macro NSIS_HOOK_PREINSTALL
  ; ponytail: remove retired speech payloads instead of maintaining per-version migrations.
  RMDir /r "$INSTDIR\resources\speech"
  RMDir /r "$INSTDIR\speech"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The generated uninstaller removes the executable but can leave bundled resource trees behind.
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\speech"
!macroend
