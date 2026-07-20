use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use serde_json::Value;

use crate::app_error::AppCommandError;
use super::*;

// ---------------------------------------------------------------------------
// CodeBuddy  (~/.codebuddy.json  →  mcpServers)
//
// CodeBuddy is a Claude Code derivative and shares its on-disk MCP layout:
// user-scope servers live in `~/.codebuddy.json.mcpServers`, gated for
// activation by `<id>@local: true` in
// `~/.codebuddy/settings.json.enabledPlugins`. These mirror the Claude helpers,
// only pointed at CodeBuddy's files.
// ---------------------------------------------------------------------------

pub(crate) fn codebuddy_config_path() -> PathBuf {
    home_dir_or_default().join(".codebuddy.json")
}

pub(crate) fn codebuddy_settings_path() -> PathBuf {
    home_dir_or_default().join(".codebuddy").join("settings.json")
}

pub(crate) fn read_codebuddy_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let path = codebuddy_config_path();
    let root = read_json_file(&path)?;
    let mut out = BTreeMap::new();

    let Some(servers) = root.get("mcpServers").and_then(Value::as_object) else {
        return Ok(out);
    };

    for (id, spec) in servers {
        match canonicalize_spec(spec, "CodeBuddy config") {
            Ok(normalized) => {
                out.insert(id.to_string(), normalized);
            }
            Err(err) => {
                eprintln!("[MCP] skip invalid CodeBuddy MCP entry id={id}: {err}");
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_codebuddy_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    let path = codebuddy_config_path();
    let mut root = read_json_file(&path)?;
    if !root.is_object() {
        root = json!({});
    }

    let canonical = canonicalize_spec(spec, "CodeBuddy write")?;

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
    enable_codebuddy_local_plugin(id)
}

pub(crate) fn remove_codebuddy_server(id: &str) -> Result<bool, AppCommandError> {
    let path = codebuddy_config_path();
    if !path.exists() {
        disable_codebuddy_local_plugin(id)?;
        return Ok(false);
    }

    let mut root = read_json_file(&path)?;
    let Some(obj) = root.as_object_mut() else {
        disable_codebuddy_local_plugin(id)?;
        return Ok(false);
    };
    let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) else {
        disable_codebuddy_local_plugin(id)?;
        return Ok(false);
    };

    let removed = servers.remove(id).is_some();
    if removed {
        write_json_file(&path, &root)?;
    }
    disable_codebuddy_local_plugin(id)?;
    Ok(removed)
}

/// Add `<id>@local: true` to `~/.codebuddy/settings.json.enabledPlugins`,
/// mirroring the Claude Code plugin-activation gate that CodeBuddy inherits.
pub(crate) fn enable_codebuddy_local_plugin(id: &str) -> Result<(), AppCommandError> {
    let path = codebuddy_settings_path();
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
    if matches!(plugins.get(&key), Some(Value::Bool(true))) {
        return Ok(());
    }
    plugins.insert(key, Value::Bool(true));
    write_json_file(&path, &root)
}

/// Remove `<id>@local` from `~/.codebuddy/settings.json.enabledPlugins` if
/// present. Other entries are intentionally left untouched.
pub(crate) fn disable_codebuddy_local_plugin(id: &str) -> Result<(), AppCommandError> {
    let path = codebuddy_settings_path();
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

pub(crate) fn read_codex_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let root = read_codex_root_toml()?;
    let Some(table) = root.as_table() else {
        return Ok(BTreeMap::new());
    };

    let mut out = BTreeMap::new();

    if let Some(current) = table.get("mcp_servers").and_then(toml::Value::as_table) {
        for (id, spec) in current {
            match codex_entry_to_canonical(id, spec) {
                Ok(normalized) => {
                    out.insert(id.to_string(), normalized);
                }
                Err(err) => {
                    tracing::warn!("[MCP] skip invalid Codex mcp_servers entry id={id}: {err}");
                }
            }
        }
    }

    if let Some(legacy_mcp) = table.get("mcp").and_then(toml::Value::as_table) {
        if let Some(legacy_servers) = legacy_mcp.get("servers").and_then(toml::Value::as_table) {
            for (id, spec) in legacy_servers {
                if out.contains_key(id) {
                    continue;
                }
                match codex_entry_to_canonical(id, spec) {
                    Ok(normalized) => {
                        out.insert(id.to_string(), normalized);
                    }
                    Err(err) => {
                        tracing::warn!("[MCP] skip invalid Codex mcp.servers entry id={id}: {err}");
                    }
                }
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_codex_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    let mut root = read_codex_root_toml()?;
    let table = root
        .as_table_mut()
        .ok_or_else(|| mcp_configuration_invalid("Codex root TOML must be a table"))?;

    let codex_entry = canonical_to_codex_entry(spec)?;

    if !table
        .get("mcp_servers")
        .map(toml::Value::is_table)
        .unwrap_or(false)
    {
        table.insert(
            "mcp_servers".to_string(),
            toml::Value::Table(toml::map::Map::new()),
        );
    }

    let mcp_servers = table
        .get_mut("mcp_servers")
        .and_then(toml::Value::as_table_mut)
        .ok_or_else(|| mcp_configuration_invalid("Codex mcp_servers must be a TOML table"))?;
    mcp_servers.insert(id.to_string(), codex_entry);

    if let Some(legacy_mcp) = table.get_mut("mcp").and_then(toml::Value::as_table_mut) {
        if let Some(legacy_servers) = legacy_mcp
            .get_mut("servers")
            .and_then(toml::Value::as_table_mut)
        {
            legacy_servers.remove(id);
            if legacy_servers.is_empty() {
                legacy_mcp.remove("servers");
            }
        }
        if legacy_mcp.is_empty() {
            table.remove("mcp");
        }
    }

    write_codex_root_toml(&root)
}

pub(crate) fn remove_codex_server(id: &str) -> Result<bool, AppCommandError> {
    let path = codex_config_toml_path();
    if !path.exists() {
        return Ok(false);
    }

    let mut root = read_codex_root_toml()?;
    let Some(table) = root.as_table_mut() else {
        return Ok(false);
    };

    let mut removed = false;

    if let Some(mcp_servers) = table
        .get_mut("mcp_servers")
        .and_then(toml::Value::as_table_mut)
    {
        removed |= mcp_servers.remove(id).is_some();
        if mcp_servers.is_empty() {
            table.remove("mcp_servers");
        }
    }

    if let Some(legacy_mcp) = table.get_mut("mcp").and_then(toml::Value::as_table_mut) {
        if let Some(legacy_servers) = legacy_mcp
            .get_mut("servers")
            .and_then(toml::Value::as_table_mut)
        {
            removed |= legacy_servers.remove(id).is_some();
            if legacy_servers.is_empty() {
                legacy_mcp.remove("servers");
            }
        }
        if legacy_mcp.is_empty() {
            table.remove("mcp");
        }
    }

    if removed {
        write_codex_root_toml(&root)?;
    }

    Ok(removed)
}

pub(crate) fn read_opencode_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let path = opencode_config_path();
    let root = read_json_file(&path)?;

    let mut out = BTreeMap::new();

    if let Some(servers) = root.get("mcpServers").and_then(Value::as_object) {
        for (id, spec) in servers {
            match canonicalize_spec(spec, "OpenCode mcpServers") {
                Ok(normalized) => {
                    out.insert(id.to_string(), normalized);
                }
                Err(err) => {
                    tracing::warn!("[MCP] skip invalid OpenCode mcpServers entry id={id}: {err}");
                }
            }
        }
    }

    if let Some(servers) = root.get("mcp").and_then(Value::as_object) {
        for (id, spec) in servers {
            if out.contains_key(id) {
                continue;
            }
            match canonicalize_opencode_spec(spec, "OpenCode mcp") {
                Ok(normalized) => {
                    out.insert(id.to_string(), normalized);
                }
                Err(err) => {
                    tracing::warn!("[MCP] skip invalid OpenCode mcp entry id={id}: {err}");
                }
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_opencode_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    let path = opencode_config_path();
    let mut root = read_json_file(&path)?;
    if !root.is_object() {
        root = json!({});
    }

    let obj = root.as_object_mut().ok_or_else(|| {
        mcp_configuration_invalid(format!("invalid JSON root in {}", path.display()))
    })?;

    if obj.get("mcpServers").map(Value::is_object).unwrap_or(false) {
        let canonical = canonicalize_spec(spec, "OpenCode write mcpServers")?;
        let map = obj
            .get_mut("mcpServers")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                mcp_configuration_invalid(format!("invalid mcpServers in {}", path.display()))
            })?;
        map.insert(id.to_string(), canonical);
    } else {
        if !obj.get("mcp").map(Value::is_object).unwrap_or(false) {
            obj.insert("mcp".to_string(), Value::Object(Map::new()));
        }
        let converted = canonical_to_opencode_spec(spec)?;
        let map = obj
            .get_mut("mcp")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                mcp_configuration_invalid(format!("invalid mcp in {}", path.display()))
            })?;
        map.insert(id.to_string(), converted);
    }

    write_json_file(&path, &root)
}

pub(crate) fn remove_opencode_server(id: &str) -> Result<bool, AppCommandError> {
    let path = opencode_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let mut root = read_json_file(&path)?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };

    let mut removed = false;

    if let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) {
        removed |= servers.remove(id).is_some();
    }

    if let Some(servers) = obj.get_mut("mcp").and_then(Value::as_object_mut) {
        removed |= servers.remove(id).is_some();
    }

    if removed {
        write_json_file(&path, &root)?;
    }

    Ok(removed)
}

// ---------------------------------------------------------------------------
// MiMo Code  (~/.config/mimocode/mimocode.json  →  mcpServers)
//
// MiMo Code is an OpenCode fork by Xiaomi; it reads MCP server config from
// `~/.config/mimocode/mimocode.json` using the same `mcpServers` format as
// OpenCode. This implementation mirrors `read/upsert/remove_opencode_server`.
// ---------------------------------------------------------------------------

pub(crate) fn read_mimo_code_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let path = mimo_code_config_path();
    let root = read_json_file(&path)?;

    let mut out = BTreeMap::new();

    if let Some(servers) = root.get("mcpServers").and_then(Value::as_object) {
        for (id, spec) in servers {
            match canonicalize_spec(spec, "MiMo Code mcpServers") {
                Ok(normalized) => {
                    out.insert(id.to_string(), normalized);
                }
                Err(err) => {
                    tracing::warn!("[MCP] skip invalid MiMo Code mcpServers entry id={id}: {err}");
                }
            }
        }
    }

    if let Some(servers) = root.get("mcp").and_then(Value::as_object) {
        for (id, spec) in servers {
            if out.contains_key(id) {
                continue;
            }
            match canonicalize_opencode_spec(spec, "MiMo Code mcp") {
                Ok(normalized) => {
                    out.insert(id.to_string(), normalized);
                }
                Err(err) => {
                    tracing::warn!("[MCP] skip invalid MiMo Code mcp entry id={id}: {err}");
                }
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_mimo_code_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    let path = mimo_code_config_path();
    let mut root = read_json_file(&path)?;
    if !root.is_object() {
        root = json!({});
    }

    let obj = root.as_object_mut().ok_or_else(|| {
        mcp_configuration_invalid(format!("invalid JSON root in {}", path.display()))
    })?;

    if obj.get("mcpServers").map(Value::is_object).unwrap_or(false) {
        let canonical = canonicalize_spec(spec, "MiMo Code write mcpServers")?;
        let map = obj
            .get_mut("mcpServers")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                mcp_configuration_invalid(format!("invalid mcpServers in {}", path.display()))
            })?;
        map.insert(id.to_string(), canonical);
    } else {
        if !obj.get("mcp").map(Value::is_object).unwrap_or(false) {
            obj.insert("mcp".to_string(), Value::Object(Map::new()));
        }
        let converted = canonical_to_opencode_spec(spec)?;
        let map = obj
            .get_mut("mcp")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                mcp_configuration_invalid(format!("invalid mcp in {}", path.display()))
            })?;
        map.insert(id.to_string(), converted);
    }

    write_json_file(&path, &root)
}

