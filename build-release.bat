@echo off
chcp 65001 >nul 2>&1
title VeryAgent Release Build

echo ============================================
echo   VeryAgent Release Builder
echo ============================================
echo.

:: ── 配置 ──────────────────────────────────────
:: 限制并行编译数，防止内存爆掉（32GB 内存建议 2-3）
set CARGO_BUILD_JOBS=2

:: sccache 加速（已安装则启用）
where sccache >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [1/5] sccache 已安装，启用编译缓存
    set RUSTC_WRAPPER=sccache
) else (
    echo [1/5] sccache 未安装，跳过缓存（首次编译会慢）
)
echo.

:: ── 第一步：前端编译 ──────────────────────────
echo [2/5] 编译前端 (next build) ...
call pnpm build
if %ERRORLEVEL% neq 0 (
    echo.
    echo [错误] 前端编译失败！
    pause
    exit /b 1
)
echo       前端编译完成 ✓
echo.

:: ── 第二步：编译 sidecar ──────────────────────
echo [3/5] 编译 sidecar (veryagent-mcp) ...
call pnpm tauri:prepare-sidecars
if %ERRORLEVEL% neq 0 (
    echo.
    echo [错误] sidecar 编译失败！
    pause
    exit /b 1
)
echo       sidecar 编译完成 ✓
echo.

:: ── 第三步：编译 Rust 主程序 ──────────────────
echo [4/5] 编译 Rust 主程序 (release) ...
echo       限制并行数: %CARGO_BUILD_JOBS%（防止内存不足）
echo       这一步最慢，请耐心等待...
echo.
cd src-tauri
cargo build --release --bin veryagent --features tauri-runtime
if %ERRORLEVEL% neq 0 (
    echo.
    echo [错误] Rust 编译失败！
    cd ..
    pause
    exit /b 1
)
cd ..
echo       Rust 编译完成 ✓
echo.

:: ── 第四步：打包安装程序 ──────────────────────
:: 自动加载 updater 签名私钥（发版机路径，见 docs/updater-signing-keys.zh-CN.md）
:: 密钥存在时设置环境变量，让 tauri build 能生成签名 + .sig；不存在则提示并继续
echo [5/5] 打包安装程序 (NSIS) ...
set "KEYS_DIR=%USERPROFILE%\.veryagent\keys"
if exist "%KEYS_DIR%\veryagent-updater.key" (
    if exist "%KEYS_DIR%\veryagent-updater.password" (
        echo       已找到签名密钥，将对安装包签名
        set /p TAURI_SIGNING_PRIVATE_KEY=<"%KEYS_DIR%\veryagent-updater.key"
        set /p TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<"%KEYS_DIR%\veryagent-updater.password"
    ) else (
        echo       [提示] 找到私钥但缺密码文件 veryagent-updater.password，将不签名
    )
) else (
    echo       [提示] 未找到签名私钥（%KEYS_DIR%\veryagent-updater.key），
    echo             将按无私钥打包；正式发版需配好密钥（见 docs/updater-signing-keys.zh-CN.md）
)
call pnpm tauri build --bundles nsis
if %ERRORLEVEL% neq 0 (
    echo.
    echo [警告] 打包失败，但 exe 已经编译好了，可以直接运行
    echo       exe 位置: src-tauri\target\release\veryagent.exe
    echo.
    pause
    exit /b 1
)
echo.

:: ── 完成 ──────────────────────────────────────
echo ============================================
echo   编译完成！
echo ============================================
echo.
echo   安装包位置:
dir /b src-tauri\target\release\bundle\nsis\*.exe 2>nul
echo.
echo   直接运行的 exe:
echo   src-tauri\target\release\veryagent.exe
echo.

:: 显示 sccache 缓存统计
where sccache >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [sccache 缓存统计]
    sccache --show-stats
    echo.
)

pause
