# Agent notes (veryAgent)

## 提交 / 推送前必做

1. **写版本更新说明**  
   - 更新根目录 [`CHANGELOG.md`](./CHANGELOG.md)  
   - 有实质功能时写清：新增 / 变更 / 修复 / 文档  
   - 未抬版本号时放在 `[Unreleased]`；正式发版再挪到版本章节并改  
     `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`
2. **说明提交范围**  
   - 若使用 `git add -A`，在 CHANGELOG 或提交说明里写明「含工作区其他智能体已落盘改动」  
   - 若只交本会话文件，不要 `add -A`，并在说明里写「仅本会话」
3. 需要时同步 [`DEV_STATUS.md`](./DEV_STATUS.md) 的已完成 / 待定

## 日常开发启动

优先 `.\dev-detached.ps1` 或 `.\dev-detached.bat`，见 [`docs/dev-detached.zh-CN.md`](./docs/dev-detached.zh-CN.md)。  
若 `.ps1` 双击打开文件夹，改用 `.bat` 即可。  
不要默认每次 `pnpm tauri dev`（慢，且进程易随终端/agent 退出被带走）。