pub(crate) fn remove_mimo_code_server(id: &str) -> Result<bool, AppCommandError> {
    let path = mimo_code_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let mut root = read_json_file(&path)?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };

    let mut removed = false;

    if let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) {
        removed |= servers.remove(id).is_some();
    }

    if let Some(servers) = obj.get_mut("mcp").and_then(Value::as_object_mut) {
        removed |= servers.remove(id).is_some();
    }

    if removed {
        write_json_file(&path, &root)?;
    }

    Ok(removed)
}

// ---------------------------------------------------------------------------
// Gemini CLI  (~/.gemini/settings.json  →  mcpServers)
// ---------------------------------------------------------------------------

pub(crate) fn read_gemini_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let path = gemini_config_path();
    let root = read_json_file(&path)?;
    let mut out = BTreeMap::new();

    let Some(servers) = root.get("mcpServers").and_then(Value::as_object) else {
        return Ok(out);
    };

    for (id, spec) in servers {
        match canonicalize_spec(spec, "Gemini config") {
            Ok(normalized) => {
                out.insert(id.to_string(), normalized);
            }
            Err(err) => {
                tracing::warn!("[MCP] skip invalid Gemini MCP entry id={id}: {err}");
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_gemini_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    let path = gemini_config_path();
    let mut root = read_json_file(&path)?;
    if !root.is_object() {
        root = json!({});
    }

    let canonical = canonicalize_spec(spec, "Gemini write")?;

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

    write_json_file(&path, &root)
}

pub(crate) fn remove_gemini_server(id: &str) -> Result<bool, AppCommandError> {
    let path = gemini_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let mut root = read_json_file(&path)?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };
    let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) else {
        return Ok(false);
    };

    let removed = servers.remove(id).is_some();
    if removed {
        write_json_file(&path, &root)?;
    }
    Ok(removed)
}

// ---------------------------------------------------------------------------
// OpenClaw  (~/.openclaw/openclaw.json  →  mcp.servers)
// ---------------------------------------------------------------------------

pub(crate) fn read_openclaw_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let path = openclaw_config_path();
    let root = read_json_file(&path)?;
    let mut out = BTreeMap::new();

    let Some(mcp) = root.get("mcp").and_then(Value::as_object) else {
        return Ok(out);
    };
    let Some(servers) = mcp.get("servers").and_then(Value::as_object) else {
        return Ok(out);
    };

    for (id, spec) in servers {
        match canonicalize_spec(spec, "OpenClaw config") {
            Ok(normalized) => {
                out.insert(id.to_string(), normalized);
            }
            Err(err) => {
                tracing::warn!("[MCP] skip invalid OpenClaw MCP entry id={id}: {err}");
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_openclaw_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    let path = openclaw_config_path();
    let mut root = read_json_file(&path)?;
    if !root.is_object() {
        root = json!({});
    }

    let canonical = canonicalize_spec(spec, "OpenClaw write")?;

    let obj = root.as_object_mut().ok_or_else(|| {
        mcp_configuration_invalid(format!("invalid JSON root in {}", path.display()))
    })?;

    if !obj.get("mcp").map(Value::is_object).unwrap_or(false) {
        obj.insert("mcp".to_string(), json!({}));
    }
    let mcp = obj
        .get_mut("mcp")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| mcp_configuration_invalid(format!("invalid mcp in {}", path.display())))?;

    if !mcp.get("servers").map(Value::is_object).unwrap_or(false) {
        mcp.insert("servers".to_string(), Value::Object(Map::new()));
    }
    let servers = mcp
        .get_mut("servers")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            mcp_configuration_invalid(format!("invalid mcp.servers in {}", path.display()))
        })?;
    servers.insert(id.to_string(), canonical);

    write_json_file(&path, &root)
}

pub(crate) fn remove_openclaw_server(id: &str) -> Result<bool, AppCommandError> {
    let path = openclaw_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let mut root = read_json_file(&path)?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };
    let Some(mcp) = obj.get_mut("mcp").and_then(Value::as_object_mut) else {
        return Ok(false);
    };
    let Some(servers) = mcp.get_mut("servers").and_then(Value::as_object_mut) else {
        return Ok(false);
    };

    let removed = servers.remove(id).is_some();
    if removed {
        if servers.is_empty() {
            mcp.remove("servers");
        }
        if mcp.is_empty() {
            obj.remove("mcp");
        }
        write_json_file(&path, &root)?;
    }
    Ok(removed)
}

// ---------------------------------------------------------------------------
// Cline  (~/.cline/data/settings/cline_mcp_settings.json  →  mcpServers)
// ---------------------------------------------------------------------------

pub(crate) fn read_cline_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let path = cline_config_path();
    let root = read_json_file(&path)?;
    let mut out = BTreeMap::new();

    let Some(servers) = root.get("mcpServers").and_then(Value::as_object) else {
        return Ok(out);
    };

    for (id, spec) in servers {
        match canonicalize_spec(spec, "Cline config") {
            Ok(normalized) => {
                out.insert(id.to_string(), normalized);
            }
            Err(err) => {
                tracing::warn!("[MCP] skip invalid Cline MCP entry id={id}: {err}");
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_cline_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    let path = cline_config_path();
    let mut root = read_json_file(&path)?;
    if !root.is_object() {
        root = json!({});
    }

    let canonical = canonicalize_spec(spec, "Cline write")?;

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

    write_json_file(&path, &root)
}

pub(crate) fn remove_cline_server(id: &str) -> Result<bool, AppCommandError> {
    let path = cline_config_path();
    if !path.exists() {
        return Ok(false);
    }

    let mut root = read_json_file(&path)?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };
    let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) else {
        return Ok(false);
    };

    let removed = servers.remove(id).is_some();
    if removed {
        write_json_file(&path, &root)?;
    }
    Ok(removed)
}

pub(crate) fn scan_local_servers() -> Result<Vec<LocalMcpServer>, AppCommandError> {
    let mut merged: BTreeMap<String, (Value, BTreeSet<McpAppType>)> = BTreeMap::new();

    for (id, spec) in read_claude_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::ClaudeCode);
    }

    for (id, spec) in read_codex_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::Codex);
    }

    for (id, spec) in read_opencode_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::OpenCode);
    }

    for (id, spec) in read_gemini_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::Gemini);
    }

    for (id, spec) in read_openclaw_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::OpenClaw);
    }

    for (id, spec) in read_cline_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::Cline);
    }

    for (id, spec) in read_hermes_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::Hermes);
    }

    for (id, spec) in read_codebuddy_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::CodeBuddy);
    }

    for (id, spec) in read_kimi_code_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::KimiCode);
    }

    for (id, spec) in read_mimo_code_servers()? {
        let entry = merged
            .entry(id)
            .or_insert_with(|| (spec.clone(), BTreeSet::new()));
        entry.1.insert(McpAppType::MimoCode);
    }

    Ok(merged
        .into_iter()
        .map(|(id, (spec, apps))| LocalMcpServer {
            id,
            spec,
            apps: apps.into_iter().collect(),
        })
        .collect())
}

pub(crate) fn find_local_server(server_id: &str) -> Result<Option<LocalMcpServer>, AppCommandError> {
    let servers = scan_local_servers()?;
    Ok(servers.into_iter().find(|item| item.id == server_id))
}

pub(crate) fn upsert_server_for_app(app: McpAppType, id: &str, spec: &Value) -> Result<(), AppCommandError> {
    match app {
        McpAppType::ClaudeCode => adapters::claude::ClaudeAdapter.upsert_server(id, spec),
        McpAppType::Codex => adapters::codex::CodexAdapter.upsert_server(id, spec),
        McpAppType::OpenCode => adapters::opencode::OpenCodeAdapter.upsert_server(id, spec),
        McpAppType::Gemini => adapters::gemini::GeminiAdapter.upsert_server(id, spec),
        McpAppType::OpenClaw => adapters::openclaw::OpenClawAdapter.upsert_server(id, spec),
        McpAppType::Cline => adapters::cline::ClineAdapter.upsert_server(id, spec),
        McpAppType::Hermes => adapters::hermes::HermesAdapter.upsert_server(id, spec),
        McpAppType::CodeBuddy => adapters::codebuddy::CodeBuddyAdapter.upsert_server(id, spec),
        McpAppType::KimiCode => adapters::kimi_code::KimiCodeAdapter.upsert_server(id, spec),
        McpAppType::MimoCode => adapters::mimo_code::MimoCodeAdapter.upsert_server(id, spec),
    }
}

pub fn read_servers_for_agent_type(
    agent_type: crate::models::agent::AgentType,
) -> Result<BTreeMap<String, Value>, AppCommandError> {
    use crate::models::agent::AgentType;
    match agent_type {
        AgentType::ClaudeCode => adapters::claude::ClaudeAdapter.read_servers(),
        AgentType::Codex => adapters::codex::CodexAdapter.read_servers(),
        AgentType::OpenCode => adapters::opencode::OpenCodeAdapter.read_servers(),
        AgentType::Gemini => adapters::gemini::GeminiAdapter.read_servers(),
        AgentType::OpenClaw => adapters::openclaw::OpenClawAdapter.read_servers(),
        AgentType::Cline => adapters::cline::ClineAdapter.read_servers(),
        AgentType::Hermes => adapters::hermes::HermesAdapter.read_servers(),
        AgentType::CodeBuddy => adapters::codebuddy::CodeBuddyAdapter.read_servers(),
        AgentType::KimiCode => adapters::kimi_code::KimiCodeAdapter.read_servers(),
        AgentType::MimoCode => adapters::mimo_code::MimoCodeAdapter.read_servers(),
        // pi-acp drops ACP-wire MCP and pi has no native MCP (it needs a
        // third-party extension), so veryagent manages no MCP servers for pi (v1).
        AgentType::Pi => Ok(BTreeMap::new()),
    }
}

// ---------------------------------------------------------------------------
// Kimi Code  (~/.kimi-code/mcp.json  →  top-level `mcpServers`)
//
// Kimi reads its user-global MCP config from `<KIMI_CODE_HOME>/mcp.json`
// (default `~/.kimi-code/mcp.json`) — a JSON file with a top-level `mcpServers`
// object of Claude-shaped entries (`command`/`args`/`env`/`cwd`, or `url` for
// http/sse). This mirrors CodeBuddy/Cline's JSON layout (NOT Codex's TOML).
//
// Because Kimi loads this file natively at session start, `KimiCode` is on the
// ACP forward skip list in `connection.rs` (like Hermes) so the same user
// servers aren't double-registered over `session/new`. The built-in `veryagent-mcp`
// companion is injected separately by `inject_veryagent_mcp`, so it still reaches
// Kimi regardless.
// ---------------------------------------------------------------------------

