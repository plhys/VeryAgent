# VeryAgent 环境初始化
# 换机器后只需运行一次：.\setup.ps1
# 之后每次启动用 .\dev.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VeryAgent Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# ── 1. Node.js ──
Write-Host "[1/4] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node --version 2>$null
    Write-Host "  Node.js $nodeVer" -ForegroundColor Gray
} catch {
    Write-Host "  Node.js >= 22 required: https://nodejs.org" -ForegroundColor Red
    exit 1
}

# ── 2. pnpm ──
Write-Host "[2/4] Checking pnpm..." -ForegroundColor Yellow
$pnpmVer = pnpm --version 2>$null
if (-not $pnpmVer) {
    Write-Host "  Installing pnpm..." -ForegroundColor Gray
    npm install -g pnpm
}
Write-Host "  pnpm $(pnpm --version)" -ForegroundColor Gray

# ── 3. Frontend ──
Write-Host "[3/4] Installing frontend dependencies..." -ForegroundColor Yellow
pnpm install --frozen-lockfile
Write-Host "  Done" -ForegroundColor Gray

# ── 4. Rust ──
Write-Host "[4/4] Fetching Rust dependencies..." -ForegroundColor Yellow
cargo fetch --manifest-path src-tauri/Cargo.toml
Write-Host "  Done" -ForegroundColor Gray

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup complete. Run .\dev.ps1 to launch." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
