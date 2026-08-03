"use client"

import {
  memo,
  useState,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
} from "react"
import {
  Pencil,
  Trash2,
  Circle,
  SquarePen,
  Loader2,
  Pin,
  PinOff,
  Info,
  LayoutGrid,
  Link2,
  ArrowUp,
  FolderOpen,
} from "lucide-react"
import { SidebarHoverTimeFlag } from "./sidebar-hover-time-flag"
import { SidebarSummaryBubble } from "./sidebar-summary-bubble"
import { useTranslations } from "next-intl"
import type { DbConversationSummary, ConversationStatus } from "@/lib/types"
import { STATUS_ORDER } from "@/lib/types"
import { cn, copyTextToClipboard } from "@/lib/utils"
import { formatConversationTitle } from "@/lib/conversation-title"
import { useTabStore } from "@/contexts/tab-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { toast } from "sonner"
import { generateConversationSummary, getFolderConversation } from "@/lib/api"
import { format } from "date-fns"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConversationStatusDot } from "./conversation-status-dot"
import { SessionDetailsDialog } from "./session-details-dialog"

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
  timeLabel?: string
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
  timeLabel,
  rawTimestamp,
  onSelect,
  onDoubleClick,
  onRename,
  onDelete,
  onStatusChange,
  onNewConversation,
  onTogglePin,
  depth = 0,
}: SidebarConversationCardProps) {
  const t = useTranslations("Folder.conversationCard")
  const tSidebar = useTranslations("Folder.sidebar")
  const tStatus = useTranslations("Folder.statusLabels")
  const tDetails = useTranslations("Folder.sessionDetails")
  const tTabs = useTranslations("Folder.tabs")
  const isTileMode = useTabStore((s) => s.isTileMode)
  const toggleTileMode = useTabStore((s) => s.toggleTileMode)
  const folder = useAppWorkspaceStore((s) => s.getFolder(conversation.folder_id))
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [isHovered, setIsHovered] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

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

  const handleRenameOpen = useCallback(() => {
    setRenameValue(conversation.title || "")
    setRenameOpen(true)
  }, [conversation.title])

  const handleRenameConfirm = useCallback(async () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== conversation.title) {
      await onRename(conversation.id, trimmed)
    }
    setRenameOpen(false)
  }, [renameValue, conversation.id, conversation.title, onRename])

  const handleDeleteConfirm = useCallback(async () => {
    await onDelete(
      conversation.id,
      conversation.agent_type,
      conversation.folder_id
    )
    setDeleteOpen(false)
  }, [
    conversation.id,
    conversation.agent_type,
    conversation.folder_id,
    onDelete,
  ])

  const status = conversation.status as ConversationStatus
  const isRunning = status === "in_progress"
  const isPinned = conversation.pinned_at != null
  const isCompleted = status === "completed"
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
      <ContextMenu>
        <ContextMenuTrigger asChild data-context-menu="true">
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

                {/* Title */}
                <span
                  className={cn(
                    "min-w-0 truncate text-[0.95rem]",
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
              <div className="flex h-full shrink-0 items-center pr-[0.375rem]">
                <span
                  className={cn(
                    "flex items-center",
                    // Roots swap the badge out for the hover actions; sub-sessions
                    // have no actions, so keep the badge (incl. the running
                    // spinner) visible on hover.
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
                  ) : timeLabel ? (
                    <span className="sr-only">{timeLabel}</span>
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
                      !isSubsession && "group-hover:opacity-100"
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
                  </div>
                )}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="rounded-md p-1 min-w-40">
          {onTogglePin && (
            <ContextMenuItem
              onSelect={() => onTogglePin(conversation.id, !isPinned)}
            >
              {isPinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
              {isPinned ? t("unpin") : t("pin")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={handleRenameOpen}>
            <Pencil className="h-4 w-4" />
            {t("rename")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setDetailsOpen(true)}>
            <Info className="h-4 w-4" />
            {tDetails("menuLabel")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={async () => {
              const link = `veryagent://session/${conversation.agent_type}_${conversation.id}`
              const ok = await copyTextToClipboard(link)
              if (ok) {
                toast.success("对话链接已复制")
              }
            }}
          >
            <Link2 className="h-4 w-4" />
            复制对话链接
          </ContextMenuItem>
          {folder?.path && (
            <ContextMenuItem
              onSelect={async () => {
                const ok = await copyTextToClipboard(folder.path)
                if (ok) {
                  toast.success("任务路径已复制")
                }
              }}
            >
              <FolderOpen className="h-4 w-4" />
              复制任务路径
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={toggleTileMode}>
            <LayoutGrid className="h-4 w-4" />
            {isTileMode ? tTabs("untileDisplay") : tTabs("tileDisplay")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Circle className="h-4 w-4" />
              {t("status")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="rounded-md p-1 min-w-32">
              {STATUS_ORDER.filter((s) => s !== conversation.status).map(
                (s) => (
                  <ContextMenuItem
                    key={s}
                    onSelect={() => onStatusChange(conversation.id, s)}
                  >
                    <ConversationStatusDot status={s} />
                    {tStatus(s)}
                  </ContextMenuItem>
                )
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {t("delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameConversation")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.key === "Process") return
              if (e.key === "Enter") handleRenameConfirm()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleRenameConfirm}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConversationTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConversationDescription", {
                title:
                  formatConversationTitle(conversation.title) ||
                  t("untitledConversation"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detailsOpen && (
        <SessionDetailsDialog
          open
          onOpenChange={setDetailsOpen}
          summary={conversation}
        />
      )}

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