pub(crate) fn kimi_code_mcp_json_path() -> PathBuf {
    crate::parsers::kimi_code::resolve_kimi_code_home_dir().join("mcp.json")
}

pub(crate) fn read_kimi_code_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    read_kimi_code_servers_at(&kimi_code_mcp_json_path())
}

pub(crate) fn read_kimi_code_servers_at(path: &Path) -> Result<BTreeMap<String, Value>, AppCommandError> {
    let root = read_json_file(path)?;
    let mut out = BTreeMap::new();

    let Some(servers) = root.get("mcpServers").and_then(Value::as_object) else {
        return Ok(out);
    };

    for (id, spec) in servers {
        match canonicalize_spec(spec, "Kimi Code config") {
            Ok(normalized) => {
                out.insert(id.to_string(), normalized);
            }
            Err(err) => {
                eprintln!("[MCP] skip invalid Kimi Code MCP entry id={id}: {err}");
            }
        }
    }

    Ok(out)
}

pub(crate) fn upsert_kimi_code_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    upsert_kimi_code_server_at(&kimi_code_mcp_json_path(), id, spec)
}

pub(crate) fn upsert_kimi_code_server_at(
    path: &Path,
    id: &str,
    spec: &Value,
) -> Result<(), AppCommandError> {
    let mut root = read_json_file(path)?;
    if !root.is_object() {
        root = json!({});
    }

    let canonical = canonicalize_spec(spec, "Kimi Code write")?;

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

    write_json_file(path, &root)
}

pub(crate) fn remove_kimi_code_server(id: &str) -> Result<bool, AppCommandError> {
    remove_kimi_code_server_at(&kimi_code_mcp_json_path(), id)
}

pub(crate) fn remove_kimi_code_server_at(path: &Path, id: &str) -> Result<bool, AppCommandError> {
    if !path.exists() {
        return Ok(false);
    }

    let mut root = read_json_file(path)?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };
    let Some(servers) = obj.get_mut("mcpServers").and_then(Value::as_object_mut) else {
        return Ok(false);
    };

    let removed = servers.remove(id).is_some();
    if removed {
        write_json_file(path, &root)?;
    }
    Ok(removed)
}

// ---------------------------------------------------------------------------
// Hermes Agent  (~/.hermes/config.yaml  →  mcp_servers)
//
// Hermes reads the `mcp_servers` section of its own config.yaml natively at
// launch (registering each as an `mcp-<name>` toolset), so veryagent manages that
// section directly — the same "write the agent's own config file" model used
// for Codex/OpenCode — rather than forwarding servers over the ACP wire. The
// ACP forward path (`load_mcp_servers_for_agent`) deliberately skips Hermes to
// avoid double-registering what Hermes already reads from config.yaml.
//
// Hermes' entry shape: stdio = `{command, args, env}`; remote = `{url}` (+
// `transport: sse` for SSE, optional `headers` / `client_cert` / `client_key`).
// Translate to/from veryagent's canonical spec, whose discriminator is `type`.
// ---------------------------------------------------------------------------

/// Convert one Hermes `mcp_servers` YAML entry into veryagent's canonical spec.
pub(crate) fn hermes_entry_to_canonical(
    entry: &serde_yaml::Value,
    id: &str,
) -> Result<Value, AppCommandError> {
    let source = format!("Hermes mcp_servers '{id}'");
    let mut json = serde_json::to_value(entry)
        .map_err(|e| mcp_configuration_invalid(format!("{source}: cannot read entry: {e}")))?;
    let obj = json
        .as_object_mut()
        .ok_or_else(|| mcp_configuration_invalid(format!("{source}: entry must be a mapping")))?;
    // Hermes encodes SSE via `transport: sse` (not a `type` field); a bare `url`
    // is StreamableHTTP. Map that onto the canonical `type` so `canonicalize_spec`
    // classifies it (stdio is inferred from `command`). `transport` stays as a
    // passthrough key.
    if obj
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .is_empty()
        && obj.get("url").is_some()
    {
        let is_sse = obj
            .get("transport")
            .and_then(Value::as_str)
            .map(|t| t.eq_ignore_ascii_case("sse"))
            .unwrap_or(false);
        obj.insert(
            "type".to_string(),
            Value::String(if is_sse { "sse" } else { "http" }.to_string()),
        );
    }
    // `transport` is Hermes' encoding of the remote kind; the canonical `type`
    // now carries it, so drop the redundant key (keeps round-trips stable and
    // doesn't leak a Hermes-ism into specs shared with other agents).
    obj.remove("transport");
    canonicalize_spec(&json, &source)
}

/// Convert veryagent's canonical spec into a Hermes `mcp_servers` YAML entry.
pub(crate) fn canonical_to_hermes_entry(spec: &Value) -> Result<serde_yaml::Value, AppCommandError> {
    let canonical = canonicalize_spec(spec, "Hermes conversion")?;
    let obj = canonical
        .as_object()
        .ok_or_else(|| mcp_invalid_input("Hermes conversion: canonical spec must be an object"))?;
    let typ = obj.get("type").and_then(Value::as_str).unwrap_or("stdio");

    let mut out = Map::new();
    match typ {
        "stdio" => {
            // Hermes 0.16.0 reads only `command`/`args`/`env` for stdio MCP
            // (tools/mcp_tool.py → StdioServerParameters); it ignores `cwd`, so
            // don't write it — a silently-ignored key would misrepresent what
            // Hermes actually honors.
            for key in ["command", "args", "env"] {
                if let Some(value) = obj.get(key) {
                    out.insert(key.to_string(), value.clone());
                }
            }
        }
        "http" | "sse" => {
            if let Some(url) = obj.get("url") {
                out.insert("url".to_string(), url.clone());
            }
            if typ == "sse" {
                out.insert("transport".to_string(), Value::String("sse".to_string()));
            }
            if let Some(headers) = obj.get("headers") {
                out.insert("headers".to_string(), headers.clone());
            }
        }
        other => {
            return Err(mcp_invalid_input(format!(
                "Hermes conversion: unsupported MCP type '{other}'"
            )));
        }
    }
    // Preserve passthrough keys Hermes understands (mTLS `client_cert`/
    // `client_key`, an explicit `enabled` flag, etc.) — anything beyond the
    // transport fields and the `type` discriminator translated above.
    for (key, value) in obj {
        if matches!(
            key.as_str(),
            "type" | "command" | "args" | "env" | "cwd" | "url" | "headers" | "transport"
        ) {
            continue;
        }
        if !value.is_null() {
            out.insert(key.clone(), value.clone());
        }
    }

    serde_yaml::to_value(Value::Object(out)).map_err(|e| {
        mcp_configuration_invalid(format!("Hermes conversion: serialize entry failed: {e}"))
    })
}

/// Read Hermes' MCP servers from `~/.hermes/config.yaml` (`mcp_servers`). A
/// missing or unparseable config.yaml surfaces no servers rather than failing
/// the whole MCP scan — the file is large and user-owned.
pub(crate) fn read_hermes_servers() -> Result<BTreeMap<String, Value>, AppCommandError> {
    let path = crate::commands::acp::hermes_config_yaml_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(BTreeMap::new());
    };
    let root: serde_yaml::Value = match serde_yaml::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!("[MCP] skip Hermes mcp_servers: invalid config.yaml: {err}");
            return Ok(BTreeMap::new());
        }
    };

    let mut out = BTreeMap::new();
    let Some(servers) = root
        .get("mcp_servers")
        .and_then(serde_yaml::Value::as_mapping)
    else {
        return Ok(out);
    };
    for (key, entry) in servers {
        let Some(id) = key.as_str() else { continue };
        match hermes_entry_to_canonical(entry, id) {
            Ok(spec) => {
                out.insert(id.to_string(), spec);
            }
            Err(err) => {
                tracing::warn!("[MCP] skip invalid Hermes mcp_servers entry id={id}: {err}");
            }
        }
    }
    Ok(out)
}

/// Insert/update a Hermes MCP server in `~/.hermes/config.yaml` (`mcp_servers`),
/// preserving every other key. Written through the Hermes secret writer
/// (owner-only perms, symlink-preserving) since the file can carry env secrets.
/// Note: like the structured model save, this round-trips config.yaml through
/// serde_yaml and so drops comments — consistent with veryagent's existing Hermes
/// config edits.
pub(crate) fn upsert_hermes_server(id: &str, spec: &Value) -> Result<(), AppCommandError> {
    use serde_yaml::{Mapping, Value as Yaml};
    let entry = canonical_to_hermes_entry(spec)?;
    let path = crate::commands::acp::hermes_config_yaml_path();

    // Only a genuinely absent (or empty) config starts from a fresh mapping.
    // A permission / invalid-UTF-8 read error must NOT silently discard the
    // user's real config.yaml by overwriting it with a near-empty document.
    let mut root: Yaml = match fs::read_to_string(&path) {
        Ok(raw) if !raw.trim().is_empty() => serde_yaml::from_str(&raw)
            .map_err(|e| mcp_configuration_invalid(format!("invalid hermes config.yaml: {e}")))?,
        Ok(_) => Yaml::Mapping(Mapping::new()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Yaml::Mapping(Mapping::new()),
        Err(e) => {
            return Err(mcp_configuration_invalid(format!(
                "read hermes config.yaml failed: {e}"
            )));
        }
    };
    if !root.is_mapping() {
        root = Yaml::Mapping(Mapping::new());
    }
    let root_map = root.as_mapping_mut().expect("root is a mapping");
    let servers_key = Yaml::String("mcp_servers".to_string());
    if !root_map
        .get(&servers_key)
        .map(Yaml::is_mapping)
        .unwrap_or(false)
    {
        root_map.insert(servers_key.clone(), Yaml::Mapping(Mapping::new()));
    }
    let servers = root_map
        .get_mut(&servers_key)
        .and_then(Yaml::as_mapping_mut)
        .ok_or_else(|| mcp_configuration_invalid("hermes mcp_servers must be a mapping"))?;
    servers.insert(Yaml::String(id.to_string()), entry);

    let yaml = serde_yaml::to_string(&root).map_err(|e| {
        mcp_configuration_invalid(format!("serialize hermes config.yaml failed: {e}"))
    })?;
    crate::commands::acp::ensure_hermes_home_secure(&crate::commands::acp::hermes_home_dir())
        .map_err(|e| mcp_configuration_invalid(format!("prepare hermes home failed: {e}")))?;
    crate::commands::acp::write_hermes_secret_file(&path, &yaml, "config.yaml")
        .map_err(|e| mcp_configuration_invalid(format!("write hermes config.yaml failed: {e}")))?;
    Ok(())
}

/// Remove a Hermes MCP server from `~/.hermes/config.yaml` (`mcp_servers`).
pub(crate) fn remove_hermes_server(id: &str) -> Result<bool, AppCommandError> {
    use serde_yaml::Value as Yaml;
    let path = crate::commands::acp::hermes_config_yaml_path();
    let raw = match fs::read_to_string(&path) {
        Ok(raw) if !raw.trim().is_empty() => raw,
        _ => return Ok(false),
    };
    let mut root: Yaml = match serde_yaml::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            tracing::info!("[MCP] Hermes remove '{id}': invalid config.yaml: {err}");
            return Ok(false);
        }
    };
    let Some(root_map) = root.as_mapping_mut() else {
        return Ok(false);
    };
    let servers_key = Yaml::String("mcp_servers".to_string());
    let Some(servers) = root_map
        .get_mut(&servers_key)
        .and_then(Yaml::as_mapping_mut)
    else {
        return Ok(false);
    };
    let removed = servers.remove(Yaml::String(id.to_string())).is_some();
    if servers.is_empty() {
        root_map.remove(servers_key);
    }
    if removed {
        let yaml = serde_yaml::to_string(&root).map_err(|e| {
            mcp_configuration_invalid(format!("serialize hermes config.yaml failed: {e}"))
        })?;
        crate::commands::acp::write_hermes_secret_file(&path, &yaml, "config.yaml").map_err(
            |e| mcp_configuration_invalid(format!("write hermes config.yaml failed: {e}")),
        )?;
    }
    Ok(removed)
}

