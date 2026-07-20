use super::*;
use std::path::{Path, PathBuf};

use crate::acp::error::AcpError;


// ---------------------------------------------------------------------------
// Hermes config helpers
//
// Hermes self-manages credentials in `~/.hermes/.env` (secrets) and general
// settings in `~/.hermes/config.yaml` (the `model:` section), reading them with
// its own runtime resolver. veryagent manages those two files directly — mirroring
// how it manages Codex's `auth.json` + `config.toml` — rather than injecting
// process env. The provider choice drives the linkage: it selects which `.env`
// var holds the API key and which `model.provider` / `model.base_url` go into
// config.yaml.
// ---------------------------------------------------------------------------

pub(crate) fn hermes_env_path() -> PathBuf {
    hermes_home_dir().join(".env")
}

pub(crate) fn hermes_provider(id: &str) -> Option<&'static HermesProvider> {
    HERMES_PROVIDERS.iter().find(|p| p.id == id)
}

/// Whether a provider stores its API key INLINE in config.yaml `model.api_key`
/// rather than in `~/.hermes/.env`. Only `custom` (the user-supplied
/// OpenAI-compatible endpoint) works this way in Hermes 0.16.0: its registry
/// entry has no `.env` key var, so the key rides in the `model:` section next to
/// `base_url`. Drives both the structured write (`plan_hermes_write`) and the
/// panel projection (`project_hermes_key_and_base`).
pub(crate) fn hermes_inlines_api_key(provider: &str) -> bool {
    provider == "custom"
}

/// Parse simple `KEY=value` lines from a dotenv file. Ignores blank lines and
/// `#` comments, tolerates a leading `export `, and strips one layer of
/// surrounding single/double quotes from the value. Last occurrence wins.
pub(crate) fn parse_env_file(raw: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let body = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        let Some((key, value)) = body.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        map.insert(key.to_string(), value.to_string());
    }
    map
}

/// Update `KEY=value` entries in a dotenv file while preserving comments, blank
/// lines, ordering, and unrelated keys. The first occurrence of an updated key
/// is replaced in place; any later duplicates of that key are dropped (so a
/// last-occurrence-wins reader can't surface a stale shadowing line). Missing
/// keys are appended — including with an empty value (`KEY=`): Hermes loads
/// `~/.hermes/.env` with override semantics, so an explicit empty line both
/// clears a stored credential AND masks an inherited process-env value of the
/// same name (e.g. a stale `OPENAI_API_KEY` exported in the shell).
pub(crate) fn patch_env_text(existing: &str, updates: &[(&str, &str)]) -> String {
    let mut applied = vec![false; updates.len()];
    let mut out_lines: Vec<String> = Vec::new();

    for line in existing.lines() {
        let trimmed = line.trim_start();
        let line_key = if trimmed.starts_with('#') {
            None
        } else {
            let body = trimmed.strip_prefix("export ").unwrap_or(trimmed);
            body.split_once('=').map(|(k, _)| k.trim())
        };
        if let Some(line_key) = line_key {
            if let Some(i) = updates.iter().position(|(key, _)| line_key == *key) {
                if applied[i] {
                    // Drop later duplicates of a key we already rewrote.
                    continue;
                }
                out_lines.push(format!("{}={}", updates[i].0, updates[i].1));
                applied[i] = true;
                continue;
            }
        }
        out_lines.push(line.to_string());
    }

    for (i, (key, value)) in updates.iter().enumerate() {
        // Append a missing key, including an empty `KEY=` — an explicit empty
        // line is what masks an inherited process-env value under Hermes' dotenv
        // override loading, not just a no-op cleanup.
        if !applied[i] {
            out_lines.push(format!("{key}={value}"));
        }
    }

    let mut result = out_lines.join("\n");
    if !result.is_empty() {
        result.push('\n');
    }
    result
}

