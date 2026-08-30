; Optional local toolchains. Every selected component is installed below
; $INSTDIR\tools, so it never modifies the system PATH or another installation.
!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\tools"

  MessageBox MB_YESNO|MB_ICONQUESTION "Install the C++ toolchain (GCC and GDB)?$\r$\n安装 C++ 工具链（GCC 与 GDB）？$\r$\nDownload size is large; files are stored in $INSTDIR\tools." IDNO gcc_done
  DetailPrint "Downloading the optional GCC/GDB toolchain..."
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path $\"$INSTDIR\tools$\" | Out-Null; Invoke-WebRequest -UseBasicParsing $\"https://repo.msys2.org/distrib/x86_64/msys2-base-x86_64-20260611.sfx.exe$\" -OutFile $\"$INSTDIR\tools\msys2.sfx.exe$\"; Start-Process -Wait -FilePath $\"$INSTDIR\tools\msys2.sfx.exe$\" -ArgumentList $\"-y$\",$\"-o$INSTDIR\tools$\"; Remove-Item -Force $\"$INSTDIR\tools\msys2.sfx.exe$\""'
  IfFileExists "$INSTDIR\tools\msys64\usr\bin\bash.exe" 0 gcc_failed
  nsExec::ExecToLog '"$INSTDIR\tools\msys64\usr\bin\bash.exe" -lc "pacman -Sy --noconfirm mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-gdb"'
  Goto gcc_done
  gcc_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "GCC/GDB download failed. You can configure an existing toolchain later in Settings.$\r$\nGCC/GDB 下载失败，可稍后在设置中选择已有工具。"
  gcc_done:

  MessageBox MB_YESNO|MB_ICONQUESTION "Install the portable Python 3 interpreter into $INSTDIR\tools?$\r$\n安装便携版 Python 3 解释器？" IDNO python_done
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path $\"$INSTDIR\tools\python$\" | Out-Null; Invoke-WebRequest -UseBasicParsing $\"https://www.python.org/ftp/python/3.13.7/python-3.13.7-embed-amd64.zip$\" -OutFile $\"$INSTDIR\tools\python.zip$\"; Expand-Archive -Force $\"$INSTDIR\tools\python.zip$\" $\"$INSTDIR\tools\python$\"; Remove-Item -Force $\"$INSTDIR\tools\python.zip$\""'
  IfFileExists "$INSTDIR\tools\python\python.exe" python_done 0
  MessageBox MB_OK|MB_ICONEXCLAMATION "Python download failed. You can configure it later in Settings.$\r$\nPython 下载失败，可稍后在设置中配置。"
  python_done:

  MessageBox MB_YESNO|MB_ICONQUESTION "Install the Java 21 JDK (javac, java and jdb) into $INSTDIR\tools?$\r$\n安装 Java 21 JDK（javac、java 与 jdb）？" IDNO java_done
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path $\"$INSTDIR\tools\jdk$\" | Out-Null; Invoke-WebRequest -UseBasicParsing $\"https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse$\" -OutFile $\"$INSTDIR\tools\jdk.zip$\"; Expand-Archive -Force $\"$INSTDIR\tools\jdk.zip$\" $\"$INSTDIR\tools\jdk$\"; Remove-Item -Force $\"$INSTDIR\tools\jdk.zip$\""'
  IfFileExists "$INSTDIR\tools\jdk\*\bin\java.exe" java_done 0
  MessageBox MB_OK|MB_ICONEXCLAMATION "Java download failed. You can configure it later in Settings.$\r$\nJava 下载失败，可稍后在设置中配置。"
  java_done:
!macroend

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