pub(crate) fn remove_server_for_app(app: McpAppType, id: &str) -> Result<bool, AppCommandError> {
    match app {
        McpAppType::ClaudeCode => adapters::claude::ClaudeAdapter.remove_server(id),
        McpAppType::Codex => adapters::codex::CodexAdapter.remove_server(id),
        McpAppType::OpenCode => adapters::opencode::OpenCodeAdapter.remove_server(id),
        McpAppType::Gemini => adapters::gemini::GeminiAdapter.remove_server(id),
        McpAppType::OpenClaw => adapters::openclaw::OpenClawAdapter.remove_server(id),
        McpAppType::Cline => adapters::cline::ClineAdapter.remove_server(id),
        McpAppType::Hermes => adapters::hermes::HermesAdapter.remove_server(id),
        McpAppType::CodeBuddy => adapters::codebuddy::CodeBuddyAdapter.remove_server(id),
        McpAppType::KimiCode => adapters::kimi_code::KimiCodeAdapter.remove_server(id),
        McpAppType::MimoCode => adapters::mimo_code::MimoCodeAdapter.remove_server(id),
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialServerResponse {
    pub(crate) server: OfficialServer,
    #[serde(default)]
    pub(crate) _meta: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialServer {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) title: Option<String>,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default, rename = "websiteUrl")]
    pub(crate) website_url: Option<String>,
    #[serde(default)]
    pub(crate) repository: Option<OfficialRepository>,
    #[serde(default)]
    pub(crate) version: Option<String>,
    #[serde(default)]
    pub(crate) icons: Option<Vec<OfficialIcon>>,
    #[serde(default)]
    pub(crate) remotes: Option<Vec<OfficialTransport>>,
    #[serde(default)]
    pub(crate) packages: Option<Vec<OfficialPackage>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialRepository {
    #[serde(default)]
    pub(crate) url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialTransport {
    #[serde(default)]
    pub(crate) r#type: String,
    #[serde(default)]
    pub(crate) url: Option<String>,
    #[serde(default, deserialize_with = "deserialize_official_key_value_inputs")]
    pub(crate) headers: Option<Vec<OfficialKeyValueInput>>,
    #[serde(default, deserialize_with = "deserialize_official_key_value_inputs")]
    pub(crate) variables: Option<Vec<OfficialKeyValueInput>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialIcon {
    #[serde(default)]
    pub(crate) src: Option<String>,
    #[serde(default, rename = "mimeType")]
    pub(crate) _mime_type: Option<String>,
    #[serde(default)]
    pub(crate) _sizes: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialPackage {
    #[serde(default, rename = "registryType")]
    pub(crate) registry_type: String,
    pub(crate) identifier: String,
    #[serde(default)]
    pub(crate) version: Option<String>,
    #[serde(default, rename = "runtimeHint")]
    pub(crate) runtime_hint: Option<String>,
    #[serde(default, rename = "runtimeArguments")]
    pub(crate) runtime_arguments: Vec<OfficialArgument>,
    #[serde(default, rename = "packageArguments")]
    pub(crate) package_arguments: Vec<OfficialArgument>,
    #[serde(default, rename = "environmentVariables")]
    pub(crate) environment_variables: Vec<OfficialKeyValueInput>,
    pub(crate) transport: OfficialTransport,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialArgument {
    #[serde(default)]
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) r#type: Option<String>,
    #[serde(default)]
    pub(crate) value: Option<String>,
    #[serde(default)]
    pub(crate) default: Option<String>,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) format: Option<String>,
    #[serde(default, rename = "isRequired")]
    pub(crate) is_required: Option<bool>,
    #[serde(default, rename = "isRepeated")]
    pub(crate) _is_repeated: Option<bool>,
    #[serde(default, rename = "valueHint")]
    pub(crate) value_hint: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OfficialKeyValueInput {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) value: Option<String>,
    #[serde(default)]
    pub(crate) default: Option<String>,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) format: Option<String>,
    #[serde(default, rename = "isRequired")]
    pub(crate) is_required: Option<bool>,
    #[serde(default, rename = "isSecret")]
    pub(crate) is_secret: Option<bool>,
    #[serde(default, rename = "valueHint")]
    pub(crate) value_hint: Option<String>,
}

pub(crate) fn deserialize_official_key_value_inputs<'de, D>(
    deserializer: D,
) -> Result<Option<Vec<OfficialKeyValueInput>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<Value>::deserialize(deserializer)?;
    let Some(value) = raw else {
        return Ok(None);
    };

    if value.is_null() {
        return Ok(None);
    }

    let mut out = Vec::new();

    if let Some(items) = value.as_array() {
        for item in items {
            let Ok(parsed) = serde_json::from_value::<OfficialKeyValueInput>(item.clone()) else {
                continue;
            };
            out.push(parsed);
        }
        if out.is_empty() {
            return Ok(None);
        }
        return Ok(Some(out));
    }

    if let Some(map) = value.as_object() {
        for (key, item) in map {
            let name = key.trim().to_string();
            if name.is_empty() {
                continue;
            }

            let mut parsed = OfficialKeyValueInput {
                name,
                value: None,
                default: None,
                description: None,
                format: None,
                is_required: None,
                is_secret: None,
                value_hint: None,
            };

            if let Some(text) = item.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    parsed.value = Some(trimmed.to_string());
                }
                out.push(parsed);
                continue;
            }

            if let Some(obj) = item.as_object() {
                parsed.value = obj
                    .get("value")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                parsed.default = obj
                    .get("default")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                parsed.description = obj
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                parsed.format = obj
                    .get("format")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                parsed.is_required = obj.get("isRequired").and_then(Value::as_bool);
                parsed.is_secret = obj.get("isSecret").and_then(Value::as_bool);
                parsed.value_hint = obj
                    .get("valueHint")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
            }

            out.push(parsed);
        }
    }

    if out.is_empty() {
        Ok(None)
    } else {
        Ok(Some(out))
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct SmitheryServerListResponse {
    #[serde(default)]
    pub(crate) servers: Vec<SmitheryServerSummary>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SmitheryServerSummary {
    #[serde(default)]
    pub(crate) _id: Option<String>,
    #[serde(rename = "qualifiedName")]
    pub(crate) qualified_name: String,
    #[serde(rename = "displayName")]
    pub(crate) display_name: String,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) homepage: Option<String>,
    #[serde(default, rename = "iconUrl")]
    pub(crate) icon_url: Option<String>,
    #[serde(default)]
    pub(crate) namespace: Option<String>,
    #[serde(default)]
    pub(crate) owner: Option<String>,
    #[serde(default)]
    pub(crate) remote: bool,
    #[serde(default)]
    pub(crate) verified: bool,
    #[serde(default, rename = "useCount")]
    pub(crate) use_count: Option<u64>,
    #[serde(default)]
    pub(crate) score: Option<f64>,
    #[serde(default, rename = "isDeployed")]
    pub(crate) is_deployed: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SmitheryServerDetail {
    #[serde(rename = "qualifiedName")]
    pub(crate) qualified_name: String,
    #[serde(rename = "displayName")]
    pub(crate) display_name: String,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) homepage: Option<String>,
    #[serde(default, rename = "iconUrl")]
    pub(crate) icon_url: Option<String>,
    #[serde(default)]
    pub(crate) namespace: Option<String>,
    #[serde(default)]
    pub(crate) owner: Option<String>,
    #[serde(default, rename = "deploymentUrl")]
    pub(crate) deployment_url: Option<String>,
    #[serde(default)]
    pub(crate) remote: bool,
    #[serde(default)]
    pub(crate) verified: bool,
    #[serde(default, rename = "useCount")]
    pub(crate) use_count: Option<u64>,
    #[serde(default)]
    pub(crate) score: Option<f64>,
    #[serde(default, rename = "isDeployed")]
    pub(crate) is_deployed: Option<bool>,
    #[serde(default)]
    pub(crate) connections: Vec<SmitheryConnection>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SmitheryConnection {
    #[serde(default)]
    pub(crate) r#type: String,
    #[serde(default, rename = "deploymentUrl")]
    pub(crate) deployment_url: Option<String>,
    #[serde(default, rename = "configSchema")]
    pub(crate) config_schema: Option<Value>,
}

pub(crate) fn first_non_empty_icon_src(icons: Option<&[OfficialIcon]>) -> Option<String> {
    icons.and_then(|items| {
        items
            .iter()
            .filter_map(|icon| icon.src.as_deref())
            .map(str::trim)
            .find(|value| !value.is_empty())
            .map(str::to_string)
    })
}

pub(crate) fn transport_protocol(kind: &str) -> Option<String> {
    match normalize_mcp_type(kind)? {
        canonical @ ("stdio" | "http" | "sse") => Some(canonical.to_string()),
        _ => None,
    }
}

pub(crate) fn official_server_protocols(server: &OfficialServer) -> Vec<String> {
    let mut seen = BTreeSet::new();
    if let Some(remotes) = server.remotes.as_ref() {
        for remote in remotes {
            if let Some(protocol) = transport_protocol(&remote.r#type) {
                seen.insert(protocol);
            }
        }
    }
    if let Some(packages) = server.packages.as_ref() {
        for package in packages {
            if let Some(protocol) = transport_protocol(&package.transport.r#type) {
                seen.insert(protocol);
            }
        }
    }
    seen.into_iter().collect()
}

pub(crate) fn official_entry_to_item(entry: &OfficialServerResponse) -> McpMarketplaceItem {
    let server = &entry.server;
    let name = server
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| server.name.clone());

    let description = server
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "No description".to_string());

    let homepage = server
        .website_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            server
                .repository
                .as_ref()
                .and_then(|repo| repo.url.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });

    let remote = server
        .remotes
        .as_ref()
        .map(|items| !items.is_empty())
        .unwrap_or(false);

    let verified = entry
        ._meta
        .as_ref()
        .and_then(|meta| {
            meta.get("io.modelcontextprotocol.registry/official")
                .and_then(Value::as_object)
                .and_then(|official| official.get("status"))
                .and_then(Value::as_str)
        })
        .map(|status| status == "active")
        .unwrap_or(false);

    McpMarketplaceItem {
        provider_id: MARKETPLACE_OFFICIAL.to_string(),
        server_id: server.name.clone(),
        name,
        description,
        homepage,
        remote,
        verified,
        icon_url: first_non_empty_icon_src(server.icons.as_deref()),
        latest_version: server
            .version
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        protocols: official_server_protocols(server),
        owner: None,
        namespace: None,
        downloads: None,
        score: None,
        is_deployed: None,
    }
}

