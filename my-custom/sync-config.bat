@echo off
chcp 65001 >nul 2>&1
setlocal
set "CUR_DIR=%~dp0"
cd /d "%CUR_DIR%"

rem ============================================================
rem  Use Git Bash, NOT the bare `bash` (same reason as start-docker.bat:
rem  C:\Windows\System32\bash.exe is WSL and cannot reach Docker Desktop).
rem ============================================================
set "BASH="
for %%B in (
  "C:\Program Files\Git\bin\bash.exe"
  "C:\Program Files\Git\usr\bin\bash.exe"
  "%ProgramFiles%\Git\bin\bash.exe"
  "%ProgramFiles%\Git\usr\bin\bash.exe"
  "%ProgramFiles(x86)%\Git\bin\bash.exe"
  "D:\Programs\Git\bin\bash.exe"
  "D:\Programs\Git\usr\bin\bash.exe"
) do (
  if not defined BASH if exist "%%~B" set "BASH=%%~B"
)

if not defined BASH (
  for /f "delims=" %%B in ('where bash 2^>nul') do (
    if not defined BASH (
      echo "%%B" | findstr /i /c:"System32" >nul 2>&1
      if errorlevel 1 (
        echo "%%B" | findstr /i /c:"WindowsApps" >nul 2>&1
        if errorlevel 1 set "BASH=%%B"
      )
    )
  )
)

if not defined BASH (
  echo [sync-config] ERROR: Git Bash not found. Please install Git for Windows.
  pause
  exit /b 1
)

echo [sync-config] Using Git Bash: %BASH%
"%BASH%" sync-config.sh %*
rem 无论成功失败都暂停，避免窗口直接关闭看不到结果。
echo.
echo [sync-config] 完成，按任意键退出 ...
pause
endlocal
