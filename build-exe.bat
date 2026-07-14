@echo off
setlocal EnableExtensions

title VeryAgent EXE Builder

set "ROOT=%~dp0"
pushd "%ROOT%" >nul

echo ============================================
echo   VeryAgent EXE Builder
echo ============================================
echo Project root: %CD%
echo.

if not exist "package.json" (
  echo [ERROR] package.json not found in project root
  goto :fail
)
if not exist "src-tauri\tauri.conf.json" (
  echo [ERROR] src-tauri\tauri.conf.json not found
  goto :fail
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node not found
  goto :fail
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm not found
  goto :fail
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo [ERROR] cargo not found
  goto :fail
)

set "CARGO_BUILD_JOBS=2"
set "VERYAGENT_SKIP_FRONTEND_BUILD=1"
set "MODE=%~1"

where sccache >nul 2>&1
if not errorlevel 1 (
  set "RUSTC_WRAPPER=sccache"
  echo [INFO] sccache enabled
) else (
  echo [INFO] sccache not found, continue without it
)

echo [INFO] CARGO_BUILD_JOBS=%CARGO_BUILD_JOBS%

if /I "%MODE%"=="full" (
  set "VERYAGENT_SKIP_FRONTEND_BUILD="
  echo [MODE] full - rebuild frontend first
) else (
  echo [MODE] quick - reuse existing out\ and skip frontend build
  if not exist "out\index.html" (
    echo [INFO] out\index.html not found, switching to full mode
    set "VERYAGENT_SKIP_FRONTEND_BUILD="
  )
)

echo.
echo [INFO] killing old veryagent.exe if still running...
taskkill //F //IM "veryagent.exe" >nul 2>&1
echo.
echo [RUN] pnpm tauri build --no-bundle
echo.
call pnpm tauri build --no-bundle
if errorlevel 1 (
  echo [ERROR] Tauri EXE build failed
  goto :fail
)

echo.
echo [CHECK] verifying output...
if exist "src-tauri\target\release\veryagent.exe" (
  echo [OK] Built EXE:
  echo      %CD%\src-tauri\target\release\veryagent.exe
  echo.
  explorer "src-tauri\target\release"
  goto :done
)

echo [ERROR] Build returned success but veryagent.exe was not found
goto :fail

:done
echo.
echo Usage:
echo   - Double click this file for quick mode
echo   - Run build-exe.bat full for full frontend rebuild
echo.
popd >nul
pause
exit /b 0

:fail
echo.
echo Build failed. Please keep this window and share the output.
popd >nul
pause
exit /b 1
