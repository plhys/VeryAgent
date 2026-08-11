"use client"

import { useEffect, useState } from "react"
import { Maximize2, Users } from "lucide-react"
import { useTranslations } from "next-intl"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AgentIcon } from "@/components/agent-icon"
import { useTabStore } from "@/stores/tab-store"
import { useTeams } from "@/contexts/team-context"
import { teamGet } from "@/lib/api"
import { AGENT_LABELS, type Team, type TeamSlot } from "@/lib/types"
import { cn } from "@/lib/utils"

/** i18n keys in the `Team` namespace — keep `t(...)` type-checked. */
type RoleLabelKey =
  | "roleLeader"
  | "roleDev"
  | "roleTest"
  | "roleDoc"
  | "roleReview"

const ROLE_LABEL_KEY: Record<string, RoleLabelKey> = {
  leader: "roleLeader",
  dev: "roleDev",
  test: "roleTest",
  doc: "roleDoc",
  review: "roleReview",
}

/**
 * Right-hand member window strip shown while the active conversation is a
 * team's leader chat. Each member gets an equal-height mini window that will
 * stream the member's live conversation in small text (UI scaffold now; the
 * live stream + task plumbing lands with the assign-task step).
 */
export function TeamSidePanel() {
  const t = useTranslations("Team")
  const activeTab = useTabStore((s) =>
    s.rawTabs.find((tab) => tab.id === s.activeTabId)
  )
  const { teams, teamByLeaderConversation } = useTeams()
  const team = teamByLeaderConversation(activeTab?.conversationId)

  const [detail, setDetail] = useState<Team | null>(null)
  const [expandedSlot, setExpandedSlot] = useState<TeamSlot | null>(null)

  // Temp diagnostics while the member strip's trigger is being verified.
  useEffect(() => {
    console.log(
      "[TeamSidePanel] tabId:",
      activeTab?.id,
      "convId:",
      activeTab?.conversationId,
      "teams:",
      teams.map((t) => `${t.id.slice(0, 6)}:${t.leader_conversation_id}`).join(","),
      "match:",
      team?.id ?? null
    )
  }, [activeTab?.conversationId, team, teams])

  useEffect(() => {
    if (!team) {
      setDetail(null)
      return
    }
    let cancelled = false
    void teamGet(team.id)
      .then((t) => {
        if (!cancelled) setDetail(t)
      })
      .catch(() => {
        // transient — refetch on next team://changed
      })
    return () => {
      cancelled = true
    }
  }, [team])

  if (!team) return null

  const slots = detail?.slots ?? []

  return (
    <aside className="flex w-[19rem] shrink-0 flex-col border-l border-sidebar-border bg-sidebar/40">
      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium">{team.name}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {slots.length}
        </span>
      </div>

      {/* Equal-height member windows, stacked vertically. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        {slots.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {t("loadingMembers")}
          </p>
        ) : (
          slots.map((slot) => (
            <MemberWindow
              key={slot.id}
              slot={slot}
              t={t}
              onExpand={() => setExpandedSlot(slot)}
            />
          ))
        )}
      </div>

      {/* Expanded member view */}
      <Dialog
        open={expandedSlot != null}
        onOpenChange={(open) => {
          if (!open) setExpandedSlot(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {expandedSlot ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AgentIcon
                    agentType={expandedSlot.agent_type}
                    className="h-5 w-5 shrink-0"
                  />
                  {AGENT_LABELS[expandedSlot.agent_type] ??
                    expandedSlot.display_name}
                </DialogTitle>
                <DialogDescription>
                  {expandedSlot.roles
                    .map((r) => t(ROLE_LABEL_KEY[r] ?? "roleDev"))
                    .join(" · ")}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] min-h-[20rem] rounded-md border p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("memberDetailPlaceholder")}
                </p>
              </ScrollArea>
            </>
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
  return (
    <button
      type="button"
      onClick={onExpand}
      title={t("expandHint")}
      className={cn(
        "group flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border text-left",
        "transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring",
        isLeader ? "border-amber-400/40 bg-amber-400/5" : "border-sidebar-border"
      )}
    >
      {/* Member header */}
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <AgentIcon agentType={slot.agent_type} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-xs font-medium">
          {AGENT_LABELS[slot.agent_type] ?? slot.display_name}
        </span>
        <Badge
          variant={isLeader ? "default" : "secondary"}
          className="ml-auto px-1.5 py-0 text-[0.625rem] font-medium"
        >
          {slot.roles
            .map((r) => t(ROLE_LABEL_KEY[r] ?? "roleDev"))
            .join("/")}
        </Badge>
        <Maximize2
          className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>

      {/* Small-text live content area (streams member conversation later). */}
      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-1.5">
        <div className="h-full overflow-hidden rounded bg-background/60 px-1.5 py-1 text-left">
          <p className="line-clamp-6 break-words text-[0.625rem] leading-relaxed text-muted-foreground">
            {slot.status === "idle" ? t("idleHint") : t("workingHint")}
          </p>
        </div>
      </div>
    </button>
  )
}
