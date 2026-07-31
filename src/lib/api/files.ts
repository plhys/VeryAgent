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
import type {
  FileTreeNode,
  DirectoryEntry,
  DirectoryItem,
  UploadAttachmentResult,
  FilePreviewContent,
  FileEditContent,
  FileSaveResult,
  WorkspaceSnapshotResponse,
} from "../types"

export async function getHomeDirectory(): Promise<string> {
  return getTransport().call("get_home_directory")
}

export async function listDirectoryEntries(
  path: string
): Promise<DirectoryEntry[]> {
  return getTransport().call("list_directory_entries", { path })
}

export async function listDirectoryWithFiles(
  path: string
): Promise<DirectoryItem[]> {
  return getTransport().call("list_directory_with_files", { path })
}

// Hard ceiling for a single attachment, kept in lockstep with the server's
// `UPLOAD_MAX_BYTES`. Aligned with axum's default multipart body limit (and
// with the fact that anything larger won't fit a model context anyway).
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024

// `btoa` only accepts a binary string, and `String.fromCharCode(...bytes)`
// hits the call-stack limit somewhere around a few hundred KB. Chunk the
// buffer so a 2 MB upload encodes without blowing the stack.

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize) as unknown as number[]
    binary += String.fromCharCode.apply(null, slice)
  }
  return btoa(binary)
}

// i18n_key values the Rust upload layer stamps via `with_i18n` and that
// the frontend branches on. MUST stay in lockstep with the Rust
// constants `UPLOAD_I18N_KEY_TOO_LARGE` / `UPLOAD_I18N_KEY_NOT_A_FILE`
// in `src-tauri/src/app_error.rs`. If either side renames the literal,
// the Rust unit test
// `commands::remote_proxy::tests::upload_i18n_keys_have_expected_values`
// fails — that's the CI tripwire keeping the two languages aligned.
export const UPLOAD_I18N_KEY_TOO_LARGE = "errors.upload.tooLarge"
export const UPLOAD_I18N_KEY_NOT_A_FILE = "errors.upload.notAFile"
export const UPLOAD_I18N_KEY_QUOTA_EXCEEDED = "errors.upload.quotaExceeded"

// Structured error thrown by the upload functions when an attachment
// would be empty (0 bytes). Callers should recognize it and silently
// skip — attaching a zero-byte ResourceLink would be a no-op for the
// agent and a confusing chip in the UI. Modeled as a real `Error`
// subclass so it carries a proper stack trace through async pipelines
// (a bare object literal would lose that), and so existing `instanceof
// Error` catch-rendering in the UI doesn't see an undefined `message`.
//
// The `code` field is preserved for the legacy duck-type check path —
// any callers still inspecting `.code === UPLOAD_ERROR_EMPTY` continue
// to work, but new code should rely on `isEmptyAttachmentError` or
// `instanceof EmptyAttachmentError`.
export const UPLOAD_ERROR_EMPTY = "attachment_empty"

export class EmptyAttachmentError extends Error {
  readonly code = UPLOAD_ERROR_EMPTY
  readonly fileName: string

  constructor(fileName: string) {
    super(`Empty file skipped: ${fileName}`)
    this.name = "EmptyAttachmentError"
    this.fileName = fileName
  }
}

export function isEmptyAttachmentError(err: unknown): boolean {
  if (err instanceof EmptyAttachmentError) return true
  // Tolerate the older bare-object shape so anything thrown through an
  // IPC boundary (which strips the class identity) still gets caught.
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === UPLOAD_ERROR_EMPTY
  )
}

// Upload a single attachment to the server.
//
// Web mode: streams the file via multipart/form-data to the same origin the
// page was served from. Desktop + remote workspace: routes through the Rust
// `remote_upload_attachment` command, because the webview's `fetch` can't
// hit a plain `http://` remote (mixed-content rules block secure-context
// requests). Returns the server-side absolute path so the caller can attach
// it as a `file://` ResourceLink — identical shape on both transports.

