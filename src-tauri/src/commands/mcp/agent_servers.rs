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
        // Command Code has no native MCP config file managed by VeryAgent.
        McpAppType::CommandCode => Ok(()),
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
        // Command Code has no native MCP config file managed by VeryAgent.
        AgentType::CommandCode => Ok(BTreeMap::new()),
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
        McpAppType::CommandCode => Ok(false),
    }
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
