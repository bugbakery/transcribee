!macro NSIS_HOOK_POSTINSTALL
  ; Check if Visual C++ 2019 Redistributable is installed (via Windows Registry)
  ReadRegDWord $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"

  ${If} $0 == 1
    DetailPrint "Visual C++ Redistributable already installed"
    Goto vcredist_done
  ${EndIf}

  ; Download and install if not installed
  Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
  DetailPrint "Downloading Visual C++ Redistributable..."
  NSISdl::download "https://aka.ms/vc14/vc_redist.x64.exe" "$TEMP\vc_redist.x64.exe"
  Pop $0
  ${If} $0 == "success"
    DetailPrint "Downloading Visual C++ Redistributable Successfull"
  ${Else}
    DetailPrint "Downloading Visual C++ Redistributable Failed"
    MessageBox MB_ICONEXCLAMATION "Visual C++ downloading failed. Some features may not work."
    Abort "Downloading Visual C++ Redistributable Failed, Aborting!"
  ${EndIf}

  DetailPrint "Installing Visual C++ Redistributable..."
  ExecWait '"$TEMP\vc_redist.x64.exe" /passive /norestart' $0

  ; Check wether installation process exited successfully (code 0) or not
  ${If} $0 == 0
    DetailPrint "Visual C++ Redistributable installed successfully"
  ${Else}
    MessageBox MB_ICONEXCLAMATION "Visual C++ installation failed. Some features may not work."
  ${EndIf}

  ; Clean up setup files from TEMP and your installed app
  Delete "$TEMP\vc_redist.x64.exe"

  vcredist_done:
!macroend
