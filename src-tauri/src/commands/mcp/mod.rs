pub mod adapters;
pub mod agent_servers;
pub(crate) use agent_servers::*;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::app_error::AppCommandError;

use adapters::AgentConfigAdapter;

const MARKETPLACE_OFFICIAL: &str = "official_registry";
const MARKETPLACE_SMITHERY: &str = "smithery";
static MARKETPLACE_HTTP_CLIENT: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .user_agent("veryagent-mcp-market/1.0")
        .build()
        .map_err(|e| format!("failed to initialize marketplace HTTP client: {e}"))
});

fn mcp_invalid_input(message: impl Into<String>) -> AppCommandError {
    AppCommandError::invalid_input(message)
}

fn mcp_not_found(message: impl Into<String>) -> AppCommandError {
    AppCommandError::not_found(message)
}

fn mcp_configuration_invalid(message: impl Into<String>) -> AppCommandError {
    AppCommandError::configuration_invalid(message)
}

fn mcp_network(message: impl Into<String>) -> AppCommandError {
    AppCommandError::network(message)
}

/// Build the parameter map for an i18n-tagged MCP error.
fn mcp_i18n_params<const N: usize>(pairs: [(&str, &str); N]) -> BTreeMap<String, String> {
    pairs
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpAppType {
    ClaudeCode,
    Codex,
    Gemini,
    OpenClaw,
    OpenCode,
    Cline,
    Hermes,
    CodeBuddy,
    KimiCode,
    MimoCode,
}
#[derive(Debug, Clone, Serialize)]
pub struct LocalMcpServer {
    pub id: String,
    pub spec: Value,
    pub apps: Vec<McpAppType>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpMarketplaceProvider {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpMarketplaceItem {
    pub provider_id: String,
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub homepage: Option<String>,
    pub remote: bool,
    pub verified: bool,
    pub icon_url: Option<String>,
    pub latest_version: Option<String>,
    pub protocols: Vec<String>,
    pub owner: Option<String>,
    pub namespace: Option<String>,
    pub downloads: Option<u64>,
    pub score: Option<f64>,
    pub is_deployed: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpMarketplaceInstallParameter {
    pub key: String,
    pub label: String,
    pub description: Option<String>,
    pub required: bool,
    pub secret: bool,
    pub kind: String,
    pub default_value: Option<Value>,
    pub placeholder: Option<String>,
    pub enum_values: Vec<String>,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpMarketplaceInstallOption {
    pub id: String,
    pub protocol: String,
    pub label: String,
    pub description: Option<String>,
    pub spec: Value,
    pub parameters: Vec<McpMarketplaceInstallParameter>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpMarketplaceServerDetail {
    pub provider_id: String,
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub homepage: Option<String>,
    pub remote: bool,
    pub verified: bool,
    pub icon_url: Option<String>,
    pub latest_version: Option<String>,
    pub protocols: Vec<String>,
    pub owner: Option<String>,
    pub namespace: Option<String>,
    pub downloads: Option<u64>,
    pub score: Option<f64>,
    pub is_deployed: Option<bool>,
    pub default_option_id: Option<String>,
    pub install_options: Vec<McpMarketplaceInstallOption>,
    pub spec: Value,
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn mcp_scan_local() -> Result<Vec<LocalMcpServer>, AppCommandError> {
    scan_local_servers()
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn mcp_list_marketplaces() -> Result<Vec<McpMarketplaceProvider>, AppCommandError> {
    Ok(vec![
        McpMarketplaceProvider {
            id: MARKETPLACE_OFFICIAL.to_string(),
            name: "Official MCP Registry".to_string(),
            description: "registry.modelcontextprotocol.io official MCP server registry"
                .to_string(),
        },
        McpMarketplaceProvider {
            id: MARKETPLACE_SMITHERY.to_string(),
            name: "Smithery".to_string(),
            description: "smithery.ai MCP server marketplace".to_string(),
        },
    ])
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn mcp_search_marketplace(
    provider_id: String,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<McpMarketplaceItem>, AppCommandError> {
    let q = query.unwrap_or_default();
    let max = limit.unwrap_or(30).clamp(1, 100);

    match provider_id.as_str() {
        MARKETPLACE_OFFICIAL => search_official_registry(&q, max).await,
        MARKETPLACE_SMITHERY => search_smithery(&q, max).await,
        _ => Err(mcp_invalid_input(format!(
            "unsupported marketplace provider: {provider_id}"
        ))),
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn mcp_get_marketplace_server_detail(
    provider_id: String,
    server_id: String,
) -> Result<McpMarketplaceServerDetail, AppCommandError> {
    match provider_id.as_str() {
        MARKETPLACE_OFFICIAL => {
            let detail = fetch_official_server_detail(&server_id).await?;
            let item = official_entry_to_item(&detail);
            let install_options = build_official_install_options(&detail.server)?;
            let default_option = select_default_install_option(&install_options);
            let spec = default_option
                .map(|item| item.spec.clone())
                .ok_or_else(|| {
                    mcp_not_found(format!(
                        "official MCP server '{}' does not expose an installable transport",
                        item.server_id
                    ))
                })?;
            Ok(McpMarketplaceServerDetail {
                provider_id: MARKETPLACE_OFFICIAL.to_string(),
                server_id: item.server_id,
                name: item.name,
                description: item.description,
                homepage: item.homepage,
                remote: item.remote,
                verified: item.verified,
                icon_url: item.icon_url,
                latest_version: item.latest_version,
                protocols: item.protocols,
                owner: item.owner,
                namespace: item.namespace,
                downloads: item.downloads,
                score: item.score,
                is_deployed: item.is_deployed,
                default_option_id: default_option.map(|item| item.id.clone()),
                install_options,
                spec,
            })
        }
        MARKETPLACE_SMITHERY => {
            let detail = fetch_smithery_server_detail(&server_id).await?;
            let summary = fetch_smithery_server_summary(&server_id).await.ok();
            let install_options = build_smithery_install_options(&detail)?;
            let default_option = select_default_install_option(&install_options);
            let spec = default_option
                .map(|item| item.spec.clone())
                .ok_or_else(|| {
                    mcp_not_found(format!(
                        "smithery server '{}' does not provide installable connection info",
                        detail.qualified_name
                    ))
                })?;
            Ok(McpMarketplaceServerDetail {
                provider_id: MARKETPLACE_SMITHERY.to_string(),
                server_id: detail.qualified_name.clone(),
                name: detail.display_name.clone(),
                description: detail
                    .description
                    .as_deref()
                    .or_else(|| {
                        summary
                            .as_ref()
                            .and_then(|item| item.description.as_deref())
                    })
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| "No description".to_string()),
                homepage: detail
                    .homepage
                    .as_deref()
                    .or_else(|| summary.as_ref().and_then(|item| item.homepage.as_deref()))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                remote: detail.remote,
                verified: detail.verified
                    || summary.as_ref().map(|item| item.verified).unwrap_or(false),
                icon_url: detail
                    .icon_url
                    .as_deref()
                    .or_else(|| summary.as_ref().and_then(|item| item.icon_url.as_deref()))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                latest_version: None,
                protocols: collect_protocols_from_options(&install_options),
                owner: detail
                    .owner
                    .as_deref()
                    .or_else(|| summary.as_ref().and_then(|item| item.owner.as_deref()))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                namespace: detail
                    .namespace
                    .as_deref()
                    .or_else(|| summary.as_ref().and_then(|item| item.namespace.as_deref()))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                downloads: detail
                    .use_count
                    .or_else(|| summary.as_ref().and_then(|item| item.use_count)),
                score: detail
                    .score
                    .or_else(|| summary.as_ref().and_then(|item| item.score)),
                is_deployed: detail
                    .is_deployed
                    .or_else(|| summary.as_ref().and_then(|item| item.is_deployed)),
                default_option_id: default_option.map(|item| item.id.clone()),
                install_options,
                spec,
            })
        }
        _ => Err(mcp_invalid_input(format!(
            "unsupported marketplace provider: {provider_id}"
        ))),
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn mcp_install_from_marketplace(
    provider_id: String,
    server_id: String,
    apps: Vec<McpAppType>,
    spec_override: Option<Value>,
    option_id: Option<String>,
    protocol: Option<String>,
    parameter_values: Option<Value>,
) -> Result<LocalMcpServer, AppCommandError> {
    let normalized_apps = normalize_apps(apps);
    if normalized_apps.is_empty() {
        return Err(mcp_invalid_input("at least one target app is required")
            .with_i18n("errors.appsRequired", BTreeMap::new()));
    }

    let selection = InstallSelection::new(option_id, protocol, parameter_values)?;

    let canonical_spec = if let Some(raw_spec) = spec_override.as_ref() {
        canonicalize_spec(raw_spec, "marketplace install override")?
    } else {
        match provider_id.as_str() {
            MARKETPLACE_OFFICIAL => {
                let detail = fetch_official_server_detail(&server_id).await?;
                resolve_official_install_spec_with_selection(&detail.server, &selection)?
            }
            MARKETPLACE_SMITHERY => {
                let detail = fetch_smithery_server_detail(&server_id).await?;
                resolve_smithery_install_spec_with_selection(&detail, &selection)?
            }
            _ => {
                return Err(mcp_invalid_input(format!(
                    "unsupported marketplace provider: {provider_id}"
                )));
            }
        }
    };

    for app in &normalized_apps {
        upsert_server_for_app(*app, &server_id, &canonical_spec)?;
    }

    find_local_server(&server_id)?.ok_or_else(|| {
        mcp_configuration_invalid(format!(
            "installed server '{server_id}', but failed to load it from local configuration"
        ))
    })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn mcp_upsert_local_server(
    server_id: String,
    spec: Value,
    apps: Vec<McpAppType>,
) -> Result<LocalMcpServer, AppCommandError> {
    let canonical_spec = canonicalize_spec(&spec, "local MCP save")?;
    let target_apps = normalize_apps(apps);
    if target_apps.is_empty() {
        return Err(mcp_invalid_input("at least one target app is required")
            .with_i18n("errors.appsRequired", BTreeMap::new()));
    }

    let target_set = target_apps.iter().copied().collect::<BTreeSet<_>>();
    let all_apps = [
        McpAppType::ClaudeCode,
        McpAppType::Codex,
        McpAppType::Gemini,
        McpAppType::OpenClaw,
        McpAppType::OpenCode,
        McpAppType::Cline,
        McpAppType::Hermes,
        McpAppType::CodeBuddy,
        McpAppType::KimiCode,
        McpAppType::MimoCode,
    ];

    for app in all_apps {
        if target_set.contains(&app) {
            upsert_server_for_app(app, &server_id, &canonical_spec)?;
        } else {
            let _ = remove_server_for_app(app, &server_id)?;
        }
    }

    find_local_server(&server_id)?.ok_or_else(|| {
        mcp_configuration_invalid(format!(
            "saved local MCP server '{server_id}', but failed to reload it"
        ))
    })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn mcp_set_server_apps(
    server_id: String,
    apps: Vec<McpAppType>,
) -> Result<Option<LocalMcpServer>, AppCommandError> {
    let target_apps = normalize_apps(apps);
    let current = find_local_server(&server_id)?
        .ok_or_else(|| mcp_not_found(format!("local MCP server not found: {server_id}")))?;

    let target_set = target_apps.iter().copied().collect::<BTreeSet<_>>();
    let current_set = current.apps.iter().copied().collect::<BTreeSet<_>>();

    for app in current_set.difference(&target_set) {
        remove_server_for_app(*app, &server_id)?;
    }

    for app in target_set.difference(&current_set) {
        upsert_server_for_app(*app, &server_id, &current.spec)?;
    }

    find_local_server(&server_id)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn mcp_remove_server(
    server_id: String,
    apps: Option<Vec<McpAppType>>,
) -> Result<bool, AppCommandError> {
    let target_apps = match apps {
        Some(selected) => normalize_apps(selected),
        None => vec![
            McpAppType::ClaudeCode,
            McpAppType::Codex,
            McpAppType::Gemini,
            McpAppType::OpenClaw,
            McpAppType::OpenCode,
            McpAppType::Cline,
            McpAppType::Hermes,
            McpAppType::CodeBuddy,
            McpAppType::KimiCode,
            McpAppType::MimoCode,
        ],
    };

    if target_apps.is_empty() {
        return Ok(false);
    }

    let mut removed = false;
    for app in target_apps {
        removed |= remove_server_for_app(app, &server_id)?;
    }
    Ok(removed)
}

fn normalize_apps(apps: Vec<McpAppType>) -> Vec<McpAppType> {
    let mut seen = BTreeSet::new();
    for app in apps {
        seen.insert(app);
    }
    seen.into_iter().collect()
}

#[derive(Debug, Clone)]
pub(crate) struct InstallSelection {
    option_id: Option<String>,
    protocol: Option<String>,
    parameter_values: Map<String, Value>,
}

impl InstallSelection {
    fn new(
        option_id: Option<String>,
        protocol: Option<String>,
        parameter_values: Option<Value>,
    ) -> Result<Self, AppCommandError> {
        let parsed = if let Some(raw) = parameter_values {
            let obj = raw
                .as_object()
                .ok_or_else(|| mcp_invalid_input("parameter_values must be a JSON object"))?;
            obj.clone()
        } else {
            Map::new()
        };

        Ok(Self {
            option_id: option_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            protocol: protocol
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(normalize_protocol_value),
            parameter_values: parsed,
        })
    }
}

/// Normalize a user-supplied MCP transport type string into one of the
/// canonical values understood by `canonicalize_spec`.
///
/// Stage 1 (precise): trimmed lowercase exact match against the ACP/MCP-spec
/// canonical names (`stdio` / `http` / `sse`) plus the OpenCode-native markers
/// (`local` / `remote`). The latter two are NOT ACP types — they appear only
/// as a redirect signal so `canonicalize_spec` can hand off to
/// `canonicalize_opencode_spec` when a user pastes OpenCode-format JSON
/// (`type: "local" | "remote"`, command-as-array, `environment` instead of
/// `env`). After translation, the canonical output's type is always one of
/// `stdio` / `http` / `sse`.
///
/// Stage 2 (alias collapse, http only): strip non-ASCII-alphanumeric characters
/// and lowercase, then match `streamablehttp` -> `http`. Catches
/// `streamable-http`, `streamableHttp`, `streamable_http`, `Streamable HTTP`,
/// etc. Inputs containing non-ASCII separators (e.g. U+2010 hyphen, full-width
/// letters from CJK IME) are intentionally rejected and fall through to the
/// caller's unsupported-type error — that path echoes the raw value, so users
/// can spot the encoding issue.
///
/// Returns `None` for unknown values so callers can decide between strict
/// rejection and permissive fallback.
fn normalize_mcp_type(raw: &str) -> Option<&'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    match lower.as_str() {
        "stdio" => return Some("stdio"),
        "http" => return Some("http"),
        "sse" => return Some("sse"),
        "local" => return Some("local"),
        "remote" => return Some("remote"),
        _ => {}
    }

    let collapsed: String = lower
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if collapsed == "streamablehttp" {
        return Some("http");
    }

    None
}

fn normalize_protocol_value(raw: &str) -> String {
    normalize_mcp_type(raw)
        .map(str::to_string)
        .unwrap_or_else(|| raw.trim().to_string())
}

fn protocol_priority(protocol: &str) -> i32 {
    match normalize_protocol_value(protocol).as_str() {
        "stdio" => 0,
        "http" => 1,
        "sse" => 2,
        _ => 10,
    }
}

fn select_default_install_option(
    options: &[McpMarketplaceInstallOption],
) -> Option<&McpMarketplaceInstallOption> {
    options
        .iter()
        .min_by_key(|item| protocol_priority(&item.protocol))
}

fn collect_protocols_from_options(options: &[McpMarketplaceInstallOption]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    for option in options {
        seen.insert(normalize_protocol_value(&option.protocol));
    }
    seen.into_iter().collect()
}

fn home_dir_or_default() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn codex_home_dir() -> PathBuf {
    let configured = std::env::var("CODEX_HOME").ok().and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    match configured {
        Some(value) => {
            if value == "~" {
                home_dir_or_default()
            } else if let Some(remain) = value.strip_prefix("~/") {
                home_dir_or_default().join(remain)
            } else {
                PathBuf::from(value)
            }
        }
        None => home_dir_or_default().join(".codex"),
    }
}

pub(crate) fn claude_config_path() -> PathBuf {
    home_dir_or_default().join(".claude.json")
}

pub(crate) fn claude_settings_path() -> PathBuf {
    home_dir_or_default().join(".claude").join("settings.json")
}

/// The marketplace suffix veryagent uses when toggling user-scope Claude Code
/// MCP servers via `enabledPlugins`. Empirically validated: `figma@local`
/// activates a user-scope MCP, `figma@user` does not. The suffix is treated
/// by Claude Code CLI as a free-form tag identifying the source — `local`
/// is the conventional value for user-managed entries.
pub(crate) const CLAUDE_LOCAL_PLUGIN_MARKETPLACE: &str = "local";

pub(crate) fn claude_local_plugin_key(id: &str) -> String {
    format!("{id}@{CLAUDE_LOCAL_PLUGIN_MARKETPLACE}")
}

fn codex_config_toml_path() -> PathBuf {
    codex_home_dir().join("config.toml")
}

fn opencode_config_path() -> PathBuf {
    home_dir_or_default()
        .join(".config")
        .join("opencode")
        .join("opencode.json")
}

fn mimo_code_config_path() -> PathBuf {
    home_dir_or_default()
        .join(".config")
        .join("mimocode")
        .join("mimocode.json")
}

fn gemini_config_path() -> PathBuf {
    home_dir_or_default().join(".gemini").join("settings.json")
}

fn openclaw_config_path() -> PathBuf {
    home_dir_or_default()
        .join(".openclaw")
        .join("openclaw.json")
}

fn cline_config_path() -> PathBuf {
    home_dir_or_default()
        .join(".cline")
        .join("data")
        .join("settings")
        .join("cline_mcp_settings.json")
}

fn read_json_file(path: &Path) -> Result<Value, AppCommandError> {
    if !path.exists() {
        return Ok(json!({}));
    }

    let raw = fs::read_to_string(path).map_err(AppCommandError::io)?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|e| mcp_configuration_invalid(format!("invalid JSON at {}: {e}", path.display())))
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), AppCommandError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppCommandError::io)?;
    }
    let serialized = serde_json::to_string_pretty(value).map_err(|e| {
        mcp_configuration_invalid(format!(
            "failed to serialize JSON for {}: {e}",
            path.display()
        ))
    })?;
    fs::write(path, format!("{serialized}\n")).map_err(AppCommandError::io)
}

fn read_codex_root_toml() -> Result<toml::Value, AppCommandError> {
    let path = codex_config_toml_path();
    if !path.exists() {
        return Ok(toml::Value::Table(toml::map::Map::new()));
    }

    let raw = fs::read_to_string(&path).map_err(AppCommandError::io)?;
    let parsed = raw.parse::<toml::Value>().map_err(|e| {
        mcp_configuration_invalid(format!("invalid TOML at {}: {e}", path.display()))
    })?;

    if !parsed.is_table() {
        return Err(mcp_configuration_invalid(format!(
            "invalid TOML root at {}: expected table",
            path.display()
        )));
    }

    Ok(parsed)
}

fn write_codex_root_toml(root: &toml::Value) -> Result<(), AppCommandError> {
    let path = codex_config_toml_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppCommandError::io)?;
    }

    let serialized = toml::to_string_pretty(root).map_err(|e| {
        mcp_configuration_invalid(format!(
            "failed to serialize TOML for {}: {e}",
            path.display()
        ))
    })?;
    fs::write(&path, format!("{serialized}\n")).map_err(AppCommandError::io)
}

fn obj_as_string_map(value: Option<&Value>) -> Option<Map<String, Value>> {
    let obj = value.and_then(Value::as_object)?;

    let mut output = Map::with_capacity(obj.len());
    for (key, item) in obj {
        let Some(s) = item.as_str() else {
            continue;
        };
        let trimmed = s.trim();
        if trimmed.is_empty() {
            continue;
        }
        output.insert(key.to_string(), Value::String(trimmed.to_string()));
    }

    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

fn contains_unresolved_placeholder(value: &str) -> bool {
    value.contains('{') && value.contains('}')
}

fn marketplace_http_client() -> Result<reqwest::Client, AppCommandError> {
    match &*MARKETPLACE_HTTP_CLIENT {
        Ok(client) => Ok(client.clone()),
        Err(err) => Err(mcp_network(err.clone())),
    }
}

fn should_retry_http_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn format_market_network_error(context: &str, err: &reqwest::Error) -> String {
    if err.is_timeout() {
        return format!(
            "{context}: request timed out. Please check network/proxy settings and retry: {err}"
        );
    }
    if err.is_connect() {
        return format!(
            "{context}: network connection failed. Please check network/proxy settings and retry: {err}"
        );
    }
    format!("{context}: {err}")
}

async fn send_request_with_retry<F>(
    context: &str,
    mut build: F,
) -> Result<reqwest::Response, AppCommandError>
where
    F: FnMut() -> reqwest::RequestBuilder,
{
    const MAX_ATTEMPTS: usize = 3;
    let mut last_error: Option<String> = None;

    for attempt in 1..=MAX_ATTEMPTS {
        match build().send().await {
            Ok(response) => {
                if should_retry_http_status(response.status()) && attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis((attempt as u64) * 350)).await;
                    continue;
                }
                return Ok(response);
            }
            Err(err) => {
                last_error = Some(format_market_network_error(context, &err));
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis((attempt as u64) * 350)).await;
                }
            }
        }
    }

    Err(mcp_network(
        last_error.unwrap_or_else(|| format!("{context}: request failed")),
    ))
}

async fn parse_json_response<T: DeserializeOwned>(
    response: reqwest::Response,
    context: &str,
) -> Result<T, AppCommandError> {
    let raw = response
        .text()
        .await
        .map_err(|e| mcp_network(format!("{context}: failed to read response body: {e}")))?;
    serde_json::from_str::<T>(&raw)
        .map_err(|e| mcp_network(format!("{context}: invalid JSON response: {e}")))
}

async fn parse_json_value_response(
    response: reqwest::Response,
    context: &str,
) -> Result<Value, AppCommandError> {
    let raw = response
        .text()
        .await
        .map_err(|e| mcp_network(format!("{context}: failed to read response body: {e}")))?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|e| mcp_network(format!("{context}: invalid JSON response: {e}")))
}

fn canonicalize_spec(spec: &Value, source: &str) -> Result<Value, AppCommandError> {
    let obj = spec.as_object().ok_or_else(|| {
        mcp_invalid_input(format!("{source}: MCP spec must be a JSON object"))
            .with_i18n("errors.specMustBeObject", BTreeMap::new())
    })?;

    let raw_type = obj
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();

    let resolved_type: &'static str = if raw_type.is_empty() {
        if obj.get("command").is_some() {
            "stdio"
        } else if obj.get("url").is_some() {
            "http"
        } else {
            return Err(mcp_invalid_input(format!(
                "{source}: MCP spec missing 'type'; provide one of stdio, http (aliases: streamable-http, streamableHttp), sse"
            ))
            .with_i18n("errors.missingType", BTreeMap::new()));
        }
    } else {
        match normalize_mcp_type(&raw_type) {
            Some(value) => value,
            None => {
                return Err(mcp_invalid_input(format!(
                    "{source}: unsupported MCP server type '{raw_type}'; supported: stdio, http (aliases: streamable-http, streamableHttp), sse"
                ))
                .with_i18n(
                    "errors.unsupportedType",
                    mcp_i18n_params([("type", raw_type.as_str())]),
                ));
            }
        }
    };

    let mut normalized = Map::new();

    match resolved_type {
        "stdio" => {
            let command = obj
                .get("command")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    mcp_invalid_input(format!(
                        "{source}: stdio MCP spec requires a non-empty command"
                    ))
                    .with_i18n("errors.stdioCommandRequired", BTreeMap::new())
                })?;

            normalized.insert("type".to_string(), Value::String("stdio".to_string()));
            normalized.insert("command".to_string(), Value::String(command.to_string()));

            if let Some(args) = obj.get("args").and_then(Value::as_array) {
                let values = args
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| Value::String(value.to_string()))
                    .collect::<Vec<_>>();
                if !values.is_empty() {
                    normalized.insert("args".to_string(), Value::Array(values));
                }
            }

            if let Some(env) = obj_as_string_map(obj.get("env")) {
                normalized.insert("env".to_string(), Value::Object(env));
            }

            if let Some(cwd) = obj
                .get("cwd")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                normalized.insert("cwd".to_string(), Value::String(cwd.to_string()));
            }
        }
        "http" | "sse" => {
            let url = obj
                .get("url")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    mcp_invalid_input(format!(
                        "{source}: remote MCP spec requires a non-empty url"
                    ))
                    .with_i18n("errors.remoteUrlRequired", BTreeMap::new())
                })?;

            normalized.insert("type".to_string(), Value::String(resolved_type.to_string()));
            normalized.insert("url".to_string(), Value::String(url.to_string()));

            if let Some(headers) = obj_as_string_map(obj.get("headers")) {
                normalized.insert("headers".to_string(), Value::Object(headers));
            }
        }
        "local" | "remote" => {
            return canonicalize_opencode_spec(spec, source);
        }
        _ => unreachable!("normalize_mcp_type returns one of stdio/http/sse/local/remote"),
    }

    for (key, value) in obj {
        if normalized.contains_key(key) {
            continue;
        }
        if key == "type"
            || key == "command"
            || key == "args"
            || key == "env"
            || key == "cwd"
            || key == "url"
            || key == "headers"
        {
            continue;
        }
        if !value.is_null() {
            normalized.insert(key.clone(), value.clone());
        }
    }

    Ok(Value::Object(normalized))
}

