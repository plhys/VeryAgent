#!/usr/bin/env bash
# 一键初始化开发环境（新机器 / 新克隆后执行一次）
#
# 用法：
#   bash scripts/setup-dev.sh
#
# 作用：
#   1. 检查并安装 Rust / pnpm / Node 等前置工具
#   2. 安装 sccache 编译缓存（跨机器可迁移，见 docs/BUILD-SPEED.md）
#   3. 安装前端依赖（pnpm install）
#   4. 启动 sccache 服务器
#   5. 验证配置正确
#
# 注意：sccache 的「缓存内容」是二进制（几 GB），不进 git。
# 换机器想复用旧缓存，需手动拷贝 %LOCALAPPDATA%\Mozilla\sccache\cache 目录。
# 详见 docs/BUILD-SPEED.md「换机器迁移」一节。
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

# 项目根目录（脚本可能在项目子目录被调用，向上找 Cargo.toml）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "================================================"
echo "  veryAgent 开发环境初始化"
echo "  项目: $PROJECT_ROOT"
echo "================================================"
echo

# ── 1. 检查前置工具 ──────────────────────────────────────────
echo "▸ 检查前置工具..."

check_cmd() {
    if command -v "$1" >/dev/null 2>&1; then
        echo "  $1: $($1 --version 2>&1 | head -1)"
        return 0
    else
        return 1
    fi
}

MISSING=0
check_cmd node      || { warn "缺少 node (https://nodejs.org)"; MISSING=1; }
check_cmd pnpm      || { warn "缺少 pnpm (npm install -g pnpm)"; MISSING=1; }
check_cmd cargo     || { warn "缺少 rust (https://rustup.rs)"; MISSING=1; }
check_cmd rustup    || { warn "缺少 rustup (https://rustup.rs)"; MISSING=1; }

if [ "$MISSING" -eq 1 ]; then
    err "缺少前置工具，请先安装上述工具后重新运行本脚本。"
    exit 1
fi
info "前置工具齐全"
echo

# ── 2. 安装/更新 sccache ─────────────────────────────────────
echo "▸ 检查 sccache 编译缓存..."
if command -v sccache >/dev/null 2>&1; then
    info "sccache 已安装: $(sccache --version 2>&1 | head -1)"
else
    warn "sccache 未安装，开始安装（cargo install sccache，约需 5-6 分钟）..."
    cargo install sccache
    info "sccache 安装完成"
fi

# 启动 sccache 服务器（已在运行则不报错）
sccache --start-server >/dev/null 2>&1 || true
info "sccache 服务器已启动"
echo

# ── 3. 安装前端依赖 ──────────────────────────────────────────
echo "▸ 安装前端依赖 (pnpm install)..."
pnpm install
info "前端依赖安装完成"
echo

# ── 4. 准备 Rust 依赖（下载但不编译）────────────────────────
echo "▸ 拉取 Rust 依赖 (cargo fetch)..."
cd src-tauri
cargo fetch
info "Rust 依赖就绪"
cd "$PROJECT_ROOT"
echo

# ── 5. 验证 ──────────────────────────────────────────────────
echo "▸ 验证配置..."
if grep -q 'RUSTC_WRAPPER = "sccache"' .cargo/config.toml 2>/dev/null; then
    info ".cargo/config.toml 已配置 sccache"
else
    warn ".cargo/config.toml 未启用 sccache，请检查（首次构建可能较慢）"
fi

if sccache --show-stats >/dev/null 2>&1; then
    info "sccache 服务器响应正常"
else
    warn "sccache 服务器无响应，编译缓存可能不生效"
fi
echo

echo "================================================"
echo "  ✅ 初始化完成！"
echo "================================================"
echo
echo "下一步："
echo "  日常开发:    pnpm tauri dev"
echo "  发布构建:    pnpm tauri build --no-bundle"
echo
echo "提示："
echo "  - 首次编译会填充 sccache 缓存，较慢；之后会命中缓存加速。"
echo "  - 换机器复用旧缓存：拷贝 %LOCALAPPDATA%\\Mozilla\\sccache\\cache 目录。"
echo "  - 详见 docs/BUILD-SPEED.md"
