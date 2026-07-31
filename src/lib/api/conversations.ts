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


export async function listConversations(params?: {
  agent_type?: AgentType | null
  search?: string | null
  sort_by?: string | null
  folder_path?: string | null
}): Promise<ConversationSummary[]> {
  return getTransport().call("list_conversations", {
    agentType: params?.agent_type ?? null,
    search: params?.search ?? null,
    sortBy: params?.sort_by ?? null,
    folderPath: params?.folder_path ?? null,
  })
}


export async function getConversation(
  agentType: AgentType,
  conversationId: string
): Promise<ConversationDetail> {
  return getTransport().call("get_conversation", { agentType, conversationId })
}


export async function listFolders(): Promise<FolderInfo[]> {
  return getTransport().call("list_folders")
}


export async function getStats(): Promise<AgentStats> {
  return getTransport().call("get_stats")
}


export async function getSidebarData(): Promise<SidebarData> {
  return getTransport().call("get_sidebar_data")
}

// ACP commands


export async function loadFolderHistory(): Promise<FolderHistoryEntry[]> {
  return getTransport().call("load_folder_history")
}


export async function getFolder(folderId: number): Promise<FolderDetail> {
  return getTransport().call("get_folder", { folderId })
}


export async function listAllConversations(params?: {
  folder_ids?: number[] | null
  agent_type?: AgentType | null
  search?: string | null
  sort_by?: string | null
  status?: string | null
  include_children?: boolean | null
}): Promise<DbConversationSummary[]> {
  return getTransport().call("list_all_conversations", {
    folderIds: params?.folder_ids ?? null,
    agentType: params?.agent_type ?? null,
    search: params?.search ?? null,
    sortBy: params?.sort_by ?? null,
    status: params?.status ?? null,
    includeChildren: params?.include_children ?? null,
  })
}


export async function listChildConversations(
  parentConversationId: number
): Promise<DbConversationSummary[]> {
  return getTransport().call("list_child_conversations", {
    parentConversationId,
  })
}


export async function listOpenedTabs(): Promise<OpenedTabsSnapshot> {
  return getTransport().call("list_opened_tabs")
}


export async function saveOpenedTabs(
  items: OpenedTab[],
  expectedVersion: number,
  origin: string
): Promise<SaveTabsOutcome> {
  return getTransport().call("save_opened_tabs", {
    items,
    expectedVersion,
    origin,
  })
}


export async function listOpenFolderDetails(): Promise<FolderDetail[]> {
  return getTransport().call("list_open_folder_details")
}


export async function listAllFolderDetails(): Promise<FolderDetail[]> {
  return getTransport().call("list_all_folder_details")
}


export async function openFolderById(folderId: number): Promise<FolderDetail> {
  return getTransport().call("open_folder_by_id", { folderId })
}


export async function removeFolderFromWorkspace(
  folderId: number
): Promise<void> {
  return getTransport().call("remove_folder_from_workspace", { folderId })
}


export async function reorderFolders(ids: number[]): Promise<void> {
  return getTransport().call("reorder_folders", { ids })
}


export async function updateFolderColor(
  folderId: number,
  color: FolderThemeColor
): Promise<FolderDetail> {
  return getTransport().call("update_folder_color", { folderId, color })
}


export async function updateFolderDefaultAgent(
  folderId: number,
  defaultAgentType: AgentType | null
): Promise<FolderDetail> {
  return getTransport().call("update_folder_default_agent", {
    folderId,
    defaultAgentType,
  })
}


export async function importLocalConversations(
  folderId: number
): Promise<ImportResult> {
  return getTransport().call("import_local_conversations", { folderId })
}


export async function getFolderConversation(
  conversationId: number
): Promise<DbConversationDetail> {
  return getTransport().call("get_folder_conversation", { conversationId })
}


export async function removeFolderFromHistory(path: string): Promise<void> {
  return getTransport().call("remove_folder_from_history", { path })
}


export async function createFolderDirectory(path: string): Promise<void> {
  return getTransport().call("create_folder_directory", { path })
}