fn canonicalize_opencode_spec(spec: &Value, source: &str) -> Result<Value, AppCommandError> {
    let obj = spec.as_object().ok_or_else(|| {
        mcp_invalid_input(format!("{source}: OpenCode MCP spec must be a JSON object"))
    })?;

    let typ = obj
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("local");

    match typ {
        "local" => {
            let mut converted = Map::new();
            converted.insert("type".to_string(), Value::String("stdio".to_string()));

            if let Some(command) = obj.get("command") {
                if let Some(arr) = command.as_array() {
                    let first = arr
                        .first()
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                        .ok_or_else(|| {
                            mcp_invalid_input(format!(
                                "{source}: local MCP command array must include executable"
                            ))
                        })?;
                    converted.insert("command".to_string(), Value::String(first.to_string()));

                    if arr.len() > 1 {
                        let args = arr[1..]
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::trim)
                            .filter(|item| !item.is_empty())
                            .map(|item| Value::String(item.to_string()))
                            .collect::<Vec<_>>();
                        if !args.is_empty() {
                            converted.insert("args".to_string(), Value::Array(args));
                        }
                    }
                } else if let Some(raw) = command.as_str() {
                    let trimmed = raw.trim();
                    if trimmed.is_empty() {
                        return Err(mcp_invalid_input(format!(
                            "{source}: local MCP command must be non-empty"
                        )));
                    }
                    converted.insert("command".to_string(), Value::String(trimmed.to_string()));
                }
            }

            if let Some(env) = obj_as_string_map(obj.get("environment")) {
                converted.insert("env".to_string(), Value::Object(env));
            }

            if let Some(cwd) = obj
                .get("cwd")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                converted.insert("cwd".to_string(), Value::String(cwd.to_string()));
            }

            canonicalize_spec(&Value::Object(converted), source)
        }
        "remote" => {
            let mut converted = Map::new();
            let remote_type = obj
                .get("transport")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| *value == "sse")
                .map(|_| "sse")
                .unwrap_or("http");
            converted.insert("type".to_string(), Value::String(remote_type.to_string()));

            if let Some(url) = obj
                .get("url")
                .or_else(|| obj.get("deploymentUrl"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                converted.insert("url".to_string(), Value::String(url.to_string()));
            }

            if let Some(headers) = obj_as_string_map(obj.get("headers")) {
                converted.insert("headers".to_string(), Value::Object(headers));
            }

            canonicalize_spec(&Value::Object(converted), source)
        }
        _ => canonicalize_spec(spec, source),
    }
}

