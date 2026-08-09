"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Reorder } from "motion/react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  
  
  GripVertical,
  Loader2,
  LogOut,
  PackagePlus,
  RefreshCw,
  Save,
  Trash2,
  Wrench,
} from "lucide-react"
import { openUrl } from "@/lib/platform"
import { toast } from "sonner"
import { AgentIcon } from "@/components/agent-icon"
import { AgentSettingsForm } from "./agent-settings-form"
import { getAgentDescriptor } from "./agent-descriptor"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn, copyTextToClipboard, randomUUID } from "@/lib/utils"
import {
  acpClearBinaryCache,
  acpDetectAgentLocalVersion,
  acpDownloadAgentBinary,
  acpInstallUvTool,
  acpGetAgentStatus,
  acpListAgents,
  acpPreflight,
  acpPrepareNpxAgent,
  acpReorderAgents,
  acpUninstallAgent,
  acpUpdateAgentConfig,
  acpUpdateAgentEnv,
  acpGetCommandCodeLoginStatus,
  acpStartCommandCodeLogin,
  acpCancelCommandCodeLogin,
  acpLogoutCommandCode,
  acpDiscoverOpenClawGateway,
  acpEnsureOpenClawGateway,
  codexPollDeviceCode,
  codexRequestDeviceCode,
  fetchModelProviderModels,
  listModelProviders,
  opencodeProviderCatalog,
} from "@/lib/api"
import type {
  AcpAgentInfo,
  AgentType,
  CheckStatus,
  CommandCodeLoginStatus,
  ModelProviderInfo,
  OpenClawGatewayDiscovery,
  OpenCodeCatalogProvider,
  ProviderModelItem,
} from "@/lib/types"
import {
  buildAgentReadiness,
  isReadinessPilotAgent,
  readinessToneClass,
} from "@/lib/agent-readiness"
import {
  OpenCodeConnectDialog,
  OpenCodeCustomProviderDialog,
} from "@/components/settings/opencode-connect-dialog"
import {
  buildConnectedModelOptions,
  buildConnectedProviders,
  disconnectProvider,
  modelReferencesProvider,
  setProviderApiKey,
  setProviderEnabled,
} from "@/lib/opencode-connect"
import { toErrorMessage } from "@/lib/app-error"
import { getInstallErrorHintKey } from "@/lib/agent-install-error"
import { useAgentInstallStream } from "@/hooks/use-agent-install-stream"
import { OpencodePluginsModal } from "../opencode-plugins-modal"
import { CodeBuddyConfigPanel } from "../codebuddy-config-panel"
import { PiConfigPanel } from "../pi-config-panel"
import { NativeLoginCard } from "./native-login-card"

import type {
  AgentCheckState,
  ClaudeEffortLevel,
  ImportantConfigKey,
  RunningActionKind,
  UiFixAction,
  UiCheckItem,
  AcpTranslator,
  AgentDraft,
  GeminiAuthMode,
  CodexAuthMode,
  OpenClawAuthMode,
  ClineAuthMode,
  OpenCodeAuthMode,
  PiAuthMode,
  CodeBuddyAuthMode,
} from "./types"
import {
  CLAUDE_EFFORT_LEVEL_CONFIG_KEY,
  CLAUDE_EFFORT_LEVEL_VALUES,
  GEMINI_AUTH_MODES,
  OPENCLAW_ENV_KEYS,
  CLINE_PROVIDERS,
  CODEX_DEFAULT_MODEL_PROVIDER,
  CODEX_AUTH_MODES,
  CODEX_REASONING_EFFORT_OPTIONS,
  CODEX_DEFAULT_REASONING_EFFORT,
  OPENCODE_PROVIDER_NPM_OPTIONS,
} from "./types"
import {
  setAcpTranslator,
  statusTone,
  summarizeChecks,
  envMapToText,
  parseEnvText,
  patchEnvText,
  parseConfigJsonText,
  asObjectRecord,
  patchOpenCodeAuthJsonText,
  extractImportantConfigValues,
  extractGeminiImportantValues,
  extractClineImportantValues,
  patchGeminiConfigText,
  patchGeminiEnvText,
  patchGeminiAuthMode,
  geminiAuthModeLabel,
  geminiAuthModeHint,
  markRemovedKeysNull,
  normalizeConfigText,
  buildOpenCodeModelOptions,
  extractOpenCodeConfigValues,
  patchOpenCodeConfigText,
  ensureOpenCodeProviderNpm,
  buildOpenCodeNpmOptions,
  parseCodexAuthJsonText,
  hasCodexChatgptTokens,
  extractCodexImportantValues,
  updateTomlRootStringKey,
  removeTomlSection,
  patchCodexAuthJsonText,
  patchCodexConfigTomlText,
  normalizeCodexReasoningEffort,
  buildAgentDraft,
  isValidCustomVersion,
  patchEnvByImportantKey,
  applyImportantFieldToDraft,
  buildImportantPatchFromDraft,
} from "./shared"
import {
  patchImportantConfigText,
  configTextForClaudeSave,
  getAgentChecks,
} from "./checks"
import { OpenCodeModelCombobox } from "./opencode-model-combobox"
import { AgentReorderItem } from "./agent-reorder-item"
import { KimiCodeConfigPanel } from "./kimi-code-config"

/** 智能体能识别的目标模型列表（用于模型提供商映射） */
const CLAUDE_TARGET_MODELS = [
  { id: "claude-opus-4-20250805", name: "Claude Opus 4.8" },
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-20251001", name: "Claude Haiku 4.5" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
]

const CODEX_TARGET_MODELS = [
  { id: "gpt-5-codex", name: "GPT-5 Codex" },
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
  { id: "o3", name: "o3" },
  { id: "o4-mini", name: "o4-mini" },
  { id: "gpt-4.1", name: "GPT-4.1" },
]

function getTargetModelOptions(agentType: string): { id: string; name: string }[] {
  switch (agentType) {
    case "claude_code":
      return CLAUDE_TARGET_MODELS
    case "codex":
      return CODEX_TARGET_MODELS
    default:
      return []
  }
}

