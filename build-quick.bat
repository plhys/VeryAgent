@echo off
chcp 65001 >nul 2>&1
title VeryAgent Quick Build (只要 exe)

echo ============================================
echo   VeryAgent 快速编译 - 只要 exe
echo ============================================
echo.

:: 限制并行，防 OOM
set CARGO_BUILD_JOBS=2
set RUSTC_WRAPPER=sccache

:: 前端（如果 out/ 已有可跳过）
if exist "out\index.html" (
    echo [跳过] 前端已编译 (out/index.html 存在)
    echo         如需重新编译，删除 out 目录后重跑
) else (
    echo [1/3] 编译前端 ...
    call pnpm build
    if %ERRORLEVEL% neq 0 (
        echo [错误] 前端编译失败
        pause
        exit /b 1
    )
)
echo.

:: sidecar（如果已存在可跳过）
if exist "src-tauri\binaries\veryagent-mcp-x86_64-pc-windows-msvc.exe" (
    echo [跳过] sidecar 已存在
) else (
    echo [2/3] 编译 sidecar ...
    call pnpm tauri:prepare-sidecars
    if %ERRORLEVEL% neq 0 (
        echo [错误] sidecar 编译失败
        pause
        exit /b 1
    )
)
echo.

:: 内置 Node 运行时（如果已存在可跳过；打包安装程序才需要）
if exist "src-tauri\resources\node\node.exe" (
    echo [跳过] 内置 Node 运行时已存在
) else (
    echo [2.5/3] 准备内置 Node 运行时 ...
    call pnpm tauri:prepare-node
    if %ERRORLEVEL% neq 0 (
        echo [提示] Node 运行时准备失败（不影响直接运行 exe，仅影响打包）
    )
)
echo.

:: 主程序
echo [3/3] 编译 Rust 主程序 (release) ...
echo       并行数: %CARGO_BUILD_JOBS%
echo       编译中，请耐心等待...
echo.
cd src-tauri
cargo build --release --bin veryagent --features tauri-runtime
if %ERRORLEVEL% neq 0 (
    echo [错误] 编译失败
    cd ..
    pause
    exit /b 1
)
cd ..
echo.
echo ============================================
echo   完成！exe 位置:
echo   src-tauri\target\release\veryagent.exe
echo ============================================
echo.

:: 自动打开所在文件夹
explorer "src-tauri\target\release"

pause
