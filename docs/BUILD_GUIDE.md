# VeryAgent 跨机器编译与部署指南

本文档记录了将 VeryAgent 项目从一台机器迁移到另一台机器（或更换磁盘路径）时可能遇到的问题及解决方案，供开发者参考。

---

## 1. 环境要求

| 工具 | 最低版本 | 备注 |
|------|----------|------|
| Node.js | ≥ 22 | 推荐 v22.x |
| pnpm | 11.9.0 | 由 `packageManager` 字段指定，corepack 自动管理 |
| Rust | stable (2021 edition) | 通过 rustup 安装 |
| Tauri 2 | 依赖 Rust + WebView2 | Windows 需 WebView2 Runtime（Win10/11 已内置） |
| Git | 任意 | 用于代码版本管理 |

### 先记住 4 个关键点

1. **桌面开发必须用 `pnpm tauri dev` 启动**，不要直接双击或运行 `src-tauri\target\debug\veryagent.exe`。
2. **这个项目的 Tauri dev 依赖前端 dev server**，因为 `src-tauri/tauri.conf.json` 里配置了 `devUrl: http://localhost:3000`，并且 `beforeDevCommand` 会先跑 `pnpm tauri:before-dev`。
3. **换机器后最容易出问题的是 `node_modules` 和 pnpm store 路径**。如果是整包拷项目，最稳妥做法仍然是：删除 `node_modules` 后重新 `pnpm install`（会优先复用本地 store，不一定重新下载）。
4. **如果启动时报 migration / 数据库错误，不要先怀疑代码**，优先检查是否把旧机器数据库也一起拷过来了。

### Windows 特殊依赖

- **MSVC 工具链**：通过 Visual Studio Build Tools 安装（`find-msvc-tools` crate 会自动检测）
- **WebView2 Runtime**：Windows 10/11 已内置；旧版 Windows 需单独安装

### 首次安装工具链

```powershell
# 安装 Node.js（推荐 v22）
winget install OpenJS.NodeJS.LTS

# 启用 corepack（让 pnpm 版本自动匹配 packageManager 字段）
corepack enable

# 安装 Rust
winget install Rustlang.Rustup.MSVC

# 安装 Tauri CLI（可选，pnpm tauri 已包含）
pnpm add -D @tauri-apps/cli
```

---

## 2. ⚠️ 跨机器迁移常见问题

### 问题 A：`node_modules` 元数据包含旧路径

**现象**：运行 `pnpm install` 或 `pnpm tauri dev` 时，pnpm 报错尝试在不存在的盘符创建 `.pnpm-store`：

```
[ENOENT] ENOENT: no such file or directory, mkdir 'D:\.pnpm-store\v11'
```

**原因**：`node_modules/.modules.yaml` 中硬编码了原始机器的路径（如 `storeDir` 和 `virtualStoreDir`）。当项目被整体拷贝到新机器/新盘符时，这些路径不再有效。

**解决方案**：

1. **推荐：修复 `.modules.yaml` 中的路径**

   用 Node.js 一行命令替换旧盘符/路径：

   ```bash
   node -e "
     const fs = require('fs');
     let c = fs.readFileSync('node_modules/.modules.yaml', 'utf8');
     c = c.replace('D:\\\\.pnpm-store\\\\v11', 'E:\\\\.pnpm-store\\\\v11');
     c = c.replace('D:\\\\old_path\\\\veryAgent\\\\veryagent-plus', 'E:\\\\new_path\\\\veryAgent\\\\veryagent-plus');
     fs.writeFileSync('node_modules/.modules.yaml', c);
   "
   ```

   > ⚡ 注意：将上面的 `D:` 和 `E:` 替换为你实际的旧/新盘符，`old_path` 和 `new_path` 替换为实际目录路径。

2. **备选：删除 `node_modules` 重新安装（较慢）**

   ```bash
   rm -rf node_modules
   pnpm install
   ```

3. **推荐：删除 `node_modules` 后从本地 store 重装（彻底修复硬链接）**

   跨盘符拷贝时，pnpm 的硬链接会断裂为独立文件副本，导致部分包的内部依赖链断裂（如 `Cannot find package '@formatjs/icu-messageformat-parser'`）。此时仅修复 `.modules.yaml` 路径是不够的，需要重建硬链接：

   ```bash
   # 删除断裂的 node_modules
   rm -rf node_modules    # Linux/macOS
   # 或 PowerShell:
   Remove-Item node_modules -Recurse -Force

   # 从本地 pnpm store 重新链接（不会重新下载）
   pnpm install
   ```

   > ⚡ `pnpm install` 会从本地 store (`E:\.pnpm-store\v11`) 建立硬链接，不需要网络下载，约 3-5 分钟完成。

