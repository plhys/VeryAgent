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
  Pencil,
  Trash2,
  Eye,
  Plus,
  ArrowLeft,
  Wifi,
  WifiOff,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AgentIcon } from "@/components/agent-icon"
import { ImageGenerationConfigDialog } from "@/components/skills-and-tools/image-generation-config-dialog"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import { invalidateAgentSkillsCache } from "@/hooks/use-agent-skills"
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
import {
  acpListAgentSkills,
  acpSaveAgentSkill,
  acpDeleteAgentSkill,
  acpReadAgentSkill,
} from "@/lib/api"
import type {
  AgentType,
  ExpertListItem,
  ScienceListItem,
  OfficecliSkill,
  LocalMcpServer,
  McpAppType,
  AgentSkillItem,
  AgentSkillScope,
  AgentSkillLayout,
} from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"
import { useTabStore } from "@/contexts/tab-context"

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

// Disabled custom skills are stored in localStorage so "Disable" is not "Delete".
// The content is preserved and can be re-enabled later.
const DISABLED_SKILL_PREFIX = "va:disabled-skill:"

function disabledSkillKey(agentType: AgentType, skillId: string): string {
  return `${DISABLED_SKILL_PREFIX}${agentType}:${skillId}`
}

interface DisabledSkillData {
  content: string
  name: string
  description: string | null
  layout: string | null
}

function getDisabledSkills(agentType: AgentType): Map<string, DisabledSkillData> {
  const map = new Map<string, DisabledSkillData>()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`${DISABLED_SKILL_PREFIX}${agentType}:`)) {
        const skillId = key.slice(key.lastIndexOf(":") + 1)
        const raw = localStorage.getItem(key)
        if (raw) {
          map.set(skillId, JSON.parse(raw) as DisabledSkillData)
        }
      }
    }
  } catch {
    // localStorage may be unavailable
  }
  return map
}

function saveDisabledSkill(
  agentType: AgentType,
  skillId: string,
  data: DisabledSkillData
) {
  try {
    localStorage.setItem(
      disabledSkillKey(agentType, skillId),
      JSON.stringify(data)
    )
  } catch {
    // localStorage may be full or unavailable
  }
}

function removeDisabledSkill(agentType: AgentType, skillId: string) {
  try {
    localStorage.removeItem(disabledSkillKey(agentType, skillId))
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/*  Skill Warehouse — load index from GitHub / Gitee with fallback     */
/* ------------------------------------------------------------------ */

const WAREHOUSE_URLS = [
  "https://raw.githubusercontent.com/plhys/veryagent-skills/main/index.json",
  "https://gitee.com/JunFengLiangZi/veryagent-skills/raw/main/index.json",
]

const SKILL_RAW_URLS = {
  github: "https://raw.githubusercontent.com/plhys/veryagent-skills/main",
  gitee: "https://gitee.com/JunFengLiangZi/veryagent-skills/raw/main",
}

interface WarehouseIndex {
  version: number
  skills: WarehouseSkill[]
}

interface WarehouseSkill {
  id: string
  name: Record<string, string>
  description: Record<string, string>
  category: string
  icon: string
  sort_order: number
  source: "expert" | "science"
  featured?: boolean
  accent?: string | null
  needs_key?: boolean
  needs_env?: boolean
  path: string
}

const CACHE_KEY = "va:warehouse-cache"

function getCachedIndex(): WarehouseIndex | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as WarehouseIndex) : null
  } catch {
    return null
  }
}

function setCachedIndex(index: WarehouseIndex) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(index))
  } catch {
    // ignore
  }
}

function warehouseToUnified(skill: WarehouseSkill): UnifiedSkillItem {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    icon: skill.icon,
    source: "expert" as const,
  }
}

async function fetchSkillIndex(): Promise<{
  index: WarehouseIndex | null
  online: boolean
}> {
  // Try each URL with 5s timeout
  for (const url of WAREHOUSE_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const index = (await res.json()) as WarehouseIndex
      setCachedIndex(index)
      return { index, online: true }
    } catch {
      continue
    }
  }
  // All URLs failed → fall back to cache
  return { index: getCachedIndex(), online: false }
}

async function fetchSkillContent(
  skillPath: string
): Promise<string | null> {
  // Try GitHub first, then Gitee
  for (const base of Object.values(SKILL_RAW_URLS)) {
    try {
      const url = `${base}/${skillPath}`
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      return await res.text()
    } catch {
      continue
    }
  }
  return null
}

