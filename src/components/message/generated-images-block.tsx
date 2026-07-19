"use client"

import { memo, useCallback, useEffect, useState } from "react"
import Image from "next/image"
import { invoke } from "@tauri-apps/api/core"
import {
  AlertCircle,
  Download,
  ImageIcon,
  ImagePlus,
  SparklesIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import type { UserImageDisplay } from "@/lib/adapters/ai-elements-adapter"
import type { ToolCallStatus } from "@/lib/types"
import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { downloadImage } from "@/lib/image-download"
import { readFileBase64 } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { emitAttachImageReferenceToSession } from "@/lib/session-attachment-events"
import { useTabStore } from "@/stores/tab-store"
import { cn } from "@/lib/utils"

/** Max bytes when hydrating a platform-generated image from disk (~20 MiB). */
const GENERATED_IMAGE_MAX_BYTES = 20_000_000

/** Shared frame for pending / failed / success image so the card does not jump size. */
const IMAGE_FRAME_CLASS =
  "h-64 w-64 max-w-full overflow-hidden rounded-md border border-border/70"

function localPathFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null
  const trimmed = uri.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed)
      let p = decodeURIComponent(url.pathname)
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
      return p
    } catch {
      return trimmed.replace(/^file:\/\//, "")
    }
  }
  if (
    trimmed.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.includes("veryagent-images")
  ) {
    return trimmed
  }
  return null
}

/** Prefer a stable path/URL the agent can pass as modify_image ref_urls. */
function referenceUrlForImage(img: UserImageDisplay): string {
  const path = localPathFromUri(img.uri)
  if (path) {
    // Normalize to forward slashes for tool/schema friendliness on Windows.
    const normalized = path.replace(/\\/g, "/")
    if (/^[A-Za-z]:\//.test(normalized)) {
      return `file:///${normalized}`
    }
    if (normalized.startsWith("/")) {
      return `file://${normalized}`
    }
    return normalized
  }
  if (img.uri && (img.uri.startsWith("http://") || img.uri.startsWith("https://"))) {
    return img.uri
  }
  // Last resort: data URL (works for clipboard-style re-attach; large but rare).
  return `data:${img.mime_type || "image/png"};base64,${img.data}`
}

interface GeneratedImagesBlockProps {
  revisedPrompt: string | null
  image: UserImageDisplay | null
  status?: ToolCallStatus | null
  className?: string
}

/**
 * Compact image-generation card: thumbnail-sized, no wide empty column.
 * Right-click: copy / download / reference for img2img in the composer.
 */
