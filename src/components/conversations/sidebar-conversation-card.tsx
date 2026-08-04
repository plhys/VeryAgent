"use client"

import {
  memo,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react"
import { Loader2, ArrowUp, Pin, PinOff, Archive } from "lucide-react"
import { AgentIcon } from "@/components/agent-icon"
import { SidebarHoverTimeFlag } from "./sidebar-hover-time-flag"
import { SidebarSummaryBubble } from "./sidebar-summary-bubble"
import { ConversationContextMenu } from "./conversation-context-menu"
import { useTranslations } from "next-intl"
import type { DbConversationSummary, ConversationStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { formatConversationTitle } from "@/lib/conversation-title"
import { useTabStore } from "@/contexts/tab-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { toast } from "sonner"
import { generateConversationSummary, getFolderConversation } from "@/lib/api"
import { format } from "date-fns"

/** Format an ISO timestamp as a Chinese "days ago" label. */
function formatDaysAgo(
  iso: string | null | undefined,
  nowMs: number
): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return null
  const diff = Math.max(0, nowMs - ts)
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "今天"
  if (days === 1) return "昨天"
  return `${days}天前`
}

/**
 * Horizontal indent added per delegation-nesting level. Chosen so a child's
 * agent-icon GLYPH left edge lands exactly under its parent's title TEXT start:
 * the gap from a row's rail axis to its title is `0.875rem`, and the icon glyph
 * is centred on the axis (half-width `0.375rem`), so one level must shift the
 * child axis right by `0.875 + 0.375 = 1.25rem` for `axis(child) − 0.375 =
 * title(parent)`. The root axis (`0.875rem`) and the axis→title gap (`0.875rem`)
 * are separate constants — don't fold them into this step.
 */
export const CONV_RAIL_DEPTH_STEP = "1.25rem"

/**
 * Vertical guide rails for a delegation sub-session's ANCESTORS. A row at `depth`
 * draws one rail per ancestor level (axis 0 … depth−1), each a 2px line at
 * `axis(level) = 0.875rem + level·CONV_RAIL_DEPTH_STEP` from the row's left edge
 * — the same x as that ancestor row's own rail. Stacked across a contiguous
 * subtree they render each parent's rail as a single continuous vertical line
 * running down through all of its descendants, so a child's left rail lines up
 * exactly under its parent's instead of floating one indent step to the right.
 * The row's OWN rail — the one through its agent icon — is drawn separately at
 * `--conv-rail-axis` by the caller.
 *
 * Renders nothing for a root (depth 0). Shared with the list's sub-session
 * loading placeholder so the spine stays continuous while children are fetched.
 */
export function SubsessionAncestorRails({ depth }: { depth: number }) {
  if (depth <= 0) return null
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          data-subsession-rail
          className="pointer-events-none absolute z-0 bg-sidebar-border"
          style={{
            top: "-0.0625rem",
            bottom: "-0.0625rem",
            left: `calc(0.875rem + ${level} * ${CONV_RAIL_DEPTH_STEP})`,
            width: "0.125rem",
            transform: "translateX(-50%)",
          }}
        />
      ))}
    </>
  )
}

interface SidebarConversationCardProps {
  conversation: DbConversationSummary
  isSelected: boolean
  isOpenInTab?: boolean
  rawTimestamp?: string
  onSelect: (id: number, agentType: string, folderId: number) => void
  onDoubleClick?: (id: number, agentType: string, folderId: number) => void
  onRename: (id: number, newTitle: string) => Promise<void>
  onDelete: (id: number, agentType: string, folderId: number) => Promise<void>
  onStatusChange: (id: number, status: ConversationStatus) => Promise<void>
  onNewConversation?: (folderId: number) => void
  onTogglePin?: (id: number, nextPinned: boolean) => void
  /** Delegation-tree nesting depth (0 = root). Drives the per-level indent. */
  depth?: number
}