fn canonical_to_opencode_spec(spec: &Value) -> Result<Value, AppCommandError> {
    let canonical = canonicalize_spec(spec, "OpenCode conversion")?;
    let obj = canonical.as_object().ok_or_else(|| {
        mcp_invalid_input("OpenCode conversion: canonical spec must be an object")
    })?;

    let typ = obj.get("type").and_then(Value::as_str).unwrap_or("stdio");

    let mut out = Map::new();

    match typ {
        "stdio" => {
            let cmd = obj.get("command").and_then(Value::as_str).ok_or_else(|| {
                mcp_invalid_input("OpenCode conversion: stdio MCP spec missing command")
            })?;
            out.insert("type".to_string(), Value::String("local".to_string()));

            let mut command = vec![Value::String(cmd.to_string())];
            if let Some(args) = obj.get("args").and_then(Value::as_array) {
                for arg in args {
                    if let Some(raw) = arg.as_str() {
                        let trimmed = raw.trim();
                        if !trimmed.is_empty() {
                            command.push(Value::String(trimmed.to_string()));
                        }
                    }
                }
            }
            out.insert("command".to_string(), Value::Array(command));

            if let Some(env) = obj_as_string_map(obj.get("env")) {
                out.insert("environment".to_string(), Value::Object(env));
            }

            if let Some(cwd) = obj
                .get("cwd")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                out.insert("cwd".to_string(), Value::String(cwd.to_string()));
            }
        }
        "http" | "sse" => {
            let url = obj.get("url").and_then(Value::as_str).ok_or_else(|| {
                mcp_invalid_input("OpenCode conversion: remote MCP spec missing url")
            })?;
            out.insert("type".to_string(), Value::String("remote".to_string()));
            out.insert("url".to_string(), Value::String(url.to_string()));
            if typ == "sse" {
                out.insert("transport".to_string(), Value::String("sse".to_string()));
            }
            if let Some(headers) = obj_as_string_map(obj.get("headers")) {
                out.insert("headers".to_string(), Value::Object(headers));
            }
        }
        _ => {
            return Err(mcp_invalid_input(format!(
                "OpenCode conversion: unsupported MCP type '{typ}'"
            )));
        }
    }

    out.insert("enabled".to_string(), Value::Bool(true));

    Ok(Value::Object(out))
}

