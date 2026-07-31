import {
  getTransport,
} from "../transport"
import type {
  AgentType,
  AgentDelegationDefaults,
  FeedbackItem,
  TerminalInfo,
  AvailableTerminalShells,
  AppUpdateSource,
  AppUpdateSourceSettings,
  SystemLanguageSettings,
  SystemProxySettings,
  SystemRenderingSettings,
  SystemTerminalSettings,
  LogSettings,
  LogSettingsView,
  LogRecord,
  LogFileInfo,
  GitDetectResult,
  GitSettings,
  GitHubAccountsSettings,
  GitHubTokenValidation,
  McpAppType,
  LocalMcpServer,
  McpMarketplaceProvider,
  McpMarketplaceItem,
  McpMarketplaceServerDetail,
} from "../types"


export async function getSystemProxySettings(): Promise<SystemProxySettings> {
  return getTransport().call("get_system_proxy_settings")
}


export async function updateSystemProxySettings(
  settings: SystemProxySettings
): Promise<SystemProxySettings> {
  return getTransport().call("update_system_proxy_settings", { settings })
}


export async function getAppUpdateSourceSettings(): Promise<AppUpdateSourceSettings> {
  return getTransport().call("get_app_update_source_settings")
}


export async function updateAppUpdateSourceSettings(
  source: AppUpdateSource
): Promise<AppUpdateSourceSettings> {
  return getTransport().call("update_app_update_source_settings", { source })
}


export async function getSystemLanguageSettings(): Promise<SystemLanguageSettings> {
  return getTransport().call("get_system_language_settings")
}


export async function updateSystemLanguageSettings(
  settings: SystemLanguageSettings
): Promise<SystemLanguageSettings> {
  return getTransport().call("update_system_language_settings", { settings })
}


export async function getSystemTerminalSettings(): Promise<SystemTerminalSettings> {
  return getTransport().call("get_system_terminal_settings")
}


export async function updateSystemTerminalSettings(
  settings: SystemTerminalSettings
): Promise<SystemTerminalSettings> {
  return getTransport().call("update_system_terminal_settings", { settings })
}


export async function getAvailableTerminalShells(): Promise<AvailableTerminalShells> {
  return getTransport().call("get_available_terminal_shells")
}


export async function probeTerminalShellPath(path: string): Promise<boolean> {
  return getTransport().call("probe_terminal_shell_path", { path })
}


export async function getAppAutostartEnabled(): Promise<boolean> {
  return getTransport().call("get_app_autostart_enabled")
}


export async function setAppAutostartEnabled(enabled: boolean): Promise<boolean> {
  return getTransport().call("set_app_autostart_enabled", { enabled })
}


export async function getSystemRenderingSettings(): Promise<SystemRenderingSettings> {
  return getTransport().call("get_system_rendering_settings")
}


export async function updateSystemRenderingSettings(
  settings: SystemRenderingSettings
): Promise<SystemRenderingSettings> {
  return getTransport().call("update_system_rendering_settings", { settings })
}

// --- Logging ---

/** Live-tail channel: one event per appended log record. */
export const LOG_APPENDED_EVENT = "logs://appended"
/** Cross-window broadcast announcing a log-level change. */
export const LOG_SETTINGS_CHANGED_EVENT = "log-settings://changed"


export async function getLogSettings(): Promise<LogSettingsView> {
  return getTransport().call("get_log_settings")
}


export async function setLogSettings(
  settings: LogSettings
): Promise<LogSettings> {
  return getTransport().call("set_log_settings", { settings })
}


export async function getRecentLogs(params: {
  limit: number
  minLevel?: string
  search?: string
}): Promise<LogRecord[]> {
  return getTransport().call("get_recent_logs", {
    limit: params.limit,
    minLevel: params.minLevel,
    search: params.search,
  })
}


export async function listLogFiles(): Promise<LogFileInfo[]> {
  return getTransport().call("list_log_files")
}

/** Ensure the logs dir exists and return its absolute path (desktop only). */

export async function openLogsDir(): Promise<string> {
  return getTransport().call("open_logs_dir")
}

/** Read a single on-disk log file (web download / paginate). Returns the
 * newest `maxBytes` when capped. */

