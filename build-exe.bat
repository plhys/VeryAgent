@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1

title VeryAgent EXE Builder

REM 始终切到脚本所在目录，避免“当前路径不对”导致各种命令找不到项目根目录
set "ROOT=%~dp0"
pushd "%ROOT%" >nul

echo ============================================
echo   VeryAgent 一键编译 EXE
echo ============================================
echo 根目录: %CD%
echo.

REM 基础检查
if not exist "package.json" (
  echo [错误] 当前目录不是项目根目录：缺少 package.json
  goto :fail
)
if not exist "src-tauri\tauri.conf.json" (
  echo [错误] 当前目录不是项目根目录：缺少 src-tauri\tauri.conf.json
  goto :fail
)

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js
  goto :fail
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 pnpm，请先安装 pnpm
  goto :fail
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 cargo，请先安装 Rust toolchain
  goto :fail
)

REM 限制并发，避免 Windows 上 release 编译内存峰值过高
set "CARGO_BUILD_JOBS=2"

REM 如果装了 sccache 就自动启用
where sccache >nul 2>&1
if not errorlevel 1 (
  set "RUSTC_WRAPPER=sccache"
  echo [环境] 已启用 sccache
) else (
  echo [环境] 未检测到 sccache，继续编译
)

echo [环境] CARGO_BUILD_JOBS=%CARGO_BUILD_JOBS%
echo.

REM 默认走快速路线：如果 out 不存在才构建前端
REM 传入 full 参数时，强制重建前端
set "MODE=%~1"
if /I "%MODE%"=="full" goto :full_build

if exist "out\index.html" (
  echo [1/3] 检测到现有前端产物 out\index.html，跳过前端构建
) else (
  echo [1/3] 未检测到 out\index.html，开始构建前端...
  call pnpm build
  if errorlevel 1 (
    echo [错误] 前端构建失败
    goto :fail
  )
)
goto :tauri_build

:full_build
echo [1/3] full 模式：强制重建前端...
call pnpm build
if errorlevel 1 (
  echo [错误] 前端构建失败
  goto :fail
)

:tauri_build
echo.
echo [2/3] 开始构建可运行 EXE（不打 installer 包）...
echo        命令: pnpm tauri build --no-bundle
echo.
call pnpm tauri build --no-bundle
if errorlevel 1 (
  echo [错误] Tauri EXE 构建失败
  goto :fail
)

echo.
echo [3/3] 构建完成，检查产物...
if exist "src-tauri\target\release\veryagent.exe" (
  echo [成功] 生成完成：
  echo         %CD%\src-tauri\target\release\veryagent.exe
  echo.
  echo 正在打开输出目录...
  explorer "src-tauri\target\release"
  goto :done
) else (
  echo [错误] 编译命令成功返回，但未找到 veryagent.exe
  goto :fail
)

:done
echo.
echo 使用说明：
echo   - 直接双击本文件：快速构建（复用现有 out）
echo   - 命令行执行 build-exe.bat full：强制重建前端后再构建
echo.
popd >nul
pause
exit /b 0

:fail
echo.
echo 构建失败，请保留当前窗口截图给我。
popd >nul
pause
exit /b 1
