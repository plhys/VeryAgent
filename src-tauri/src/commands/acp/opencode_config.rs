use super::*;
use std::path::PathBuf;

use crate::acp::error::AcpError;


/// OpenCode reads config from `$XDG_CONFIG_HOME/opencode` (falling back to
/// `~/.config/opencode`) and credentials from `$XDG_DATA_HOME/opencode`
/// (falling back to `~/.local/share/opencode`) on every platform. veryagent must
/// write where OpenCode reads, so these reuse the same XDG resolution as
/// `opencode_plugins` (config) and `parsers::opencode` (data) — otherwise a
/// user with XDG dirs set would get credentials written where OpenCode never
/// looks, and veryagent's own plugin/connect paths would diverge.
pub(crate) fn opencode_config_dir() -> PathBuf {
    crate::acp::opencode_plugins::xdg_config_home()
        .unwrap_or_else(|| home_dir_or_default().join(".config"))
        .join("opencode")
}

pub(crate) fn opencode_primary_config_path() -> PathBuf {
    opencode_config_dir().join("opencode.json")
}

pub(crate) fn opencode_legacy_config_path() -> PathBuf {
    opencode_config_dir().join("config.json")
}

pub(crate) fn resolve_opencode_config_path() -> PathBuf {
    let primary = opencode_primary_config_path();
    if primary.exists() {
        return primary;
    }

    let legacy = opencode_legacy_config_path();
    if legacy.exists() {
        return legacy;
    }

    primary
}

pub(crate) fn opencode_auth_json_path() -> PathBuf {
    crate::parsers::opencode::resolve_opencode_base_dir().join("auth.json")
}

pub(crate) fn load_opencode_auth_json_raw() -> Option<String> {
    fs::read_to_string(opencode_auth_json_path()).ok()
}

pub(crate) fn persist_opencode_auth_json(raw_auth: &str) -> Result<(), AcpError> {
    let parsed = serde_json::from_str::<serde_json::Value>(raw_auth)
        .map_err(|e| AcpError::protocol(format!("invalid opencode auth.json: {e}")))?;
    if !parsed.is_object() {
        return Err(AcpError::protocol(
            "invalid opencode auth.json: root must be a JSON object",
        ));
    }
    let path = opencode_auth_json_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create opencode directory failed: {e}")))?;
    }
    fs::write(&path, format!("{raw_auth}\n"))
        .map_err(|e| AcpError::protocol(format!("write opencode auth.json failed: {e}")))?;
    Ok(())
}

/// Managed OpenCode provider id written by the unified model-provider cascade.
pub(crate) const OPENCODE_MANAGED_PROVIDER: &str = "veryagent";
pub(crate) const OPENCODE_OPENAI_COMPAT_NPM: &str = "@ai-sdk/openai-compatible";