export const GeneratedImagesBlock = memo(function GeneratedImagesBlock({
  revisedPrompt,
  image,
  status,
  className,
}: GeneratedImagesBlockProps) {
  const t = useTranslations("Folder.chat.messageList")
  const tImg = useTranslations("MarkdownImage")
  const activeTabId = useTabStore((s) => s.activeTabId)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copyingImage, setCopyingImage] = useState(false)
  const [resolved, setResolved] = useState<UserImageDisplay | null>(() => {
    if (image && image.data && image.data.length >= 4) return image
    return null
  })
  const [hydrateFailed, setHydrateFailed] = useState(false)
  const [hydrating, setHydrating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHydrateFailed(false)

    if (!image) {
      setResolved(null)
      setHydrating(false)
      return
    }

    if (image.data && image.data.length >= 4) {
      setResolved(image)
      setHydrating(false)
      return
    }

    const path = localPathFromUri(image.uri)
    if (!path) {
      setResolved(null)
      setHydrating(false)
      if (status === "failed" || status === "completed") {
        setHydrateFailed(true)
      }
      return
    }

    setHydrating(true)
    setResolved(null)
    const normalizedPath = path.replace(/\//g, "\\")
    const tryPaths = normalizedPath === path ? [path] : [path, normalizedPath]
    void (async () => {
      let lastErr: unknown = null
      for (const p of tryPaths) {
        try {
          const b64 = await readFileBase64(p, GENERATED_IMAGE_MAX_BYTES)
          if (cancelled) return
          if (b64 && b64.length >= 4) {
            setResolved({
              name: image.name,
              data: b64,
              mime_type: image.mime_type || "image/png",
              uri: image.uri ?? p,
            })
            setHydrateFailed(false)
            return
          }
        } catch (err) {
          lastErr = err
        }
      }
      if (cancelled) return
      console.warn(
        "[GeneratedImagesBlock] failed to hydrate image from path",
        tryPaths,
        lastErr
      )
      setHydrateFailed(true)
      setResolved(null)
    })().finally(() => {
      if (!cancelled) setHydrating(false)
    })

    return () => {
      cancelled = true
    }
  }, [image, status])

  const isGenFailed =
    image === null && (status === "failed" || status === "completed")
  const isHydrateFailed =
    image !== null &&
    !resolved &&
    !hydrating &&
    hydrateFailed &&
    (status === "failed" || status === "completed" || status == null)
  const isFailed = isGenFailed || isHydrateFailed

  const handleDownload = useCallback(
    async (img: UserImageDisplay) => {
      try {
        await downloadImage({
          data: img.data,
          mime_type: img.mime_type,
          suggestedName: img.name,
        })
      } catch (err) {
        const message = toErrorMessage(err)
        window.alert(t("downloadFailed", { message }))
      }
    },
    [t]
  )

  const handleCopyImage = useCallback(
    async (img: UserImageDisplay) => {
      if (copyingImage || !img.data) return
      setCopyingImage(true)
      try {
        await invoke("write_image_to_clipboard", {
          base64Data: img.data,
          mimeType: img.mime_type || "image/png",
        })
      } catch (err) {
        console.error(
          "[GeneratedImagesBlock] copy-image failed:",
          toErrorMessage(err),
          err
        )
      } finally {
        setCopyingImage(false)
      }
    },
    [copyingImage]
  )

  const handleReferenceToChat = useCallback(
    (img: UserImageDisplay) => {
      if (!activeTabId) return
      const imageUrl = referenceUrlForImage(img)
      emitAttachImageReferenceToSession({
        tabId: activeTabId,
        imageUrl,
        alt: img.name || t("imageGeneration"),
        skillId: "veryagent-image",
        skillLabel: "出图网关",
      })
    },
    [activeTabId, t]
  )

  const trimmedPrompt =
    typeof revisedPrompt === "string" ? revisedPrompt.trim() : ""

  const displayImage = resolved
  const dataSrc = displayImage
    ? `data:${displayImage.mime_type};base64,${displayImage.data}`
    : ""

  return (
    <div
      className={cn(
        // Fit content — no wide empty column beside the thumbnail.
        "inline-flex max-w-full flex-col gap-2 rounded-md border border-border/70 bg-muted/20 p-2",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <ImagePlus className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span>{t("imageGeneration")}</span>
      </div>

      {trimmedPrompt.length > 0 ? (
        <div className="max-w-[16rem] whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
          {trimmedPrompt}
        </div>
      ) : null}

      {displayImage ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "group relative bg-muted/30",
                IMAGE_FRAME_CLASS
              )}
            >
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="flex h-full w-full cursor-pointer items-center justify-center transition-opacity hover:opacity-80"
              >
                <Image
                  src={dataSrc}
                  alt={displayImage.name}
                  width={256}
                  height={256}
                  unoptimized
                  className="h-full w-full object-contain"
                />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDownload(displayImage)
                }}
                className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-foreground/80 opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t("downloadImage")}
                title={t("downloadImage")}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => void handleCopyImage(displayImage)}
              disabled={copyingImage}
            >
              <ImageIcon className="size-4" />
              {copyingImage ? tImg("copyingImage") : tImg("copyImage")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void handleDownload(displayImage)}>
              <Download className="size-4" />
              {tImg("downloadImage")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => handleReferenceToChat(displayImage)}>
              <SparklesIcon className="size-4" />
              {tImg("referenceToChat")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : isFailed ? (
        <div
          className={cn(
            "flex items-center justify-center border-dashed border-destructive/40 bg-destructive/5 px-3 text-center text-xs text-destructive",
            IMAGE_FRAME_CLASS
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-1.5">
            <AlertCircle className="h-5 w-5 opacity-80" />
            <span>
              {isHydrateFailed
                ? t("imageGenerationUnavailable")
                : t("imageGenerationFailed")}
            </span>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "flex animate-pulse items-center justify-center border-dashed bg-muted/40 text-xs text-muted-foreground",
            IMAGE_FRAME_CLASS
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-1.5">
            <ImagePlus className="h-5 w-5 opacity-60" />
            <span>{t("imageGenerationPending")}</span>
          </div>
        </div>
      )}

      <ImagePreviewDialog
        src={dataSrc}
        alt={displayImage?.name ?? ""}
        open={previewOpen && displayImage !== null}
        onOpenChange={(open) => setPreviewOpen(open)}
        onDownload={
          displayImage ? () => void handleDownload(displayImage) : undefined
        }
        downloadLabel={t("downloadImage")}
      />
    </div>
  )
})
