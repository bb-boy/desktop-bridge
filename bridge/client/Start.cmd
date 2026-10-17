@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0control.ps1" -Action start %*
if errorlevel 1 pause
