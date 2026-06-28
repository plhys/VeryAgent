# VeryAgent 项目计划

## ✅ 已完成

- [x] 核心身份改名：appId、productName、executableName、数据目录
- [x] 所有 package.json 改名：@aionui → @veryagent
- [x] 源码全部替换：522 个文件，日志前缀、版权头、导入路径
- [x] UI 界面：HTML 标题、meta 标签、i18n 翻译（102 个文件）
- [x] CI/CD 工作流：构建产物名、安装路径、AI 审查提示词
- [x] 清理：删除 .aionui、.specify、无用 workflow
- [x] GitHub 仓库：plhys/AionUi → plhys/VeryAgent
- [x] 本地目录：D:\aicodework\AionUi-main → D:\aicodework\VeryAgent
- [x] 运行验证：VeryAgent 成功启动，数据目录与 AionUi 完全隔离
- [x] VeryAgentCore Rust 代码全部改名（21 个 crate，aionui → veryagent）
- [x] VeryAgentCore GitHub 仓库：plhys/AionCore → plhys/VeryAgentCore
- [x] VeryAgentCore 编译成功（修复 aionui.rs → veryagent.rs 重命名遗漏）
- [x] VeryAgent Desktop 开发模式启动成功
- [x] 添加 VERYAGENT_DEV_USERDATA_DIR 环境变量，数据目录可在工作区内
- [x] 更新 binaryResolver.ts 支持 veryagent-core / aioncore 双名查找
- [x] 更新 prepare-aioncore.js 指向 plhys/VeryAgentCore
- [x] 复制 veryagent-core.exe 到 resources/bundled-aioncore/
- [x] 代码推送到 GitHub

## 📋 待做

- [ ] 重写 README.md
- [ ] 替换 resources/ 里的旧图片（6 个 AionUi 图片）
- [ ] 合并 feature/dev-setup 到 main 分支

## 启动命令

```bash
# VeryAgent 开发模式
cd D:\aicodework\VeryAgent
export AIONUI_BACKEND_BIN="D:\aicodework\VeryAgent\resources\bundled-aioncore\win32-x64\aioncore.exe"
bun run dev

# 杀掉残留进程
taskkill /F /IM electron.exe 2>/dev/null
taskkill /F /IM aioncore.exe 2>/dev/null
```

## 关键路径

| 项目 | 本地 | GitHub |
|------|------|--------|
| VeryAgent | D:\aicodework\VeryAgent | https://github.com/plhys/VeryAgent |
| VeryAgentCore | D:\aicodework\VeryAgentCore | https://github.com/plhys/VeryAgentCore |