export async function cloneRepository(
  url: string,
  targetDir: string,
  credentials?: GitCredentials | null
): Promise<void> {
  return getTransport().call("clone_repository", {
    url,
    targetDir,
    credentials: credentials ?? null,
  })
}


export async function openFolder(path: string): Promise<FolderDetail> {
  return getTransport().call("open_folder", { path })
}

/**
 * Open a freshly created git worktree directory as a folder, recording the root
 * folder it descends from (`sourceFolderId` is the folder the worktree was
 * created from; the backend flattens to the root). Lets the worktree folder be
 * merged under its parent in the sidebar.
 */

export async function openWorktreeFolder(
  path: string,
  sourceFolderId: number
): Promise<FolderDetail> {
  return getTransport().call("open_worktree_folder", { path, sourceFolderId })
}

/**
 * Resolve where `branch` is checked out across the repo's worktrees. Returns the
 * canonical worktree path (or null if the branch isn't checked out anywhere) and
 * the registered folder id owning that path (or null for an external worktree).
 * Path matching is canonicalized on the host that runs git, so it is correct for
 * symlinked and remote-workspace paths the webview cannot resolve.
 */

export async function resolveWorktreeFolder(
  repoPath: string,
  branch: string
): Promise<WorktreeResolution> {
  return getTransport().call("resolve_worktree_folder", { repoPath, branch })
}


export async function openCommitWindow(folderId: number): Promise<void> {
  const locale = getCurrentEffectiveAppLocale()
  if (isDesktop()) {
    return getShellTransport().call("open_commit_window", {
      folderId,
      locale,
      remoteConnectionId: getActiveRemoteConnectionId(),
    })
  }
  const result = await getTransport().call<{ path: string }>(
    "open_commit_window",
    { folderId, locale }
  )
  window.open(result.path, `commit-${folderId}`)
}


export type SettingsSection =
  | "appearance"
  | "agents"
  | "mcp"
  | "skills"
  | "experts"
  | "science"
  | "office-tools"
  | "shortcuts"
  | "system"

interface OpenSettingsWindowOptions {
  agentType?: AgentType | null
}


export async function openSettingsWindow(
  section?: SettingsSection,
  options?: OpenSettingsWindowOptions
): Promise<void> {
  const locale = getCurrentEffectiveAppLocale()
  if (isDesktop()) {
    return getShellTransport().call("open_settings_window", {
      section: section ?? null,
      agentType: options?.agentType ?? null,
      locale,
      remoteConnectionId: getActiveRemoteConnectionId(),
    })
  }
  // Web mode: open in new window
  const result = await getTransport().call<{ path: string }>(
    "open_settings_window",
    {
      section: section ?? null,
      agentType: options?.agentType ?? null,
      locale,
    }
  )
  window.open(result.path, `settings-${section ?? "general"}`)
}


export async function openProjectBootWindow(source?: string): Promise<void> {
  if (isDesktop()) {
    return getShellTransport().call("open_project_boot_window", {
      source,
      locale: getCurrentEffectiveAppLocale(),
      remoteConnectionId: getActiveRemoteConnectionId(),
    })
  }
  if (typeof window !== "undefined") {
    window.open("/project-boot", "project-boot")
  }
}

// Cross-window handoff for the project launcher, which lives in its own
// window/tab and can't reach the workspace's React state directly. The
// backend upserts the folder and emits `folder://open-in-workspace` carrying
// the FolderDetail through the shared EventEmitter; the transport layer routes
// that to the right workspace window in every runtime (local Tauri bus, the
// server's WebSocket broadcaster for web, and the remote server's broadcaster
// for remote desktop), so only windows talking to this backend react. The
// workspace subscribes via WorkspaceOpenFolderListener.
export const FOLDER_OPEN_IN_WORKSPACE_EVENT = "folder://open-in-workspace"


export async function openFolderInWorkspace(
  path: string
): Promise<FolderDetail> {
  return getTransport().call("open_folder_in_workspace", { path })
}


export async function detectPackageManager(
  name: string
): Promise<PackageManagerInfo> {
  return getTransport().call("detect_package_manager", { name })
}


