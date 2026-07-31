import {
  getTransport,
} from "../transport"
import type {
  AgentType,
  AgentOptionsSnapshot,
} from "../types"


export interface VisionBridgeSettings {
  enabled: boolean
  api_url: string
  api_key: string
  model_name: string
  agent_types_list: string[]
}

/** Mirror of Rust `VisionBridgeConfig` (the full row, including `updated_at`). */

export interface VisionBridgeConfig extends VisionBridgeSettings {
  updated_at: string
}


export async function visionBridgeGetConfig(): Promise<VisionBridgeConfig> {
  return getTransport().call("vision_bridge_get_config")
}


export async function visionBridgeSaveConfig(
  settings: VisionBridgeSettings
): Promise<VisionBridgeConfig> {
  return getTransport().call("vision_bridge_save_config", { settings })
}


/** One image gateway entry (note + priority 0–9, 0 = highest). */

export interface ImageGatewayEntry {
  id: string
  /** Free-form note: site name, price, model family, etc. */
  note: string
  /** 0 = highest priority (top / tried first), 9 = lowest. */
  priority: number
  enabled: boolean
  api_url: string
  api_key: string
  model_name: string
  default_size: string
}

/** Mirror of Rust `ImageGenerationConfigUpdate`. */

export interface ImageGenerationSettings {
  enabled: boolean
  /** Multi-gateway list (preferred). */
  gateways?: ImageGatewayEntry[]
  /** Legacy single-gateway fields (still accepted when gateways empty). */
  api_url: string
  api_key: string
  model_name: string
  default_size: string
}

/** Mirror of Rust `ImageGenerationConfig` (full row, including `updated_at`). */

export interface ImageGenerationConfig extends ImageGenerationSettings {
  gateways: ImageGatewayEntry[]
  updated_at: string
}


export async function imageGenerationGetConfig(): Promise<ImageGenerationConfig> {
  return getTransport().call("image_generation_get_config")
}

/** Result of saving image-generation settings (includes stale-session count). */

export interface ImageGenerationSaveResult {
  config: ImageGenerationConfig
  affectedRunningSessions: number
}


export async function imageGenerationSaveConfig(
  settings: ImageGenerationSettings
): Promise<ImageGenerationSaveResult> {
  return getTransport().call("image_generation_save_config", { settings })
}

/** Model item from gateway `/models` (camelCase, matches Rust ProviderModelItem). */

export interface ImageGenerationModelItem {
  id: string
  name: string
}


export interface ImageGenerationModelsResult {
  models: ImageGenerationModelItem[]
  /** True when no image-like ids matched and full list (minus noise) was returned. */
  usedFallback: boolean
}

/** List models from the image gateway; prefers image-like model ids. */

export async function imageGenerationFetchModels(params: {
  apiUrl: string
  apiKey: string
}): Promise<ImageGenerationModelsResult> {
  // Tauri command args use the Rust parameter names as-is (snake → camel via
  // ipc). Match acpFetchKimiModels: pass camelCase keys.
  return getTransport().call("image_generation_fetch_models", {
    apiUrl: params.apiUrl,
    apiKey: params.apiKey,
  })
}

// ─── PPT Generation (slide-generator.mjs) ─────────────────────────────────


export interface PptxSlideContent {
  title?: string
  bullets?: string[]
  images?: { url: string; caption?: string }[]
  table?: { headers: string[]; rows: string[][] }
  note?: string
}


export type PptxMode = "markdown" | "html"


export interface PptxMarkdownRequest extends Record<string, unknown> {
  mode: "markdown"
  title: string
  slides: PptxSlideContent[]
  output_path: string
  background_color?: string
  font_face?: string
}


export interface PptxHtmlRequest extends Record<string, unknown> {
  mode: "html"
  html_dir: string
  output_path: string
  title?: string
  include_screenshots?: boolean
}


export type PptxRequest = PptxMarkdownRequest | PptxHtmlRequest


export interface PptxResult {
  output_path: string
  slide_count: number
}


export async function pptxGenerate(
  req: PptxRequest,
): Promise<PptxResult> {
  return getTransport().call("ppt_generation", req)
}

/** Mirror of Rust `OpenWikiAgentCapability`. */

export type OpenWikiAgentCapability =
  | "read_wiki"
  | "request_update"
  | "request_init"
  | "request_chat"

/** Mirror of Rust `OpenWikiAgentPermission`. */

export interface OpenWikiAgentPermission {
  agent_type: string
  capabilities: OpenWikiAgentCapability[]
}

/** Mirror of Rust `OpenWikiInjectMode`. */

export type OpenWikiInjectMode = "summary_and_path" | "summary" | "path_only"

/** Mirror of Rust `OpenWikiConfig`. */

export interface OpenWikiConfig {
  enabled: boolean
  modes: {
    code: boolean
    personal: boolean
  }
  agent_types_list: string[]
  agent_permissions: OpenWikiAgentPermission[]
  inject: {
    on_session_start: boolean
    inject_agents_md: boolean
    inject_mode: OpenWikiInjectMode
  }
  auto_update: {
    enabled: boolean
    on_git_change: boolean
    schedule_cron?: string | null
  }
  model: {
    use_openwiki_env: boolean
    provider?: string | null
    model_id?: string | null
    api_key: string
    base_url?: string | null
  }
  paths: {
    code_wiki_dirname: string
    personal_wiki_root?: string | null
    executable: string
  }
  commands: {
    allow_init: boolean
    allow_update: boolean
    allow_chat: boolean
    allow_ingest: boolean
    allow_cron: boolean
    allow_auth: boolean
    advanced_enabled: boolean
  }
  ignore_patterns: string[]
}

