//! Agent 子进程环境构建 — 继承 + 净化 + 叠加
//!
//! 设计哲学（对齐 AionCore 的 `agent_process_env`，但按桌面应用裁剪）：
//!
//! 1. **继承**：从当前进程环境全量继承。桌面应用由用户从 GUI 启动，
//!    进程环境就是用户的真实环境（代理变量、系统路径、语言设置全在里面），
//!    不需要像服务端那样去解析 shell profile。
//! 2. **净化**：只剔除"会破坏 agent 子进程"的黑名单（NODE_OPTIONS 等
//!    会影响 Node agent 启动的项、SSL_CERT 会干扰证书链校验的项、npm_* 命名空间）。
//!    网络变量（HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY）随继承天然保留，
//!    不需要特判注入——这是"继承式"相比"拼装式"的核心优势。
//! 3. **叠加**：按优先级覆盖——CLICOLOR 标记 < descriptor 默认 < 用户 env_json
//!    < model provider 级联 < 代理变量（继承的已在第 1 步，这里只补显式配置的）。
//!
//! 输出用于 ACP 子进程 spawn（`McpServerStdio::env` 或命令行 `KEY=VALUE` 前缀）。

use std::collections::BTreeMap;
use std::ffi::OsString;

use crate::network::proxy;

/// 强制子进程彩色输出（ANSI 日志不被吞）
const DEFAULT_COMMAND_COLOR_ENV: [(&str, &str); 1] = [("CLICOLOR_FORCE", "1")];

/// 从当前进程环境继承时要剔除的黑名单。
///
/// 这些变量要么会破坏 agent 子进程（NODE_OPTIONS/NODE_DEBUG 会改变 Node
/// agent 的运行时行为），要么在用户机器上有自定义值但会干扰子进程的网络
/// 证书校验（SSL_CERT_*）。`npm_*` 是 npm 配置命名空间，混入 agent 环境
/// 会让其 npm/npx 行为与本机全局配置不一致——全部剔除。
///
/// Windows 特殊环境变量（`=C:=`, `=D:=` 等）由 `GetEnvironmentStrings` 返回，
/// 记录每个驱动器的当前目录。它们以 `=` 开头，在 `build_agent_env` 中
/// 通过 `retain` 统一过滤，不会进入子进程环境——否则在 `KEY=VALUE` 前缀
/// 解析路径（`AcpAgent::from_args`）中会被误认为命令而非环境变量，
/// 导致 spawn 失败（`os error 123` / `ERROR_INVALID_NAME`）。
const DROP_KEYS: &[&str] = &[
    "NODE_OPTIONS",
    "NODE_INSPECT",
    "NODE_DEBUG",
    "CLAUDECODE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
];

/// 构建 agent 子进程环境变量列表。
///
/// 返回 `Vec<(OsString, OsString)>`，兼容 `McpServerStdio::env`（`EnvVariable`）
/// 与命令行 `KEY=VALUE` 前缀两种注入方式。
pub(crate) fn build_agent_env(
    runtime_env: &BTreeMap<String, String>,
) -> Vec<(OsString, OsString)> {
    // 1. 继承当前进程环境
    let mut merged: BTreeMap<OsString, OsString> = std::env::vars_os().collect();

    // 2. 净化黑名单 + Windows 特殊驱动器变量（`=C:=`/`=D:=`）
    for key in DROP_KEYS {
        merged.remove(std::ffi::OsStr::new(key));
    }
    merged.retain(|key, _| {
        let k = key.to_string_lossy();
        !k.starts_with("npm_") && !k.starts_with('=')
    });

    // 3. 叠加（后者覆盖前者）
    for (key, value) in DEFAULT_COMMAND_COLOR_ENV {
        merged.insert(OsString::from(key), OsString::from(value));
    }
    for (key, value) in runtime_env {
        merged.insert(OsString::from(key), OsString::from(value));
    }
    // 代理变量：继承的已保留；这里把"显式配置到当前进程"的代理也确保在
    // （正常情况下与继承重复，无副作用；防某些启动路径清了环境再 spawn）。
    for (key, value) in proxy::current_proxy_env_vars() {
        merged.insert(OsString::from(key), OsString::from(value));
    }

    // 4. officecli 安装目录补进 PATH（可能不在用户 shell PATH 里）
    let mut merged_str: BTreeMap<String, String> = merged
        .into_iter()
        .map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned()))
        .collect();
    crate::acp::connection::prepend_officecli_path(&mut merged_str);

    merged_str
        .into_iter()
        .map(|(k, v)| (OsString::from(k), OsString::from(v)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn drops_blacklist_keys() {
        // 构造一个带黑名单的环境快照来验证净化逻辑（不污染真实进程环境）
        let mut env = BTreeMap::new();
        env.insert(OsString::from("NODE_OPTIONS"), OsString::from("--max-old-space-size=1"));
        env.insert(OsString::from("npm_config_registry"), OsString::from("http://x"));
        env.insert(OsString::from("PATH"), OsString::from("/usr/bin"));
        env.insert(OsString::from("HTTP_PROXY"), OsString::from("http://proxy:1"));

        let built = clean_for_test(env);
        assert!(!built.contains_key(OsStr::new("NODE_OPTIONS")));
        assert!(!built.contains_key(OsStr::new("npm_config_registry")));
        assert!(built.contains_key(OsStr::new("HTTP_PROXY")), "网络变量必须保留");
        assert!(built.contains_key(OsStr::new("PATH")));
    }

    #[test]
    fn drops_windows_drive_special_env_vars() {
        // Windows 的 `GetEnvironmentStrings` 会返回记录每个驱动器当前目录的
        // 特殊变量（`=C:=`, `=D:=`）。它们以 `=` 开头，不是合法的环境变量名，
        // 若进入 `KEY=VALUE` 前缀解析会被误判为命令，导致 spawn 失败。
        let mut env = BTreeMap::new();
        env.insert(OsString::from("=C:"), OsString::from("C:\\Users\\test"));
        env.insert(OsString::from("=D:"), OsString::from("D:\\Projects"));
        env.insert(OsString::from("PATH"), OsString::from("C:\\Windows"));
        env.insert(OsString::from("APPDATA"), OsString::from("C:\\Users\\test\\AppData"));

        let built = clean_for_test(env);
        assert!(!built.contains_key(OsStr::new("=C:")), "`=C:` 驱动器变量必须剔除");
        assert!(!built.contains_key(OsStr::new("=D:")), "`=D:` 驱动器变量必须剔除");
        assert!(built.contains_key(OsStr::new("PATH")));
        assert!(built.contains_key(OsStr::new("APPDATA")));
    }

    /// 测试用：对所有系统预先构建完整环境（继承+净化），仅验证黑名单逻辑。
    fn clean_for_test(
        base: BTreeMap<OsString, OsString>,
    ) -> BTreeMap<OsString, OsString> {
        let mut merged = base;
        for key in DROP_KEYS {
            merged.remove(OsStr::new(key));
        }
        merged.retain(|key, _| {
            let k = key.to_string_lossy();
            !k.starts_with("npm_") && !k.starts_with('=')
        });
        merged
    }
}