export async function uploadAttachment(
  file: File,
  sessionId?: string | null
): Promise<UploadAttachmentResult> {
  if (file.size === 0) {
    // Skip empty files at the entry — both the web and remote-desktop
    // transports would otherwise dutifully POST a zero-byte multipart part
    // (the server records it under `~/.veryagent/uploads/<bucket>/...`), and
    // we'd attach a ResourceLink to an empty file. Throw the sentinel and
    // let the pool's catch block log + continue.
    throw new EmptyAttachmentError(file.name)
  }
  const remoteId = getActiveRemoteConnectionId()
  if (isDesktop() && remoteId !== null) {
    const buf = await file.arrayBuffer()
    // `getShellTransport()` resolves to the local Tauri transport even when
    // a `RemoteDesktopTransport` is configured — we deliberately want the
    // local IPC here, not the proxy, because `remote_upload_attachment`
    // lives on this desktop binary.
    return getShellTransport().call<UploadAttachmentResult>(
      "remote_upload_attachment",
      {
        connectionId: remoteId,
        fileName: file.name,
        mimeType: file.type || null,
        sessionId: sessionId ?? null,
        dataBase64: arrayBufferToBase64(buf),
      }
    )
  }

  const token = getVeryAgentToken()
  const form = new FormData()
  form.append("file", file, file.name)
  if (sessionId) form.append("session_id", sessionId)

  const res = await fetch(`${window.location.origin}/api/upload_attachment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (res.status === 401) {
    notifyWebUnauthorized()
    throw new Error("Unauthorized")
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({
      code: "network_error",
      message: `HTTP ${res.status}`,
    }))
    throw err
  }
  return res.json()
}

// Upload a file picked from the desktop machine's filesystem to the remote
// veryagent-server bound to the current window. The Tauri-native drag-drop event
// hands us OS paths (not `File` objects), so we read the bytes via Rust,
// then reuse the same `remote_upload_attachment` channel. Only callable from
// a window that has a remote workspace attached; non-remote callers should
// continue to use `appendResourceAttachments` with the local path directly.

export async function uploadLocalPathToRemote(
  path: string,
  sessionId?: string | null
): Promise<UploadAttachmentResult> {
  const remoteId = getActiveRemoteConnectionId()
  if (remoteId === null) {
    throw new Error(
      "uploadLocalPathToRemote requires an active remote workspace"
    )
  }
  const shell = getShellTransport()
  const file = await shell.call<{
    fileName: string
    mimeType: string | null
    size: number
    dataBase64: string
  }>("read_local_file_for_upload", { path })
  if (file.size === 0) {
    // Mirror the `uploadAttachment` empty-file guard. The Rust side
    // already read the bytes, so we've paid the cost — drop on the
    // floor here rather than send a zero-byte multipart upstream.
    throw new EmptyAttachmentError(file.fileName)
  }
  return shell.call<UploadAttachmentResult>("remote_upload_attachment", {
    connectionId: remoteId,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sessionId: sessionId ?? null,
    dataBase64: file.dataBase64,
  })
}

// ─── Workspace file upload / download ───
//
// Issue #179: in server mode the user has no native file dialog, so the
// file-tree context menu offers explicit upload + download actions
// against these endpoints. The local desktop build (no remote) uses OS
// dialogs instead, so these helpers throw there. A remote-desktop
// window is a Tauri runtime but its file ops must target the remote
// host — it goes through the `remote_*_workspace_*` proxy commands.

export interface UploadWorkspaceFileResult {
  path: string
  name: string
  size: number
}

/**
 * Returns true when the current window can drive these helpers. Both
 * pure-web mode and remote-desktop mode qualify; only a local-desktop
 * Tauri window (no remote binding) is rejected, because it has its own
 * native file dialogs and these helpers would just be the wrong tool.
 */

function isWorkspaceFileApiAvailable(): boolean {
  return !isDesktop() || isRemoteDesktopMode()
}

function assertWorkspaceFileApiAvailable(action: string): void {
  if (!isWorkspaceFileApiAvailable()) {
    throw new Error(
      `${action} is not available in local desktop mode; use the OS file dialogs instead.`
    )
  }
}

async function workspaceFileFetch(
  endpoint: string,
  body: BodyInit,
  isMultipart: boolean
): Promise<Response> {
  const token = getVeryAgentToken()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (!isMultipart) {
    headers["Content-Type"] = "application/json"
  }
  const res = await fetch(`${window.location.origin}/api/${endpoint}`, {
    method: "POST",
    headers,
    body,
  })
  if (res.status === 401) {
    notifyWebUnauthorized()
    throw new Error("Unauthorized")
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({
      code: "network_error",
      message: `HTTP ${res.status}`,
    }))
    throw err
  }
  return res
}

export interface UploadWorkspaceFileArgs {
  rootPath: string
  targetPath: string
  file: File
  relativePath?: string | null
  signal?: AbortSignal
  /**
   * Byte-level progress callback fired on the request body as the
   * browser uploads it. `total` may equal 0 on streams where the size
   * is not pre-computable (rare for `File` objects but possible for
   * `Blob` slices) — callers should treat 0 as "unknown" rather than
   * "complete".
   */
  onProgress?: (loaded: number, total: number) => void
}

/**
 * Upload one workspace file. Two transports:
 *
 *   - **Web** — `XMLHttpRequest` direct to `/api/upload_workspace_file`,
 *     so we get byte-level upload progress and `AbortSignal` honoring.
 *   - **Remote desktop** — uses `uploadWorkspaceLocalPathsToRemote` with
 *     native file paths. Browser `File` objects are intentionally rejected
 *     there because Tauri IPC is not a streaming binary transport.
 *
 * Empty files are allowed: a workspace legitimately contains zero-byte
 * placeholders (`.gitkeep`, `__init__.py`). The chat-attachment uploader
 * still rejects them because feeding nothing to an LLM is meaningless,
 * but here we forward whatever the user picked.
 */

export async function uploadWorkspaceFile(
  args: UploadWorkspaceFileArgs
): Promise<UploadWorkspaceFileResult> {
  assertWorkspaceFileApiAvailable("uploadWorkspaceFile")

  if (isRemoteDesktopMode()) {
    throw new Error(
      "uploadWorkspaceFile requires browser File input; use uploadWorkspaceLocalPathsToRemote in remote desktop mode"
    )
  }

  return new Promise<UploadWorkspaceFileResult>((resolve, reject) => {
    const token = getVeryAgentToken()
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${window.location.origin}/api/upload_workspace_file`)
    xhr.setRequestHeader("Authorization", `Bearer ${token}`)

    if (args.onProgress) {
      const onProgress = args.onProgress
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded, event.total)
        }
      }
    }

    xhr.onload = () => {
      if (xhr.status === 401) {
        notifyWebUnauthorized()
        reject(new Error("Unauthorized"))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        let err: unknown
        try {
          err = JSON.parse(xhr.responseText) as unknown
        } catch {
          err = {
            code: "network_error",
            message: `HTTP ${xhr.status}`,
          }
        }
        reject(err)
        return
      }
      try {
        resolve(JSON.parse(xhr.responseText) as UploadWorkspaceFileResult)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"))

    // Wire the AbortSignal. The listener is removed on `loadend` so a
    // long-lived controller shared across many sequential uploads
    // doesn't leak listeners (the parent XHR will have been GC'd
    // anyway, but the listener kept a strong reference until then).
    if (args.signal) {
      if (args.signal.aborted) {
        xhr.abort()
        return
      }
      const signal = args.signal
      const onAbort = () => xhr.abort()
      signal.addEventListener("abort", onAbort, { once: true })
      xhr.addEventListener("loadend", () => {
        signal.removeEventListener("abort", onAbort)
      })
    }

    // Order matters: the backend reads text fields before the `file`
    // stream so it can resolve the destination before any bytes land.
    const form = new FormData()
    form.append("root_path", args.rootPath)
    form.append("target_path", args.targetPath)
    if (args.relativePath) {
      form.append("relative_path", args.relativePath)
    }
    form.append("file", args.file, args.file.name)
    xhr.send(form)
  })
}