/** Mirror of Rust `OpenWikiStatus`. */

export interface OpenWikiStatus {
  enabled: boolean
  executable_found: boolean
  executable_path?: string | null
  wiki_exists: boolean
  wiki_path?: string | null
  last_update_path?: string | null
  instructions_exists: boolean
  message: string
}

/** Mirror of Rust `OpenWikiAction`. */

export type OpenWikiAction = "code_init" | "code_update" | "status"

/** Mirror of Rust `OpenWikiRunResult`. */

export interface OpenWikiRunResult {
  action: string
  success: boolean
  exit_code?: number | null
  stdout: string
  stderr: string
  executable: string
  working_dir: string
  duration_ms: number
}


export interface OpenWikiInstructions {
  content: string
  path: string
}


export async function openwikiGetConfig(): Promise<OpenWikiConfig> {
  return getTransport().call("openwiki_get_config")
}


export async function openwikiSaveConfig(
  settings: OpenWikiConfig
): Promise<OpenWikiConfig> {
  return getTransport().call("openwiki_save_config", { settings })
}


export async function openwikiStatus(
  workspace?: string | null
): Promise<OpenWikiStatus> {
  return getTransport().call("openwiki_status", { workspace: workspace ?? null })
}


export async function openwikiRun(
  action: OpenWikiAction,
  workspace?: string | null
): Promise<OpenWikiRunResult> {
  return getTransport().call("openwiki_run", {
    params: { action, workspace: workspace ?? null },
  })
}


export async function openwikiGetInstructions(
  workspace: string
): Promise<OpenWikiInstructions> {
  return getTransport().call("openwiki_get_instructions", {
    params: { workspace },
  })
}


export async function openwikiSaveInstructions(
  workspace: string,
  content: string
): Promise<OpenWikiInstructions> {
  return getTransport().call("openwiki_save_instructions", {
    update: { workspace, content },
  })
}

/** Mirror of Rust `OpenWikiInstallResult`. */

export interface OpenWikiInstallResult {
  success: boolean
  executable_path: string | null
  message: string
}

/**
 * Install the OpenWiki CLI via `npm install -g openwiki` (user-prefix fallback).
 * Streams progress/logs on `app://openwiki-install` tagged with `taskId`.
 * Long timeout: npm may download a large dependency tree.
 */

export async function openwikiInstallCli(
  taskId: string
): Promise<OpenWikiInstallResult> {
  return getTransport().call(
    "openwiki_install_cli",
    { taskId },
    { timeoutMs: 630_000 }
  )
}

/** Uninstall OpenWiki CLI from default global + user npm prefixes. */

export async function openwikiUninstallCli(): Promise<OpenWikiInstallResult> {
  return getTransport().call("openwiki_uninstall_cli", undefined, {
    timeoutMs: 120_000,
  })
}

// ---------------------------------------------------------------------------
// Generic npm CLI install / uninstall — shared by any npm-based plugin.
// Adding a new plugin no longer requires a Rust recompile.
// ---------------------------------------------------------------------------


export interface NpmInstallParams {
  packageName: string
  binaryName: string
  eventChannel: string
  taskId: string
  includeOptional?: boolean
}


export interface NpmUninstallParams {
  packageName: string
  binaryName: string
}

/** Mirror of Rust `NpmInstallResult`. */

export interface NpmInstallResult {
  success: boolean
  executablePath: string | null
  message: string
}

/**
 * Install an npm-based CLI globally (user-prefix first, default global fallback).
 * Streams progress/logs on the event channel specified in `params.eventChannel`.
 */

export async function npmInstallCli(
  params: NpmInstallParams
): Promise<NpmInstallResult> {
  return getTransport().call("npm_install_cli", { params }, {
    timeoutMs: 630_000,
  })
}

/** Uninstall an npm-based CLI from default global + user npm prefixes. */

export async function npmUninstallCli(
  params: NpmUninstallParams
): Promise<NpmInstallResult> {
  return getTransport().call("npm_uninstall_cli", { params }, {
    timeoutMs: 120_000,
  })
}

/** Live probe — opens a transient ACP connection to `agent_type`, reads what
 * it advertises (modes / config_options), and tears down. Used by the
 * delegation-settings UI so the option set on screen matches exactly what
 * veryagent-mcp will receive when a subagent is spawned for delegation.
 *
 * Does NOT touch chat-side `selectorsCache` or `localStorage` preferences. */

export async function describeAgentOptions(
  agentType: AgentType,
  workingDir?: string | null
): Promise<AgentOptionsSnapshot> {
  // The backend probe has its own 60s timeout (`ConnectionManager::
  // probe_agent_options`) plus 500ms grace + poll/serialization
  // overhead. The default transport timeout of 60s would race with
  // that and surface "Request timed out" before the backend can
  // return `ProbeTimedOut`. 70s gives the backend a clean margin to
  // produce its structured error.
  return getTransport().call(
    "acp_describe_agent_options",
    {
      agentType,
      workingDir: workingDir ?? null,
    },
    { timeoutMs: 70_000 }
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Backup & restore
// ───────────────────────────────────────────────────────────────────────────


