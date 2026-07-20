use super::*;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::acp::error::AcpError;


/// OpenClaw's own default local port when nothing is configured.
pub(crate) const OPENCLAW_DEFAULT_LOCAL_PORT: u16 = 18789;
/// Managed custom provider id written into `~/.openclaw/openclaw.json` when the
/// user binds a shared model provider. OpenClaw's gateway (not the ACP client)
/// performs inference, so credentials must live in gateway config — env on the
/// `openclaw acp` process alone is ignored.
pub(crate) const OPENCLAW_MANAGED_PROVIDER: &str = "veryagent";

pub(crate) fn openclaw_config_path() -> PathBuf {
    let configured = std::env::var("OPENCLAW_CONFIG_PATH").ok().and_then(|raw| {
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
        None => home_dir_or_default()
            .join(".openclaw")
            .join("openclaw.json"),
    }
}

pub(crate) fn openclaw_read_config_value(path: &Path) -> Option<serde_json::Value> {
    let raw = fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(value);
    }
    let stripped = strip_json5_noise(trimmed);
    serde_json::from_str::<serde_json::Value>(&stripped).ok()
}

/// OpenClaw's openai-completions transport expects a base that already ends in
/// `/v1` (it appends `/chat/completions` itself). Strip common chat suffixes and
/// append `/v1` when missing so shared model-provider URLs work either way.
pub(crate) fn normalize_openclaw_openai_base_url(api_url: &str) -> String {
    normalize_openai_compatible_base_url(api_url)
}

/// Shared OpenAI-compatible base-url normalizer for Codex / OpenClaw / similar
/// clients that append `/chat/completions` (or `/responses`) themselves.
///
/// Shared model-provider URLs are often pasted as a bare host root
/// (`http://gateway:18080`). Without `/v1`, Codex ends up calling
/// `/chat/completions` on the HTML root and appears to "retry forever".
pub(crate) fn normalize_openai_compatible_base_url(api_url: &str) -> String {
    let trimmed = api_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    let without_suffix = trimmed
        .strip_suffix("/chat/completions")
        .or_else(|| trimmed.strip_suffix("/completions"))
        .or_else(|| trimmed.strip_suffix("/responses"))
        .or_else(|| trimmed.strip_suffix("/models"))
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    if without_suffix.ends_with("/v1") {
        without_suffix.to_string()
    } else {
        format!("{without_suffix}/v1")
    }
}

