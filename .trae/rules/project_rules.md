# VeryAgent 开发踩坑记录

## 白屏问题（启动 dev 桌面版白屏 + 报错"AionCore 无法启动"）

### 根本原因
`bun run dev` 启动时，`AIONUI_BACKEND_BIN` 环境变量在 Windows PowerShell 中没有传递给 Electron 主进程，导致 `resolveBinaryPath()` 找不到 `veryagent-core.exe`，后端启动失败，弹窗"安装不完整"，白屏。

### 修复方法
启动命令必须显式设置 `AIONUI_BACKEND_BIN` 环境变量：

```powershell
$env:AIONUI_BACKEND_BIN = "D:\aicodework\VeryAgent-code-workspace\VeryAgent\resources\bundled-aioncore\win32-x64\veryagent-core.exe"; bun run dev
```

不需要设置 `$env:VERYAGENT_DEV_USERDATA_DIR`，Electron 开发模式会自己用默认路径。

### 不要做的
- 不要改 `ELECTRON_RENDERER_URL` 的加载逻辑
- 不要动 `app.isPackaged` 的判断条件
- 不要改 `index.ts` 的 renderer 加载部分

### 额外修复（已做）
- `index.ts` 第 476 行：`ELECTRON_RENDERER_URL` 加了 `|| 'http://localhost:5173'` fallback
- `index.ts` 第 487 行：加了 `else if (rendererUrl)` 分支，确保 dev 模式下即使环境变量缺失也能走 loadURL
- `InstallationIntegrityDialog.tsx`：弹窗改为 `closable: true`，避免卡死

### 网页版（bun run webui）
- 端口固定 25809
- 数据目录：`C:\Users\EVAN\.veryagent-web-dev`
- 登录：先 `bun run resetpass` 重置密码