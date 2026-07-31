"use client"

import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
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
  "max-w-full overflow-hidden rounded-lg"

function inferRequestedAspectRatio(
  prompt: string,
  requestedAspectRatio?: string | null
): { ratio: string; width: string } {
  const hint = requestedAspectRatio?.trim()
  const text = `${hint ?? ""} ${prompt}`.toLowerCase()
  const explicit = text.match(/(?:^|[^0-9])(\d{1,2})\s*[:：/]\s*(\d{1,2})(?:[^0-9]|$)/)
  if (explicit) {
    const w = Number(explicit[1])
    const h = Number(explicit[2])
    if (w > 0 && h > 0) {
      return {
        ratio: `${w} / ${h}`,
        width: w > h ? "24rem" : h > w ? "16rem" : "20rem",
      }
    }
  }

  const size = text.match(/(?:^|[^0-9])(\d{3,4})\s*[x×]\s*(\d{3,4})(?:[^0-9]|$)/)
  if (size) {
    const w = Number(size[1])
    const h = Number(size[2])
    if (w > 0 && h > 0) {
      return {
        ratio: `${w} / ${h}`,
        width: w > h ? "24rem" : h > w ? "16rem" : "20rem",
      }
    }
  }

  if (/横版|横屏|landscape|宽屏/.test(text)) return { ratio: "16 / 9", width: "24rem" }
  if (/竖版|竖屏|portrait|海报/.test(text)) return { ratio: "9 / 16", width: "16rem" }
  return { ratio: "1 / 1", width: "20rem" }
}

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
  requestedAspectRatio?: string | null
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
  requestedAspectRatio,
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
        skillLabel: "通用出图网关",
      })
    },
    [activeTabId, t]
  )

  const trimmedPrompt =
    typeof revisedPrompt === "string" ? revisedPrompt.trim() : ""

  const requestedFrame = useMemo(
    () => inferRequestedAspectRatio(trimmedPrompt, requestedAspectRatio),
    [trimmedPrompt, requestedAspectRatio]
  )
  const frameStyle: CSSProperties = {
    aspectRatio: requestedFrame.ratio,
    width: requestedFrame.width,
  }

  const displayImage = resolved
  const dataSrc = displayImage
    ? `data:${displayImage.mime_type};base64,${displayImage.data}`
    : ""

  return (
    <>
      <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setPreviewOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setPreviewOpen(true)
            }
          }}
          className={cn(
            "group inline-block cursor-pointer overflow-hidden rounded-lg shadow-sm transition-opacity hover:opacity-80",
            IMAGE_FRAME_CLASS
          )}
          style={frameStyle}
        >
            {displayImage ? (
              <Image
                src={dataSrc}
                alt={displayImage.name}
                width={256}
                height={256}
                unoptimized
                className="h-full w-full object-contain"
              />
            ) : isFailed ? (
              <div
                className="flex items-center justify-center rounded-md border border-destructive/30 bg-destructive/5 px-3 text-center text-xs text-destructive"
                style={frameStyle}
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
                className="flex animate-pulse items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/60 text-xs text-muted-foreground"
                style={frameStyle}
                role="status"
                aria-live="polite"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <ImagePlus className="h-5 w-5 opacity-60" />
                  <span>{t("imageGenerationPending")}</span>
                </div>
              </div>
            )}
            {displayImage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDownload(displayImage)
                }}
                className="absolute right-1.5 top-1.5 rounded-full bg-background/70 p-1 text-foreground/70 opacity-0 shadow-sm transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t("downloadImage")}
                title={t("downloadImage")}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {displayImage && (
            <>
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
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

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
    </>
  )
})
