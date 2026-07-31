import {
  getActiveRemoteConnectionId,
  getShellTransport,
  getTransport,
  isDesktop,
  isRemoteDesktopMode,
  notifyRemoteDesktopUnauthorized,
} from "../transport"
import { getVeryAgentToken } from "../transport/web-auth"
import { notifyWebUnauthorized } from "../transport/web-connection-store"
import { getCurrentEffectiveAppLocale } from "../i18n"
import { TurnBusyError, isTurnInProgressRejection } from "../turn-busy"
import type { FolderThemeColor } from "../theme-presets"
import type {
  AgentType,
  AgentDelegationDefaults,
  AgentOptionsSnapshot,
  Automation,
  AutomationRun,
  AutomationDraft,
  ConversationSummary,
  ConversationDetail,
  DbConversationDetail,
  FolderInfo,
  AgentStats,
  SidebarData,
  ConnectionInfo,
  ConversationConnectionInfo,
  LiveSessionSnapshot,
  FeedbackItem,
  QuestionAnswer,
  AcpAgentInfo,
  AcpAgentStatus,
  OpenClawGatewayDiscovery,
  OpenClawGatewayEnsureResult,
  AgentSkillScope,
  AgentSkillLayout,
  AgentSkillItem,
  AgentSkillsListResult,
  AgentSkillContent,
  ExpertListItem,
  ExpertInstallStatus,
  ExpertLinkState,
  LinkOp,
  LinkOpResult,
  ScienceListItem,
  FolderHistoryEntry,
  FolderDetail,
  CreateChatConversationResult,
  CreateChatDirResult,
  WorktreeResolution,
  DbConversationSummary,
  ImportResult,
  OpenedTab,
  OpenedTabsSnapshot,
  SaveTabsOutcome,
  GitStatusEntry,
  GitBranchList,
  GitHeadInfo,
  GitPullResult,
  GitPushResult,
  GitPushInfo,
  GitMergeResult,
  GitRebaseResult,
  GitResetMode,
  GitConflictFileVersions,
  GitCommitResult,
  GitRemote,
  GitStashEntry,
  PreflightResult,
  FolderCommand,
  TerminalInfo,
  PromptInputBlock,
  FileTreeNode,
  DirectoryEntry,
  DirectoryItem,
  UploadAttachmentResult,
  FilePreviewContent,
  FileEditContent,
  FileSaveResult,
  WorkspaceSnapshotResponse,
  GitLogResult,
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
  GitCredentials,
  GitDetectResult,
  PackageManagerInfo,
  HyperframesSkillAgent,
  GitSettings,
  GitHubAccountsSettings,
  GitHubTokenValidation,
  McpAppType,
  LocalMcpServer,
  McpMarketplaceProvider,
  McpMarketplaceItem,
  McpMarketplaceServerDetail,
  ChatChannelInfo,
  ChannelStatusInfo,
  ChatChannelMessageLog,
  WebhookConfig,
  ModelProviderInfo,
  ProviderModelItem,
  UpdateModelProviderResult,
  PluginCheckSummary,
  OpenCodeCatalogProvider,
  QuickMessage,
  OfficecliInfo,
  OfficecliSkill,
  SkillSyncReport,
} from "../types"


export async function acpListAgents(): Promise<AcpAgentInfo[]> {
  return getTransport().call("acp_list_agents")
}


export async function acpGetAgentStatus(
  agentType: AgentType
): Promise<AcpAgentStatus> {
  return getTransport().call("acp_get_agent_status", { agentType })
}


export async function acpClearBinaryCache(agentType: AgentType): Promise<void> {
  return getTransport().call("acp_clear_binary_cache", { agentType })
}


export async function acpDownloadAgentBinary(
  agentType: AgentType,
  taskId: string,
  version?: string | null
): Promise<void> {
  return getTransport().call("acp_download_agent_binary", {
    agentType,
    version: version ?? null,
    taskId,
  })
}


export async function acpInstallUvTool(taskId: string): Promise<void> {
  // uv install downloads + extracts the toolchain from GitHub; allow well
  // beyond the default 60s web-call timeout so slow networks don't surface a
  // spurious timeout while the backend is still streaming progress.
  return getTransport().call(
    "acp_install_uv_tool",
    { taskId },
    { timeoutMs: 600_000 }
  )
}


export async function acpDetectAgentLocalVersion(
  agentType: AgentType
): Promise<string | null> {
  return getTransport().call("acp_detect_agent_local_version", { agentType })
}


export async function acpPrepareNpxAgent(
  agentType: AgentType,
  registryVersion: string | null | undefined,
  taskId: string,
  cleanFirst: boolean = false,
  version?: string | null
): Promise<string> {
  return getTransport().call("acp_prepare_npx_agent", {
    agentType,
    registryVersion: registryVersion ?? null,
    version: version ?? null,
    cleanFirst,
    taskId,
  })
}


