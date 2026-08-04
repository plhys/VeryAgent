@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0dev-detached.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo Exit code: %ERRORLEVEL%
    echo If frontend is not ready, run: pnpm dev
    pause
)