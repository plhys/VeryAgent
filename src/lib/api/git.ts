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


export async function getGitBranch(path: string): Promise<string | null> {
  return getTransport().call("get_git_branch", { path })
}


export async function getGitHead(path: string): Promise<GitHeadInfo> {
  return getTransport().call("get_git_head", { path })
}


export async function gitInit(path: string): Promise<void> {
  return getTransport().call("git_init", { path })
}


export async function gitPull(
  path: string,
  credentials?: GitCredentials | null
): Promise<GitPullResult> {
  return getTransport().call("git_pull", {
    path,
    credentials: credentials ?? null,
  })
}


export async function gitStartPullMerge(
  path: string,
  upstreamCommit?: string | null
): Promise<void> {
  return getTransport().call("git_start_pull_merge", { path, upstreamCommit })
}


export async function gitHasMergeHead(path: string): Promise<boolean> {
  return getTransport().call("git_has_merge_head", { path })
}


export async function gitFetch(
  path: string,
  credentials?: GitCredentials | null
): Promise<string> {
  return getTransport().call("git_fetch", {
    path,
    credentials: credentials ?? null,
  })
}


export async function gitPushInfo(path: string): Promise<GitPushInfo> {
  return getTransport().call("git_push_info", { path })
}


export async function gitPush(
  path: string,
  remote?: string | null,
  credentials?: GitCredentials | null,
  folderId?: number | null
): Promise<GitPushResult> {
  return getTransport().call("git_push", {
    path,
    remote: remote ?? null,
    credentials: credentials ?? null,
    folderId: folderId ?? null,
  })
}


export async function gitNewBranch(
  path: string,
  branchName: string,
  startPoint?: string
): Promise<void> {
  return getTransport().call("git_new_branch", {
    path,
    branchName,
    startPoint: startPoint ?? null,
  })
}


export async function gitWorktreeAdd(
  path: string,
  branchName: string,
  worktreePath: string
): Promise<void> {
  return getTransport().call("git_worktree_add", {
    path,
    branchName,
    worktreePath,
  })
}


export async function gitCheckout(
  path: string,
  branchName: string
): Promise<void> {
  return getTransport().call("git_checkout", { path, branchName })
}


export async function gitListBranches(path: string): Promise<string[]> {
  return getTransport().call("git_list_branches", { path })
}


export async function gitListAllBranches(path: string): Promise<GitBranchList> {
  return getTransport().call("git_list_all_branches", { path })
}


export async function gitMerge(
  path: string,
  branchName: string
): Promise<GitMergeResult> {
  return getTransport().call("git_merge", { path, branchName })
}


export async function gitRebase(
  path: string,
  branchName: string
): Promise<GitRebaseResult> {
  return getTransport().call("git_rebase", { path, branchName })
}


export async function gitDeleteBranch(
  path: string,
  branchName: string,
  force: boolean = false
): Promise<string> {
  return getTransport().call("git_delete_branch", {
    path,
    branchName,
    force,
  })
}


export async function gitDeleteRemoteBranch(
  path: string,
  remote: string,
  branch: string,
  credentials?: GitCredentials | null
): Promise<void> {
  return getTransport().call("git_delete_remote_branch", {
    path,
    remote,
    branch,
    credentials: credentials ?? null,
  })
}


export async function gitListConflicts(path: string): Promise<string[]> {
  return getTransport().call("git_list_conflicts", { path })
}


export async function gitConflictFileVersions(
  path: string,
  file: string
): Promise<GitConflictFileVersions> {
  return getTransport().call("git_conflict_file_versions", { path, file })
}


export async function gitResolveConflict(
  path: string,
  file: string,
  content: string
): Promise<void> {
  return getTransport().call("git_resolve_conflict", { path, file, content })
}


export async function gitAbortOperation(
  path: string,
  operation: string
): Promise<void> {
  return getTransport().call("git_abort_operation", { path, operation })
}


export async function gitContinueOperation(
  path: string,
  operation: string
): Promise<void> {
  return getTransport().call("git_continue_operation", { path, operation })
}


export async function openMergeWindow(
  folderId: number,
  operation: string,
  upstreamCommit?: string | null
): Promise<void> {
  const locale = getCurrentEffectiveAppLocale()
  if (isDesktop()) {
    return getShellTransport().call("open_merge_window", {
      folderId,
      operation,
      upstreamCommit: upstreamCommit ?? null,
      locale,
      remoteConnectionId: getActiveRemoteConnectionId(),
    })
  }
  const result = await getTransport().call<{ path: string }>(
    "open_merge_window",
    {
      folderId,
      operation,
      upstreamCommit: upstreamCommit ?? null,
      locale,
    }
  )
  window.open(result.path, `merge-${folderId}`)
}


export async function openStashWindow(folderId: number): Promise<void> {
  const locale = getCurrentEffectiveAppLocale()
  if (isDesktop()) {
    return getShellTransport().call("open_stash_window", {
      folderId,
      locale,
      remoteConnectionId: getActiveRemoteConnectionId(),
    })
  }
  const result = await getTransport().call<{ path: string }>(
    "open_stash_window",
    { folderId, locale }
  )
  window.open(result.path, `stash-${folderId}`)
}


