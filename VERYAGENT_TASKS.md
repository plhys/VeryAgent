# zCode 剩余任务分配

当前状态：`commands/acp.rs` 已拆分为目录模块：
- `commands/acp/mod.rs`（5,679行）— 辅助函数
- `commands/acp/commands.rs`（4,717行）— Tauri 命令（已完成）
- Rust 编译通过 ✅，前端 TypeScript 编译通过 ✅

---

## 任务 A：拆分 acp/mod.rs 前半部分 — 二进制/版本工具函数（zCode）

**文件**：`src-tauri/src/commands/acp/mod.rs`

**目标**：将 npm/uvx 二进制管理、版本解析相关函数提取到 `commands/acp/binary.rs`

**函数范围**（约第 87-950 行）：
- `is_version_like`, `normalize_version_candidate`, `version_from_package_spec`
- `sanitize_custom_version`, `build_npm_install_spec`, `apply_custom_version_to_url`
- `is_cmd_available`, `resolve_command_on_path`, `resolve_uvx_command`, `uvx_agent_launchable`
- `resolve_npx_command`, `npm_global_prefix_*`, `resolve_npx_command_from_*`
- `is_npm_command_candidate`, `verify_agent_installed`
- `detect_npm_global_version`, `npm_list_version`, `detect_local_version`
- `run_npm_streaming`, `install_npm_global_package_streaming`, `install_npm_to_user_prefix_streaming`
- `uninstall_npm_global_package`, `uninstall_npm_from_user_prefix`

**做法**：
1. 在 mod.rs 中添加 `pub mod binary;`
2. 创建 `commands/acp/binary.rs`，移入上述函数
3. 在 binary.rs 顶部加 `use super::*;` 引用 mod.rs 的公共类型
4. 在 mod.rs 中删除已移走的函数
5. `cargo check` 验证

---

## 任务 B：拆分 acp/mod.rs 后半部分 — 智能体配置函数

**文件**：`src-tauri/src/commands/acp/mod.rs`（任务 A 完成后）

**目标**：将各智能体的配置读写函数提取到独立文件

**提取内容**：
- **Codex 配置** → `commands/acp/codex_config.rs`
  - `codex_home_dir`, `codex_config_toml_path`, `codex_auth_json_path`
  - `load_codex_auth_json_raw`, `load_codex_config_toml_raw`
  - `codex_config_projection_from_toml`, `persist_codex_local_config`, `persist_codex_native_config_files`
- **Cline 配置** → `commands/acp/cline_config.rs`
  - `cline_data_dir`, `cline_global_state_path`, `cline_secrets_path`
  - `cline_api_key_field_for_provider`, `cline_model_id_keys_for_provider`
  - `load_cline_secrets_json_raw`, `load_cline_local_config_json`, `persist_cline_local_config`
- **OpenCode 配置** → `commands/acp/opencode_config.rs`
  - `opencode_config_dir`, `opencode_*_config_path`, `resolve_opencode_config_path`
  - `opencode_auth_json_path`, `load_opencode_auth_json_raw`, `persist_opencode_auth_json`
- **Kimi Code 配置** → `commands/acp/kimi_config.rs`
  - `kimi_code_*`, `kimi_*`, `seed_kimi_*`, `remove_kimi_*`, `project_kimi_*`
  - `load_kimi_code_config_json`, `build_kimi_managed_spec`
- **Pi 配置** → `commands/acp/pi_config.rs`
  - `pi_agent_dir`, `pi_settings_json_path` 以及所有 `pi_*` 函数
- **技能存储** → `commands/acp/skills.rs`
  - `SkillStorageSpec`, `skill_storage_spec_for_agent`, 所有技能相关函数

**做法**（每个文件单独做，做完一个验证一个）：
1. 在 mod.rs 中添加对应的 `pub mod xxx;`
2. 创建文件，移入函数，加 `use super::*;`
3. 从 mod.rs 删除已移走的函数
4. `cargo check` 验证

---

## 任务 C：拆分 acp/connection.rs

**文件**：`src-tauri/src/acp/connection.rs`（6,382行）

**目标**：转换为目录模块，按功能拆分子模块

**步骤**：
1. `mkdir acp/connection && mv acp/connection.rs acp/connection/mod.rs`
2. 添加 `pub mod conn_loop; pub mod permission; pub mod runtime_fs; pub mod runtime_terminal; pub mod mcp_injection;`
3. 在 mod.rs 末尾加 `pub use conn_loop::*;` 等 re-export

**子模块划分**：
- `conn_loop.rs` — 主连接循环：`build_agent`, `spawn_agent_connection`, session 相关函数
- `permission.rs` — 权限处理：`map_session_config_*`, `emit_session_config_*`, `emit_selectors_ready`
- `runtime_fs.rs` — 文件系统运行时：所有 `FileSystemRuntime` 交互代码
- `runtime_terminal.rs` — 终端运行时：所有 `TerminalRuntime` 交互代码
- `mcp_injection.rs` — MCP 注入：`inject_veryagent_mcp`, `load_mcp_servers_for_agent`, `locate_veryagent_mcp_binary`, `companion_features_arg`, `agent_delivers_wire_mcp`

**注意事项**：
- `mod.rs` 保留公共常量（`DEFAULT_COMMAND_COLOR_ENV`）、公共辅助函数（`merge_agent_env`, `prepend_dir_to_path_env`, `resolve_working_dir`）、和 `spawn_agent_connection` 入口
- 每个子模块顶部加 `use super::*;`
- 不要改函数体，纯机械移动
- 每步验证 `cargo check`

---

## 任务 D：拆分 acp/manager.rs

**文件**：`src-tauri/src/acp/manager.rs`（5,286行）

**目标**：转换为目录模块，按功能拆分子模块

**步骤**：
1. `mkdir acp/manager && mv acp/manager.rs acp/manager/mod.rs`
2. 添加 `pub mod lifecycle; pub mod connection_pool; pub mod event;`

**子模块划分**：
- `mod.rs` — `ConnectionManager` struct 定义 + 基础方法（`new`, `clone_ref`, `install_delegation`）+ 辅助类型
- `lifecycle.rs` — 生命周期：`spawn_agent`, `send_prompt`, `cancel`, `fork_session`, `disconnect`
- `connection_pool.rs` — 连接池：`touch`, `sweep_idle`, `refresh_connection_staleness`, `list_connections`, `get_state`, `probe_agent_options`
- `event.rs` — 事件/反馈/问题：`submit_feedback`, `read_pending_feedback`, `register_question`, `answer_question`

**注意事项**：
- `ConnectionManager` struct 定义留在 `mod.rs`
- 其他文件通过 `impl ConnectionManager { ... }` 添加方法
- 每个子模块顶部加 `use super::ConnectionManager;`
- 每步验证 `cargo check`

---

## 执行顺序

- **任务 A 和 C 和 D** 互不依赖，可并行执行
- **任务 B** 依赖任务 A（等 A 完成后才能确定 mod.rs 的剩余行数）
- 建议：A+C+D 同时开始，A 完成后立即启动 B

## 验证标准

每完成一个子模块提取后：
```bash
cd src-tauri && cargo check
```
必须零错误。如遇编译错误，检查：
1. 子模块文件是否缺少 `use super::*;`
2. 子模块文件是否缺少必要的 `use` 导入
3. mod.rs 中是否遗留了孤立文档注释（`///` 后面没有函数）
