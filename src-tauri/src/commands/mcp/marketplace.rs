//! MCP marketplace clients (official registry + smithery).
//!
//! Split out of `agent_servers` so per-agent on-disk MCP config stays separate
//! from remote marketplace HTTP/DTO logic. Symbols are re-exported via
//! `mod.rs` (`pub(crate) use agent_servers::*` no longer covers these —
//! `mod.rs` also does `pub(crate) use marketplace::*`).

use super::*;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::app_error::AppCommandError;

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

