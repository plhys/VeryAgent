"use client"

import { createPortal } from "react-dom"
import type { RefObject } from "react"
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
 */
export function SidebarSummaryBubble({
  hostRef,
  isHovered,
  summary,
}: SidebarSummaryBubbleProps) {
  if (!isHovered || !summary || !hostRef.current) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className="w-[36rem] rounded-xl border border-border/40 bg-background/60 p-0 text-sm leading-relaxed shadow-2xl backdrop-blur-2xl [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_strong]:font-semibold"
      >
        <div className="flex items-center gap-1.5 rounded-t-xl bg-primary/15 px-5 py-2.5 text-xs font-semibold text-primary">
          <span>📝</span>
          <span>对话总结</span>
        </div>
        <div className="p-5">
          <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/85">
            <ReactMarkdown>{summary}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}