export async function readLogFile(
  name: string,
  maxBytes?: number
): Promise<string> {
  return getTransport().call("read_log_file", { name, maxBytes })
}


export async function subscribeLogAppended(
  handler: (record: LogRecord) => void
): Promise<() => void> {
  return getTransport().subscribe<LogRecord>(LOG_APPENDED_EVENT, handler)
}


export async function subscribeLogSettingsChanged(
  handler: (settings: LogSettings) => void
): Promise<() => void> {
  return getTransport().subscribe<LogSettings>(
    LOG_SETTINGS_CHANGED_EVENT,
    handler
  )
}

// --- Version Control ---


export async function detectGit(): Promise<GitDetectResult> {
  return getTransport().call("detect_git")
}


export async function testGitPath(path: string): Promise<GitDetectResult> {
  return getTransport().call("test_git_path", { path })
}


export async function getGitSettings(): Promise<GitSettings> {
  return getTransport().call("get_git_settings")
}


export async function updateGitSettings(
  settings: GitSettings
): Promise<GitSettings> {
  return getTransport().call("update_git_settings", { settings })
}


export async function getGitHubAccounts(): Promise<GitHubAccountsSettings> {
  return getTransport().call("get_github_accounts")
}


export async function validateGitHubToken(
  serverUrl: string,
  token: string
): Promise<GitHubTokenValidation> {
  return getTransport().call("validate_github_token", { serverUrl, token })
}


export async function updateGitHubAccounts(
  settings: GitHubAccountsSettings
): Promise<GitHubAccountsSettings> {
  return getTransport().call("update_github_accounts", { settings })
}


export async function saveAccountToken(
  accountId: string,
  token: string
): Promise<void> {
  return getTransport().call("save_account_token", { accountId, token })
}


export async function getAccountToken(
  accountId: string
): Promise<string | null> {
  return getTransport().call("get_account_token", { accountId })
}


export async function deleteAccountToken(accountId: string): Promise<void> {
  return getTransport().call("delete_account_token", { accountId })
}


export async function mcpScanLocal(): Promise<LocalMcpServer[]> {
  return getTransport().call("mcp_scan_local")
}


export async function mcpListMarketplaces(): Promise<McpMarketplaceProvider[]> {
  return getTransport().call("mcp_list_marketplaces")
}


export async function mcpSearchMarketplace(params: {
  providerId: string
  query?: string | null
  limit?: number | null
}): Promise<McpMarketplaceItem[]> {
  return getTransport().call("mcp_search_marketplace", {
    providerId: params.providerId,
    query: params.query ?? null,
    limit: params.limit ?? null,
  })
}


export async function mcpGetMarketplaceServerDetail(params: {
  providerId: string
  serverId: string
}): Promise<McpMarketplaceServerDetail> {
  return getTransport().call("mcp_get_marketplace_server_detail", {
    providerId: params.providerId,
    serverId: params.serverId,
  })
}


export async function mcpInstallFromMarketplace(params: {
  providerId: string
  serverId: string
  apps: McpAppType[]
  specOverride?: Record<string, unknown> | null
  optionId?: string | null
  protocol?: string | null
  parameterValues?: Record<string, unknown> | null
}): Promise<LocalMcpServer> {
  return getTransport().call("mcp_install_from_marketplace", {
    providerId: params.providerId,
    serverId: params.serverId,
    apps: params.apps,
    specOverride: params.specOverride ?? null,
    optionId: params.optionId ?? null,
    protocol: params.protocol ?? null,
    parameterValues: params.parameterValues ?? null,
  })
}


export async function mcpUpsertLocalServer(params: {
  serverId: string
  spec: Record<string, unknown>
  apps: McpAppType[]
}): Promise<LocalMcpServer> {
  return getTransport().call("mcp_upsert_local_server", {
    serverId: params.serverId,
    spec: params.spec,
    apps: params.apps,
  })
}


export async function mcpSetServerApps(
  serverId: string,
  apps: McpAppType[]
): Promise<LocalMcpServer | null> {
  return getTransport().call("mcp_set_server_apps", { serverId, apps })
}


export async function mcpRemoveServer(
  serverId: string,
  apps?: McpAppType[] | null
): Promise<boolean> {
  return getTransport().call("mcp_remove_server", {
    serverId,
    apps: apps ?? null,
  })
}