/// Write (or update) the veryagent-managed custom provider block in openclaw.json
/// so the local gateway can authenticate against a shared model provider.
///
/// Shape matches OpenClaw's custom openai-compatible providers:
/// `models.providers.veryagent` + optional `agents.defaults.model.primary`.
pub(crate) fn write_openclaw_managed_provider(
    api_url: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<(), AcpError> {
    let path = openclaw_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AcpError::protocol(format!(
                "create openclaw config dir failed ({}): {e}",
                parent.display()
            ))
        })?;
    }

    let mut root = openclaw_read_config_value(&path).unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }

    let base_url = normalize_openclaw_openai_base_url(api_url);
    let model = model.map(str::trim).filter(|s| !s.is_empty());

    let obj = root.as_object_mut().ok_or_else(|| {
        AcpError::protocol(format!("invalid openclaw.json root in {}", path.display()))
    })?;

    let models_value = obj
        .entry("models".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let models_obj = models_value.as_object_mut().ok_or_else(|| {
        AcpError::protocol(format!("invalid models object in {}", path.display()))
    })?;
    models_obj
        .entry("mode".to_string())
        .or_insert_with(|| serde_json::json!("merge"));

    let providers_value = models_obj
        .entry("providers".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let providers_obj = providers_value.as_object_mut().ok_or_else(|| {
        AcpError::protocol(format!(
            "invalid models.providers object in {}",
            path.display()
        ))
    })?;

    // Keep any previously managed model list when this write is credentials-only
    // (cascade from provider URL/key edit without a model change).
    let existing_models = providers_obj
        .get(OPENCLAW_MANAGED_PROVIDER)
        .and_then(|p| p.get("models"))
        .cloned();

    let mut provider = serde_json::Map::new();
    if !base_url.is_empty() {
        provider.insert(
            "baseUrl".to_string(),
            serde_json::Value::String(base_url),
        );
    }
    if !api_key.trim().is_empty() {
        provider.insert(
            "apiKey".to_string(),
            serde_json::Value::String(api_key.to_string()),
        );
    }
    provider.insert(
        "api".to_string(),
        serde_json::Value::String("openai-completions".to_string()),
    );

    if let Some(model_id) = model {
        provider.insert(
            "models".to_string(),
            serde_json::json!([{
                "id": model_id,
                "name": model_id,
                "reasoning": false,
                "input": ["text"],
                "contextWindow": 200000,
                "maxTokens": 8192
            }]),
        );
    } else if let Some(existing) = existing_models {
        provider.insert("models".to_string(), existing);
    } else {
        provider.insert("models".to_string(), serde_json::json!([]));
    }
    providers_obj.insert(
        OPENCLAW_MANAGED_PROVIDER.to_string(),
        serde_json::Value::Object(provider),
    );

    if let Some(model_id) = model {
        let primary = format!("{OPENCLAW_MANAGED_PROVIDER}/{model_id}");
        let agents_value = obj
            .entry("agents".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let agents_obj = agents_value.as_object_mut().ok_or_else(|| {
            AcpError::protocol(format!("invalid agents object in {}", path.display()))
        })?;
        let defaults_value = agents_obj
            .entry("defaults".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let defaults_obj = defaults_value.as_object_mut().ok_or_else(|| {
            AcpError::protocol(format!(
                "invalid agents.defaults object in {}",
                path.display()
            ))
        })?;
        defaults_obj.insert(
            "model".to_string(),
            serde_json::json!({ "primary": primary }),
        );
        let allow_value = defaults_obj
            .entry("models".to_string())
            .or_insert_with(|| serde_json::json!({}));
        if let Some(allow_obj) = allow_value.as_object_mut() {
            allow_obj.insert(
                primary,
                serde_json::json!({ "alias": "veryagent" }),
            );
        }
    }

    let text = serde_json::to_string_pretty(&root)
        .map_err(|e| AcpError::protocol(format!("serialize openclaw.json failed: {e}")))?;
    fs::write(&path, format!("{text}\n")).map_err(|e| {
        AcpError::protocol(format!(
            "write openclaw.json failed ({}): {e}",
            path.display()
        ))
    })?;

    Ok(())
}

pub(crate) fn openclaw_json_str(value: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut cur = value;
    for key in path {
        cur = cur.get(*key)?;
    }
    cur.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub(crate) fn openclaw_json_port(value: &serde_json::Value) -> Option<u16> {
    let port = value.get("gateway")?.get("port")?;
    if let Some(n) = port.as_u64() {
        return u16::try_from(n).ok().filter(|p| *p != 0);
    }
    if let Some(s) = port.as_str() {
        return s.trim().parse::<u16>().ok().filter(|p| *p != 0);
    }
    None
}

pub(crate) fn openclaw_env_nonempty(key: &str) -> Option<String> {
    std::env::var(key).ok().and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Injectable discovery core (used by unit tests and the public wrapper).
/// Does not perform network I/O; `gateway_reachable` is always false here.
pub(crate) fn discover_openclaw_gateway_from(
    config_path: PathBuf,
    env_url: Option<String>,
    env_port: Option<String>,
    env_token: Option<String>,
) -> OpenClawGatewayDiscovery {
    let config_exists = config_path.is_file();
    let config_value = if config_exists {
        openclaw_read_config_value(&config_path)
    } else {
        None
    };
    let config_parsed = config_value.is_some();

    // URL priority:
    // 1) OPENCLAW_GATEWAY_URL env
    // 2) gateway.remote.url in config
    // 3) construct from OPENCLAW_GATEWAY_PORT env
    // 4) construct from gateway.port in config (only when that port is present)
    let mut gateway_url: Option<String> = None;
    let mut gateway_url_source: Option<String> = None;
    let mut gateway_port: Option<u16> = None;
    let mut gateway_port_source: Option<String> = None;
    let mut gateway_mode: Option<String> = None;

    if let Some(url) = env_url.filter(|v| !v.trim().is_empty()) {
        gateway_url = Some(url.trim().to_string());
        gateway_url_source = Some("env".to_string());
    }

    if let Some(port_raw) = env_port {
        if let Ok(port) = port_raw.trim().parse::<u16>() {
            if port != 0 {
                gateway_port = Some(port);
                gateway_port_source = Some("env".to_string());
            }
        }
    }

    if let Some(ref value) = config_value {
        if gateway_url.is_none() {
            if let Some(url) = openclaw_json_str(value, &["gateway", "remote", "url"]) {
                gateway_url = Some(url);
                gateway_url_source = Some("config_remote_url".to_string());
            }
        }
        if gateway_port.is_none() {
            if let Some(port) = openclaw_json_port(value) {
                gateway_port = Some(port);
                gateway_port_source = Some("config_port".to_string());
            }
        }
        gateway_mode = openclaw_json_str(value, &["gateway", "mode"]);
    }

    if gateway_url.is_none() {
        if let Some(port) = gateway_port {
            gateway_url = Some(openclaw_local_ws_url(port));
            gateway_url_source = Some(if gateway_port_source.as_deref() == Some("env") {
                "env_port".to_string()
            } else {
                "config_port".to_string()
            });
        }
    }

    // Token priority (client-side):
    // OPENCLAW_GATEWAY_TOKEN → gateway.remote.token → gateway.auth.token
    // → gateway.auth.tokenFile / token-file (read contents)
    let mut gateway_token: Option<String> = None;
    let mut gateway_token_source: Option<String> = None;

    if let Some(token) = env_token.filter(|v| !v.trim().is_empty()) {
        gateway_token = Some(token.trim().to_string());
        gateway_token_source = Some("env".to_string());
    }

    if gateway_token.is_none() {
        if let Some(ref value) = config_value {
            if let Some(token) = openclaw_json_str(value, &["gateway", "remote", "token"]) {
                gateway_token = Some(token);
                gateway_token_source = Some("config_remote_token".to_string());
            } else if let Some(token) = openclaw_json_str(value, &["gateway", "auth", "token"]) {
                // Skip env-substitution placeholders like \${OPENCLAW_GATEWAY_TOKEN}
                // when the env itself was empty — they are not real tokens.
                if !token.starts_with("${") {
                    gateway_token = Some(token);
                    gateway_token_source = Some("config_auth_token".to_string());
                }
            }

            if gateway_token.is_none() {
                let file_path = openclaw_json_str(value, &["gateway", "auth", "tokenFile"])
                    .or_else(|| openclaw_json_str(value, &["gateway", "auth", "token_file"]))
                    .or_else(|| openclaw_json_str(value, &["gateway", "auth", "token-file"]))
                    .or_else(|| openclaw_json_str(value, &["gateway", "remote", "tokenFile"]))
                    .or_else(|| openclaw_json_str(value, &["gateway", "remote", "token_file"]));
                if let Some(path) = file_path {
                    if let Some(token) = openclaw_read_token_file(&path) {
                        gateway_token = Some(token);
                        gateway_token_source = Some("config_token_file".to_string());
                    }
                }
            }
        }
    }

    OpenClawGatewayDiscovery {
        gateway_url,
        gateway_url_source,
        gateway_token,
        gateway_token_source,
        config_path: config_path.display().to_string(),
        config_exists,
        config_parsed,
        gateway_port,
        gateway_port_source,
        gateway_mode,
        gateway_reachable: false,
    }
}

pub(crate) fn parse_openclaw_ws_host_port(raw: &str) -> Option<(String, u16)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = trimmed
        .strip_prefix("ws://")
        .or_else(|| trimmed.strip_prefix("wss://"))
        .or_else(|| trimmed.strip_prefix("http://"))
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed);
    let host_port = without_scheme.split('/').next().unwrap_or("").trim();
    if host_port.is_empty() {
        return None;
    }
    // IPv6 in brackets: [::1]:18789
    if let Some(rest) = host_port.strip_prefix('[') {
        let end = rest.find(']')?;
        let host = rest[..end].to_string();
        let after = &rest[end + 1..];
        let port = if let Some(p) = after.strip_prefix(':') {
            p.parse::<u16>().ok().filter(|p| *p != 0)?
        } else {
            OPENCLAW_DEFAULT_LOCAL_PORT
        };
        return Some((host, port));
    }
    if let Some((host, port_raw)) = host_port.rsplit_once(':') {
        if !host.is_empty() {
            if let Ok(port) = port_raw.parse::<u16>() {
                if port != 0 {
                    return Some((host.to_string(), port));
                }
            }
        }
    }
    // Host only — OpenClaw default local port.
    Some((host_port.to_string(), OPENCLAW_DEFAULT_LOCAL_PORT))
}

pub(crate) async fn probe_openclaw_gateway_reachable(discovery: &OpenClawGatewayDiscovery) -> bool {
    let Some((host, port)) = openclaw_probe_target(discovery) else {
        return false;
    };
    match tokio::time::timeout(
        std::time::Duration::from_millis(400),
        tokio::net::TcpStream::connect((host.as_str(), port)),
    )
    .await
    {
        Ok(Ok(_)) => true,
        _ => false,
    }
}

pub(crate) async fn run_openclaw_cli(args: &[&str], timeout_secs: u64) -> Result<(bool, String), AcpError> {
    let cli = resolve_openclaw_cli().await?;
    let mut cmd = crate::process::tokio_command(&cli);
    cmd.args(args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let child = cmd
        .spawn()
        .map_err(|e| AcpError::protocol(format!("failed to spawn openclaw: {e}")))?;
    let output = match tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            return Err(AcpError::protocol(format!("openclaw command failed: {e}")));
        }
        Err(_) => {
            return Err(AcpError::protocol(format!(
                "openclaw {} timed out after {timeout_secs}s",
                args.join(" ")
            )));
        }
    };
    let mut text = String::new();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stdout.trim().is_empty() {
        text.push_str(stdout.trim());
    }
    if !stderr.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(stderr.trim());
    }
    Ok((output.status.success(), text))
}
