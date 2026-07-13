"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
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
  Settings2,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { AgentIcon } from "@/components/agent-icon"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import {
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
  mcpSetServerApps,
} from "@/lib/api"
import { openSettingsWindow } from "@/lib/api"
import type {
  AgentType,
  ExpertListItem,
  OfficecliSkill,
  LocalMcpServer,
  McpAppType,
} from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"
import { useTabStore } from "@/contexts/tab-context"

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const SKILL_CATEGORY_LABELS: Record<string, { en: string; zh: string }> = {
  discovery: { en: "Coding", zh: "编程" },
  planning: { en: "Coding", zh: "编程" },
  execution: { en: "Coding", zh: "编程" },
  quality: { en: "Coding", zh: "编程" },
  debugging: { en: "Coding", zh: "编程" },
  review: { en: "Coding", zh: "编程" },
  meta: { en: "Coding", zh: "编程" },
  creative: { en: "Creative", zh: "创意" },
  "coding-agent": { en: "Coding", zh: "编程" },
  editor: { en: "Productivity", zh: "效率" },
  productivity: { en: "Office", zh: "办公" },
  "dev-workflow": { en: "Dev Workflow", zh: "开发流程" },
  system: { en: "System", zh: "系统" },
  other: { en: "Other", zh: "其他" },
}

function getCategoryLabel(category: string, locale: string): string {
  const entry = SKILL_CATEGORY_LABELS[category]
  if (!entry) return category
  return locale.toLowerCase().startsWith("zh") ? entry.zh : entry.en
}

