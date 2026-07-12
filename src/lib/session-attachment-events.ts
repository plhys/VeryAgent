export const ATTACH_FILE_TO_SESSION_EVENT = "veryagent:attach-file-to-session"

export interface AttachFileToSessionDetail {
  tabId: string
  path: string
  /**
   * Optional 1-based, inclusive line span to attach as a ranged file badge
   * (`foo.ts:10-25`). Omitted by whole-file callers (file tree, git changes);
   * supplied by the editor's "add selection to chat". When present the consumer
   * encodes it into the badge uri (`file://…#L10-25`) and label.
   */
  range?: { start: number; end: number }
}

export function emitAttachFileToSession(
  detail: AttachFileToSessionDetail
): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<AttachFileToSessionDetail>(ATTACH_FILE_TO_SESSION_EVENT, {
      detail,
    })
  )
}

export const APPEND_TEXT_TO_SESSION_EVENT = "veryagent:append-text-to-session"

export interface AppendTextToSessionDetail {
  tabId: string
  text: string
}

export function emitAppendTextToSession(
  detail: AppendTextToSessionDetail
): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<AppendTextToSessionDetail>(APPEND_TEXT_TO_SESSION_EVENT, {
      detail,
    })
  )
}

export const ATTACH_IMAGE_REFERENCE_TO_SESSION_EVENT =
  "veryagent:attach-image-reference-to-session"

export interface AttachImageReferenceToSessionDetail {
  tabId: string
  imageUrl: string
  alt: string
  /** Skill id to pair with the image reference (e.g. "gemini-image"). */
  skillId?: string
  skillLabel?: string
}

export function emitAttachImageReferenceToSession(
  detail: AttachImageReferenceToSessionDetail
): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<AttachImageReferenceToSessionDetail>(
      ATTACH_IMAGE_REFERENCE_TO_SESSION_EVENT,
      { detail }
    )
  )
}
