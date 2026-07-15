# VeryAgent 构建与换机说明

这份文档解决两件事：

1. **本机改源码后，尽量快速重编**
2. **换机器后，尽量少走弯路，直接从仓库 Release 下载必要附件恢复构建**

> **日常开发联调（热更新 + 桌面进程不随终端/agent 被杀）** 请看：  
> [`dev-detached.zh-CN.md`](./dev-detached.zh-CN.md)  
> 推荐用根目录 `.\dev-detached.ps1`，不要每次都 `pnpm tauri dev`。

---

## 一、推荐工作流

### 1. 日常改代码后，优先用快速模式

直接双击项目根目录下的：

- `build-exe.bat`

默认行为：

- 复用已有 `out/` 前端产物
- 自动设置 `CARGO_BUILD_JOBS=2`
- 如果本机装了 `sccache`，自动启用
- 执行 `pnpm tauri build --no-bundle`
- 成功后生成：`src-tauri/target/release/veryagent.exe`

适合场景：

- 你主要改了 Rust / Tauri 代码
- 前端没大改
- 想尽快重新出一个可双击运行的 exe

---

### 2. 前端改动较大时，用完整模式

命令行进入项目根目录后运行：

```bat
build-exe.bat full
```

完整模式会：

1. 先执行 `pnpm build`
2. 再执行 `pnpm tauri build --no-bundle`

适合场景：

- 改了 React / Next.js 页面
- `out/` 可能已经过期
- 想确保 exe 内置的是最新前端页面

---

## 二、换机器时怎么最快恢复

### 目标

不要从零开始重新摸索，只恢复必要内容：

- 源码
- `out/` 前端产物
- sidecar
- 脚本与锁文件

---

### 1. 新机器先准备环境

至少需要：

- Node.js >= 22
- pnpm >= 10
- Rust stable
- Tauri 2 构建依赖（Windows 上需要 WebView2 / MSVC 工具链等）

然后在项目根目录执行：

```bash
pnpm install
```

> `pnpm install` 会触发 `postinstall`，自动复制 Monaco 相关资源，不要跳过。

---

### 2. 从仓库拉源码

拉主仓库源码即可。

源码仓库里保留的是：

- 源码
- `Cargo.lock`
- `pnpm-lock.yaml`
- `build-exe.bat`
- `prepare-release-assets.bat`
- 这份说明文档

---

### 3. 从仓库 Release 下载两个附件

推荐放在 Release 附件里的内容：

1. **out 附件**
   - 解压后得到 `out/`
2. **sidecar 附件**
   - 解压后得到 `veryagent-mcp-<target>.exe`

恢复方法：

#### 恢复 out

把下载得到的 `out/` 解压到项目根目录，使下面这个文件存在：

- `out/index.html`

#### 恢复 sidecar

把下载得到的 sidecar 复制到：

- `src-tauri/binaries/`

例如：

- `src-tauri/binaries/veryagent-mcp-x86_64-pc-windows-msvc.exe`

---

### 4. 运行快速构建脚本

恢复完后，直接双击：

- `build-exe.bat`

或者命令行执行：

```bat
build-exe.bat
```

如果 `out/` 已恢复、sidecar 已恢复，这一步会比从零构建快很多。

---

## 三、哪些内容放哪里

### 放源码仓库

这些建议长期保留在源码仓库：

- `Cargo.lock`
- `pnpm-lock.yaml`
- `build-exe.bat`
- `prepare-release-assets.bat`
- 文档说明
- 源码与配置文件

### 放仓库 Release 附件

这些建议作为 Release 附件提供下载：

- `out/`
- sidecar（`veryagent-mcp-*.exe`）
- 可选的 portable 包

### 不要放主仓库

这些不要直接提交进主分支：

- `src-tauri/target/`
- `node_modules/`
- `.next/`
- sccache cache
- pnpm store

原因很简单：

- 体积太大
- 平台相关
- 更新频繁
- 会让仓库越来越难用

---

## 四、如何准备 Release 附件

项目根目录下有一个脚本：

- `prepare-release-assets.bat`

它会把以下内容整理到：

- `.release-assets/`

输出包括：

- `.release-assets/out/`
- `.release-assets/sidecar/`
- `.release-assets/docs/build-recovery.zh-CN.md`
- `.release-assets/README.txt`

使用前提：

1. 你已经有 `out/`
2. 你已经准备好 sidecar

运行方式：

```bat
prepare-release-assets.bat
```

整理好后，把 `.release-assets/` 里的内容上传到仓库 Release 即可。

---

## 五、常见问题

### 1. 双击 `build-exe.bat` 后提示找不到 `out/index.html`

说明当前机器没有现成前端产物。

解决：

- 运行 `build-exe.bat full`
- 或从 Release 下载 `out/` 附件解压回来

---

### 2. 提示找不到 sidecar

检查这个文件是否存在：

- `src-tauri/binaries/veryagent-mcp-x86_64-pc-windows-msvc.exe`

如果没有：

- 从 Release 下载 sidecar 附件恢复
- 或手工执行：

```bash
pnpm tauri:prepare-sidecars
```

---

### 3. 为什么第一次换机还是会慢一点

因为即使恢复了 `out/` 和 sidecar：

- Rust 主 crate 还是要编
- 新机器环境第一次建索引/编依赖也需要时间

但会比完全从零开始稳定很多。

---

### 4. 什么时候必须用 `full` 模式

当你改了这些内容时，建议用：

```bat
build-exe.bat full
```

比如：

- 页面布局
- React 组件
- Next.js 路由
- 前端静态资源

如果主要改的是 Rust 逻辑，一般直接双击 `build-exe.bat` 就行。

---

## 六、最短操作版

### 本机快速重编

直接双击：

- `build-exe.bat`

### 前端大改后重编

```bat
build-exe.bat full
```

### 换机器快速恢复

1. 拉源码
2. `pnpm install`
3. 从 Release 下载 `out/`
4. 从 Release 下载 sidecar
5. 分别恢复到：
   - `out/`
   - `src-tauri/binaries/`
6. 双击 `build-exe.bat`