export function AcpAgentSettings() {
  const locale = useLocale()
  const t = useTranslations("AcpAgentSettings")
  const rawTranslator = t as unknown as AcpTranslator
  setAcpTranslator((key, values) => rawTranslator(key, values))
  const searchParams = useSearchParams()
  const [agents, setAgents] = useState<AcpAgentInfo[]>([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [checkState, setCheckState] = useState<
    Partial<Record<AgentType, AgentCheckState>>
  >({})
  const [checking, setChecking] = useState<Partial<Record<AgentType, boolean>>>(
    {}
  )
  const [busyBinaryAction, setBusyBinaryAction] = useState<
    Partial<Record<AgentType, boolean>>
  >({})
  const [runningActionKind, setRunningActionKind] = useState<
    Partial<Record<AgentType, RunningActionKind>>
  >({})
  const [savingEnv, setSavingEnv] = useState<
    Partial<Record<AgentType, boolean>>
  >({})
  const [savingConfig, setSavingConfig] = useState<
    Partial<Record<AgentType, boolean>>
  >({})
  const [modelProviders, setModelProviders] = useState<ModelProviderInfo[]>([])
  const [providerModels, setProviderModels] = useState<ProviderModelItem[]>([])
  const [providerModelsLoading, setProviderModelsLoading] = useState(false)
  const [providerModelsError, setProviderModelsError] = useState<string | null>(
    null
  )
  const [providerModelsRefreshKey, setProviderModelsRefreshKey] = useState(0)
  const [uninstallConfirmAgent, setUninstallConfirmAgent] =
    useState<AcpAgentInfo | null>(null)
  const [customInstallAgent, setCustomInstallAgent] =
    useState<AcpAgentInfo | null>(null)
  const [customVersionInput, setCustomVersionInput] = useState("")
  const [pluginModalOpen, setPluginModalOpen] = useState(false)
  const [pluginModalAgent, setPluginModalAgent] = useState<AgentType | null>(
    null
  )
  const [expandedChecks, setExpandedChecks] = useState<Record<string, boolean>>(
    {}
  )
  const [selectedAgentType, setSelectedAgentType] = useState<AgentType | null>(
    null
  )
  const [openClawDiscovery, setOpenClawDiscovery] =
    useState<OpenClawGatewayDiscovery | null>(null)
  const openClawDiscoveryAppliedRef = useRef(false)
  const [ensuringOpenClawGateway, setEnsuringOpenClawGateway] = useState(false)
  const [drafts, setDrafts] = useState<Partial<Record<AgentType, AgentDraft>>>(
    {}
  )
  const [configErrors, setConfigErrors] = useState<
    Partial<Record<AgentType, string | null>>
  >({})
  const [showApiKeys, setShowApiKeys] = useState<
    Partial<Record<AgentType, boolean>>
  >({})
  const [openCodeProviderId, setOpenCodeProviderId] = useState("")
  const [openCodeNewModelIds, setOpenCodeNewModelIds] = useState<
    Record<string, string>
  >({})
  const [openCodeModelIdDrafts, setOpenCodeModelIdDrafts] = useState<
    Record<string, string>
  >({})
  const [openCodeModelConfigExpanded, setOpenCodeModelConfigExpanded] =
    useState<Record<string, boolean>>({})
  const [openCodeDeleteProviderId, setOpenCodeDeleteProviderId] = useState<
    string | null
  >(null)
  const [openCodeCatalog, setOpenCodeCatalog] = useState<
    OpenCodeCatalogProvider[]
  >([])
  const [openCodeCatalogLoading, setOpenCodeCatalogLoading] = useState(false)
  // True once the catalog fetch has settled at least once (success OR failure).
  // Gates "Add custom provider" so the catalog-id collision check runs against a
  // known set — an empty catalog while still loading must not let a catalog id
  // (e.g. "openai") slip in as a custom provider.
  const [openCodeCatalogReady, setOpenCodeCatalogReady] = useState(false)
  // Dedupe the one-shot catalog fetch without putting volatile state in the
  // effect deps (which would re-run the effect and self-cancel the request).
  const openCodeCatalogRequestedRef = useRef(false)
  const [openCodeConnectOpen, setOpenCodeConnectOpen] = useState(false)
  // Add-a-custom-provider dialog (separate from the catalog connect dialog).
  const [openCodeCustomOpen, setOpenCodeCustomOpen] = useState(false)
  // When set, the connect dialog opens in edit mode for this connected provider.
  const [openCodeEditProviderId, setOpenCodeEditProviderId] = useState<
    string | null
  >(null)
  const [dragging, setDragging] = useState<AgentType | null>(null)
  const [reordering, setReordering] = useState(false)
  const pendingOrderRef = useRef<AgentType[] | null>(null)
  const busyActionRef = useRef<Set<AgentType>>(new Set())
  const handledSearchAgentRef = useRef<string | null>(null)
  const agentListRef = useRef<HTMLDivElement | null>(null)
  const installStream = useAgentInstallStream()
  const [streamAgentType, setStreamAgentType] = useState<AgentType | null>(null)
  const installLogEndRef = useRef<HTMLDivElement | null>(null)
  const [codexDeviceCode, setCodexDeviceCode] = useState<{
    userCode: string
    verificationUrl: string
    deviceAuthId: string
    interval: number
  } | null>(null)
  const [codexLoginStatus, setCodexLoginStatus] = useState<
    "idle" | "requesting" | "polling" | "success" | "error"
  >("idle")
  const [codexLoginError, setCodexLoginError] = useState<string | null>(null)
  const codexPollCancelledRef = useRef(false)
  const [commandCodeLogin, setCommandCodeLogin] =
    useState<CommandCodeLoginStatus | null>(null)
  const [commandCodeApiKey, setCommandCodeApiKey] = useState("")
  const [commandCodeSavingKey, setCommandCodeSavingKey] = useState(false)

  const sortedAgents = useMemo(
    () =>
      [...agents].sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      ),
    [agents]
  )
  const selectedAgent = useMemo(
    () =>
      sortedAgents.find((agent) => agent.agent_type === selectedAgentType) ??
      null,
    [selectedAgentType, sortedAgents]
  )
  const agentTypesKey = useMemo(
    () =>
      [...new Set(agents.map((agent) => agent.agent_type))].sort().join(","),
    [agents]
  )
  const requestedAgentType = useMemo(
    () => searchParams.get("agent"),
    [searchParams]
  )

  const refreshAgents = useCallback(async () => {
    setLoadingAgents(true)
    setLoadingError(null)
    try {
      const [next, providers] = await Promise.all([
        acpListAgents(),
        listModelProviders().catch(() => [] as ModelProviderInfo[]),
      ])
      setAgents(next)
      setModelProviders(providers)
      setDrafts((prev) => {
        const updated = { ...prev }
        for (const agent of next) {
          if (!updated[agent.agent_type]) {
            updated[agent.agent_type] = buildAgentDraft(agent)
          }
        }
        return updated
      })
      setConfigErrors((prev) => {
        const updated = { ...prev }
        for (const agent of next) {
          if (typeof updated[agent.agent_type] !== "undefined") continue
          const configText =
            typeof agent.config_json === "string" ? agent.config_json : ""
          updated[agent.agent_type] = parseConfigJsonText(configText).error
        }
        return updated
      })
    } catch (err) {
      const message = toErrorMessage(err)
      setLoadingError(message)
    } finally {
      setLoadingAgents(false)
    }
  }, [])

  const runPreflight = useCallback(
    async (agentType: AgentType, forceRefresh?: boolean) => {
      setChecking((prev) => ({ ...prev, [agentType]: true }))
      try {
        const [resultState, versionState, statusState] =
          await Promise.allSettled([
            acpPreflight(agentType, forceRefresh),
            acpDetectAgentLocalVersion(agentType),
            acpGetAgentStatus(agentType),
          ])

        if (versionState.status === "fulfilled") {
          setAgents((prev) => {
            if (versionState.value === null) return prev
            let changed = false
            const next = prev.map((agent) => {
              if (agent.agent_type !== agentType) return agent
              if (agent.installed_version === versionState.value) return agent
              changed = true
              return { ...agent, installed_version: versionState.value }
            })
            return changed ? next : prev
          })
        }

        // Re-sync `available` from the authoritative backend status. It is
        // recomputed live (e.g. `uvx_agent_launchable` for Hermes), so an
        // install that provisions the runtime flips it true here — otherwise
        // the version-status panel would stay stuck on the unavailable /
        // "runtime not ready" branch with the freshly installed version shown.
        if (statusState.status === "fulfilled") {
          setAgents((prev) => {
            let changed = false
            const next = prev.map((agent) => {
              if (agent.agent_type !== agentType) return agent
              if (agent.available === statusState.value.available) return agent
              changed = true
              return { ...agent, available: statusState.value.available }
            })
            return changed ? next : prev
          })
        }

        if (resultState.status === "fulfilled") {
          setCheckState((prev) => ({
            ...prev,
            [agentType]: { result: resultState.value },
          }))
        } else {
          const message =
            resultState.reason instanceof Error
              ? resultState.reason.message
              : String(resultState.reason)
          setCheckState((prev) => ({
            ...prev,
            [agentType]: { error: message },
          }))
        }
      } catch (err) {
        const message = toErrorMessage(err)
        setCheckState((prev) => ({ ...prev, [agentType]: { error: message } }))
      } finally {
        setChecking((prev) => ({ ...prev, [agentType]: false }))
      }
    },
    []
  )

  const runAllPreflight = useCallback(
    async (agentTypes: AgentType[]) => {
      if (agentTypes.length === 0) return
      setChecking((prev) => {
        const next = { ...prev }
        for (const agentType of agentTypes) {
          next[agentType] = true
        }
        return next
      })
      await Promise.all(agentTypes.map((agentType) => runPreflight(agentType)))
    },
    [runPreflight]
  )

  useEffect(() => {
    return () => installStream.reset()
  }, [])

  useEffect(() => {
    const container = installLogEndRef.current?.parentElement
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [installStream.logs])

  useEffect(() => {
    if (
      installStream.status === "success" ||
      installStream.status === "failed"
    ) {
      if (streamAgentType) {
        runPreflight(streamAgentType).catch(() => {})
      }
    }
  }, [installStream.status])

  useEffect(() => {
    refreshAgents().catch((err) => {
      console.error("[Settings] refresh agents failed:", err)
    })
  }, [refreshAgents])

  useEffect(() => {
    if (loadingAgents || !agentTypesKey) return
    const agentTypes = agentTypesKey.split(",") as AgentType[]
    runAllPreflight(agentTypes).catch((err) => {
      console.error("[Settings] run all preflight failed:", err)
    })
  }, [agentTypesKey, loadingAgents, runAllPreflight])

  useEffect(() => {
    if (!requestedAgentType) {
      handledSearchAgentRef.current = null
      return
    }
    if (sortedAgents.length === 0) {
      return
    }
    if (handledSearchAgentRef.current === requestedAgentType) {
      return
    }
    const matched = sortedAgents.find(
      (agent) => agent.agent_type === requestedAgentType
    )
    if (matched) {
      setSelectedAgentType(matched.agent_type)
    }
    handledSearchAgentRef.current = requestedAgentType
  }, [requestedAgentType, sortedAgents])

  useEffect(() => {
    if (!selectedAgentType) return
    const container = agentListRef.current
    if (!container) return
    const selected = container.querySelector<HTMLElement>(
      `[data-agent-type="${selectedAgentType}"]`
    )
    if (!selected) return
    selected.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [selectedAgentType, sortedAgents])

  useEffect(() => {
    if (sortedAgents.length === 0) {
      setSelectedAgentType(null)
      return
    }
    setSelectedAgentType((prev) => {
      if (prev && sortedAgents.some((agent) => agent.agent_type === prev)) {
        return prev
      }
      return sortedAgents[0].agent_type
    })
  }, [sortedAgents])

  // Discover local OpenClaw gateway from env + openclaw.json and auto-fill
  // empty draft fields only (never overwrite user-saved VA env values).
  useEffect(() => {
    if (selectedAgentType !== "open_claw") return
    let cancelled = false
    ;(async () => {
      try {
        const discovered = await acpDiscoverOpenClawGateway()
        if (cancelled) return
        setOpenClawDiscovery(discovered)
      } catch (err) {
        console.warn("[Settings] openclaw gateway discovery failed:", err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAgentType])

  const handleEnsureOpenClawGateway = useCallback(async () => {
    if (ensuringOpenClawGateway) return
    setEnsuringOpenClawGateway(true)
    try {
      const result = await acpEnsureOpenClawGateway()
      openClawDiscoveryAppliedRef.current = false
      setOpenClawDiscovery(result.discovery)
      if (result.ok) {
        toast.success(
          t("openClaw.ensureGatewayOk", { message: result.message })
        )
      } else {
        toast.error(
          t("openClaw.ensureGatewayFailed", { message: result.message })
        )
      }
      // Re-run preflight so sidebar badge / status card refresh with probe result.
      await runPreflight("open_claw", true)
    } catch (err) {
      console.error("[Settings] openclaw ensure gateway failed:", err)
      toast.error(
        t("openClaw.ensureGatewayFailed", {
          message: err instanceof Error ? err.message : String(err),
        })
      )
    } finally {
      setEnsuringOpenClawGateway(false)
    }
  }, [ensuringOpenClawGateway, runPreflight, t])

  useEffect(() => {
    if (selectedAgentType !== "open_claw" || !openClawDiscovery) return
    if (openClawDiscoveryAppliedRef.current) return
    const discovered = openClawDiscovery
    setDrafts((prev) => {
      const current = prev.open_claw
      if (!current) return prev
      openClawDiscoveryAppliedRef.current = true
      const nextUrl =
        current.openClawGatewayUrl.trim() || discovered.gatewayUrl || ""
      const nextToken =
        current.openClawGatewayToken.trim() || discovered.gatewayToken || ""
      if (
        nextUrl === current.openClawGatewayUrl &&
        nextToken === current.openClawGatewayToken
      ) {
        return prev
      }
      let envText = current.envText
      if (!current.openClawGatewayUrl.trim() && nextUrl) {
        envText = patchEnvText(envText, {
          [OPENCLAW_ENV_KEYS.gatewayUrl]: nextUrl,
        })
      }
      if (!current.openClawGatewayToken.trim() && nextToken) {
        envText = patchEnvText(envText, {
          [OPENCLAW_ENV_KEYS.gatewayToken]: nextToken,
        })
      }
      return {
        ...prev,
        open_claw: {
          ...current,
          openClawGatewayUrl: nextUrl,
          openClawGatewayToken: nextToken,
          envText,
        },
      }
    })
  }, [selectedAgentType, openClawDiscovery, drafts.open_claw])

  // A settings save (env or native config) only takes effect on the NEXT agent
  // start, so any running session of that agent stays on its launch-time config
  // until restarted. The backend returns how many running sessions were left
  // stale; surface that as one info toast. Debounced + max-coalesced so a button
  // that saves env AND config together (e.g. Codex, Gemini) shows a single toast
  // rather than one per call.
  const affectedReportRef = useRef<{
    max: number
    timer: ReturnType<typeof setTimeout> | null
  }>({ max: 0, timer: null })
  const reportAffectedSessions = useCallback(
    (affected: number) => {
      const r = affectedReportRef.current
      r.max = Math.max(r.max, affected)
      if (r.timer) clearTimeout(r.timer)
      r.timer = setTimeout(() => {
        const count = affectedReportRef.current.max
        affectedReportRef.current = { max: 0, timer: null }
        if (count > 0) {
          toast.info(t("toasts.affectedRunningSessions", { count }))
        }
      }, 150)
    },
    [t]
  )

  const persistEnv = useCallback(
    async (
      agentType: AgentType,
      enabled: boolean,
      envText: string,
      modelProviderId?: number | null
    ) => {
      const parsedEnv = parseEnvText(envText)
      setSavingEnv((prev) => ({ ...prev, [agentType]: true }))
      try {
        const affected = await acpUpdateAgentEnv(agentType, {
          enabled,
          env: parsedEnv,
          modelProviderId: modelProviderId ?? null,
        })
        setAgents((prev) =>
          prev.map((agent) =>
            agent.agent_type === agentType
              ? {
                  ...agent,
                  enabled,
                  env: parsedEnv,
                  model_provider_id: modelProviderId ?? null,
                }
              : agent
          )
        )
        reportAffectedSessions(affected)
        toast.success(t("toasts.configSaved"))
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error)
        toast.error(t("toasts.saveEnvFailed"))
        console.error(`[persistEnv] save failed for ${agentType}:`, error)
      } finally {
        setSavingEnv((prev) => ({ ...prev, [agentType]: false }))
      }
    },
    [reportAffectedSessions]
  )

  const persistConfig = useCallback(
    async (
      agentType: AgentType,
      configText: string,
      options?: {
        openCodeAuthJsonText?: string
        codexAuthJsonText?: string
        codexConfigTomlText?: string
      }
    ) => {
      const parsedConfig = parseConfigJsonText(configText)
      if (parsedConfig.error) {
        throw new Error(parsedConfig.error)
      }
      const codexAuthJsonText = options?.codexAuthJsonText
      if (agentType === "codex" && typeof codexAuthJsonText === "string") {
        const authError = parseCodexAuthJsonText(codexAuthJsonText)
        if (authError) {
          throw new Error(authError)
        }
      }
      let normalizedConfig = normalizeConfigText(configText)
      if (agentType === "open_code" && normalizedConfig) {
        normalizedConfig = ensureOpenCodeProviderNpm(normalizedConfig)
      }
      // For agents using merge strategy, mark removed keys as null
      // so the backend merge_json_values can delete them from disk.
      let configForPersist =
        agentType === "open_code" && !normalizedConfig ? "{}" : normalizedConfig
      const usesMerge =
        agentType === "claude_code" ||
        agentType === "gemini" ||
        agentType === "open_claw"
      if (usesMerge && configForPersist) {
        const originalAgent = agents.find((a) => a.agent_type === agentType)
        const originalConfig = originalAgent?.config_json
          ? parseConfigJsonText(originalAgent.config_json).config
          : {}
        const currentConfig = parsedConfig.config
        configForPersist = JSON.stringify(
          markRemovedKeysNull(originalConfig, currentConfig),
          null,
          2
        )
      }
      setSavingConfig((prev) => ({ ...prev, [agentType]: true }))
      try {
        const affected = await acpUpdateAgentConfig(agentType, {
          config_json: configForPersist || null,
          opencode_auth_json:
            typeof options?.openCodeAuthJsonText === "string"
              ? options.openCodeAuthJsonText
              : null,
          codex_auth_json:
            typeof codexAuthJsonText === "string" ? codexAuthJsonText : null,
          codex_config_toml:
            typeof options?.codexConfigTomlText === "string"
              ? options.codexConfigTomlText
              : null,
        })
        reportAffectedSessions(affected)
        setAgents((prev) =>
          prev.map((agent) =>
            agent.agent_type === agentType
              ? {
                  ...agent,
                  config_json: normalizedConfig || null,
                  opencode_auth_json:
                    typeof options?.openCodeAuthJsonText === "string"
                      ? options.openCodeAuthJsonText
                      : agent.opencode_auth_json,
                  codex_auth_json:
                    typeof codexAuthJsonText === "string"
                      ? codexAuthJsonText
                      : agent.codex_auth_json,
                  codex_config_toml:
                    typeof options?.codexConfigTomlText === "string"
                      ? options.codexConfigTomlText
                      : agent.codex_config_toml,
                }
              : agent
          )
        )
      } finally {
        setSavingConfig((prev) => ({ ...prev, [agentType]: false }))
      }
    },
    [agents, reportAffectedSessions]
  )

  const runBinaryAction = useCallback(
    async (
      agent: AcpAgentInfo,
      mode: "download" | "upgrade",
      kind?: RunningActionKind,
      versionOverride?: string
    ) => {
      if (busyActionRef.current.has(agent.agent_type)) return
      busyActionRef.current.add(agent.agent_type)
      setBusyBinaryAction((prev) => ({ ...prev, [agent.agent_type]: true }))
      setRunningActionKind((prev) => ({
        ...prev,
        [agent.agent_type]:
          kind ?? (mode === "download" ? "download_binary" : "upgrade_binary"),
      }))
      // A custom-version install must replace whatever is cached, otherwise a
      // higher cached version would still win on connect.
      const clearCache = mode === "upgrade" || Boolean(versionOverride)
      const actionLabel = versionOverride
        ? t("actions.customInstall")
        : mode === "upgrade"
          ? t("actions.upgrade")
          : t("actions.install")
      const taskId = randomUUID()
      setStreamAgentType(agent.agent_type)
      await installStream.start(taskId)
      try {
        if (clearCache) {
          await acpClearBinaryCache(agent.agent_type)
        }
        await acpDownloadAgentBinary(
          agent.agent_type,
          taskId,
          versionOverride ?? null
        )
        await runPreflight(agent.agent_type)
        const detectedVersion = await acpDetectAgentLocalVersion(
          agent.agent_type
        )
        setAgents((prev) =>
          prev.map((item) =>
            item.agent_type === agent.agent_type
              ? { ...item, installed_version: detectedVersion }
              : item
          )
        )
        toast.success(
          t("toasts.agentActionCompleted", {
            name: agent.name,
            action: actionLabel,
          }),
          {
            description: detectedVersion
              ? t("toasts.localVersion", { version: detectedVersion })
              : t("toasts.installCompletedVersionLater"),
          }
        )
      } catch (err) {
        const message = toErrorMessage(err)
        toast.error(
          t("toasts.agentActionFailed", {
            name: agent.name,
            action: actionLabel,
          }),
          {
            description: message,
          }
        )
        if (clearCache) {
          // The cache was cleared before downloading, so a failure here may
          // have removed the previously working binary — resync local state so
          // the UI doesn't keep showing a phantom version.
          try {
            const detected = await acpDetectAgentLocalVersion(agent.agent_type)
            setAgents((prev) =>
              prev.map((item) =>
                item.agent_type === agent.agent_type
                  ? { ...item, installed_version: detected ?? null }
                  : item
              )
            )
          } catch (detectErr) {
            console.error(
              "[Settings] failed to resync installed version after binary install failure:",
              detectErr
            )
          }
        }
        throw err
      } finally {
        busyActionRef.current.delete(agent.agent_type)
        setBusyBinaryAction((prev) => ({ ...prev, [agent.agent_type]: false }))
        setRunningActionKind((prev) => ({
          ...prev,
          [agent.agent_type]: undefined,
        }))
      }
    },

    [runPreflight, t, installStream.start]
  )

  const runNpxAction = useCallback(
    async (
      agent: AcpAgentInfo,
      mode: "install" | "upgrade",
      versionOverride?: string
    ) => {
      if (busyActionRef.current.has(agent.agent_type)) return
      busyActionRef.current.add(agent.agent_type)
      setBusyBinaryAction((prev) => ({ ...prev, [agent.agent_type]: true }))
      setRunningActionKind((prev) => ({
        ...prev,
        [agent.agent_type]: versionOverride
          ? "custom_install"
          : mode === "install"
            ? "install_npx"
            : "upgrade_npx",
      }))
      // A custom-version install forces a clean reinstall so the requested
      // version replaces whatever is currently installed.
      const cleanFirst = mode === "upgrade" || Boolean(versionOverride)
      const actionLabel = versionOverride
        ? t("actions.customInstall")
        : mode === "upgrade"
          ? t("actions.upgrade")
          : t("actions.install")
      const taskId = randomUUID()
      setStreamAgentType(agent.agent_type)
      await installStream.start(taskId)
      try {
        const installedVersion = await acpPrepareNpxAgent(
          agent.agent_type,
          agent.registry_version,
          taskId,
          cleanFirst,
          versionOverride ?? null
        )
        setAgents((prev) =>
          prev.map((item) =>
            item.agent_type === agent.agent_type
              ? { ...item, installed_version: installedVersion }
              : item
          )
        )
        await runPreflight(agent.agent_type)
        const detectedVersion = await acpDetectAgentLocalVersion(
          agent.agent_type
        )
        if (detectedVersion && detectedVersion !== installedVersion) {
          setAgents((prev) =>
            prev.map((item) =>
              item.agent_type === agent.agent_type
                ? { ...item, installed_version: detectedVersion }
                : item
            )
          )
        }
        const finalVersion = detectedVersion ?? installedVersion
        // After OpenClaw install, re-discover local gateway so empty fields
        // can pick up an existing openclaw.json / env without user re-entry.
        if (agent.agent_type === "open_claw") {
          openClawDiscoveryAppliedRef.current = false
          try {
            const discovered = await acpDiscoverOpenClawGateway()
            setOpenClawDiscovery(discovered)
          } catch (err) {
            console.warn(
              "[Settings] openclaw gateway rediscovery after install failed:",
              err
            )
          }
        }
        toast.success(
          t("toasts.agentActionCompleted", {
            name: agent.name,
            action: actionLabel,
          }),
          {
            description: finalVersion
              ? t("toasts.localVersion", { version: finalVersion })
              : t("toasts.installCompletedVersionLater"),
          }
        )
      } catch (err) {
        const message = toErrorMessage(err)
        const hintKey = getInstallErrorHintKey(message)
        toast.error(
          t("toasts.agentActionFailed", {
            name: agent.name,
            action: actionLabel,
          }),
          {
            description: hintKey ? t(hintKey, { name: agent.name }) : message,
          }
        )
        if (cleanFirst) {
          // Clean reinstall may have removed the old install before failing —
          // resync local state so the UI doesn't keep showing a phantom version.
          try {
            const detected = await acpDetectAgentLocalVersion(agent.agent_type)
            setAgents((prev) =>
              prev.map((item) =>
                item.agent_type === agent.agent_type
                  ? { ...item, installed_version: detected ?? null }
                  : item
              )
            )
          } catch (detectErr) {
            console.error(
              "[Settings] failed to resync installed version after upgrade failure:",
              detectErr
            )
          }
        }
        throw err
      } finally {
        busyActionRef.current.delete(agent.agent_type)
        setBusyBinaryAction((prev) => ({ ...prev, [agent.agent_type]: false }))
        setRunningActionKind((prev) => ({
          ...prev,
          [agent.agent_type]: undefined,
        }))
      }
    },

    [runPreflight, t, installStream.start]
  )

  const runUninstallAction = useCallback(
    async (agent: AcpAgentInfo) => {
      if (busyActionRef.current.has(agent.agent_type)) return
      busyActionRef.current.add(agent.agent_type)
      setBusyBinaryAction((prev) => ({ ...prev, [agent.agent_type]: true }))
      setRunningActionKind((prev) => ({
        ...prev,
        [agent.agent_type]:
          agent.distribution_type === "binary"
            ? "uninstall_binary"
            : "uninstall_npx",
      }))
      const taskId = randomUUID()
      setStreamAgentType(agent.agent_type)
      await installStream.start(taskId)
      try {
        await acpUninstallAgent(agent.agent_type, taskId)
        setAgents((prev) =>
          prev.map((item) =>
            item.agent_type === agent.agent_type
              ? { ...item, installed_version: null }
              : item
          )
        )
        await runPreflight(agent.agent_type)
        toast.success(t("toasts.uninstallCompleted", { name: agent.name }), {
          description: t("toasts.localVersionRemoved"),
        })
      } catch (err) {
        const message = toErrorMessage(err)
        const hintKey = getInstallErrorHintKey(message)
        toast.error(t("toasts.uninstallFailed", { name: agent.name }), {
          description: hintKey ? t(hintKey, { name: agent.name }) : message,
        })
        throw err
      } finally {
        busyActionRef.current.delete(agent.agent_type)
        setBusyBinaryAction((prev) => ({ ...prev, [agent.agent_type]: false }))
        setRunningActionKind((prev) => ({
          ...prev,
          [agent.agent_type]: undefined,
        }))
      }
    },

    [runPreflight, t, installStream.start]
  )

  // Install ONLY the uv runtime (uvx) — separate from preparing a uvx agent's
  // package. Triggered by the uv preflight check's "Install uv" fix. On success
  // `runPreflight` re-syncs the uv check + `available`, unblocking the agent's
  // version-status install action.
  const runUvInstall = useCallback(
    async (agent: AcpAgentInfo) => {
      if (busyActionRef.current.has(agent.agent_type)) return
      busyActionRef.current.add(agent.agent_type)
      setBusyBinaryAction((prev) => ({ ...prev, [agent.agent_type]: true }))
      setRunningActionKind((prev) => ({
        ...prev,
        [agent.agent_type]: "install_uv",
      }))
      const actionLabel = t("actions.install")
      const taskId = randomUUID()
      setStreamAgentType(agent.agent_type)
      await installStream.start(taskId)
      try {
        await acpInstallUvTool(taskId)
        await runPreflight(agent.agent_type)
        toast.success(
          t("toasts.agentActionCompleted", { name: "uv", action: actionLabel })
        )
      } catch (err) {
        const message = toErrorMessage(err)
        toast.error(
          t("toasts.agentActionFailed", { name: "uv", action: actionLabel }),
          { description: message }
        )
        throw err
      } finally {
        busyActionRef.current.delete(agent.agent_type)
        setBusyBinaryAction((prev) => ({ ...prev, [agent.agent_type]: false }))
        setRunningActionKind((prev) => ({
          ...prev,
          [agent.agent_type]: undefined,
        }))
      }
    },

    [runPreflight, t, installStream.start]
  )

  const handleFixAction = async (agent: AcpAgentInfo, action: UiFixAction) => {
    if (
      busyBinaryAction[agent.agent_type] ||
      busyActionRef.current.has(agent.agent_type)
    ) {
      return
    }
    if (action.kind === "open_url") {
      await openUrl(action.payload)
      return
    }
    if (action.kind === "download_binary") {
      await runBinaryAction(agent, "download")
      return
    }
    if (action.kind === "upgrade_binary") {
      await runBinaryAction(agent, "upgrade")
      return
    }
    if (action.kind === "install_npx") {
      await runNpxAction(agent, "install")
      return
    }
    if (action.kind === "upgrade_npx") {
      await runNpxAction(agent, "upgrade")
      return
    }
    if (action.kind === "uninstall_binary" || action.kind === "uninstall_npx") {
      setUninstallConfirmAgent(agent)
      return
    }
    if (action.kind === "redownload_binary") {
      await runBinaryAction(agent, "upgrade", "redownload_binary")
      return
    }
    if (action.kind === "install_opencode_plugins") {
      setPluginModalAgent(agent.agent_type)
      setPluginModalOpen(true)
      return
    }
    if (action.kind === "install_uv") {
      await runUvInstall(agent)
      return
    }
    if (action.kind === "custom_install") {
      setCustomVersionInput("")
      setCustomInstallAgent(agent)
      return
    }
    await runPreflight(agent.agent_type)
  }

  const confirmUninstall = useCallback(() => {
    if (!uninstallConfirmAgent) return
    const target = uninstallConfirmAgent
    runUninstallAction(target)
      .catch((err) => {
        console.error("[Settings] uninstall action failed:", err)
      })
      .finally(() => {
        setUninstallConfirmAgent(null)
      })
  }, [runUninstallAction, uninstallConfirmAgent])

  const confirmCustomInstall = useCallback(() => {
    if (!customInstallAgent) return
    const agent = customInstallAgent
    const version = customVersionInput.trim()
    if (!isValidCustomVersion(version)) return
    // Close immediately; progress streams into the detail panel log, and any
    // failure is surfaced via toast inside the run* actions.
    const run =
      agent.distribution_type === "binary"
        ? runBinaryAction(agent, "upgrade", "custom_install", version)
        : runNpxAction(agent, "upgrade", version)
    run.catch((err) => {
      console.error("[Settings] custom install failed:", err)
    })
    setCustomInstallAgent(null)
  }, [customInstallAgent, customVersionInput, runBinaryAction, runNpxAction])

  const persistReorder = useCallback(
    async (order: AgentType[]) => {
      if (order.length === 0) return
      setReordering(true)
      try {
        await acpReorderAgents(order)
      } catch (err) {
        console.error("[Settings] reorder agents failed:", err)
        const message = toErrorMessage(err)
        toast.error(t("toasts.saveAgentOrderFailed"), {
          description: message,
        })
        await refreshAgents()
      } finally {
        setReordering(false)
      }
    },
    [refreshAgents, t]
  )

  const handleReorder = useCallback((next: AcpAgentInfo[]) => {
    const reordered = next.map((agent, index) => ({
      ...agent,
      sort_order: index,
    }))
    setAgents(reordered)
    pendingOrderRef.current = reordered.map((agent) => agent.agent_type)
  }, [])

  const renderCheck = (agent: AcpAgentInfo, check: UiCheckItem) => {
    const checkKey = `${agent.agent_type}:${check.check_id}`
    const expanded = expandedChecks[checkKey] ?? check.status !== "pass"

    return (
      <div
        key={check.check_id}
        className="rounded-md border bg-muted/20 px-3 py-2 space-y-2"
      >
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2 text-left"
          onClick={() => {
            setExpandedChecks((prev) => ({
              ...prev,
              [checkKey]: !expanded,
            }))
          }}
        >
          <div className="min-w-0 flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="text-xs font-medium truncate">{check.label}</span>
          </div>
          <span
            className={`text-[11px] font-semibold shrink-0 ${statusTone(check.status)}`}
          >
            {check.status === "pass"
              ? t("status.pass")
              : check.status === "warn"
                ? t("status.warn")
                : t("status.fail")}
          </span>
        </button>

        {expanded && (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-[11px] text-muted-foreground break-words">
              {check.message}
            </div>
            {check.fixes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-end max-w-[220px] shrink-0">
                {check.fixes.map((fix, index) => (
                  <Button
                    key={`${fix.label}-${index}`}
                    size="xs"
                    variant="outline"
                    className="h-6 bg-muted/30 hover:bg-muted/50 disabled:bg-muted/30 disabled:opacity-100"
                    disabled={
                      ("disabled" in fix && fix.disabled === true) ||
                      (Boolean(busyBinaryAction[agent.agent_type]) &&
                        [
                          "download_binary",
                          "upgrade_binary",
                          "install_npx",
                          "upgrade_npx",
                          "uninstall_binary",
                          "uninstall_npx",
                          "redownload_binary",
                          "install_opencode_plugins",
                          "custom_install",
                          "install_uv",
                        ].includes(fix.kind))
                    }
                    onClick={() => {
                      handleFixAction(agent, fix).catch((err) => {
                        console.error("[Settings] fix action failed:", err)
                      })
                    }}
                  >
                    {runningActionKind[agent.agent_type] === fix.kind ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : fix.kind === "download_binary" ||
                      fix.kind === "install_npx" ||
                      fix.kind === "install_uv" ? (
                      <Download className="h-3 w-3" />
                    ) : fix.kind === "upgrade_binary" ||
                      fix.kind === "upgrade_npx" ||
                      fix.kind === "redownload_binary" ? (
                      <Wrench className="h-3 w-3" />
                    ) : fix.kind === "uninstall_binary" ||
                      fix.kind === "uninstall_npx" ? (
                      <Trash2 className="h-3 w-3" />
                    ) : fix.kind === "install_opencode_plugins" ? (
                      <Download className="h-3 w-3" />
                    ) : fix.kind === "custom_install" ? (
                      <PackagePlus className="h-3 w-3" />
                    ) : null}
                    {fix.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const selectedCurrent = selectedAgent
    ? checkState[selectedAgent.agent_type]
    : undefined
  const selectedDraft = selectedAgent
    ? (drafts[selectedAgent.agent_type] ?? buildAgentDraft(selectedAgent))
    : null
  const selectedConfigError = selectedAgent
    ? (configErrors[selectedAgent.agent_type] ?? null)
    : null
  const selectedIsSaving = selectedAgent
    ? Boolean(
        savingEnv[selectedAgent.agent_type] ||
        savingConfig[selectedAgent.agent_type]
      )
    : false
  const selectedIsSavingEnv = selectedAgent
    ? Boolean(savingEnv[selectedAgent.agent_type])
    : false
  const selectedIsSavingConfig = selectedAgent
    ? Boolean(savingConfig[selectedAgent.agent_type])
    : false
  const selectedAgentKind = selectedAgent?.agent_type ?? null

  const selectedModelProviders = useMemo(() => {
    if (!selectedAgent) return []
    return modelProviders
  }, [modelProviders, selectedAgent])

  const selectedNeedsModelProvider = useMemo(() => {
    if (!selectedDraft) return false
    if (!selectedAgent) return false
    const at = selectedAgent.agent_type
    if (at === "claude_code")
      return selectedDraft.claudeAuthMode === "model_provider"
    if (at === "codex") return selectedDraft.codexAuthMode === "model_provider"
    if (at === "gemini")
      return selectedDraft.geminiAuthMode === "model_provider"
    // kimi_code uses a self-contained panel; its model_provider state is
    // tracked inside  not in AgentDraft. When the parent
    // needs to know (e.g. to hide the generic env-editor), check the agent's
    // persisted model_provider_id or the panel-internal mode — for now, just
    // check the agent's model_provider_id.
    if (at === "kimi_code") return selectedAgent.model_provider_id != null
    if (at === "hermes")
      return selectedDraft.hermesAuthMode === "model_provider"
    if (at === "open_claw")
      return selectedDraft.openClawAuthMode === "model_provider"
    if (at === "cline") return selectedDraft.clineAuthMode === "model_provider"
    if (at === "open_code")
      return selectedDraft.openCodeAuthMode === "model_provider"
    if (at === "pi") return selectedDraft.piAuthMode === "model_provider"
    if (at === "code_buddy")
      return selectedDraft.codeBuddyAuthMode === "model_provider"
    if (at === "mimo_code") return selectedAgent.model_provider_id != null
    return false
  }, [selectedAgent, selectedDraft])

  const selectedMissingModelProvider =
    selectedNeedsModelProvider && selectedDraft?.modelProviderId == null
  const selectedConfigText = selectedDraft?.configText ?? ""
  const selectedOpenCodeAuthJsonText = selectedDraft?.openCodeAuthJsonText ?? ""
  const selectedCodexReasoningEffortOption =
    selectedAgent?.agent_type === "codex" && selectedDraft
      ? (CODEX_REASONING_EFFORT_OPTIONS.find(
          (option) => option.value === selectedDraft.codexReasoningEffort
        ) ?? null)
      : null
  const selectedOpenCodeConfig = useMemo(() => {
    if (selectedAgentKind !== "open_code" || !locale) return null
    return extractOpenCodeConfigValues(
      selectedConfigText,
      selectedOpenCodeAuthJsonText
    )
  }, [
    locale,
    selectedAgentKind,
    selectedConfigText,
    selectedOpenCodeAuthJsonText,
  ])
  const openCodeConnected = useMemo(() => {
    if (selectedAgentKind !== "open_code") return []
    return buildConnectedProviders({
      configText: selectedConfigText,
      authJsonText: selectedOpenCodeAuthJsonText,
      catalog: openCodeCatalog,
    })
  }, [
    selectedAgentKind,
    selectedConfigText,
    selectedOpenCodeAuthJsonText,
    openCodeCatalog,
  ])
  const openCodeModelOptions = useMemo(() => {
    const catalogGroups = buildConnectedModelOptions({
      connected: openCodeConnected,
      catalog: openCodeCatalog,
    })
    // Fall back to the config-derived groups before the catalog has loaded.
    return catalogGroups.length > 0
      ? catalogGroups
      : buildOpenCodeModelOptions(selectedOpenCodeConfig)
  }, [openCodeConnected, openCodeCatalog, selectedOpenCodeConfig])
  const openCodeCatalogIds = useMemo(
    () => new Set(openCodeCatalog.map((p) => p.id)),
    [openCodeCatalog]
  )
  // Split connected providers into two single-purpose surfaces:
  //  - well-known (catalog) providers connected via auth.json → top list
  //  - custom OpenAI-compatible endpoints (a `provider.<id>` block NOT in the
  //    catalog) → the bottom "custom provider" editor.
  // The discriminator is `hasConfigBlock && !inCatalog`, so an auth-only
  // well-known provider (no block) stays in the top list even if the catalog
  // fails to load — it can never be misfiled as custom and vanish.
  const openCodeWellKnownConnected = useMemo(
    () => openCodeConnected.filter((p) => !(p.hasConfigBlock && !p.inCatalog)),
    [openCodeConnected]
  )
  const openCodeCustomProviderIds = useMemo(
    () =>
      (selectedOpenCodeConfig?.providerIds ?? []).filter(
        (id) => !openCodeCatalogIds.has(id)
      ),
    [selectedOpenCodeConfig, openCodeCatalogIds]
  )
  // Lazily load the models.dev catalog the first time an OpenCode agent is
  // viewed. Backend resolves live → cache → bundled snapshot, so this never
  // hard-fails; on error we keep an empty catalog (custom-only flow) and allow
  // a retry the next time OpenCode is selected. The ref dedupes so we depend
  // only on `selectedAgentKind` — depending on the loading flag we set here
  // would re-run the effect and cancel its own in-flight request.
  useEffect(() => {
    if (selectedAgentKind !== "open_code") return
    if (openCodeCatalogRequestedRef.current) return
    openCodeCatalogRequestedRef.current = true
    setOpenCodeCatalogLoading(true)
    opencodeProviderCatalog()
      .then((list) => {
        setOpenCodeCatalog(list)
      })
      .catch((err) => {
        console.error("[Settings] opencode catalog load failed:", err)
        openCodeCatalogRequestedRef.current = false
      })
      .finally(() => {
        setOpenCodeCatalogLoading(false)
        setOpenCodeCatalogReady(true)
      })
  }, [selectedAgentKind])

  const selectedChecks = useMemo(() => {
    if (!selectedAgent || !locale) return []
    return getAgentChecks(selectedAgent, selectedCurrent)
  }, [locale, selectedAgent, selectedCurrent])

  const selectedReadiness = useMemo(() => {
    if (!selectedAgent || !selectedDraft) return null
    if (!isReadinessPilotAgent(selectedAgent.agent_type)) return null
    return buildAgentReadiness({
      agent: selectedAgent,
      draft: selectedDraft,
      checks: selectedChecks,
      isChecking: Boolean(checking[selectedAgent.agent_type]),
      openClawDiscovery:
        selectedAgent.agent_type === "open_claw" ? openClawDiscovery : null,
      t: rawTranslator,
    })
  }, [
    selectedAgent,
    selectedDraft,
    selectedChecks,
    checking,
    openClawDiscovery,
    rawTranslator,
  ])

  useEffect(() => {
    if (!selectedAgent || selectedChecks.length === 0) return
    setExpandedChecks((prev) => {
      let next = prev
      for (const check of selectedChecks) {
        const key = `${selectedAgent.agent_type}:${check.check_id}`
        if (typeof next[key] !== "undefined") continue
        if (next === prev) next = { ...prev }
        next[key] = check.status !== "pass"
      }
      return next
    })
  }, [selectedAgent, selectedChecks])

  useEffect(() => {
    if (!selectedOpenCodeConfig) {
      if (openCodeProviderId) setOpenCodeProviderId("")
      return
    }
    if (!openCodeProviderId) return
    if (selectedOpenCodeConfig.providerIds.includes(openCodeProviderId)) {
      return
    }
    setOpenCodeProviderId("")
  }, [openCodeProviderId, selectedOpenCodeConfig])

  useEffect(() => {
    if (!openCodeDeleteProviderId) return
    if (!selectedOpenCodeConfig) {
      setOpenCodeDeleteProviderId(null)
      return
    }
    if (
      !selectedOpenCodeConfig.providerIds.includes(openCodeDeleteProviderId)
    ) {
      setOpenCodeDeleteProviderId(null)
    }
  }, [openCodeDeleteProviderId, selectedOpenCodeConfig])

  const updateSelectedDraft = useCallback(
    (updater: (current: AgentDraft) => AgentDraft) => {
      if (!selectedAgent || !selectedDraft) return
      setDrafts((prev) => {
        const current = prev[selectedAgent.agent_type] ?? selectedDraft
        return {
          ...prev,
          [selectedAgent.agent_type]: updater(current),
        }
      })
    },
    [selectedAgent, selectedDraft]
  )

  const handleConfigTextChange = useCallback(
    (nextText: string) => {
      if (!selectedAgent || !selectedDraft) return
      const parseResult = parseConfigJsonText(nextText)
      setConfigErrors((prev) => ({
        ...prev,
        [selectedAgent.agent_type]: parseResult.error,
      }))

      if (parseResult.error) {
        updateSelectedDraft((current) => ({
          ...current,
          configText: nextText,
        }))
        return
      }

      if (selectedAgent.agent_type === "open_code") {
        const openCode = extractOpenCodeConfigValues(
          nextText,
          selectedDraft.openCodeAuthJsonText
        )
        updateSelectedDraft((current) => ({
          ...current,
          configText: nextText,
          model: openCode.model,
        }))
        return
      }

      if (selectedAgent.agent_type === "cline") {
        const cline = extractClineImportantValues(nextText)
        updateSelectedDraft((current) => ({
          ...current,
          configText: nextText,
          clineProvider: cline.provider,
          clineApiKey: cline.apiKey,
          clineModel: cline.model,
          clineBaseUrl: cline.baseUrl,
        }))
        return
      }

      const important = extractImportantConfigValues(
        selectedAgent.agent_type,
        parseEnvText(selectedDraft.envText),
        nextText
      )
      const geminiImportant =
        selectedAgent.agent_type === "gemini"
          ? extractGeminiImportantValues(
              parseEnvText(selectedDraft.envText),
              nextText
            )
          : null
      updateSelectedDraft((current) => ({
        ...current,
        configText: nextText,
        apiBaseUrl: geminiImportant
          ? geminiImportant.apiBaseUrl
          : important.apiBaseUrl,
        apiKey: important.apiKey,
        model: geminiImportant ? geminiImportant.model : important.model,
        geminiAuthMode: geminiImportant
          ? geminiImportant.authMode
          : current.geminiAuthMode,
        geminiApiKey: geminiImportant
          ? geminiImportant.geminiApiKey
          : current.geminiApiKey,
        googleApiKey: geminiImportant
          ? geminiImportant.googleApiKey
          : current.googleApiKey,
        googleCloudProject: geminiImportant
          ? geminiImportant.googleCloudProject
          : current.googleCloudProject,
        googleCloudLocation: geminiImportant
          ? geminiImportant.googleCloudLocation
          : current.googleCloudLocation,
        googleApplicationCredentials: geminiImportant
          ? geminiImportant.googleApplicationCredentials
          : current.googleApplicationCredentials,
        claudeMainModel: important.claudeMainModel,
        claudeReasoningModel: important.claudeReasoningModel,
        claudeDefaultHaikuModel: important.claudeDefaultHaikuModel,
        claudeDefaultSonnetModel: important.claudeDefaultSonnetModel,
        claudeDefaultOpusModel: important.claudeDefaultOpusModel,
        claudeCustomModelOption: important.claudeCustomModelOption,
        claudeCustomModelOptionName: important.claudeCustomModelOptionName,
        claudeCustomModelOptionDescription:
          important.claudeCustomModelOptionDescription,
        claudeEffortLevel: important.claudeEffortLevel,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleImportantConfigChange = useCallback(
    (key: ImportantConfigKey, value: string) => {
      if (!selectedAgent || !selectedDraft) return
      const nextDraft = applyImportantFieldToDraft(selectedDraft, key, value)
      const nextJson = patchImportantConfigText(
        selectedAgent.agent_type,
        selectedDraft.configText,
        buildImportantPatchFromDraft(nextDraft)
      )
      if (nextJson.recoveredFromInvalid) {
        toast.warning(t("warnings.nativeJsonRecoveredStructured"))
      }
      setConfigErrors((prev) => ({
        ...prev,
        [selectedAgent.agent_type]: null,
      }))
      updateSelectedDraft((current) => {
        const nextCurrent = applyImportantFieldToDraft(current, key, value)
        return {
          ...nextCurrent,
          envText: patchEnvByImportantKey(
            selectedAgent.agent_type,
            current.envText,
            key,
            value
          ),
          configText: nextJson.configText,
        }
      })
    },
    [selectedAgent, selectedDraft, t, updateSelectedDraft]
  )

  const handleClaudeEffortLevelChange = useCallback(
    (nextValue: ClaudeEffortLevel) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "claude_code"
      )
        return
      const parsed = parseConfigJsonText(selectedDraft.configText)
      if (parsed.error) {
        toast.warning(t("warnings.nativeJsonRecoveredStructured"))
      }
      const config: Record<string, unknown> = parsed.error
        ? {}
        : { ...parsed.config }
      if (nextValue) {
        config[CLAUDE_EFFORT_LEVEL_CONFIG_KEY] = nextValue
      } else {
        delete config[CLAUDE_EFFORT_LEVEL_CONFIG_KEY]
      }
      const nextConfigText =
        Object.keys(config).length === 0 ? "" : JSON.stringify(config, null, 2)
      setConfigErrors((prev) => ({
        ...prev,
        [selectedAgent.agent_type]: null,
      }))
      updateSelectedDraft((current) => ({
        ...current,
        claudeEffortLevel: nextValue,
        configText: nextConfigText,
      }))
    },
    [selectedAgent, selectedDraft, t, updateSelectedDraft]
  )

  const handleModelProviderSelect = useCallback(
    (providerIdStr: string) => {
      if (!selectedAgent || !selectedDraft) return
      const providerId = providerIdStr ? Number(providerIdStr) : null
      const provider = providerId
        ? modelProviders.find((p) => p.id === providerId)
        : null
      const apiUrl = provider?.api_url ?? ""
      const apiKey = provider?.api_key ?? ""
      const agentType = selectedAgent.agent_type

      if (agentType === "claude_code") {
        // Keep the agent's currently selected model; provider only supplies credentials.
        const claudeMain = selectedDraft.claudeMainModel
        const claudeReasoning = selectedDraft.claudeReasoningModel
        const claudeHaiku = selectedDraft.claudeDefaultHaikuModel
        const claudeSonnet = selectedDraft.claudeDefaultSonnetModel
        const claudeOpus = selectedDraft.claudeDefaultOpusModel
        const claudeCustomOption = selectedDraft.claudeCustomModelOption
        const claudeCustomOptionName = selectedDraft.claudeCustomModelOptionName
        const claudeCustomOptionDescription =
          selectedDraft.claudeCustomModelOptionDescription
        const nextConfigJson = patchImportantConfigText(
          agentType,
          selectedDraft.configText,
          {
            apiBaseUrl: apiUrl,
            apiKey,
            model: selectedDraft.model,
            claudeMainModel: claudeMain,
            claudeReasoningModel: claudeReasoning,
            claudeDefaultHaikuModel: claudeHaiku,
            claudeDefaultSonnetModel: claudeSonnet,
            claudeDefaultOpusModel: claudeOpus,
            // The custom model option travels with the provider's model JSON,
            // authoritative like the five model fields: a defined value sets it,
            // an empty/omitted value clears the key from config.env.
            claudeCustomModelOption: claudeCustomOption,
            claudeCustomModelOptionName: claudeCustomOptionName,
            claudeCustomModelOptionDescription: claudeCustomOptionDescription,
          }
        )
        setConfigErrors((prev) => ({
          ...prev,
          [agentType]: null,
        }))
        updateSelectedDraft((current) => {
          let nextEnvText = patchEnvByImportantKey(
            agentType,
            current.envText,
            "apiBaseUrl",
            apiUrl
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "apiKey",
            apiKey
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "claudeMainModel",
            claudeMain
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "claudeReasoningModel",
            claudeReasoning
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "claudeDefaultHaikuModel",
            claudeHaiku
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "claudeDefaultSonnetModel",
            claudeSonnet
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "claudeDefaultOpusModel",
            claudeOpus
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "claudeCustomModelOption",
            claudeCustomOption
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "claudeCustomModelOptionName",
            claudeCustomOptionName
          )
          nextEnvText = patchEnvByImportantKey(
            agentType,
            nextEnvText,
            "claudeCustomModelOptionDescription",
            claudeCustomOptionDescription
          )
          return {
            ...current,
            modelProviderId: providerId,
            apiBaseUrl: apiUrl,
            apiKey,
            claudeMainModel: claudeMain,
            claudeReasoningModel: claudeReasoning,
            claudeDefaultHaikuModel: claudeHaiku,
            claudeDefaultSonnetModel: claudeSonnet,
            claudeDefaultOpusModel: claudeOpus,
            claudeCustomModelOption: claudeCustomOption,
            claudeCustomModelOptionName: claudeCustomOptionName,
            claudeCustomModelOptionDescription: claudeCustomOptionDescription,
            envText: nextEnvText,
            configText: nextConfigJson.configText,
          }
        })
      } else if (agentType === "codex") {
        const keepModel = selectedDraft.model
        const nextAuthPatch = patchCodexAuthJsonText(
          selectedDraft.codexAuthJsonText,
          { apiKey, authMode: null }
        )
        const nextAuthJsonText = nextAuthPatch.authJsonText
        // Credentials only — keep the agent's currently selected model.
        const nextConfigTomlText = patchCodexConfigTomlText(
          selectedDraft.codexConfigTomlText,
          {
            modelProvider: CODEX_DEFAULT_MODEL_PROVIDER,
            apiBaseUrl: apiUrl,
            model: keepModel,
          }
        )
        const synced = extractCodexImportantValues(
          nextAuthJsonText,
          nextConfigTomlText
        )
        updateSelectedDraft((current) => ({
          ...current,
          modelProviderId: providerId,
          apiBaseUrl: apiUrl,
          apiKey,
          model: keepModel,
          codexAuthJsonText: nextAuthJsonText,
          codexConfigTomlText: nextConfigTomlText,
          codexModelProvider: CODEX_DEFAULT_MODEL_PROVIDER,
          codexProviderOptions: synced.providerOptions,
          envText: patchEnvText(current.envText, {
            OPENAI_API_KEY: apiKey,
            OPENAI_BASE_URL: apiUrl,
            OPENAI_MODEL: keepModel,
          }),
        }))
      } else if (agentType === "gemini") {
        const keepModel = selectedDraft.model
        const nextConfigJson = patchGeminiConfigText(selectedDraft.configText, {
          apiBaseUrl: apiUrl,
          geminiApiKey: apiKey,
        })
        setConfigErrors((prev) => ({
          ...prev,
          [agentType]: null,
        }))
        updateSelectedDraft((current) => {
          let nextEnvText = patchGeminiEnvText(current.envText, {
            apiBaseUrl: apiUrl,
            geminiApiKey: apiKey,
          })
          // Keep the agent's currently selected model when binding a provider.
          nextEnvText = patchEnvText(nextEnvText, {
            GEMINI_MODEL: keepModel,
          })
          return {
            ...current,
            modelProviderId: providerId,
            apiBaseUrl: apiUrl,
            apiKey,
            geminiApiKey: apiKey,
            model: keepModel,
            envText: nextEnvText,
            configText: nextConfigJson.configText,
          }
        })
      } else if (agentType === "hermes") {
        const keepModel = selectedDraft.model
        updateSelectedDraft((current) => ({
          ...current,
          modelProviderId: providerId,
          hermesAuthMode: "model_provider",
          apiBaseUrl: apiUrl,
          apiKey,
          model: keepModel,
          envText: patchEnvText(current.envText, {
            OPENAI_BASE_URL: apiUrl,
            OPENAI_API_KEY: apiKey,
            OPENAI_MODEL: keepModel,
          }),
        }))
      } else if (agentType === "open_claw") {
        const keepModel = selectedDraft.model
        updateSelectedDraft((current) => ({
          ...current,
          modelProviderId: providerId,
          model: keepModel,
          envText: patchEnvText(current.envText, {
            OPENAI_BASE_URL: apiUrl,
            OPENAI_API_KEY: apiKey,
            OPENAI_MODEL: keepModel,
          }),
        }))
      } else if (agentType === "cline") {
        const keepModel = selectedDraft.model
        updateSelectedDraft((current) => ({
          ...current,
          modelProviderId: providerId,
          apiBaseUrl: apiUrl,
          apiKey,
          clineApiKey: apiKey,
          model: keepModel,
          envText: patchEnvText(current.envText, {
            OPENAI_BASE_URL: apiUrl,
            OPENAI_API_KEY: apiKey,
            OPENAI_MODEL: keepModel,
          }),
        }))
      } else if (agentType === "open_code") {
        // OpenCode models are `provider/model`. When binding the managed
        // veryagent provider, keep a bare model id and let the cascade write
        // `veryagent/<model>` into opencode.json.
        const keepModel = selectedDraft.model.replace(/^veryagent\//, "").trim()
        updateSelectedDraft((current) => ({
          ...current,
          modelProviderId: providerId,
          apiBaseUrl: apiUrl,
          apiKey,
          model: keepModel,
          envText: patchEnvText(current.envText, {
            OPENAI_BASE_URL: apiUrl,
            OPENAI_API_KEY: apiKey,
            OPENAI_MODEL: keepModel,
          }),
        }))
      } else if (agentType === "pi") {
        const keepModel = selectedDraft.model
        updateSelectedDraft((current) => ({
          ...current,
          modelProviderId: providerId,
          apiBaseUrl: apiUrl,
          apiKey,
          model: keepModel,
          envText: patchEnvText(current.envText, {
            OPENAI_BASE_URL: apiUrl,
            OPENAI_API_KEY: apiKey,
            OPENAI_MODEL: keepModel,
          }),
        }))
      } else if (agentType === "code_buddy") {
        const keepModel = selectedDraft.model
        updateSelectedDraft((current) => ({
          ...current,
          modelProviderId: providerId,
          apiBaseUrl: apiUrl,
          apiKey,
          model: keepModel,
          // A计划 is additive via ~/.codebuddy/models.json (backend cascade).
          // Do not overwrite CODEBUDDY_API_KEY / region / BASE_URL — those
          // own the native China/overseas Tencent catalog.
          envText: patchEnvText(current.envText, {
            CODEBUDDY_MODEL: keepModel,
            CODEBUDDY_BASE_URL: "",
            CODEBUDDY_DISABLE_BUILTIN_MODELS: "",
          }),
        }))
      } else {
        updateSelectedDraft((current) => ({
          ...current,
          modelProviderId: providerId,
        }))
      }
    },
    [selectedAgent, selectedDraft, modelProviders, updateSelectedDraft]
  )

  // Auto-select the first available provider when the user switches an agent to
  // "model_provider" auth mode and hasn't picked one yet. If the list is empty,
  // the existing "noModelProviderAvailable" hint handles the empty state.
  useEffect(() => {
    if (!selectedNeedsModelProvider) return
    if (selectedDraft?.modelProviderId != null) return
    if (selectedModelProviders.length === 0) return
    handleModelProviderSelect(String(selectedModelProviders[0].id))
  }, [
    selectedNeedsModelProvider,
    selectedDraft?.modelProviderId,
    selectedModelProviders,
    handleModelProviderSelect,
  ])

  // Fetch the selected provider's model list for the agent-side picker.
  useEffect(() => {
    if (!selectedNeedsModelProvider || selectedDraft?.modelProviderId == null) {
      setProviderModels([])
      setProviderModelsError(null)
      setProviderModelsLoading(false)
      return
    }
    const providerId = selectedDraft.modelProviderId
    let cancelled = false
    setProviderModelsLoading(true)
    setProviderModelsError(null)
    void fetchModelProviderModels(providerId)
      .then((models) => {
        if (cancelled) return
        setProviderModels(models)
      })
      .catch((error) => {
        if (cancelled) return
        console.error("[Settings] fetch provider models failed:", error)
        setProviderModels([])
        setProviderModelsError(toErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setProviderModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    selectedNeedsModelProvider,
    selectedDraft?.modelProviderId,
    providerModelsRefreshKey,
  ])

  const handleProviderModelChange = useCallback(
    (modelId: string) => {
      if (!selectedAgent || !selectedDraft) return
      const agentType = selectedAgent.agent_type

      if (agentType === "claude_code") {
        handleImportantConfigChange("claudeMainModel", modelId)
        return
      }

      if (agentType === "codex") {
        const nextToml = patchCodexConfigTomlText(
          selectedDraft.codexConfigTomlText,
          {
            model: modelId,
            modelReasoningEffort: selectedDraft.codexReasoningEffort,
          }
        )
        const synced = extractCodexImportantValues(
          selectedDraft.codexAuthJsonText,
          nextToml
        )
        updateSelectedDraft((current) => ({
          ...applyImportantFieldToDraft(current, "model", modelId),
          model: synced.model,
          codexModelProvider: synced.modelProvider,
          codexProviderOptions: synced.providerOptions,
          codexReasoningEffort: synced.reasoningEffort,
          codexSupportsWebsockets: synced.supportsWebsockets,
          codexSkills: synced.skills,
          codexServiceTierFast: synced.serviceTierFast,
          codexConfigTomlText: nextToml,
          envText: patchEnvText(current.envText, {
            OPENAI_MODEL: modelId,
          }),
        }))
        return
      }

      if (agentType === "gemini") {
        updateSelectedDraft((current) => ({
          ...current,
          model: modelId,
          envText: patchEnvText(current.envText, {
            GEMINI_MODEL: modelId,
          }),
        }))
        return
      }

      if (
        agentType === "hermes" ||
        agentType === "open_claw" ||
        agentType === "open_code" ||
        agentType === "pi"
      ) {
        updateSelectedDraft((current) => ({
          ...current,
          model: modelId,
          envText: patchEnvText(current.envText, {
            OPENAI_MODEL: modelId,
          }),
        }))
        return
      }

      if (agentType === "code_buddy") {
        // Remember the A计划 selection; backend rewrites models.json on save.
        // Do not force ANTHROPIC_MODEL / disable built-ins — native Tencent
        // models must remain selectable (China vs overseas region).
        updateSelectedDraft((current) => ({
          ...current,
          model: modelId,
          envText: patchEnvText(current.envText, {
            CODEBUDDY_MODEL: modelId,
            ANTHROPIC_CUSTOM_MODEL_OPTION: modelId,
            ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: modelId,
          }),
        }))
        return
      }

      if (agentType === "cline") {
        updateSelectedDraft((current) => {
          const next = {
            ...current,
            model: modelId,
            clineModel: modelId,
            envText: patchEnvText(current.envText, {
              OPENAI_MODEL: modelId,
            }),
          }
          const config: Record<string, unknown> = {}
          config.apiProvider = next.clineProvider
          if (next.clineApiKey.trim()) config.apiKey = next.clineApiKey.trim()
          if (modelId.trim()) config.model = modelId.trim()
          if (next.clineBaseUrl.trim()) {
            config.apiBaseUrl = next.clineBaseUrl.trim()
          }
          next.configText = JSON.stringify(config, null, 2)
          return next
        })
        return
      }

      handleImportantConfigChange("model", modelId)
    },
    [
      selectedAgent,
      selectedDraft,
      handleImportantConfigChange,
      updateSelectedDraft,
    ]
  )

  const renderProviderModelPicker = (opts?: {
    disabled?: boolean
    value?: string
    placeholder?: string
  }) => {
    const value = opts?.value ?? selectedDraft?.model ?? ""
    const disabled = Boolean(opts?.disabled || selectedIsSavingConfig)
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-muted-foreground">
            {t("selectProviderModel")}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={
              disabled ||
              providerModelsLoading ||
              selectedDraft?.modelProviderId == null
            }
            onClick={() => setProviderModelsRefreshKey((n) => n + 1)}
          >
            {providerModelsLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("refreshProviderModels")}
          </Button>
        </div>
        <Input
          list="provider-model-options"
          value={value}
          onChange={(event) => handleProviderModelChange(event.target.value)}
          placeholder={opts?.placeholder ?? t("selectProviderModel")}
          disabled={disabled}
        />
        {providerModels.length > 0 && (
          <datalist id="provider-model-options">
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </datalist>
        )}
        {providerModelsLoading ? (
          <p className="text-[11px] text-muted-foreground">
            {t("providerModelLoading")}
          </p>
        ) : providerModelsError ? (
          <div className="space-y-0.5">
            <p className="text-[11px] text-destructive">
              {t("providerModelFetchFailed")}
            </p>
            <p className="break-all text-[11px] text-destructive/80">
              {providerModelsError}
            </p>
          </div>
        ) : providerModels.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {t("providerModelEmpty")}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {t("providerModelHint")}
          </p>
        )}
      </div>
    )
  }

  const handleGeminiFieldChange = useCallback(
    (
      key:
        | "apiBaseUrl"
        | "model"
        | "geminiApiKey"
        | "googleApiKey"
        | "googleCloudProject"
        | "googleCloudLocation"
        | "googleApplicationCredentials",
      value: string
    ) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "gemini"
      )
        return

      const nextValues = {
        authMode: selectedDraft.geminiAuthMode,
        apiBaseUrl: selectedDraft.apiBaseUrl,
        geminiApiKey: selectedDraft.geminiApiKey,
        googleApiKey: selectedDraft.googleApiKey,
        googleCloudProject: selectedDraft.googleCloudProject,
        googleCloudLocation: selectedDraft.googleCloudLocation,
        googleApplicationCredentials:
          selectedDraft.googleApplicationCredentials,
        model: selectedDraft.model,
      }
      nextValues[key] = value
      const normalizedValues = patchGeminiAuthMode(
        nextValues,
        nextValues.authMode
      )

      const nextConfig = patchGeminiConfigText(selectedDraft.configText, {
        apiBaseUrl: normalizedValues.apiBaseUrl,
        model: normalizedValues.model,
        geminiApiKey: normalizedValues.geminiApiKey,
        googleApiKey: normalizedValues.googleApiKey,
        googleCloudProject: normalizedValues.googleCloudProject,
        googleCloudLocation: normalizedValues.googleCloudLocation,
        googleApplicationCredentials:
          normalizedValues.googleApplicationCredentials,
      })
      if (nextConfig.recoveredFromInvalid) {
        toast.warning(t("warnings.nativeJsonRecoveredStructured"))
      }
      setConfigErrors((prev) => ({
        ...prev,
        [selectedAgent.agent_type]: null,
      }))

      updateSelectedDraft((current) => {
        const nextEnvText = patchGeminiEnvText(current.envText, {
          apiBaseUrl: normalizedValues.apiBaseUrl,
          model: normalizedValues.model,
          geminiApiKey: normalizedValues.geminiApiKey,
          googleApiKey: normalizedValues.googleApiKey,
          googleCloudProject: normalizedValues.googleCloudProject,
          googleCloudLocation: normalizedValues.googleCloudLocation,
          googleApplicationCredentials:
            normalizedValues.googleApplicationCredentials,
        })
        return {
          ...current,
          apiBaseUrl: normalizedValues.apiBaseUrl,
          model: normalizedValues.model,
          apiKey:
            normalizedValues.geminiApiKey || normalizedValues.googleApiKey,
          geminiAuthMode: normalizedValues.authMode,
          geminiApiKey: normalizedValues.geminiApiKey,
          googleApiKey: normalizedValues.googleApiKey,
          googleCloudProject: normalizedValues.googleCloudProject,
          googleCloudLocation: normalizedValues.googleCloudLocation,
          googleApplicationCredentials:
            normalizedValues.googleApplicationCredentials,
          envText: nextEnvText,
          configText: nextConfig.configText,
        }
      })
    },
    [selectedAgent, selectedDraft, t, updateSelectedDraft]
  )

  const handleGeminiAuthModeChange = useCallback(
    (nextMode: GeminiAuthMode) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "gemini"
      )
        return

      if (nextMode === "model_provider") {
        // Keep existing values; provider selection will fill API URL/Key
        updateSelectedDraft((current) => ({
          ...current,
          geminiAuthMode: nextMode,
          modelProviderId: current.modelProviderId,
        }))
        return
      }

      const patched = patchGeminiAuthMode(
        {
          authMode: selectedDraft.geminiAuthMode,
          apiBaseUrl: selectedDraft.apiBaseUrl,
          geminiApiKey: selectedDraft.geminiApiKey,
          googleApiKey: selectedDraft.googleApiKey,
          googleCloudProject: selectedDraft.googleCloudProject,
          googleCloudLocation: selectedDraft.googleCloudLocation,
          googleApplicationCredentials:
            selectedDraft.googleApplicationCredentials,
          model: selectedDraft.model,
        },
        nextMode
      )

      const nextConfig = patchGeminiConfigText(selectedDraft.configText, {
        apiBaseUrl: patched.apiBaseUrl,
        model: patched.model,
        geminiApiKey: patched.geminiApiKey,
        googleApiKey: patched.googleApiKey,
        googleCloudProject: patched.googleCloudProject,
        googleCloudLocation: patched.googleCloudLocation,
        googleApplicationCredentials: patched.googleApplicationCredentials,
      })
      if (nextConfig.recoveredFromInvalid) {
        toast.warning(t("warnings.nativeJsonRecoveredStructured"))
      }
      setConfigErrors((prev) => ({
        ...prev,
        [selectedAgent.agent_type]: null,
      }))

      updateSelectedDraft((current) => ({
        ...current,
        geminiAuthMode: patched.authMode,
        modelProviderId: null,
        apiBaseUrl: patched.apiBaseUrl,
        apiKey: patched.geminiApiKey || patched.googleApiKey,
        geminiApiKey: patched.geminiApiKey,
        googleApiKey: patched.googleApiKey,
        googleCloudProject: patched.googleCloudProject,
        googleCloudLocation: patched.googleCloudLocation,
        googleApplicationCredentials: patched.googleApplicationCredentials,
        envText: patchGeminiEnvText(current.envText, {
          apiBaseUrl: patched.apiBaseUrl,
          model: patched.model,
          geminiApiKey: patched.geminiApiKey,
          googleApiKey: patched.googleApiKey,
          googleCloudProject: patched.googleCloudProject,
          googleCloudLocation: patched.googleCloudLocation,
          googleApplicationCredentials: patched.googleApplicationCredentials,
        }),
        configText: nextConfig.configText,
      }))
    },
    [selectedAgent, selectedDraft, t, updateSelectedDraft]
  )

  const handleOpenClawFieldChange = useCallback(
    (
      key: "openClawGatewayUrl" | "openClawGatewayToken" | "openClawSessionKey",
      value: string
    ) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "open_claw"
      )
        return

      const envKeyMap: Record<string, string> = {
        openClawGatewayUrl: OPENCLAW_ENV_KEYS.gatewayUrl,
        openClawGatewayToken: OPENCLAW_ENV_KEYS.gatewayToken,
        openClawSessionKey: OPENCLAW_ENV_KEYS.sessionKey,
      }

      updateSelectedDraft((current) => ({
        ...current,
        [key]: value,
        envText: patchEnvText(current.envText, {
          [envKeyMap[key]]: value,
        }),
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleOpenCodeAuthModeChange = useCallback(
    (nextMode: OpenCodeAuthMode) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "open_code"
      )
        return
      updateSelectedDraft((current) => ({
        ...current,
        openCodeAuthMode: nextMode,
        modelProviderId:
          nextMode === "model_provider" ? current.modelProviderId : null,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handlePiAuthModeChange = useCallback(
    (nextMode: PiAuthMode) => {
      if (!selectedAgent || !selectedDraft || selectedAgent.agent_type !== "pi")
        return
      updateSelectedDraft((current) => ({
        ...current,
        piAuthMode: nextMode,
        modelProviderId:
          nextMode === "model_provider" ? current.modelProviderId : null,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleCodeBuddyAuthModeChange = useCallback(
    (nextMode: CodeBuddyAuthMode) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "code_buddy"
      )
        return
      updateSelectedDraft((current) => ({
        ...current,
        codeBuddyAuthMode: nextMode,
        modelProviderId:
          nextMode === "model_provider" ? current.modelProviderId : null,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  // Command Code login state: probe `~/.commandcode/auth.json` + env API key.
  // Pure file read on the backend, safe to call on selection change and on
  // demand via the refresh button.
  const refreshCommandCodeLogin = useCallback(async () => {
    try {
      const status = await acpGetCommandCodeLoginStatus()
      // Normalize: if loggedIn, treat running as false so the UI
      // never shows "waiting for authorization" when already logged in.
      setCommandCodeLogin(
        status.loggedIn ? { ...status, running: false } : status
      )
    } catch (err) {
      console.error("[Settings] command code login status failed:", err)
      setCommandCodeLogin(null)
    }
  }, [])

  useEffect(() => {
    if (selectedAgent?.agent_type === "command_code") {
      refreshCommandCodeLogin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent?.agent_type])

  // `cmdc login` runs in the background: Command Code opens the browser itself
  // and completes the OAuth callback against its localhost server, then writes
  // auth.json. If already logged in, `cmdc login` exits immediately with
  // "Already logged in" — surface that instead of pretending to start a flow.
  const runCommandCodeLogin = useCallback(async () => {
    try {
      const status = await acpGetCommandCodeLoginStatus()
      if (status.loggedIn) {
        toast.info(
          status.accountName
            ? t("commandCode.alreadyLoggedInAs", {
                name: status.accountName,
              })
            : t("commandCode.loginStatusLoggedIn")
        )
        setCommandCodeLogin(status)
        return
      }
      await acpStartCommandCodeLogin()
      await refreshCommandCodeLogin()
    } catch (err) {
      console.error("[Settings] start cmdc login failed:", err)
      toast.error(toErrorMessage(err))
    }
  }, [refreshCommandCodeLogin, t])

  const cancelCommandCodeLogin = useCallback(async () => {
    try {
      await acpCancelCommandCodeLogin()
    } catch (err) {
      console.error("[Settings] cancel cmdc login failed:", err)
    }
    await refreshCommandCodeLogin()
  }, [refreshCommandCodeLogin])

  // Log out: delete the local auth.json credential.
  const handleLogoutCommandCode = useCallback(async () => {
    try {
      await acpLogoutCommandCode()
      setCommandCodeLogin(null)
      toast.success("已退出登录")
    } catch (err) {
      console.error("[Settings] logout command code failed:", err)
      toast.error("退出登录失败")
    }
  }, [])

  // While a background login is in flight, poll until it completes (or the
  // user cancels / navigates away).
  const commandCodeLoginNotifiedRef = useRef(false)
  useEffect(() => {
    if (
      selectedAgent?.agent_type !== "command_code" ||
      !commandCodeLogin?.running
    ) {
      return
    }
    commandCodeLoginNotifiedRef.current = false
    const timer = setInterval(async () => {
      try {
        const status = await acpGetCommandCodeLoginStatus()
        // If loggedIn is true, treat as not running so the UI
        // immediately reflects the logged-in state. The backend may
        // still report running=true if the cmdc login process hasn't
        // fully exited yet, but the credential is already usable.
        const displayStatus = status.loggedIn
          ? { ...status, running: false }
          : status
        setCommandCodeLogin(displayStatus)
        if (status.loggedIn && !commandCodeLoginNotifiedRef.current) {
          commandCodeLoginNotifiedRef.current = true
          toast.success(t("commandCode.loginSuccess"))
        }
      } catch (err) {
        console.error("[Settings] poll cmdc login status failed:", err)
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [selectedAgent?.agent_type, commandCodeLogin?.running, t])

  // Save an API key into the agent env as COMMAND_CODE_API_KEY (the CLI's
  // non-interactive credential, which takes precedence over auth.json).
  const saveCommandCodeApiKey = useCallback(async () => {
    const key = commandCodeApiKey.trim()
    if (!key) return
    if (!selectedAgent || !selectedDraft) return
    setCommandCodeSavingKey(true)
    try {
      const nextEnvText = patchEnvText(selectedDraft.envText, {
        COMMAND_CODE_API_KEY: key,
      })
      await persistEnv(
        "command_code",
        selectedDraft.enabled,
        nextEnvText,
        selectedDraft.modelProviderId
      )
      // Keep the env textarea in sync with what was persisted.
      updateSelectedDraft((current) => ({ ...current, envText: nextEnvText }))
      setCommandCodeApiKey("")
      await refreshCommandCodeLogin()
      toast.success(t("commandCode.apiKeySaved"))
    } catch (err) {
      console.error("[Settings] save command code api key failed:", err)
      toast.error(toErrorMessage(err))
    } finally {
      setCommandCodeSavingKey(false)
    }
  }, [
    commandCodeApiKey,
    selectedAgent,
    selectedDraft,
    persistEnv,
    refreshCommandCodeLogin,
    updateSelectedDraft,
    t,
  ])

  const handleClineFieldChange = useCallback(
    (
      key: "clineProvider" | "clineApiKey" | "clineModel" | "clineBaseUrl",
      value: string
    ) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "cline"
      )
        return

      updateSelectedDraft((current) => {
        const next = { ...current, [key]: value }
        // Rebuild config_json from Cline draft fields
        const config: Record<string, unknown> = {}
        config.apiProvider =
          key === "clineProvider" ? value : next.clineProvider
        const apiKey = key === "clineApiKey" ? value : next.clineApiKey
        if (apiKey.trim()) config.apiKey = apiKey.trim()
        const model = key === "clineModel" ? value : next.clineModel
        if (model.trim()) config.model = model.trim()
        const baseUrl = key === "clineBaseUrl" ? value : next.clineBaseUrl
        if (baseUrl.trim()) config.apiBaseUrl = baseUrl.trim()
        next.configText = JSON.stringify(config, null, 2)
        return next
      })
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleClineAuthModeChange = useCallback(
    (nextMode: ClineAuthMode) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "cline"
      )
        return
      updateSelectedDraft((current) => ({
        ...current,
        clineAuthMode: nextMode,
        modelProviderId:
          nextMode === "model_provider" ? current.modelProviderId : null,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleOpenCodeConfigPatch = useCallback(
    (mutator: (config: Record<string, unknown>) => void) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "open_code"
      )
        return
      const nextConfig = patchOpenCodeConfigText(
        selectedDraft.configText,
        mutator
      )
      if (nextConfig.recoveredFromInvalid) {
        toast.warning(t("warnings.nativeJsonRecoveredOpenCode"))
      }
      setConfigErrors((prev) => ({
        ...prev,
        [selectedAgent.agent_type]: null,
      }))
      const parsed = extractOpenCodeConfigValues(
        nextConfig.configText,
        selectedDraft.openCodeAuthJsonText
      )
      updateSelectedDraft((current) => ({
        ...current,
        configText: nextConfig.configText,
        model: parsed.model,
      }))
    },
    [selectedAgent, selectedDraft, t, updateSelectedDraft]
  )

  const handleOpenCodeFieldChange = useCallback(
    (key: "model" | "small_model", value: string) => {
      handleOpenCodeConfigPatch((config) => {
        const trimmed = value.trim()
        if (!trimmed) {
          delete config[key]
          return
        }
        config[key] = trimmed
      })
    },
    [handleOpenCodeConfigPatch]
  )

  // Connect a provider from the dialog: sync the draft, then persist both files.
  const applyOpenCodeConnect = useCallback(
    async (
      next: { configText: string; authJsonText: string },
      providerId: string
    ) => {
      if (!selectedAgent || selectedAgent.agent_type !== "open_code") return
      const parsed = extractOpenCodeConfigValues(
        next.configText,
        next.authJsonText
      )
      updateSelectedDraft((current) => ({
        ...current,
        configText: next.configText,
        openCodeAuthJsonText: next.authJsonText,
        model: parsed.model,
      }))
      setConfigErrors((prev) => ({ ...prev, open_code: null }))
      try {
        await persistConfig("open_code", next.configText, {
          openCodeAuthJsonText: next.authJsonText,
        })
        toast.success(t("toasts.providerConnected", { providerId }), {
          description: t("toasts.configSavedHint"),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(t("toasts.connectFailed", { providerId }), {
          description: message,
        })
        throw err
      }
    },
    [selectedAgent, updateSelectedDraft, persistConfig, t]
  )

  const handleOpenCodeDisconnect = useCallback(
    async (providerId: string, hasConfigBlock: boolean) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "open_code"
      )
        return
      const next = disconnectProvider({
        configText: selectedDraft.configText,
        authJsonText: selectedDraft.openCodeAuthJsonText,
        providerId,
        removeConfigBlock: hasConfigBlock,
      })
      const parsed = extractOpenCodeConfigValues(
        next.configText,
        next.authJsonText
      )
      updateSelectedDraft((current) => ({
        ...current,
        configText: next.configText,
        openCodeAuthJsonText: next.authJsonText,
        model: parsed.model,
      }))
      try {
        await persistConfig("open_code", next.configText, {
          openCodeAuthJsonText: next.authJsonText,
        })
        toast.success(t("toasts.providerDisconnected", { providerId }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(t("toasts.disconnectFailed", { providerId }), {
          description: message,
        })
      }
    },
    [selectedAgent, selectedDraft, updateSelectedDraft, persistConfig, t]
  )

  const handleOpenCodeToggleEnabled = useCallback(
    async (providerId: string, enabled: boolean) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "open_code"
      )
        return
      const nextConfig = setProviderEnabled({
        configText: selectedDraft.configText,
        providerId,
        enabled,
      })
      updateSelectedDraft((current) => ({
        ...current,
        configText: nextConfig,
      }))
      try {
        await persistConfig("open_code", nextConfig, {
          openCodeAuthJsonText: selectedDraft.openCodeAuthJsonText,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(t("toasts.saveOpenCodeFailed"), { description: message })
      }
    },
    [selectedAgent, selectedDraft, updateSelectedDraft, persistConfig, t]
  )

  // Force a fresh models.dev fetch (bypassing the 24h cache) on demand.
  const handleOpenCodeRefreshCatalog = useCallback(async () => {
    setOpenCodeCatalogLoading(true)
    try {
      const list = await opencodeProviderCatalog(true)
      setOpenCodeCatalog(list)
      openCodeCatalogRequestedRef.current = true
      toast.success(t("toasts.catalogRefreshed", { count: list.length }))
    } catch (err) {
      console.error("[Settings] opencode catalog refresh failed:", err)
      toast.error(t("toasts.catalogRefreshFailed"), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setOpenCodeCatalogLoading(false)
    }
  }, [t])

  const handleOpenCodeRemoveProvider = useCallback(
    (providerId: string) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "open_code"
      ) {
        return null
      }
      const targetId = providerId.trim()
      if (!targetId) return null

      const nextConfig = patchOpenCodeConfigText(
        selectedDraft.configText,
        (config) => {
          const providerRoot = asObjectRecord(config.provider)
          if (providerRoot) {
            delete providerRoot[targetId]
            if (Object.keys(providerRoot).length === 0) {
              delete config.provider
            }
          }

          const enabledProviders = Array.isArray(config.enabled_providers)
            ? config.enabled_providers
                .filter((item): item is string => typeof item === "string")
                .filter((item) => item !== targetId)
            : []
          if (enabledProviders.length > 0) {
            config.enabled_providers = enabledProviders
          } else {
            delete config.enabled_providers
          }

          const disabledProviders = Array.isArray(config.disabled_providers)
            ? config.disabled_providers
                .filter((item): item is string => typeof item === "string")
                .filter((item) => item !== targetId)
            : []
          if (disabledProviders.length > 0) {
            config.disabled_providers = disabledProviders
          } else {
            delete config.disabled_providers
          }

          // Don't leave model/small_model pointing at the removed provider.
          for (const key of [
            "model",
            "small_model",
            "smallModel",
            "small-model",
          ]) {
            if (modelReferencesProvider(config[key], targetId)) {
              delete config[key]
            }
          }
        }
      )
      if (nextConfig.recoveredFromInvalid) {
        toast.warning(t("warnings.nativeJsonRecoveredOpenCode"))
      }

      const nextAuth = patchOpenCodeAuthJsonText(
        selectedDraft.openCodeAuthJsonText,
        (authObject) => {
          delete authObject[targetId]
        }
      )
      if (nextAuth.recoveredFromInvalid) {
        toast.warning(t("warnings.openCodeAuthRecovered"))
      }

      const nextOpenCode = extractOpenCodeConfigValues(
        nextConfig.configText,
        nextAuth.authJsonText
      )
      const nextDraft = {
        ...selectedDraft,
        configText: nextConfig.configText,
        openCodeAuthJsonText: nextAuth.authJsonText,
        model: nextOpenCode.model,
      }
      setConfigErrors((prev) => ({
        ...prev,
        [selectedAgent.agent_type]: null,
      }))
      setDrafts((prev) => ({
        ...prev,
        [selectedAgent.agent_type]: nextDraft,
      }))
      setOpenCodeProviderId((current) => (current === targetId ? "" : current))
      setOpenCodeNewModelIds((prev) => {
        if (typeof prev[targetId] === "undefined") return prev
        const next = { ...prev }
        delete next[targetId]
        return next
      })
      setOpenCodeModelConfigExpanded((prev) => {
        if (typeof prev[targetId] === "undefined") return prev
        const next = { ...prev }
        delete next[targetId]
        return next
      })
      setOpenCodeModelIdDrafts((prev) => {
        const prefix = `${targetId}:`
        const keys = Object.keys(prev).filter((key) => key.startsWith(prefix))
        if (keys.length === 0) return prev
        const next = { ...prev }
        for (const key of keys) {
          delete next[key]
        }
        return next
      })
      return {
        enabled: nextDraft.enabled,
        envText: nextDraft.envText,
        configText: nextDraft.configText,
        openCodeAuthJsonText: nextDraft.openCodeAuthJsonText,
      }
    },
    [selectedAgent, selectedDraft, t]
  )

  const confirmOpenCodeProviderDelete = useCallback(() => {
    const providerId = openCodeDeleteProviderId?.trim()
    if (!providerId) return
    const removed = handleOpenCodeRemoveProvider(providerId)
    setOpenCodeDeleteProviderId(null)
    if (
      !removed ||
      !selectedAgent ||
      selectedAgent.agent_type !== "open_code"
    ) {
      return
    }
    persistConfig(selectedAgent.agent_type, removed.configText, {
      openCodeAuthJsonText: removed.openCodeAuthJsonText,
    })
      .then(() => {
        toast.success(t("toasts.providerDeleted", { providerId }), {
          description: t("toasts.openCodeConfigSynced"),
        })
      })
      .catch((err) => {
        console.error("[Settings] remove opencode provider failed:", err)
        const message = toErrorMessage(err)
        toast.error(t("toasts.providerDeleteFailed", { providerId }), {
          description: message,
        })
      })
  }, [
    handleOpenCodeRemoveProvider,
    openCodeDeleteProviderId,
    persistConfig,
    selectedAgent,
    t,
  ])

  const handleOpenCodeProviderStatusChange = useCallback(
    (providerId: string, enabled: boolean) => {
      const targetId = providerId.trim()
      if (!targetId) return
      handleOpenCodeConfigPatch((config) => {
        const hadEnabledAllowlist =
          Array.isArray(config.enabled_providers) &&
          config.enabled_providers.length > 0
        const enabledProviders = Array.isArray(config.enabled_providers)
          ? config.enabled_providers
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
          : []
        const disabledProviders = Array.isArray(config.disabled_providers)
          ? config.disabled_providers
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean)
          : []

        const nextEnabled = new Set(enabledProviders)
        const nextDisabled = new Set(disabledProviders)

        if (enabled) {
          nextDisabled.delete(targetId)
          if (hadEnabledAllowlist) {
            nextEnabled.add(targetId)
          }
        } else {
          nextDisabled.add(targetId)
          if (hadEnabledAllowlist) {
            nextEnabled.delete(targetId)
          }
        }

        const enabledArray = Array.from(nextEnabled)
        const disabledArray = Array.from(nextDisabled)
        if (enabledArray.length > 0) {
          config.enabled_providers = enabledArray
        } else {
          delete config.enabled_providers
        }
        if (disabledArray.length > 0) {
          config.disabled_providers = disabledArray
        } else {
          delete config.disabled_providers
        }
      })
    },
    [handleOpenCodeConfigPatch]
  )

  const handleOpenCodeProviderFieldChange = useCallback(
    (
      providerId: string,
      key: "name" | "api" | "npm" | "baseURL" | "apiKey",
      value: string
    ) => {
      const targetId = providerId.trim()
      if (!targetId) return

      // The API key is a secret: it goes ONLY into auth.json, never into
      // opencode.json. setProviderApiKey also scrubs any stale options.apiKey.
      if (key === "apiKey") {
        if (!selectedDraft) return
        const next = setProviderApiKey({
          configText: selectedDraft.configText,
          authJsonText: selectedDraft.openCodeAuthJsonText,
          providerId: targetId,
          apiKey: value,
        })
        const parsed = extractOpenCodeConfigValues(
          next.configText,
          next.authJsonText
        )
        setConfigErrors((prev) => ({ ...prev, open_code: null }))
        updateSelectedDraft((current) => ({
          ...current,
          configText: next.configText,
          openCodeAuthJsonText: next.authJsonText,
          model: parsed.model,
        }))
        return
      }

      handleOpenCodeConfigPatch((config) => {
        const providerRoot = asObjectRecord(config.provider) ?? {}
        if (!asObjectRecord(config.provider)) {
          config.provider = providerRoot
        }

        const currentProvider = asObjectRecord(providerRoot[targetId]) ?? {}
        if (!asObjectRecord(providerRoot[targetId])) {
          providerRoot[targetId] = currentProvider
        }
        const trimmed = value.trim()
        if (key === "baseURL") {
          const options = asObjectRecord(currentProvider.options) ?? {}
          if (!asObjectRecord(currentProvider.options)) {
            currentProvider.options = options
          }
          if (trimmed) {
            options[key] = trimmed
          } else {
            delete options[key]
          }
          if (Object.keys(options).length === 0) {
            delete currentProvider.options
          }
          return
        }
        if (trimmed) {
          currentProvider[key] = trimmed
        } else {
          delete currentProvider[key]
        }
      })
    },
    [handleOpenCodeConfigPatch, selectedDraft, updateSelectedDraft]
  )

  const handleOpenCodeModelDraftChange = useCallback(
    (providerId: string, value: string) => {
      const targetId = providerId.trim()
      if (!targetId) return
      setOpenCodeNewModelIds((prev) => ({
        ...prev,
        [targetId]: value,
      }))
    },
    []
  )

  const handleOpenCodeAddModel = useCallback(
    (providerId: string) => {
      const targetProviderId = providerId.trim()
      if (!targetProviderId || !selectedOpenCodeConfig) return
      const nextModelId = (openCodeNewModelIds[targetProviderId] ?? "").trim()
      if (!nextModelId) return
      const targetProvider = selectedOpenCodeConfig.providers[targetProviderId]
      if (!targetProvider) return
      if (targetProvider.modelIds.includes(nextModelId)) {
        toast.error(t("errors.modelExists", { modelId: nextModelId }))
        return
      }
      handleOpenCodeConfigPatch((config) => {
        const providerRoot = asObjectRecord(config.provider) ?? {}
        if (!asObjectRecord(config.provider)) {
          config.provider = providerRoot
        }

        const currentProvider =
          asObjectRecord(providerRoot[targetProviderId]) ?? {}
        if (!asObjectRecord(providerRoot[targetProviderId])) {
          providerRoot[targetProviderId] = currentProvider
        }

        const modelsRoot = asObjectRecord(currentProvider.models) ?? {}
        if (!asObjectRecord(currentProvider.models)) {
          currentProvider.models = modelsRoot
        }
        modelsRoot[nextModelId] = {
          name: nextModelId,
        }
      })
      setOpenCodeNewModelIds((prev) => ({
        ...prev,
        [targetProviderId]: "",
      }))
    },
    [handleOpenCodeConfigPatch, openCodeNewModelIds, selectedOpenCodeConfig, t]
  )

  const handleOpenCodeRemoveModel = useCallback(
    (providerId: string, modelId: string) => {
      const targetProviderId = providerId.trim()
      const targetModelId = modelId.trim()
      if (!targetProviderId || !targetModelId) return
      handleOpenCodeConfigPatch((config) => {
        const providerRoot = asObjectRecord(config.provider)
        if (!providerRoot) return
        const currentProvider = asObjectRecord(providerRoot[targetProviderId])
        if (!currentProvider) return
        const modelsRoot = asObjectRecord(currentProvider.models)
        if (!modelsRoot) return
        delete modelsRoot[targetModelId]
        if (Object.keys(modelsRoot).length === 0) {
          delete currentProvider.models
        }
      })
      const draftKey = `${targetProviderId}:${targetModelId}`
      setOpenCodeModelIdDrafts((prev) => {
        if (typeof prev[draftKey] === "undefined") return prev
        const next = { ...prev }
        delete next[draftKey]
        return next
      })
    },
    [handleOpenCodeConfigPatch]
  )

  const handleOpenCodeModelIdDraftChange = useCallback(
    (providerId: string, modelId: string, value: string) => {
      const targetProviderId = providerId.trim()
      const targetModelId = modelId.trim()
      if (!targetProviderId || !targetModelId) return
      const draftKey = `${targetProviderId}:${targetModelId}`
      setOpenCodeModelIdDrafts((prev) => ({
        ...prev,
        [draftKey]: value,
      }))
    },
    []
  )

  const handleOpenCodeModelIdCommit = useCallback(
    (providerId: string, modelId: string) => {
      const targetProviderId = providerId.trim()
      const targetModelId = modelId.trim()
      if (!targetProviderId || !targetModelId || !selectedOpenCodeConfig) return
      const draftKey = `${targetProviderId}:${targetModelId}`
      const rawDraft = openCodeModelIdDrafts[draftKey]
      if (typeof rawDraft !== "string") return
      const nextModelId = rawDraft.trim()

      if (!nextModelId || nextModelId === targetModelId) {
        setOpenCodeModelIdDrafts((prev) => {
          const next = { ...prev }
          delete next[draftKey]
          return next
        })
        return
      }

      if (!/^[A-Za-z0-9_.:-]+$/.test(nextModelId)) {
        toast.error(t("errors.modelIdPattern"))
        return
      }

      const targetProvider = selectedOpenCodeConfig.providers[targetProviderId]
      if (!targetProvider) return
      if (targetProvider.modelIds.includes(nextModelId)) {
        toast.error(t("errors.modelExists", { modelId: nextModelId }))
        return
      }

      handleOpenCodeConfigPatch((config) => {
        const providerRoot = asObjectRecord(config.provider) ?? {}
        if (!asObjectRecord(config.provider)) {
          config.provider = providerRoot
        }
        const currentProvider =
          asObjectRecord(providerRoot[targetProviderId]) ?? {}
        if (!asObjectRecord(providerRoot[targetProviderId])) {
          providerRoot[targetProviderId] = currentProvider
        }
        const modelsRoot = asObjectRecord(currentProvider.models) ?? {}
        if (!asObjectRecord(currentProvider.models)) {
          currentProvider.models = modelsRoot
        }
        const currentModel = asObjectRecord(modelsRoot[targetModelId]) ?? {}
        if (!asObjectRecord(modelsRoot[targetModelId])) return
        delete currentModel.id
        modelsRoot[nextModelId] = currentModel
        delete modelsRoot[targetModelId]
      })

      setOpenCodeModelIdDrafts((prev) => {
        const next = { ...prev }
        delete next[draftKey]
        return next
      })
    },
    [
      handleOpenCodeConfigPatch,
      openCodeModelIdDrafts,
      selectedOpenCodeConfig,
      t,
    ]
  )

  const handleOpenCodeModelFieldChange = useCallback(
    (providerId: string, modelId: string, value: string) => {
      const targetProviderId = providerId.trim()
      const targetModelId = modelId.trim()
      if (!targetProviderId || !targetModelId) return
      handleOpenCodeConfigPatch((config) => {
        const providerRoot = asObjectRecord(config.provider) ?? {}
        if (!asObjectRecord(config.provider)) {
          config.provider = providerRoot
        }
        const currentProvider =
          asObjectRecord(providerRoot[targetProviderId]) ?? {}
        if (!asObjectRecord(providerRoot[targetProviderId])) {
          providerRoot[targetProviderId] = currentProvider
        }
        const modelsRoot = asObjectRecord(currentProvider.models) ?? {}
        if (!asObjectRecord(currentProvider.models)) {
          currentProvider.models = modelsRoot
        }
        const currentModel = asObjectRecord(modelsRoot[targetModelId]) ?? {}
        if (!asObjectRecord(modelsRoot[targetModelId])) {
          modelsRoot[targetModelId] = currentModel
        }
        const trimmed = value.trim()
        if (trimmed) {
          currentModel.name = trimmed
        } else {
          delete currentModel.name
        }
        // Cleanup legacy schema written by earlier versions.
        delete currentModel.id
      })
    },
    [handleOpenCodeConfigPatch]
  )

  const handleCodexConfigTomlTextChange = useCallback(
    (nextText: string) => {
      if (!selectedAgent || selectedAgent.agent_type !== "codex") return
      const important = extractCodexImportantValues(
        selectedDraft?.codexAuthJsonText ?? "",
        nextText
      )
      updateSelectedDraft((current) => ({
        ...current,
        codexConfigTomlText: nextText,
        apiBaseUrl: important.apiBaseUrl,
        apiKey: important.apiKey ?? current.apiKey,
        model: important.model,
        codexModelProvider: important.modelProvider,
        codexProviderOptions: important.providerOptions,
        codexReasoningEffort: important.reasoningEffort,
        codexSupportsWebsockets: important.supportsWebsockets,
        codexSkills: important.skills,
        codexServiceTierFast: important.serviceTierFast,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleCodexAuthModeChange = useCallback(
    (nextMode: CodexAuthMode) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "codex"
      )
        return

      if (nextMode === "chatgpt_subscription") {
        // Official subscription: set auth_mode to chatgpt, OPENAI_API_KEY to null
        const nextAuth = patchCodexAuthJsonText(
          selectedDraft.codexAuthJsonText,
          { authMode: "chatgpt" }
        )
        const nextAuthJsonText = nextAuth.authJsonText
        let nextConfigTomlText = updateTomlRootStringKey(
          selectedDraft.codexConfigTomlText,
          "model_provider",
          ""
        )
        nextConfigTomlText = removeTomlSection(
          nextConfigTomlText,
          `model_providers.${CODEX_DEFAULT_MODEL_PROVIDER}`
        )
        const synced = extractCodexImportantValues(
          nextAuthJsonText,
          nextConfigTomlText
        )
        updateSelectedDraft((current) => ({
          ...current,
          codexAuthMode: nextMode,
          modelProviderId: null,
          codexAuthJsonText: nextAuthJsonText,
          codexConfigTomlText: nextConfigTomlText,
          envText: patchEnvText(current.envText, {
            OPENAI_API_KEY: "",
            OPENAI_BASE_URL: "",
          }),
          apiBaseUrl: "",
          apiKey: "",
          model: synced.model,
          codexModelProvider: synced.modelProvider,
          codexProviderOptions: synced.providerOptions,
          codexReasoningEffort: synced.reasoningEffort,
          codexSupportsWebsockets: synced.supportsWebsockets,
          codexSkills: synced.skills,
          codexServiceTierFast: synced.serviceTierFast,
        }))
        return
      }

      // "api_key" or "model_provider": ensure model_provider = "veryagent" in toml
      const nextConfigTomlText = patchCodexConfigTomlText(
        selectedDraft.codexConfigTomlText,
        { modelProvider: CODEX_DEFAULT_MODEL_PROVIDER }
      )
      const nextAuthPatch = patchCodexAuthJsonText(
        selectedDraft.codexAuthJsonText,
        { authMode: null }
      )
      const nextAuthJsonText = nextAuthPatch.authJsonText
      const synced = extractCodexImportantValues(
        nextAuthJsonText,
        nextConfigTomlText
      )
      updateSelectedDraft((current) => ({
        ...current,
        codexAuthMode: nextMode,
        modelProviderId:
          nextMode === "model_provider" ? current.modelProviderId : null,
        codexAuthJsonText: nextAuthJsonText,
        codexConfigTomlText: nextConfigTomlText,
        apiBaseUrl: synced.apiBaseUrl,
        apiKey: synced.apiKey ?? current.apiKey,
        model: synced.model,
        codexModelProvider: CODEX_DEFAULT_MODEL_PROVIDER,
        codexProviderOptions: synced.providerOptions,
        codexReasoningEffort: synced.reasoningEffort,
        codexSupportsWebsockets: synced.supportsWebsockets,
        codexSkills: synced.skills,
        codexServiceTierFast: synced.serviceTierFast,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleCodexImportantConfigChange = useCallback(
    (
      key: "apiBaseUrl" | "apiKey" | "model" | "reasoningEffort",
      value: string
    ) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "codex"
      )
        return
      const nextAuth =
        key === "apiKey"
          ? patchCodexAuthJsonText(selectedDraft.codexAuthJsonText, {
              apiKey: value,
            })
          : {
              authJsonText: selectedDraft.codexAuthJsonText,
              recoveredFromInvalid: false,
            }
      const nextToml =
        key === "apiBaseUrl"
          ? patchCodexConfigTomlText(selectedDraft.codexConfigTomlText, {
              apiBaseUrl: value,
              modelProvider: selectedDraft.codexModelProvider,
              modelReasoningEffort: selectedDraft.codexReasoningEffort,
            })
          : key === "model"
            ? patchCodexConfigTomlText(selectedDraft.codexConfigTomlText, {
                model: value,
                modelReasoningEffort: selectedDraft.codexReasoningEffort,
              })
            : key === "reasoningEffort"
              ? patchCodexConfigTomlText(selectedDraft.codexConfigTomlText, {
                  modelReasoningEffort: value,
                })
              : selectedDraft.codexConfigTomlText
      if (nextAuth.recoveredFromInvalid) {
        toast.warning(t("warnings.authRecoveredStructured"))
      }
      const synced = extractCodexImportantValues(
        nextAuth.authJsonText,
        nextToml
      )
      updateSelectedDraft((current) => ({
        ...(key === "reasoningEffort"
          ? {
              ...current,
              codexReasoningEffort:
                normalizeCodexReasoningEffort(value) ??
                CODEX_DEFAULT_REASONING_EFFORT,
            }
          : applyImportantFieldToDraft(current, key, value)),
        apiBaseUrl: synced.apiBaseUrl,
        apiKey: synced.apiKey ?? current.apiKey,
        model: synced.model,
        codexModelProvider: synced.modelProvider,
        codexProviderOptions: synced.providerOptions,
        codexReasoningEffort: synced.reasoningEffort,
        codexSupportsWebsockets: synced.supportsWebsockets,
        codexSkills: synced.skills,
        codexServiceTierFast: synced.serviceTierFast,
        codexAuthJsonText: nextAuth.authJsonText,
        codexConfigTomlText: nextToml,
      }))
    },
    [selectedAgent, selectedDraft, t, updateSelectedDraft]
  )

  const handleCodexSupportsWebsocketsChange = useCallback(
    (enabled: boolean) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "codex"
      )
        return
      const nextToml = patchCodexConfigTomlText(
        selectedDraft.codexConfigTomlText,
        {
          modelProvider: selectedDraft.codexModelProvider,
          supportsWebsockets: enabled,
        }
      )
      const synced = extractCodexImportantValues(
        selectedDraft.codexAuthJsonText,
        nextToml
      )
      updateSelectedDraft((current) => ({
        ...current,
        apiBaseUrl: synced.apiBaseUrl,
        apiKey: synced.apiKey ?? current.apiKey,
        model: synced.model,
        codexModelProvider: synced.modelProvider,
        codexProviderOptions: synced.providerOptions,
        codexReasoningEffort: synced.reasoningEffort,
        codexSupportsWebsockets: synced.supportsWebsockets,
        codexSkills: synced.skills,
        codexServiceTierFast: synced.serviceTierFast,
        codexConfigTomlText: nextToml,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleCodexSkillsChange = useCallback(
    (enabled: boolean) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "codex"
      )
        return
      const nextToml = patchCodexConfigTomlText(
        selectedDraft.codexConfigTomlText,
        { skills: enabled }
      )
      const synced = extractCodexImportantValues(
        selectedDraft.codexAuthJsonText,
        nextToml
      )
      updateSelectedDraft((current) => ({
        ...current,
        apiBaseUrl: synced.apiBaseUrl,
        apiKey: synced.apiKey ?? current.apiKey,
        model: synced.model,
        codexModelProvider: synced.modelProvider,
        codexProviderOptions: synced.providerOptions,
        codexReasoningEffort: synced.reasoningEffort,
        codexSupportsWebsockets: synced.supportsWebsockets,
        codexSkills: synced.skills,
        codexServiceTierFast: synced.serviceTierFast,
        codexConfigTomlText: nextToml,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleCodexServiceTierFastChange = useCallback(
    (enabled: boolean) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "codex"
      )
        return
      const nextToml = patchCodexConfigTomlText(
        selectedDraft.codexConfigTomlText,
        { serviceTierFast: enabled }
      )
      const synced = extractCodexImportantValues(
        selectedDraft.codexAuthJsonText,
        nextToml
      )
      updateSelectedDraft((current) => ({
        ...current,
        apiBaseUrl: synced.apiBaseUrl,
        apiKey: synced.apiKey ?? current.apiKey,
        model: synced.model,
        codexModelProvider: synced.modelProvider,
        codexProviderOptions: synced.providerOptions,
        codexReasoningEffort: synced.reasoningEffort,
        codexSupportsWebsockets: synced.supportsWebsockets,
        codexSkills: synced.skills,
        codexServiceTierFast: synced.serviceTierFast,
        codexConfigTomlText: nextToml,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleCodexDeviceLogin = useCallback(async () => {
    setCodexLoginStatus("requesting")
    setCodexLoginError(null)
    setCodexDeviceCode(null)
    codexPollCancelledRef.current = false
    try {
      const resp = await codexRequestDeviceCode()
      setCodexDeviceCode(resp)
      setCodexLoginStatus("polling")
    } catch (err) {
      const msg = toErrorMessage(err)
      setCodexLoginError(msg)
      setCodexLoginStatus("error")
    }
  }, [])

  const cancelCodexDeviceLogin = useCallback(() => {
    codexPollCancelledRef.current = true
    setCodexLoginStatus("idle")
    setCodexDeviceCode(null)
    setCodexLoginError(null)
  }, [])

  useEffect(() => {
    if (codexLoginStatus !== "polling" || !codexDeviceCode) return
    codexPollCancelledRef.current = false
    const pollInterval = (codexDeviceCode.interval || 5) * 1000
    const deadline = Date.now() + 15 * 60 * 1000
    let timer: ReturnType<typeof setTimeout> | null = null
    let active = true

    const poll = async () => {
      if (!active || codexPollCancelledRef.current) return
      if (Date.now() > deadline) {
        setCodexLoginError(t("codex.loginTimeout"))
        setCodexLoginStatus("error")
        setCodexDeviceCode(null)
        return
      }
      try {
        const result = await codexPollDeviceCode({
          deviceAuthId: codexDeviceCode.deviceAuthId,
          userCode: codexDeviceCode.userCode,
        })
        if (!active || codexPollCancelledRef.current) return
        if (result.status === "success") {
          setCodexLoginStatus("success")
          setCodexDeviceCode(null)
          const authJson = JSON.stringify(
            {
              auth_mode: "chatgpt",
              OPENAI_API_KEY: null,
              tokens: {
                id_token: result.idToken,
                access_token: result.accessToken,
                refresh_token: result.refreshToken,
                account_id: result.accountId ?? "",
              },
              last_refresh: new Date().toISOString(),
            },
            null,
            2
          )
          updateSelectedDraft((current) => ({
            ...current,
            codexAuthJsonText: authJson,
          }))
          const draft = drafts.codex
          if (draft) {
            const codexEnvText =
              draft.codexAuthMode === "chatgpt_subscription"
                ? patchEnvText(draft.envText, {
                    OPENAI_API_KEY: "",
                    OPENAI_BASE_URL: "",
                  })
                : draft.envText
            try {
              // Persist sequentially, never in parallel: persistEnv
              // (acp_update_agent_env) rewrites ~/.codex/config.toml to sync the
              // root `model`, while persistConfig writes the full config.toml
              // (including base_url). Running both at once races two
              // read-modify-write cycles on the same file, letting the model
              // sync clobber the just-written base_url. persistConfig runs last
              // so its authoritative config.toml wins.
              await persistEnv(
                "codex",
                draft.enabled,
                codexEnvText,
                draft.modelProviderId
              )
              await persistConfig("codex", draft.configText, {
                codexAuthJsonText: authJson,
                codexConfigTomlText: draft.codexConfigTomlText,
              })
            } catch (err) {
              const msg = toErrorMessage(err)
              toast.error(t("codex.loginSaveFailed"), {
                description: msg,
              })
            }
          }
          return
        }
        if (result.status === "error") {
          setCodexLoginError(result.message ?? "Unknown error")
          setCodexLoginStatus("error")
          setCodexDeviceCode(null)
          return
        }
        timer = setTimeout(poll, pollInterval)
      } catch {
        if (!active || codexPollCancelledRef.current) return
        timer = setTimeout(poll, pollInterval)
      }
    }

    timer = setTimeout(poll, pollInterval)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [
    codexLoginStatus,
    codexDeviceCode,
    drafts.codex,
    persistConfig,
    persistEnv,
    updateSelectedDraft,
    t,
  ])

  useEffect(() => {
    if (selectedAgent?.agent_type !== "codex" && codexLoginStatus !== "idle") {
      cancelCodexDeviceLogin()
    }
  }, [selectedAgent, codexLoginStatus, cancelCodexDeviceLogin])

  if (loadingAgents) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        {t("loadingAgents")}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-3 md:p-4">
      <div className="flex items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
      </div>
      {loadingError && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {loadingError}
        </div>
      )}
      <div className="flex-1 min-h-0 grid gap-3 lg:grid-cols-[minmax(240px,320px)_1fr]">
        <div className="min-h-0 min-w-0 rounded-lg border bg-card flex flex-col overflow-hidden">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            {t("agentList")}
          </div>
          <Reorder.Group
            as="div"
            axis="y"
            values={sortedAgents}
            onReorder={handleReorder}
            ref={agentListRef}
            className="flex-1 min-h-0 overflow-y-auto space-y-2 p-2"
          >
            {sortedAgents.map((agent) => {
              const current = checkState[agent.agent_type]
              const isChecking = Boolean(checking[agent.agent_type])
              const draft = drafts[agent.agent_type] ?? buildAgentDraft(agent)
              const allChecks = getAgentChecks(agent, current)
              const pilotReadiness = isReadinessPilotAgent(agent.agent_type)
                ? buildAgentReadiness({
                    agent,
                    draft,
                    checks: allChecks,
                    isChecking,
                    openClawDiscovery:
                      agent.agent_type === "open_claw"
                        ? openClawDiscovery
                        : null,
                    t: rawTranslator,
                  })
                : null
              const summary = summarizeChecks(allChecks)
              const displaySummary: CheckStatus | "unchecked" | "checking" =
                isChecking ? "checking" : summary
              const statusLabel = pilotReadiness
                ? pilotReadiness.badge
                : displaySummary === "unchecked"
                  ? t("status.unchecked")
                  : displaySummary === "checking"
                    ? t("readiness.badge.checking")
                    : displaySummary === "pass"
                      ? t("status.pass")
                      : displaySummary === "warn"
                        ? t("status.warn")
                        : t("status.fail")
              const statusToneClass = pilotReadiness
                ? readinessToneClass(pilotReadiness.kind)
                : !draft.enabled
                  ? "border-muted-foreground/30 bg-muted/30 text-muted-foreground"
                  : displaySummary === "pass"
                    ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                    : displaySummary === "fail"
                      ? "border-red-500/40 bg-red-500/10 text-red-500"
                      : displaySummary === "warn"
                        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                        : displaySummary === "checking"
                          ? "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "border-muted-foreground/30 bg-muted/30 text-muted-foreground"

              const inactive = !draft.enabled || !agent.available

              return (
                <AgentReorderItem
                  key={agent.agent_type}
                  agent={agent}
                  selected={selectedAgentType === agent.agent_type}
                  reordering={reordering}
                  dragging={dragging}
                  inactive={inactive}
                  onDragStart={(agentType) => {
                    setDragging(agentType)
                  }}
                  onDragEnd={() => {
                    const order = pendingOrderRef.current
                    pendingOrderRef.current = null
                    setDragging(null)
                    if (order && !reordering) {
                      persistReorder(order).catch((err) => {
                        console.error("[Settings] reorder agents failed:", err)
                      })
                    }
                  }}
                  onSelect={(agentType) => {
                    setSelectedAgentType(agentType)
                  }}
                >
                  {(startDrag) => (
                    <div className="flex items-center justify-between gap-2 overflow-hidden">
                      <div className="min-w-0 flex items-center gap-2">
                        <button
                          type="button"
                          className="text-muted-foreground cursor-grab active:cursor-grabbing rounded p-0.5 hover:bg-muted"
                          title={t("actions.dragSort")}
                          aria-label={t("actions.dragSortAgent", {
                            name: agent.name,
                          })}
                          onPointerDown={startDrag}
                          onClick={(event) => {
                            event.stopPropagation()
                          }}
                          disabled={reordering}
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </button>
                        <AgentIcon
                          agentType={agent.agent_type}
                          muted={inactive}
                          className="h-4 w-4"
                        />
                        <span
                          className={cn(
                            "text-sm font-medium truncate",
                            inactive && "text-muted-foreground"
                          )}
                        >
                          {agent.name}
                        </span>
                        {draft.enabled && agent.available ? (
                          <span
                            className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"
                            aria-label={t("status.agentEnabledAria", {
                              name: agent.name,
                            })}
                            title={t("status.enabled")}
                          />
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-6 px-2 inline-flex items-center gap-1 text-xs leading-none",
                            statusToneClass
                          )}
                        >
                          <span>{statusLabel}</span>
                          {displaySummary === "checking" && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          )}
                          {!isChecking && (
                            <button
                              type="button"
                              className="inline-flex h-4 w-4 items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10"
                              title={t("actions.refreshCheck")}
                              aria-label={t("actions.refreshCheckAgent", {
                                name: agent.name,
                              })}
                              onClick={(event) => {
                                event.stopPropagation()
                                runPreflight(agent.agent_type, true).catch(
                                  (err) => {
                                    console.error(
                                      "[Settings] single preflight failed:",
                                      err
                                    )
                                  }
                                )
                              }}
                            >
                              <RefreshCw className="h-3 w-3 shrink-0" />
                            </button>
                          )}
                        </Badge>
                      </div>
                    </div>
                  )}
                </AgentReorderItem>
              )
            })}
          </Reorder.Group>
        </div>

        <div className="min-h-0 min-w-0 rounded-lg border bg-card">
          {selectedAgent && selectedDraft ? (
            <div className="h-full flex flex-col">
              <div className="border-b px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div
                    className={cn(
                      "min-w-0 flex items-center gap-2",
                      (!selectedDraft.enabled || !selectedAgent.available) &&
                        "opacity-60 text-muted-foreground"
                    )}
                  >
                    <AgentIcon
                      agentType={selectedAgent.agent_type}
                      muted={!selectedDraft.enabled || !selectedAgent.available}
                      className="h-5 w-5"
                    />
                    <h3 className="text-sm font-semibold truncate">
                      {selectedAgent.name}
                    </h3>
                    <Badge variant="outline" className="shrink-0">
                      {selectedAgent.distribution_type}
                    </Badge>
                  </div>
                  <div className="flex items-center shrink-0">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={selectedDraft.enabled}
                      aria-label={t("status.agentEnabledSwitch", {
                        name: selectedAgent.name,
                      })}
                      title={
                        selectedDraft.enabled
                          ? t("actions.clickDisable", {
                              name: selectedAgent.name,
                            })
                          : t("actions.clickEnable", {
                              name: selectedAgent.name,
                            })
                      }
                      disabled={selectedIsSaving}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                        selectedDraft.enabled
                          ? "bg-primary"
                          : "bg-muted-foreground/30",
                        selectedIsSaving && "cursor-not-allowed opacity-60"
                      )}
                      onClick={() => {
                        const nextEnabled = !selectedDraft.enabled
                        const nextDraft = {
                          ...selectedDraft,
                          enabled: nextEnabled,
                        }
                        setDrafts((prev) => ({
                          ...prev,
                          [selectedAgent.agent_type]: nextDraft,
                        }))
                        persistEnv(
                          selectedAgent.agent_type,
                          nextEnabled,
                          nextDraft.envText,
                          nextDraft.modelProviderId
                        ).catch((err) => {
                          console.error(
                            "[Settings] persist enabled failed:",
                            err
                          )
                          const message = toErrorMessage(err)
                          toast.error(t("toasts.saveAgentSwitchFailed"), {
                            description: message,
                          })
                        })
                      }}
                    >
                      <span
                        className={cn(
                          "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                          selectedDraft.enabled
                            ? "translate-x-4"
                            : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {selectedAgent.description}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="space-y-2">
                  {selectedCurrent?.error && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400 flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span className="break-all">{selectedCurrent.error}</span>
                    </div>
                  )}
                  {selectedReadiness && (
                    <div
                      className={cn(
                        "rounded-md border px-3 py-2.5 space-y-1.5",
                        readinessToneClass(selectedReadiness.kind)
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-xs font-semibold leading-snug">
                            {selectedReadiness.title}
                          </div>
                          <p className="text-[11px] leading-relaxed opacity-90">
                            {selectedReadiness.detail}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {selectedReadiness.kind === "checking" && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-6 px-2 text-[11px]",
                              readinessToneClass(selectedReadiness.kind)
                            )}
                          >
                            {selectedReadiness.badge}
                          </Badge>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 items-center justify-center rounded border border-current/20 hover:bg-black/5 dark:hover:bg-white/10"
                            title={t("actions.refreshCheck")}
                            aria-label={t("actions.refreshCheckAgent", {
                              name: selectedAgent.name,
                            })}
                            onClick={() => {
                              runPreflight(
                                selectedAgent.agent_type,
                                true
                              ).catch((err) => {
                                console.error(
                                  "[Settings] readiness recheck failed:",
                                  err
                                )
                              })
                              if (selectedAgent.agent_type === "open_claw") {
                                openClawDiscoveryAppliedRef.current = false
                                acpDiscoverOpenClawGateway()
                                  .then(setOpenClawDiscovery)
                                  .catch((err) => {
                                    console.warn(
                                      "[Settings] openclaw rediscovery failed:",
                                      err
                                    )
                                  })
                              }
                            }}
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {selectedReadiness.kind === "not_installed" && (
                        <p className="text-[11px] opacity-80">
                          {t("readiness.hint.installFirst")}
                        </p>
                      )}
                      {selectedReadiness.kind === "dependency_blocked" && (
                        <p className="text-[11px] opacity-80">
                          {t("readiness.hint.fixDependency")}
                        </p>
                      )}
                      {selectedReadiness.kind === "config_needed" && (
                        <p className="text-[11px] opacity-80">
                          {selectedAgent.agent_type === "open_claw" &&
                          selectedDraft.openClawAuthMode === "gateway"
                            ? t("readiness.hint.openClawStartGateway")
                            : t("readiness.hint.configureBelow")}
                        </p>
                      )}
                      {selectedReadiness.kind === "ready" && (
                        <p className="text-[11px] opacity-80">
                          {t("readiness.hint.readyToChat")}
                        </p>
                      )}
                      {selectedAgent.agent_type === "open_claw" &&
                        selectedDraft.openClawAuthMode === "gateway" &&
                        selectedReadiness.kind === "config_needed" && (
                          <div className="pt-1">
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 text-[11px]"
                              disabled={ensuringOpenClawGateway}
                              onClick={() => {
                                handleEnsureOpenClawGateway().catch(() => {})
                              }}
                            >
                              {ensuringOpenClawGateway ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {t("openClaw.ensureGatewayRunning")}
                                </>
                              ) : (
                                t("openClaw.ensureGateway")
                              )}
                            </Button>
                          </div>
                        )}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("preflight.count", { count: selectedChecks.length })}
                  </div>
                  {selectedChecks.length > 0 ? (
                    selectedChecks.map((check) =>
                      renderCheck(selectedAgent, check)
                    )
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {t("preflight.notRun")}
                    </div>
                  )}
                  {installStream.status !== "idle" &&
                    streamAgentType === selectedAgent.agent_type && (
                      <div className="mt-2 rounded-md border bg-muted/50 text-muted-foreground p-3 max-h-[200px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                        {installStream.logs.map((line, i) => (
                          <div
                            key={i}
                            className={
                              line.startsWith("ERROR:")
                                ? "text-destructive"
                                : ""
                            }
                          >
                            {line}
                          </div>
                        ))}
                        <div ref={installLogEndRef} />
                      </div>
                    )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium">{t("envVars")}</label>
                  <p className="text-[11px] text-muted-foreground">
                    {t("envVarsHint")}
                  </p>
                  <Textarea
                    value={selectedDraft.envText}
                    onChange={(event) => {
                      updateSelectedDraft((current) => ({
                        ...current,
                        envText: event.target.value,
                      }))
                    }}
                    placeholder={"KEY1=VALUE1\nKEY2=VALUE2"}
                    className="min-h-24 font-mono text-xs"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => {
                        persistEnv(
                          selectedAgent.agent_type,
                          selectedDraft.enabled,
                          selectedDraft.envText,
                          selectedDraft.modelProviderId
                        )
                          .then(() => {
                            toast.success(t("toasts.configSaved"), {
                              description: t("toasts.configSavedHint"),
                            })
                          })
                          .catch((err) => {
                            console.error("[Settings] save env failed:", err)
                            const message = toErrorMessage(err)
                            toast.error(t("toasts.saveEnvFailed"), {
                              description: message,
                            })
                          })
                      }}
                      disabled={selectedIsSavingEnv}
                    >
                      {selectedIsSavingEnv ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("actions.saving")}
                        </>
                      ) : (
                        <>
                          <Save className="h-3.5 w-3.5" />
                          {t("actions.saveEnvVars")}
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {selectedAgent.agent_type === "command_code" && (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">
                        {t("commandCode.loginStatusTitle")}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={refreshCommandCodeLogin}
                      >
                        <RefreshCw className="h-3 w-3" />
                        {t("commandCode.refresh")}
                      </Button>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs">
                      {commandCodeLogin?.running ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          <span className="text-muted-foreground">
                            {t("commandCode.loginInProgress")}
                          </span>
                        </>
                      ) : commandCodeLogin?.loggedIn ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          <span className="text-green-600">
                            {commandCodeLogin.accountName
                              ? t("commandCode.loggedInAs", {
                                  name: commandCodeLogin.accountName,
                                })
                              : t("commandCode.loginStatusLoggedIn")}
                          </span>
                          {commandCodeLogin.source === "env_key" && (
                            <span className="text-muted-foreground">
                              (API Key)
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                          <span className="text-amber-600 dark:text-amber-400">
                            {t("commandCode.loginStatusNotLoggedIn")}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-foreground">
                        {t("commandCode.loginMethod1Title")}
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        {t("commandCode.loginMethod1Hint")}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={
                            commandCodeLogin?.loggedIn ? "secondary" : "outline"
                          }
                          onClick={
                            commandCodeLogin?.running
                              ? cancelCommandCodeLogin
                              : commandCodeLogin?.loggedIn
                                ? handleLogoutCommandCode
                                : runCommandCodeLogin
                          }
                        >
                          {commandCodeLogin?.running ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {t("commandCode.loginCancel")}
                            </>
                          ) : commandCodeLogin?.loggedIn ? (
                            <>
                              <LogOut className="h-3.5 w-3.5" />
                              {t("commandCode.logoutButton")}
                            </>
                          ) : (
                            <>
                              <Wrench className="h-3.5 w-3.5" />
                              {t("commandCode.loginButton")}
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={async () => {
                            const ok = await copyTextToClipboard("cmdc login")
                            if (ok)
                              toast.success(t("commandCode.commandCopied"))
                          }}
                          title={t("commandCode.copyCommand")}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-foreground">
                        {t("commandCode.loginMethod2Title")}
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        {t("commandCode.loginMethod2Hint")}
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          type="password"
                          value={commandCodeApiKey}
                          onChange={(event) =>
                            setCommandCodeApiKey(event.target.value)
                          }
                          placeholder={t("commandCode.apiKeyPlaceholder")}
                          className="h-8 flex-1"
                        />
                        <Button
                          size="sm"
                          onClick={saveCommandCodeApiKey}
                          disabled={
                            commandCodeSavingKey || !commandCodeApiKey.trim()
                          }
                        >
                          {commandCodeSavingKey ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          {t("commandCode.saveApiKey")}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {selectedAgent && (
                  <AgentSettingsForm
                    key={selectedAgent.agent_type}
                    agent={selectedAgent}
                    modelProviders={modelProviders}
                    targetModelOptions={getTargetModelOptions(selectedAgent.agent_type)}
                    onModelProviderChange={async (providerId) => {
                      // 保存 model_provider_id 到后端
                      const envText = Object.entries(selectedAgent.env)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("\n")
                      try {
                        await persistEnv(selectedAgent.agent_type, selectedAgent.enabled, envText, providerId)
                      } catch (e) {
                        console.error("[AgentSettings] save model provider failed:", e)
                      }
                    }}
                    onFetchModels={() => setProviderModelsRefreshKey((n) => n + 1)}
                    fetchingModels={providerModelsLoading}
                    availableModels={providerModels}
                    onSave={async (values, authMode) => {
                      const env = { ...selectedAgent.env }
                      let modelProviderId: number | null = selectedAgent.model_provider_id

                      if (authMode === "apikey") {
                        // 手动 API Key 模式：更新 env 中的键值
                        const desc = getAgentDescriptor(selectedAgent.agent_type)
                        if (desc) {
                          const { apiKeyKey, baseUrlKey, modelKey } = desc.envMapping
                          if (values[apiKeyKey]) env[apiKeyKey] = values[apiKeyKey]
                          else delete env[apiKeyKey]
                          if (values[baseUrlKey]) env[baseUrlKey] = values[baseUrlKey]
                          else delete env[baseUrlKey]
                          if (values[modelKey]) env[modelKey] = values[modelKey]
                          else delete env[modelKey]
                        }
                        modelProviderId = null // 手动模式清除模型提供商绑定
                      } else if (authMode === "model_provider") {
                        const desc = getAgentDescriptor(selectedAgent.agent_type)
                        if (desc) {
                          const { modelKey } = desc.envMapping
                          const targetOpts = getTargetModelOptions(selectedAgent.agent_type)
                          if (targetOpts.length > 0 && values["model"]) {
                            // 有目标模型映射：保存映射后的模型名，同时保留原始提供商模型
                            env[modelKey] = values["model"]
                            if (values["provider_model"]) {
                              env["PROVIDER_MODEL"] = values["provider_model"]
                            }
                          } else if (values["provider_model"]) {
                            // 无目标模型映射：直接保存提供商模型
                            env[modelKey] = values["provider_model"]
                          }
                        }
                      }

                      const envText = Object.entries(env)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("\n")

                      try {
                        await persistEnv(
                          selectedAgent.agent_type,
                          selectedAgent.enabled,
                          envText,
                          modelProviderId
                        )
                      } catch (error) {
                        console.error("[AgentSettings] save failed:", error)
                      }
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              {t("emptyNoAgent")}
            </div>
          )}
        </div>
      </div>
      <AlertDialog
        open={Boolean(openCodeDeleteProviderId)}
        onOpenChange={(open) => {
          if (!open) setOpenCodeDeleteProviderId(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dialogs.confirmDeleteProvider", {
                providerId: openCodeDeleteProviderId ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialogs.confirmDeleteProviderDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={selectedIsSaving}>
              {t("actions.cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={confirmOpenCodeProviderDelete}
              disabled={selectedIsSaving}
            >
              {selectedIsSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("actions.deleting")}
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("actions.confirmDelete")}
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(uninstallConfirmAgent)}
        onOpenChange={(open) => {
          if (!open) setUninstallConfirmAgent(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dialogs.confirmUninstall", {
                name: uninstallConfirmAgent?.name ?? "Agent",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialogs.confirmUninstallDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={
                uninstallConfirmAgent
                  ? Boolean(busyBinaryAction[uninstallConfirmAgent.agent_type])
                  : false
              }
            >
              {t("actions.cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={confirmUninstall}
              disabled={
                uninstallConfirmAgent
                  ? Boolean(busyBinaryAction[uninstallConfirmAgent.agent_type])
                  : false
              }
            >
              {uninstallConfirmAgent &&
              busyBinaryAction[uninstallConfirmAgent.agent_type] ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("actions.uninstalling")}
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("actions.confirmUninstall")}
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(customInstallAgent)}
        onOpenChange={(open) => {
          if (!open) setCustomInstallAgent(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dialogs.customInstallTitle", {
                name: customInstallAgent?.name ?? "Agent",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialogs.customInstallDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <label
              htmlFor="custom-version-input"
              className="text-xs font-medium"
            >
              {t("dialogs.customInstallVersionLabel")}
            </label>
            <Input
              id="custom-version-input"
              autoFocus
              value={customVersionInput}
              placeholder={customInstallAgent?.registry_version ?? "1.0.0"}
              onChange={(e) => setCustomVersionInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  isValidCustomVersion(customVersionInput)
                ) {
                  e.preventDefault()
                  confirmCustomInstall()
                }
              }}
            />
            {customVersionInput.trim() !== "" &&
              !isValidCustomVersion(customVersionInput) && (
                <p className="text-[11px] text-red-500">
                  {t("dialogs.customInstallInvalid")}
                </p>
              )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
            <Button
              onClick={confirmCustomInstall}
              disabled={!isValidCustomVersion(customVersionInput)}
            >
              <PackagePlus className="h-3.5 w-3.5" />
              {t("dialogs.customInstallSubmit")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* ── Extracted modules ─────────────────────────────────────────────── */}
      <OpencodePluginsModal
        open={pluginModalOpen}
        onOpenChange={setPluginModalOpen}
        onCompleted={() => {
          if (pluginModalAgent) {
            runPreflight(pluginModalAgent)
          }
          setPluginModalAgent(null)
        }}
      />
    </div>
  )
}
