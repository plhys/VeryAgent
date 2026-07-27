# VeryAgent 独立开发启动（推荐日常用）
# 用法: .\dev-detached.ps1
#       .\dev-detached.ps1 -SkipBuild      # 不重编，只确保前端 + 拉起 exe
#       .\dev-detached.ps1 -ForceBuild     # 强制 cargo build
#       .\dev-detached.ps1 -RestartApp     # 先杀掉已有 veryagent 再启动
#
# 特点:
# - 前端 pnpm dev 与桌面 exe 进程独立
# - 用 Start-Process 拉起 exe，关掉本终端 / agent 会话不会带走桌面端
# - 只在需要时增量编译 debug，避免每次 pnpm tauri dev 冷启动

param(
    [switch]$SkipBuild,
    [switch]$ForceBuild,
    [switch]$RestartApp
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$binary = Join-Path $PSScriptRoot "src-tauri\target\debug\veryagent.exe"
$frontendUrl = "http://localhost:3000"
$devPort = 3000

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VeryAgent Detached Dev" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

function Test-PortListening([int]$Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    return $null -ne $conn
}

function Ensure-Frontend {
    if (Test-PortListening $devPort) {
        Write-Host "[frontend] already on :$devPort" -ForegroundColor Green
        return
    }

    Write-Host "[frontend] starting pnpm dev (detached)..." -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
        Write-Host "[frontend] node_modules missing; run pnpm install first" -ForegroundColor Red
        exit 1
    }

    $lock = Join-Path $PSScriptRoot ".next\dev\lock"
    if (Test-Path $lock) {
        Remove-Item -Force $lock -ErrorAction SilentlyContinue
    }

    # Detached: do not tie frontend lifetime to this shell / agent session.
    Start-Process -FilePath "pnpm" -ArgumentList "dev" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized

    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        if (Test-PortListening $devPort) {
            Write-Host "[frontend] ready at $frontendUrl" -ForegroundColor Green
            return
        }
        Start-Sleep -Seconds 1
    }

    Write-Host "[frontend] timed out waiting for :$devPort" -ForegroundColor Red
    Write-Host "  Open a terminal and run: pnpm dev" -ForegroundColor Gray
    exit 1
}

function Ensure-Binary {
    $needBuild = $ForceBuild -or (-not (Test-Path $binary))
    if ($SkipBuild -and -not (Test-Path $binary)) {
        Write-Host "[rust] binary missing and -SkipBuild set: $binary" -ForegroundColor Red
        exit 1
    }
    if ($SkipBuild) {
        Write-Host "[rust] skip build (using existing exe)" -ForegroundColor Gray
        return
    }
    if (-not $needBuild) {
        # Default: rebuild when sources look newer than exe (cheap mtime check).
        $exeTime = (Get-Item $binary).LastWriteTimeUtc
        $watchRoots = @(
            (Join-Path $PSScriptRoot "src-tauri\src"),
            (Join-Path $PSScriptRoot "src-tauri\Cargo.toml"),
            (Join-Path $PSScriptRoot "src-tauri\tauri.conf.json")
        )
        foreach ($root in $watchRoots) {
            if (-not (Test-Path $root)) { continue }
            $newer = Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTimeUtc -gt $exeTime } |
                Select-Object -First 1
            if ($newer) {
                $needBuild = $true
                Write-Host "[rust] source newer than exe: $($newer.FullName)" -ForegroundColor Gray
                break
            }
        }
    }

    if (-not $needBuild) {
        Write-Host "[rust] exe up to date" -ForegroundColor Green
        return
    }

    if (Get-Process -Name "veryagent" -ErrorAction SilentlyContinue) {
        Write-Host "[rust] stopping running veryagent.exe (file lock)..." -ForegroundColor Yellow
        Get-Process -Name "veryagent" -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 1
    }

    Write-Host "[rust] cargo build (debug, incremental)..." -ForegroundColor Yellow
    # 兼容 PowerShell 5.1：$ErrorActionPreference=Stop 会把 cargo 正常的编译进度(stderr)误判为错误并中断。
    # 这里临时放宽，仅用 $LASTEXITCODE 判断真正的编译失败。
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    cargo build --manifest-path (Join-Path $PSScriptRoot "src-tauri\Cargo.toml") `
        --no-default-features --features tauri-runtime
    $ErrorActionPreference = $prevEAP
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[rust] build failed" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "[rust] build ok" -ForegroundColor Green
}

function Start-Desktop {
    if (-not (Test-Path $binary)) {
        Write-Host "[desktop] binary not found: $binary" -ForegroundColor Red
        exit 1
    }

    if ($RestartApp) {
        Get-Process -Name "veryagent" -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 1
    }

    Write-Host "[desktop] Start-Process (detached)..." -ForegroundColor Green
    Start-Process -FilePath $binary -WorkingDirectory $PSScriptRoot -WindowStyle Normal
    Write-Host "  Frontend: $frontendUrl" -ForegroundColor Gray
    Write-Host "  Binary:   $binary" -ForegroundColor Gray
    Write-Host "  Closing this window will NOT kill the app." -ForegroundColor Gray
    Write-Host "========================================" -ForegroundColor Cyan
}

Ensure-Frontend
Ensure-Binary
Start-Desktop