export const SidebarConversationCard = memo(function SidebarConversationCard({
  conversation,
  isSelected,
  isOpenInTab = false,
  rawTimestamp,
  onSelect,
  onDoubleClick,
  onRename,
  onDelete,
  onStatusChange,
  onTogglePin,
  depth = 0,
}: SidebarConversationCardProps) {
  const t = useTranslations("Folder.conversationCard")
  const tSidebar = useTranslations("Folder.sidebar")
  const folder = useAppWorkspaceStore((s) =>
    s.getFolder(conversation.folder_id)
  )
  const agentFilter = useAppWorkspaceStore((s) => s.agentFilter)
  const [isHovered, setIsHovered] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const daysAgo = useMemo(
    () => formatDaysAgo(rawTimestamp, now),
    [rawTimestamp, now]
  )

  const handleClick = useCallback(() => {
    onSelect(conversation.id, conversation.agent_type, conversation.folder_id)
  }, [
    onSelect,
    conversation.id,
    conversation.agent_type,
    conversation.folder_id,
  ])

  const handleDblClick = useCallback(() => {
    onDoubleClick?.(
      conversation.id,
      conversation.agent_type,
      conversation.folder_id
    )
  }, [
    onDoubleClick,
    conversation.id,
    conversation.agent_type,
    conversation.folder_id,
  ])

  const status = conversation.status as ConversationStatus
  const isRunning = status === "in_progress"
  const isPinned = conversation.pinned_at != null
  // Delegation sub-sessions (a child of another conversation) don't get the
  // hover quick actions: pinning a sub-agent run to the root Pinned section or
  // hand-toggling its status doesn't fit — its lifecycle is the sub-agent's. The
  // time / running badge then stays visible on hover (nothing swaps in for it).
  const isSubsession = conversation.parent_id != null

  // ── // Pinned conversation summary
  const [summary, setSummary] = useState<string | null>(null)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeAgentType = activeTab?.agentType
  // Stagger summary generation for pinned conversations to avoid thundering herd.
  // Each card picks a random delay up to 500ms based on its id.
  const [staggerReady, setStaggerReady] = useState(false)
  useEffect(() => {
    if (!isPinned) return
    const delay = ((conversation.id * 137) % 500) + 50 // deterministic 50-550ms
    const timer = setTimeout(() => setStaggerReady(true), delay)
    return () => clearTimeout(timer)
  }, [isPinned, conversation.id])

  useEffect(() => {
    if (!isPinned) return
    if (!staggerReady) return // wait for stagger delay
    let cancelled = false

    // If we already have a cached summary, combine with time range below
    getFolderConversation(conversation.id)
      .then((detail) => {
        if (cancelled) return
        const turns = detail.turns
        if (turns.length === 0) {
          setSummary(null)
          toast.error(t("noMessagesSummary"), { duration: 3000 })
          return
        }

        const formatTS = (iso: string) => {
          try {
            const d = new Date(iso)
            if (Number.isNaN(d.getTime())) return ""
            return format(d, "MM/dd HH:mm")
          } catch {
            return ""
          }
        }
        const firstTurn = turns.find(
          (t) => t.role === "user" || t.role === "assistant"
        )
        const lastTurn = [...turns]
          .reverse()
          .find((t) => t.role === "user" || t.role === "assistant")
        const timeRange =
          firstTurn && lastTurn && firstTurn.timestamp && lastTurn.timestamp
            ? formatTS(firstTurn.timestamp) +
              " ~ " +
              formatTS(lastTurn.timestamp)
            : ""

        // If we already have a cached summary, combine with time range and skip API
        if (conversation.summary) {
          setSummary(
            timeRange
              ? timeRange + "\n\n" + conversation.summary
              : conversation.summary
          )
          return
        }

        setSummary(null)

        const agentForSummary = activeAgentType || conversation.agent_type
        console.log(
          "[Summary] agentForSummary:",
          agentForSummary,
          "activeAgentType:",
          activeAgentType,
          "conv.agent_type:",
          conversation.agent_type
        )
        generateConversationSummary(conversation.id, agentForSummary)
          .then((result) => {
            if (!cancelled) {
              setSummary(
                timeRange ? timeRange + "\n\n" + result.summary : result.summary
              )
            }
          })
          .catch((err) => {
            // Suppress expected failures silently; unknown errors are logged once.
            // When err is a plain object (common with Tauri IPC), String(err) === '[object Object]'
            // so we can't match message substrings — just fall back to timeRange regardless.
            const errMsg = typeof err === "string" ? err : JSON.stringify(err)
            const isExpected =
              errMsg.includes("No model provider") ||
              errMsg.includes("model_not_found") ||
              errMsg.includes("HTTP 503")
            if (!isExpected) {
              console.warn("[Summary] AI summary failed:", errMsg)
            }
            // Always show timeRange as fallback so the bubble is never empty
            if (!cancelled && timeRange) setSummary(timeRange)
          })
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })

    return () => {
      cancelled = true
    }
  }, [
    isPinned,
    conversation.id,
    conversation.summary,
    activeAgentType,
    staggerReady,
  ])

  return (
    <>
      <ConversationContextMenu
        conversation={conversation}
        folder={folder}
        onRename={onRename}
        onDelete={onDelete}
        onStatusChange={onStatusChange}
        onTogglePin={onTogglePin}
      >
        <div
          ref={cardRef}
          className="relative bg-sidebar py-[0.0625rem]"
          data-conv-key={`${conversation.agent_type}:${conversation.id}`}
          // Per-level indent: shift the shared rail axis right by one step per
          // depth. Root rows (depth 0) leave the var untouched so they inherit
          // the list's `--conv-rail-axis: 0.875rem` and render exactly as
          // before; the rail, agent icon, status dot, and button padding all
          // key off this var so the whole row indents cohesively.
          style={
            depth > 0
              ? ({
                  "--conv-rail-axis": `calc(0.875rem + ${depth} * ${CONV_RAIL_DEPTH_STEP})`,
                } as CSSProperties)
              : undefined
          }
        >
          <div
            className="group relative flex w-full items-center py-[0.25rem] text-sidebar-foreground"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* Selection / hover background, inset from both sides */}
            <div
              className={cn(
                "pointer-events-none absolute inset-y-0 my-0 rounded-md transition-colors duration-[120ms]",
                isSelected
                  ? "bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_8%)]"
                  : "group-hover:bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_8%)]"
              )}
              style={{ left: "0.5rem", right: "0.5rem" }}
            />
            <button
              data-conversation-id={conversation.id}
              onClick={handleClick}
              onDoubleClick={handleDblClick}
              className={cn(
                "relative flex min-w-0 flex-1 items-center gap-1 text-left outline-none",
                "rounded-md cursor-pointer",
                "pr-2"
              )}
              // Rail-axis-relative left padding. Without the agent icon, the
              // padding is just the rail axis position itself, which still
              // provides the correct indent for nested rows (depth ≥ 1).
              // Root rows (depth=0) have no explicit --conv-rail-axis, so the
              // fallback 0px keeps them flush to the sidebar edge.
              style={{
                paddingLeft: "calc(var(--conv-rail-axis, 0px) + 0.5rem)",
              }}
            >
              {/* Ancestor guide rails (depth ≥ 1): keep each parent's vertical
                    line continuous down through this nested row, so the child's
                    left rail aligns under the parent's. */}
              <SubsessionAncestorRails depth={depth} />
              {/* This row's OWN rail, through its agent icon, at the (depth-
                    shifted) rail axis. Only drawn for nested sub-sessions
                    (depth ≥ 1); root conversations omit the rail for a
                    cleaner flat list appearance. */}
              {depth > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute z-0 bg-sidebar-border"
                  )}
                  style={{
                    top: "-0.0625rem",
                    bottom: "-0.0625rem",
                    left: "var(--conv-rail-axis, 0.875rem)",
                    width: "0.125rem",
                    transform: "translateX(-50%)",
                  }}
                />
              )}

              {isPinned && (
                <ArrowUp className="h-3 w-3 shrink-0 text-primary" />
              )}

              {/* Agent icon — only show when filtering by agent */}
              {agentFilter && (
                <AgentIcon
                  agentType={conversation.agent_type}
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                />
              )}

              {/* Title */}
              <span
                className={cn(
                  "min-w-0 truncate text-[0.875rem]",
                  isSelected
                    ? "font-medium text-sidebar-foreground"
                    : "font-normal",
                  isOpenInTab && "text-primary"
                )}
              >
                {formatConversationTitle(conversation.title) ||
                  t("untitledConversation")}
              </span>
            </button>

            {/* Expand chevron removed alongside agent icon */}

            {/* Right slot: sizes to its content — the time / status badge
                  normally, the two quick-action buttons (pin, done) on hover —
                  so it never reserves more width than what is actually shown
                  (the title reflows slightly on hover). Meta and buttons swap via
                  opacity so layout never shifts and hover doesn't flicker. The
                  buttons are siblings of the row button — never nested — so their
                  clicks don't select the conversation; `tabIndex={-1}` keeps them
                  mouse-only (the context menu Pin/Unpin + Status is the keyboard/
                  AT-accessible path). */}
            {/* pr-[0.375rem] + the list's px-1.5 (0.375rem) puts the time
                  badge / hover action buttons at a uniform 0.75rem inset from the
                  sidebar border — the same right edge as the section-header
                  actions, folder-header actions, and New chat / Search shortcut
                  badges. */}
            <div className="relative flex h-full shrink-0 items-center pr-[1rem]">
              <span
                className={cn(
                  "flex items-center text-[0.65rem] text-muted-foreground/60 whitespace-nowrap",
                  // Roots swap the badge out for the hover actions; sub-sessions
                  // have no actions, so keep the badge visible on hover.
                  !isSubsession && "group-hover:opacity-0"
                )}
              >
                {isRunning ? (
                  <span
                    className="relative inline-flex shrink-0 items-center justify-center"
                    title={tSidebar("statusRunningBadge")}
                  >
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400"
                      aria-hidden
                    />
                    <span className="sr-only">
                      {tSidebar("statusRunningBadge")}
                    </span>
                  </span>
                ) : daysAgo ? (
                  <span>{daysAgo}</span>
                ) : null}
              </span>
              {/* Hover quick actions — roots only (sub-sessions opt out above).
                    Default /90 is the lightest muted shade that still clears the
                    3:1 non-text-contrast bar over the row's hover background; hover
                    deepens to full foreground. The folder ⋯ button shares this
                    exact palette so all action icons stay a consistent two colors.
                    Each button is justify-end so its 14px glyph flushes to the
                    slot's right edge (0.75rem) — the same edge the default
                    time/status badge fills — instead of sitting ~5px in as a
                    centred icon in a transparent box would. */}
              {!isSubsession && (
                <div
                  className={cn(
                    "flex items-center gap-px opacity-0 transition-opacity duration-150",
                    "group-hover:opacity-100",
                    "absolute right-[1rem]"
                  )}
                >
                  {onTogglePin && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePin(conversation.id, !isPinned)
                      }}
                      title={isPinned ? t("unpin") : t("pin")}
                      aria-label={isPinned ? t("unpin") : t("pin")}
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                        "cursor-pointer outline-none transition-all duration-150",
                        "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/20"
                      )}
                    >
                      {isPinned ? (
                        <PinOff className="h-4 w-4" />
                      ) : (
                        <Pin className="h-4 w-4" />
                      )}
                    </button>
                  )}
                  {onStatusChange && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation()
                        onStatusChange(conversation.id, "completed")
                      }}
                      title={t("archive")}
                      aria-label={t("archive")}
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                        "cursor-pointer outline-none transition-all duration-150",
                        "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/20"
                      )}
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </ConversationContextMenu>

      <SidebarHoverTimeFlag
        hostRef={cardRef}
        isHovered={isHovered}
        rawTimestamp={rawTimestamp}
        agentType={conversation.agent_type}
      />
      {isPinned && (
        <SidebarSummaryBubble
          hostRef={cardRef}
          isHovered={isHovered}
          summary={summary}
        />
      )}
    </>
  )
})