export async function openPushWindow(folderId: number): Promise<void> {
  const locale = getCurrentEffectiveAppLocale()
  if (isDesktop()) {
    return getShellTransport().call("open_push_window", {
      folderId,
      locale,
      remoteConnectionId: getActiveRemoteConnectionId(),
    })
  }
  const result = await getTransport().call<{ path: string }>(
    "open_push_window",
    { folderId, locale }
  )
  window.open(result.path, `push-${folderId}`)
}


export async function gitStashPush(
  path: string,
  message?: string,
  keepIndex?: boolean
): Promise<string> {
  return getTransport().call("git_stash_push", {
    path,
    message: message ?? null,
    keepIndex: keepIndex ?? false,
  })
}


export async function gitStashPop(
  path: string,
  stashRef?: string
): Promise<string> {
  return getTransport().call("git_stash_pop", {
    path,
    stashRef: stashRef ?? null,
  })
}


export async function gitStashList(path: string): Promise<GitStashEntry[]> {
  return getTransport().call("git_stash_list", { path })
}


export async function gitStashApply(
  path: string,
  stashRef: string
): Promise<string> {
  return getTransport().call("git_stash_apply", { path, stashRef })
}


export async function gitStashDrop(
  path: string,
  stashRef: string
): Promise<string> {
  return getTransport().call("git_stash_drop", { path, stashRef })
}


export async function gitStashClear(path: string): Promise<string> {
  return getTransport().call("git_stash_clear", { path })
}


export async function gitStashShow(
  path: string,
  stashRef: string
): Promise<GitStatusEntry[]> {
  return getTransport().call("git_stash_show", { path, stashRef })
}


export async function gitListRemotes(path: string): Promise<GitRemote[]> {
  return getTransport().call("git_list_remotes", { path })
}


export async function gitFetchRemote(
  path: string,
  name: string,
  credentials?: GitCredentials | null
): Promise<string> {
  return getTransport().call("git_fetch_remote", {
    path,
    name,
    credentials: credentials ?? null,
  })
}


export async function gitAddRemote(
  path: string,
  name: string,
  url: string
): Promise<void> {
  return getTransport().call("git_add_remote", { path, name, url })
}


export async function gitRemoveRemote(
  path: string,
  name: string
): Promise<void> {
  return getTransport().call("git_remove_remote", { path, name })
}


export async function gitSetRemoteUrl(
  path: string,
  name: string,
  url: string
): Promise<void> {
  return getTransport().call("git_set_remote_url", { path, name, url })
}


export async function gitStatus(
  path: string,
  showAllUntracked?: boolean
): Promise<GitStatusEntry[]> {
  return getTransport().call("git_status", {
    path,
    showAllUntracked: showAllUntracked ?? null,
  })
}


export async function gitDiff(path: string, file?: string): Promise<string> {
  return getTransport().call("git_diff", { path, file: file ?? null })
}


export async function gitDiffWithBranch(
  path: string,
  branch: string,
  file?: string
): Promise<string> {
  return getTransport().call("git_diff_with_branch", {
    path,
    branch,
    file: file ?? null,
  })
}


export async function gitShowDiff(
  path: string,
  commit: string,
  file?: string
): Promise<string> {
  return getTransport().call("git_show_diff", {
    path,
    commit,
    file: file ?? null,
  })
}


export async function gitShowFile(
  path: string,
  file: string,
  refName?: string
): Promise<string> {
  return getTransport().call("git_show_file", {
    path,
    file,
    refName: refName ?? null,
  })
}


export async function gitIsTracked(
  path: string,
  file: string
): Promise<boolean> {
  return getTransport().call("git_is_tracked", { path, file })
}


export async function gitCommit(
  path: string,
  message: string,
  files: string[],
  folderId?: number | null
): Promise<GitCommitResult> {
  return getTransport().call("git_commit", {
    path,
    message,
    files,
    folderId: folderId ?? null,
  })
}


export async function gitRollbackFile(
  path: string,
  file: string
): Promise<void> {
  return getTransport().call("git_rollback_file", { path, file })
}


export async function gitAddFiles(
  path: string,
  files: string[]
): Promise<void> {
  return getTransport().call("git_add_files", { path, files })
}

// Window management commands


export async function gitLog(
  path: string,
  limit?: number,
  branch?: string,
  remote?: string
): Promise<GitLogResult> {
  return getTransport().call("git_log", {
    path,
    limit: limit ?? null,
    branch: branch ?? null,
    remote: remote ?? null,
  })
}


export async function gitCommitBranches(
  path: string,
  commit: string
): Promise<string[]> {
  return getTransport().call("git_commit_branches", { path, commit })
}


export async function gitReset(
  path: string,
  commit: string,
  mode: GitResetMode
): Promise<void> {
  return getTransport().call("git_reset", { path, commit, mode })
}

// Terminal commands