/// Merge-write a `provider.veryagent` block into opencode.json and the matching
/// credential into auth.json. Preserves every other provider / top-level key.
///
/// `model` is the agent-selected default. Chat only shows models the agent
/// actually loads, so the managed provider table is limited to that selection
/// (plus any explicit `catalog` entries callers still pass). Do not dump the
/// entire gateway `/models` list — embeddings / image / unused ids are noise.
pub(crate) fn write_opencode_managed_provider(
    api_url: &str,
    api_key: &str,
    model: Option<&str>,
    catalog: &[String],
) -> Result<(), AcpError> {
    let config_path = resolve_opencode_config_path();
    let mut config = if config_path.exists() {
        // opencode.json is JSONC (comments allowed) — strip comments before
        // parsing so a user's annotated config does not degrade to `{}` and
        // get silently replaced by the managed block.
        fs::read_to_string(&config_path)
            .ok()
            .map(|raw| strip_jsonc_comments(&raw))
            .and_then(|clean| serde_json::from_str::<serde_json::Value>(&clean).ok())
            .filter(|v| v.is_object())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let config_obj = config
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("opencode config root must be a JSON object"))?;

    let provider_root = config_obj
        .entry("provider".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !provider_root.is_object() {
        *provider_root = serde_json::json!({});
    }
    let providers = provider_root
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("invalid opencode provider table"))?;

    let provider_item = providers
        .entry(OPENCODE_MANAGED_PROVIDER.to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !provider_item.is_object() {
        *provider_item = serde_json::json!({});
    }
    let provider_obj = provider_item
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("invalid opencode provider block"))?;

    provider_obj.insert(
        "npm".to_string(),
        serde_json::Value::String(OPENCODE_OPENAI_COMPAT_NPM.to_string()),
    );
    provider_obj.insert(
        "name".to_string(),
        serde_json::Value::String(OPENCODE_MANAGED_PROVIDER.to_string()),
    );

    let options_item = provider_obj
        .entry("options".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !options_item.is_object() {
        *options_item = serde_json::json!({});
    }
    let options = options_item
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("invalid opencode provider options"))?;
    // Secrets never belong in opencode.json.
    options.remove("apiKey");
    if api_url.trim().is_empty() {
        options.remove("baseURL");
    } else {
        let normalized = normalize_openai_compatible_base_url(api_url);
        options.insert(
            "baseURL".to_string(),
            serde_json::Value::String(normalized),
        );
    }
    if options.is_empty() {
        provider_obj.remove("options");
    }

    let model_id = model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        // OpenCode model values are `provider/model`; accept either form.
        .map(|s| {
            s.strip_prefix(&format!("{OPENCODE_MANAGED_PROVIDER}/"))
                .unwrap_or(s)
                .to_string()
        });

    // Managed models table = configured selection only (and any explicit extras).
    // Always replace so stale gateway dump entries cannot linger in chat.
    let mut catalog_ids: Vec<String> = catalog
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.strip_prefix(&format!("{OPENCODE_MANAGED_PROVIDER}/"))
                .unwrap_or(s)
                .to_string()
        })
        .collect();
    if let Some(ref mid) = model_id {
        if !catalog_ids.iter().any(|id| id == mid) {
            catalog_ids.push(mid.clone());
        }
    }
    if !catalog_ids.is_empty() {
        let mut models = serde_json::Map::new();
        for mid in &catalog_ids {
            models.insert(mid.clone(), serde_json::json!({ "name": mid }));
        }
        provider_obj.insert("models".to_string(), serde_json::Value::Object(models));
    }
    if let Some(ref mid) = model_id {
        config_obj.insert(
            "model".to_string(),
            serde_json::Value::String(format!("{OPENCODE_MANAGED_PROVIDER}/{mid}")),
        );
    }

    let config_str = serde_json::to_string_pretty(&config)
        .map_err(|e| AcpError::protocol(format!("serialize opencode config failed: {e}")))?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create opencode directory failed: {e}")))?;
    }
    fs::write(&config_path, format!("{config_str}\n"))
        .map_err(|e| AcpError::protocol(format!("write opencode config failed: {e}")))?;

    // auth.json: merge credential for the managed provider only.
    let auth_path = opencode_auth_json_path();
    let mut auth_obj = if auth_path.exists() {
        fs::read_to_string(&auth_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .filter(|v| v.is_object())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if !api_key.trim().is_empty() {
        auth_obj[OPENCODE_MANAGED_PROVIDER] = serde_json::json!({
            "type": "api",
            "key": api_key,
        });
    }
    let auth_str = serde_json::to_string_pretty(&auth_obj)
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    persist_opencode_auth_json(&auth_str)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// MiMo Code managed provider (OpenCode fork — same schema, different paths)
// ---------------------------------------------------------------------------

/// Managed provider id written by the unified model-provider cascade.
/// Same value as OpenCode's — both agents use `veryagent` as the provider key.
pub(crate) const MIMO_MANAGED_PROVIDER: &str = "veryagent";

/// Resolve the MiMo Code config file path: `~/.config/mimocode/mimocode.jsonc`.
/// MiMo Code (OpenCode fork) uses JSONC (JSON with comments) for its config.
pub(crate) fn resolve_mimo_config_path() -> PathBuf {
    let config_dir = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))
        .unwrap_or_else(|| PathBuf::from(".config"));
    config_dir.join("mimocode").join("mimocode.jsonc")
}