export async function acpUninstallAgent(
  agentType: AgentType,
  taskId: string
): Promise<void> {
  return getTransport().call("acp_uninstall_agent", { agentType, taskId })
}


export async function acpUpdateAgentPreferences(
  agentType: AgentType,
  params: {
    enabled: boolean
    env: Record<string, string>
    config_json?: string | null
    opencode_auth_json?: string | null
    codex_auth_json?: string | null
    codex_config_toml?: string | null
  }
): Promise<number> {
  return getTransport().call("acp_update_agent_preferences", {
    agentType,
    enabled: params.enabled,
    env: params.env,
    configJson: params.config_json ?? null,
    opencodeAuthJson: params.opencode_auth_json ?? null,
    codexAuthJson: params.codex_auth_json ?? null,
    codexConfigToml: params.codex_config_toml ?? null,
  })
}

/** Returns the number of running sessions left on stale config by this save
 *  (for the settings-side "N sessions need restart" toast). */

export async function acpInstallPiBinary(taskId: string): Promise<void> {
  return getTransport().call(
    "acp_install_pi_binary",
    { taskId },
    { timeoutMs: 600_000 }
  )
}

/** Uninstall the global `pi` binary. Streams on `app://agent-install` too. */

export async function acpUninstallPiBinary(taskId: string): Promise<void> {
  return getTransport().call("acp_uninstall_pi_binary", { taskId })
}

/**
 * Launch Hermes's interactive setup in the OS terminal (desktop only). `kind`
 * picks the flow; the backend constructs the exact command from the registry
 * recipe (no arbitrary shell text crosses the boundary).
 */

export async function acpOpenHermesSetupTerminal(
  kind: "setup" | "model"
): Promise<void> {
  return getTransport().call("acp_open_hermes_setup_terminal", { kind })
}

/** Ensure ~/.hermes exists and reveal it in the system file manager (desktop). */

export async function acpRevealHermesHome(): Promise<void> {
  return getTransport().call("acp_reveal_hermes_home", {})
}


export async function acpReorderAgents(agentTypes: AgentType[]): Promise<void> {
  return getTransport().call("acp_reorder_agents", { agentTypes })
}


export async function codexRequestDeviceCode(): Promise<{
  userCode: string
  verificationUrl: string
  deviceAuthId: string
  interval: number
}> {
  return getTransport().call("codex_request_device_code", {})
}


export async function codexPollDeviceCode(params: {
  deviceAuthId: string
  userCode: string
}): Promise<{
  status: "pending" | "success" | "error"
  message?: string
  idToken?: string
  accessToken?: string
  refreshToken?: string
  accountId?: string
}> {
  return getTransport().call("codex_poll_device_code", {
    deviceAuthId: params.deviceAuthId,
    userCode: params.userCode,
  })
}


export async function acpPreflight(
  agentType: AgentType,
  forceRefresh?: boolean
): Promise<PreflightResult> {
  return getTransport().call("acp_preflight", {
    agentType,
    forceRefresh: forceRefresh ?? null,
  })
}


export async function opencodeListPlugins(): Promise<PluginCheckSummary> {
  return getTransport().call("opencode_list_plugins", {})
}


export async function opencodeProviderCatalog(
  forceRefresh?: boolean
): Promise<OpenCodeCatalogProvider[]> {
  return getTransport().call("opencode_provider_catalog", {
    forceRefresh: forceRefresh ?? null,
  })
}


export async function opencodeInstallPlugins(
  taskId: string,
  names?: string[] | null
): Promise<void> {
  return getTransport().call("opencode_install_plugins", {
    names: names ?? null,
    taskId,
  })
}


export async function opencodeUninstallPlugin(
  name: string
): Promise<PluginCheckSummary> {
  return getTransport().call("opencode_uninstall_plugin", { name })
}


export async function acpListAgentSkills(params: {
  agentType: AgentType
  workspacePath?: string | null
}): Promise<AgentSkillsListResult> {
  return getTransport().call("acp_list_agent_skills", {
    agentType: params.agentType,
    workspacePath: params.workspacePath ?? null,
  })
}


export async function acpReadAgentSkill(params: {
  agentType: AgentType
  scope: AgentSkillScope
  skillId: string
  workspacePath?: string | null
}): Promise<AgentSkillContent> {
  return getTransport().call("acp_read_agent_skill", {
    agentType: params.agentType,
    scope: params.scope,
    skillId: params.skillId,
    workspacePath: params.workspacePath ?? null,
  })
}