**预防措施**：跨机器迁移时，最稳妥的方式是 **直接删除 `node_modules` 后执行 `pnpm install`**，确保所有硬链接指向正确的本地 store：

```bash
# Step 1: 确保本地 pnpm store 存在且有内容
ls ~/.pnpm-store  # 或 Windows: dir E:\.pnpm-store\v11\files /b

# Step 2: 删除旧 node_modules（跨盘符拷贝时硬链接已断裂）
rm -rf node_modules

# Step 3: 从本地 store 重新链接
pnpm install

# Step 4: 验证依赖完整性
pnpm list --depth 0
```

---

### 问题 B：非 TTY 环境下 pnpm 中止

**现象**：CI 或脚本环境运行 `pnpm install` 时报：

```
[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY
```

**解决方案**：

在项目 `pnpm-workspace.yaml` 中添加：

```yaml
confirmModulesPurge: false
```

或在命令前设置环境变量：

```bash
# Linux/macOS
CI=true pnpm install

# Windows PowerShell
$env:CI="true"; pnpm install

# Windows CMD
set CI=true && pnpm install
```

---

### 问题 C：数据库迁移版本不匹配

**现象**：桌面程序启动后 panic：

```
Failed to setup app: migration error: Migration file of version 'm20260708_000001_xxx' is missing,
this migration has been applied but its file is missing
```

**原因**：SQLite 数据库是从旧机器拷贝过来的，其中记录了某些迁移版本，但新代码中这些迁移文件已被移除或合并。

**解决方案**：

删除旧数据库让它重新创建（**首次迁移会自动执行**）：

```bash
# Windows — 桌面开发模式数据库（Tauri identifier: app.veryagent）
del "%APPDATA%\app.veryagent\veryagent-dev.db"
del "%APPDATA%\app.veryagent\veryagent-dev.db-shm"
del "%APPDATA%\app.veryagent\veryagent-dev.db-wal"
del "%APPDATA%\app.veryagent\veryagent-dev.db.lock"

# Windows — 服务器模式数据库
del "%APPDATA%\veryagent\veryagent.db"
del "%APPDATA%\veryagent\veryagent.db-shm"
del "%APPDATA%\veryagent\veryagent.db-wal"
del "%APPDATA%\veryagent\veryagent.db.lock"

# Linux/macOS（数据库位置）
rm ~/.local/share/veryagent/veryagent.db*
```

> 💡 开发模式和发布模式的数据库文件名不同：开发模式为 `veryagent-dev.db`，发布模式为 `veryagent.db`。

> ⚠️ 注意：删除数据库会丢失所有本地配置（智能体设置、文件夹、自动化等）。如需保留数据，应手动检查 `seaql_migrations` 表并删除不存在的迁移记录。

---

### 问题 D：pnpm 版本不匹配

**现象**：全局安装的 pnpm 版本与 `packageManager` 字段指定版本不一致，导致行为差异。

**原因**：项目 `package.json` 中 `"packageManager": "pnpm@11.9.0"`，corepack 会自动下载对应版本。但全局 pnpm 可能是不同版本（如 10.x），两者对 store 路径的默认解析逻辑可能不同。

**解决方案**：

确保启用 corepack：

```bash
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

验证版本一致：

```bash
cd veryagent-plus && pnpm --version  # 应输出 11.9.0
```

---

## 3. 标准编译流程

### 3.1 首次编译（从源码）

```bash
cd veryagent-plus

# 推荐：新机器先跑初始化脚本
# PowerShell
powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1
# 或 Git Bash
bash scripts/setup-dev.sh

# 启动桌面开发模式（会自动准备 sidecar + 启动前端 dev server + 启动 Tauri）
pnpm tauri dev
```

> 首次 Rust 编译约需 5-8 分钟（取决于机器性能），后续增量编译只需几秒。

> 如果你只是想确认前端能不能起来，也可以单独执行 `pnpm dev`，这只会启动 Next.js（3000 端口），不会启动桌面壳。

### 3.2 仅前端开发（不编译 Rust）

```bash
pnpm dev          # 启动 Next.js dev server (http://localhost:3000)
```

### 3.3 仅服务器模式（无 Tauri/GUI）

```bash
# 开发模式
pnpm server:dev

# 构建发布版
pnpm server:build
```

### 3.4 发布构建

```bash
# 桌面应用（含自动 sidecar 编译）
pnpm tauri build