/// Merge-write a managed `veryagent` provider into MiMo Code's config file
/// (`mimocode.jsonc`) and credential file (`auth.json`).
///
/// Mirrors [`write_opencode_managed_provider`] but targets MiMo Code's
/// paths. The config file is JSONC — comments are stripped before parsing
/// and the output is written as plain JSON (comments are not preserved on
/// rewrite, but veryAgent only manages its own `provider.veryagent` block).
pub(crate) fn write_mimo_managed_provider(
    api_url: &str,
    api_key: &str,
    model: Option<&str>,
    catalog: &[String],
) -> Result<(), AcpError> {
    let config_path = resolve_mimo_config_path();
    let mut config = if config_path.exists() {
        fs::read_to_string(&config_path)
            .ok()
            .map(|raw| strip_jsonc_comments(&raw))
            .and_then(|clean| serde_json::from_str::<serde_json::Value>(&clean).ok())
            .filter(|v| v.is_object())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let config_obj = config
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("mimo config root must be a JSON object"))?;

    let provider_root = config_obj
        .entry("provider".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !provider_root.is_object() {
        *provider_root = serde_json::json!({});
    }
    let providers = provider_root
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("invalid mimo provider table"))?;

    let provider_item = providers
        .entry(MIMO_MANAGED_PROVIDER.to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !provider_item.is_object() {
        *provider_item = serde_json::json!({});
    }
    let provider_obj = provider_item
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("invalid mimo provider block"))?;

    provider_obj.insert(
        "npm".to_string(),
        serde_json::Value::String(OPENCODE_OPENAI_COMPAT_NPM.to_string()),
    );
    provider_obj.insert(
        "name".to_string(),
        serde_json::Value::String(MIMO_MANAGED_PROVIDER.to_string()),
    );

    let options_item = provider_obj
        .entry("options".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !options_item.is_object() {
        *options_item = serde_json::json!({});
    }
    let options = options_item
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("invalid mimo provider options"))?;
    options.remove("apiKey");
    if api_url.trim().is_empty() {
        options.remove("baseURL");
    } else {
        let normalized = normalize_openai_compatible_base_url(api_url);
        options.insert(
            "baseURL".to_string(),
            serde_json::Value::String(normalized),
        );
    }
    if options.is_empty() {
        provider_obj.remove("options");
    }

    let model_id = model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.strip_prefix(&format!("{MIMO_MANAGED_PROVIDER}/"))
                .unwrap_or(s)
                .to_string()
        });

    let mut catalog_ids: Vec<String> = catalog
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.strip_prefix(&format!("{MIMO_MANAGED_PROVIDER}/"))
                .unwrap_or(s)
                .to_string()
        })
        .collect();
    if let Some(ref mid) = model_id {
        if !catalog_ids.iter().any(|id| id == mid) {
            catalog_ids.push(mid.clone());
        }
    }
    if !catalog_ids.is_empty() {
        let mut models = serde_json::Map::new();
        for mid in &catalog_ids {
            models.insert(mid.clone(), serde_json::json!({ "name": mid }));
        }
        provider_obj.insert("models".to_string(), serde_json::Value::Object(models));
    }
    if let Some(ref mid) = model_id {
        config_obj.insert(
            "model".to_string(),
            serde_json::Value::String(format!("{MIMO_MANAGED_PROVIDER}/{mid}")),
        );
    }

    let config_str = serde_json::to_string_pretty(&config)
        .map_err(|e| AcpError::protocol(format!("serialize mimo config failed: {e}")))?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create mimo config directory failed: {e}")))?;
    }
    fs::write(&config_path, format!("{config_str}\n"))
        .map_err(|e| AcpError::protocol(format!("write mimo config failed: {e}")))?;

    // auth.json: merge credential for the managed provider only.
    let auth_path = mimo_auth_json_path();
    let mut auth_obj = if auth_path.exists() {
        fs::read_to_string(&auth_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .filter(|v| v.is_object())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if !api_key.trim().is_empty() {
        auth_obj[MIMO_MANAGED_PROVIDER] = serde_json::json!({
            "type": "api",
            "key": api_key,
        });
    }
    let auth_str = serde_json::to_string_pretty(&auth_obj)
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    if let Some(parent) = auth_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create mimo auth directory failed: {e}")))?;
    }
    fs::write(&auth_path, format!("{auth_str}\n"))
        .map_err(|e| AcpError::protocol(format!("write mimo auth.json failed: {e}")))?;
    Ok(())
}

/// Decide what to write to OpenCode's `auth.json`. `None` (caller passed no
/// auth payload) leaves the file untouched. An explicitly empty payload becomes
/// `{}` so clearing the last credential truncates the file instead of being
/// skipped — otherwise a stale key would survive on disk and the disconnected
/// provider would reappear after reload.
pub(crate) fn opencode_auth_payload_to_write(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    Some(if trimmed.is_empty() {
        "{}".to_string()
    } else {
        trimmed.to_string()
    })
}