fn json_to_toml_value(value: &Value) -> Option<toml::Value> {
    match value {
        Value::Null => None,
        Value::Bool(v) => Some(toml::Value::Boolean(*v)),
        Value::Number(v) => {
            if let Some(i) = v.as_i64() {
                Some(toml::Value::Integer(i))
            } else {
                v.as_f64().map(toml::Value::Float)
            }
        }
        Value::String(v) => Some(toml::Value::String(v.clone())),
        Value::Array(values) => {
            let mut converted = Vec::with_capacity(values.len());
            for item in values {
                let next = json_to_toml_value(item)?;
                converted.push(next);
            }
            Some(toml::Value::Array(converted))
        }
        Value::Object(map) => {
            let mut table = toml::map::Map::new();
            for (key, val) in map {
                let Some(next) = json_to_toml_value(val) else {
                    continue;
                };
                table.insert(key.clone(), next);
            }
            Some(toml::Value::Table(table))
        }
    }
}

fn toml_to_json_value(value: &toml::Value) -> Value {
    match value {
        toml::Value::String(v) => Value::String(v.clone()),
        toml::Value::Integer(v) => Value::Number((*v).into()),
        toml::Value::Float(v) => serde_json::Number::from_f64(*v)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        toml::Value::Boolean(v) => Value::Bool(*v),
        toml::Value::Datetime(v) => Value::String(v.to_string()),
        toml::Value::Array(values) => Value::Array(values.iter().map(toml_to_json_value).collect()),
        toml::Value::Table(table) => {
            let mut out = Map::new();
            for (key, item) in table {
                out.insert(key.to_string(), toml_to_json_value(item));
            }
            Value::Object(out)
        }
    }
}