# 服务器模式
pnpm server:build
```

---

## 4. 跨机器迁移完整步骤

将项目从旧机器完整拷贝到新机器后，按以下步骤操作：

```bash
# Step 1: 检查 node_modules 元数据路径
grep -E "storeDir|virtualStoreDir" node_modules/.modules.yaml

# Step 2: 删除旧 node_modules 并从本地 store 重新链接（推荐）
# 跨盘符拷贝时硬链接会断裂，仅修复 .modules.yaml 不够彻底
rm -rf node_modules
# Windows PowerShell: Remove-Item node_modules -Recurse -Force
pnpm install

# Step 3: 删除旧数据库（或按需保留）
# Windows — 桌面开发模式
del "%APPDATA%\app.veryagent\veryagent-dev.db*"
# Windows — 服务器模式
del "%APPDATA%\veryagent\veryagent.db*"
# Linux/macOS
rm -f ~/.local/share/veryagent/veryagent.db*

# Step 4: 验证依赖可读
pnpm list --depth 0

# Step 5: 启动开发模式
pnpm tauri dev
```

### 为什么不能直接运行 `veryagent.exe`

因为当前开发配置不是把前端资源直接打进 dev exe，而是：

- `package.json:18` 先跑 `pnpm tauri:before-dev`
- `src-tauri/tauri.conf.json:7-8` 指定：
  - `beforeDevCommand: pnpm tauri:before-dev`
  - `devUrl: http://localhost:3000`

这意味着开发期的桌面壳会去连接本地 3000 端口的 Next.js dev server。
如果你直接运行 `src-tauri\\target\\debug\\veryagent.exe`，很容易看到 **refused to connect**，因为它找不到 dev server。

正确做法：

- 开发：`pnpm tauri dev`
- 只看前端：`pnpm dev`
- 真正可分发桌面包：`pnpm tauri build`

---

## 5. Docker 部署（无需关注路径问题）

Docker 环境下不存在跨机器路径问题，因为容器内路径是固定的：

```bash
# 使用 Docker Compose
docker compose up -d

# 或直接 Docker 运行
docker run -d -p 3080:3080 \
  -v veryagent-data:/data \
  -v /path/to/projects:/projects \
  -e VERYAGENT_TOKEN=your-secret-token \
  ghcr.io/plhys/veryagent-plus:latest
```

---

## 6. 推荐的换机器操作顺序（Windows）

如果你是把整个项目目录和依赖都拷到了新机器，建议按这个顺序做：

```powershell
cd E:\AIcode\veryAgent\veryagent-plus

# 1) 启用 corepack，确保 pnpm 版本跟项目一致
corepack enable
corepack prepare pnpm@11.9.0 --activate

# 2) 运行初始化脚本（会检查工具链、安装 sccache、pnpm install、cargo fetch）
powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1

# 3) 如果你是跨盘符/跨机器整包复制，仍建议重建 node_modules 硬链接
Remove-Item node_modules -Recurse -Force
pnpm install

# 4) 如启动报 migration / 数据库异常，再清理旧数据库
# del "%APPDATA%\app.veryagent\veryagent-dev.db*"

# 5) 启动桌面开发模式
pnpm tauri dev
```

如果你还把旧机器的 sccache 也拷过来了：

- Windows 默认路径：`%LOCALAPPDATA%\Mozilla\sccache\cache`
- 拷完后执行：`sccache --start-server`

这样新机器首次编译会明显更快。

## 7. 常用命令速查

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 仅前端开发（Next.js dev server） |
| `pnpm tauri dev` | 完整桌面开发模式 |
| `pnpm tauri build` | 桌面发布构建 |
| `pnpm server:dev` | 服务器开发模式 |
| `pnpm server:build` | 服务器发布构建 |
| `pnpm eslint .` | 前端 lint |
| `pnpm test` | 前端测试 |
| `pnpm test:coverage` | 前端覆盖率 |
| `pnpm build` | 仅前端静态导出 |
| `cargo check` | Rust 类型检查（桌面模式） |
| `cargo check --no-default-features --bin veryagent-server` | Rust 类型检查（服务器模式） |
| `cargo test --features test-utils` | Rust 测试 |

---

## 8. 环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VERYAGENT_PORT` | `3080` | HTTP 端口 |
| `VERYAGENT_HOST` | `0.0.0.0` | 绑定地址 |
| `VERYAGENT_TOKEN` | _(随机)_ | 认证令牌 |
| `VERYAGENT_DATA_DIR` | `~/.local/share/veryagent` | 数据库目录 |
| `VERYAGENT_STATIC_DIR` | `./web` 或 `./out` | 前端静态资源目录 |
| `VERYAGENT_MCP_BIN` | _(自动)_ | veryagent-mcp 伴生进程路径 |
