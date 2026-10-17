@echo off
setlocal DisableDelayedExpansion
rem Manual re-authorization. The browser must confirm this device again.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0control.ps1" -Action pair %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo Pairing did not finish. Check the error above and retry when ready.
echo.
pause
exit /b %RESULT%