pub(crate) async fn search_official_registry(
    query: &str,
    limit: u32,
) -> Result<Vec<McpMarketplaceItem>, AppCommandError> {
    let client = marketplace_http_client()?;
    let trimmed = query.trim();

    let response = send_request_with_retry("failed to query official MCP registry", || {
        client
            .get("https://registry.modelcontextprotocol.io/v0.1/servers")
            .query(&[
                ("limit", limit.to_string()),
                ("version", "latest".to_string()),
            ])
            .query(&[("search", trimmed.to_string())])
    })
    .await?;

    if !response.status().is_success() {
        return Err(mcp_network(format!(
            "official MCP registry request failed: HTTP {}",
            response.status()
        )));
    }

    let payload =
        parse_json_value_response(response, "failed to parse official MCP registry response")
            .await?;

    let entries = payload
        .get("servers")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            mcp_configuration_invalid(
                "failed to parse official MCP registry response: missing servers array",
            )
        })?;

    let mut out = Vec::new();
    for (index, raw_entry) in entries.iter().enumerate() {
        match serde_json::from_value::<OfficialServerResponse>(raw_entry.clone()) {
            Ok(item) => out.push(official_entry_to_item(&item)),
            Err(err) => {
                tracing::warn!(
                    "[MCP] skip invalid official registry server list entry at index={index}: {err}"
                );
            }
        }
    }

    Ok(out)
}

pub(crate) async fn fetch_official_server_detail(
    server_name: &str,
) -> Result<OfficialServerResponse, AppCommandError> {
    let encoded_name = urlencoding::encode(server_name);
    let url = format!(
        "https://registry.modelcontextprotocol.io/v0.1/servers/{encoded_name}/versions/latest"
    );

    let client = marketplace_http_client()?;
    let response = send_request_with_retry("failed to fetch official MCP server detail", || {
        client.get(url.clone())
    })
    .await?;

    if !response.status().is_success() {
        return Err(mcp_network(format!(
            "official MCP server detail request failed: HTTP {}",
            response.status()
        )));
    }

    parse_json_response::<OfficialServerResponse>(
        response,
        "failed to parse official MCP server detail",
    )
    .await
}

pub(crate) fn official_remote_option_id(index: usize, protocol: &str) -> String {
    format!("official:remote:{index}:{protocol}")
}

pub(crate) fn official_package_option_id(index: usize, protocol: &str) -> String {
    format!("official:package:{index}:{protocol}")
}

pub(crate) fn parse_official_option_id(option_id: &str) -> Option<(&str, usize)> {
    let mut parts = option_id.split(':');
    let provider = parts.next()?;
    let source = parts.next()?;
    let idx = parts.next()?.parse::<usize>().ok()?;
    if provider != "official" {
        return None;
    }
    Some((source, idx))
}

pub(crate) fn select_option_from_list<'a>(
    options: &'a [McpMarketplaceInstallOption],
    selection: &InstallSelection,
) -> Result<&'a McpMarketplaceInstallOption, AppCommandError> {
    if let Some(option_id) = selection.option_id.as_deref() {
        return options
            .iter()
            .find(|item| item.id == option_id)
            .ok_or_else(|| {
                mcp_not_found(format!("selected install option not found: {option_id}"))
            });
    }

    if let Some(protocol) = selection.protocol.as_deref() {
        let mut by_protocol = options
            .iter()
            .filter(|item| normalize_protocol_value(&item.protocol) == protocol);
        if let Some(first) = by_protocol.next() {
            let mut best = first;
            for next in by_protocol {
                if protocol_priority(&next.protocol) < protocol_priority(&best.protocol) {
                    best = next;
                }
            }
            return Ok(best);
        }
        return Err(mcp_not_found(format!(
            "no install option found for protocol '{protocol}'"
        )));
    }

    select_default_install_option(options)
        .ok_or_else(|| mcp_not_found("server does not provide installable options"))
}

pub(crate) fn key_looks_secret(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    lowered.contains("token")
        || lowered.contains("secret")
        || lowered.contains("password")
        || lowered.contains("api_key")
        || lowered.ends_with("key")
}

pub(crate) fn official_text_to_value(kind: &str, value: &str) -> Value {
    let trimmed = value.trim();
    match kind {
        "boolean" => Value::Bool(trimmed.eq_ignore_ascii_case("true")),
        "number" => trimmed
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or_else(|| Value::String(trimmed.to_string())),
        "integer" => trimmed
            .parse::<i64>()
            .ok()
            .map(|item| Value::Number(item.into()))
            .unwrap_or_else(|| Value::String(trimmed.to_string())),
        _ => Value::String(trimmed.to_string()),
    }
}

pub(crate) fn infer_parameter_kind(format: Option<&str>) -> String {
    match format.map(str::trim).unwrap_or("string") {
        "boolean" => "boolean".to_string(),
        "number" => "number".to_string(),
        "integer" => "integer".to_string(),
        "object" | "array" => "json".to_string(),
        _ => "string".to_string(),
    }
}

pub(crate) fn value_as_text(value: &Value) -> Option<String> {
    match value {
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(raw) => Some(raw.to_string()),
        Value::Bool(raw) => Some(raw.to_string()),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).ok(),
        Value::Null => None,
    }
}

pub(crate) fn read_parameter_value_as_text(values: &Map<String, Value>, key: &str) -> Option<String> {
    values.get(key).and_then(value_as_text)
}

pub(crate) fn official_kv_default(item: &OfficialKeyValueInput) -> Option<String> {
    item.value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            item.default
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .filter(|value| !contains_unresolved_placeholder(value))
        .map(str::to_string)
}

pub(crate) fn official_kv_is_required(item: &OfficialKeyValueInput) -> bool {
    if item.is_required.unwrap_or(false) {
        return true;
    }
    let has_placeholder = item
        .value
        .as_deref()
        .map(contains_unresolved_placeholder)
        .unwrap_or(false)
        || item
            .default
            .as_deref()
            .map(contains_unresolved_placeholder)
            .unwrap_or(false);
    has_placeholder || official_kv_default(item).is_none()
}

pub(crate) fn append_query_param(url: &str, key: &str, value: &str) -> String {
    let encoded_key = urlencoding::encode(key);
    let encoded_value = urlencoding::encode(value);
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}{encoded_key}={encoded_value}")
}

pub(crate) fn apply_transport_variables(
    base_url: &str,
    variables: Option<&[OfficialKeyValueInput]>,
    values: &Map<String, Value>,
    enforce_required: bool,
) -> Result<String, AppCommandError> {
    let Some(items) = variables else {
        return Ok(base_url.to_string());
    };

    let mut url = base_url.to_string();
    for item in items {
        let key_name = item.name.trim();
        if key_name.is_empty() {
            continue;
        }
        let field_key = format!("variables.{key_name}");
        let value =
            read_parameter_value_as_text(values, &field_key).or_else(|| official_kv_default(item));
        if let Some(text) = value {
            let encoded = urlencoding::encode(&text);
            let brace = format!("{{{key_name}}}");
            let moustache = format!("{{{{{key_name}}}}}");
            if url.contains(&brace) {
                url = url.replace(&brace, &encoded);
            } else if url.contains(&moustache) {
                url = url.replace(&moustache, &encoded);
            } else {
                url = append_query_param(&url, key_name, &text);
            }
            continue;
        }
        if enforce_required && official_kv_is_required(item) {
            return Err(mcp_invalid_input(format!(
                "missing required variable '{key_name}'"
            )));
        }
    }
    Ok(url)
}

pub(crate) fn remote_spec_from_transport_with_values(
    transport: &OfficialTransport,
    values: &Map<String, Value>,
    enforce_required: bool,
) -> Result<Value, AppCommandError> {
    let kind = transport.r#type.trim();
    let canonical_type = match normalize_mcp_type(kind) {
        Some(value @ ("http" | "sse")) => value,
        _ => {
            return Err(
                mcp_invalid_input(format!("unsupported transport type '{kind}'")).with_i18n(
                    "errors.unsupportedTransportType",
                    mcp_i18n_params([("type", kind)]),
                ),
            )
        }
    };

    let base_url = transport
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| mcp_invalid_input("remote transport missing URL"))?;

    let url = apply_transport_variables(
        base_url,
        transport.variables.as_deref(),
        values,
        enforce_required,
    )?;

    let mut spec = Map::new();
    spec.insert(
        "type".to_string(),
        Value::String(canonical_type.to_string()),
    );
    spec.insert("url".to_string(), Value::String(url));

    let mut headers = Map::new();
    if let Some(items) = transport.headers.as_deref() {
        for item in items {
            let key_name = item.name.trim();
            if key_name.is_empty() {
                continue;
            }
            let field_key = format!("headers.{key_name}");
            let value = read_parameter_value_as_text(values, &field_key)
                .or_else(|| official_kv_default(item));
            if let Some(text) = value {
                headers.insert(key_name.to_string(), Value::String(text));
                continue;
            }
            if enforce_required && official_kv_is_required(item) {
                return Err(mcp_invalid_input(format!(
                    "missing required header '{key_name}'"
                )));
            }
        }
    }
    if !headers.is_empty() {
        spec.insert("headers".to_string(), Value::Object(headers));
    }

    canonicalize_spec(&Value::Object(spec), "official transport")
}

pub(crate) fn official_remote_parameter_fields(
    transport: &OfficialTransport,
) -> Vec<McpMarketplaceInstallParameter> {
    let mut fields = Vec::new();
    if let Some(headers) = transport.headers.as_deref() {
        for item in headers {
            let key = item.name.trim();
            if key.is_empty() {
                continue;
            }
            let kind = infer_parameter_kind(item.format.as_deref());
            fields.push(McpMarketplaceInstallParameter {
                key: format!("headers.{key}"),
                label: key.to_string(),
                description: item
                    .description
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                required: official_kv_is_required(item),
                secret: item.is_secret.unwrap_or(false) || key_looks_secret(key),
                kind: kind.clone(),
                default_value: official_kv_default(item)
                    .as_deref()
                    .map(|value| official_text_to_value(&kind, value)),
                placeholder: item
                    .value_hint
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                enum_values: Vec::new(),
                location: Some("header".to_string()),
            });
        }
    }

    if let Some(variables) = transport.variables.as_deref() {
        for item in variables {
            let key = item.name.trim();
            if key.is_empty() {
                continue;
            }
            let kind = infer_parameter_kind(item.format.as_deref());
            fields.push(McpMarketplaceInstallParameter {
                key: format!("variables.{key}"),
                label: key.to_string(),
                description: item
                    .description
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                required: official_kv_is_required(item),
                secret: item.is_secret.unwrap_or(false) || key_looks_secret(key),
                kind: kind.clone(),
                default_value: official_kv_default(item)
                    .as_deref()
                    .map(|value| official_text_to_value(&kind, value)),
                placeholder: item
                    .value_hint
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                enum_values: Vec::new(),
                location: Some("query".to_string()),
            });
        }
    }

    fields
}

