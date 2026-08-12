"use client"

import { useMemo, useState } from "react"
import { Crown, FolderOpenDot, Loader2, Users } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AgentIcon } from "@/components/agent-icon"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { DirectoryBrowserDialog } from "@/components/shared/directory-browser-dialog"
import { isDesktop, openFileDialog } from "@/lib/platform"
import { getActiveRemoteConnectionId } from "@/lib/transport"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useTeams } from "@/contexts/team-context"
import { useAcpActions } from "@/contexts/acp-connections-context"
import {
  createConversation,
  teamCreate,
  teamGet,
  teamSetLeaderConversation,
} from "@/lib/api"
import { AGENT_LABELS, type AgentType } from "@/lib/types"
import { cn } from "@/lib/utils"

type RoleId = "leader" | "dev" | "test" | "doc" | "review"
type TemplateId = "3" | "4" | "5"

/** i18n keys live in the `Team` namespace; the unions keep `t(...)` type-checked
 *  against the typed message catalog (same idiom as automation-templates.ts). */
type TemplateLabelKey = "template3" | "template4" | "template5"
type TemplateDescKey = "template3Desc" | "template4Desc" | "template5Desc"
type RoleLabelKey =
  "roleLeader" | "roleDev" | "roleTest" | "roleDoc" | "roleReview"
type RoleHintKey =
  | "roleLeaderHint"
  | "roleDevHint"
  | "roleTestHint"
  | "roleDocHint"
  | "roleReviewHint"

interface TemplateDef {
  id: TemplateId
  labelKey: TemplateLabelKey
  descKey: TemplateDescKey
  roles: RoleId[]
}

/** Preset team lineups — new users pick a size instead of designing roles. */
const TEMPLATES: TemplateDef[] = [
  {
    id: "3",
    labelKey: "template3",
    descKey: "template3Desc",
    roles: ["leader", "dev", "test"],
  },
  {
    id: "4",
    labelKey: "template4",
    descKey: "template4Desc",
    roles: ["leader", "dev", "test", "doc"],
  },
  {
    id: "5",
    labelKey: "template5",
    descKey: "template5Desc",
    roles: ["leader", "dev", "dev", "test", "review"],
  },
]

const ROLE_META: Record<
  RoleId,
  { labelKey: RoleLabelKey; hintKey: RoleHintKey }
> = {
  leader: { labelKey: "roleLeader", hintKey: "roleLeaderHint" },
  dev: { labelKey: "roleDev", hintKey: "roleDevHint" },
  test: { labelKey: "roleTest", hintKey: "roleTestHint" },
  doc: { labelKey: "roleDoc", hintKey: "roleDocHint" },
  review: { labelKey: "roleReview", hintKey: "roleReviewHint" },
}

const MAX_ROLES_PER_AGENT = 3
const MIN_MEMBERS = 2
const MAX_MEMBERS = 5

/**
 * 团队协作入口页 — 创建团队。
 *
 * 流程：选模板（决定角色位）→ 点/拖角色标签到智能体 → 填团队名 + 工作区 →
 * 校验通过后创建。一个智能体最多承担 3 个角色；领班唯一且必选。
 */
