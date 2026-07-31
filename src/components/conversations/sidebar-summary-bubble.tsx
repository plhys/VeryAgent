"use client"

import { createPortal } from "react-dom"
import { useState, useEffect, useCallback, type RefObject } from "react"
import ReactMarkdown from "react-markdown"

interface SidebarSummaryBubbleProps {
  hostRef: RefObject<HTMLElement | null>
  /** Whether the host is currently hovered. */
  isHovered: boolean
  /** Summary text to display. null / undefined / empty = don't render. */
  summary: string | null | undefined
}

/**
 * Summary bubble for pinned conversations. Portaled to `document.body` so
 * sidebar overflow clipping cannot hide it. Appears centered in the main
 * content area (right of the sidebar), vertically aligned with the card.
 * Position recalculates on scroll / resize to stay in sync with the card.
 */
export function SidebarSummaryBubble({
  hostRef,
  isHovered,
  summary,
}: SidebarSummaryBubbleProps) {
  const [position, setPosition] = useState<{
    top: number
    left: number
  } | null>(null)

  const updatePosition = useCallback(() => {
    if (!hostRef.current) return
    const rect = hostRef.current.getBoundingClientRect()
    // Prefer the main content area element for positioning; fall back to window center.
    const mainEl = document.querySelector(
      "[data-main-area], .main-area, .workspace-main"
    )
    const mainRect = mainEl?.getBoundingClientRect()
    const mainAreaCenterX = mainRect
      ? mainRect.left + mainRect.width / 2
      : (rect.right + window.innerWidth) / 2
    setPosition({
      top: rect.top + rect.height / 2,
      left: mainAreaCenterX,
    })
  }, [hostRef])

  useEffect(() => {
    if (!isHovered || !summary || !hostRef.current) {
      setPosition(null)
      return
    }

    updatePosition()

    window.addEventListener("scroll", updatePosition, true)
    window.addEventListener("resize", updatePosition)
    return () => {
      window.removeEventListener("scroll", updatePosition, true)
      window.removeEventListener("resize", updatePosition)
    }
  }, [isHovered, summary, hostRef, updatePosition])

  if (!isHovered || !summary || !position) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{
        top: position.top,
        left: position.left,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div className="w-[36rem] max-w-[calc(100vw-4rem)] rounded-xl border border-border/80 bg-muted/85 p-5 text-sm leading-relaxed shadow-2xl backdrop-blur-xl [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_strong]:font-semibold">
        <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/85">
          <ReactMarkdown>{summary}</ReactMarkdown>
        </div>
      </div>
    </div>,
    document.body
  )
}
