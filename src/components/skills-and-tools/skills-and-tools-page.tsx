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
import { ImageGenerationConfigDialog } from "@/components/skills-and-tools/image-generation-config-dialog"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import {
  invalidateAgentSkillsCache,
} from "@/hooks/use-agent-skills"
import {
  refreshEnabledSkillIds,
  useEnabledSkillIds,
} from "@/hooks/use-enabled-skill-ids"
import {
  expertsList,
  expertsLinkToAgent,
  expertsUnlinkFromAgent,
  scienceList,
  scienceLinkToAgent,
  scienceUnlinkFromAgent,
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
  ScienceListItem,
  OfficecliSkill,
  LocalMcpServer,
  McpAppType,
} from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"
import { useTabStore } from "@/contexts/tab-context"

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

// Top-level filter groups shown in the Skills warehouse:
// 编程 / 艺术设计 / 科研 / 办公
// "creative" is a first-class group (not buried under 编程).
type SkillDisplayGroup = "expert" | "creative" | "science" | "office"

const SOURCE_ORDER: Record<SkillDisplayGroup, number> = {
  expert: 1,
  creative: 2,
  science: 3,
  office: 4,
}

// Category display order (lower = first). Used only to keep a stable order
// within the same source; not shown as filter chips.
const CATEGORY_ORDER: Record<string, number> = {
  // Experts
  discovery: 1, planning: 2, execution: 3, quality: 4,
  debugging: 5, review: 6, meta: 7, creative: 8,
  // Science
  ideation: 11, design: 12, analysis: 13,
  visualization: 14, evaluation: 15, literature: 16,
  // Office
  general: 21, presentations: 22, documents: 23, spreadsheets: 24,
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
  source: "expert" | "science" | "office"
}