export interface RemoteWorkspaceUploadPathEntry {
  localPath: string
  relativePath?: string | null
}

export interface RemoteWorkspaceUploadPathsResult {
  transferId: string
  files: UploadWorkspaceFileResult[]
  bytes: number
}

export async function uploadWorkspaceLocalPathsToRemote(args: {
  rootPath: string
  targetPath: string
  entries: RemoteWorkspaceUploadPathEntry[]
}): Promise<RemoteWorkspaceUploadPathsResult> {
  const connectionId = getActiveRemoteConnectionId()
  if (connectionId === null) {
    throw new Error(
      "uploadWorkspaceLocalPathsToRemote: no active remote connection"
    )
  }
  try {
    return await getShellTransport().call<RemoteWorkspaceUploadPathsResult>(
      "remote_upload_workspace_paths",
      {
        connectionId,
        rootPath: args.rootPath,
        targetPath: args.targetPath,
        entries: args.entries,
      }
    )
  } catch (err) {
    if (isRemoteAuthenticationFailed(err)) {
      notifyRemoteDesktopUnauthorized()
    }
    throw err
  }
}

export interface WorkspaceTransferProgress {
  transferId: string
  direction: "upload" | "download"
  loaded: number
  total: number | null
  state: "running" | "done" | "cancelled" | "error"
  path?: string | null
  error?: string | null
}