export async function acpSaveAgentSkill(params: {
  agentType: AgentType
  scope: AgentSkillScope
  skillId: string
  content: string
  workspacePath?: string | null
  layout?: AgentSkillLayout | null
}): Promise<AgentSkillItem> {
  return getTransport().call("acp_save_agent_skill", {
    agentType: params.agentType,
    scope: params.scope,
    skillId: params.skillId,
    content: params.content,
    workspacePath: params.workspacePath ?? null,
    layout: params.layout ?? null,
  })
}


export async function acpDeleteAgentSkill(params: {
  agentType: AgentType
  scope: AgentSkillScope
  skillId: string
  workspacePath?: string | null
}): Promise<void> {
  return getTransport().call("acp_delete_agent_skill", {
    agentType: params.agentType,
    scope: params.scope,
    skillId: params.skillId,
    workspacePath: params.workspacePath ?? null,
  })
}

// ─── Experts (built-in expert skills) ───────────────────────────────────


export async function expertsList(): Promise<ExpertListItem[]> {
  return getTransport().call("experts_list")
}


export async function expertsGetInstallStatus(
  expertId: string
): Promise<ExpertInstallStatus[]> {
  return getTransport().call("experts_get_install_status", { expertId })
}

/** One round-trip snapshot of every (expert, agent) link state for the matrix. */

export async function expertsListAllInstallStatuses(): Promise<
  ExpertInstallStatus[]
> {
  const result = (await getTransport().call(
    "experts_list_all_install_statuses"
  )) as ExpertInstallStatus[]
  // 后端序列化为 "linked_to_app"（linked_to_veryagent 为旧版兼容名），前端统一用
  // "linked_to_veryagent" —— 保留后端返回的真实状态，不能覆盖成统一的值，
  // 否则矩阵显示与文件系统脱节、toggleCell 会走错启用/禁用分支。
  return result.map((item) => ({
    ...item,
    state:
      item.state === ("linked_to_app" as ExpertLinkState) ||
      item.state === ("linked_to_veryagent" as ExpertLinkState)
        ? ("linked_to_veryagent" as const)
        : item.state,
  }))
}

/** Apply a batch of enable/disable ops; returns one result per op. */

export async function expertsApplyLinks(
  ops: LinkOp[]
): Promise<LinkOpResult[]> {
  return getTransport().call("experts_apply_links", { ops })
}


export async function expertsLinkToAgent(params: {
  expertId: string
  agentType: AgentType
}): Promise<ExpertInstallStatus> {
  return getTransport().call("experts_link_to_agent", {
    expertId: params.expertId,
    agentType: params.agentType,
  })
}


export async function expertsUnlinkFromAgent(params: {
  expertId: string
  agentType: AgentType
}): Promise<void> {
  return getTransport().call("experts_unlink_from_agent", {
    expertId: params.expertId,
    agentType: params.agentType,
  })
}


export async function expertsReadContent(expertId: string): Promise<string> {
  return getTransport().call("experts_read_content", { expertId })
}


export async function expertsOpenCentralDir(): Promise<string> {
  return getTransport().call("experts_open_central_dir")
}

// ─── Science (built-in scientific-research skills) ──────────────────────
// Link statuses reuse the Expert* DTOs (like office tools do): the
// `expertId` field carries the science skill id.


export async function scienceList(): Promise<ScienceListItem[]> {
  return getTransport().call("science_list")
}


export async function scienceGetInstallStatus(
  skillId: string
): Promise<ExpertInstallStatus[]> {
  return getTransport().call("science_get_install_status", { skillId })
}

/** One round-trip snapshot of every (science skill, agent) link state. */

export async function scienceListAllInstallStatuses(): Promise<
  ExpertInstallStatus[]
> {
  const result = (await getTransport().call(
    "science_list_all_install_statuses"
  )) as ExpertInstallStatus[]
  // Same state normalization as experts: backend may serialize as
  // "linked_to_app" or "linked_to_veryagent", frontend uses "linked_to_veryagent".
  return result.map((item) => ({
    ...item,
    state:
      item.state === ("linked_to_app" as ExpertLinkState) ||
      item.state === ("linked_to_veryagent" as ExpertLinkState)
        ? ("linked_to_veryagent" as const)
        : item.state,
  }))
}

/** Apply a batch of enable/disable ops; returns one result per op. */

export async function scienceApplyLinks(
  ops: LinkOp[]
): Promise<LinkOpResult[]> {
  return getTransport().call("science_apply_links", { ops })
}


export async function scienceLinkToAgent(params: {
  skillId: string
  agentType: AgentType
}): Promise<ExpertInstallStatus> {
  return getTransport().call("science_link_to_agent", {
    skillId: params.skillId,
    agentType: params.agentType,
  })
}