export async function createShadcnProject(params: {
  projectName: string
  template: string
  presetCode: string
  packageManager: string
  targetDir: string
}): Promise<string> {
  return getTransport().call("create_shadcn_project", {
    projectName: params.projectName,
    template: params.template,
    presetCode: params.presetCode,
    packageManager: params.packageManager,
    targetDir: params.targetDir,
  })
}

/**
 * Detect, per veryagent-supported agent, whether the HyperFrames skills are already
 * installed globally. Cheap filesystem check, so no long timeout is needed.
 */

export async function detectHyperframesSkills(): Promise<
  HyperframesSkillAgent[]
> {
  return getTransport().call(
    "detect_hyperframes_skills",
    {},
    { timeoutMs: 30_000 }
  )
}

/**
 * Install the HyperFrames agent skills globally (symlinked) for the given
 * agents. Clones from GitHub, so allow a few minutes. Re-running is idempotent
 * (acts as an update for agents that already have the skills).
 */

export async function installHyperframesSkills(
  agents: string[]
): Promise<void> {
  await getTransport().call(
    "install_hyperframes_skills",
    { agents },
    { timeoutMs: 600_000 }
  )
}


export async function createHyperframesProject(params: {
  projectName: string
  example: string
  resolution: string
  packageManager: string
  targetDir: string
}): Promise<string> {
  return getTransport().call(
    "create_hyperframes_project",
    {
      projectName: params.projectName,
      example: params.example,
      resolution: params.resolution,
      packageManager: params.packageManager,
      targetDir: params.targetDir,
    },
    { timeoutMs: 600_000 }
  )
}

// Conversation CRUD commands


export async function createConversation(
  folderId: number,
  agentType: AgentType,
  title?: string
): Promise<number> {
  return getTransport().call("create_conversation", {
    folderId,
    agentType,
    title: title ?? null,
  })
}

/**
 * Create a folderless "chat mode" conversation. The backend lazily creates a
 * dated per-conversation scratch dir and a dedicated hidden chat folder
 * backing it, then the conversation. Returns the new conversation id plus that
 * folder so the caller can seed `allFolders` (cwd / active-folder) immediately.
 */

export async function createChatConversation(
  agentType: AgentType,
  title?: string,
  // Reuse a scratch dir already minted by `createChatDir` (eager connect) so the
  // ACP cwd never moves across the first send; omit to let the backend mint one.
  existingDir?: string
): Promise<CreateChatConversationResult> {
  return getTransport().call("create_chat_conversation", {
    agentType,
    title: title ?? null,
    existingDir: existingDir ?? null,
  })
}

/**
 * Eagerly create a chat-mode scratch directory (filesystem only — no DB rows)
 * and return its path, so a chat draft can connect ACP at a real cwd the instant
 * "no-folder mode" is selected, before any first prompt.
 */

export async function createChatDir(): Promise<CreateChatDirResult> {
  return getTransport().call("create_chat_dir", {})
}


export async function updateConversationStatus(
  conversationId: number,
  status: string
): Promise<void> {
  return getTransport().call("update_conversation_status", {
    conversationId,
    status,
  })
}


export async function updateConversationTitle(
  conversationId: number,
  title: string
): Promise<void> {
  return getTransport().call("update_conversation_title", {
    conversationId,
    title,
  })
}


export async function updateConversationPinned(
  conversationId: number,
  pinned: boolean
): Promise<void> {
  return getTransport().call("update_conversation_pinned", {
    conversationId,
    pinned,
  })
}


export async function deleteConversation(
  conversationId: number
): Promise<void> {
  return getTransport().call("delete_conversation", { conversationId })
}

// Folder command management


export async function listFolderCommands(
  folderId: number
): Promise<FolderCommand[]> {
  return getTransport().call("list_folder_commands", { folderId })
}


export async function createFolderCommand(
  folderId: number,
  name: string,
  command: string
): Promise<FolderCommand> {
  return getTransport().call("create_folder_command", {
    folderId,
    name,
    command,
  })
}


