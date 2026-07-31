"use client"

import { useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Download, X, ZoomIn, ZoomOut } from "lucide-react"
import { cn } from "@/lib/utils"

interface ImagePreviewDialogProps {
  src: string
  alt: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload?: () => void
  downloadLabel?: string
}

const ZOOM_STEP = 0.2
const ZOOM_MIN = 0.5
const ZOOM_MAX = 4

function ImagePreviewDialog({
  src,
  alt,
  open,
  onOpenChange,
  onDownload,
  downloadLabel,
}: ImagePreviewDialogProps) {
  const [zoom, setZoom] = useState(1)
  const [animating, setAnimating] = useState(false)

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta)))
  }

  const resetZoom = () => setZoom(1)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm",
            "data-open:animate-in data-closed:animate-out",
            "data-closed:fade-out-0 data-open:fade-in-0",
            "duration-200 ease-out"
          )}
        />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          aria-describedby={undefined}
          onClick={() => {
            onOpenChange(false)
            resetZoom()
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {alt}
          </DialogPrimitive.Title>
          {/* Top-center control bar */}
          <div className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
            {onDownload && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDownload()
                }}
                className="rounded-full bg-white/10 p-1.5 text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white"
                aria-label={downloadLabel ?? "Download"}
                title={downloadLabel ?? "Download"}
              >
                <Download className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))
              }}
              className="rounded-full bg-white/10 p-1.5 text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <span className="min-w-[3rem] text-center text-xs text-white/80">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))
              }}
              className="rounded-full bg-white/10 p-1.5 text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenChange(false)
                resetZoom()
              }}
              className="rounded-full bg-white/10 p-1.5 text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {src && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={src}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              onWheel={handleWheel}
              style={{
                transform: `scale(${zoom})`,
                transition:
                  zoom === 1
                    ? "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
                    : "transform 0.1s ease-out",
              }}
              className={cn(
                "max-h-[90vh] max-w-[90vw] cursor-zoom-in rounded-lg object-contain",
                open &&
                  !animating &&
                  "animate-in zoom-in-95 fade-in duration-200"
              )}
              onAnimationEnd={() => setAnimating(false)}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export { ImagePreviewDialog }