export async function scienceUnlinkFromAgent(params: {
  skillId: string
  agentType: AgentType
}): Promise<void> {
  return getTransport().call("science_unlink_from_agent", {
    skillId: params.skillId,
    agentType: params.agentType,
  })
}


export async function scienceReadContent(skillId: string): Promise<string> {
  return getTransport().call("science_read_content", { skillId })
}


export async function scienceOpenCentralDir(): Promise<string> {
  return getTransport().call("science_open_central_dir")
}

// ─── Office tools ───


export async function officecliDetect(): Promise<OfficecliInfo> {
  return getTransport().call("officecli_detect")
}


export async function officecliInstall(taskId: string): Promise<OfficecliInfo> {
  // The vendor installer downloads + extracts a multi-MB binary; allow well
  // beyond the default 60s web-call timeout so slow networks don't surface a
  // spurious timeout while progress is still streaming. Sits 30s ABOVE the
  // backend's own 600s deadline so the backend's structured timeout error wins
  // the race instead of a generic transport abort. `taskId` correlates the
  // `app://officecli-install` stream the settings page subscribes to.
  return getTransport().call(
    "officecli_install",
    { taskId },
    { timeoutMs: 630_000 }
  )
}


export async function officecliUninstall(): Promise<OfficecliInfo> {
  return getTransport().call("officecli_uninstall")
}


export async function officecliListSkills(): Promise<OfficecliSkill[]> {
  return getTransport().call("officecli_list_skills")
}


export async function officecliSyncSkills(): Promise<SkillSyncReport> {
  return getTransport().call("officecli_sync_skills")
}


export async function officecliSkillLinkToAgent(params: {
  skillId: string
  agentType: AgentType
}): Promise<ExpertInstallStatus> {
  return getTransport().call("officecli_skill_link_to_agent", params)
}


export async function officecliSkillUnlinkFromAgent(params: {
  skillId: string
  agentType: AgentType
}): Promise<void> {
  return getTransport().call("officecli_skill_unlink_from_agent", params)
}


export async function officecliSkillGetInstallStatus(
  skillId: string
): Promise<ExpertInstallStatus[]> {
  return getTransport().call("officecli_skill_get_install_status", { skillId })
}

/** One round-trip snapshot of every (skill, agent) link state for the matrix. */

export async function officecliSkillListAllInstallStatuses(): Promise<
  ExpertInstallStatus[]
> {
  const result = (await getTransport().call(
    "officecli_skill_list_all_install_statuses"
  )) as ExpertInstallStatus[]
  // 同 expertsListAllInstallStatuses：只做命名映射，保留真实状态。
  // 同时兼容新版 "linked_to_app" 和旧版 "linked_to_veryagent" 序列化名。
  return result.map((item) => ({
    ...item,
    state:
      item.state === ("linked_to_app" as ExpertLinkState) ||
      item.state === ("linked_to_veryagent" as ExpertLinkState)
        ? ("linked_to_veryagent" as const)
        : item.state,
  }))
}

/** Apply a batch of enable/disable ops; returns one result per op. */

export async function officecliSkillApplyLinks(
  ops: LinkOp[]
): Promise<LinkOpResult[]> {
  return getTransport().call("officecli_skill_apply_links", { ops })
}


export async function officecliSkillReadContent(
  skillId: string
): Promise<string> {
  return getTransport().call("officecli_skill_read_content", { skillId })
}

/**
 * Render an office file (.docx/.xlsx/.pptx) to self-contained HTML via the
 * OfficeCLI backend, for the in-app preview. `path` is relative to `rootPath`.
 */

export async function officecliRenderHtml(
  rootPath: string,
  path: string
): Promise<string> {
  return getTransport().call("officecli_render_html", { rootPath, path })
}

/**
 * Start (or share, by ref-count) a long-lived `officecli watch` preview server
 * for an office file and return its loopback `port` plus a per-watch `cap`
 * capability. `path` is relative to `rootPath`. Live refresh is driven by
 * officecli's own SSE channel, so the preview no longer re-reads (and locks)
 * the file the way the one-shot {@link officecliRenderHtml} did.
 *
 * `cap` is only used by web/server mode, where the iframe loads the preview
 * through the `/api/office-watch-proxy/{port}` reverse proxy and authenticates
 * with `?cap=` (the master token never enters the iframe). Desktop ignores it.
 */

export async function startOfficeWatch(
  rootPath: string,
  path: string
): Promise<{ port: number; cap: string }> {
  return getTransport().call("start_office_watch", { rootPath, path })
}

/** Release one reference to an office file's watch preview server. */

export async function stopOfficeWatch(
  rootPath: string,
  path: string
): Promise<void> {
  return getTransport().call("stop_office_watch", { rootPath, path })
}


