"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bot,
  Cpu,
  Puzzle,
  Check,
  Download,
  Loader2,
  Plus,
  Lightbulb,
  ListTodo,
  PlayCircle,
  FlaskConical,
  GitBranch,
  GitFork,
  GitMerge,
  Bug,
  CheckCheck,
  FileCode2,
  MessageSquareQuote,
  MessageSquareReply,
  Sparkles,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AgentIcon } from "@/components/agent-icon"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import {
  useAgentSkills,
  invalidateAgentSkillsCache,
} from "@/hooks/use-agent-skills"
import { useEnabledSkillIds } from "@/hooks/use-enabled-skill-ids"
import {
  expertsList,
  expertsLinkToAgent,
  officecliListSkills,
  officecliInstall,
  officecliSkillLinkToAgent,
  mcpScanLocal,
} from "@/lib/api"
import type {
  AgentType,
  ExpertListItem,
  OfficecliSkill,
  LocalMcpServer,
  AgentSkillItem,
} from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"
import { OFFICE_ACTIONS } from "@/lib/office-actions"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useConversationSkillInjectStore, type ConversationSkillInjectPayload } from "@/stores/conversation-skill-inject-store"

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const CATEGORY_LABELS: Record<string, string> = {
  "coding-agent": "Coding Agent",
  editor: "Editor",
  productivity: "Productivity",
  "dev-workflow": "Dev Workflow",
  system: "System",
  other: "Other",
}

function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

function getCategoryTone(
  category: string
): "default" | "secondary" | "outline" {
  const tones: Record<string, "default" | "secondary" | "outline"> = {
    "coding-agent": "default",
    editor: "secondary",
    productivity: "outline",
    "dev-workflow": "secondary",
    system: "outline",
    other: "outline",
  }
  return tones[category] ?? "outline"
}

const EXPERT_ICONS: Record<string, typeof Lightbulb> = {
  Lightbulb,
  ListTodo,
  PlayCircle,
  FlaskConical,
  GitBranch,
  GitFork,
  GitMerge,
  Bug,
  CheckCheck,
  FileCode2,
  MessageSquareQuote,
  MessageSquareReply,
  Sparkles,
}

function ExpertIcon({ name, className }: { name: string; className?: string }) {
  const Icon = EXPERT_ICONS[name] ?? Cpu
  return <Icon className={className} />
}

function pickLocalizedText(
  value: Record<string, string> | undefined,
  locale: string,
  fallback: string
): string {
  return value?.[locale] ?? value?.en ?? fallback
}

const CURRENT_AGENT_SKILL_ZH: Record<
  string,
  { name: string; description?: string }
> = {
  "algorithmic-art": {
    name: "算法艺术",
  },
  docx: {
    name: "Word 文档",
  },
  pdf: {
    name: "PDF 工具",
  },
  pptx: {
    name: "PPT 演示",
  },
  xlsx: {
    name: "Excel 表格",
  },
  "officecli-docx": {
    name: "Word 文档",
  },
  "officecli-xlsx": {
    name: "Excel 表格",
  },
  "officecli-pptx": {
    name: "PPT 演示",
  },
  "officecli-pitch-deck": {
    name: "商业路演",
  },
  "officecli-academic-paper": {
    name: "学术论文",
  },
  "officecli-financial-model": {
    name: "财务模型",
  },
  "officecli-data-dashboard": {
    name: "数据看板",
  },
  "webapp-testing": {
    name: "网页测试",
  },
  "frontend-design": {
    name: "前端设计",
  },
  dogfood: {
    name: "体验测试",
  },
}

function presentCurrentAgentSkill(
  skill: AgentSkillItem,
  locale: string
): { name: string; description: string | null } {
  if (locale.toLowerCase().startsWith("zh")) {
    const localized = CURRENT_AGENT_SKILL_ZH[skill.id]
    if (localized) {
      return {
        name: localized.name,
        description: localized.description ?? skill.description,
      }
    }
  }

  return {
    name: skill.name,
    description: skill.description,
  }
}

interface RepoActionContext {
  activeTabId: string | null
  activeAgentType: AgentType | null
  activeAgentLabel: string
  enabledIds: Set<string>
  queueInject: (targetTabId: string, payload: ConversationSkillInjectPayload) => void
  openConversations: () => void
  switchTab: (tabId: string) => void
}

type SkillsPageAgent = ReturnType<typeof useAcpAgents>["agents"][number]