function getCategoryTone(
  category: string
): "default" | "secondary" | "outline" {
  const tones: Record<string, "default" | "secondary" | "outline"> = {
    discovery: "default",
    planning: "default",
    execution: "default",
    quality: "default",
    debugging: "default",
    review: "default",
    meta: "secondary",
    creative: "outline",
    "coding-agent": "default",
    editor: "secondary",
    productivity: "secondary",
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

function SkillIcon({ name, className }: { name: string; className?: string }) {
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

/* ------------------------------------------------------------------ */
/*  Unified Skill Item (merges Expert + Office Skill)                 */
/* ------------------------------------------------------------------ */

interface UnifiedSkillItem {
  id: string
  name: Record<string, string>
  description: Record<string, string>
  category: string
  icon: string
  source: "expert" | "office"
}

function expertToUnified(expert: ExpertListItem): UnifiedSkillItem {
  return {
    id: expert.metadata.id,
    name: expert.metadata.display_name,
    description: expert.metadata.description,
    category: expert.metadata.category,
    icon: expert.metadata.icon ?? "",
    source: "expert",
  }
}

function officeSkillToUnified(skill: OfficecliSkill): UnifiedSkillItem {
  return {
    id: skill.id,
    name: skill.displayName,
    description: skill.description,
    category: skill.category,
    icon: skill.icon ?? "",
    source: "office",
  }
}

/* ------------------------------------------------------------------ */
/*  Unified Skill Card                                                */
/* ------------------------------------------------------------------ */

function SkillCard({
  skill,
  locale,
  enabled,
  onToggle,
  togglingId,
}: {
  skill: UnifiedSkillItem
  locale: string
  enabled: boolean
  onToggle: (id: string, source: "expert" | "office") => void
  togglingId: string | null
}) {
  const name = pickLocalizedText(skill.name, locale, skill.id)
  const desc = pickLocalizedText(skill.description, locale, "")
  const isToggling = togglingId === skill.id
  const iconName = skill.icon

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <SkillIcon name={iconName} className="h-4 w-4 text-primary" />
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
              onCheckedChange={() => onToggle(skill.id, skill.source)}
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
        <Badge variant={getCategoryTone(skill.category)} className="text-[0.625rem]">
          {getCategoryLabel(skill.category, locale)}
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
/*  Plugin Card (with enable/disable toggle)                          */
/* ------------------------------------------------------------------ */

function PluginCard({
  plugin,
  isEnabled,
  isToggling,
  onToggle,
  agentLabel,
  locale,
}: {
  plugin: LocalMcpServer
  isEnabled: boolean
  isToggling: boolean
  onToggle: (serverId: string, enable: boolean) => void
  agentLabel: string
  locale: string
}) {
  const specType = (plugin.spec as Record<string, unknown>)?.type ?? ""
  const transportBadge =
    specType === "stdio"
      ? locale.toLowerCase().startsWith("zh") ? "本地进程" : "Local"
      : specType === "sse"
        ? "SSE"
        : specType === "http" || specType === "streamable-http"
          ? "HTTP"
          : ""

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Puzzle className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{plugin.id}</p>
              {transportBadge && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {transportBadge}
                </p>
              )}
            </div>
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => onToggle(plugin.id, checked)}
              disabled={isToggling}
              aria-label={
                locale.toLowerCase().startsWith("zh")
                  ? isEnabled
                    ? `从当前智能体停用${plugin.id}`
                    : `对当前智能体启用${plugin.id}`
                  : isEnabled
                    ? `Disable ${plugin.id} for current agent`
                    : `Enable ${plugin.id} for current agent`
              }
            />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {transportBadge && (
          <Badge variant="outline" className="text-[0.625rem]">
            {transportBadge}
          </Badge>
        )}
        {isEnabled && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            {locale.toLowerCase().startsWith("zh")
              ? `已对${agentLabel}启用`
              : `Enabled for ${agentLabel}`}
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Enabled Tab (shows enabled skills + enabled plugins, with toggles) */
/* ------------------------------------------------------------------ */

function EnabledTab({ onToggled, refreshKey }: { onToggled: () => void; refreshKey: number }) {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const navigatorLocale =
    typeof navigator !== "undefined" ? (navigator.language ?? locale) : locale
  const { fresh, currentAgent, lockedAgentType } = useSkillsPageAgentContext()
  const { enabledIds } = useEnabledSkillIds(lockedAgentType, true)

  // Load unified skill list to know source (expert vs office) for toggle API
  const [allSkills, setAllSkills] = useState<UnifiedSkillItem[]>([])
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null)

  const fetchSkills = useCallback(async () => {
    setLoadingSkills(true)
    try {
      const [experts, officeSkills] = await Promise.all([
        expertsList(),
        officecliListSkills(),
      ])
      const unified: UnifiedSkillItem[] = [
        ...experts.map(expertToUnified),
        ...officeSkills.map(officeSkillToUnified),
      ]
      setAllSkills(unified)
    } catch {
      // silently ignore
    } finally {
      setLoadingSkills(false)
    }
  }, [])

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills, refreshKey])

  // Filter to only enabled skills
  const enabledSkills = useMemo(
    () => allSkills.filter((s) => enabledIds.has(s.id)),
    [allSkills, enabledIds]
  )

  const handleToggleSkill = useCallback(
    async (skillId: string, source: "expert" | "office") => {
      if (!lockedAgentType) return
      setTogglingSkillId(skillId)
      const currentlyEnabled = enabledIds.has(skillId)
      try {
        if (source === "expert") {
          if (currentlyEnabled) {
            await expertsUnlinkFromAgent({ expertId: skillId, agentType: lockedAgentType })
          } else {
            await expertsLinkToAgent({ expertId: skillId, agentType: lockedAgentType })
          }
        } else {
          if (currentlyEnabled) {
            await officecliSkillUnlinkFromAgent({ skillId, agentType: lockedAgentType })
          } else {
            await officecliSkillLinkToAgent({ skillId, agentType: lockedAgentType })
          }
        }
        const agentName = currentAgent?.name ?? AGENT_LABELS[lockedAgentType]
        toast.success(
          navigatorLocale.toLowerCase().startsWith("zh")
            ? currentlyEnabled
              ? `已从${agentName}停用`
              : `已对${agentName}启用`
            : currentlyEnabled
              ? `Disabled for ${agentName}`
              : `Enabled for ${agentName}`
        )
        invalidateAgentSkillsCache(lockedAgentType)
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("focus"))
        }
        onToggled()
        await fetchSkills()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setTogglingSkillId(null)
      }
    },
    [currentAgent?.name, enabledIds, fetchSkills, lockedAgentType, navigatorLocale, onToggled, t]
  )

  // Load plugins
  const pluginAgentType = useMemo(
    () => agentTypeToMcpAppType(lockedAgentType),
    [lockedAgentType]
  )
  const [plugins, setPlugins] = useState<LocalMcpServer[]>([])
  const [loadingPlugins, setLoadingPlugins] = useState(true)
  const [togglingPluginId, setTogglingPluginId] = useState<string | null>(null)

  const fetchPlugins = useCallback(async () => {
    setLoadingPlugins(true)
    try {
      const local = await mcpScanLocal()
      setPlugins(local)
    } catch {
      // silently ignore
    } finally {
      setLoadingPlugins(false)
    }
  }, [])

  useEffect(() => {
    fetchPlugins()
  }, [fetchPlugins, refreshKey])

  const enabledPlugins = useMemo(
    () =>
      pluginAgentType
        ? plugins.filter((p) => p.apps.includes(pluginAgentType))
        : [],
    [pluginAgentType, plugins]
  )

  const handleTogglePlugin = useCallback(
    async (serverId: string, enable: boolean) => {
      if (!pluginAgentType) return
      setTogglingPluginId(serverId)
      try {
        const plugin = plugins.find((p) => p.id === serverId)
        if (!plugin) return

        let newApps: McpAppType[]
        if (enable) {
          newApps = [...plugin.apps, pluginAgentType]
        } else {
          newApps = plugin.apps.filter((a) => a !== pluginAgentType)
        }

        await mcpSetServerApps(serverId, newApps)

        const agentName = currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]
        toast.success(
          navigatorLocale.toLowerCase().startsWith("zh")
            ? enable
              ? `已对${agentName}启用${serverId}`
              : `已从${agentName}停用${serverId}`
            : enable
              ? `Enabled ${serverId} for ${agentName}`
              : `Disabled ${serverId} for ${agentName}`
        )

        onToggled()
        await fetchPlugins()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setTogglingPluginId(null)
      }
    },
    [currentAgent?.name, fetchPlugins, lockedAgentType, navigatorLocale, pluginAgentType, plugins, onToggled, t]
  )

  const agentLabel = currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]

  if (!fresh) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  if (!currentAgent) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Cpu className="h-8 w-8" />
        <p className="text-sm">{t("noAgent")}</p>
      </div>
    )
  }

  const hasEnabledSkills = enabledSkills.length > 0
  const hasEnabledPlugins = enabledPlugins.length > 0
  const nothingEnabled = !hasEnabledSkills && !hasEnabledPlugins && !loadingSkills && !loadingPlugins

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-6 px-1 py-4 md:px-2">
        {nothingEnabled && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <Cpu className="h-8 w-8" />
            <p className="text-sm">
              {navigatorLocale.toLowerCase().startsWith("zh")
                ? "当前智能体没有启用任何技能或插件"
                : "No skills or plugins enabled for this agent"}
            </p>
          </div>
        )}

        {/* Enabled Skills sub-section */}
        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {navigatorLocale.toLowerCase().startsWith("zh")
              ? "已启用的技能"
              : "Enabled Skills"}
          </h4>
          {loadingSkills ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : hasEnabledSkills ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {enabledSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  locale={navigatorLocale}
                  enabled={true}
                  onToggle={handleToggleSkill}
                  togglingId={togglingSkillId}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("noSkills")}
            </p>
          )}
        </div>

        {/* Enabled Plugins sub-section */}
        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {navigatorLocale.toLowerCase().startsWith("zh")
              ? "已启用的插件"
              : "Enabled Plugins"}
          </h4>
          {loadingPlugins ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : hasEnabledPlugins ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {enabledPlugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  isEnabled={true}
                  isToggling={togglingPluginId === plugin.id}
                  onToggle={handleTogglePlugin}
                  agentLabel={agentLabel}
                  locale={navigatorLocale}
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("noPlugins")}
            </p>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------ */
/*  Skills Tab (unified expert + office skills)                       */
/* ------------------------------------------------------------------ */

function SkillsTab({ onToggled }: { onToggled: () => void }) {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const navigatorLocale =
    typeof navigator !== "undefined" ? (navigator.language ?? locale) : locale
  const [skills, setSkills] = useState<UnifiedSkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const { currentAgent, lockedAgentType } = useSkillsPageAgentContext()
  const { enabledIds } = useEnabledSkillIds(lockedAgentType, true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [experts, officeSkills] = await Promise.all([
        expertsList(),
        officecliListSkills(),
      ])
      const unified: UnifiedSkillItem[] = [
        ...experts.map(expertToUnified),
        ...officeSkills.map(officeSkillToUnified),
      ]
      unified.sort((a, b) => {
        const catA = getCategoryLabel(a.category, navigatorLocale)
        const catB = getCategoryLabel(b.category, navigatorLocale)
        if (catA !== catB) return catA.localeCompare(catB)
        const nameA = pickLocalizedText(a.name, navigatorLocale, a.id)
        const nameB = pickLocalizedText(b.name, navigatorLocale, b.id)
        return nameA.localeCompare(nameB)
      })
      setSkills(unified)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [navigatorLocale])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleToggle = useCallback(
    async (skillId: string, source: "expert" | "office") => {
      if (!lockedAgentType) return
      setTogglingId(skillId)
      const currentlyEnabled = enabledIds.has(skillId)
      try {
        if (source === "expert") {
          if (currentlyEnabled) {
            await expertsUnlinkFromAgent({ expertId: skillId, agentType: lockedAgentType })
          } else {
            await expertsLinkToAgent({ expertId: skillId, agentType: lockedAgentType })
          }
        } else {
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
        }
        const agentName = currentAgent?.name ?? AGENT_LABELS[lockedAgentType]
        toast.success(
          navigatorLocale.toLowerCase().startsWith("zh")
            ? currentlyEnabled
              ? `已从${agentName}停用`
              : `已对${agentName}启用`
            : currentlyEnabled
              ? `Disabled for ${agentName}`
              : `Enabled for ${agentName}`
        )
        invalidateAgentSkillsCache(lockedAgentType)
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

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Cpu className="h-8 w-8" />
        <p className="text-sm">
          {navigatorLocale.toLowerCase().startsWith("zh")
            ? `${currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]} 当前没有可安装的技能`
            : `No installable skills for ${currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]}`}
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="px-1 py-4 md:px-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              locale={navigatorLocale}
              enabled={enabledIds.has(skill.id)}
              onToggle={handleToggle}
              togglingId={togglingId}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------ */
/*  Plugins Tab (MCP servers scoped to current agent)                 */
/* ------------------------------------------------------------------ */

function PluginsTab({ onToggled }: { onToggled: () => void }) {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const { currentAgent, lockedAgentType } = useSkillsPageAgentContext()
  const pluginAgentType = useMemo(
    () => agentTypeToMcpAppType(lockedAgentType),
    [lockedAgentType]
  )
  const [plugins, setPlugins] = useState<LocalMcpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)

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

  const handleTogglePlugin = useCallback(
    async (serverId: string, enable: boolean) => {
      if (!pluginAgentType) return
      setTogglingId(serverId)
      try {
        const plugin = plugins.find((p) => p.id === serverId)
        if (!plugin) return

        let newApps: McpAppType[]
        if (enable) {
          newApps = [...plugin.apps, pluginAgentType]
        } else {
          newApps = plugin.apps.filter((a) => a !== pluginAgentType)
        }

        await mcpSetServerApps(serverId, newApps)

        const agentName = currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]
        toast.success(
          locale.toLowerCase().startsWith("zh")
            ? enable
              ? `已对${agentName}启用${serverId}`
              : `已从${agentName}停用${serverId}`
            : enable
              ? `Enabled ${serverId} for ${agentName}`
              : `Disabled ${serverId} for ${agentName}`
        )

        onToggled()
        await fetchData()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setTogglingId(null)
      }
    },
    [currentAgent?.name, fetchData, locale, lockedAgentType, pluginAgentType, plugins, onToggled, t]
  )

  const handleManagePlugins = useCallback(() => {
    openSettingsWindow("mcp")
  }, [])

  const agentLabel = currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]

  // Split plugins into two groups: enabled for current agent, and others
  const enabledPlugins = useMemo(
    () =>
      pluginAgentType
        ? plugins.filter((p) => p.apps.includes(pluginAgentType))
        : [],
    [pluginAgentType, plugins]
  )

  const otherPlugins = useMemo(
    () =>
      pluginAgentType
        ? plugins.filter((p) => !p.apps.includes(pluginAgentType))
        : plugins,
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

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
        <Puzzle className="h-8 w-8" />
        <p className="text-sm">
          {locale.toLowerCase().startsWith("zh")
            ? `暂无插件，可在设置中添加`
            : `No plugins yet. Add one in Settings`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleManagePlugins}
          className="gap-1.5"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {t("managePlugins")}
        </Button>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-4 px-1 py-4 md:px-2">
        {/* Enabled for current agent */}
        {enabledPlugins.length > 0 && (
          <div>
            <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {locale.toLowerCase().startsWith("zh")
                ? `已对${agentLabel}启用`
                : `Enabled for ${agentLabel}`}
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {enabledPlugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  isEnabled={true}
                  isToggling={togglingId === plugin.id}
                  onToggle={handleTogglePlugin}
                  agentLabel={agentLabel}
                  locale={locale}
                />
              ))}
            </div>
          </div>
        )}

        {/* Other available plugins */}
        {otherPlugins.length > 0 && (
          <div>
            <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {locale.toLowerCase().startsWith("zh")
                ? "其他可用插件"
                : "Other available plugins"}
            </h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {otherPlugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  isEnabled={false}
                  isToggling={togglingId === plugin.id}
                  onToggle={handleTogglePlugin}
                  agentLabel={agentLabel}
                  locale={locale}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManagePlugins}
            className="gap-1.5"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t("managePlugins")}
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------ */
/*  Skills Page Agent Context                                         */
/* ------------------------------------------------------------------ */

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
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function SkillsAndToolsPage() {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const { fresh, availableAgents, currentAgent } = useSkillsPageAgentContext()
  // Bump this after each enable/disable toggle so the "已启用" tab
  // re-mounts and re-fetches.
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
                    ? "以下内容仅针对当前入口智能体。开启开关后，技能或插件将在此智能体下可用。"
                    : "All content below is scoped to the current entry agent. Toggle on to make a skill or plugin available for this agent."}
                </p>
              </div>
            </div>
          </div>
        )}

        <Tabs
          defaultValue="enabled"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 pt-2">
            <TabsList
              className="inline-flex h-auto gap-6 border-none bg-transparent p-0"
              variant="line"
            >
              <TabsTrigger
                value="enabled"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {locale.toLowerCase().startsWith("zh") ? "已启用" : "Enabled"}
              </TabsTrigger>
              <TabsTrigger
                value="skills"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {locale.toLowerCase().startsWith("zh") ? "技能" : "Skills"}
              </TabsTrigger>
              <TabsTrigger
                value="plugins"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {locale.toLowerCase().startsWith("zh") ? "插件" : "Plugins"}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="enabled"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <EnabledTab key={refreshKey} refreshKey={refreshKey} onToggled={handleToggleHappened} />
          </TabsContent>
          <TabsContent
            value="skills"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <SkillsTab onToggled={handleToggleHappened} />
          </TabsContent>
          <TabsContent
            value="plugins"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <PluginsTab onToggled={handleToggleHappened} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
