@echo off
chcp 65001 >nul 2>&1
setlocal
set "CUR_DIR=%~dp0"
cd /d "%CUR_DIR%"

rem ============================================================
rem  IMPORTANT: run start.sh with Git Bash, NOT the bare `bash`.
rem  On PATH, the first bash is C:\Windows\System32\bash.exe (WSL).
rem  Inside WSL, the Windows docker.exe cannot reach the Docker
rem  Desktop engine, so start.sh wrongly reports
rem  "Docker 守护进程未运行 / daemon not running".
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

rem Fallback: pick a non-WSL bash from `where bash`.
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
  echo [start-docker] ERROR: Git Bash not found. Please install Git for Windows.
  pause
  exit /b 1
)

echo [start-docker] Using Git Bash: %BASH%
"%BASH%" start.sh %*
rem 无论成功失败都暂停，避免窗口直接关闭看不到域名和授权码。
echo.
echo [start-docker] 公网域名存于 my-custom\.dsh-tunnel-url ，授权码存于 my-custom\.dsh-auth 。
echo [start-docker] 完成，按任意键退出 ...
pause
endlocal