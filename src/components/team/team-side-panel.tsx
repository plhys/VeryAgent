"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
} from "react"
import { Crown, Loader2, Maximize2, Send, Users } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AgentIcon } from "@/components/agent-icon"
import { MessageListView } from "@/components/message/message-list-view"
import { useTabStore } from "@/stores/tab-store"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTeams } from "@/contexts/team-context"
import {
  useAcpActions,
  useAcpEvent,
  useConnectionStore,
  type ConnectionState,
} from "@/contexts/acp-connections-context"
import {
  useConversationRuntimeActions,
  useConversationRuntimeStore,
  selectTimelineTurns,
} from "@/stores/conversation-runtime-store"
import { useConversationDetail } from "@/hooks/use-conversation-detail"
import { createConversation, teamAssignTask, teamGet } from "@/lib/api"
import {
  AGENT_LABELS,
  type Team,
  type TeamSlot,
  type TeamTask,
  type TeamTaskStatus,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/** i18n keys in the `Team` namespace — keep `t(...)` type-checked. */
type RoleLabelKey =
  "roleLeader" | "roleDev" | "roleTest" | "roleDoc" | "roleReview"
type TaskStatusKey =
  "taskPending" | "taskInProgress" | "taskCompleted" | "taskFailed"

const ROLE_LABEL_KEY: Record<string, RoleLabelKey> = {
  leader: "roleLeader",
  dev: "roleDev",
  test: "roleTest",
  doc: "roleDoc",
  review: "roleReview",
}

const TASK_STATUS_KEY: Record<TeamTaskStatus, TaskStatusKey> = {
  pending: "taskPending",
  in_progress: "taskInProgress",
  completed: "taskCompleted",
  failed: "taskFailed",
}

const TASK_STATUS_TONE: Record<TeamTaskStatus, string> = {
  pending: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
  in_progress:
    "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  completed:
    "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400",
  failed: "border-red-500/40 bg-red-500/10 text-red-500",
}

/** The member connection lives in the acp-connections store keyed by this. */
function memberKeyFor(slotId: string) {
  return `team-member-${slotId}`
}

/** Raw connection state for a member context (includes `liveMessage`). */
function useMemberConnection(memberKey: string): ConnectionState | undefined {
  const store = useConnectionStore()
  const subscribe = useCallback(
    (cb: () => void) => store.subscribeKey(memberKey, cb),
    [store, memberKey]
  )
  const getSnapshot = useCallback(
    () => (memberKey ? store.getConnection(memberKey) : undefined),
    [store, memberKey]
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Bridge a member connection's `liveMessage` + status transitions into the
 * runtime session for `convId`, so the mini window and the expanded view render
 * real-time deltas. Mirrors `sub-agent-session-dialog`'s `useChildLiveBridge`
 * (kept minimal: no kickoff synthesis, no session teardown — a member
 * conversation is a normal persistent conversation).
 */
function useMemberLiveBridge(memberKey: string, convId: number | null) {
  const conn = useMemberConnection(memberKey)
  const { setLiveMessage, completeTurn } = useConversationRuntimeActions()

  const connStatus = conn?.status ?? null
  const liveMessage = conn?.liveMessage ?? null

  const connStatusRef = useRef(connStatus)
  useEffect(() => {
    connStatusRef.current = connStatus
  }, [connStatus])

  // Streaming→settled: promote the live reply.
  const prevStatusRef = useRef(connStatus)
  useEffect(() => {
    const wasPrompting = prevStatusRef.current === "prompting"
    prevStatusRef.current = connStatus
    if (!convId || !wasPrompting || connStatus === "prompting") return
    completeTurn(convId, liveMessage)
  }, [connStatus, liveMessage, convId, completeTurn])

  // Mirror live deltas into the runtime store.
  useEffect(() => {
    if (convId != null && liveMessage != null) {
      setLiveMessage(convId, liveMessage, connStatus === "prompting")
    }
    return () => {
      if (convId != null && connStatusRef.current !== "prompting") {
        setLiveMessage(convId, null)
      }
    }
  }, [liveMessage, connStatus, convId, setLiveMessage])

  return conn
}

/**
 * Right-hand member window strip shown while the active conversation is a
 * team's leader chat. Each member gets an equal-height mini window that
 * streams the member's live conversation in small text, and clicking it opens
 * a dialog with the full conversation + the assign-task form.
 */
export function TeamSidePanel() {
  const t = useTranslations("Team")
  const activeTab = useTabStore((s) =>
    s.rawTabs.find((tab) => tab.id === s.activeTabId)
  )
  const { teamByLeaderConversation } = useTeams()
  const team = teamByLeaderConversation(activeTab?.conversationId)

  const [detail, setDetail] = useState<Team | null>(null)
  const [expandedSlot, setExpandedSlot] = useState<TeamSlot | null>(null)

  // Live-append auto-assigned members: the leader's `team_assign_task` MCP
  // tool spawns the member on the backend; the backend emits
  // `team_member_started` on the leader's stream. Attach the member
  // connection viewer-style under the same key the manual flow uses, so the
  // member window streams the work live without a user-driven connect.
  const { connectAsViewer } = useAcpActions()
  const teamWorkspaceRef = useRef<string | null>(null)
  teamWorkspaceRef.current = team?.workspace ?? null
  useAcpEvent(
    useCallback(
      (envelope) => {
        if (envelope.type !== "team_member_started") return
        const workspace = teamWorkspaceRef.current
        if (!workspace) return
        const memberKey = memberKeyFor(envelope.slot_id)
        void connectAsViewer(
          memberKey,
          envelope.member_connection_id,
          envelope.agent_type,
          workspace
        ).catch((err) => {
          console.warn("[Team] member viewer attach failed:", err)
        })
      },
      [connectAsViewer]
    )
  )

  useEffect(() => {
    if (!team) {
      setDetail(null)
      return
    }
    let cancelled = false
    void teamGet(team.id)
      .then((tm) => {
        if (!cancelled) setDetail(tm)
      })
      .catch(() => {
        // transient — refetch on next team://changed
      })
    return () => {
      cancelled = true
    }
  }, [team])

  const refreshDetail = useCallback(async (teamId: string) => {
    try {
      const tm = await teamGet(teamId)
      setDetail(tm)
    } catch {
      // transient
    }
  }, [])

  if (!team) return null

  const slots = detail?.slots ?? []
  // 领班/项目经理是主对话框本身，右侧成员窗格只显示成员，不重复显示领班。
  const memberSlots = slots.filter((slot) => !slot.roles.includes("leader"))

  return (
    <aside className="flex w-[19rem] shrink-0 flex-col border-l border-sidebar-border bg-sidebar/40">
      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{team.name}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {memberSlots.length}
        </span>
      </div>

      {/* Equal-height member windows, stacked vertically. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        {memberSlots.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {t("loadingMembers")}
          </p>
        ) : (
          memberSlots.map((slot) => (
            <MemberWindow
              key={slot.id}
              slot={slot}
              t={t}
              onExpand={() => setExpandedSlot(slot)}
            />
          ))
        )}
      </div>

      {/* Expanded member view: live conversation + assign-task + task list. */}
      <Dialog
        open={expandedSlot != null}
        onOpenChange={(open) => {
          if (!open) setExpandedSlot(null)
        }}
      >
        <DialogContent className="flex h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl">
          {expandedSlot ? (
            <MemberDialog
              slot={expandedSlot}
              detail={detail}
              teamId={team.id}
              workspace={team.workspace}
              onTaskAssigned={() => {
                if (detail) void refreshDetail(detail.id)
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </aside>
  )
}

function MemberWindow({
  slot,
  t,
  onExpand,
}: {
  slot: TeamSlot
  t: ReturnType<typeof useTranslations<"Team">>
  onExpand: () => void
}) {
  const isLeader = slot.roles.includes("leader")
  const convId = slot.conversation_id
  const memberKey = memberKeyFor(slot.id)

  // Stream the member's live conversation while there is one.
  const conn = useMemberLiveBridge(memberKey, convId)
  const status = conn?.status ?? null
  const active = status === "prompting"

  return (
    <button
      type="button"
      onClick={onExpand}
      title={t("expandHint")}
      className={cn(
        "group flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border text-left",
        "transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring",
        isLeader
          ? "border-amber-400/40 bg-amber-400/5"
          : "border-sidebar-border"
      )}
    >
      {/* Member header */}
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <AgentIcon
          agentType={slot.agent_type}
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className="truncate text-xs font-medium">
          {AGENT_LABELS[slot.agent_type] ?? slot.display_name}
        </span>
        <Badge
          variant={isLeader ? "default" : "secondary"}
          className="ml-auto px-1.5 py-0 text-[0.625rem] font-medium"
        >
          {slot.roles.map((r) => t(ROLE_LABEL_KEY[r] ?? "roleDev")).join("/")}
        </Badge>
        <Maximize2
          className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>

      {/* Small-text live content area. */}
      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-1.5">
        <div className="h-full overflow-hidden rounded bg-background/60 px-1.5 py-1 text-left">
          {convId ? (
            <MemberStream convId={convId} t={t} active={active} />
          ) : (
            <p className="line-clamp-6 break-words text-[0.625rem] leading-relaxed text-muted-foreground">
              {t("idleHint")}
            </p>
          )}
        </div>
      </div>

      {/* Live status dot */}
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            active
              ? "animate-pulse bg-blue-500"
              : status === "error"
                ? "bg-red-500"
                : convId
                  ? "bg-green-500"
                  : "bg-muted-foreground/40"
          )}
        />
        <span className="text-[0.625rem] text-muted-foreground">
          {active
            ? t("workingHint")
            : status === "error"
              ? t("slotError")
              : convId
                ? t("slotReady")
                : t("slotIdle")}
        </span>
      </div>
    </button>
  )
}

/** Compact mini-window renderer: last assistant text from the timeline. */
function MemberStream({
  convId,
  t,
  active,
}: {
  convId: number
  t: ReturnType<typeof useTranslations<"Team">>
  active: boolean
}) {
  const turns = useConversationRuntimeStore((s) =>
    selectTimelineTurns(s, convId)
  )
  const text = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const blocks = turns[i].turn.blocks
      const txt = blocks
        .filter((b) => b.type === "text")
        .map((b) => (b.type === "text" ? b.text : ""))
        .join(" ")
        .trim()
      if (txt) return txt
    }
    return ""
  }, [turns])

  if (!text) {
    return (
      <p className="line-clamp-6 break-words text-[0.625rem] leading-relaxed text-muted-foreground">
        {active ? t("workingHint") : t("slotIdle")}
      </p>
    )
  }
  return (
    <p className="line-clamp-6 break-words text-[0.625rem] leading-relaxed text-muted-foreground">
      {text}
    </p>
  )
}

function MemberDialog({
  slot,
  detail,
  teamId,
  workspace,
  onTaskAssigned,
}: {
  slot: TeamSlot
  detail: Team | null
  teamId: string
  workspace: string
  onTaskAssigned: () => void
}) {
  const t = useTranslations("Team")
  const convId = slot.conversation_id
  const memberKey = memberKeyFor(slot.id)
  const { connect, sendPrompt } = useAcpActions()

  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [assigning, setAssigning] = useState(false)

  const conn = useMemberLiveBridge(memberKey, convId)
  const connStatus = conn?.status ?? null

  const { loading, error, acpLoadError } = useConversationDetail(convId ?? 0, {
    enabled: convId != null && convId > 0,
  })

  const memberTasks = useMemo(
    () =>
      (detail?.tasks ?? []).filter((task) => task.owner_slot_id === slot.id),
    [detail, slot.id]
  )

  const handleAssign = async () => {
    const taskText = subject.trim()
    if (!taskText || assigning) return
    setAssigning(true)
    try {
      // 1. Resolve the team workspace folder id (path → folder).
      const folders = useAppWorkspaceStore.getState().folders
      let folder = folders.find(
        (f) => f.path === workspace && f.kind !== "chat"
      )
      if (!folder) {
        const openFolder = useAppWorkspaceStore.getState().openFolder
        folder = await openFolder(workspace)
      }
      if (!folder) {
        toast.error(t("workspaceMissing"))
        return
      }
      const folderId = folder.id

      // 2. Mint a fresh member conversation (one task = one focused session).
      const newConvId = await createConversation(
        folderId,
        slot.agent_type,
        taskText
      )

      // 3. Record the task + attach the conversation (backend also flips the
      //    member to "working").
      await teamAssignTask(
        teamId,
        slot.id,
        taskText,
        description || null,
        newConvId
      )

      // 4. Connect the member agent to that conversation.
      await connect(memberKey, slot.agent_type, workspace, undefined, newConvId)

      // 5. Send the task as the first prompt — the member starts working and
      //    the mini window streams the live reply.
      await sendPrompt(memberKey, [{ type: "text", text: taskText }], {
        folderId,
        conversationId: newConvId,
      })

      setSubject("")
      setDescription("")
      onTaskAssigned()
      toast.success(t("taskAssigned"))
    } catch (err) {
      console.error("[Team] assign task failed:", err)
      toast.error(t("taskAssignFailed", { message: String(err) }))
    } finally {
      setAssigning(false)
    }
  }

  return (
    <>
      <DialogHeader className="shrink-0 border-b px-5 py-3">
        <DialogTitle className="flex items-center gap-2">
          <AgentIcon agentType={slot.agent_type} className="h-5 w-5 shrink-0" />
          {AGENT_LABELS[slot.agent_type] ?? slot.display_name}
          {slot.roles.includes("leader") ? (
            <Crown className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          ) : null}
        </DialogTitle>
        <DialogDescription>
          {slot.roles.map((r) => t(ROLE_LABEL_KEY[r] ?? "roleDev")).join(" · ")}
        </DialogDescription>
      </DialogHeader>

      {/* Assign-task form */}
      <div className="flex shrink-0 flex-col gap-2 border-b px-5 py-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`task-${slot.id}`} className="text-xs">
              {t("taskSubject")}
            </Label>
            <Input
              id={`task-${slot.id}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("taskSubjectPlaceholder")}
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`task-desc-${slot.id}`} className="text-xs">
              {t("taskDescription")}
            </Label>
            <Textarea
              id={`task-desc-${slot.id}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("taskDescriptionPlaceholder")}
              className="min-h-[2.5rem] text-xs"
              rows={1}
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleAssign}
          disabled={!subject.trim() || assigning}
          className="self-end"
        >
          {assigning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {assigning ? t("assigning") : t("assignTask")}
        </Button>
      </div>

      {/* Live conversation */}
      <div className="min-h-0 flex-1">
        {convId ? (
          <MessageListView
            conversationId={convId}
            agentType={slot.agent_type}
            connStatus={connStatus}
            isActive={false}
            detailLoading={loading}
            detailError={error}
            acpLoadError={acpLoadError}
            hideEmptyState={false}
            showMessageNav={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {t("noConversationYet")}
          </div>
        )}
      </div>

      {/* Task history for this member */}
      {memberTasks.length > 0 ? (
        <div className="shrink-0 border-t px-5 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("memberTasks")}
          </p>
          <ScrollArea className="max-h-[10rem]">
            <div className="flex flex-col gap-1.5">
              {memberTasks.map((task) => (
                <TaskRow key={task.id} task={task} t={t} />
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : null}
    </>
  )
}

function TaskRow({
  task,
  t,
}: {
  task: TeamTask
  t: ReturnType<typeof useTranslations<"Team">>
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{task.subject}</p>
        {task.result ? (
          <p className="line-clamp-2 break-words text-[0.625rem] text-muted-foreground">
            {task.result}
          </p>
        ) : null}
      </div>
      <Badge
        variant="secondary"
        className={cn(
          "shrink-0 px-1.5 py-0 text-[0.625rem] font-medium",
          TASK_STATUS_TONE[task.status]
        )}
      >
        {t(TASK_STATUS_KEY[task.status])}
      </Badge>
    </div>
  )
}