// Track which skills were created by VeryAgent (either via New Skill button
// or generated during conversations). Only tracked skills appear in the
// Custom tab — pre-built skills like Office CLI / VeryAgent Image are
// excluded by definition because they are never tracked.
const CREATED_SKILL_KEY = "va:created:"

function getCreatedSkillIds(agentType: AgentType): Set<string> {
  try {
    const raw = localStorage.getItem(`${CREATED_SKILL_KEY}${agentType}`)
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set<string>()
  }
}

function addCreatedSkillId(agentType: AgentType, skillId: string) {
  try {
    const ids = getCreatedSkillIds(agentType)
    ids.add(skillId)
    localStorage.setItem(
      `${CREATED_SKILL_KEY}${agentType}`,
      JSON.stringify(Array.from(ids))
    )
  } catch {
    // ignore
  }
}

function removeCreatedSkillId(agentType: AgentType, skillId: string) {
  try {
    const ids = getCreatedSkillIds(agentType)
    ids.delete(skillId)
    localStorage.setItem(
      `${CREATED_SKILL_KEY}${agentType}`,
      JSON.stringify(Array.from(ids))
    )
  } catch {
    // ignore
  }
}

// Top-level filter groups shown in the Skills warehouse:
// 编程 / 办公 / 学术 / 创意 / 帮助 / 自制
type SkillDisplayGroup = "expert" | "creative" | "science" | "office" | "help" | "custom"

const SOURCE_ORDER: Record<SkillDisplayGroup, number> = {
  expert: 1,
  office: 2,
  science: 3,
  creative: 4,
  help: 5,
  custom: 6,
}

// Category display order (lower = first). Used only to keep a stable order
// within the same source; not shown as filter chips.
const CATEGORY_ORDER: Record<string, number> = {
  // 编程行业
  development: 1,
  // 办公行业
  office: 2,
  // 学术行业
  academic: 3,
  // 创意行业
  creative: 4,
  // 帮助行业
  help: 5,
  // 已有自定义分类
  general: 21,
  presentations: 22,
  documents: 23,
  spreadsheets: 24,
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
  source: "expert" | "science" | "office" | "custom"
}

