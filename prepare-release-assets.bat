@echo off
setlocal EnableExtensions EnableDelayedExpansion

title VeryAgent Release Assets Prep

set "ROOT=%~dp0"
pushd "%ROOT%" >nul
set "DIST_DIR=.release-assets"
set "OUT_DIR=%DIST_DIR%\out"
set "SIDECAR_DIR=%DIST_DIR%\sidecar"
set "DOC_DIR=%DIST_DIR%\docs"
set "SIDECAR_SOURCE="

echo ============================================
echo   VeryAgent Release Asset Prep
echo ============================================
echo Project root: %CD%
echo Output dir : %CD%\%DIST_DIR%
echo.

if not exist "out\index.html" (
  echo [ERROR] out\index.html not found
  echo         Run build-exe.bat full or pnpm build first
  goto :fail
)

for %%F in ("src-tauri\binaries\veryagent-mcp-*.exe") do (
  if exist "%%~fF" (
    set "SIDECAR_SOURCE=%%~fF"
    goto :found_sidecar
  )
)

:found_sidecar
if not defined SIDECAR_SOURCE (
  echo [ERROR] src-tauri\binaries\veryagent-mcp-*.exe not found
  echo         Run pnpm tauri:prepare-sidecars first
  goto :fail
)

if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
mkdir "%OUT_DIR%" >nul 2>&1
mkdir "%SIDECAR_DIR%" >nul 2>&1
mkdir "%DOC_DIR%" >nul 2>&1

echo [1/4] Copy out\ ...
xcopy /E /I /Y "out" "%OUT_DIR%" >nul
if errorlevel 1 goto :copy_fail

echo [2/4] Copy sidecar ...
copy /Y "%SIDECAR_SOURCE%" "%SIDECAR_DIR%\" >nul
if errorlevel 1 goto :copy_fail

echo [3/4] Copy docs ...
copy /Y "docs\build-recovery.zh-CN.md" "%DOC_DIR%\" >nul
if errorlevel 1 goto :copy_fail

echo [4/4] Write release notes ...
> "%DIST_DIR%\README.txt" echo VeryAgent release asset notes
>> "%DIST_DIR%\README.txt" echo.
>> "%DIST_DIR%\README.txt" echo 1. Unzip out\ into the project root on the new machine.
>> "%DIST_DIR%\README.txt" echo 2. Copy the sidecar EXE into src-tauri\binaries\ on the new machine.
>> "%DIST_DIR%\README.txt" echo 3. See docs\build-recovery.zh-CN.md for the full Chinese guide.
>> "%DIST_DIR%\README.txt" echo.
>> "%DIST_DIR%\README.txt" echo Recommended Release uploads:
>> "%DIST_DIR%\README.txt" echo - out\
>> "%DIST_DIR%\README.txt" echo - sidecar\
>> "%DIST_DIR%\README.txt" echo - docs\build-recovery.zh-CN.md

echo.
echo [OK] Assets prepared: %CD%\%DIST_DIR%
explorer "%DIST_DIR%"
goto :done

:copy_fail
echo [ERROR] Failed to copy files
goto :fail

:done
popd >nul
pause
exit /b 0

:fail
popd >nul
pause
exit /b 1
