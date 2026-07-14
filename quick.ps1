# VeryAgent 超快速启动（跳过前端 dev server，直接启动桌面端）
# 用法: .\quick.ps1
# 前提: 至少运行过一次 .\setup.ps1 和 .\dev.ps1（确保编译过）

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VeryAgent Quick Launch" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 杀掉可能残留的进程
$ports = @(3000, 3001)
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "  Freed port $port" -ForegroundColor Gray
    }
}

# 直接运行已编译的二进制（跳过前端 dev server）
$binary = "src-tauri\target\debug\veryagent.exe"
if (Test-Path $binary) {
    Write-Host "  Starting desktop app..." -ForegroundColor Green
    Start-Process -FilePath $binary -WindowStyle Normal
    Write-Host "  Desktop app launched! Check your taskbar." -ForegroundColor Green
} else {
    Write-Host "  Binary not found. Run .\dev.ps1 first to compile." -ForegroundColor Red
}
