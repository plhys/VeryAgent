"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bot,
  Cpu,
  Puzzle,
  Check,
  Loader2,
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
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
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
  expertsUnlinkFromAgent,
  officecliListSkills,
  officecliSkillLinkToAgent,
  officecliSkillUnlinkFromAgent,
  mcpScanLocal,
} from "@/lib/api"
import type {
  AgentType,
  ExpertListItem,
  OfficecliSkill,
  LocalMcpServer,
  AgentSkillItem,
  McpAppType,
} from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"
import { useTabStore } from "@/contexts/tab-context"

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

function presentAgentScope(agentLabel: string, locale: string): string {
  if (locale.toLowerCase().startsWith("zh")) {
    return `当前入口智能体 · ${agentLabel}`
  }
  return `Current entry agent · ${agentLabel}`
}

function presentScopedEmptyState(
  kind: "skills" | "plugins",
  agentLabel: string,
  locale: string
): string {
  if (locale.toLowerCase().startsWith("zh")) {
    return kind === "skills"
      ? `${agentLabel} 当前没有可安装的技能`
      : `${agentLabel} 当前没有相关插件`
  }
  return kind === "skills"
    ? `No installable skills for ${agentLabel}`
    : `No plugins for ${agentLabel}`
}

function agentTypeToMcpAppType(agentType: AgentType | null): McpAppType | null {
  switch (agentType) {
    case "claude_code":
    case "codex":
    case "gemini":
    case "open_claw":
    case "open_code":
    case "cline":
    case "hermes":
    case "code_buddy":
    case "kimi_code":
      return agentType
    default:
      return null
  }
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
  // Expert skills
  brainstorming: {
    name: "头脑风暴",
    description:
      "在进行任何创造性工作之前，先充分探索用户意图、需求和设计方案。",
  },
  "writing-plans": {
    name: "编写计划",
    description: "为多步骤任务编写细粒度实现计划，明确代码与文件路径。",
  },
  "executing-plans": {
    name: "执行计划",
    description: "在独立会话中执行既定实现计划，并带有审核检查点。",
  },
  "subagent-driven-development": {
    name: "子代理驱动开发",
  },
  "dispatching-parallel-agents": {
    name: "并行代理派发",
  },
  "using-git-worktrees": {
    name: "使用 Git Worktree",
  },
  "test-driven-development": {
    name: "测试驱动开发",
  },
  "verification-before-completion": {
    name: "完成前验证",
  },
  "systematic-debugging": {
    name: "系统化调试",
  },
  "requesting-code-review": {
    name: "请求代码评审",
  },
  "receiving-code-review": {
    name: "处理代码评审反馈",
  },
  "finishing-a-development-branch": {
    name: "收尾开发分支",
  },
  "using-superpowers": {
    name: "使用 Superpowers",
  },
  "writing-skills": {
    name: "编写专家技能",
  },
  // Paseo skills
  paseo: {
    name: "Paseo",
    description: "管理代理和工作树的基础技能",
  },
  "paseo-advisor": {
    name: "Paseo 顾问",
    description: "启动一个顾问代理，为当前任务提供第二意见",
  },
  "paseo-committee": {
    name: "Paseo 委员会",
    description: "组建两个高推理代理委员会，进行根因分析和方案制定",
  },
  "paseo-handoff": {
    name: "Paseo 移交",
    description: "将当前任务完整移交给另一个代理",
  },
  "paseo-loop": {
    name: "Paseo 循环",
    description: "让代理持续循环执行，直到满足退出条件",
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

/* ------------------------------------------------------------------ */
/*  Expert Card                                                        */
/* ------------------------------------------------------------------ */

function ExpertCard({
  expert,
  locale,
  enabled,
  onToggle,
  togglingId,
}: {
  expert: ExpertListItem
  locale: string
  enabled: boolean
  onToggle: (id: string) => void
  togglingId: string | null
}) {
  const name = pickLocalizedText(
    expert.metadata.display_name,
    locale,
    expert.metadata.id
  )
  const desc = pickLocalizedText(expert.metadata.description, locale, "")
  const category = expert.metadata.category
  const isToggling = togglingId === expert.metadata.id
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
            <Switch
              checked={enabled}
              onCheckedChange={() => onToggle(expert.metadata.id)}
              disabled={isToggling}
              aria-label={
                locale.toLowerCase().startsWith("zh")
                  ? enabled
                    ? `从当前智能体停用${name}`
                    : `对当前智能体启用${name}`
                  : enabled
                    ? `Disable ${name} for current agent`
                    : `Enable ${name} for current agent`
              }
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={getCategoryTone(category)} className="text-[0.625rem]">
          {getCategoryLabel(category)}
        </Badge>
        {enabled && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            {locale.toLowerCase().startsWith("zh") ? "已启用" : "Enabled"}
          </span>
        )}
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
  enabled,
  onToggle,
  togglingId,
}: {
  skill: OfficecliSkill
  locale: string
  enabled: boolean
  onToggle: (id: string) => void
  togglingId: string | null
}) {
  const name = pickLocalizedText(skill.displayName, locale, skill.id)
  const desc = pickLocalizedText(skill.description, locale, "")
  const isToggling = togglingId === skill.id
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
            <Switch
              checked={enabled}
              onCheckedChange={() => onToggle(skill.id)}
              disabled={isToggling}
              aria-label={
                locale.toLowerCase().startsWith("zh")
                  ? enabled
                    ? `从当前智能体停用${name}`
                    : `对当前智能体启用${name}`
                  : enabled
                    ? `Disable ${name} for current agent`
                    : `Enable ${name} for current agent`
              }
            />
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
        {enabled && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            {locale.toLowerCase().startsWith("zh") ? "已启用" : "Enabled"}
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Plugin Card                                                        */
/* ------------------------------------------------------------------ */

function PluginCard({
  plugin,
  agentLabel,
  locale,
}: {
  plugin: LocalMcpServer
  agentLabel: string
  locale: string
}) {
  const t = useTranslations("SkillsAndTools")
  const scopeLabel = presentAgentScope(agentLabel, locale)

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Puzzle className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{plugin.id}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{scopeLabel}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[0.625rem]">
          {t("installedPlugins")}
        </Badge>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-3 w-3" />
          {locale.toLowerCase().startsWith("zh")
            ? `已对${agentLabel}启用`
            : `Enabled for ${agentLabel}`}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Skills Repository Tab                                              */
/* ------------------------------------------------------------------ */

function SkillsRepoTab({ onToggled }: { onToggled: () => void }) {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const navigatorLocale =
    typeof navigator !== "undefined" ? (navigator.language ?? locale) : locale
  const [experts, setExperts] = useState<ExpertListItem[]>([])
  const [officeSkills, setOfficeSkills] = useState<OfficecliSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const { currentAgent, lockedAgentType } = useSkillsPageAgentContext()
  const { enabledIds } = useEnabledSkillIds(lockedAgentType, true)

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

  const handleToggleExpert = useCallback(
    async (expertId: string) => {
      if (!lockedAgentType) return
      setTogglingId(expertId)
      const currentlyEnabled = enabledIds.has(expertId)
      try {
        if (currentlyEnabled) {
          await expertsUnlinkFromAgent({ expertId, agentType: lockedAgentType })
        } else {
          await expertsLinkToAgent({ expertId, agentType: lockedAgentType })
        }
        toast.success(
          navigatorLocale.toLowerCase().startsWith("zh")
            ? currentlyEnabled
              ? `已从${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}停用`
              : `已对${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}启用`
            : currentlyEnabled
              ? `Disabled for ${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}`
              : `Enabled for ${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}`
        )
        invalidateAgentSkillsCache(lockedAgentType)
        // Force-refresh the enabled-skill snapshot so the toggle reflects
        // immediately instead of waiting for the next window-focus event.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("focus"))
        }
        onToggled()
        await fetchData()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setTogglingId(null)
      }
    },
    [
      currentAgent?.name,
      enabledIds,
      fetchData,
      lockedAgentType,
      navigatorLocale,
      onToggled,
      t,
    ]
  )

  const handleToggleOfficeSkill = useCallback(
    async (skillId: string) => {
      if (!lockedAgentType) return
      setTogglingId(skillId)
      const currentlyEnabled = enabledIds.has(skillId)
      try {
        if (currentlyEnabled) {
          await officecliSkillUnlinkFromAgent({
            skillId,
            agentType: lockedAgentType,
          })
        } else {
          await officecliSkillLinkToAgent({
            skillId,
            agentType: lockedAgentType,
          })
        }
        toast.success(
          navigatorLocale.toLowerCase().startsWith("zh")
            ? currentlyEnabled
              ? `已从${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}停用`
              : `已对${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}启用`
            : currentlyEnabled
              ? `Disabled for ${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}`
              : `Enabled for ${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}`
        )
        invalidateAgentSkillsCache(lockedAgentType)
        // Force-refresh the enabled-skill snapshot so the toggle reflects
        // immediately instead of waiting for the next window-focus event.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("focus"))
        }
        onToggled()
        await fetchData()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setTogglingId(null)
      }
    },
    [
      currentAgent?.name,
      enabledIds,
      fetchData,
      lockedAgentType,
      navigatorLocale,
      onToggled,
      t,
    ]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  const hasExperts = experts.length > 0
  const hasOfficeSkills = officeSkills.length > 0

  if (!hasExperts && !hasOfficeSkills) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Cpu className="h-8 w-8" />
        <p className="text-sm">
          {presentScopedEmptyState(
            "skills",
            currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"],
            navigatorLocale
          )}
        </p>
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
                  locale={navigatorLocale}
                  enabled={enabledIds.has(expert.metadata.id)}
                  onToggle={handleToggleExpert}
                  togglingId={togglingId}
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
                  locale={navigatorLocale}
                  enabled={enabledIds.has(skill.id)}
                  onToggle={handleToggleOfficeSkill}
                  togglingId={togglingId}
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
  const locale = useLocale()
  const { currentAgent, lockedAgentType } = useSkillsPageAgentContext()
  const pluginAgentType = useMemo(
    () => agentTypeToMcpAppType(lockedAgentType),
    [lockedAgentType]
  )
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

  const filteredPlugins = useMemo(
    () =>
      pluginAgentType
        ? plugins.filter((plugin) => plugin.apps.includes(pluginAgentType))
        : [],
    [pluginAgentType, plugins]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  if (filteredPlugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Puzzle className="h-8 w-8" />
        <p className="text-sm">
          {presentScopedEmptyState(
            "plugins",
            currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"],
            locale
          )}
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="px-1 py-4 md:px-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPlugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              agentLabel={
                currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]
              }
              locale={locale}
            />
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
            {locale.toLowerCase().startsWith("zh")
              ? "当前入口智能体已启用技能"
              : "Enabled skills for current entry agent"}
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
  const locale = useLocale()
  const { fresh, availableAgents, currentAgent } = useSkillsPageAgentContext()
  // Bump this after each enable/disable toggle so the "已启用" tab
  // re-mounts and re-fetches the agent's current skill list.
  const [refreshKey, setRefreshKey] = useState(0)
  const handleToggleHappened = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

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
                  {locale.toLowerCase().startsWith("zh")
                    ? "以下内容仅针对当前入口智能体。开启开关后，技能将在「已启用」中可见并可在此智能体下使用。"
                    : "All content below is scoped to the current entry agent. Toggle on to make a skill available for this agent."}
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
                已启用
              </TabsTrigger>
              <TabsTrigger
                value="skillsRepo"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                技能库
              </TabsTrigger>
              <TabsTrigger
                value="pluginsRepo"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                插件库
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="currentAgent"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <CurrentAgentTab key={refreshKey} />
          </TabsContent>
          <TabsContent
            value="skillsRepo"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <SkillsRepoTab onToggled={handleToggleHappened} />
          </TabsContent>
          <TabsContent
            value="pluginsRepo"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <PluginsRepoTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
