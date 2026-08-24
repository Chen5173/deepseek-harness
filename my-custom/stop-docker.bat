@echo off
chcp 65001 >nul 2>&1
setlocal
set "CUR_DIR=%~dp0"
cd /d "%CUR_DIR%"

rem Same as start-docker.bat: use Git Bash explicitly, not WSL bash.
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
  echo [stop-docker] ERROR: Git Bash not found. Please install Git for Windows.
  pause
  exit /b 1
)
echo [stop-docker] Using Git Bash: %BASH%
"%BASH%" stop.sh %*
if errorlevel 1 (
  pause
)
endlocal