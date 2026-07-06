# 编译提速指南

本项目（Rust + Tauri + Next.js）编译慢主要在 Rust 侧。以下配置已就绪，本文档说明日常使用与换机器时的操作。

## 已生效的配置

### 1. Cargo profile（`src-tauri/Cargo.toml`）

- `[profile.dev]`：`opt-level=0` + `debug=0` + `incremental=true`
  - 日常 `cargo run` / `pnpm tauri dev` 用这个，编译最快
- `[profile.dev.package."*"]`：依赖也用 `opt-level=0`
  - **关键提速点**：默认依赖走 release(opt-level=3) 全量优化非常慢；改成 0 后首次编译快 3-5 倍
  - 代价：依赖代码运行时未优化（你自己的逻辑不受影响）
  - 发布时用 `pnpm tauri build`（走 `[profile.release]`），自动覆盖
- `[profile.release]`：`codegen-units=8` + `lto=false`
  - 平衡编译速度与产物质量

### 2. sccache 编译缓存（`.cargo/config.toml`）

- 已设置 `RUSTC_WRAPPER=sccache`
- 缓存目录：`%LOCALAPPDATA%\Mozilla\sccache\cache`（默认 10 GiB 上限）
- **作用**：相同 crate + 相同编译选项的编译结果会命中缓存，从几十秒降到 <1 秒
- 首次编译填充缓存，第二次起命中

### 3. 可选：lld 链接器（未启用）

Windows MSVC 默认用 `link.exe`，对大型项目链接慢。如需进一步提速：

```bash
rustup component add llvm-tools-preview
```

然后编辑 `.cargo/config.toml`，取消 `[target.x86_64-pc-windows-msvc]` 下的注释。

---

## 日常开发

```bash
# 启动桌面应用（热重载，前端改动即时生效）
pnpm tauri dev

# 仅改 Rust 代码时，增量编译只重编改动处，通常秒级到几十秒
```

**重要**：日常开发用 `pnpm tauri dev`，不要用 `cargo build --release`。
`tauri dev` 用 dev profile（快），`tauri build` 用 release profile（慢但产物好）。

## 打包发布

```bash
# 完整构建（前端 + Rust release + 嵌入资源），生成可分发的二进制
pnpm tauri build

# 只要可执行文件，不要 NSIS 安装包（更快）
pnpm tauri build --no-bundle
```

## 换机器迁移

仓库里已包含全部编译提速配置（Cargo profile、sccache 接入、`.cargo/config.toml`）。
新机器**克隆后只需跑一行初始化脚本**，工具链就齐了：

```bash
git clone <repo>
cd veryagent-plus

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1
# 或 Git Bash
bash scripts/setup-dev.sh
```

脚本会自动：检查工具链 → 安装 sccache → `pnpm install` → `cargo fetch` → 启动 sccache 服务器。

### 为什么不能"纯拉取就行"

有一样东西**不在仓库里**，必须单独处理 —— **sccache 的缓存内容**：

- 它是几 GB 的二进制编译产物，不该也不在 git 里
- `sccache.exe` 是全局工具（装在 `~/.cargo/bin/`），不在项目里，脚本会自动装

**想要换机器也秒编译**，需要手动拷一次缓存（一次性操作）：

```bash
# 旧机器：打包缓存目录
# 路径：C:\Users\<用户名>\AppData\Local\Mozilla\sccache\cache

# 新机器：把旧缓存拷到同路径，然后
sccache --start-server
```

拷过去后，新机器编译本项目时，所有未改动的依赖会**直接命中缓存**，省掉全量编译。
不拷也行，只是新机器首次编译要重新填充缓存（和首次在本机一样慢一次）。

## sccache 常用命令

```bash
sccache --start-server          # 启动缓存服务器
sccache --stop-server           # 停止
sccache --show-stats            # 查看命中率
sccache --zero-stats            # 清零统计（不清缓存）
# 清空缓存：删除 %LOCALAPPDATA%\Mozilla\sccache\cache 目录
```

## 为什么之前那么慢

本次编译耗时长的根因是一次性的：

1. **全局重命名（codeg → veryagent）**：~200 个源文件被 sed 修改，触发大量 crate 重编，相当于半次全量
2. **反复编译**：每次 sed 改源码后再 `cargo build --release`，增量缓存被反复 invalidate
3. **`tauri build` 末尾再跑一次 release 编译**：与之前的 `cargo build --release` 重复

**日常开发不会出现这些情况**——增量编译只重编你改动的文件。配合 sccache，换机器也能快速恢复。

## 性能基准（本机参考）

- CPU：16 核
- 首次全量 `cargo check`（dev，含填充 sccache 缓存）：约 1 分 37 秒
- 首次全量 `pnpm tauri build --no-bundle`：约 10-15 分钟（release 优化）
- 二次 `pnpm tauri build`（sccache 命中 + 增量）：预计 2-4 分钟
- `pnpm tauri dev` 增量编译（改单个文件）：秒级到 30 秒