fn codex_entry_to_canonical(id: &str, value: &toml::Value) -> Result<Value, AppCommandError> {
    let table = value
        .as_table()
        .ok_or_else(|| mcp_invalid_input(format!("Codex MCP entry '{id}' must be a table")))?;

    let raw_type = table
        .get("type")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("stdio")
        .to_string();
    let canonical_type = normalize_mcp_type(&raw_type).ok_or_else(|| {
        mcp_invalid_input(format!(
            "Codex MCP entry '{id}' has unsupported type '{raw_type}'"
        ))
        .with_i18n(
            "errors.codexEntryUnsupportedType",
            mcp_i18n_params([("id", id), ("type", raw_type.as_str())]),
        )
    })?;

    let mut spec = Map::new();
    spec.insert(
        "type".to_string(),
        Value::String(canonical_type.to_string()),
    );

    match canonical_type {
        "stdio" => {
            if let Some(command) = table
                .get("command")
                .and_then(toml::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                spec.insert("command".to_string(), Value::String(command.to_string()));
            }

            if let Some(args) = table.get("args").and_then(toml::Value::as_array) {
                let values = args
                    .iter()
                    .filter_map(toml::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| Value::String(value.to_string()))
                    .collect::<Vec<_>>();
                if !values.is_empty() {
                    spec.insert("args".to_string(), Value::Array(values));
                }
            }

            if let Some(env) = table.get("env").and_then(toml::Value::as_table) {
                let mut env_map = Map::new();
                for (key, value) in env {
                    let Some(text) = value.as_str() else {
                        continue;
                    };
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    env_map.insert(key.to_string(), Value::String(trimmed.to_string()));
                }
                if !env_map.is_empty() {
                    spec.insert("env".to_string(), Value::Object(env_map));
                }
            }

            if let Some(cwd) = table
                .get("cwd")
                .and_then(toml::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                spec.insert("cwd".to_string(), Value::String(cwd.to_string()));
            }
        }
        "http" | "sse" => {
            if let Some(url) = table
                .get("url")
                .and_then(toml::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                spec.insert("url".to_string(), Value::String(url.to_string()));
            }

            let headers_table = table
                .get("http_headers")
                .and_then(toml::Value::as_table)
                .or_else(|| table.get("headers").and_then(toml::Value::as_table));

            if let Some(headers) = headers_table {
                let mut mapped = Map::new();
                for (key, value) in headers {
                    let Some(text) = value.as_str() else {
                        continue;
                    };
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    mapped.insert(key.to_string(), Value::String(trimmed.to_string()));
                }
                if !mapped.is_empty() {
                    spec.insert("headers".to_string(), Value::Object(mapped));
                }
            }
        }
        _ => {
            return Err(mcp_invalid_input(format!(
                "Codex MCP entry '{id}' has unsupported type '{raw_type}'"
            ))
            .with_i18n(
                "errors.codexEntryUnsupportedType",
                mcp_i18n_params([("id", id), ("type", raw_type.as_str())]),
            ));
        }
    }

    for (key, value) in table {
        if key == "type"
            || key == "command"
            || key == "args"
            || key == "env"
            || key == "cwd"
            || key == "url"
            || key == "headers"
            || key == "http_headers"
        {
            continue;
        }
        spec.insert(key.to_string(), toml_to_json_value(value));
    }

    canonicalize_spec(&Value::Object(spec), "Codex config")
}