export async function listenWorkspaceTransferProgress(
  handler: (event: WorkspaceTransferProgress) => void
): Promise<() => void> {
  if (!isDesktop()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen<WorkspaceTransferProgress>(
    "workspace://transfer-progress",
    (event) => handler(event.payload)
  )
}

export async function cancelWorkspaceTransfer(
  transferId: string
): Promise<boolean> {
  return getShellTransport().call<boolean>("remote_cancel_workspace_transfer", {
    transferId,
  })
}

function isRemoteAuthenticationFailed(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "authentication_failed"
  )
}

export function isUploadAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

interface WorkspaceDownloadTicket {
  ticket: string
  url: string
  filename: string
  expiresAt: number
}

type WorkspaceDownloadKind = "file" | "dir"

function openBrowserDownloadUrl(url: string, filename: string): void {
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function createWorkspaceDownloadTicket(args: {
  rootPath: string
  path: string
  kind: WorkspaceDownloadKind
}): Promise<WorkspaceDownloadTicket> {
  const res = await workspaceFileFetch(
    "workspace_download_ticket",
    JSON.stringify(args),
    false
  )
  return res.json()
}

/**
 * Sentinel return from a remote-desktop download path when the user
 * cancels the Tauri save dialog. Web mode never returns this — the
 * browser owns the download manager and there's no per-call cancel.
 */
export const WORKSPACE_DOWNLOAD_CANCELLED = "cancelled" as const

export type WorkspaceDownloadResult =
  | { status: "started" }
  | { status: "done"; savedPath?: string; bytes?: number; transferId?: string }
  | { status: typeof WORKSPACE_DOWNLOAD_CANCELLED }

export async function downloadWorkspaceFile(
  rootPath: string,
  path: string,
  fileName: string
): Promise<WorkspaceDownloadResult> {
  assertWorkspaceFileApiAvailable("downloadWorkspaceFile")

  if (isRemoteDesktopMode()) {
    return downloadWorkspaceViaRemoteProxy({
      endpoint: "remote_download_workspace_file",
      rootPath,
      path,
      suggestedName: fileName,
    })
  }

  const ticket = await createWorkspaceDownloadTicket({
    rootPath,
    path,
    kind: "file",
  })
  openBrowserDownloadUrl(ticket.url, ticket.filename || fileName)
  return { status: "started" }
}

export async function downloadWorkspaceDir(
  rootPath: string,
  path: string,
  dirName: string
): Promise<WorkspaceDownloadResult> {
  assertWorkspaceFileApiAvailable("downloadWorkspaceDir")

  if (isRemoteDesktopMode()) {
    return downloadWorkspaceViaRemoteProxy({
      endpoint: "remote_download_workspace_dir",
      rootPath,
      path,
      suggestedName: `${dirName}.zip`,
    })
  }

  const ticket = await createWorkspaceDownloadTicket({
    rootPath,
    path,
    kind: "dir",
  })
  openBrowserDownloadUrl(ticket.url, ticket.filename || `${dirName}.zip`)
  return { status: "started" }
}

async function downloadWorkspaceViaRemoteProxy(opts: {
  endpoint: "remote_download_workspace_file" | "remote_download_workspace_dir"
  rootPath: string
  path: string
  suggestedName: string
}): Promise<WorkspaceDownloadResult> {
  const connectionId = getActiveRemoteConnectionId()
  if (connectionId === null) {
    throw new Error(
      "downloadWorkspaceFile (remote): no active remote connection"
    )
  }
  const { save } = await import("@tauri-apps/plugin-dialog")
  const savePath = await save({ defaultPath: opts.suggestedName })
  if (!savePath) {
    return { status: WORKSPACE_DOWNLOAD_CANCELLED }
  }
  const { invoke } = await import("@tauri-apps/api/core")
  let result: { transferId: string; bytes: number }
  try {
    result = await invoke<{ transferId: string; bytes: number }>(
      opts.endpoint,
      {
        connectionId,
        rootPath: opts.rootPath,
        path: opts.path,
        savePath,
      }
    )
  } catch (err) {
    if (isRemoteAuthenticationFailed(err)) {
      notifyRemoteDesktopUnauthorized()
    }
    throw err
  }
  return {
    status: "done",
    savedPath: savePath,
    bytes: result.bytes,
    transferId: result.transferId,
  }
}

// File tree and git log commands

export async function getFileTree(
  path: string,
  maxDepth?: number
): Promise<FileTreeNode[]> {
  return getTransport().call("get_file_tree", {
    path,
    maxDepth: maxDepth ?? null,
  })
}

export async function startWorkspaceStateStream(
  rootPath: string,
  wantsTreeGit = true
): Promise<WorkspaceSnapshotResponse> {
  return getTransport().call("start_workspace_state_stream", {
    rootPath,
    wantsTreeGit,
  })
}

export async function stopWorkspaceStateStream(
  rootPath: string,
  wantsTreeGit = true
): Promise<void> {
  return getTransport().call("stop_workspace_state_stream", {
    rootPath,
    wantsTreeGit,
  })
}

export async function getWorkspaceSnapshot(
  rootPath: string,
  sinceSeq?: number
): Promise<WorkspaceSnapshotResponse> {
  return getTransport().call("get_workspace_snapshot", {
    rootPath,
    sinceSeq: sinceSeq ?? null,
  })
}

export async function readFileBase64(
  path: string,
  maxBytes?: number
): Promise<string> {
  return getTransport().call("read_file_base64", {
    path,
    maxBytes: maxBytes ?? null,
  })
}

// Workspace-confined base64 read: `path` is relative to `rootPath` and is
// canonicalized server-side (resolving symlinks), so it can never read outside
// the workspace. Used by the HTML preview to inline local sub-resources safely.

export async function readWorkspaceFileBase64(
  rootPath: string,
  path: string,
  maxBytes?: number
): Promise<string> {
  return getTransport().call("read_workspace_file_base64", {
    rootPath,
    path,
    maxBytes: maxBytes ?? null,
  })
}

export async function readFilePreview(
  rootPath: string,
  path: string
): Promise<FilePreviewContent> {
  return getTransport().call("read_file_preview", { rootPath, path })
}

export async function readFileForEdit(
  rootPath: string,
  path: string
): Promise<FileEditContent> {
  return getTransport().call("read_file_for_edit", { rootPath, path })
}

export async function saveFileContent(
  rootPath: string,
  path: string,
  content: string,
  expectedEtag?: string | null
): Promise<FileSaveResult> {
  return getTransport().call("save_file_content", {
    rootPath,
    path,
    content,
    expectedEtag: expectedEtag ?? null,
  })
}

export async function saveFileCopy(
  rootPath: string,
  path: string,
  content: string
): Promise<FileSaveResult> {
  return getTransport().call("save_file_copy", {
    rootPath,
    path,
    content,
  })
}

export async function renameFileTreeEntry(
  rootPath: string,
  path: string,
  newName: string
): Promise<string> {
  return getTransport().call("rename_file_tree_entry", {
    rootPath,
    path,
    newName,
  })
}

export async function deleteFileTreeEntry(
  rootPath: string,
  path: string
): Promise<void> {
  return getTransport().call("delete_file_tree_entry", { rootPath, path })
}

export async function createFileTreeEntry(
  rootPath: string,
  path: string,
  name: string,
  kind: "file" | "dir"
): Promise<string> {
  return getTransport().call("create_file_tree_entry", {
    rootPath,
    path,
    name,
    kind,
  })
}

export async function uploadBackupWeb(
  file: File,
  onProgress?: (loaded: number, total: number) => void
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const token = getVeryAgentToken()
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${window.location.origin}/api/backup_upload`)
    xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        notifyWebUnauthorized()
        reject(new Error("Unauthorized"))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        let err: unknown
        try {
          err = JSON.parse(xhr.responseText) as unknown
        } catch {
          err = { code: "network_error", message: `HTTP ${xhr.status}` }
        }
        reject(err)
        return
      }
      try {
        const res = JSON.parse(xhr.responseText) as { uploadId: string }
        resolve(res.uploadId)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    xhr.onerror = () => reject(new Error("Network error during upload"))
    const form = new FormData()
    form.append("file", file, file.name)
    xhr.send(form)
  })
}

/** Validate a backup (desktop: by path). */