/// Set `model.{provider,default,base_url}` in a Hermes config.yaml document,
/// preserving every other top-level key. `default` is only written when a
/// non-empty model is given; `base_url` follows the `BaseUrlWrite` action and
/// the inline `model.api_key` follows the `InlineApiKeyWrite` action.
pub(crate) fn merge_hermes_model_config(
    existing: Option<&str>,
    provider: &str,
    model: &str,
    base_url: BaseUrlWrite<'_>,
    inline_api_key: InlineApiKeyWrite<'_>,
) -> Result<String, AcpError> {
    use serde_yaml::{Mapping, Value};
    let mut root: Value = match existing {
        Some(raw) if !raw.trim().is_empty() => serde_yaml::from_str(raw)
            .map_err(|e| AcpError::protocol(format!("invalid hermes config.yaml: {e}")))?,
        _ => Value::Mapping(Mapping::new()),
    };
    if !root.is_mapping() {
        root = Value::Mapping(Mapping::new());
    }
    let root_map = root.as_mapping_mut().expect("root is a mapping");

    let model_key = Value::String("model".to_string());
    if !root_map
        .get(&model_key)
        .map(Value::is_mapping)
        .unwrap_or(false)
    {
        root_map.insert(model_key.clone(), Value::Mapping(Mapping::new()));
    }
    let model_map = root_map
        .get_mut(&model_key)
        .and_then(Value::as_mapping_mut)
        .expect("model is a mapping");

    model_map.insert(
        Value::String("provider".to_string()),
        Value::String(provider.to_string()),
    );
    if !model.is_empty() {
        model_map.insert(
            Value::String("default".to_string()),
            Value::String(model.to_string()),
        );
    }
    match base_url {
        BaseUrlWrite::Set(url) if !url.trim().is_empty() => {
            model_map.insert(
                Value::String("base_url".to_string()),
                Value::String(url.trim().to_string()),
            );
        }
        BaseUrlWrite::Set(_) => {
            model_map.remove(Value::String("base_url".to_string()));
        }
        // Preserve: leave whatever `model.base_url` is already there.
        BaseUrlWrite::Preserve => {}
    }
    match inline_api_key {
        InlineApiKeyWrite::Set { key, scrub_mode } => {
            if key.trim().is_empty() {
                // Blank key on an inline provider → keyless local server.
                model_map.remove(Value::String("api_key".to_string()));
            } else {
                model_map.insert(
                    Value::String("api_key".to_string()),
                    Value::String(key.trim().to_string()),
                );
            }
            // Switching TO custom scrubs a stale mode; a custom→custom re-save
            // leaves a user's raw-editor `api_mode` untouched.
            if scrub_mode {
                model_map.remove(Value::String("api_mode".to_string()));
            }
        }
        // Non-inline provider: scrub a stale inline key/mode from a prior `custom`.
        InlineApiKeyWrite::Clear => {
            model_map.remove(Value::String("api_key".to_string()));
            model_map.remove(Value::String("api_mode".to_string()));
        }
    }

    serde_yaml::to_string(&root)
        .map_err(|e| AcpError::protocol(format!("serialize hermes config.yaml failed: {e}")))
}

/// Quote a single argv token for the current platform's shell, only when it
/// contains characters that would otherwise be reparsed (so simple tokens stay
/// readable). POSIX uses single quotes; Windows wraps in double quotes.
pub(crate) fn shell_quote_arg(arg: &str) -> String {
    shell_quote_arg_for(arg, cfg!(windows))
}

