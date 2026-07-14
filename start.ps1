# VeryAgent 一键启动（换机器后直接跑这个）
# 用法: .\start.ps1
# 首次: 自动安装环境 + 编译（5-10 分钟）
# 后续: 秒开桌面端

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VeryAgent Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# ── 1. 清理环境 ──
Write-Host "[1/5] Cleaning up..." -ForegroundColor Yellow
foreach ($port in @(3000, 3001)) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
$lock = "$PSScriptRoot\.next\dev\lock"
if (Test-Path $lock) { Remove-Item -Force $lock }
Start-Sleep -Seconds 1

# ── 2. 检查 Node.js ──
Write-Host "[2/5] Checking Node.js..." -ForegroundColor Yellow
try { node --version 2>$null } catch {
    Write-Host "  Install Node.js >= 22 first: https://nodejs.org" -ForegroundColor Red
    exit 1
}

# ── 3. 检查 pnpm + 安装前端依赖 ──
Write-Host "[3/5] Checking pnpm + frontend deps..." -ForegroundColor Yellow
if (-not (pnpm --version 2>$null)) { npm install -g pnpm }
if (-not (Test-Path "node_modules")) {
    Write-Host "  First run: installing frontend packages..." -ForegroundColor Gray
    pnpm install --frozen-lockfile
}

# ── 4. 检查 Rust 编译 ──
Write-Host "[4/5] Checking Rust build..." -ForegroundColor Yellow
$binary = "src-tauri\target\debug\veryagent.exe"
if (-not (Test-Path $binary)) {
    Write-Host "  First run: compiling Rust (3-5 min)..." -ForegroundColor Gray
    cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --features tauri-runtime
}

# ── 5. 启动桌面端 ──
Write-Host "[5/5] Launching desktop..." -ForegroundColor Green
Start-Process -FilePath $binary -WindowStyle Normal
Write-Host "  Done! Check your taskbar for VeryAgent." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