/** Visible warehouse group for a skill (creative splits out of expert). */
function skillDisplayGroup(
  skill: Pick<UnifiedSkillItem, "source" | "category">
): SkillDisplayGroup {
  if (skill.category === "creative") return "creative"
  return skill.source
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

function scienceToUnified(skill: ScienceListItem): UnifiedSkillItem {
  return {
    id: skill.metadata.id,
    name: skill.metadata.display_name,
    description: skill.metadata.description,
    category: skill.metadata.category,
    icon: skill.metadata.icon ?? "",
    source: "science",
  }
}

/* ------------------------------------------------------------------ */
/*  Unified Skill Card                                                */
/* ------------------------------------------------------------------ */

/** Skills that expose a first-party Settings button on the card. */
const SKILLS_WITH_SETTINGS = new Set(["veryagent-image"])

/** Product display names that must win over embedded experts.toml (no rebuild). */
const SKILL_DISPLAY_NAME_OVERRIDE: Record<string, { zh: string; en: string }> =
  {
    "veryagent-image": { zh: "通用出图网关", en: "Universal Image Gateway" },
  }

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
  onToggle: (id: string, source: "expert" | "science" | "office") => void
  togglingId: string | null
}) {
  const t = useTranslations("SkillsAndTools")
  const isZhLocale = locale.toLowerCase().startsWith("zh")
  const nameOverride = SKILL_DISPLAY_NAME_OVERRIDE[skill.id]
  const name =
    nameOverride != null
      ? isZhLocale
        ? nameOverride.zh
        : nameOverride.en
      : pickLocalizedText(skill.name, locale, skill.id)
  const desc = pickLocalizedText(skill.description, locale, "")
  const isToggling = togglingId === skill.id
  const iconName = skill.icon
  const isZh = locale.toLowerCase().startsWith("zh")
  const hasSettings = SKILLS_WITH_SETTINGS.has(skill.id)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
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
              <div className="flex shrink-0 items-center gap-1.5">
                {hasSettings && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setSettingsOpen(true)}
                    aria-label={t("imageSkillSettingsAria", { name })}
                    title={t("imageSkillSettings")}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">
                      {t("imageSkillSettings")}
                    </span>
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={enabled ? "destructive" : "default"}
                  className="h-7 px-2.5 text-xs"
                  disabled={isToggling}
                  onClick={() => onToggle(skill.id, skill.source)}
                  aria-label={
                    isZh
                      ? enabled
                        ? `从当前智能体移除${name}`
                        : `添加${name}到当前智能体`
                      : enabled
                        ? `Remove ${name} from current agent`
                        : `Add ${name} to current agent`
                  }
                >
                  {isToggling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : enabled ? (
                    isZh ? "移除" : "Remove"
                  ) : (
                    isZh ? "添加" : "Add"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[0.625rem]">
            {(() => {
              const group = skillDisplayGroup(skill)
              if (group === "creative") return isZh ? "艺术设计" : "Art & Design"
              if (group === "expert") return isZh ? "编程" : "Coding"
              if (group === "science") return isZh ? "科研" : "Science"
              return isZh ? "办公" : "Office"
            })()}
          </Badge>
          {hasSettings && (
            <Badge variant="secondary" className="text-[0.625rem]">
              {t("imageSkillNeedsConfig")}
            </Badge>
          )}
          {enabled && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              {isZh ? "已添加" : "Added"}
            </span>
          )}
        </div>
      </div>
      {hasSettings && skill.id === "veryagent-image" && (
        <ImageGenerationConfigDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </>
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
  const { fresh, currentAgent, lockedAgentType } =
    useSkillsPageAgentContext()
  const { enabledIds } = useEnabledSkillIds(lockedAgentType, true)

  // Load unified skill list to know source (expert / science / office) for toggle API
  const [allSkills, setAllSkills] = useState<UnifiedSkillItem[]>([])
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null)

  const fetchSkills = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingSkills(true)
    try {
      // Isolate sources: one failing API (e.g. unregistered science_list)
      // must not wipe the whole warehouse.
      const [expertsResult, scienceResult, officeResult] = await Promise.allSettled([
        expertsList(),
        scienceList(),
        officecliListSkills(),
      ])
      const experts =
        expertsResult.status === "fulfilled" ? expertsResult.value : []
      const science =
        scienceResult.status === "fulfilled" ? scienceResult.value : []
      const officeSkills =
        officeResult.status === "fulfilled" ? officeResult.value : []
      if (expertsResult.status === "rejected") {
        console.warn("[SkillsAndTools] expertsList failed:", expertsResult.reason)
      }
      if (scienceResult.status === "rejected") {
        console.warn("[SkillsAndTools] scienceList failed:", scienceResult.reason)
      }
      if (officeResult.status === "rejected") {
        console.warn(
          "[SkillsAndTools] officecliListSkills failed:",
          officeResult.reason
        )
      }
      const unified: UnifiedSkillItem[] = [
        ...experts.map(expertToUnified),
        ...science.map(scienceToUnified),
        ...officeSkills.map(officeSkillToUnified),
        // ── Built-in PPT generation skill (always present) ──
          {
            id: "pptx-generator",
            name: { zh: "PPT 幻灯片生成", en: "PPT Slide Generator" },
            description: {
              zh: "将 Markdown 或 HTML 幻灯片批量转换为可编辑的 .pptx 文件，支持中文字体、表格、图片和演讲者备注。",
              en: "Batch convert Markdown or HTML slides into editable .pptx files. Supports Chinese fonts, tables, images, and speaker notes.",
            },
            category: "presentations",
            icon: "Presentation",
            source: "office",
          } as UnifiedSkillItem,
        ]
        setAllSkills(unified)
    } catch (err) {
      console.warn("[SkillsAndTools] fetchSkills failed:", err)
    } finally {
      if (!opts?.silent) setLoadingSkills(false)
    }
  }, [])

  useEffect(() => {
    void fetchSkills({ silent: allSkills.length > 0 })
    // Only re-run when parent signals a toggle; list identity is intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSkills, refreshKey])

  // Filter to only enabled skills, grouped by category
  const enabledSkills = useMemo(
    () => allSkills.filter((s) => enabledIds.has(s.id)),
    [allSkills, enabledIds]
  )

  const enabledBySource = useMemo(() => {
    const order: Array<"expert" | "creative" | "science" | "office"> = [
      "expert",
      "creative",
      "science",
      "office",
    ]
    const groups: Record<string, UnifiedSkillItem[]> = {}
    for (const skill of enabledSkills) {
      const group = skillDisplayGroup(skill)
      if (!groups[group]) groups[group] = []
      groups[group].push(skill)
    }
    return order
      .filter((src) => (groups[src]?.length ?? 0) > 0)
      .map((src) => [src, groups[src]] as const)
  }, [enabledSkills])

  const handleToggleSkill = useCallback(
    async (skillId: string, source: "expert" | "science" | "office") => {
      if (!lockedAgentType) return
      setTogglingSkillId(skillId)

      // Built-in PPT skill — no linking needed, AI calls it directly via chat.
      if (skillId === "pptx-generator") {
        toast.info(navigatorLocale.toLowerCase().startsWith("zh")
          ? "PPT 幻灯片生成已通过对话使用，无需单独启用。在聊天中告诉 AI '帮我做一个 PPT'即可。"
          : "PPT Slide Generator is used via chat — no need to enable separately."
        )
        setTogglingSkillId(null)
        return
      }
      try {
        if (source === "expert") {
          if (currentlyEnabled) {
            await expertsUnlinkFromAgent({ expertId: skillId, agentType: lockedAgentType })
          } else {
            await expertsLinkToAgent({ expertId: skillId, agentType: lockedAgentType })
          }
        } else if (source === "science") {
          if (currentlyEnabled) {
            await scienceUnlinkFromAgent({ skillId, agentType: lockedAgentType })
          } else {
            await scienceLinkToAgent({ skillId, agentType: lockedAgentType })
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
              ? `已从${agentName}移除`
              : `已添加到${agentName}`
            : currentlyEnabled
              ? `Removed from ${agentName}`
              : `Added to ${agentName}`
        )
        invalidateAgentSkillsCache(lockedAgentType)
        await refreshEnabledSkillIds()
        onToggled()
        await fetchSkills({ silent: true })
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
  const fetchPlugins = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingPlugins(true)
    try {
      const local = await mcpScanLocal()
      setPlugins(local)
    } catch {
      // silently ignore
    } finally {
      if (!opts?.silent) setLoadingPlugins(false)
    }
  }, [])

  useEffect(() => {
    void fetchPlugins({ silent: plugins.length > 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

        setPlugins((prev) =>
          prev.map((p) => (p.id === serverId ? { ...p, apps: newApps } : p))
        )

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
        await fetchPlugins({ silent: true })
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

  if (!currentAgent || !lockedAgentType) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Cpu className="h-8 w-8" />
        <p className="text-sm">{t("noAgent")}</p>
      </div>
    )
  }

  const hasEnabledSkills = enabledSkills.length > 0
  const hasEnabledPlugins = enabledPlugins.length > 0
  const pluginsSectionLoading = loadingPlugins

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-6 px-1 py-4 md:px-2">
        {/* Enabled Skills sub-section — grouped by category */}
        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("enabledSkills")}
          </h4>
          {loadingSkills ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : hasEnabledSkills ? (
            <div className="flex flex-col gap-5">
              {enabledBySource.map(([source, items]) => (
                <div key={source}>
                  <h5 className="mb-2 text-[11px] font-medium text-muted-foreground">
                    {source === "expert"
                      ? t("sourceExpert")
                      : source === "creative"
                        ? t("sourceCreative")
                        : source === "science"
                          ? t("sourceScience")
                          : t("sourceOffice")}
                  </h5>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((skill) => (
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
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("noSkills")}
            </p>
          )}
        </div>

        {/* Enabled Connectors sub-section */}
        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("installedPlugins")}
          </h4>
          <div
            className={
              !pluginsSectionLoading && hasEnabledPlugins
                ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                : "hidden"
            }
          >
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
          {pluginsSectionLoading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : !hasEnabledPlugins ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("noPlugins")}
            </p>
          ) : null}
        </div>
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------ */
/*  Skills Tab (unified expert + science + office, grouped by category) */
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

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      try {
        // Isolate sources: one failing API must not empty the warehouse tab.
        const [expertsResult, scienceResult, officeResult] =
          await Promise.allSettled([
            expertsList(),
            scienceList(),
            officecliListSkills(),
          ])
        const experts =
          expertsResult.status === "fulfilled" ? expertsResult.value : []
        const science =
          scienceResult.status === "fulfilled" ? scienceResult.value : []
        const officeSkills =
          officeResult.status === "fulfilled" ? officeResult.value : []
        if (expertsResult.status === "rejected") {
          console.warn(
            "[SkillsAndTools] expertsList failed:",
            expertsResult.reason
          )
        }
        if (scienceResult.status === "rejected") {
          console.warn(
            "[SkillsAndTools] scienceList failed:",
            scienceResult.reason
          )
        }
        if (officeResult.status === "rejected") {
          console.warn(
            "[SkillsAndTools] officecliListSkills failed:",
            officeResult.reason
          )
        }
        const unified: UnifiedSkillItem[] = [
          ...experts.map(expertToUnified),
          ...science.map(scienceToUnified),
          ...officeSkills.map(officeSkillToUnified),
          // ── Built-in PPT generation skill (always present) ──
          {
            id: "pptx-generator",
            name: { zh: "PPT 幻灯片生成", en: "PPT Slide Generator" },
            description: {
              zh: "将 Markdown 或 HTML 幻灯片批量转换为可编辑的 .pptx 文件，支持中文字体、表格、图片和演讲者备注。",
              en: "Batch convert Markdown or HTML slides into editable .pptx files. Supports Chinese fonts, tables, images, and speaker notes.",
            },
            category: "presentations",
            icon: "Presentation",
            source: "office",
          } as UnifiedSkillItem,
        ]
        // Group first (编程/艺术设计/科研/办公), then fine category, then name
        unified.sort((a, b) => {
          const srcA = SOURCE_ORDER[skillDisplayGroup(a)] ?? 99
          const srcB = SOURCE_ORDER[skillDisplayGroup(b)] ?? 99
          if (srcA !== srcB) return srcA - srcB
          const orderA = CATEGORY_ORDER[a.category] ?? 99
          const orderB = CATEGORY_ORDER[b.category] ?? 99
          if (orderA !== orderB) return orderA - orderB
          const nameA = pickLocalizedText(a.name, navigatorLocale, a.id)
          const nameB = pickLocalizedText(b.name, navigatorLocale, b.id)
          return nameA.localeCompare(nameB)
        })
        setSkills(unified)
      } catch (err) {
        console.warn("[SkillsAndTools] fetchData failed:", err)
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [navigatorLocale]
  )

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleToggle = useCallback(
    async (skillId: string, source: "expert" | "science" | "office") => {
      if (!lockedAgentType) return
      setTogglingId(skillId)

      // Built-in PPT skill — no linking needed.
      if (skillId === "pptx-generator") {
        toast.info(navigatorLocale.toLowerCase().startsWith("zh")
          ? "PPT 幻灯片生成已通过对话使用，无需单独启用。在聊天中告诉 AI '帮我做一个 PPT'即可。"
          : "PPT Slide Generator is used via chat — no need to enable separately."
        )
        setTogglingId(null)
        return
      }

      const currentlyEnabled = enabledIds.has(skillId)
      try {
        if (source === "expert") {
          if (currentlyEnabled) {
            await expertsUnlinkFromAgent({ expertId: skillId, agentType: lockedAgentType })
          } else {
            await expertsLinkToAgent({ expertId: skillId, agentType: lockedAgentType })
          }
        } else if (source === "science") {
          if (currentlyEnabled) {
            await scienceUnlinkFromAgent({ skillId, agentType: lockedAgentType })
          } else {
            await scienceLinkToAgent({ skillId, agentType: lockedAgentType })
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
              ? `已从${agentName}移除`
              : `已添加到${agentName}`
            : currentlyEnabled
              ? `Removed from ${agentName}`
              : `Added to ${agentName}`
        )
        invalidateAgentSkillsCache(lockedAgentType)
        await refreshEnabledSkillIds()
        onToggled()
        await fetchData({ silent: true })
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

  // Coarse filter: all | expert | creative | science | office
  type SourceFilter = "all" | "expert" | "creative" | "science" | "office"
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all")

  const sourceFilters: { id: SourceFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: t("filterAll") },
      { id: "expert", label: t("filterExpert") },
      { id: "creative", label: t("filterCreative") },
      { id: "science", label: t("filterScience") },
      { id: "office", label: t("filterOffice") },
    ],
    [t]
  )

  const displayedSkills = useMemo(() => {
    if (sourceFilter === "all") return skills
    if (sourceFilter === "creative") {
      return skills.filter((s) => skillDisplayGroup(s) === "creative")
    }
    if (sourceFilter === "expert") {
      // 编程 excludes 艺术设计 skills
      return skills.filter((s) => skillDisplayGroup(s) === "expert")
    }
    return skills.filter((s) => s.source === sourceFilter)
  }, [skills, sourceFilter])

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
        <p className="text-sm">{t("noSkills")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Coarse source filter — only 4 chips, not 17 fine categories */}
      <div className="shrink-0 border-b px-1 md:px-2">
        <div className="flex items-center gap-1 py-2">
          {sourceFilters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSourceFilter(f.id)}
              className={
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                (sourceFilter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Skill cards grid */}
      <ScrollArea className="flex-1">
        <div className="px-1 py-4 md:px-2">
          {displayedSkills.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("noSkillsInFilter")}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {displayedSkills.map((skill) => (
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
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Plugins Tab (MCP servers scoped to current agent)                 */
/* ------------------------------------------------------------------ */

function PluginsTab({ onToggled, refreshKey }: { onToggled: () => void; refreshKey: number }) {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const { currentAgent, lockedAgentType } =
    useSkillsPageAgentContext()
  const pluginAgentType = useMemo(
    () => agentTypeToMcpAppType(lockedAgentType),
    [lockedAgentType]
  )
  const [plugins, setPlugins] = useState<LocalMcpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const local = await mcpScanLocal()
      setPlugins(local)
    } catch {
      // silently ignore
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData, refreshKey])

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

        // Optimistic local update — avoids full-list spinner flash.
        setPlugins((prev) =>
          prev.map((p) => (p.id === serverId ? { ...p, apps: newApps } : p))
        )

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
        await fetchData({ silent: true })
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

  if (!lockedAgentType) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Cpu className="h-8 w-8" />
        <p className="text-sm">{t("noAgent")}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-6 px-1 py-4 md:px-2">
        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("mcpPlugins")}
          </h4>
          {plugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
              <Puzzle className="h-7 w-7" />
              <p className="text-sm">{t("noPlugins")}</p>
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
          ) : (
            <div className="flex flex-col gap-4">
              {enabledPlugins.length > 0 && (
                <div>
                  <h5 className="mb-2 text-[11px] font-medium text-muted-foreground">
                    {locale.toLowerCase().startsWith("zh")
                      ? `已对${agentLabel}启用`
                      : `Enabled for ${agentLabel}`}
                  </h5>
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

              {otherPlugins.length > 0 && (
                <div>
                  <h5 className="mb-2 text-[11px] font-medium text-muted-foreground">
                    {t("otherAvailablePlugins")}
                  </h5>
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

              <div className="flex justify-center pt-1">
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
          )}
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
  const { fresh, availableAgents, currentAgent } = useSkillsPageAgentContext()
  // Soft refresh signal for the Enabled tab (no remount / no loading flash).
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
                  {t("currentAgentHint")}
                </p>
              </div>
            </div>
          </div>
        )}

        <Tabs
          defaultValue="skills"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 pt-2">
            <TabsList
              className="inline-flex h-auto gap-6 border-none bg-transparent p-0"
              variant="line"
            >
              <TabsTrigger
                value="skills"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("tabSkillsRepo")}
              </TabsTrigger>
              <TabsTrigger
                value="enabled"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("tabEnabled")}
              </TabsTrigger>
              <TabsTrigger
                value="plugins"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("tabPluginsRepo")}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="skills"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <SkillsTab onToggled={handleToggleHappened} />
          </TabsContent>
          <TabsContent
            value="enabled"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <EnabledTab refreshKey={refreshKey} onToggled={handleToggleHappened} />
          </TabsContent>
          <TabsContent
            value="plugins"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <PluginsTab refreshKey={refreshKey} onToggled={handleToggleHappened} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