fn canonical_to_codex_entry(spec: &Value) -> Result<toml::Value, AppCommandError> {
    let canonical = canonicalize_spec(spec, "Codex conversion")?;
    let obj = canonical
        .as_object()
        .ok_or_else(|| mcp_invalid_input("Codex conversion: canonical spec must be an object"))?;

    let typ = obj.get("type").and_then(Value::as_str).unwrap_or("stdio");

    let mut table = toml::map::Map::new();
    table.insert("type".to_string(), toml::Value::String(typ.to_string()));

    match typ {
        "stdio" => {
            let command = obj.get("command").and_then(Value::as_str).ok_or_else(|| {
                mcp_invalid_input("Codex conversion: stdio MCP spec missing command")
            })?;
            table.insert(
                "command".to_string(),
                toml::Value::String(command.to_string()),
            );

            if let Some(args) = obj.get("args").and_then(Value::as_array) {
                let values = args
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(|value| toml::Value::String(value.to_string()))
                    .collect::<Vec<_>>();
                if !values.is_empty() {
                    table.insert("args".to_string(), toml::Value::Array(values));
                }
            }

            if let Some(cwd) = obj
                .get("cwd")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                table.insert("cwd".to_string(), toml::Value::String(cwd.to_string()));
            }

            if let Some(env) = obj.get("env").and_then(Value::as_object) {
                let mut env_table = toml::map::Map::new();
                for (key, value) in env {
                    let Some(text) = value.as_str() else {
                        continue;
                    };
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    env_table.insert(key.to_string(), toml::Value::String(trimmed.to_string()));
                }
                if !env_table.is_empty() {
                    table.insert("env".to_string(), toml::Value::Table(env_table));
                }
            }
        }
        "http" | "sse" => {
            // env intentionally not written for http/sse: per ACP/MCP spec, env is
            // stdio-only; remote transports use headers. canonicalize_spec strips
            // env upstream too.
            let url = obj.get("url").and_then(Value::as_str).ok_or_else(|| {
                mcp_invalid_input("Codex conversion: remote MCP spec missing url")
            })?;
            table.insert("url".to_string(), toml::Value::String(url.to_string()));

            if let Some(headers) = obj.get("headers").and_then(Value::as_object) {
                let mut headers_table = toml::map::Map::new();
                for (key, value) in headers {
                    let Some(text) = value.as_str() else {
                        continue;
                    };
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    headers_table.insert(key.to_string(), toml::Value::String(trimmed.to_string()));
                }
                if !headers_table.is_empty() {
                    table.insert(
                        "http_headers".to_string(),
                        toml::Value::Table(headers_table),
                    );
                }
            }
        }
        _ => {
            return Err(mcp_invalid_input(format!(
                "Codex conversion: unsupported MCP type '{typ}'"
            )));
        }
    }

    for (key, value) in obj {
        if key == "type"
            || key == "command"
            || key == "args"
            || key == "env"
            || key == "cwd"
            || key == "url"
            || key == "headers"
        {
            continue;
        }
        if let Some(converted) = json_to_toml_value(value) {
            table.insert(key.to_string(), converted);
        }
    }

    Ok(toml::Value::Table(table))
}

