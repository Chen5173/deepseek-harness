@echo off
rem dsh-lan.cmd - cmd.exe / double-click entry for the same tool (dsh-lan.ps1 | dsh-lan.sh).
rem
rem Help:  dsh-lan.cmd -h   ( -Help / --help / /? also work )
rem
rem Arguments go straight to dsh-lan.ps1, so PowerShell switch syntax applies:
rem   dsh-lan.cmd                                  GUI + forwarder (default)
rem   dsh-lan.cmd -AutoLogin -Allow 10.228.0.0/16  phone opens the bare URL, no token
rem   dsh-lan.cmd -GuiOnly
rem   dsh-lan.cmd -BridgeOnly -RewriteHost         GUI already running elsewhere
rem   dsh-lan.cmd -BridgeOnly -Token "<token or URL>" -AutoLogin -Allow 10.228.0.0/16
rem   dsh-lan.cmd -LanPort 3092 -Port 8080
rem   dsh-lan.cmd -PrintOnly                       print the exact commands
rem
rem Stop: Ctrl+C in this window.
setlocal
set SCRIPT_DIR=%~dp0
set FIRST=%~1
if "%FIRST%"=="-h"     goto :help
if "%FIRST%"=="-Help"  goto :help
if "%FIRST%"=="--help" goto :help
if "%FIRST%"=="/?"     goto :help
if "%FIRST%"=="/help"  goto :help
if "%FIRST%"=="help"   goto :help
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%dsh-lan.ps1" %*
goto :end
:help
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%dsh-lan.ps1" -Help
:end
endlocal