interface SkillsPageAgentContext {
  fresh: boolean
  availableAgents: SkillsPageAgent[]
  lockedAgentType: AgentType | null
  currentAgent: SkillsPageAgent | null
}

function useSkillsPageAgentContext(): SkillsPageAgentContext {
  const { agents, fresh } = useAcpAgents()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)

  const availableAgents = useMemo(
    () =>
      agents
        .filter((a) => a.enabled && a.available && a.installed_version !== null)
        .sort((a, b) => a.sort_order - b.sort_order),
    [agents]
  )

  const currentConversation = tabs.find((tab) => tab.id === activeTabId) ?? null
  const entryAgentType = currentConversation?.agentType ?? null
  const lockedAgentType = availableAgents.find(
    (a) => a.agent_type === entryAgentType
  )
    ? entryAgentType
    : (availableAgents[0]?.agent_type ?? null)

  const currentAgent =
    availableAgents.find((a) => a.agent_type === lockedAgentType) ?? null

  return {
    fresh,
    availableAgents,
    lockedAgentType,
    currentAgent,
  }
}

function useRepoActionContext(): RepoActionContext {
  const { openConversations } = useWorkbenchRoute()
  const { switchTab } = useTabActions()
  const queueInject = useConversationSkillInjectStore((s) => s.queueInject)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const currentConversation = tabs.find((tab) => tab.id === activeTabId) ?? null
  const activeAgentType = currentConversation?.agentType ?? null
  const { enabledIds } = useEnabledSkillIds(activeAgentType, true)

  return {
    activeTabId,
    activeAgentType,
    activeAgentLabel: activeAgentType ? AGENT_LABELS[activeAgentType] : "",
    enabledIds,
    queueInject,
    openConversations,
    switchTab,
  }
}

/* ------------------------------------------------------------------ */
/*  Expert Card                                                        */
/* ------------------------------------------------------------------ */