pub(crate) fn read_claude_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let path = claude_config_path();
    let root = read_json_file(&path)?;
    let mut out = BTreeMap::new();

    let Some(servers) = root.get("mcpServers").and_then(Value::as_object) else {
        return Ok(out);
    };

    for (id, spec) in servers {
        match canonicalize_spec(spec, "Claude config") {
            Ok(normalized) => {
                out.insert(id.to_string(), normalized);
            }
            Err(err) => {
                tracing::warn!("[MCP] skip invalid Claude MCP entry id={id}: {err}");
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_claude_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    let path = claude_config_path();
    let mut root = read_json_file(&path)?;
    if !root.is_object() {
        root = json!({});
    }

    let canonical = canonicalize_spec(spec, "Claude write")?;

    let obj = root.as_object_mut().ok_or_else(|| {
        mcp_configuration_invalid(format!("invalid JSON root in {}", path.display()))
    })?;
    if !obj.get("mcpServers").map(Value::is_object).unwrap_or(false) {
        obj.insert("mcpServers".to_string(), Value::Object(Map::new()));
    }

    let map = obj
        .get_mut("mcpServers")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            mcp_configuration_invalid(format!("invalid mcpServers in {}", path.display()))
        })?;
    map.insert(id.to_string(), canonical);

    write_json_file(&path, &root)?;
    enable_claude_local_plugin(id)
}