pub(crate) fn build_official_install_options(
    server: &OfficialServer,
) -> Result<Vec<McpMarketplaceInstallOption>, AppCommandError> {
    let mut options = Vec::new();

    if let Some(packages) = server.packages.as_ref() {
        for (index, package) in packages.iter().enumerate() {
            let Some(protocol) = transport_protocol(&package.transport.r#type) else {
                continue;
            };

            if protocol == "stdio" {
                match resolve_official_stdio_package(package) {
                    Ok(spec) => {
                        let runtime = package
                            .runtime_hint
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .unwrap_or("runtime");
                        options.push(McpMarketplaceInstallOption {
                            id: official_package_option_id(index, &protocol),
                            protocol: protocol.clone(),
                            label: format!("stdio ({runtime})"),
                            description: Some(format!("Run package {}", package.identifier)),
                            spec,
                            parameters: official_stdio_parameter_fields(package),
                        });
                    }
                    Err(err) => {
                        tracing::warn!("[MCP] skip invalid official stdio package: {err}");
                    }
                }
            } else if let Ok(spec) =
                remote_spec_from_transport_with_values(&package.transport, &Map::new(), false)
            {
                options.push(McpMarketplaceInstallOption {
                    id: official_package_option_id(index, &protocol),
                    protocol: protocol.clone(),
                    label: format!("{protocol} (package)"),
                    description: Some(format!("Remote package {}", package.identifier)),
                    spec,
                    parameters: official_remote_parameter_fields(&package.transport),
                });
            }
        }
    }

    if let Some(remotes) = server.remotes.as_ref() {
        for (index, transport) in remotes.iter().enumerate() {
            let Some(protocol) = transport_protocol(&transport.r#type) else {
                continue;
            };
            if let Ok(spec) = remote_spec_from_transport_with_values(transport, &Map::new(), false)
            {
                options.push(McpMarketplaceInstallOption {
                    id: official_remote_option_id(index, &protocol),
                    protocol: protocol.clone(),
                    label: format!("{protocol} (remote)"),
                    description: transport
                        .url
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string),
                    spec,
                    parameters: official_remote_parameter_fields(transport),
                });
            }
        }
    }

    if options.is_empty() {
        return Err(mcp_not_found(format!(
            "official MCP server '{}' does not expose an installable transport",
            server.name
        )));
    }

    Ok(options)
}

pub(crate) fn resolve_official_install_spec_with_selection(
    server: &OfficialServer,
    selection: &InstallSelection,
) -> Result<Value, AppCommandError> {
    let options = build_official_install_options(server)?;
    let selected = select_option_from_list(&options, selection)?;
    let values = &selection.parameter_values;

    if let Some((source, index)) = parse_official_option_id(&selected.id) {
        if source == "package" {
            let package = server
                .packages
                .as_ref()
                .and_then(|items| items.get(index))
                .ok_or_else(|| {
                    mcp_not_found(format!(
                        "selected package option index is out of range: {index}"
                    ))
                })?;
            if normalize_protocol_value(&selected.protocol) == "stdio" {
                return resolve_official_stdio_package_with_values(package, values, true);
            }
            return remote_spec_from_transport_with_values(&package.transport, values, true);
        }
        if source == "remote" {
            let remote = server
                .remotes
                .as_ref()
                .and_then(|items| items.get(index))
                .ok_or_else(|| {
                    mcp_not_found(format!(
                        "selected remote option index is out of range: {index}"
                    ))
                })?;
            return remote_spec_from_transport_with_values(remote, values, true);
        }
    }

    Err(mcp_invalid_input(format!(
        "unsupported official install option '{}'",
        selected.id
    )))
}

pub(crate) fn package_identifier_with_version(package: &OfficialPackage, runtime: &str) -> String {
    let identifier = package.identifier.trim();
    if identifier.is_empty() {
        return String::new();
    }

    let version = package
        .version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "latest");

    let Some(version) = version else {
        return identifier.to_string();
    };

    if runtime == "uvx" {
        if package.registry_type.trim() == "pypi" {
            return format!("{identifier}=={version}");
        }
        return identifier.to_string();
    }

    if runtime == "npx" {
        if identifier.contains('@') || identifier.starts_with("http") {
            return identifier.to_string();
        }
        return format!("{identifier}@{version}");
    }

    identifier.to_string()
}

pub(crate) fn argument_value(arg: &OfficialArgument) -> Option<String> {
    arg.value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            arg.default
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .filter(|value| !contains_unresolved_placeholder(value))
        .map(str::to_string)
}

pub(crate) fn argument_is_required(arg: &OfficialArgument) -> bool {
    arg.is_required.unwrap_or(false)
}

pub(crate) fn argument_kind(arg: &OfficialArgument) -> String {
    infer_parameter_kind(arg.format.as_deref())
}

pub(crate) fn argument_parameter_key(scope: &str, index: usize) -> String {
    format!("{scope}.{index}")
}

pub(crate) fn resolve_argument_value(
    arg: &OfficialArgument,
    scope: &str,
    index: usize,
    values: &Map<String, Value>,
) -> Option<String> {
    let key = argument_parameter_key(scope, index);
    read_parameter_value_as_text(values, &key).or_else(|| argument_value(arg))
}

pub(crate) fn append_argument_value(
    target: &mut Vec<String>,
    arg: &OfficialArgument,
    scope: &str,
    index: usize,
    values: &Map<String, Value>,
    enforce_required: bool,
) -> Result<(), AppCommandError> {
    let kind = arg.r#type.as_deref().map(str::trim).unwrap_or("positional");
    let resolved = resolve_argument_value(arg, scope, index, values);

    if kind == "named" {
        let Some(name) = arg
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return Ok(());
        };
        if let Some(value) = resolved {
            target.push(name.to_string());
            target.push(value);
            return Ok(());
        }
        if enforce_required && argument_is_required(arg) {
            return Err(mcp_invalid_input(format!(
                "missing required argument '{name}'"
            )));
        }
        return Ok(());
    }

    if let Some(value) = resolved {
        target.push(value);
        return Ok(());
    }
    if enforce_required && argument_is_required(arg) {
        let name = arg
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("positional");
        return Err(mcp_invalid_input(format!(
            "missing required argument '{name}'"
        )));
    }
    Ok(())
}

pub(crate) fn official_stdio_parameter_fields(
    package: &OfficialPackage,
) -> Vec<McpMarketplaceInstallParameter> {
    let mut fields = Vec::new();

    for (index, arg) in package.runtime_arguments.iter().enumerate() {
        let kind = argument_kind(arg);
        let label = arg
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("runtime arg {}", index + 1));
        fields.push(McpMarketplaceInstallParameter {
            key: argument_parameter_key("runtime_arguments", index),
            label,
            description: arg
                .description
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            required: argument_is_required(arg),
            secret: false,
            kind: kind.clone(),
            default_value: argument_value(arg)
                .as_deref()
                .map(|value| official_text_to_value(&kind, value)),
            placeholder: arg
                .value_hint
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            enum_values: Vec::new(),
            location: Some("arg".to_string()),
        });
    }

    for (index, arg) in package.package_arguments.iter().enumerate() {
        let kind = argument_kind(arg);
        let label = arg
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("package arg {}", index + 1));
        fields.push(McpMarketplaceInstallParameter {
            key: argument_parameter_key("package_arguments", index),
            label,
            description: arg
                .description
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            required: argument_is_required(arg),
            secret: false,
            kind: kind.clone(),
            default_value: argument_value(arg)
                .as_deref()
                .map(|value| official_text_to_value(&kind, value)),
            placeholder: arg
                .value_hint
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            enum_values: Vec::new(),
            location: Some("arg".to_string()),
        });
    }

    for item in &package.environment_variables {
        let key = item.name.trim();
        if key.is_empty() {
            continue;
        }
        let kind = infer_parameter_kind(item.format.as_deref());
        fields.push(McpMarketplaceInstallParameter {
            key: format!("env.{key}"),
            label: key.to_string(),
            description: item
                .description
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            required: official_kv_is_required(item),
            secret: item.is_secret.unwrap_or(false) || key_looks_secret(key),
            kind: kind.clone(),
            default_value: official_kv_default(item)
                .as_deref()
                .map(|value| official_text_to_value(&kind, value)),
            placeholder: item
                .value_hint
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            enum_values: Vec::new(),
            location: Some("env".to_string()),
        });
    }

    fields
}

pub(crate) fn resolve_official_stdio_package(package: &OfficialPackage) -> Result<Value, AppCommandError> {
    resolve_official_stdio_package_with_values(package, &Map::new(), false)
}

pub(crate) fn resolve_official_stdio_package_with_values(
    package: &OfficialPackage,
    values: &Map<String, Value>,
    enforce_required: bool,
) -> Result<Value, AppCommandError> {
    let runtime = package
        .runtime_hint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| match package.registry_type.trim() {
            "npm" => Some("npx".to_string()),
            "pypi" => Some("uvx".to_string()),
            _ => None,
        })
        .ok_or_else(|| {
            mcp_configuration_invalid(format!(
                "official package '{}' missing runtime hint",
                package.identifier
            ))
        })?;

    let mut args = Vec::new();
    if runtime == "npx" {
        args.push("-y".to_string());
    }

    for (index, arg) in package.runtime_arguments.iter().enumerate() {
        append_argument_value(
            &mut args,
            arg,
            "runtime_arguments",
            index,
            values,
            enforce_required,
        )?;
    }

    let package_identifier = package_identifier_with_version(package, &runtime);
    if package_identifier.is_empty() {
        return Err(mcp_configuration_invalid(
            "official package identifier is empty",
        ));
    }
    args.push(package_identifier);

    for (index, arg) in package.package_arguments.iter().enumerate() {
        append_argument_value(
            &mut args,
            arg,
            "package_arguments",
            index,
            values,
            enforce_required,
        )?;
    }

    let mut env = Map::new();
    for item in &package.environment_variables {
        let key = item.name.trim();
        if key.is_empty() {
            continue;
        }
        let field_key = format!("env.{key}");
        let value =
            read_parameter_value_as_text(values, &field_key).or_else(|| official_kv_default(item));
        if let Some(value) = value {
            env.insert(key.to_string(), Value::String(value.to_string()));
            continue;
        }
        if enforce_required && official_kv_is_required(item) {
            return Err(mcp_invalid_input(format!(
                "missing required environment variable '{key}'"
            )));
        }
    }

    let mut spec = Map::new();
    spec.insert("type".to_string(), Value::String("stdio".to_string()));
    spec.insert("command".to_string(), Value::String(runtime));
    if !args.is_empty() {
        spec.insert(
            "args".to_string(),
            Value::Array(args.into_iter().map(Value::String).collect()),
        );
    }
    if !env.is_empty() {
        spec.insert("env".to_string(), Value::Object(env));
    }

    Ok(Value::Object(spec))
}

pub(crate) async fn search_smithery(
    query: &str,
    limit: u32,
) -> Result<Vec<McpMarketplaceItem>, AppCommandError> {
    let client = marketplace_http_client()?;
    let trimmed = query.trim();

    let response = send_request_with_retry("failed to query smithery marketplace", || {
        client
            .get("https://api.smithery.ai/servers")
            .query(&[("limit", limit.to_string()), ("q", trimmed.to_string())])
    })
    .await?;

    if !response.status().is_success() {
        return Err(mcp_network(format!(
            "smithery marketplace request failed: HTTP {}",
            response.status()
        )));
    }

    let payload = parse_json_response::<SmitheryServerListResponse>(
        response,
        "failed to parse smithery response",
    )
    .await?;

    Ok(payload
        .servers
        .into_iter()
        .map(|item| McpMarketplaceItem {
            provider_id: MARKETPLACE_SMITHERY.to_string(),
            server_id: item.qualified_name,
            name: item.display_name,
            description: item
                .description
                .unwrap_or_else(|| "No description".to_string()),
            homepage: item.homepage,
            remote: item.remote,
            verified: item.verified,
            icon_url: item
                .icon_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            latest_version: None,
            protocols: if item.remote {
                vec!["http".to_string()]
            } else {
                Vec::new()
            },
            owner: item
                .owner
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            namespace: item
                .namespace
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            downloads: item.use_count,
            score: item.score,
            is_deployed: item.is_deployed,
        })
        .collect())
}