export async function updateFolderCommand(
  id: number,
  name?: string,
  command?: string,
  sortOrder?: number
): Promise<FolderCommand> {
  return getTransport().call("update_folder_command", {
    id,
    name: name ?? null,
    command: command ?? null,
    sortOrder: sortOrder ?? null,
  })
}


export async function deleteFolderCommand(id: number): Promise<void> {
  return getTransport().call("delete_folder_command", { id })
}


export async function reorderFolderCommands(
  folderId: number,
  ids: number[]
): Promise<void> {
  return getTransport().call("reorder_folder_commands", { folderId, ids })
}


export async function bootstrapFolderCommandsFromPackageJson(
  folderId: number,
  folderPath: string
): Promise<FolderCommand[]> {
  return getTransport().call("bootstrap_folder_commands_from_package_json", {
    folderId,
    folderPath,
  })
}

// Quick message management


export async function quickMessagesList(): Promise<QuickMessage[]> {
  return getTransport().call("quick_messages_list")
}


export async function quickMessagesCreate(params: {
  title: string
  content: string
}): Promise<QuickMessage> {
  return getTransport().call("quick_messages_create", {
    title: params.title,
    content: params.content,
  })
}


export async function quickMessagesUpdate(params: {
  id: number
  title?: string
  content?: string
}): Promise<QuickMessage> {
  return getTransport().call("quick_messages_update", {
    id: params.id,
    title: params.title ?? null,
    content: params.content ?? null,
  })
}


export async function quickMessagesDelete(id: number): Promise<void> {
  return getTransport().call("quick_messages_delete", { id })
}


export async function quickMessagesReorder(ids: number[]): Promise<void> {
  return getTransport().call("quick_messages_reorder", { ids })
}

// Automations


export async function automationList(): Promise<Automation[]> {
  return getTransport().call("automation_list")
}


export async function automationGet(id: number): Promise<Automation> {
  return getTransport().call("automation_get", { id })
}


export async function automationRuns(
  automationId: number,
  limit = 100
): Promise<AutomationRun[]> {
  return getTransport().call("automation_runs", { automationId, limit })
}


export async function automationCreate(
  draft: AutomationDraft
): Promise<Automation> {
  return getTransport().call("automation_create", { draft })
}


export async function automationUpdate(
  id: number,
  draft: AutomationDraft
): Promise<Automation> {
  return getTransport().call("automation_update", { id, draft })
}


export async function automationSetEnabled(
  id: number,
  enabled: boolean
): Promise<Automation> {
  return getTransport().call("automation_set_enabled", { id, enabled })
}


export async function automationDelete(id: number): Promise<void> {
  return getTransport().call("automation_delete", { id })
}


export async function automationMarkSeen(): Promise<void> {
  return getTransport().call("automation_mark_seen")
}

/** Authoritative "next run" preview — same evaluator as the scheduler. Returns
 *  an ISO timestamp, or null if the cron has no future occurrence. */

export async function automationComputeNextRun(
  cron: string,
  timezone: string
): Promise<string | null> {
  return getTransport().call("automation_compute_next_run", { cron, timezone })
}

/** Fire an automation immediately, bypassing its schedule. Returns the run id. */

export async function automationRunNow(automationId: number): Promise<number> {
  return getTransport().call("automation_run_now", { automationId })
}

/** Cancel an in-flight (or clear a wedged) run. */

export async function automationCancelRun(runId: number): Promise<void> {
  return getTransport().call("automation_cancel_run", { runId })
}

// Directory browser (for web/server mode)


export async function createChatChannel(params: {
  name: string
  channelType: string
  configJson: string
  enabled: boolean
  dailyReportEnabled: boolean
  dailyReportTime?: string | null
}): Promise<ChatChannelInfo> {
  return getTransport().call("create_chat_channel", {
    name: params.name,
    channelType: params.channelType,
    configJson: params.configJson,
    enabled: params.enabled,
    dailyReportEnabled: params.dailyReportEnabled,
    dailyReportTime: params.dailyReportTime ?? null,
  })
}


