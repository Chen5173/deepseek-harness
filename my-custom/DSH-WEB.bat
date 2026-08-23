@echo off
set CUR_DIR=%~dp0%
cd %CUR_DIR%..
node apps/cli/lib/bin.js web %*
if errorlevel 1 (
	pause
)