pub(crate) async fn fetch_smithery_server_summary(
    server_id: &str,
) -> Result<SmitheryServerSummary, AppCommandError> {
    let client = marketplace_http_client()?;
    let response = send_request_with_retry("failed to fetch smithery server summary", || {
        client
            .get("https://api.smithery.ai/servers")
            .query(&[("limit", "30"), ("q", server_id)])
    })
    .await?;

    if !response.status().is_success() {
        return Err(mcp_network(format!(
            "smithery server summary request failed: HTTP {}",
            response.status()
        )));
    }

    let payload = parse_json_response::<SmitheryServerListResponse>(
        response,
        "failed to parse smithery server summary",
    )
    .await?;

    payload
        .servers
        .into_iter()
        .find(|item| item.qualified_name == server_id)
        .ok_or_else(|| mcp_not_found(format!("smithery server summary not found: {server_id}")))
}

pub(crate) async fn fetch_smithery_server_detail(
    server_id: &str,
) -> Result<SmitheryServerDetail, AppCommandError> {
    let url = format!("https://api.smithery.ai/servers/{server_id}");
    let client = marketplace_http_client()?;
    let response = send_request_with_retry("failed to fetch smithery server detail", || {
        client.get(url.clone())
    })
    .await?;

    if !response.status().is_success() {
        return Err(mcp_network(format!(
            "smithery server detail request failed: HTTP {}",
            response.status()
        )));
    }

    parse_json_response::<SmitheryServerDetail>(response, "failed to parse smithery server detail")
        .await
}

#[derive(Debug, Clone)]
pub(crate) struct SmitheryConfigField {
    pub(crate) key: String,
    pub(crate) description: Option<String>,
    pub(crate) required: bool,
    pub(crate) secret: bool,
    pub(crate) kind: String,
    pub(crate) default_value: Option<Value>,
    pub(crate) enum_values: Vec<String>,
    pub(crate) location: String,
}

pub(crate) fn smithery_option_id(index: usize, protocol: &str) -> String {
    format!("smithery:connection:{index}:{protocol}")
}

pub(crate) fn parse_smithery_option_id(option_id: &str) -> Option<usize> {
    let mut parts = option_id.split(':');
    let provider = parts.next()?;
    let source = parts.next()?;
    let idx = parts.next()?.parse::<usize>().ok()?;
    if provider != "smithery" || source != "connection" {
        return None;
    }
    Some(idx)
}

pub(crate) fn smithery_connection_protocol(connection: &SmitheryConnection) -> String {
    match normalize_mcp_type(&connection.r#type) {
        Some("sse") => "sse".to_string(),
        Some("http") => "http".to_string(),
        _ => "http".to_string(),
    }
}

pub(crate) fn smithery_connection_url(
    connection: &SmitheryConnection,
    fallback: Option<&str>,
) -> Option<String> {
    connection
        .deployment_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            fallback
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

pub(crate) fn smithery_property_kind(prop: &Map<String, Value>) -> String {
    if let Some(raw) = prop.get("type") {
        if let Some(typ) = raw.as_str() {
            return match typ.trim() {
                "boolean" => "boolean".to_string(),
                "number" => "number".to_string(),
                "integer" => "integer".to_string(),
                "object" | "array" => "json".to_string(),
                _ => "string".to_string(),
            };
        }
        if let Some(types) = raw.as_array() {
            for item in types {
                let Some(typ) = item.as_str() else {
                    continue;
                };
                if typ == "null" {
                    continue;
                }
                return match typ {
                    "boolean" => "boolean".to_string(),
                    "number" => "number".to_string(),
                    "integer" => "integer".to_string(),
                    "object" | "array" => "json".to_string(),
                    _ => "string".to_string(),
                };
            }
        }
    }
    "string".to_string()
}

pub(crate) fn smithery_field_location(key: &str, prop: &Map<String, Value>, secret: bool) -> String {
    let explicit = prop
        .get("x-from")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if explicit.eq_ignore_ascii_case("header") {
        return "header".to_string();
    }
    if explicit.eq_ignore_ascii_case("query") {
        return "query".to_string();
    }
    if secret || key_looks_secret(key) {
        return "header".to_string();
    }
    "query".to_string()
}

pub(crate) fn parse_smithery_config_fields(schema: Option<&Value>) -> Vec<SmitheryConfigField> {
    let Some(root) = schema.and_then(Value::as_object) else {
        return Vec::new();
    };
    let required = root
        .get("required")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let Some(properties) = root.get("properties").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut fields = Vec::new();
    for (key, raw_prop) in properties {
        let Some(prop) = raw_prop.as_object() else {
            continue;
        };
        let kind = smithery_property_kind(prop);
        let secret = prop
            .get("writeOnly")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || key_looks_secret(key);
        let location = smithery_field_location(key, prop, secret);
        let enum_values = prop
            .get("enum")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        fields.push(SmitheryConfigField {
            key: key.to_string(),
            description: prop
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            required: required.contains(key),
            secret,
            kind,
            default_value: prop.get("default").cloned(),
            enum_values,
            location,
        });
    }

    fields
}

pub(crate) fn smithery_parameter_fields(
    connection: &SmitheryConnection,
) -> Vec<McpMarketplaceInstallParameter> {
    parse_smithery_config_fields(connection.config_schema.as_ref())
        .into_iter()
        .map(|field| McpMarketplaceInstallParameter {
            key: field.key.clone(),
            label: field.key,
            description: field.description,
            required: field.required,
            secret: field.secret,
            kind: field.kind,
            default_value: field.default_value,
            placeholder: None,
            enum_values: field.enum_values,
            location: Some(field.location),
        })
        .collect()
}

pub(crate) fn smithery_header_value_to_text(value: &Value) -> Option<String> {
    value_as_text(value)
}

pub(crate) fn smithery_query_value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).ok(),
        _ => value_as_text(value),
    }
}

pub(crate) fn resolve_smithery_connection_spec_with_values(
    connection: &SmitheryConnection,
    fallback_url: Option<&str>,
    values: &Map<String, Value>,
    enforce_required: bool,
) -> Result<Value, AppCommandError> {
    let protocol = smithery_connection_protocol(connection);
    let url = smithery_connection_url(connection, fallback_url)
        .ok_or_else(|| mcp_configuration_invalid("smithery connection missing deployment URL"))?;

    let config_fields = parse_smithery_config_fields(connection.config_schema.as_ref());
    let mut next_url = url;
    let mut headers = Map::new();

    for field in config_fields {
        let mut value = values.get(&field.key).cloned();
        if value.is_none() {
            value = field.default_value.clone();
        }

        let Some(value) = value else {
            if enforce_required && field.required {
                return Err(mcp_invalid_input(format!(
                    "missing required configuration '{}'",
                    field.key
                )));
            }
            continue;
        };

        if field.location == "header" {
            if let Some(text) = smithery_header_value_to_text(&value) {
                headers.insert(field.key, Value::String(text));
            } else if enforce_required && field.required {
                return Err(mcp_invalid_input(format!(
                    "invalid configuration value '{}'",
                    field.key
                )));
            }
            continue;
        }

        if let Some(text) = smithery_query_value_to_text(&value) {
            next_url = append_query_param(&next_url, &field.key, &text);
        } else if enforce_required && field.required {
            return Err(mcp_invalid_input(format!(
                "invalid configuration value '{}'",
                field.key
            )));
        }
    }

    let mut spec = Map::new();
    spec.insert("type".to_string(), Value::String(protocol));
    spec.insert("url".to_string(), Value::String(next_url));
    if !headers.is_empty() {
        spec.insert("headers".to_string(), Value::Object(headers));
    }

    canonicalize_spec(&Value::Object(spec), "smithery install")
}

pub(crate) fn build_smithery_install_options(
    server: &SmitheryServerDetail,
) -> Result<Vec<McpMarketplaceInstallOption>, AppCommandError> {
    let mut options = Vec::new();
    for (index, connection) in server.connections.iter().enumerate() {
        let protocol = smithery_connection_protocol(connection);
        if let Ok(spec) = resolve_smithery_connection_spec_with_values(
            connection,
            server.deployment_url.as_deref(),
            &Map::new(),
            false,
        ) {
            options.push(McpMarketplaceInstallOption {
                id: smithery_option_id(index, &protocol),
                protocol: protocol.clone(),
                label: format!("{protocol} (connection {})", index + 1),
                description: connection
                    .deployment_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                spec,
                parameters: smithery_parameter_fields(connection),
            });
        }
    }

    if options.is_empty() {
        if let Some(fallback) = server
            .deployment_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let spec = canonicalize_spec(
                &json!({
                    "type": "http",
                    "url": fallback,
                }),
                "smithery fallback",
            )?;
            options.push(McpMarketplaceInstallOption {
                id: "smithery:fallback:http".to_string(),
                protocol: "http".to_string(),
                label: "http".to_string(),
                description: Some(fallback.to_string()),
                spec,
                parameters: Vec::new(),
            });
        }
    }

    if options.is_empty() {
        return Err(mcp_not_found(format!(
            "smithery server '{}' does not provide installable connection info",
            server.qualified_name
        )));
    }

    Ok(options)
}

