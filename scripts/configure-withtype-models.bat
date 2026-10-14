@echo off
setlocal

set "BASE=%~dp0"
set "SCRIPT=%BASE%provision-withtype-models.ps1"
set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=%BASE%withtype-model-profile.json"

if not exist "%SCRIPT%" (
  echo Missing provision-withtype-models.ps1 next to this BAT file.
  pause
  exit /b 1
)

if not exist "%PROFILE%" (
  echo Missing private profile: %PROFILE%
  echo Keep withtype-model-profile.json in the same folder as this BAT file.
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq withtype.exe" /NH 2>nul | find /I "withtype.exe" >nul
if not errorlevel 1 (
  echo WithType is running. Exit it from the tray, then run this BAT file again.
  pause
  exit /b 2
)

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -ProfilePath "%PROFILE%"
if errorlevel 1 (
  echo Configuration failed. No API key was printed.
  pause
  exit /b 1
)

echo WithType model settings were configured for this Windows user.
pause
exit /b 0
