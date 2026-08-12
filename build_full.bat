@echo off
chcp 65001 >nul 2>&1
cd /d E:\AIcode\github\VeryAgent
echo [1/3] Building frontend...
call pnpm build > frontend_build.log 2>&1
if %ERRORLEVEL% neq 0 (echo FRONTEND_FAILED >> build_status.log) else (echo FRONTEND_OK >> build_status.log)
echo [2/3] Building Rust backend...
cd src-tauri
cargo build --release --bin veryagent --features tauri-runtime > rust_build.log 2>&1
if %ERRORLEVEL% neq 0 (echo RUST_FAILED >> ..\build_status.log) else (echo RUST_OK >> ..\build_status.log)
cd ..
echo [2.5/3] Preparing bundled Node runtime...
call pnpm tauri:prepare-node > node_prep.log 2>&1
echo [3/3] Packaging...
call pnpm tauri build --no-build > package.log 2>&1
if %ERRORLEVEL% neq 0 (echo PACKAGE_FAILED >> build_status.log) else (echo PACKAGE_OK >> build_status.log)
echo BUILD_COMPLETE >> build_status.log