/** Visible warehouse group for a skill. */
function skillDisplayGroup(
  skill: Pick<UnifiedSkillItem, "source" | "category">
): SkillDisplayGroup {
  if (skill.source === "custom") return "custom"
  // Map old warehouse categories to new industry groups
  const cat = skill.category
  if (cat === "creative") return "creative"
  if (cat === "office") return "office"
  if (cat === "help") return "help"
  if (cat === "presentations" || cat === "general" || cat === "documents" || cat === "spreadsheets") return "office"
  if (skill.source === "science") return "science"
  // All other categories (discovery, planning, execution, quality, debugging,
  // review, meta, etc.) are development workflow skills → "expert" (编程)
  return "expert"
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

function customToUnified(skill: AgentSkillItem): UnifiedSkillItem {
  return {
    id: skill.id,
    name: { en: skill.name, zh: skill.name },
    description: { en: skill.description ?? "", zh: skill.description ?? "" },
    category: "custom",
    icon: "",
    source: "custom",
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
  onToggle: (id: string, source: SkillDisplayGroup) => void
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
                        ? `对当前智能体禁用${name}`
                        : `对当前智能体启用${name}`
                      : enabled
                        ? `Disable ${name} for current agent`
                        : `Enable ${name} for current agent`
                  }
                >
                  {isToggling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : enabled ? (
                    isZh ? (
                      "禁用"
                    ) : (
                      "Disable"
                    )
                  ) : isZh ? (
                    "启用"
                  ) : (
                    "Enable"
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
              if (group === "creative")
                return isZh ? "创意" : "Creative"
              if (group === "expert") return isZh ? "编程" : "Development"
              if (group === "science") return isZh ? "学术" : "Academic"
              if (group === "office") return isZh ? "办公" : "Office"
              return isZh ? "帮助" : "Help"
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
/*  Custom Skill Inline Editor                                         */
/* ------------------------------------------------------------------ */

function CustomSkillEditor({
  agentType,
  skillId,
  initialContent,
  isNew,
  onBack,
  onSaved,
}: {
  agentType: AgentType
  skillId: string
  initialContent: string
  isNew: boolean
  onBack: () => void
  onSaved: (savedId?: string) => void
}) {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const isZh = locale.toLowerCase().startsWith("zh")

  const [draftId, setDraftId] = useState(skillId)
  const [draftContent, setDraftContent] = useState(initialContent)
  const [isEditing, setIsEditing] = useState(isNew || !isNew)
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async () => {
    const trimmedId = draftId.trim()
    if (!trimmedId) {
      toast.error(t("customSkillIdRequired"))
      return
    }
    setSaving(true)
    try {
      const saved = await acpSaveAgentSkill({
        agentType,
        scope: "global" as AgentSkillScope,
        skillId: trimmedId,
        content: draftContent,
      })
      invalidateAgentSkillsCache(agentType)
      toast.success(t("customSkillSaved"))
      onSaved(saved.id)
    } catch (err) {
      toast.error(t("installFailed", { error: String(err) }))
    } finally {
      setSaving(false)
    }
  }, [agentType, draftId, draftContent, t, onSaved])

  const handleCancel = useCallback(() => {
    onBack()
  }, [onBack])

  return (
    <div className="flex flex-1 flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("customSkillEditorBack")}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
          >
            {t("customSkillCancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : null}
            {t("customSkillSave")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground">
          {isZh ? "技能 ID" : "Skill ID"}
        </label>
        <Input
          value={draftId}
          onChange={(e) => setDraftId(e.target.value)}
          placeholder={t("customSkillIdPlaceholder")}
          disabled={!isNew}
          className="text-sm"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 min-h-0">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {isZh ? "技能内容" : "Content"}
          </label>
          <div className="ml-auto flex items-center gap-1 rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (isEditing
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t("customSkillEdit")}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (!isEditing
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t("customSkillPreview")}
            </button>
          </div>
        </div>
        {isEditing ? (
          <Textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            placeholder={t("customSkillContentPlaceholder")}
            className="min-h-[300px] flex-1 resize-none font-mono text-sm"
          />
        ) : (
          <ScrollArea className="flex-1 rounded-lg border bg-muted/30 p-4">
            <article className="prose prose-sm max-w-none dark:prose-invert">
              {draftContent ? (
                <pre className="whitespace-pre-wrap text-sm">{draftContent}</pre>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {isZh ? "暂无内容" : "No content"}
                </p>
              )}
            </article>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}

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
      ? locale.toLowerCase().startsWith("zh")
        ? "本地进程"
        : "Local"
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

function EnabledTab({
  onToggled,
  refreshKey,
}: {
  onToggled: () => void
  refreshKey: number
}) {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const navigatorLocale =
    typeof navigator !== "undefined" ? (navigator.language ?? locale) : locale
  const { fresh, currentAgent, lockedAgentType } = useSkillsPageAgentContext()
  const { enabledIds } = useEnabledSkillIds(lockedAgentType, true)

  // Load unified skill list to know source (expert / science / office) for toggle API
  const [allSkills, setAllSkills] = useState<UnifiedSkillItem[]>([])
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null)
  // Custom skills state
  const [customSkillItems, setCustomSkillItems] = useState<AgentSkillItem[]>([])
  const [loadingCustomSkills, setLoadingCustomSkills] = useState(true)
  const [deletingCustomSkillId, setDeletingCustomSkillId] = useState<string | null>(null)
  const [deleteCustomOpen, setDeleteCustomOpen] = useState(false)
  const [deleteCustomTarget, setDeleteCustomTarget] = useState<string | null>(null)

  const fetchSkills = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingSkills(true)
    try {
      // Isolate sources: one failing API (e.g. unregistered science_list)
      // must not wipe the whole warehouse.
      const [expertsResult, scienceResult, officeResult, customResult] =
        await Promise.allSettled([
          expertsList(),
          scienceList(),
          officecliListSkills(),
          lockedAgentType
            ? acpListAgentSkills({ agentType: lockedAgentType })
            : Promise.resolve(null),
        ])
      const experts =
        expertsResult.status === "fulfilled" ? expertsResult.value : []
      const science =
        scienceResult.status === "fulfilled" ? scienceResult.value : []
      const officeSkills =
        officeResult.status === "fulfilled" ? officeResult.value : []
      const customSkillsResult =
        customResult.status === "fulfilled" ? customResult.value : null
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

      const customItems =
        customSkillsResult?.skills.filter((s) => s.scope === "global") ?? []
      setCustomSkillItems(customItems)
      setLoadingCustomSkills(false)

      const unified: UnifiedSkillItem[] = [
        ...experts.map(expertToUnified),
        ...science.map(scienceToUnified),
        ...officeSkills.map(officeSkillToUnified),
        ...customItems.map(customToUnified),
      ]
      setAllSkills(unified)
    } catch (err) {
      console.warn("[SkillsAndTools] fetchSkills failed:", err)
    } finally {
      if (!opts?.silent) setLoadingSkills(false)
    }
  }, [lockedAgentType])

  useEffect(() => {
    void fetchSkills({ silent: allSkills.length > 0 })
    // Only re-run when parent signals a toggle; list identity is intentionally ignored.
  }, [fetchSkills, refreshKey])

  // Filter to only enabled skills, grouped by category
  const enabledSkills = useMemo(
    () => allSkills.filter((s) => enabledIds.has(s.id)),
    [allSkills, enabledIds]
  )

  const enabledBySource = useMemo(() => {
    const order: Array<SkillDisplayGroup> = [
      "expert",
      "office",
      "science",
      "creative",
      "help",
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
    async (skillId: string, source: SkillDisplayGroup) => {
      if (!lockedAgentType) return
      setTogglingSkillId(skillId)
      const currentlyEnabled = enabledIds.has(skillId)
      try {
        if (source === "expert" || source === "creative" || source === "help") {
          if (currentlyEnabled) {
            await expertsUnlinkFromAgent({
              expertId: skillId,
              agentType: lockedAgentType,
            })
          } else {
            await expertsLinkToAgent({
              expertId: skillId,
              agentType: lockedAgentType,
            })
          }
        } else if (source === "science") {
          if (currentlyEnabled) {
            await scienceUnlinkFromAgent({
              skillId,
              agentType: lockedAgentType,
            })
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
              ? `已对${agentName}禁用`
              : `已对${agentName}启用`
            : currentlyEnabled
              ? `Disabled for ${agentName}`
              : `Enabled for ${agentName}`
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
    [
      currentAgent?.name,
      enabledIds,
      fetchSkills,
      lockedAgentType,
      navigatorLocale,
      onToggled,
      t,
    ]
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

        const agentName =
          currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]
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
    [
      currentAgent?.name,
      fetchPlugins,
      lockedAgentType,
      navigatorLocale,
      pluginAgentType,
      plugins,
      onToggled,
      t,
    ]
  )

  const agentLabel =
    currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]

  // Custom skill disable handler — saves content to localStorage, then deletes from agent dir
  const handleDisableCustomSkill = useCallback(
    async () => {
      if (!lockedAgentType || !deleteCustomTarget) return
      setDeletingCustomSkillId(deleteCustomTarget)
      try {
        // 1. Read the skill content before deleting
        const detail = await acpReadAgentSkill({
          agentType: lockedAgentType,
          scope: "global",
          skillId: deleteCustomTarget,
        })
        // 2. Save to localStorage
        saveDisabledSkill(lockedAgentType, deleteCustomTarget, {
          content: detail.content,
          name: detail.skill.name,
          description: detail.skill.description,
          layout: detail.skill.layout,
        })
        // 3. Delete from agent directory
        await acpDeleteAgentSkill({
          agentType: lockedAgentType,
          scope: "global",
          skillId: deleteCustomTarget,
        })
        invalidateAgentSkillsCache(lockedAgentType)
        toast.success(
          navigatorLocale.toLowerCase().startsWith("zh")
            ? `已对${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}禁用`
            : `Disabled for ${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}`
        )
        setDeleteCustomOpen(false)
        setDeleteCustomTarget(null)
        // Refresh the custom skills list
        const result = await acpListAgentSkills({ agentType: lockedAgentType })
        setCustomSkillItems(
          result.skills.filter((s) => s.scope === "global")
        )
        onToggled()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setDeletingCustomSkillId(null)
      }
    },
    [lockedAgentType, deleteCustomTarget, currentAgent?.name, navigatorLocale, t, onToggled]
  )

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
                          : source === "office"
                            ? t("sourceOffice")
                            : t("sourceHelp")}
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

        {/* Custom Skills sub-section — exclude pre-built skills that are symlinked into agent dir */}
        {(() => {
          const uniqueCustom = customSkillItems.filter(
            (item) => !enabledIds.has(item.id)
          )
          return uniqueCustom.length > 0 ? (
            <div>
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("customSkillsSection")}
              </h4>
              {loadingCustomSkills ? (
                <div className="flex items-center justify-center py-4 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("loading")}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {uniqueCustom.map((item) => {
                  const unified = customToUnified(item)
                  const cName = pickLocalizedText(unified.name, navigatorLocale, unified.id)
                  const cDesc = pickLocalizedText(unified.description, navigatorLocale, "")
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Pencil className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{cName}</p>
                              {cDesc && (
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {cDesc}
                                </p>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2.5 text-xs"
                              disabled={deletingCustomSkillId === item.id}
                              onClick={() => {
                                setDeleteCustomTarget(item.id)
                                setDeleteCustomOpen(true)
                              }}
                              aria-label={
                                navigatorLocale.toLowerCase().startsWith("zh")
                                  ? `对当前智能体禁用${cName}`
                                  : `Disable ${cName} for current agent`
                              }
                            >
                              {deletingCustomSkillId === item.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : navigatorLocale.toLowerCase().startsWith("zh") ? (
                                "禁用"
                              ) : (
                                "Disable"
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[0.625rem]">
                          {navigatorLocale.toLowerCase().startsWith("zh") ? "自制技能" : "Custom"}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : null
        })()}

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

      {/* Delete confirmation dialog for custom skills */}
      <AlertDialog
        open={deleteCustomOpen}
        onOpenChange={setDeleteCustomOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {locale.toLowerCase().startsWith("zh") ? "禁用技能" : "Disable Skill"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {locale.toLowerCase().startsWith("zh")
                ? "禁用后技能将从智能体目录移除，但内容已保存，可在「自制」标签页中重新启用。"
                : "The skill will be removed from the agent directory. The content is saved and can be re-enabled from the Custom tab."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {locale.toLowerCase().startsWith("zh") ? "取消" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDisableCustomSkill}>
              {locale.toLowerCase().startsWith("zh") ? "禁用" : "Disable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  // Track which warehouse skills are installed in the agent directory
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  // Track whether the warehouse is reachable (online) or using cache (offline)
  const [warehouseOnline, setWarehouseOnline] = useState(true)

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      try {
        // Load from warehouse (GitHub → Gitee → cache)
        const { index, online } = await fetchSkillIndex()
        setWarehouseOnline(online)
        if (index) {
          const unified = index.skills.map(warehouseToUnified)
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
        }

        // Check which skills are installed in the agent directory
        if (lockedAgentType) {
          const agentResult = await acpListAgentSkills({
            agentType: lockedAgentType,
          })
          const installed = new Set(
            agentResult.skills
              .filter((s) => s.scope === "global")
              .map((s) => s.id)
          )
          setInstalledIds(installed)
        }
      } catch (err) {
        console.warn("[SkillsAndTools] fetchData failed:", err)
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [lockedAgentType, navigatorLocale]
  )

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleToggle = useCallback(
    async (skillId: string) => {
      if (!lockedAgentType) return
      setTogglingId(skillId)
      const currentlyEnabled = installedIds.has(skillId)
      try {
        if (currentlyEnabled) {
          // Disable: remove from agent directory
          await acpDeleteAgentSkill({
            agentType: lockedAgentType,
            scope: "global",
            skillId,
          })
        } else {
          // Enable: download SKILL.md from warehouse and install
          const { index: warehouseIndex } = await fetchSkillIndex()
          const warehouseSkill = warehouseIndex?.skills.find((s) => s.id === skillId)
          if (!warehouseSkill) {
            toast.error(
              navigatorLocale.toLowerCase().startsWith("zh")
                ? "启用失败：技能仓库中未找到该技能"
                : "Enable failed: skill not found in warehouse"
            )
            return
          }
          const content = await fetchSkillContent(warehouseSkill.path)
          if (!content) {
            toast.error(
              navigatorLocale.toLowerCase().startsWith("zh")
                ? "启用失败：无法从仓库下载技能文件，请检查网络连接"
                : "Enable failed: unable to download skill file from warehouse, check network"
            )
            return
          }
          // Inject the locale-specific name and category into the SKILL.md frontmatter
          // so skills display with Chinese names and category grouping in the + menu.
          const localizedName = pickLocalizedText(warehouseSkill.name, locale, skillId)
          let patchedContent = localizedName !== skillId
            ? content.replace(/^name:.*$/m, `name: ${localizedName}`)
            : content
          // Also inject the category from the warehouse index (SKILL.md files
          // in the repo only have name + description, not category).
          if (warehouseSkill.category) {
            const categoryLine = `category: ${warehouseSkill.category}`
            if (/^category:.*$/m.test(patchedContent)) {
              patchedContent = patchedContent.replace(/^category:.*$/m, categoryLine)
            } else {
              // Insert after the name line in the frontmatter block
              patchedContent = patchedContent.replace(/^name:.*$/m, (m) => `${m}\n${categoryLine}`)
            }
          }
          await acpSaveAgentSkill({
            agentType: lockedAgentType,
            scope: "global",
            skillId,
            content: patchedContent,
          })
        }
        invalidateAgentSkillsCache(lockedAgentType)
        const agentName = currentAgent?.name ?? AGENT_LABELS[lockedAgentType]
        toast.success(
          navigatorLocale.toLowerCase().startsWith("zh")
            ? currentlyEnabled
              ? `已对${agentName}禁用`
              : `已对${agentName}启用`
            : currentlyEnabled
              ? `Disabled for ${agentName}`
              : `Enabled for ${agentName}`
        )
        // Refresh installed list
        const agentResult = await acpListAgentSkills({
          agentType: lockedAgentType,
        })
        setInstalledIds(
          new Set(
            agentResult.skills
              .filter((s) => s.scope === "global")
              .map((s) => s.id)
          )
        )
        onToggled()
        await fetchData({ silent: true })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        toast.error(
          navigatorLocale.toLowerCase().startsWith("zh")
            ? `启用失败：${reason}`
            : `Enable failed: ${reason}`
        )
      } finally {
        setTogglingId(null)
      }
    },
    [
      currentAgent?.name,
      installedIds,
      fetchData,
      lockedAgentType,
      navigatorLocale,
      onToggled,
      t,
    ]
  )

  // Coarse filter: all | expert | creative | science | office | help
  type SourceFilter = "all" | "expert" | "creative" | "science" | "office" | "help"
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
      return skills.filter((s) => skillDisplayGroup(s) === "expert")
    }
    if (sourceFilter === "office") {
      return skills.filter((s) => skillDisplayGroup(s) === "office")
    }
    if (sourceFilter === "help") {
      return skills.filter((s) => skillDisplayGroup(s) === "help")
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
      {/* Coarse source filter */}
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
          <div className="ml-auto flex items-center gap-1">
            {warehouseOnline ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-500" title={locale.toLowerCase().startsWith("zh") ? "仓库在线" : "Warehouse online"} />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-muted-foreground" title={locale.toLowerCase().startsWith("zh") ? "仓库离线，使用缓存" : "Warehouse offline, using cache"} />
            )}
          </div>
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
                  enabled={installedIds.has(skill.id)}
                  onToggle={(id) => handleToggle(id)}
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
/*  Custom Tab (user-created skills, per-agent)                       */
/* ------------------------------------------------------------------ */

function CustomTab({ onToggled }: { onToggled: () => void }) {
  const t = useTranslations("SkillsAndTools")
  const locale = useLocale()
  const { currentAgent, lockedAgentType } = useSkillsPageAgentContext()

  const [customSkills, setCustomSkills] = useState<AgentSkillItem[]>([])
  const [disabledSkillIds, setDisabledSkillIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [enableInProgress, setEnableInProgress] = useState<string | null>(null)

  // Editor mode
  const [editorMode, setEditorMode] = useState<"browse" | "edit">("browse")
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState("")
  const [isNewSkill, setIsNewSkill] = useState(false)

  const fetchCustomSkills = useCallback(async () => {
    if (!lockedAgentType) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // Only show skills that were created by VeryAgent (tracked in localStorage).
      // Pre-built skills like Office CLI / VeryAgent Image are never tracked
      // and thus never appear in the Custom tab.
      const tracked = getCreatedSkillIds(lockedAgentType)

      const agentResult = await acpListAgentSkills({
        agentType: lockedAgentType,
      })
      setCustomSkills(
        agentResult.skills.filter(
          (s) => s.scope === "global" && tracked.has(s.id)
        )
      )

      // Disabled skills from localStorage — also filter by tracked set
      const disabled = getDisabledSkills(lockedAgentType)
      setDisabledSkillIds(
        Array.from(disabled.keys()).filter((id) => tracked.has(id))
      )
    } catch (err) {
      console.warn("[SkillsAndTools] fetchCustomSkills failed:", err)
    } finally {
      setLoading(false)
    }
  }, [lockedAgentType])

  useEffect(() => {
    void fetchCustomSkills()
  }, [fetchCustomSkills])

  const handleNew = useCallback(() => {
    if (!lockedAgentType) return
    setEditingSkillId(null)
    setEditingContent(`---
name: my-skill
description: Describe when this skill should be used.
---

# Skill: my-skill

## When to use

- Describe trigger conditions.

## Instructions

1. Add actionable instruction one.
2. Add actionable instruction two.
`)
    setIsNewSkill(true)
    setEditorMode("edit")
  }, [lockedAgentType])

  const handleEdit = useCallback(
    async (skillId: string) => {
      if (!lockedAgentType) return
      try {
        const detail = await acpReadAgentSkill({
          agentType: lockedAgentType,
          scope: "global",
          skillId,
        })
        setEditingSkillId(detail.skill.id)
        setEditingContent(detail.content)
        setIsNewSkill(false)
        setEditorMode("edit")
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      }
    },
    [lockedAgentType, t]
  )

  const handleDeleteRequest = useCallback((skillId: string) => {
    setDeleteTargetId(skillId)
    setDeleteConfirmOpen(true)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!lockedAgentType || !deleteTargetId) return
    setDeletingSkillId(deleteTargetId)
    try {
      await acpDeleteAgentSkill({
        agentType: lockedAgentType,
        scope: "global",
        skillId: deleteTargetId,
      })
      // Remove from tracked set and clean up disabled data
      removeCreatedSkillId(lockedAgentType, deleteTargetId)
      removeDisabledSkill(lockedAgentType, deleteTargetId)
      invalidateAgentSkillsCache(lockedAgentType)
      toast.success(t("customSkillDeleted"))
      setDeleteConfirmOpen(false)
      setDeleteTargetId(null)
      await fetchCustomSkills()
      onToggled()
    } catch (err) {
      toast.error(t("installFailed", { error: String(err) }))
    } finally {
      setDeletingSkillId(null)
    }
  }, [lockedAgentType, deleteTargetId, t, fetchCustomSkills, onToggled])

  const handleEnable = useCallback(
    async (skillId: string) => {
      if (!lockedAgentType) return
      setEnableInProgress(skillId)
      try {
        const disabled = getDisabledSkills(lockedAgentType)
        const data = disabled.get(skillId)
        if (!data) {
          toast.error(t("installFailed", { error: "Disabled skill data not found" }))
          return
        }
        await acpSaveAgentSkill({
          agentType: lockedAgentType,
          scope: "global",
          skillId,
          content: data.content,
          layout: data.layout as AgentSkillLayout | null | undefined,
        })
        removeDisabledSkill(lockedAgentType, skillId)
        invalidateAgentSkillsCache(lockedAgentType)
        toast.success(
          locale.toLowerCase().startsWith("zh")
            ? `已启用${skillId}`
            : `${skillId} enabled`
        )
        await fetchCustomSkills()
        onToggled()
      } catch (err) {
        toast.error(t("installFailed", { error: String(err) }))
      } finally {
        setEnableInProgress(null)
      }
    },
    [lockedAgentType, locale, t, fetchCustomSkills, onToggled]
  )

  const handleEditorBack = useCallback(() => {
    setEditorMode("browse")
    setEditingSkillId(null)
    setEditingContent("")
    setIsNewSkill(false)
  }, [])

  const handleEditorSaved = useCallback(async (savedId?: string) => {
    if (!lockedAgentType) return
    // Track the skill so it appears in the Custom tab
    if (savedId) {
      addCreatedSkillId(lockedAgentType, savedId)
    }
    setEditorMode("browse")
    setEditingSkillId(null)
    setEditingContent("")
    setIsNewSkill(false)
    await fetchCustomSkills()
    onToggled()
  }, [lockedAgentType, fetchCustomSkills, onToggled])

  // If in editor mode, render the inline editor
  if (editorMode === "edit" && lockedAgentType) {
    return (
      <CustomSkillEditor
        agentType={lockedAgentType}
        skillId={isNewSkill ? "" : (editingSkillId ?? "")}
        initialContent={editingContent}
        isNew={isNewSkill}
        onBack={handleEditorBack}
        onSaved={handleEditorSaved}
      />
    )
  }

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
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header with New Skill button */}
      <div className="shrink-0 border-b px-1 md:px-2">
        <div className="flex items-center gap-1 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {locale.toLowerCase().startsWith("zh")
              ? `当前智能体：${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}`
              : `Agent: ${currentAgent?.name ?? AGENT_LABELS[lockedAgentType]}`}
          </span>
          <div className="ml-auto">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={handleNew}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("newCustomSkill")}
            </Button>
          </div>
        </div>
      </div>

      {/* Custom skill cards grid */}
      <ScrollArea className="flex-1">
        <div className="px-1 py-4 md:px-2">
          {(() => {
            // Only skills tracked in localStorage (created by VeryAgent UI)
            // are shown. Pre-built skills are never tracked.
            const userSkills = customSkills
            const userDisabled = disabledSkillIds
            const hasAny = userSkills.length > 0 || userDisabled.length > 0

            if (!hasAny) {
              return (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Pencil className="h-8 w-8" />
                  <p className="text-sm">
                    {locale.toLowerCase().startsWith("zh")
                      ? "暂无自制技能，点击上方「新建自制技能」创建"
                      : "No custom skills yet. Click \"New Custom Skill\" to create one."}
                  </p>
                </div>
              )
            }

            return (
              <div className="flex flex-col gap-6">
                {/* Enabled skills (in agent directory) */}
                {userSkills.length > 0 && (
                    <div>
                      <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {locale.toLowerCase().startsWith("zh") ? "自制技能" : "Custom Skills"}
                      </h4>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {userSkills.map((item) => {
                        const unified = customToUnified(item)
                        const cName = pickLocalizedText(unified.name, locale, unified.id)
                        const cDesc = pickLocalizedText(unified.description, locale, "")
                        const isDisabled = deletingSkillId === item.id
                        return (
                          <div
                            key={item.id}
                            className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                <Pencil className="h-4 w-4 text-primary" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{cName}</p>
                                    {cDesc && (
                                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                        {cDesc}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => handleEdit(item.id)}
                                    >
                                      <Eye className="mr-1 h-3.5 w-3.5" />
                                      {locale.toLowerCase().startsWith("zh") ? "编辑" : "Edit"}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="destructive"
                                      className="h-7 px-2 text-xs"
                                      disabled={isDisabled}
                                      onClick={() => handleDeleteRequest(item.id)}
                                    >
                                      {isDisabled ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : locale.toLowerCase().startsWith("zh") ? (
                                        "删除"
                                      ) : (
                                        "Delete"
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[0.625rem]">
                                {locale.toLowerCase().startsWith("zh") ? "自制技能" : "Custom"}
                              </Badge>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Disabled skills (from localStorage) */}
                {userDisabled.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {locale.toLowerCase().startsWith("zh") ? "已禁用" : "Disabled"}
                    </h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {userDisabled.map((skillId) => {
                        const disabled = getDisabledSkills(lockedAgentType!)
                        const data = disabled.get(skillId)
                        if (!data) return null
                        return (
                          <div
                            key={skillId}
                            className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 opacity-70"
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                <Pencil className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-muted-foreground">
                                      {data.name || skillId}
                                    </p>
                                    {data.description && (
                                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                        {data.description}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="default"
                                      className="h-7 px-2.5 text-xs"
                                      disabled={enableInProgress === skillId}
                                      onClick={() => handleEnable(skillId)}
                                    >
                                      {enableInProgress === skillId ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : locale.toLowerCase().startsWith("zh") ? (
                                        "启用"
                                      ) : (
                                        "Enable"
                                      )}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="destructive"
                                      className="h-7 px-2 text-xs"
                                      disabled={deletingSkillId === skillId}
                                      onClick={() => {
                                        setDeleteTargetId(skillId)
                                        setDeleteConfirmOpen(true)
                                      }}
                                    >
                                      {deletingSkillId === skillId ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[0.625rem]">
                                {locale.toLowerCase().startsWith("zh") ? "已禁用" : "Disabled"}
                              </Badge>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </ScrollArea>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {locale.toLowerCase().startsWith("zh") ? "删除技能" : "Delete Skill"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteCustomSkill")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {locale.toLowerCase().startsWith("zh") ? "取消" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {locale.toLowerCase().startsWith("zh") ? "删除" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Plugins Tab (MCP servers scoped to current agent)                 */
/* ------------------------------------------------------------------ */

function PluginsTab({
  onToggled,
  refreshKey,
}: {
  onToggled: () => void
  refreshKey: number
}) {
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

        const agentName =
          currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]
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
    [
      currentAgent?.name,
      fetchData,
      locale,
      lockedAgentType,
      pluginAgentType,
      plugins,
      onToggled,
      t,
    ]
  )

  const handleManagePlugins = useCallback(() => {
    openSettingsWindow("mcp")
  }, [])

  const agentLabel =
    currentAgent?.name ?? AGENT_LABELS[lockedAgentType ?? "codex"]

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
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
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
                value="plugins"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("tabPluginsRepo")}
              </TabsTrigger>
              <TabsTrigger
                value="custom"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("filterCustom")}
              </TabsTrigger>
              <TabsTrigger
                value="enabled"
                className="border-none rounded-none border-b-2 border-transparent bg-transparent text-sm shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground"
              >
                {t("tabEnabled")}
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
            value="plugins"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <PluginsTab
              refreshKey={refreshKey}
              onToggled={handleToggleHappened}
            />
          </TabsContent>
          <TabsContent
            value="custom"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <CustomTab onToggled={handleToggleHappened} />
          </TabsContent>
          <TabsContent
            value="enabled"
            forceMount
            className="scrollbar-thin mt-0 flex-1 overflow-auto px-1 md:px-2"
          >
            <EnabledTab
              refreshKey={refreshKey}
              onToggled={handleToggleHappened}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
