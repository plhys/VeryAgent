# VeryAgent 一键启动桌面端
# 用法: .\dev.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VeryAgent Desktop Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. 清理旧进程和端口
Write-Host "[1/3] Cleaning up..." -ForegroundColor Yellow
$ports = @(3000, 3001)
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "  Freed port $port" -ForegroundColor Gray
    }
}
$lockFile = "$PSScriptRoot\.next\dev\lock"
if (Test-Path $lockFile) {
    Remove-Item -Force $lockFile
    Write-Host "  Removed lock file" -ForegroundColor Gray
}
Start-Sleep -Seconds 2

# 2. 快速编译验证
Write-Host "[2/3] Checking compilation..." -ForegroundColor Yellow
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | Select-Object -Last 1

# 3. 启动
Write-Host "[3/3] Launching desktop..." -ForegroundColor Green
Write-Host "  First launch: ~3 min. Subsequent: ~15 sec." -ForegroundColor Gray
Write-Host "  Keep this window open while the app is running." -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan

pnpm tauri dev