function ExpertCard({
  expert,
  locale,
  onInstall,
  onUse,
  installingId,
  addingToAgentId,
}: {
  expert: ExpertListItem
  locale: string
  onInstall: (id: string) => void
  onUse: (expert: ExpertListItem) => void
  installingId: string | null
  addingToAgentId: string | null
}) {
  const t = useTranslations("SkillsAndTools")
  const name = pickLocalizedText(
    expert.metadata.display_name,
    locale,
    expert.metadata.id
  )
  const desc = pickLocalizedText(expert.metadata.description, locale, "")
  const category = expert.metadata.category
  const isInstalling = installingId === expert.metadata.id
  const isAddingToAgent = addingToAgentId === expert.metadata.id
  const iconName = expert.metadata.icon ?? ""

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <ExpertIcon name={iconName} className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              {desc && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {desc}
                </p>
              )}
            </div>
            {expert.installed_centrally ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 cursor-pointer"
                onClick={() => onUse(expert)}
                disabled={isAddingToAgent}
                title={t("useInConversation")}
              >
                {isAddingToAgent ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => onInstall(expert.metadata.id)}
                disabled={isInstalling}
                title={t("install")}
              >
                {isInstalling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={getCategoryTone(category)} className="text-[0.625rem]">
          {getCategoryLabel(category)}
        </Badge>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Office Skill Card                                                  */
/* ------------------------------------------------------------------ */

function OfficeSkillCard({
  skill,
  locale,
  onInstall,
  onUse,
  installingId,
  addingToAgentId,
}: {
  skill: OfficecliSkill
  locale: string
  onInstall: (id: string) => void
  onUse: (skill: OfficecliSkill) => void
  installingId: string | null
  addingToAgentId: string | null
}) {
  const t = useTranslations("SkillsAndTools")
  const name = pickLocalizedText(skill.displayName, locale, skill.id)
  const desc = pickLocalizedText(skill.description, locale, "")
  const isInstalling = installingId === skill.id
  const isAddingToAgent = addingToAgentId === skill.id
  const iconName = skill.icon

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <ExpertIcon name={iconName} className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              {desc && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {desc}
                </p>
              )}
            </div>
            {skill.installedCentrally ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 cursor-pointer"
                onClick={() => onUse(skill)}
                disabled={isAddingToAgent}
                title={t("useInConversation")}
              >
                {isAddingToAgent ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => onInstall(skill.id)}
                disabled={isInstalling}
                title={t("install")}
              >
                {isInstalling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          variant={getCategoryTone(skill.category)}
          className="text-[0.625rem]"
        >
          {getCategoryLabel(skill.category)}
        </Badge>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Plugin Card                                                        */
/* ------------------------------------------------------------------ */

function PluginCard({ plugin }: { plugin: LocalMcpServer }) {
  const t = useTranslations("SkillsAndTools")

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Puzzle className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{plugin.id}</p>
          {plugin.apps && plugin.apps.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {plugin.apps.join(", ")}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[0.625rem]">
          {t("installedPlugins")}
        </Badge>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-3 w-3" />
          {t("active")}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Skills Repository Tab                                              */
/* ------------------------------------------------------------------ */

function SkillsRepoTab() {
  const t = useTranslations("SkillsAndTools")
  const tQuick = useTranslations("Folder.chat.welcomePanel.quickActions")
  const [experts, setExperts] = useState<ExpertListItem[]>([])
  const [officeSkills, setOfficeSkills] = useState<OfficecliSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [autoEnablingId, setAutoEnablingId] = useState<string | null>(null)
  const {
    activeTabId,
    activeAgentType,
    enabledIds,
    queueInject,
    openConversations,
    switchTab,
  } = useRepoActionContext()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [ex, ofc] = await Promise.all([
        expertsList(),
        officecliListSkills(),
      ])
      setExperts(ex)
      setOfficeSkills(ofc)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleInstallExpert = useCallback(
    async (expertId: string) => {
      setInstallingId(expertId)
      try {
        const agentType = activeAgentType ?? "codex"
        await expertsLinkToAgent({ expertId, agentType })
        toast.success(t("installSuccess") || `Installed ${expertId}`)
        invalidateAgentSkillsCache(agentType)
        await fetchData()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setInstallingId(null)
      }
    },
    [activeAgentType, fetchData, t]
  )

  const handleInstallOfficeSkill = useCallback(
    async (skillId: string) => {
      setInstallingId(skillId)
      try {
        const taskId = `officecli-install-${Date.now()}`
        await officecliInstall(taskId)
        toast.success(t("installSuccess") || `Installed ${skillId}`)
        await fetchData()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setInstallingId(null)
      }
    },
    [fetchData, t]
  )

  const injectSkill = useCallback(
    async (
      skill: { id: string; label: string },
      text: string,
      autoEnable?: () => Promise<void>
    ) => {
      if (!activeTabId) {
        openConversations()
        toast.error(t("noActiveConversation"))
        return
      }

      if (!enabledIds.has(skill.id) && autoEnable) {
        setAutoEnablingId(skill.id)
        try {
          await autoEnable()
          invalidateAgentSkillsCache(activeAgentType ?? undefined)
        } catch (err) {
          toast.error(t("addToAgentFailed", { error: String(err) }))
          return
        } finally {
          setAutoEnablingId(null)
        }
      }

      switchTab(activeTabId)
      openConversations()
      requestAnimationFrame(() => {
        queueInject(activeTabId, { text, skill })
      })
      toast.success(t("useInConversationSuccess"))
    },
    [
      activeAgentType,
      activeTabId,
      enabledIds,
      openConversations,
      queueInject,
      switchTab,
      t,
    ]
  )

  const handleUseExpert = useCallback(
    (expert: ExpertListItem) => {
      const locale =
        typeof navigator !== "undefined" ? (navigator.language ?? "en") : "en"
      const label = pickLocalizedText(
        expert.metadata.display_name,
        locale,
        expert.metadata.id
      )
      void injectSkill(
        { id: expert.metadata.id, label },
        "",
        activeAgentType
          ? async () => {
              await expertsLinkToAgent({
                expertId: expert.metadata.id,
                agentType: activeAgentType,
              })
            }
          : undefined
      )
    },
    [activeAgentType, injectSkill]
  )

  const handleUseOffice = useCallback(
    (skill: OfficecliSkill) => {
      const locale =
        typeof navigator !== "undefined" ? (navigator.language ?? "en") : "en"
      const action = OFFICE_ACTIONS.find((item) => item.skillId === skill.id)
      const label = pickLocalizedText(skill.displayName, locale, skill.id)
      const prompt = action
        ? tQuick(action.promptKey as Parameters<typeof tQuick>[0])
        : ""
      void injectSkill(
        { id: skill.id, label },
        prompt,
        activeAgentType
          ? async () => {
              await officecliSkillLinkToAgent({
                skillId: skill.id,
                agentType: activeAgentType,
              })
            }
          : undefined
      )
    },
    [activeAgentType, injectSkill, tQuick]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  const locale =
    typeof navigator !== "undefined" ? (navigator.language ?? "en") : "en"

  const hasExperts = experts.length > 0
  const hasOfficeSkills = officeSkills.length > 0

  if (!hasExperts && !hasOfficeSkills) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Cpu className="h-8 w-8" />
        <p className="text-sm">{t("noSkills")}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-5 px-1 py-4 md:px-2">
        {hasExperts && (
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("codingExperts")}
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {experts.map((expert) => (
                <ExpertCard
                  key={expert.metadata.id}
                  expert={expert}
                  locale={locale}
                  onInstall={handleInstallExpert}
                  onUse={handleUseExpert}
                  installingId={installingId}
                  addingToAgentId={
                    autoEnablingId === expert.metadata.id
                      ? expert.metadata.id
                      : null
                  }
                />
              ))}
            </div>
          </div>
        )}

        {hasOfficeSkills && (
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("officeSkills")}
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {officeSkills.map((skill) => (
                <OfficeSkillCard
                  key={skill.id}
                  skill={skill}
                  locale={locale}
                  onInstall={handleInstallOfficeSkill}
                  onUse={handleUseOffice}
                  installingId={installingId}
                  addingToAgentId={
                    autoEnablingId === skill.id ? skill.id : null
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------ */
/*  Plugins Repository Tab                                             */
/* ------------------------------------------------------------------ */

function PluginsRepoTab() {
  const t = useTranslations("SkillsAndTools")
  const [plugins, setPlugins] = useState<LocalMcpServer[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const local = await mcpScanLocal()
      setPlugins(local)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Puzzle className="h-8 w-8" />
        <p className="text-sm">{t("noPlugins")}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="px-1 py-4 md:px-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} />
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------ */
/*  Current Agent Tab                                                  */
/* ------------------------------------------------------------------ */

function CurrentAgentTab() {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const { fresh, availableAgents, currentAgent } = useSkillsPageAgentContext()

  const skills: AgentSkillItem[] = useAgentSkills(
    currentAgent?.agent_type ?? "codex"
  )

  if (!fresh) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  if (!currentAgent || availableAgents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Bot className="h-8 w-8" />
        <p className="text-sm">{t("noAgent")}</p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-5 px-1 py-4 md:px-2">
        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("availableToAgent")}
          </h4>
          {skills.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("noSkills")}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {skills.map((skill: AgentSkillItem) => {
                const presentation = presentCurrentAgentSkill(skill, locale)
                return (
                  <div
                    key={skill.id}
                    className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30 md:p-5"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                        <Cpu className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {presentation.name}
                        </p>
                        {presentation.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {presentation.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function SkillsAndToolsPage() {
  const t = useTranslations("SkillsAndTools")
  const { fresh, availableAgents, currentAgent } = useSkillsPageAgentContext()

  return (
    <div className="flex h-full flex-col px-4 pb-4 md:px-6 lg:px-8">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
            <Cpu className="h-4 w-4 text-primary" />
          </div>
          <h1 className="text-sm font-semibold">{t("title")}</h1>
        </div>

        {fresh && currentAgent && availableAgents.length > 0 && (
          <div className="mt-4 rounded-2xl border bg-card p-3 md:p-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <AgentIcon
                  agentType={currentAgent.agent_type}
                  className="h-4.5 w-4.5 text-primary"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">
                    {currentAgent.name}
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.625rem] font-medium text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {t("currentAgentLocked")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("entryAgentHint")}
                </p>
              </div>
            </div>
          </div>
        )}

        <Tabs
          defaultValue="currentAgent"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 pt-2">
            <TabsList
              className="inline-flex h-auto gap-6 border-none bg-transparent p-0"
              variant="line"
            >
              <TabsTrigger
                value="currentAgent"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("tabCurrentAgent")}
              </TabsTrigger>
              <TabsTrigger
                value="skillsRepo"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("tabSkillsRepo")}
              </TabsTrigger>
              <TabsTrigger
                value="pluginsRepo"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("tabPluginsRepo")}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="currentAgent"
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <CurrentAgentTab />
          </TabsContent>
          <TabsContent
            value="skillsRepo"
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <SkillsRepoTab />
          </TabsContent>
          <TabsContent
            value="pluginsRepo"
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <PluginsRepoTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
