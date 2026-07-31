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


export async function listModelProviders(): Promise<ModelProviderInfo[]> {
  return getTransport().call("list_model_providers")
}


export async function createModelProvider(params: {
  name: string
  apiUrl: string
  apiKey: string
}): Promise<ModelProviderInfo> {
  return getTransport().call("create_model_provider", {
    name: params.name,
    apiUrl: params.apiUrl,
    apiKey: params.apiKey,
  })
}


export async function updateModelProvider(params: {
  id: number
  name?: string | null
  apiUrl?: string | null
  apiKey?: string | null
}): Promise<UpdateModelProviderResult> {
  return getTransport().call("update_model_provider", {
    id: params.id,
    name: params.name ?? null,
    apiUrl: params.apiUrl ?? null,
    apiKey: params.apiKey ?? null,
  })
}


export async function deleteModelProvider(id: number): Promise<void> {
  return getTransport().call("delete_model_provider", { id })
}

/**
 * List models a saved provider can serve (GET `<api_url>/models` with its key).
 * Used by agent settings after a model provider is selected.
 */

export async function fetchModelProviderModels(
  id: number
): Promise<ProviderModelItem[]> {
  return getTransport().call("fetch_provider_models", { id })
}

// ─── Delegation settings ───────────────────────────────────────────────


