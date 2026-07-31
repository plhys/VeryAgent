import { getTransport } from "../transport"
import type {
  AgentType,
  OpenClawGatewayDiscovery,
  OpenClawGatewayEnsureResult,
} from "../types"

export async function acpUpdateAgentEnv(
  agentType: AgentType,
  params: {
    enabled: boolean
    env: Record<string, string>
    modelProviderId?: number | null
  }
): Promise<number> {
  return getTransport().call("acp_update_agent_env", {
    agentType,
    enabled: params.enabled,
    env: params.env,
    modelProviderId: params.modelProviderId ?? null,
  })
}

/** Returns the number of running sessions left on stale config by this save
 *  (for the settings-side "N sessions need restart" toast). */

export async function acpUpdateAgentConfig(
  agentType: AgentType,
  params: {
    config_json?: string | null
    opencode_auth_json?: string | null
    codex_auth_json?: string | null
    codex_config_toml?: string | null
  }
): Promise<number> {
  return getTransport().call("acp_update_agent_config", {
    agentType,
    configJson: params.config_json ?? null,
    opencodeAuthJson: params.opencode_auth_json ?? null,
    codexAuthJson: params.codex_auth_json ?? null,
    codexConfigToml: params.codex_config_toml ?? null,
  })
}

/**
 * Persist a Hermes config update. Writes the active provider's API key to
 * ~/.hermes/.env and the model/provider/base_url to ~/.hermes/config.yaml.
 * When `rawConfigYaml` is given, config.yaml is written verbatim (advanced
 * mode), bypassing the structured merge.
 */

export async function acpUpdateHermesConfig(params: {
  provider: string
  apiKey?: string | null
  model?: string | null
  baseUrl?: string | null
  rawConfigYaml?: string | null
}): Promise<void> {
  return getTransport().call("acp_update_hermes_config", {
    provider: params.provider,
    apiKey: params.apiKey ?? null,
    model: params.model ?? null,
    baseUrl: params.baseUrl ?? null,
    rawConfigYaml: params.rawConfigYaml ?? null,
  })
}

/**
 * Persist a Kimi Code config update, keeping exactly one source authoritative.
 * `mode` "apikey" writes the veryagent-managed ~/.kimi-code/config.toml provider/model
 * block AND seeds a synthetic gate token so the API key authenticates `kimi acp`
 * (its session gate only checks for a stored token); "login" clears the managed
 * block + removes our synthetic token so a real OAuth login governs; "raw" writes
 * a verbatim config.toml then seeds the gate token. Returns the number of running
 * Kimi sessions left on stale config.
 */

export async function acpUpdateKimiCodeConfig(params: {
  mode: "apikey" | "login" | "raw"
  interfaceType?: string | null
  authType?: string | null
  baseUrl?: string | null
  apiKey?: string | null
  model?: string | null
  maxContextSize?: number | null
  vertexProject?: string | null
  vertexLocation?: string | null
  rawConfigToml?: string | null
}): Promise<number> {
  return getTransport().call("acp_update_kimi_code_config", {
    mode: params.mode,
    interfaceType: params.interfaceType ?? null,
    authType: params.authType ?? null,
    baseUrl: params.baseUrl ?? null,
    apiKey: params.apiKey ?? null,
    model: params.model ?? null,
    maxContextSize: params.maxContextSize ?? null,
    vertexProject: params.vertexProject ?? null,
    vertexLocation: params.vertexLocation ?? null,
    rawConfigToml: params.rawConfigToml ?? null,
  })
}

/**
 * List the models an API key + endpoint can access (GET `<baseUrl>/models`).
 * Validates the key and powers the Kimi settings model picker; throws with the
 * provider's error message on failure.
 */

export async function acpFetchKimiModels(params: {
  baseUrl: string
  apiKey: string
}): Promise<string[]> {
  return getTransport().call("acp_fetch_kimi_models", {
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
  })
}

/**
 * Apply a structured Pi config update. Merge-writes pi's native
 * `~/.pi/agent/settings.json` (`defaultProvider` / `defaultModel` /
 * `defaultThinkingLevel`) and, when an API key is supplied,
 * `~/.pi/agent/auth.json` (`{ "<provider>": { "type": "api_key", "key": ... } }`),
 * preserving every other key in both files.
 */

export async function acpUpdatePiConfig(params: {
  provider: string
  model: string
  thinkingLevel?: string
  apiKey?: string
  /** Custom/self-hosted provider endpoint. When set, `provider` is written to
   * `models.json` (with `customApi` as the wire protocol). Omit for built-ins. */
  customBaseUrl?: string
  customApi?: string
}): Promise<void> {
  return getTransport().call("acp_update_pi_config", {
    provider: params.provider,
    model: params.model,
    thinkingLevel: params.thinkingLevel ?? null,
    apiKey: params.apiKey ?? null,
    customBaseUrl: params.customBaseUrl ?? null,
    customApi: params.customApi ?? null,
  })
}

/**
 * Read pi's current native config for the settings panel: the three
 * `settings.json` model keys plus the provider names present in `auth.json`
 * (sorted). Missing files surface as `null` / an empty list.
 */

export async function loadPiConfig(): Promise<{
  defaultProvider: string | null
  defaultModel: string | null
  defaultThinkingLevel: string | null
  authProviders: string[]
  /** Custom/self-hosted providers defined in `models.json`, sorted by id. Used
   * to rehydrate the custom-provider form and detect a custom `defaultProvider`. */
  customProviders: { id: string; baseUrl: string; api: string }[]
}> {
  return getTransport().call("acp_load_pi_config", {})
}

/**
 * Discover OpenClaw gateway URL/token from process env and local
 * `~/.openclaw/openclaw.json` (or `OPENCLAW_CONFIG_PATH`). Empty fields mean
 * "not found" — never a fabricated default port.
 */

export async function acpDiscoverOpenClawGateway(): Promise<OpenClawGatewayDiscovery> {
  return getTransport().call("acp_discover_openclaw_gateway", {})
}

/**
 * One-click local OpenClaw gateway bootstrap for settings: create baseline
 * config if needed, set gateway.mode=local, install/start service (or
 * detached run), then re-probe reachability.
 */

export async function acpEnsureOpenClawGateway(): Promise<OpenClawGatewayEnsureResult> {
  return getTransport().call("acp_ensure_openclaw_gateway", {})
}

/**
 * Validate a user-supplied custom pi binary (BYO-pi): resolve it (path or
 * `PATH`) and best-effort read its `--version`. A not-found binary returns
 * `{ found: false, resolvedPath: null, version: null }` (not an error).
 */

export async function acpValidatePiCommand(command: string): Promise<{
  found: boolean
  resolvedPath: string | null
  version: string | null
}> {
  return getTransport().call("acp_validate_pi_command", { command })
}

/**
 * Install the `pi` binary (`@earendil-works/pi-coding-agent`) globally via npm.
 * This is the prerequisite pi-acp spawns as `pi --mode rpc` — distinct from the
 * `pi-acp` adapter that `acpPrepareNpxAgent` installs. Progress streams on the
 * shared `app://agent-install` topic; pass `taskId` to `useAgentInstallStream`
 * (or `acpInstallStream`) to receive the log lines.
 */