// Folder history commands


export async function terminalSpawn(
  workingDir: string,
  shell?: string,
  initialCommand?: string,
  terminalId?: string
): Promise<string> {
  return getTransport().call("terminal_spawn", {
    workingDir,
    shell: shell ?? null,
    initialCommand: initialCommand ?? null,
    terminalId: terminalId ?? null,
  })
}


export async function terminalWrite(
  terminalId: string,
  data: string
): Promise<void> {
  return getTransport().call("terminal_write", { terminalId, data })
}


export async function terminalResize(
  terminalId: string,
  cols: number,
  rows: number
): Promise<void> {
  return getTransport().call("terminal_resize", { terminalId, cols, rows })
}


export async function terminalKill(terminalId: string): Promise<void> {
  return getTransport().call("terminal_kill", { terminalId })
}


export async function terminalList(): Promise<TerminalInfo[]> {
  return getTransport().call("terminal_list")
}

// ── Web Server Management ──


export type WebServicePortState = "free" | "occupied" | "unknown"


export interface WebServicePortProbe {
  port: number
  state: WebServicePortState
}


export async function probeWebServicePort(
  port?: number
): Promise<WebServicePortProbe> {
  return getTransport().call("probe_web_service_port", {
    port: port ?? null,
  })
}

// ─── Chat Channels ───


export interface DelegationSettings {
  enabled: boolean
  depth_limit: number
  /** Per-parent byte budget (in MB) for the broker's in-memory cache of
   * completed sub-agent result text. `0` = unlimited. */
  completed_cache_max_mb: number
  /** Optional per-agent overrides applied when veryagent-mcp spawns a subagent.
   * Keyed by `agent_type`. Missing entries mean "use agent defaults." */
  agent_defaults?: Partial<Record<AgentType, AgentDelegationDefaults>>
}


export async function getDelegationSettings(): Promise<DelegationSettings> {
  return getTransport().call("get_delegation_settings")
}


export async function setDelegationSettings(
  settings: DelegationSettings
): Promise<DelegationSettings> {
  return getTransport().call("set_delegation_settings", { settings })
}

// ─── Live feedback settings + submit ───────────────────────────────────

/** Mirror of Rust `FeedbackSettings`. */

export interface FeedbackSettings {
  enabled: boolean
}


export async function getFeedbackSettings(): Promise<FeedbackSettings> {
  return getTransport().call("get_feedback_settings")
}


export async function setFeedbackSettings(
  settings: FeedbackSettings
): Promise<FeedbackSettings> {
  return getTransport().call("set_feedback_settings", { settings })
}

/**
 * Submit a live-feedback note to a running connection (the `check_user_feedback`
 * steering path). Returns the stored note (it also arrives via the
 * `feedback_submitted` event). Rejects when no turn is in flight — callers
 * detect that with `isNoActiveTurnRejection` and fall back to a normal prompt.
 */

export async function submitSessionFeedback(
  connectionId: string,
  text: string
): Promise<FeedbackItem> {
  return getTransport().call("submit_session_feedback", {
    connectionId,
    text,
  })
}

// ─── Ask-user-question settings ────────────────────────────────────────────

/** Mirror of Rust `QuestionSettings` (default ON). */

export interface QuestionSettings {
  enabled: boolean
}


export async function getQuestionSettings(): Promise<QuestionSettings> {
  return getTransport().call("get_question_settings")
}


export async function setQuestionSettings(
  settings: QuestionSettings
): Promise<QuestionSettings> {
  return getTransport().call("set_question_settings", { settings })
}

// ─── Get-session-info settings ─────────────────────────────────────────────

/** Mirror of Rust `SessionInfoSettings` (default ON). */

export interface SessionInfoSettings {
  enabled: boolean
}


export async function getSessionInfoSettings(): Promise<SessionInfoSettings> {
  return getTransport().call("get_session_info_settings")
}


export async function setSessionInfoSettings(
  settings: SessionInfoSettings
): Promise<SessionInfoSettings> {
  return getTransport().call("set_session_info_settings", { settings })
}

/** Mirror of Rust `VisionBridgeConfigUpdate`. */

