@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0control.ps1" -Action stop %*
if errorlevel 1 pause
