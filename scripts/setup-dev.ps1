# 一键初始化开发环境（新机器 / 新克隆后执行一次）
#
# 用法（PowerShell）：
#   pwsh scripts/setup-dev.ps1
#   # 或
#   powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1
#
# 作用同 setup-dev.sh：装 sccache、装前端依赖、拉 Rust 依赖、启动缓存服务器。
# sccache 缓存内容不进 git，换机器迁移见 docs/BUILD-SPEED.md。
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

function Info($msg)  { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "[!]  $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "[X]  $msg" -ForegroundColor Red }

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  veryAgent 开发环境初始化" -ForegroundColor Cyan
Write-Host "  项目: $ProjectRoot" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. 检查前置工具 ──
Write-Host "=> 检查前置工具..."
$missing = $false
foreach ($cmd in @("node", "pnpm", "cargo", "rustup")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        $ver = (Invoke-Expression "$cmd --version" 2>$null | Select-Object -First 1)
        Write-Host "  $cmd : $ver"
    } else {
        Warn "缺少 $cmd"
        $missing = $true
    }
}
if ($missing) { Fail "缺少前置工具，请先安装后重新运行。"; exit 1 }
Info "前置工具齐全"
Write-Host ""

# ── 2. 安装/更新 sccache ──
Write-Host "=> 检查 sccache 编译缓存..."
if (Get-Command sccache -ErrorAction SilentlyContinue) {
    Info "sccache 已安装: $(sccache --version 2>$null | Select-Object -First 1)"
} else {
    Warn "sccache 未安装，开始安装（cargo install sccache，约需 5-6 分钟）..."
    cargo install sccache
    Info "sccache 安装完成"
}
try { sccache --start-server 2>$null | Out-Null } catch {}
Info "sccache 服务器已启动"
Write-Host ""

# ── 3. 安装前端依赖 ──
Write-Host "=> 安装前端依赖 (pnpm install)..."
pnpm install
Info "前端依赖安装完成"
Write-Host ""

# ── 4. 拉取 Rust 依赖 ──
Write-Host "=> 拉取 Rust 依赖 (cargo fetch)..."
Push-Location src-tauri
cargo fetch
Info "Rust 依赖就绪"
Pop-Location
Write-Host ""

# ── 5. 验证 ──
Write-Host "=> 验证配置..."
if (Select-String -Path ".cargo/config.toml" -Pattern 'rustc-wrapper = "sccache"' -Quiet) {
    Info ".cargo/config.toml 已配置 sccache"
} else {
    Warn ".cargo/config.toml 未启用 sccache"
}
if (sccache --show-stats 2>$null) {
    Info "sccache 服务器响应正常"
} else {
    Warn "sccache 服务器无响应"
}
Write-Host ""

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  初始化完成！" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步："
Write-Host "  日常开发:    pnpm tauri dev"
Write-Host "  发布构建:    pnpm tauri build --no-bundle"
Write-Host ""
Write-Host "提示："
Write-Host "  - 首次编译填充 sccache 缓存较慢，之后命中缓存加速。"
Write-Host "  - 换机器复用旧缓存：拷贝 %LOCALAPPDATA%\Mozilla\sccache\cache 目录。"
Write-Host "  - 详见 docs/BUILD-SPEED.md"
