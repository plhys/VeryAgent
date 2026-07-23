# 构建与发布指南

## 架构概览

VeryAgent 是 **Tauri 2 + Next.js 16** 桌面应用，编译分为三层：

| 层 | 工具 | 首次耗时 | 缓存后 | 说明 |
|---|---|---|---|---|
| JS/TS 前端 | `pnpm install` + `next dev` | ~10 min | ~1 min | pnpm 缓存 + webpack HMR |
| Rust 后端 | `cargo build`（随 Tauri 触发） | ~3 min | ~30-60s | Swatinem/rust-cache CI 缓存 |
| 侧边车 MCP | `pnpm tauri:prepare-sidecars` | 含在上述流程中 | 同上 | `veryagent-mcp` CLI 工具 |

## 本地开发

### 环境要求
- Node.js ≥ 22
- pnpm ≥ 11
- Rust stable (2021 edition)
- Windows: WebView2 Runtime（GitHub Actions runner 自带，本地需安装）

### 推荐方式（Windows 日常开发）
前后端拆分启动，避免每次冷启动完整 Tauri：

```powershell
# 一键启动：后台前端 + 增量编 debug + 独立 exe
.\dev-detached.ps1
```

### 完整 Tauri 模式（偶发排查用）
```bash
pnpm install                # 首次约 10 分钟
pnpm tauri dev              # 首次 Rust 编译 ~3 分钟，后续 ~30 秒
```

### 注意事项
1. **首次 `out/` 目录**：`tauri.conf.json` 要求 `frontendDist = "../out"`，dev 模式下需要手动创建：
   ```bash
   mkdir out && echo "" > out/.gitkeep
   ```
2. **Sidecar 跳过**：只开发前端时可设环境变量跳过 sidecar 编译：
   ```bash
   set VERYAGENT_SKIP_SIDECAR=1
   pnpm tauri dev
   ```

## CI / CD 自动构建

### Workflows

| Workflow | 文件 | 触发 | 产物 |
|---|---|---|---|
| Release | `.github/workflows/release.yml` | push tag `v*` 或手动触发 | Windows exe, macOS DMG/.app, Linux — 发布到 GitHub Releases |
| Snapshot | `.github/workflows/snapshot.yml` | push `main` / `dev` 或手动触发 | Windows exe（Actions Artifacts，保留 7 天） |

### 打包正式版本
```bash
#  bump version in src-tauri/Cargo.toml & package.json
git tag v0.9.8
git push --tags
```

CI 会自动：
1. 在所有平台构建
2. 使用 rust-cache 缓存加速
3. 上传产物到 GitHub Releases（draft 状态，需手动确认）
4. 自动生成 release notes

### 下载已构建的 exe（换机器专用）
前往 [Releases](https://github.com/plhys/VeryAgent/releases)，下载最新的安装包，双击运行。

## 构建脚本参考

| 脚本 | 用途 |
|---|---|
| `build-exe.bat` | 快速构建 Windows exe（复用已有 out/） |
| `build-exe.bat full` | 完整构建（重建前端 + exe） |
| `build-release.bat` | 完整 release 构建（带 sccache 支持） |
| `prepare-release-assets.bat` | 整理 out/ 和 sidecar，便于上传 Release |
| `dev-detached.ps1` | 拆分启动：独立前端 + 按需 Rust debug + exe |

详见 [`docs/build-recovery.zh-CN.md`](docs/build-recovery.zh-CN.md)。
