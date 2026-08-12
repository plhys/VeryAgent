"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { Users, FolderOpen, Loader2, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAcpActions } from "@/contexts/acp-connections-context"
import { useTabStore } from "@/stores/tab-store"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import {
  useConversationRuntimeStore,
  selectTimelineTurns,
} from "@/stores/conversation-runtime-store"
import { teamGet } from "@/lib/api"
import { AgentIcon } from "@/components/agent-icon"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Team, TeamSlot } from "@/lib/types"

interface TeamWorkspaceHoverCardProps {
  /** Host element (the folder row) for anchoring. */
  hostRef: RefObject<HTMLElement | null>
  isHovered: boolean
  teamId: string
  workspace: string
}

/**
 * 团队详情卡片相对行右缘再往右的偏移：时间浮标紧贴行右缘（-8px），
 * 团队卡片显示在时间浮标右侧（再往右约 164px），互不重叠。
 */
const TEAM_CARD_RIGHT_OFFSET_PX = 164
/** 鼠标离开行后到卡片隐藏的缓冲（让鼠标能滑到卡片上而不闪没）。 */
const HIDE_DELAY_MS = 450

/**
 * 团队工作区悬浮详情卡片：悬停在侧边栏的团队文件夹行上时，显示在时间旗标
 * 右侧，展示成员列表、工作区路径，以及「项目简介」（点击「让领班总结」由
 * leader 智能体生成）。
 *
 * 延迟消失：离开行后保留一个缓冲窗口；卡片自身 hover 时保持不消失。
 * Portaled 到 document.body。
 */
export function TeamWorkspaceHoverCard({
  hostRef,
  isHovered,
  teamId,
  workspace,
}: TeamWorkspaceHoverCardProps) {
  const t = useTranslations("Team.hoverCard")
  const { sendPrompt } = useAcpActions()
  const [team, setTeam] = useState<Team | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [requestedAt, setRequestedAt] = useState<number | null>(null)
  const [cardHovered, setCardHovered] = useState(false)
  // 行与卡片都离开后，延迟 HIDE_DELAY_MS 再真正隐藏，给鼠标留出从行
  // 滑到卡片的时间。
  const [dismissed, setDismissed] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 只要行或卡片任一在 hover，立即取消隐藏。
  const active = isHovered || cardHovered
  useEffect(() => {
    if (active && hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [active])

  // 行与卡片都离开时，启动延迟隐藏定时器。
  useEffect(() => {
    if (!active) {
      if (!hideTimerRef.current) {
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null
          setDismissed(true)
        }, HIDE_DELAY_MS)
      }
    } else if (dismissed) {
      setDismissed(false)
    }
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [active, dismissed])

  // Load full team detail (slots with member names) while visible.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    void teamGet(teamId)
      .then((tm) => {
        if (!cancelled) setTeam(tm)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active, teamId])

  const leaderSlot = useMemo(
    () => team?.slots.find((s) => s.roles.includes("leader")) ?? null,
    [team]
  )
  const leaderConvId = team?.leader_conversation_id ?? null

  // Live-read the leader conversation's latest assistant text as the summary.
  const leaderTurns = useConversationRuntimeStore((s) =>
    selectTimelineTurns(s, leaderConvId ?? 0)
  )
  const summary = useMemo(() => {
    if (!leaderConvId) return null
    for (let i = leaderTurns.length - 1; i >= 0; i--) {
      const txt = leaderTurns[i].turn.blocks
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join(" ")
        .trim()
      if (txt) return txt
    }
    return null
  }, [leaderConvId, leaderTurns])

  const folderId = useMemo(() => {
    const folders = useAppWorkspaceStore.getState().folders
    return (
      folders.find((f) => f.path === workspace && f.kind !== "chat")?.id ?? null
    )
  }, [workspace])

  const summarizeWithLeader = useCallback(async () => {
    if (!team || leaderConvId == null || !leaderSlot || !folderId) return
    setSummarizing(true)
    try {
      const tabs = useTabStore.getState().rawTabs
      let tabId = tabs.find(
        (tab) =>
          tab.kind === "conversation" &&
          tab.conversationId === leaderConvId &&
          tab.folderId === folderId
      )?.id
      if (!tabId) {
        useTabStore
          .getState()
          .openTab(folderId, leaderConvId, leaderSlot.agent_type)
        tabId = useTabStore
          .getState()
          .rawTabs.find(
            (tab) =>
              tab.kind === "conversation" &&
              tab.conversationId === leaderConvId &&
              tab.folderId === folderId
          )?.id
      }
      if (!tabId) return

      const prompt = t("summarizePrompt", { path: workspace })
      await sendPrompt(tabId, [{ type: "text", text: prompt }], {
        folderId,
        conversationId: leaderConvId,
      })
      setRequestedAt(Date.now())
    } catch (err) {
      console.error("[Team] summarize with leader failed:", err)
    } finally {
      setSummarizing(false)
    }
  }, [team, leaderConvId, leaderSlot, folderId, workspace, sendPrompt, t])

  // Wait for the row + card both to be gone before unmounting.
  if (dismissed || !hostRef.current) return null

  const rect = hostRef.current.getBoundingClientRect()
  const members = team?.slots ?? []
  const leader = members.find((m) => m.roles.includes("leader"))
  const teammates = members.filter((m) => !m.roles.includes("leader"))
  const showSummary = summary != null
  const summaryPending = requestedAt != null && !showSummary

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[9999] w-80"
      style={{
        top: rect.top + rect.height / 2,
        left: rect.right + TEAM_CARD_RIGHT_OFFSET_PX,
        transform: "translateY(-50%)",
      }}
      onMouseEnter={() => {
        setCardHovered(true)
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current)
          hideTimerRef.current = null
        }
      }}
      onMouseLeave={() => setCardHovered(false)}
    >
      <div className="overflow-hidden rounded-lg border border-border bg-sidebar text-sidebar-foreground shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">
            {team?.name ?? t("loading")}
          </span>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          {/* Workspace path */}
          <div className="flex items-start gap-2 text-xs">
            <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-all leading-relaxed text-muted-foreground">
              {workspace}
            </span>
          </div>

          {/* Members */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t("members")}
            </p>
            {members.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                {t("loadingMembers")}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {leader && <MemberRow slot={leader} isLeader />}
                {teammates.map((m) => (
                  <MemberRow key={m.id} slot={m} />
                ))}
              </div>
            )}
          </div>

          {/* Project summary */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t("projectSummary")}
            </p>
            {showSummary ? (
              <p className="rounded-md bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-sidebar-foreground/90">
                {summary}
              </p>
            ) : summaryPending ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                {t("waitingSummary")}
              </p>
            ) : (
              <>
                <p className="text-xs leading-relaxed text-muted-foreground/70">
                  {t("summaryHint")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 self-start text-xs"
                  disabled={summarizing || leaderConvId == null}
                  onClick={() => void summarizeWithLeader()}
                >
                  {summarizing ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {summarizing ? t("summarizing") : t("summarizeAction")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function MemberRow({
  slot,
  isLeader = false,
}: {
  slot: TeamSlot
  isLeader?: boolean
}) {
  const roleLabel = slot.roles.join("/")
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5",
        isLeader && "bg-amber-400/10"
      )}
    >
      <AgentIcon agentType={slot.agent_type} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {slot.display_name}
      </span>
      <span className="shrink-0 text-[0.6875rem] text-muted-foreground/70">
        {roleLabel}
      </span>
    </div>
  )
}