pub(crate) fn resolve_smithery_install_spec_with_selection(
    server: &SmitheryServerDetail,
    selection: &InstallSelection,
) -> Result<Value, AppCommandError> {
    let options = build_smithery_install_options(server)?;
    let selected = select_option_from_list(&options, selection)?;

    if let Some(index) = parse_smithery_option_id(&selected.id) {
        let connection = server.connections.get(index).ok_or_else(|| {
            mcp_not_found(format!(
                "selected smithery connection is out of range: {index}"
            ))
        })?;
        return resolve_smithery_connection_spec_with_values(
            connection,
            server.deployment_url.as_deref(),
            &selection.parameter_values,
            true,
        );
    }

    canonicalize_spec(&selected.spec, "smithery selected option")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    pub(crate) fn normalize_mcp_type_canonical_pass_through() {
        assert_eq!(normalize_mcp_type("stdio"), Some("stdio"));
        assert_eq!(normalize_mcp_type("http"), Some("http"));
        assert_eq!(normalize_mcp_type("sse"), Some("sse"));
        assert_eq!(normalize_mcp_type("local"), Some("local"));
        assert_eq!(normalize_mcp_type("remote"), Some("remote"));
    }

    #[test]
    pub(crate) fn normalize_mcp_type_streamable_http_aliases_collapse_to_http() {
        for raw in [
            "streamable-http",
            "streamableHttp",
            "streamable_http",
            "Streamable HTTP",
            "STREAMABLE-HTTP",
            "  streamable-http  ",
            "streamable.http",
        ] {
            assert_eq!(normalize_mcp_type(raw), Some("http"), "input {raw:?}");
        }
    }

    #[test]
    pub(crate) fn normalize_mcp_type_rejects_unknown() {
        assert!(normalize_mcp_type("").is_none());
        assert!(normalize_mcp_type("   ").is_none());
        assert!(normalize_mcp_type("Foo").is_none());
        assert!(normalize_mcp_type("ws").is_none());
    }

    #[test]
    pub(crate) fn kimi_code_mcp_json_round_trips() {
        // Kimi reads `<KIMI_CODE_HOME>/mcp.json` (`mcpServers`) natively; verify
        // the read/upsert/remove cycle against an isolated path.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("mcp.json");

        // Missing file → no servers, and removing is a no-op.
        assert!(read_kimi_code_servers_at(&path)
            .expect("read missing")
            .is_empty());
        assert!(!remove_kimi_code_server_at(&path, "ctx7").expect("remove missing"));

        // Upsert a stdio server.
        let spec = json!({
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "ctx7-mcp"],
        });
        upsert_kimi_code_server_at(&path, "ctx7", &spec).expect("upsert");

        // It round-trips, canonicalized, under `mcpServers`.
        let servers = read_kimi_code_servers_at(&path).expect("read back");
        assert_eq!(servers.len(), 1);
        let stored = servers.get("ctx7").expect("ctx7 present");
        assert_eq!(stored.get("type").and_then(Value::as_str), Some("stdio"));
        assert_eq!(stored.get("command").and_then(Value::as_str), Some("npx"));

        // On-disk shape is `{ "mcpServers": { "ctx7": { .. } } }`.
        let raw = std::fs::read_to_string(&path).expect("read file");
        let root: Value = serde_json::from_str(&raw).expect("parse json");
        assert!(root
            .get("mcpServers")
            .and_then(Value::as_object)
            .map(|m| m.contains_key("ctx7"))
            .unwrap_or(false));

        // Remove it; the file no longer lists it and a second remove is a no-op.
        assert!(remove_kimi_code_server_at(&path, "ctx7").expect("remove"));
        assert!(read_kimi_code_servers_at(&path)
            .expect("read after remove")
            .is_empty());
        assert!(!remove_kimi_code_server_at(&path, "ctx7").expect("remove again"));
    }

    pub(crate) fn codex_entry(toml_src: &str) -> toml::Value {
        toml::from_str::<toml::Value>(toml_src).expect("parse test toml")
    }

    #[test]
    pub(crate) fn codex_entry_canonicalizes_streamable_http_aliases() {
        for raw in ["streamableHttp", "streamable-http", "streamable_http"] {
            let value = codex_entry(&format!(
                "type = \"{raw}\"\nurl = \"https://mcp.example.com/mcp\"\n"
            ));
            let canonical = codex_entry_to_canonical("ex", &value)
                .unwrap_or_else(|err| panic!("input {raw:?} should normalize: {err}"));
            assert_eq!(
                canonical
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                "http",
                "input {raw:?}"
            );
            assert_eq!(
                canonical
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                "https://mcp.example.com/mcp"
            );
        }
    }

    #[test]
    pub(crate) fn codex_entry_keeps_canonical_types_intact() {
        let stdio = codex_entry("type = \"stdio\"\ncommand = \"npx\"\n");
        let canonical = codex_entry_to_canonical("ex", &stdio).expect("stdio entry");
        assert_eq!(canonical.get("type").and_then(Value::as_str), Some("stdio"));
        assert_eq!(
            canonical.get("command").and_then(Value::as_str),
            Some("npx")
        );

        let sse = codex_entry("type = \"sse\"\nurl = \"https://mcp.example.com/sse\"\n");
        let canonical = codex_entry_to_canonical("ex", &sse).expect("sse entry");
        assert_eq!(canonical.get("type").and_then(Value::as_str), Some("sse"));
    }

    #[test]
    pub(crate) fn codex_entry_rejects_unknown_type_with_raw_in_message() {
        let value = codex_entry("type = \"Foo\"\nurl = \"https://x\"\n");
        let err = codex_entry_to_canonical("ex", &value).expect_err("Foo should be rejected");
        let msg = err.to_string();
        assert!(msg.contains("'Foo'"), "error should echo raw type: {msg}");
        assert!(msg.contains("'ex'"), "error should mention id: {msg}");
        assert_eq!(
            err.i18n_key.as_deref(),
            Some("errors.codexEntryUnsupportedType")
        );
        let params = err.i18n_params.as_ref().expect("i18n params attached");
        assert_eq!(params.get("id").map(String::as_str), Some("ex"));
        assert_eq!(params.get("type").map(String::as_str), Some("Foo"));
    }

    #[test]
    pub(crate) fn codex_entry_rejects_opencode_only_aliases() {
        // OpenCode-native types are not valid in Codex TOML; catching them keeps
        // the Codex pipeline's accepted set tight.
        for raw in ["local", "remote"] {
            let value = codex_entry(&format!("type = \"{raw}\"\nurl = \"https://x\"\n"));
            assert!(
                codex_entry_to_canonical("ex", &value).is_err(),
                "raw {raw:?} should not be accepted by Codex pipeline",
            );
        }
    }

    #[test]
    pub(crate) fn transport_protocol_normalizes_aliases() {
        assert_eq!(transport_protocol("stdio"), Some("stdio".to_string()));
        assert_eq!(transport_protocol("http"), Some("http".to_string()));
        assert_eq!(transport_protocol("sse"), Some("sse".to_string()));
        assert_eq!(
            transport_protocol("streamable-http"),
            Some("http".to_string())
        );
        assert_eq!(
            transport_protocol("streamableHttp"),
            Some("http".to_string())
        );
        assert_eq!(transport_protocol("local"), None);
        assert_eq!(transport_protocol("foo"), None);
    }

    pub(crate) fn make_transport(kind: &str, url: &str) -> OfficialTransport {
        let payload = serde_json::json!({
            "type": kind,
            "url": url,
        });
        serde_json::from_value(payload).expect("OfficialTransport from json")
    }

    #[test]
    pub(crate) fn remote_spec_from_transport_normalizes_aliases() {
        for raw in ["streamable-http", "streamableHttp", "http"] {
            let transport = make_transport(raw, "https://mcp.example.com/mcp");
            let spec =
                remote_spec_from_transport_with_values(&transport, &Map::new(), false).unwrap();
            assert_eq!(
                spec.get("type").and_then(Value::as_str),
                Some("http"),
                "raw {raw:?}"
            );
        }

        let sse = make_transport("sse", "https://mcp.example.com/sse");
        let spec = remote_spec_from_transport_with_values(&sse, &Map::new(), false).unwrap();
        assert_eq!(spec.get("type").and_then(Value::as_str), Some("sse"));

        let unknown = make_transport("ws", "https://x");
        let err = remote_spec_from_transport_with_values(&unknown, &Map::new(), false)
            .expect_err("ws should be rejected");
        assert_eq!(
            err.i18n_key.as_deref(),
            Some("errors.unsupportedTransportType")
        );
        let params = err.i18n_params.as_ref().expect("i18n params attached");
        assert_eq!(params.get("type").map(String::as_str), Some("ws"));
    }

    pub(crate) fn make_smithery_connection(kind: &str) -> SmitheryConnection {
        let payload = serde_json::json!({ "type": kind });
        serde_json::from_value(payload).expect("SmitheryConnection from json")
    }

    #[test]
    pub(crate) fn smithery_connection_protocol_normalizes_aliases() {
        assert_eq!(
            smithery_connection_protocol(&make_smithery_connection("streamable-http")),
            "http"
        );
        assert_eq!(
            smithery_connection_protocol(&make_smithery_connection("streamableHttp")),
            "http"
        );
        assert_eq!(
            smithery_connection_protocol(&make_smithery_connection("sse")),
            "sse"
        );
        // Unknown falls back to http (preserves prior permissive behavior).
        assert_eq!(
            smithery_connection_protocol(&make_smithery_connection("ws")),
            "http"
        );
    }

    pub(crate) fn hermes_entry(yaml_src: &str) -> serde_yaml::Value {
        serde_yaml::from_str::<serde_yaml::Value>(yaml_src).expect("parse test yaml")
    }

    #[test]
    pub(crate) fn hermes_entry_to_canonical_stdio() {
        let entry = hermes_entry(
            "command: npx\nargs:\n  - -y\n  - \"@modelcontextprotocol/server-github\"\nenv:\n  GITHUB_TOKEN: ghp_x\n",
        );
        let spec = hermes_entry_to_canonical(&entry, "github").expect("canonical");
        assert_eq!(spec.get("type").and_then(Value::as_str), Some("stdio"));
        assert_eq!(spec.get("command").and_then(Value::as_str), Some("npx"));
        let args = spec.get("args").and_then(Value::as_array).expect("args");
        assert_eq!(args.len(), 2);
        assert_eq!(
            spec.get("env")
                .and_then(|e| e.get("GITHUB_TOKEN"))
                .and_then(Value::as_str),
            Some("ghp_x")
        );
    }

    #[test]
    pub(crate) fn hermes_entry_to_canonical_http_and_sse() {
        // A bare `url` is StreamableHTTP.
        let http = hermes_entry_to_canonical(
            &hermes_entry("url: https://mcp.example.com/mcp\n"),
            "remote-http",
        )
        .expect("http canonical");
        assert_eq!(http.get("type").and_then(Value::as_str), Some("http"));
        assert_eq!(
            http.get("url").and_then(Value::as_str),
            Some("https://mcp.example.com/mcp")
        );
        // `transport: sse` maps to the canonical `sse` type.
        let sse = hermes_entry_to_canonical(
            &hermes_entry("url: http://localhost:8000/sse\ntransport: sse\n"),
            "remote-sse",
        )
        .expect("sse canonical");
        assert_eq!(sse.get("type").and_then(Value::as_str), Some("sse"));
    }

    #[test]
    pub(crate) fn canonical_to_hermes_entry_drops_type_and_maps_transport() {
        // stdio → command/args/env, no `type`/`transport` keys.
        let stdio = canonical_to_hermes_entry(&json!({
            "type": "stdio",
            "command": "uvx",
            "args": ["some-server"],
            "env": {"KEY": "v"},
        }))
        .expect("stdio entry");
        let map = stdio.as_mapping().expect("mapping");
        assert!(map.contains_key(serde_yaml::Value::String("command".into())));
        assert!(!map.contains_key(serde_yaml::Value::String("type".into())));
        assert!(!map.contains_key(serde_yaml::Value::String("transport".into())));

        // sse → url + `transport: sse`, no `type`; mTLS keys pass through.
        let sse = canonical_to_hermes_entry(&json!({
            "type": "sse",
            "url": "https://x/sse",
            "headers": {"Authorization": "Bearer t"},
            "client_cert": "/tmp/cert.pem",
        }))
        .expect("sse entry");
        let map = sse.as_mapping().expect("mapping");
        assert_eq!(
            map.get(serde_yaml::Value::String("transport".into()))
                .and_then(serde_yaml::Value::as_str),
            Some("sse")
        );
        assert!(!map.contains_key(serde_yaml::Value::String("type".into())));
        assert_eq!(
            map.get(serde_yaml::Value::String("client_cert".into()))
                .and_then(serde_yaml::Value::as_str),
            Some("/tmp/cert.pem")
        );
    }

    #[test]
    pub(crate) fn hermes_mcp_canonical_round_trips() {
        // canonical → hermes entry → canonical is stable for both transports.
        for spec in [
            json!({"type": "stdio", "command": "npx", "args": ["-y", "srv"], "env": {"A": "b"}}),
            json!({"type": "sse", "url": "https://x/sse", "headers": {"H": "v"}}),
            json!({"type": "http", "url": "https://x/mcp"}),
        ] {
            let entry = canonical_to_hermes_entry(&spec).expect("to entry");
            let back = hermes_entry_to_canonical(&entry, "srv").expect("from entry");
            let canonical = canonicalize_spec(&spec, "expected").expect("canonical");
            assert_eq!(back, canonical, "round-trip mismatch for {spec}");
        }
    }
}