pub(crate) fn remove_claude_server(id: &str) -> Result<bool, AppCommandError> {
    let path = claude_config_path();
    if !path.exists() {
        // Even if `~/.claude.json` is missing, `enabledPlugins` could still
        // have a stale entry from a prior session — clean it up regardless
        // so the user doesn't end up with dangling activation markers.
        disable_claude_local_plugin(id)?;
        return Ok(false);
    }

    let mut root = read_json_file(&path)?;
    let Some(obj) = root.as_object_mut() else {
        disable_claude_local_plugin(id)?;
        return Ok(false);
    };
    let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) else {
        disable_claude_local_plugin(id)?;
        return Ok(false);
    };

    let removed = servers.remove(id).is_some();
    if removed {
        write_json_file(&path, &root)?;
    }
    disable_claude_local_plugin(id)?;
    Ok(removed)
}

/// Add `<id>@local: true` to `~/.claude/settings.json.enabledPlugins`. The
/// Claude Code CLI uses this map as a gate for activating user-scope MCP
/// servers from `~/.claude.json.mcpServers` (a server can be defined but
/// will not load until it appears in this list). Existing fields in the
/// settings file (env, model, other plugin entries) are preserved.
pub(crate) fn enable_claude_local_plugin(id: &str) -> Result<(), AppCommandError> {
    let path = claude_settings_path();
    let mut root = read_json_file(&path)?;
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().ok_or_else(|| {
        mcp_configuration_invalid(format!("invalid JSON root in {}", path.display()))
    })?;
    if !obj
        .get("enabledPlugins")
        .map(Value::is_object)
        .unwrap_or(false)
    {
        obj.insert("enabledPlugins".to_string(), Value::Object(Map::new()));
    }
    let plugins = obj
        .get_mut("enabledPlugins")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            mcp_configuration_invalid(format!("invalid enabledPlugins in {}", path.display()))
        })?;
    let key = claude_local_plugin_key(id);
    let already_true = matches!(plugins.get(&key), Some(Value::Bool(true)));
    if already_true {
        // Avoid an unnecessary disk write that would needlessly trip the
        // settings-file watcher in claude-agent-acp's SettingsManager.
        return Ok(());
    }
    plugins.insert(key, Value::Bool(true));
    write_json_file(&path, &root)
}

/// Remove `<id>@local` from `~/.claude/settings.json.enabledPlugins` if
/// present. Other entries (including any `<id>@<other-marketplace>` that
/// the user manages manually) are intentionally left untouched.
pub(crate) fn disable_claude_local_plugin(id: &str) -> Result<(), AppCommandError> {
    let path = claude_settings_path();
    if !path.exists() {
        return Ok(());
    }
    let mut root = read_json_file(&path)?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(());
    };
    let Some(plugins) = obj.get_mut("enabledPlugins").and_then(Value::as_object_mut) else {
        return Ok(());
    };
    let key = claude_local_plugin_key(id);
    if plugins.remove(&key).is_some() {
        write_json_file(&path, &root)?;
    }
    Ok(())
}

