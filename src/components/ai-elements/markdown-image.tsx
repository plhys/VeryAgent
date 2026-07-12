"use client"

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { copyTextFromMenu } from "@/lib/utils"
import { toErrorMessage } from "@/lib/app-error"
import { emitAttachImageReferenceToSession } from "@/lib/session-attachment-events"
import { useTabStore } from "@/stores/tab-store"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog"
import { Download, ImageIcon, LinkIcon, SparklesIcon } from "lucide-react"

/**
 * Markdown image renderer with a right-click context menu.
 *
 * Menu items:
 *  - Copy Image   — downloads the image via the Tauri proxy, then writes
 *                    the pixel data to the system clipboard through a Rust
 *                    command (`write_image_to_clipboard`). This is the
 *                    reliable path on Windows WebView2, where
 *                    `navigator.clipboard.write()` with `ClipboardItem` is
 *                    not supported.
 *  - Copy URL     — copies the image `src` URL to the clipboard as text.
 *  - Reference for Re-creation — inserts an image reference badge and a
 *                    `/gemini-image` skill badge into the current session's
 *                    composer, so the agent receives both the reference image
 *                    and the skill invocation for iterative editing.
 *
 * Left click opens the existing full-screen preview dialog used elsewhere in
 * the app; right click still opens the context menu.
 */
export function MarkdownImage({
  src,
  alt,
  ...rest
}: React.ComponentPropsWithoutRef<"img">) {
  const t = useTranslations("MarkdownImage")
  const activeTabId = useTabStore((s) => s.activeTabId)
  const [copyingImage, setCopyingImage] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // ── Copy Image ──────────────────────────────────────────────────────
  const handleCopyImage = useCallback(async () => {
    if (!src || copyingImage) return
    setCopyingImage(true)
    try {
      // Step 1: fetch the image bytes via Tauri (bypasses CORS, works for
      // internal-network URLs that the browser's fetch() can't reach).
      const result = await invoke<{
        mimeType: string
        base64Data: string
        filename: string
      }>("fetch_image_as_base64", { url: src })

      console.log(
        "[MarkdownImage] fetch ok:",
        result.mimeType,
        result.base64Data?.length ?? 0,
        "chars"
      )

      // Step 2: write the decoded image to the system clipboard via Rust
      // (arboard). This is the reliable path on Windows WebView2 where
      // `navigator.clipboard.write(ClipboardItem)` is not available.
      await invoke("write_image_to_clipboard", {
        base64Data: result.base64Data,
        mimeType: result.mimeType,
      })

      console.log("[MarkdownImage] clipboard write ok")
    } catch (err) {
      // IMPORTANT: do not silently replace the user's clipboard with the URL.
      // "Copy Image" should only ever try to copy image data; "Copy URL" is a
      // separate menu action. Keeping the clipboard untouched on failure also
      // avoids the composer later preferring pasted text over image data.
      console.error(
        "[MarkdownImage] copy-image failed:",
        toErrorMessage(err),
        err
      )
    } finally {
      setCopyingImage(false)
    }
  }, [src, copyingImage])

  // ── Copy URL ─────────────────────────────────────────────────────────
  const handleCopyUrl = useCallback(() => {
    if (!src) return
    copyTextFromMenu(String(src))
  }, [src])

  // ── Reference for Re-creation ────────────────────────────────────────
  const handleReferenceToChat = useCallback(() => {
    if (!src || !activeTabId) return
    // Emit a custom event that the composer listens for. The handler inserts
    // two badges into the editor: an image reference badge (cyan, showing the
    // image URL) and a skill badge for `/gemini-image` (rose). When sent, the
    // image badge serializes as `![alt](url)` markdown and the skill badge
    // as `/gemini-image`, so the agent receives both the reference image and
    // the skill invocation.
    emitAttachImageReferenceToSession({
      tabId: activeTabId,
      imageUrl: String(src),
      alt: alt || "参考图片",
      skillId: "gemini-image",
      skillLabel: "gemini-image",
    })
  }, [src, alt, activeTabId])

  const handleOpenPreview = useCallback(() => {
    if (!src) return
    setPreviewOpen(true)
  }, [src])

  // ── Download Image ───────────────────────────────────────────────────
  const handleDownloadImage = useCallback(async () => {
    if (!src) return
    try {
      const result = await invoke<{
        mimeType: string
        base64Data: string
        filename: string
      }>("fetch_image_as_base64", { url: src })

      const ext = result.mimeType.split("/")[1] || "png"
      const defaultName = result.filename || `image.${ext}`

      const dest = await save({
        title: t("downloadDialogTitle"),
        defaultPath: defaultName,
        filters: [
          { name: "图片文件", extensions: [ext, "png", "jpg", "jpeg", "webp"] },
          { name: t("downloadFilterAll"), extensions: ["*"] },
        ],
      })

      if (!dest) return // user cancelled

      await invoke("save_binary_file", {
        path: dest,
        dataBase64: result.base64Data,
      })
    } catch (err) {
      console.error(
        "[MarkdownImage] download failed:",
        toErrorMessage(err),
        err
      )
    }
  }, [src, t])

  if (!src) {
    // No source — render a broken-image placeholder without a context menu.
    return <span className="text-muted-foreground italic">{alt || "(image)"}</span>
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <img
            src={src}
            alt={alt ?? ""}
            className="max-w-full rounded-lg cursor-zoom-in"
            loading="lazy"
            onClick={handleOpenPreview}
            {...rest}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleCopyImage} disabled={copyingImage}>
            <ImageIcon className="size-4" />
            {copyingImage ? t("copyingImage") : t("copyImage")}
          </ContextMenuItem>
<ContextMenuItem onSelect={handleCopyUrl}>
          <LinkIcon className="size-4" />
          {t("copyUrl")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleDownloadImage}>
          <Download className="size-4" />
          {t("downloadImage")}
        </ContextMenuItem>
        <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleReferenceToChat}>
            <SparklesIcon className="size-4" />
            {t("referenceToChat")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ImagePreviewDialog
        src={String(src)}
        alt={alt ?? ""}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  )
}
