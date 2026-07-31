import { getTransport } from "../transport"
import type { AgentType } from "../types"

export interface BackupManifestEntry {
  path: string
  size: number
  sha256: string
}

export interface BackupManifest {
  formatVersion: number
  kind: string
  createdAt: string
  appVersion: string
  latestMigration: string
  runtime: string
  includesExternalTranscripts: boolean
  includesSecrets: boolean
  entries: BackupManifestEntry[]
}

export type BackupPhase =
  | "snapshotting"
  | "archiving"
  | "encrypting"
  | "decrypting"
  | "extracting"
  | "verifying"
  | "swapping"
  | "done"
  | "cancelled"
  | "error"

export interface BackupProgress {
  opId: string
  phase: BackupPhase
  processedBytes: number
  totalBytes: number | null
  currentPath?: string | null
  error?: string | null
}

export interface BackupPreview {
  encrypted: boolean
  needsPassphrase: boolean
  manifest?: BackupManifest | null
  compatible: boolean
  rejectReason?: string | null
}

export interface StagedRestore {
  stagingDir: string
  manifest: BackupManifest
  restoredExternalPath?: string | null
  skippedConflicts: string[]
}

/** Where (if anywhere) external agent transcripts are restored. */

export type ExternalRestoreMode =
  | { mode: "skip" }
  | { mode: "side_location" }
  | { mode: "original_locations"; on_conflict: "overwrite" | "skip_existing" }

export interface BackupExportOptions {
  includeExternalTranscripts: boolean
  passphrase?: string | null
}

/**
 * Subscribe to backup/restore progress. Works in both runtimes: the backend
 * emits through the unified event bridge (Tauri webview + WS broadcaster).
 */

export async function listenBackupProgress(
  handler: (event: BackupProgress) => void
): Promise<() => void> {
  return getTransport().subscribe<BackupProgress>("backup://progress", handler)
}

export async function cancelBackup(opId: string): Promise<boolean> {
  return getTransport().call<boolean>("backup_cancel", { opId })
}

/** Desktop export: native save dialog → write the archive to the chosen path. */

export async function exportBackupDesktop(
  opts: BackupExportOptions
): Promise<BackupManifest | null> {
  const { save } = await import("@tauri-apps/plugin-dialog")
  const encrypted = !!opts.passphrase
  const ext = encrypted ? "veryagentbak" : "veryagent.zip"
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
  const destPath = await save({
    defaultPath: `veryagent-backup-${stamp}.${ext}`,
    filters: [{ name: "VeryAgent backup", extensions: [ext] }],
  })
  if (!destPath) return null
  return getTransport().call<BackupManifest>("backup_create", {
    options: {
      includeExternalTranscripts: opts.includeExternalTranscripts,
      passphrase: opts.passphrase ?? null,
    },
    destPath,
  })
}

// Backup create/inspect/stage can legitimately run far longer than the
// default 60s web transport timeout (large archives, encrypted decrypt,
// extract+verify). Use a very generous client bound so the UI doesn't abort
// while the backend is still working (and possibly committing a restore).

const BACKUP_LONG_CALL_TIMEOUT_MS = 60 * 60_000

/** Web export: build server-side, then trigger a browser download via ticket. */

export async function exportBackupWeb(
  opts: BackupExportOptions
): Promise<void> {
  const ticket = await getTransport().call<{ url: string; filename: string }>(
    "backup_create_ticket",
    {
      includeExternalTranscripts: opts.includeExternalTranscripts,
      passphrase: opts.passphrase ?? null,
    },
    { timeoutMs: BACKUP_LONG_CALL_TIMEOUT_MS }
  )
  const a = document.createElement("a")
  a.href = `${window.location.origin}${ticket.url}`
  a.download = ticket.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Web restore step 1: upload the archive once; returns an opaque upload id. */

export async function inspectBackupDesktop(
  srcPath: string,
  passphrase?: string | null
): Promise<BackupPreview> {
  return getTransport().call<BackupPreview>("backup_inspect", {
    srcPath,
    passphrase: passphrase ?? null,
  })
}

/** Validate a backup (web: by upload id). */

export async function inspectBackupWeb(
  uploadId: string,
  passphrase?: string | null
): Promise<BackupPreview> {
  return getTransport().call<BackupPreview>(
    "backup_inspect",
    {
      uploadId,
      passphrase: passphrase ?? null,
    },
    { timeoutMs: BACKUP_LONG_CALL_TIMEOUT_MS }
  )
}

/** Stage a restore (desktop: by path). Applied on next app start. */

export async function stageRestoreDesktop(args: {
  srcPath: string
  passphrase?: string | null
  externalMode?: ExternalRestoreMode | null
}): Promise<StagedRestore> {
  return getTransport().call<StagedRestore>("backup_restore_stage", {
    srcPath: args.srcPath,
    passphrase: args.passphrase ?? null,
    externalMode: args.externalMode ?? null,
  })
}

export interface StageRestoreWebResult {
  needsRestart: boolean
  restartDelayMs: number
  staged: StagedRestore
}

/** Stage a restore (web: by upload id). Applied on next server start. */

export async function stageRestoreWeb(args: {
  uploadId: string
  passphrase?: string | null
  externalMode?: ExternalRestoreMode | null
}): Promise<StageRestoreWebResult> {
  return getTransport().call<StageRestoreWebResult>(
    "backup_restore_stage",
    {
      uploadId: args.uploadId,
      passphrase: args.passphrase ?? null,
      externalMode: args.externalMode ?? null,
    },
    { timeoutMs: BACKUP_LONG_CALL_TIMEOUT_MS }
  )
}

export interface ExternalConflict {
  agent: string
  archivePath: string
  targetPath: string
  targetSize?: number | null
}

/** Scan a backup for external transcripts whose live target already exists. */

export async function scanExternalConflictsDesktop(
  srcPath: string,
  passphrase?: string | null
): Promise<ExternalConflict[]> {
  return getTransport().call<ExternalConflict[]>(
    "backup_scan_external_conflicts",
    { srcPath, passphrase: passphrase ?? null }
  )
}

export async function scanExternalConflictsWeb(
  uploadId: string,
  passphrase?: string | null
): Promise<ExternalConflict[]> {
  return getTransport().call<ExternalConflict[]>(
    "backup_scan_external_conflicts",
    { uploadId, passphrase: passphrase ?? null },
    { timeoutMs: BACKUP_LONG_CALL_TIMEOUT_MS }
  )
}

// ── Conversation Summary ─────────────────────────────────────────────────────

export async function getPinnedSummaryEnabled(): Promise<boolean> {
  return getTransport().call("get_pinned_summary_enabled")
}

export async function setPinnedSummaryEnabled(enabled: boolean): Promise<void> {
  return getTransport().call("set_pinned_summary_enabled", { enabled })
}

export interface SummaryResult {
  summary: string
  model: string
}

export async function generateConversationSummary(
  conversationId: number,
  agentType?: AgentType
): Promise<SummaryResult> {
  const params: Record<string, unknown> = { conversationId }
  if (agentType) {
    params.agentType = agentType
  }
  return getTransport().call("generate_conversation_summary", params)
}