export function TeamPage() {
  const t = useTranslations("Team")
  const { agents } = useAcpAgents()
  const folders = useAppWorkspaceStore((s) => s.folders)
  const openFolder = useAppWorkspaceStore((s) => s.openFolder)

  const [template, setTemplate] = useState<TemplateDef>(TEMPLATES[0])
  // assignments[roleIdx] = the agent type carrying that role slot.
  const [assignments, setAssignments] = useState<(AgentType | null)[]>(() =>
    TEMPLATES[0].roles.map(() => null)
  )
  const [activeRole, setActiveRole] = useState<number | null>(null)
  const [teamName, setTeamName] = useState("")
  const [folderId, setFolderId] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const { openTab } = useTabActions()
  const { openConversations } = useWorkbenchRoute()
  const { bindLeaderConversation } = useTeams()
  const { sendPrompt } = useAcpActions()

  // Only enabled + available agents can join a team.
  const selectable = useMemo(
    () => agents.filter((a) => a.enabled && a.available),
    [agents]
  )
  const workspaceFolders = useMemo(
    () => folders.filter((f) => f.kind !== "chat"),
    [folders]
  )

  const selectTemplate = (next: TemplateDef) => {
    setTemplate(next)
    setAssignments(next.roles.map(() => null))
    setActiveRole(null)
  }

  const assign = (roleIdx: number, agent: AgentType) => {
    setActiveRole(null)
    if (assignments[roleIdx] === agent) {
      setAssignments((prev) => prev.map((a, i) => (i === roleIdx ? null : a)))
      return
    }
    const held = assignments.filter((a) => a === agent).length
    if (held >= MAX_ROLES_PER_AGENT) {
      toast.error(t("tooManyRoles"))
      return
    }
    setAssignments((prev) => prev.map((a, i) => (i === roleIdx ? agent : a)))
  }

  const assignedRoles = assignments.filter(Boolean).length
  const memberSet = useMemo(
    () => new Set(assignments.filter((a): a is AgentType => a != null)),
    [assignments]
  )
  const memberCount = memberSet.size
  const allAssigned = assignedRoles === template.roles.length
  const canCreate =
    allAssigned &&
    memberCount >= MIN_MEMBERS &&
    memberCount <= MAX_MEMBERS &&
    teamName.trim().length > 0 &&
    folderId !== "" &&
    !saving

  const pickWorkspaceFolder = async (path: string) => {
    try {
      const folder = await openFolder(path)
      setFolderId(String(folder.id))
    } catch (err) {
      toast.error(t("createFailed", { message: String(err) }))
    }
  }

  const handlePickWorkspace = async () => {
    if (isDesktop() && getActiveRemoteConnectionId() === null) {
      const selected = await openFileDialog({
        directory: true,
        multiple: false,
      })
      if (selected) {
        const path = Array.isArray(selected) ? selected[0] : selected
        await pickWorkspaceFolder(path)
      }
    } else {
      setBrowserOpen(true)
    }
  }

  const handleCreate = async () => {
    const folder = workspaceFolders.find((f) => String(f.id) === folderId)
    if (!folder) return
    const slotMap = new Map<AgentType, string[]>()
    assignments.forEach((agent, i) => {
      if (!agent) return
      const list = slotMap.get(agent) ?? []
      list.push(template.roles[i])
      slotMap.set(agent, list)
    })
    const draft = {
      name: teamName.trim(),
      workspace: folder.path,
      slots: [...slotMap.entries()].map(([agentType, roles]) => ({
        agent_type: agentType,
        display_name: AGENT_LABELS[agentType] ?? agentType,
        roles,
      })),
    }
    setSaving(true)
    try {
      const team = await teamCreate(draft)
      toast.success(t("createSuccess"))

      // Auto-open the leader conversation so the user lands in the chat with
      // the right-hand member strip visible. Errors here are surfaced loudly
      // (they were silently swallowed before, leaving teams with no leader
      // conversation and therefore no member strip).
      const leaderEntry = [...slotMap.entries()].find(([, roles]) =>
        roles.includes("leader")
      )
      if (!folder) {
        toast.error(t("workspaceMissing"))
      } else if (leaderEntry) {
        const [leaderAgent] = leaderEntry
        try {
          const convId = await createConversation(folder.id, leaderAgent)
          await teamSetLeaderConversation(team.id, convId)
          // Optimistically bind so the member strip shows immediately — the
          // backend team://changed refresh is async and made it appear only
          // intermittently before.
          bindLeaderConversation(team.id, convId)
          openConversations()
          openTab(folder.id, convId, leaderAgent, false, undefined, folder.path)

          // Inject the leader role prompt into the freshly-opened leader
          // conversation so the PM knows it has a team to decompose work for.
          // sendPrompt is buffered until the connection is established.
          const leaderPrompt = (await teamGet(team.id).catch(() => null))
            ?.leader_prompt
          if (leaderPrompt) {
            const tabId = useTabStore
              .getState()
              .rawTabs.find(
                (tab) =>
                  tab.kind === "conversation" &&
                  tab.conversationId === convId &&
                  tab.folderId === folder.id
              )?.id
            if (tabId) {
              await sendPrompt(
                tabId,
                [{ type: "text", text: leaderPrompt }],
                { folderId: folder.id, conversationId: convId }
              ).catch(() => {})
            }
          }
        } catch (err) {
          console.error("[Team] open leader conversation failed:", err)
          toast.error(t("leaderChatFailed"))
        }
      }

      setTeamName("")
      setFolderId("")
      setAssignments(template.roles.map(() => null))
      setActiveRole(null)
    } catch (e) {
      toast.error(t("createFailed", { message: String(e) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-7 px-6 py-7">
        <header>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Users
              className="h-5 w-5 text-muted-foreground"
              aria-hidden="true"
            />
            {t("title")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </header>

        {/* 1. Template picker */}
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("chooseTemplate")}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => selectTemplate(tmpl)}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                  "hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                  template.id === tmpl.id
                    ? "border-primary bg-primary/5"
                    : "border-sidebar-border"
                )}
              >
                <span className="text-sm font-medium">{t(tmpl.labelKey)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(tmpl.descKey)}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 2. Role slots from the template */}
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("roles")}
            <span className="ml-2 font-normal normal-case">
              {t("rolesCount", {
                count: assignedRoles,
                total: template.roles.length,
              })}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {template.roles.map((role, i) => {
              const assignedTo = assignments[i]
              const isActive = activeRole === i
              return (
                <button
                  key={i}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(i))
                    setActiveRole(i)
                  }}
                  onClick={() => setActiveRole(isActive ? null : i)}
                  title={t(ROLE_META[role].hintKey)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                    "cursor-pointer hover:border-primary/60",
                    isActive && "border-primary ring-2 ring-primary/30",
                    assignedTo
                      ? "border-primary/50 bg-primary/10"
                      : "border-sidebar-border bg-sidebar"
                  )}
                >
                  {role === "leader" ? (
                    <Crown
                      className="h-3 w-3 text-amber-500"
                      aria-hidden="true"
                    />
                  ) : null}
                  {t(ROLE_META[role].labelKey)}
                  {assignedTo ? (
                    <Badge
                      variant="secondary"
                      className="ml-0.5 px-1.5 text-[0.625rem]"
                    >
                      {AGENT_LABELS[assignedTo] ?? assignedTo}
                    </Badge>
                  ) : null}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("assignHint")}
          </p>
        </section>

        {/* 3. Agent cards */}
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("agents")}
            <span className="ml-2 font-normal normal-case">
              {t("membersCount", { count: memberCount })}
            </span>
          </h2>
          {selectable.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("agentDisabled")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {selectable.map((agent) => {
                const roles = template.roles.filter(
                  (_, i) => assignments[i] === agent.agent_type
                )
                const isAssigned = roles.length > 0
                return (
                  <div
                    key={agent.agent_type}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (activeRole != null)
                        assign(activeRole, agent.agent_type)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && activeRole != null) {
                        assign(activeRole, agent.agent_type)
                      }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const idx = Number(e.dataTransfer.getData("text/plain"))
                      if (!Number.isNaN(idx) && idx >= 0)
                        assign(idx, agent.agent_type)
                    }}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 transition-colors",
                      "hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                      isAssigned
                        ? "border-primary/60 bg-primary/5"
                        : "border-sidebar-border"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <AgentIcon
                        agentType={agent.agent_type}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="truncate text-sm font-medium">
                        {AGENT_LABELS[agent.agent_type] ?? agent.name}
                      </span>
                    </div>
                    {isAssigned ? (
                      <div className="flex flex-wrap gap-1">
                        {roles.map((r, ri) => (
                          <Badge
                            key={ri}
                            className="px-1.5 py-0 text-[0.625rem]"
                          >
                            {t(ROLE_META[r].labelKey)}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/70">
                        —
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* 4. Name + workspace */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-name">{t("teamName")}</Label>
            <Input
              id="team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder={t("teamNamePlaceholder")}
              maxLength={60}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-workspace">{t("workspace")}</Label>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={folderId}
                  onValueChange={setFolderId}
                  disabled={workspaceFolders.length === 0}
                >
                  <SelectTrigger id="team-workspace" className="w-full">
                    <SelectValue
                      placeholder={
                        workspaceFolders.length === 0
                          ? t("noWorkspace")
                          : t("workspacePlaceholder")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaceFolders.map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePickWorkspace}
                title={t("browseWorkspace")}
                className="shrink-0"
              >
                <FolderOpenDot className="h-3.5 w-3.5" aria-hidden="true" />
                {t("browseWorkspace")}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("workspaceHint")}
            </p>
            <DirectoryBrowserDialog
              open={browserOpen}
              onOpenChange={setBrowserOpen}
              onSelect={(path) => {
                setBrowserOpen(false)
                void pickWorkspaceFolder(path)
              }}
            />
          </div>
        </section>

        {/* 5. Validation + create */}
        <section className="flex items-center justify-between gap-4 border-t pt-5">
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {!allAssigned ? (
              <span>
                {t("rolesCount", {
                  count: assignedRoles,
                  total: template.roles.length,
                })}
              </span>
            ) : memberCount < MIN_MEMBERS ? (
              <span className="text-destructive">
                {t("needMoreMembers", { count: memberCount })}
              </span>
            ) : (
              <span>
                {t("rolesCount", {
                  count: assignedRoles,
                  total: template.roles.length,
                })}
                {" · "}
                {t("membersCount", { count: memberCount })}
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className="min-w-[8rem]"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {saving ? t("creating") : t("createTeam")}
          </Button>
        </section>
      </div>
    </ScrollArea>
  )
}