/// Platform-parameterized core of [`shell_quote_arg`], so both the POSIX and
/// Windows quoting rules are unit-testable on any host.
///
/// The backslash forces quoting on POSIX (it is the shell escape char) but NOT
/// on Windows, where it is just the path separator. Force-quoting a plain
/// Windows path like `C:\…\uvx.exe` makes the rendered command *begin* with a
/// double-quoted string: `cmd.exe` runs that fine, but PowerShell parses a
/// leading quoted string as a string *expression* (invoking it would need the
/// `&` call operator) and dies with "Unexpected token" on the next argument —
/// uvx never runs. Leaving a space-free path unquoted keeps it a bare command
/// token that runs in both `cmd` and PowerShell. (A path that contains spaces
/// still must be quoted; such a copied command stays PowerShell-incompatible and
/// needs a leading `&` when pasted there.)
pub(crate) fn shell_quote_arg_for(arg: &str, windows: bool) -> String {
    // Metacharacters that force quoting. Backslash is POSIX-only: on Windows it
    // is the path separator and quoting on its account is what breaks PowerShell.
    let special: &str = if windows {
        "[](){}'\"$&;|<>*?`!#~"
    } else {
        "[](){}'\"$&;|<>*?`\\!#~"
    };
    let needs_quoting =
        arg.is_empty() || arg.chars().any(|c| c.is_whitespace() || special.contains(c));
    if !needs_quoting {
        return arg.to_string();
    }
    if windows {
        format!("\"{}\"", arg.replace('"', "\\\""))
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

pub(crate) fn shell_join(argv: &[String]) -> String {
    argv.iter()
        .map(|a| shell_quote_arg(a))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The argv for Hermes's `--setup` and `model` flows: prefer a system `hermes`
/// CLI, else the resolved uvx recipe (with the pinned package), else the
/// documented uvx form. Returned as argv vectors so callers can shell-quote per
/// platform for display or execute them.
pub(crate) fn hermes_setup_argvs() -> (Vec<String>, Vec<String>) {
    let meta = registry::get_agent_meta(AgentType::Hermes);
    if let registry::AgentDistribution::Uvx {
        package,
        cmd,
        python,
        system_cmd,
        ..
    } = meta.distribution
    {
        if let Some((sys, _)) = system_cmd {
            if resolve_command_on_path(sys).is_some() {
                return (
                    vec![sys.to_string(), "acp".to_string(), "--setup".to_string()],
                    vec![sys.to_string(), "model".to_string()],
                );
            }
        }
        let uvx = resolve_uvx_command()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "uvx".to_string());
        let python_args = uvx_python_args(python);
        // `uvx [--python <ver>] --from <package> <tail...>` — the pin must
        // precede `--from`, matching the launch/prewarm invocations.
        let build = |tail: &[&str]| -> Vec<String> {
            let mut argv = vec![uvx.clone()];
            argv.extend(python_args.iter().cloned());
            argv.push("--from".to_string());
            argv.push(package.to_string());
            argv.extend(tail.iter().map(|s| s.to_string()));
            argv
        };
        return (build(&[cmd, "--setup"]), build(&["hermes", "model"]));
    }
    // Unreachable: Hermes is always a Uvx distribution.
    (
        vec![
            "uvx".to_string(),
            "--python".to_string(),
            "3.13".to_string(),
            "--from".to_string(),
            "hermes-agent[acp,mcp]==0.16.0".to_string(),
            "hermes-acp".to_string(),
            "--setup".to_string(),
        ],
        vec![
            "uvx".to_string(),
            "--python".to_string(),
            "3.13".to_string(),
            "--from".to_string(),
            "hermes-agent[acp,mcp]==0.16.0".to_string(),
            "hermes".to_string(),
            "model".to_string(),
        ],
    )
}

/// Build the displayed/runnable `(setup, model)` shell commands for the Hermes
/// setup guidance, shell-quoted for the current platform.
pub(crate) fn hermes_setup_commands() -> (String, String) {
    let (setup, model) = hermes_setup_argvs();
    (shell_join(&setup), shell_join(&model))
}

/// Read `~/.hermes/.env` + `config.yaml` and project them into the normalized
/// JSON the settings UI binds to: `{provider, model, baseUrl, apiKey,
/// hermesHome, setupCommand, modelCommand}`. Only the active provider's single
/// key var is surfaced — never the rest of `.env`.
/// Project the active provider's API key and endpoint URL for the settings UI.
/// For inline-key providers (`custom`) the key comes from config.yaml's
/// `model.api_key`; for every other keyed provider it is read from the
/// provider's `.env` key var. The base URL prefers config.yaml's
/// `model.base_url` and falls back to the provider's base-URL env var — so an
/// endpoint that lives only in `.env` (e.g. a bare `OPENAI_BASE_URL` with no
/// YAML `base_url`) still shows in the panel and isn't cleared on the next save.
/// Empty stored values are treated as absent. Unknown providers map to nothing
/// here (their key var is undiscoverable; the raw editor governs).
pub(crate) fn project_hermes_key_and_base(
    provider: &str,
    env_map: &BTreeMap<String, String>,
    yaml_base_url: Option<&str>,
    yaml_api_key: Option<&str>,
) -> (Option<String>, Option<String>) {
    let meta = hermes_provider(provider);
    let api_key = if hermes_inlines_api_key(provider) {
        yaml_api_key
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    } else {
        meta.filter(|p| !p.key_env_var.is_empty())
            .and_then(|p| env_map.get(p.key_env_var))
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
    };
    let base_url = yaml_base_url.map(str::to_string).or_else(|| {
        meta.filter(|p| !p.base_url_env_var.is_empty())
            .and_then(|p| env_map.get(p.base_url_env_var))
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
    });
    (api_key, base_url)
}

/// Parse a `HERMES_HOME_MODE` value (octal, e.g. `0701` for web-server traversal
/// layouts), falling back to owner-only `0700`. Accepts an optional `0o` prefix.
#[cfg(unix)]
pub(crate) fn parse_hermes_home_mode(raw: Option<&str>) -> u32 {
    raw.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.strip_prefix("0o").unwrap_or(s))
        .and_then(|s| u32::from_str_radix(s, 8).ok())
        .filter(|m| *m != 0)
        .unwrap_or(0o700)
}

/// Pure decision logic for a Hermes config save: compute the config.yaml content
/// to write and the `.env` `(key_var, value)` updates. Validation happens here
/// (no I/O) so a bad request fails before anything is written.
///
/// Raw mode is enforced server-side to never touch `.env` (the API contract is
/// not left to the caller's payload). OAuth/AWS providers carry no key var, so
/// they never produce a key update. Keyed providers update their API key (a
/// blank key leaves the stored secret untouched); providers with a base-URL env
/// var also mirror the structured endpoint URL there. Embedded newlines in the
/// key or base URL are rejected.
pub(crate) fn plan_hermes_write(
    provider: &str,
    api_key: Option<&str>,
    model: &str,
    base_url: Option<&str>,
    raw_config_yaml: Option<&str>,
    existing_config: Option<&str>,
) -> Result<HermesWritePlan, AcpError> {
    // The provider the existing config.yaml was on (None for a first save / raw
    // mode). Drives base-URL preservation and stale-`.env`-credential cleanup.
    let previous_provider = existing_hermes_model_provider(existing_config);

    let config_yaml = if let Some(raw) = raw_config_yaml {
        serde_yaml::from_str::<serde_yaml::Value>(raw)
            .map_err(|e| AcpError::protocol(format!("invalid hermes config.yaml: {e}")))?;
        raw.to_string()
    } else {
        // Structured mode only handles providers in the curated table. The
        // `custom` provider IS handled (its key/endpoint live inline in
        // config.yaml — see `hermes_inlines_api_key`), but unknown ids (the
        // legacy `openai` pseudo-provider, user-defined `custom:` slugs, or
        // anything outside the table) have no credential layout veryagent can map —
        // reject them and steer the user to the raw config.yaml editor, which
        // stays the escape hatch.
        let meta = hermes_provider(provider).ok_or_else(|| {
            AcpError::protocol(format!(
                "unknown hermes provider '{provider}'; edit ~/.hermes/config.yaml directly"
            ))
        })?;
        // Decide what happens to `model.base_url`:
        // - User-editable endpoint (openai-api/lmstudio/azure-foundry) → write the
        //   field's value, or clear it when blank.
        // - Endpoint not exposed in the panel, and the provider is UNCHANGED →
        //   preserve an out-of-band base URL (proxy/Azure) the user set elsewhere.
        // - Endpoint not exposed, but the provider just CHANGED → clear the stale
        //   base URL left over from the previous provider (it must not carry over).
        let base = if meta.needs_base_url {
            BaseUrlWrite::Set(base_url.unwrap_or(""))
        } else if previous_provider.as_deref() == Some(provider) {
            BaseUrlWrite::Preserve
        } else {
            BaseUrlWrite::Set("")
        };
        // Inline key — `custom` only. The key rides in `model.api_key`; every
        // other provider gets `Clear` so a stale inline key from a previous
        // `custom` endpoint never bleeds into the new provider. A blank inline
        // key drops the field (keyless local server).
        let inline_api_key = if hermes_inlines_api_key(provider) {
            let key = api_key.map(str::trim).unwrap_or_default();
            if key.contains(['\n', '\r']) {
                return Err(AcpError::protocol(
                    "hermes api key must not contain newlines",
                ));
            }
            // Scrub a stale `api_mode` only when switching TO custom from a
            // different provider; a custom→custom re-save preserves it.
            let scrub_mode = previous_provider.as_deref() != Some(provider);
            InlineApiKeyWrite::Set { key, scrub_mode }
        } else {
            InlineApiKeyWrite::Clear
        };
        merge_hermes_model_config(existing_config, provider, model, base, inline_api_key)?
    };

    // Raw mode edits config.yaml only; never `.env`.
    let mut env_updates: Vec<(&'static str, String)> = Vec::new();
    if raw_config_yaml.is_none() {
        let meta = hermes_provider(provider);
        // API key — keyed providers only. A blank key leaves the stored secret
        // untouched (so switching providers can't wipe it).
        if let Some(meta) = meta.filter(|p| !p.key_env_var.is_empty()) {
            if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
                if key.contains(['\n', '\r']) {
                    return Err(AcpError::protocol(
                        "hermes api key must not contain newlines",
                    ));
                }
                env_updates.push((meta.key_env_var, key.to_string()));
            }
        }
        // Endpoint URL — mirror the structured base URL into the provider's
        // base-URL env var so `.env` and config.yaml `model.base_url` agree
        // under either of Hermes' resolution paths. An empty value clears a
        // stale override.
        if let Some(meta) = meta.filter(|p| p.needs_base_url && !p.base_url_env_var.is_empty()) {
            let base = base_url.map(str::trim).unwrap_or_default();
            if base.contains(['\n', '\r']) {
                return Err(AcpError::protocol(
                    "hermes base url must not contain newlines",
                ));
            }
            env_updates.push((meta.base_url_env_var, base.to_string()));
        }
        // Neutralize only vars that can actually BLEED INTO the selected
        // provider's runtime path — never blanket-wipe the previous provider's
        // own credential (a valid ANTHROPIC_API_KEY must survive an anthropic→zai
        // switch; zai won't read it). The one documented cross-provider fallback
        // in hermes 0.16.0: openrouter (being OpenAI-API compatible) falls back to
        // OPENAI_API_KEY and treats OPENAI_BASE_URL as an endpoint override. So
        // when saving openrouter, write an explicit empty `OPENAI_API_KEY=` /
        // `OPENAI_BASE_URL=` — appended even if absent from `.env`, since under
        // Hermes' dotenv override loading only that masks a stale value inherited
        // from the process environment.
        if provider == "openrouter" {
            for var in ["OPENAI_API_KEY", "OPENAI_BASE_URL"] {
                if !env_updates.iter().any(|(k, _)| *k == var) {
                    env_updates.push((var, String::new()));
                }
            }
        }
    }

    Ok((config_yaml, env_updates))
}

/// Decide how to reconcile the active provider's base-URL `.env` variable with
/// `config.yaml`'s `model.base_url`, so Hermes' auxiliary credential path —
/// `auth.py::resolve_api_key_provider_credentials`, which reads the endpoint
/// ONLY from the provider's `<X>_BASE_URL` env var — resolves the SAME endpoint
/// as the main loop, which reads `config.yaml model.base_url`. Hermes' own
/// `hermes model`/`hermes setup` writes `model.base_url` but never the `.env`
/// var, so auxiliary tasks (title generation, compression, …) silently fall
/// back to the provider's registry-default host and 401 against the wrong
/// endpoint. The settings panel already mirrors both on save; this covers
/// configs authored outside veryagent.
///
/// Scope is the single ACTIVE provider's own base-URL var, never another
/// provider's. Returns `Some((env_var, value))` to write — `value` is the
/// verbatim `model.base_url`, or `""` to clear a stale override that would
/// otherwise bleed into the auxiliary path — or `None` for a no-op. Unknown /
/// legacy providers and ones with no base-URL var (OAuth, Bedrock,
/// kimi-coding-cn) map to `None`.
pub(crate) fn plan_hermes_base_url_reconcile(
    provider: &str,
    yaml_base_url: Option<&str>,
    current_env_value: Option<&str>,
) -> Option<(&'static str, String)> {
    let meta = hermes_provider(provider).filter(|p| !p.base_url_env_var.is_empty())?;
    let desired = yaml_base_url.map(str::trim).unwrap_or_default();
    // A base URL carrying an embedded newline would let `patch_env_text` emit an
    // extra `.env` line — injecting ANOTHER provider's var and breaking the
    // single-active-var invariant. config.yaml is the user's own file, but skip
    // rather than corrupt `.env` (the panel's `plan_hermes_write` rejects
    // newlines the same way). A blank-after-trim value still falls through to the
    // empty/clear path below.
    if desired.contains(['\n', '\r']) {
        return None;
    }
    let current = current_env_value.unwrap_or_default();
    if desired.is_empty() {
        // No endpoint in config.yaml. Clear a stale, non-empty override so it
        // can't shadow the registry default in the auxiliary path; leave an
        // absent/empty var alone (don't append a redundant `KEY=`).
        if current.is_empty() {
            return None;
        }
        return Some((meta.base_url_env_var, String::new()));
    }
    if base_url_eq(desired, current) {
        return None;
    }
    Some((meta.base_url_env_var, desired.to_string()))
}

/// Inner reconcile keyed on an explicit home dir (so tests drive a tempdir
/// without mutating `HERMES_HOME`). No-ops when `config.yaml` is absent — it
/// must never create `~/.hermes`; a config written later goes through the panel
/// (which already mirrors the base URL) or a subsequent launch.
pub(crate) fn reconcile_hermes_runtime_env_in(home: &Path) -> Result<(), AcpError> {
    let config_path = home.join("config.yaml");
    let Ok(raw_yaml) = fs::read_to_string(&config_path) else {
        return Ok(());
    };
    let value: serde_yaml::Value = serde_yaml::from_str(&raw_yaml)
        .map_err(|e| AcpError::protocol(format!("parse hermes config.yaml: {e}")))?;
    let Some(model_section) = value.get("model") else {
        return Ok(());
    };
    let Some(provider) = yaml_str(model_section, "provider") else {
        return Ok(());
    };
    let yaml_base_url = yaml_str(model_section, "base_url");

    let env_path = home.join(".env");
    // Only a MISSING `.env` is an empty baseline. An existing-but-unreadable file
    // (non-UTF-8, permission-denied, …) must abort the reconcile — patching from
    // an empty baseline would rewrite `.env` with just the base-URL line and drop
    // the user's API keys and comments. A dangling symlink reads as NotFound and
    // is correctly created fresh (0600) by `write_hermes_secret_file`.
    let existing_env = match fs::read_to_string(&env_path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(AcpError::protocol(format!("read hermes .env: {e}"))),
    };
    let env_map = parse_env_file(&existing_env);
    let current = hermes_provider(&provider)
        .filter(|p| !p.base_url_env_var.is_empty())
        .and_then(|p| env_map.get(p.base_url_env_var))
        .map(String::as_str);

    let Some((var, val)) =
        plan_hermes_base_url_reconcile(&provider, yaml_base_url.as_deref(), current)
    else {
        return Ok(());
    };

    let patched = patch_env_text(&existing_env, &[(var, val.as_str())]);
    write_hermes_secret_file(&env_path, &patched, ".env")
}

/// Quote a string for a single-quoted POSIX shell argument.
#[cfg(all(feature = "tauri-runtime", target_os = "macos"))]
pub(crate) fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
