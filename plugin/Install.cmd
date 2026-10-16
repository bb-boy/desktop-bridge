@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0assets\client\install.ps1" %*
if errorlevel 1 pause
