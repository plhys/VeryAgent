# VeryAgent 一键启动桌面端
# 用法: .\dev.ps1
# 自动处理: 杀旧进程 → 清锁 → 编译验证 → 启动

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VeryAgent Desktop Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# ── 1. 清理环境 ──
Write-Host "[1/3] Cleaning up old processes..." -ForegroundColor Yellow

# 杀占用 3000/3001 端口的进程
$ports = @(3000, 3001)
foreach ($port in $ports) {
    $pidOnPort = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | 
                  Select-Object -First 1).OwningProcess
    if ($pidOnPort) {
        try {
            Stop-Process -Id $pidOnPort -Force -ErrorAction SilentlyContinue
            Write-Host "  Killed process on port $port (PID $pidOnPort)" -ForegroundColor Gray
        } catch {}
    }
}

# 删 Next.js 锁文件
$lockFile = "$PSScriptRoot\.next\dev\lock"
if (Test-Path $lockFile) {
    Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
    Write-Host "  Removed .next lock file" -ForegroundColor Gray
}

# 等待端口释放
Start-Sleep -Seconds 2

# ── 2. 快速编译验证 ──
Write-Host "[2/3] Quick compilation check..." -ForegroundColor Yellow
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | Select-Object -Last 1

# ── 3. 启动 ──
Write-Host "[3/3] Launching desktop..." -ForegroundColor Green
Write-Host "  First launch: 2-5 min. Subsequent: 10-30 sec." -ForegroundColor Gray
Write-Host "  KEEP THIS WINDOW OPEN while the app is running." -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

pnpm tauri dev
