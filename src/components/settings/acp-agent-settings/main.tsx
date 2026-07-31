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
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Minus,
  PackagePlus,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Wrench,
} from "lucide-react"
import { isDesktop, openUrl } from "@/lib/platform"
import { getActiveRemoteConnectionId } from "@/lib/transport"
import { toast } from "sonner"
import { AgentIcon } from "@/components/agent-icon"
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  acpUpdateHermesConfig,
  acpRevealHermesHome,
  acpOpenHermesSetupTerminal,
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
  ModelProviderInfo,
  OpenClawGatewayDiscovery,
  OpenCodeCatalogProvider,
  ProviderModelItem,
} from "@/lib/types"
import { HERMES_PROVIDERS } from "@/lib/types"
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

import type {
  AgentCheckState,
  ClaudeAuthMode,
  ClaudeEffortLevel,
  ImportantConfigKey,
  RunningActionKind,
  UiFixAction,
  UiCheckItem,
  AcpTranslator,
  AgentDraft,
  GeminiAuthMode,
  CodexAuthMode,
  HermesAuthMode,
  OpenClawAuthMode,
  ClineAuthMode,
  OpenCodeAuthMode,
  PiAuthMode,
  CodeBuddyAuthMode,
} from "./types"
import {
  CLAUDE_AUTH_MODES,
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
  importantEnvKeysByAgent,
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
  parseHermesConfig,
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
            {check.status.toUpperCase()}
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
    // tracked inside KimiCodeConfigPanel, not in AgentDraft. When the parent
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
  const selectedHermesProviderOption =
    selectedAgent?.agent_type === "hermes" && selectedDraft
      ? (HERMES_PROVIDERS.find((p) => p.id === selectedDraft.hermesProvider) ??
        null)
      : null
  const hermesCanUseNativeSetup =
    isDesktop() && getActiveRemoteConnectionId() === null
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

  const handleClaudeAuthModeChange = useCallback(
    (nextMode: ClaudeAuthMode) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "claude_code"
      )
        return

      const keys = importantEnvKeysByAgent("claude_code")
      const allEnvKeys = [...keys.apiBaseUrl, ...keys.apiKey]

      if (nextMode === "official_subscription") {
        // Clear API URL/API Key from env and config
        const envPatch: Record<string, string> = {}
        for (const k of allEnvKeys) envPatch[k] = ""
        // Build clean display config (remove null keys)
        const parsed = parseConfigJsonText(selectedDraft.configText)
        const config: Record<string, unknown> = parsed.error
          ? {}
          : { ...parsed.config }
        delete config.apiBaseUrl
        delete config.apiKey
        if (config.env && typeof config.env === "object") {
          const cfgEnv = { ...(config.env as Record<string, unknown>) }
          for (const k of allEnvKeys) delete cfgEnv[k]
          if (Object.keys(cfgEnv).length > 0) {
            config.env = cfgEnv
          } else {
            delete config.env
          }
        }
        const nextConfigText =
          Object.keys(config).length > 0 ? JSON.stringify(config, null, 2) : ""
        setConfigErrors((prev) => ({
          ...prev,
          [selectedAgent.agent_type]: null,
        }))
        updateSelectedDraft((current) => ({
          ...current,
          claudeAuthMode: nextMode,
          modelProviderId: null,
          apiBaseUrl: "",
          apiKey: "",
          envText: patchEnvText(current.envText, envPatch),
          configText: nextConfigText,
        }))
        return
      }

      // "custom" or "model_provider" — keep existing values, just switch mode
      updateSelectedDraft((current) => ({
        ...current,
        claudeAuthMode: nextMode,
        modelProviderId:
          nextMode === "model_provider" ? current.modelProviderId : null,
      }))
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
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

  const handleHermesFieldChange = useCallback(
    (
      key:
        | "hermesProvider"
        | "apiKey"
        | "model"
        | "apiBaseUrl"
        | "hermesConfigYaml",
      value: string
    ) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "hermes"
      )
        return
      updateSelectedDraft((current) => {
        if (key !== "hermesProvider") {
          return { ...current, [key]: value }
        }
        // Switching provider: the projection only carries the *configured*
        // provider's key, so restore it when returning to that provider and
        // clear otherwise — never carry one provider's secret into another's
        // env var. An empty key field then means "leave the stored key as-is".
        const projected = parseHermesConfig(
          typeof selectedAgent.config_json === "string"
            ? selectedAgent.config_json
            : ""
        )
        const sameAsConfigured = value === projected.provider
        return {
          ...current,
          hermesProvider: value,
          apiKey: sameAsConfigured ? projected.apiKey : "",
          apiBaseUrl: sameAsConfigured ? projected.baseUrl : "",
        }
      })
    },
    [selectedAgent, selectedDraft, updateSelectedDraft]
  )

  const handleHermesAuthModeChange = useCallback(
    (nextMode: HermesAuthMode) => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "hermes"
      )
        return
      updateSelectedDraft((current) => ({
        ...current,
        hermesAuthMode: nextMode,
        modelProviderId:
          nextMode === "model_provider" ? current.modelProviderId : null,
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

  const handleSaveHermesConfig = useCallback(
    async (mode: "structured" | "raw") => {
      if (
        !selectedAgent ||
        !selectedDraft ||
        selectedAgent.agent_type !== "hermes"
      )
        return
      const agentType = selectedAgent.agent_type
      const draft = selectedDraft
      const providerOption = HERMES_PROVIDERS.find(
        (p) => p.id === draft.hermesProvider
      )
      setSavingConfig((prev) => ({ ...prev, [agentType]: true }))
      try {
        await acpUpdateHermesConfig(
          mode === "raw"
            ? {
                provider: draft.hermesProvider,
                rawConfigYaml: draft.hermesConfigYaml,
              }
            : {
                provider: draft.hermesProvider,
                // Blank key, or a provider with no key field (OAuth / AWS) →
                // null → backend leaves the stored ~/.hermes/.env value
                // untouched (so switching providers can't wipe it).
                apiKey:
                  providerOption?.kind !== "apiKey" || !draft.apiKey.trim()
                    ? null
                    : draft.apiKey,
                model: draft.model,
                baseUrl: providerOption?.needsBaseUrl ? draft.apiBaseUrl : null,
              }
        )
        // When saving native config, also clear model_provider_id from the DB
        // so the UI doesn't revert to model_provider mode on refresh.
        if (draft.hermesAuthMode === "native") {
          await acpUpdateAgentEnv(agentType, {
            enabled: selectedAgent.enabled,
            env: parseEnvText(draft.envText),
            modelProviderId: null,
          })
        }
        await refreshAgents()
        // Drop the draft so it rebuilds from the freshly-persisted projection —
        // otherwise the *other* mode (structured fields vs. raw config.yaml)
        // keeps stale content and a later save could overwrite this one.
        setDrafts((prev) => {
          const next = { ...prev }
          delete next[agentType]
          return next
        })
        toast.success(t("toasts.hermesSaved"), {
          description: t("toasts.configSavedHint"),
        })
      } catch (err) {
        console.error("[Settings] save hermes config failed:", err)
        toast.error(t("toasts.saveHermesFailed"), {
          description: toErrorMessage(err),
        })
      } finally {
        setSavingConfig((prev) => ({ ...prev, [agentType]: false }))
      }
    },
    [selectedAgent, selectedDraft, refreshAgents, t]
  )

  // Hermes's interactive setup (`--setup` / `hermes model`) needs a real TTY +
  // browser, so launch it in an external OS terminal on local desktop (the
  // backend builds the exact command). Fall back to copying the displayed
  // command (web / remote, or if the launch fails).
  const runHermesSetupCommand = useCallback(
    async (kind: "setup" | "model", displayCommand: string) => {
      const native = isDesktop() && getActiveRemoteConnectionId() === null
      if (native) {
        try {
          await acpOpenHermesSetupTerminal(kind)
          return
        } catch (err) {
          console.error("[Settings] open hermes setup terminal failed:", err)
        }
      }
      if (displayCommand) {
        const ok = await copyTextToClipboard(displayCommand)
        if (ok) toast.success(t("hermes.commandCopied"))
      }
    },
    [t]
  )

  const handleRevealHermesHome = useCallback(async () => {
    try {
      await acpRevealHermesHome()
    } catch (err) {
      console.error("[Settings] reveal hermes home failed:", err)
      toast.error(toErrorMessage(err))
    }
  }, [])

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
                    : displaySummary.toUpperCase()
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
                  <div className="relative group">
                    <Textarea
                      value={selectedDraft.envText}
                      onChange={(event) => {
                        updateSelectedDraft((current) => ({
                          ...current,
                          envText: event.target.value,
                        }))
                      }}
                      placeholder={"KEY1=VALUE1\nKEY2=VALUE2"}
                      className="min-h-24"
                    />
                    <div className="pointer-events-none absolute inset-0 rounded-md bg-background/10 backdrop-blur-[3px] transition-opacity duration-200 group-focus-within:opacity-0" />
                  </div>
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

                {selectedAgent.agent_type === "codex" ? (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div>
                      <label className="text-xs font-medium">
                        {t("configManagement")}
                      </label>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("codex.configDescription")}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("codex.authMode")}
                      </label>
                      <Select
                        value={selectedDraft.codexAuthMode}
                        onValueChange={(value) => {
                          if (
                            CODEX_AUTH_MODES.includes(value as CodexAuthMode)
                          ) {
                            handleCodexAuthModeChange(value as CodexAuthMode)
                          }
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {CODEX_AUTH_MODES.map((mode) => (
                            <SelectItem key={mode} value={mode}>
                              {mode === "chatgpt_subscription"
                                ? t("authModeOfficialSubscription")
                                : mode === "model_provider"
                                  ? t("authModeModelProvider")
                                  : t("authModeCustomEndpoint")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedDraft.codexAuthMode === "chatgpt_subscription"
                          ? t("codex.chatgptSubscriptionHint")
                          : selectedDraft.codexAuthMode === "model_provider"
                            ? t("modelProviderHint")
                            : t("authModeCustomEndpointHint")}
                      </p>
                      {selectedDraft.codexAuthMode === "model_provider" && (
                        <div className="mt-1.5 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {t("codex.modelProviderResponsesWarning")}
                          </span>
                        </div>
                      )}
                    </div>

                    {selectedDraft.codexAuthMode === "chatgpt_subscription" && (
                      <div className="space-y-2">
                        {hasCodexChatgptTokens(
                          selectedDraft.codexAuthJsonText
                        ) &&
                          codexLoginStatus !== "polling" &&
                          codexLoginStatus !== "requesting" && (
                            <div className="flex items-center gap-1.5 text-xs text-green-600">
                              <CheckCircle2 className="h-3 w-3" />
                              {t("codex.loggedIn")}
                            </div>
                          )}
                        {codexLoginStatus === "idle" && (
                          <Button
                            onClick={handleCodexDeviceLogin}
                            size="sm"
                            variant="outline"
                          >
                            {hasCodexChatgptTokens(
                              selectedDraft.codexAuthJsonText
                            )
                              ? t("codex.loginRelogin")
                              : t("codex.loginButton")}
                          </Button>
                        )}
                        {codexLoginStatus === "requesting" && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t("codex.loginRequesting")}
                          </div>
                        )}
                        {codexLoginStatus === "polling" && codexDeviceCode && (
                          <div className="space-y-2 rounded-md border p-3">
                            <p className="text-xs">{t("codex.loginStep1")}</p>
                            <button
                              type="button"
                              className="text-xs text-primary underline cursor-pointer"
                              onClick={() =>
                                openUrl(codexDeviceCode.verificationUrl)
                              }
                            >
                              {codexDeviceCode.verificationUrl}
                            </button>
                            <p className="text-xs mt-1">
                              {t("codex.loginStep2")}
                            </p>
                            <div className="flex items-center gap-2">
                              <code className="rounded bg-muted px-2 py-1 text-sm font-mono font-bold tracking-widest">
                                {codexDeviceCode.userCode}
                              </code>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={async () => {
                                  const ok = await copyTextToClipboard(
                                    codexDeviceCode.userCode
                                  )
                                  if (ok) {
                                    toast.success(t("codex.loginCodeCopied"))
                                  }
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t("codex.loginPolling")}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelCodexDeviceLogin}
                            >
                              {t("codex.loginCancel")}
                            </Button>
                          </div>
                        )}
                        {codexLoginStatus === "success" && (
                          <div className="flex items-center gap-1.5 text-xs text-green-600">
                            <CheckCircle2 className="h-3 w-3" />
                            {t("codex.loginSuccess")}
                          </div>
                        )}
                        {codexLoginStatus === "error" && (
                          <div className="space-y-1.5">
                            <p className="text-xs text-destructive">
                              {t("codex.loginFailed", {
                                message: codexLoginError ?? "Unknown error",
                              })}
                            </p>
                            <Button
                              onClick={handleCodexDeviceLogin}
                              size="sm"
                              variant="outline"
                            >
                              {t("codex.loginRetry")}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedDraft.codexAuthMode === "model_provider" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("selectModelProvider")}
                        </label>
                        {selectedModelProviders.length > 0 ? (
                          <Select
                            value={
                              selectedDraft.modelProviderId != null
                                ? String(selectedDraft.modelProviderId)
                                : ""
                            }
                            onValueChange={handleModelProviderSelect}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={t("selectModelProvider")}
                              />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {selectedModelProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={String(provider.id)}
                                >
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {t("noModelProviderAvailable")}
                          </p>
                        )}
                      </div>
                    )}

                    {(selectedDraft.codexAuthMode === "api_key" ||
                      selectedDraft.codexAuthMode === "model_provider") && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          API URL
                        </label>
                        <Input
                          value={selectedDraft.apiBaseUrl}
                          readOnly={
                            selectedDraft.codexAuthMode === "model_provider"
                          }
                          onChange={(event) => {
                            handleCodexImportantConfigChange(
                              "apiBaseUrl",
                              event.target.value
                            )
                          }}
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                    )}

                    {(selectedDraft.codexAuthMode === "api_key" ||
                      selectedDraft.codexAuthMode === "model_provider") && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          API Key
                        </label>
                        <div className="flex items-center gap-2">
                          <Input
                            type={
                              showApiKeys[selectedAgent.agent_type]
                                ? "text"
                                : "password"
                            }
                            value={selectedDraft.apiKey}
                            readOnly={
                              selectedDraft.codexAuthMode === "model_provider"
                            }
                            onChange={(event) => {
                              handleCodexImportantConfigChange(
                                "apiKey",
                                event.target.value
                              )
                            }}
                            placeholder="sk-..."
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowApiKeys((prev) => ({
                                ...prev,
                                [selectedAgent.agent_type]:
                                  !prev[selectedAgent.agent_type],
                              }))
                            }}
                            title={
                              showApiKeys[selectedAgent.agent_type]
                                ? t("actions.hideApiKey")
                                : t("actions.showApiKey")
                            }
                          >
                            {showApiKeys[selectedAgent.agent_type] ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {selectedDraft.codexAuthMode === "model_provider" &&
                      renderProviderModelPicker({
                        value: selectedDraft.model,
                        placeholder: "gpt-5 / gpt-5-mini",
                      })}

                    {selectedDraft.codexAuthMode === "api_key" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("codex.modelName")}
                        </label>
                        <Input
                          value={selectedDraft.model}
                          onChange={(event) => {
                            handleCodexImportantConfigChange(
                              "model",
                              event.target.value
                            )
                          }}
                          placeholder="gpt-5 / gpt-5-mini"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        Reasoning Effort
                      </label>
                      <Select
                        value={selectedDraft.codexReasoningEffort}
                        onValueChange={(nextValue) => {
                          handleCodexImportantConfigChange(
                            "reasoningEffort",
                            nextValue
                          )
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={t("codex.selectReasoningEffort")}
                          />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {CODEX_REASONING_EFFORT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedCodexReasoningEffortOption?.description ??
                          "Greater reasoning depth for complex problems"}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <label className="text-[11px] text-muted-foreground">
                          {t("codex.enableWebsocket")}
                        </label>
                        <Switch
                          checked={selectedDraft.codexSupportsWebsockets}
                          onCheckedChange={handleCodexSupportsWebsocketsChange}
                          aria-label={t("codex.enableWebsocketAria")}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <label className="text-[11px] text-muted-foreground">
                          {t("codex.enableSkills")}
                        </label>
                        <Switch
                          checked={selectedDraft.codexSkills}
                          onCheckedChange={handleCodexSkillsChange}
                          aria-label={t("codex.enableSkillsAria")}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <label className="text-[11px] text-muted-foreground">
                          {t("codex.enableFast")}
                        </label>
                        <Switch
                          checked={selectedDraft.codexServiceTierFast}
                          onCheckedChange={handleCodexServiceTierFastChange}
                          aria-label={t("codex.enableFastAria")}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("codex.configTomlNative")}
                      </label>
                      <Textarea
                        value={selectedDraft.codexConfigTomlText}
                        onChange={(event) => {
                          handleCodexConfigTomlTextChange(event.target.value)
                        }}
                        placeholder={`disable_response_storage = true
model = "gpt-5"
model_reasoning_effort = "high"
model_provider = "veryagent"

[features]
responses_websockets_v2 = true

[model_providers.veryagent]
base_url = "https://api.openai.com/v1"
supports_websockets = true`}
                        className="min-h-40 max-h-80 font-mono text-xs"
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => {
                          if (selectedMissingModelProvider) {
                            toast.error(t("toasts.modelProviderRequired"))
                            return
                          }
                          const codexEnvText =
                            selectedDraft.codexAuthMode ===
                            "chatgpt_subscription"
                              ? patchEnvText(selectedDraft.envText, {
                                  OPENAI_API_KEY: "",
                                  OPENAI_BASE_URL: "",
                                })
                              : selectedDraft.envText
                          // Persist sequentially, never in parallel: persistEnv
                          // (acp_update_agent_env) rewrites ~/.codex/config.toml
                          // to sync the root `model`, while persistConfig writes
                          // the full config.toml including base_url. Running both
                          // at once races two read-modify-write cycles on the same
                          // file, letting the model sync clobber the just-written
                          // base_url (the API key in auth.json is unaffected, so
                          // the key saves but the URL silently does not).
                          // persistConfig runs last so its authoritative
                          // config.toml wins.
                          persistEnv(
                            selectedAgent.agent_type,
                            selectedDraft.enabled,
                            codexEnvText,
                            selectedDraft.modelProviderId
                          )
                            .then(() =>
                              persistConfig(
                                selectedAgent.agent_type,
                                selectedDraft.configText,
                                {
                                  codexAuthJsonText:
                                    selectedDraft.codexAuthJsonText,
                                  codexConfigTomlText:
                                    selectedDraft.codexConfigTomlText,
                                }
                              )
                            )
                            .then(() => {
                              toast.success(t("toasts.codexSaved"), {
                                description: t("toasts.configSavedHint"),
                              })
                            })
                            .catch((err) => {
                              console.error(
                                "[Settings] save codex native config failed:",
                                err
                              )
                              const message = toErrorMessage(err)
                              toast.error(t("toasts.saveCodexNativeFailed"), {
                                description: message,
                              })
                            })
                        }}
                        disabled={selectedIsSavingEnv || selectedIsSavingConfig}
                      >
                        {selectedIsSavingEnv || selectedIsSavingConfig ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t("actions.saving")}
                          </>
                        ) : (
                          <>
                            <Save className="h-3.5 w-3.5" />
                            {t("actions.saveCodexConfig")}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : selectedAgent.agent_type === "gemini" ? (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div>
                      <label className="text-xs font-medium">
                        {t("gemini.authConfig")}
                      </label>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("gemini.authConfigDescription")}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("gemini.authMode")}
                      </label>
                      <Select
                        value={selectedDraft.geminiAuthMode}
                        onValueChange={(value) => {
                          if (
                            GEMINI_AUTH_MODES.includes(value as GeminiAuthMode)
                          ) {
                            handleGeminiAuthModeChange(value as GeminiAuthMode)
                          }
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={t("gemini.selectAuthMode")}
                          />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {GEMINI_AUTH_MODES.map((mode) => (
                            <SelectItem key={mode} value={mode}>
                              {geminiAuthModeLabel(mode)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {geminiAuthModeHint(selectedDraft.geminiAuthMode)}
                      </p>
                    </div>

                    {selectedDraft.geminiAuthMode === "model_provider" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("selectModelProvider")}
                        </label>
                        {selectedModelProviders.length > 0 ? (
                          <Select
                            value={
                              selectedDraft.modelProviderId != null
                                ? String(selectedDraft.modelProviderId)
                                : ""
                            }
                            onValueChange={handleModelProviderSelect}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={t("selectModelProvider")}
                              />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {selectedModelProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={String(provider.id)}
                                >
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {t("noModelProviderAvailable")}
                          </p>
                        )}
                      </div>
                    )}

                    {selectedDraft.geminiAuthMode === "model_provider" ? (
                      renderProviderModelPicker({
                        value: selectedDraft.model,
                        placeholder: "gemini-3-pro-preview",
                      })
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          Model
                        </label>
                        <Input
                          value={selectedDraft.model}
                          onChange={(event) => {
                            handleGeminiFieldChange("model", event.target.value)
                          }}
                          placeholder="gemini-3-pro-preview"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          {t("modelHintDefault")}
                        </p>
                      </div>
                    )}

                    {(selectedDraft.geminiAuthMode === "custom" ||
                      selectedDraft.geminiAuthMode === "model_provider") && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          GOOGLE_GEMINI_BASE_URL
                        </label>
                        <Input
                          value={selectedDraft.apiBaseUrl}
                          readOnly={
                            selectedDraft.geminiAuthMode === "model_provider"
                          }
                          onChange={(event) => {
                            handleGeminiFieldChange(
                              "apiBaseUrl",
                              event.target.value
                            )
                          }}
                          placeholder="https://your-gemini-endpoint.example.com"
                        />
                      </div>
                    )}

                    {(selectedDraft.geminiAuthMode === "custom" ||
                      selectedDraft.geminiAuthMode === "gemini_api_key" ||
                      selectedDraft.geminiAuthMode === "model_provider" ||
                      selectedDraft.geminiAuthMode === "vertex_api_key") && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {selectedDraft.geminiAuthMode === "vertex_api_key"
                            ? "GOOGLE_API_KEY"
                            : "GEMINI_API_KEY"}
                        </label>
                        <div className="flex items-center gap-2">
                          <Input
                            type={
                              showApiKeys[selectedAgent.agent_type]
                                ? "text"
                                : "password"
                            }
                            value={
                              selectedDraft.geminiAuthMode === "vertex_api_key"
                                ? selectedDraft.googleApiKey
                                : selectedDraft.geminiApiKey
                            }
                            readOnly={
                              selectedDraft.geminiAuthMode === "model_provider"
                            }
                            onChange={(event) => {
                              if (
                                selectedDraft.geminiAuthMode ===
                                "vertex_api_key"
                              ) {
                                handleGeminiFieldChange(
                                  "googleApiKey",
                                  event.target.value
                                )
                                return
                              }
                              handleGeminiFieldChange(
                                "geminiApiKey",
                                event.target.value
                              )
                            }}
                            placeholder="AIza..."
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowApiKeys((prev) => ({
                                ...prev,
                                [selectedAgent.agent_type]:
                                  !prev[selectedAgent.agent_type],
                              }))
                            }}
                            title={
                              showApiKeys[selectedAgent.agent_type]
                                ? t("actions.hideKey")
                                : t("actions.showKey")
                            }
                          >
                            {showApiKeys[selectedAgent.agent_type] ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {(selectedDraft.geminiAuthMode === "vertex_adc" ||
                      selectedDraft.geminiAuthMode ===
                        "vertex_service_account" ||
                      selectedDraft.geminiAuthMode === "vertex_api_key") && (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            GOOGLE_CLOUD_PROJECT
                          </label>
                          <Input
                            value={selectedDraft.googleCloudProject}
                            onChange={(event) => {
                              handleGeminiFieldChange(
                                "googleCloudProject",
                                event.target.value
                              )
                            }}
                            placeholder="my-gcp-project-id"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            GOOGLE_CLOUD_LOCATION
                          </label>
                          <Input
                            value={selectedDraft.googleCloudLocation}
                            onChange={(event) => {
                              handleGeminiFieldChange(
                                "googleCloudLocation",
                                event.target.value
                              )
                            }}
                            placeholder="global / us-central1"
                          />
                        </div>
                      </div>
                    )}

                    {selectedDraft.geminiAuthMode ===
                      "vertex_service_account" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          GOOGLE_APPLICATION_CREDENTIALS
                        </label>
                        <Input
                          value={selectedDraft.googleApplicationCredentials}
                          onChange={(event) => {
                            handleGeminiFieldChange(
                              "googleApplicationCredentials",
                              event.target.value
                            )
                          }}
                          placeholder="/path/to/service-account.json"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          openUrl(
                            "https://geminicli.com/docs/get-started/authentication/"
                          ).catch((err) => {
                            console.error(
                              "[Settings] open gemini auth doc failed:",
                              err
                            )
                          })
                        }}
                      >
                        {t("gemini.viewAuthDoc")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (selectedMissingModelProvider) {
                            toast.error(t("toasts.modelProviderRequired"))
                            return
                          }
                          Promise.all([
                            persistEnv(
                              selectedAgent.agent_type,
                              selectedDraft.enabled,
                              selectedDraft.envText,
                              selectedDraft.modelProviderId
                            ),
                            persistConfig(
                              selectedAgent.agent_type,
                              selectedDraft.configText
                            ),
                          ])
                            .then(() => {
                              toast.success(t("toasts.geminiSaved"), {
                                description: t("toasts.configSavedHint"),
                              })
                            })
                            .catch((err) => {
                              console.error(
                                "[Settings] save gemini config failed:",
                                err
                              )
                              const message = toErrorMessage(err)
                              toast.error(t("toasts.saveGeminiFailed"), {
                                description: message,
                              })
                            })
                        }}
                        disabled={selectedIsSavingEnv || selectedIsSavingConfig}
                      >
                        {selectedIsSavingEnv || selectedIsSavingConfig ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t("actions.saving")}
                          </>
                        ) : (
                          <>
                            <Save className="h-3.5 w-3.5" />
                            {t("actions.saveGeminiConfig")}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : selectedAgent.agent_type === "open_code" ? (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div>
                      <label className="text-xs font-medium">
                        {t("openCode.configManagement")}
                      </label>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("openCode.configDescription")}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("openCode.authModeLabel")}
                      </label>
                      <Select
                        value={selectedDraft.openCodeAuthMode}
                        onValueChange={(value) =>
                          handleOpenCodeAuthModeChange(
                            value as OpenCodeAuthMode
                          )
                        }
                        disabled={selectedIsSavingConfig}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="native">
                            {t("openCode.authModeNative")}
                          </SelectItem>
                          <SelectItem value="model_provider">
                            {t("openCode.authModeModelProvider")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedDraft.openCodeAuthMode === "model_provider"
                          ? t("openCode.authModeModelProviderHint")
                          : t("openCode.authModeNativeHint")}
                      </p>
                    </div>

                    {selectedDraft.openCodeAuthMode === "model_provider" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("selectModelProvider")}
                        </label>
                        {selectedModelProviders.length > 0 ? (
                          <Select
                            value={
                              selectedDraft.modelProviderId != null
                                ? String(selectedDraft.modelProviderId)
                                : ""
                            }
                            onValueChange={handleModelProviderSelect}
                            disabled={selectedIsSavingConfig}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={t("selectModelProvider")}
                              />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {selectedModelProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={String(provider.id)}
                                >
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {t("noModelProviderAvailable")}
                          </p>
                        )}
                      </div>
                    )}

                    {selectedDraft.openCodeAuthMode === "model_provider" &&
                      renderProviderModelPicker({
                        value: selectedDraft.model,
                        placeholder: "glm-5.1 / gpt-5",
                      })}

                    {selectedDraft.openCodeAuthMode === "model_provider" && (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={() =>
                            persistEnv(
                              "open_code",
                              selectedAgent.enabled,
                              selectedDraft.envText,
                              selectedDraft.modelProviderId
                            )
                          }
                          disabled={
                            selectedIsSavingEnv || selectedMissingModelProvider
                          }
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
                    )}

                    {selectedDraft.openCodeAuthMode === "native" && (
                      <>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <label className="text-[11px] text-muted-foreground">
                              {t("openCode.mainModel")}
                            </label>
                            <OpenCodeModelCombobox
                              value={selectedOpenCodeConfig?.model ?? ""}
                              onValueChange={(v) =>
                                handleOpenCodeFieldChange("model", v)
                              }
                              groups={openCodeModelOptions}
                              placeholder="provider/model-id"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[11px] text-muted-foreground">
                              {t("openCode.smallModel")}
                            </label>
                            <OpenCodeModelCombobox
                              value={selectedOpenCodeConfig?.smallModel ?? ""}
                              onValueChange={(v) =>
                                handleOpenCodeFieldChange("small_model", v)
                              }
                              groups={openCodeModelOptions}
                              placeholder="provider/model-id"
                            />
                          </div>
                        </div>

                        <div className="space-y-2 rounded-md border bg-background/60 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[11px] font-medium">
                              {t("openCode.providerManagement")}
                            </label>
                            <div className="text-[11px] text-muted-foreground">
                              {t("openCode.providerCount", {
                                count:
                                  selectedOpenCodeConfig?.providerIds.length ??
                                  0,
                              })}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                setOpenCodeEditProviderId(null)
                                setOpenCodeConnectOpen(true)
                              }}
                            >
                              <Plug className="h-3.5 w-3.5" />
                              {t("openCode.connectProvider")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                void handleOpenCodeRefreshCatalog()
                              }}
                              disabled={openCodeCatalogLoading}
                              title={t("openCode.refreshCatalog")}
                            >
                              <RefreshCw
                                className={cn(
                                  "h-3.5 w-3.5",
                                  openCodeCatalogLoading && "animate-spin"
                                )}
                              />
                              {t("openCode.refreshCatalog")}
                            </Button>
                            {openCodeCatalogLoading &&
                              openCodeCatalog.length === 0 && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  {t("openCode.connect.loading")}
                                </span>
                              )}
                          </div>

                          {openCodeWellKnownConnected.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground">
                              {t("openCode.noConnectedProviders")}
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <label className="text-[11px] font-medium">
                                {t("openCode.connectedProviders")}
                              </label>
                              <div className="space-y-1.5">
                                {openCodeWellKnownConnected.map((provider) => (
                                  <div
                                    key={provider.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5"
                                  >
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                      <span className="truncate text-xs font-medium">
                                        {provider.name}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {provider.id}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className="text-[10px]"
                                      >
                                        {provider.authKind === "oauth"
                                          ? t("openCode.authKindOauth")
                                          : provider.authKind === "api"
                                            ? t("openCode.authKindApi")
                                            : t("openCode.authKindNone")}
                                      </Badge>
                                      {!provider.inCatalog && (
                                        <Badge
                                          variant="secondary"
                                          className="text-[10px]"
                                        >
                                          {t("openCode.customBadge")}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                      <Switch
                                        checked={provider.enabled}
                                        onCheckedChange={(checked) => {
                                          void handleOpenCodeToggleEnabled(
                                            provider.id,
                                            checked
                                          )
                                        }}
                                        aria-label={t(
                                          "openCode.providerEnabledState",
                                          { providerId: provider.id }
                                        )}
                                      />
                                      {provider.authKind !== "oauth" && (
                                        <Button
                                          type="button"
                                          size="xs"
                                          variant="ghost"
                                          onClick={() => {
                                            // Top list is well-known only → the
                                            // guided dialog edits the key/base URL.
                                            setOpenCodeEditProviderId(
                                              provider.id
                                            )
                                            setOpenCodeConnectOpen(true)
                                          }}
                                        >
                                          {t("openCode.editConfig")}
                                        </Button>
                                      )}
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        onClick={() => {
                                          void handleOpenCodeDisconnect(
                                            provider.id,
                                            provider.hasConfigBlock
                                          )
                                        }}
                                      >
                                        {t("openCode.disconnect")}
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <OpenCodeConnectDialog
                            open={openCodeConnectOpen}
                            onOpenChange={(o) => {
                              setOpenCodeConnectOpen(o)
                              if (!o) setOpenCodeEditProviderId(null)
                            }}
                            catalog={openCodeCatalog}
                            catalogLoading={openCodeCatalogLoading}
                            configText={selectedDraft.configText}
                            authJsonText={selectedDraft.openCodeAuthJsonText}
                            editProviderId={openCodeEditProviderId}
                            onConnect={applyOpenCodeConnect}
                          />

                          <OpenCodeCustomProviderDialog
                            open={openCodeCustomOpen}
                            onOpenChange={setOpenCodeCustomOpen}
                            existingProviderIds={
                              selectedOpenCodeConfig?.providerIds ?? []
                            }
                            catalogIds={openCodeCatalog.map((p) => p.id)}
                            configText={selectedDraft.configText}
                            authJsonText={selectedDraft.openCodeAuthJsonText}
                            onConnect={applyOpenCodeConnect}
                          />

                          <div className="space-y-1 border-t pt-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] font-medium text-muted-foreground">
                                {t("openCode.advancedProviderConfig")}
                              </div>
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                onClick={() => setOpenCodeCustomOpen(true)}
                                disabled={
                                  openCodeCatalogLoading ||
                                  !openCodeCatalogReady
                                }
                                title={
                                  openCodeCatalogLoading ||
                                  !openCodeCatalogReady
                                    ? t("openCode.connect.loading")
                                    : undefined
                                }
                              >
                                <Plus className="h-3.5 w-3.5" />
                                {t("openCode.addCustomProvider")}
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              {t("openCode.customProviderConfigHint")}
                            </p>
                          </div>

                          {openCodeCustomProviderIds.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground">
                              {t("openCode.emptyProvider")}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {openCodeCustomProviderIds.map((providerId) => {
                                if (!selectedOpenCodeConfig) return null
                                const provider =
                                  selectedOpenCodeConfig.providers[providerId]
                                if (!provider) return null
                                const expanded =
                                  openCodeProviderId === providerId
                                const isDisabled =
                                  selectedOpenCodeConfig.disabledProviders.includes(
                                    providerId
                                  ) ||
                                  (selectedOpenCodeConfig.enabledProviders
                                    .length > 0 &&
                                    !selectedOpenCodeConfig.enabledProviders.includes(
                                      providerId
                                    ))
                                return (
                                  <Collapsible
                                    key={providerId}
                                    open={expanded}
                                    onOpenChange={(open) => {
                                      setOpenCodeProviderId(
                                        open ? providerId : ""
                                      )
                                    }}
                                  >
                                    <div className="rounded-md border bg-muted/20">
                                      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                                        <button
                                          type="button"
                                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                          onClick={() => {
                                            setOpenCodeProviderId((current) =>
                                              current === providerId
                                                ? ""
                                                : providerId
                                            )
                                          }}
                                        >
                                          <ChevronDown
                                            className={cn(
                                              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                              expanded && "rotate-180"
                                            )}
                                          />
                                          <span className="truncate text-xs font-medium">
                                            {providerId}
                                          </span>
                                          <span className="text-[11px] text-muted-foreground">
                                            models: {provider.modelCount}
                                          </span>
                                        </button>
                                        <div className="flex items-center gap-3">
                                          <span className="text-[11px] text-muted-foreground">
                                            {isDisabled
                                              ? t("status.disabled")
                                              : t("status.enabled")}
                                          </span>
                                          <Switch
                                            checked={!isDisabled}
                                            onCheckedChange={(checked) => {
                                              handleOpenCodeProviderStatusChange(
                                                providerId,
                                                checked
                                              )
                                            }}
                                            aria-label={t(
                                              "openCode.providerEnabledState",
                                              { providerId }
                                            )}
                                            title={
                                              isDisabled
                                                ? t("actions.clickEnable", {
                                                    name: providerId,
                                                  })
                                                : t("actions.clickDisable", {
                                                    name: providerId,
                                                  })
                                            }
                                          />
                                          <Button
                                            type="button"
                                            size="xs"
                                            variant="outline"
                                            onClick={() => {
                                              setOpenCodeDeleteProviderId(
                                                providerId
                                              )
                                            }}
                                          >
                                            {t("actions.delete")}
                                          </Button>
                                        </div>
                                      </div>

                                      <CollapsibleContent className="px-2.5 pb-2.5">
                                        <div className="grid gap-3 border-t pt-2.5 md:grid-cols-2">
                                          <div className="space-y-1.5">
                                            <label className="text-[11px] text-muted-foreground">
                                              provider.name
                                            </label>
                                            <Input
                                              value={provider.name}
                                              onChange={(event) => {
                                                handleOpenCodeProviderFieldChange(
                                                  providerId,
                                                  "name",
                                                  event.target.value
                                                )
                                              }}
                                              placeholder="My Provider"
                                            />
                                          </div>
                                          <div className="space-y-1.5">
                                            <label className="text-[11px] text-muted-foreground">
                                              provider.npm
                                            </label>
                                            <Select
                                              value={
                                                provider.npm.trim()
                                                  ? provider.npm
                                                  : OPENCODE_PROVIDER_NPM_OPTIONS[0]
                                                      .value
                                              }
                                              onValueChange={(value) => {
                                                handleOpenCodeProviderFieldChange(
                                                  providerId,
                                                  "npm",
                                                  value
                                                )
                                              }}
                                            >
                                              <SelectTrigger className="w-full">
                                                <SelectValue
                                                  placeholder={t(
                                                    "openCode.selectProviderNpm"
                                                  )}
                                                />
                                              </SelectTrigger>
                                              <SelectContent align="start">
                                                {buildOpenCodeNpmOptions(
                                                  provider.npm
                                                ).map((npmOption) => (
                                                  <SelectItem
                                                    key={npmOption}
                                                    value={npmOption}
                                                  >
                                                    {npmOption}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div className="space-y-1.5">
                                            <label className="text-[11px] text-muted-foreground">
                                              provider.api
                                            </label>
                                            <Input
                                              value={provider.api}
                                              onChange={(event) => {
                                                handleOpenCodeProviderFieldChange(
                                                  providerId,
                                                  "api",
                                                  event.target.value
                                                )
                                              }}
                                              placeholder="openai.responses"
                                            />
                                          </div>
                                          <div className="space-y-1.5">
                                            <label className="text-[11px] text-muted-foreground">
                                              provider.options.baseURL
                                            </label>
                                            <Input
                                              value={provider.baseUrl}
                                              onChange={(event) => {
                                                handleOpenCodeProviderFieldChange(
                                                  providerId,
                                                  "baseURL",
                                                  event.target.value
                                                )
                                              }}
                                              placeholder="https://api.example.com/v1"
                                            />
                                          </div>
                                          <div className="space-y-1.5 md:col-span-2">
                                            <label className="text-[11px] text-muted-foreground">
                                              provider.options.apiKey
                                            </label>
                                            <div className="flex items-center gap-2">
                                              <Input
                                                type={
                                                  showApiKeys[
                                                    selectedAgent.agent_type
                                                  ]
                                                    ? "text"
                                                    : "password"
                                                }
                                                value={provider.apiKey}
                                                onChange={(event) => {
                                                  handleOpenCodeProviderFieldChange(
                                                    providerId,
                                                    "apiKey",
                                                    event.target.value
                                                  )
                                                }}
                                                placeholder="sk-..."
                                              />
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  setShowApiKeys((prev) => ({
                                                    ...prev,
                                                    [selectedAgent.agent_type]:
                                                      !prev[
                                                        selectedAgent.agent_type
                                                      ],
                                                  }))
                                                }}
                                                title={
                                                  showApiKeys[
                                                    selectedAgent.agent_type
                                                  ]
                                                    ? t("actions.hideKey")
                                                    : t("actions.showKey")
                                                }
                                              >
                                                {showApiKeys[
                                                  selectedAgent.agent_type
                                                ] ? (
                                                  <EyeOff className="h-3.5 w-3.5" />
                                                ) : (
                                                  <Eye className="h-3.5 w-3.5" />
                                                )}
                                              </Button>
                                            </div>
                                          </div>
                                        </div>
                                        <Collapsible
                                          open={Boolean(
                                            openCodeModelConfigExpanded[
                                              providerId
                                            ]
                                          )}
                                          onOpenChange={(open) => {
                                            setOpenCodeModelConfigExpanded(
                                              (prev) => ({
                                                ...prev,
                                                [providerId]: open,
                                              })
                                            )
                                          }}
                                        >
                                          <div className="mt-3 rounded-md border bg-background/50 p-2.5">
                                            <button
                                              type="button"
                                              className="flex w-full items-center justify-between gap-2 text-left"
                                              onClick={() => {
                                                setOpenCodeModelConfigExpanded(
                                                  (prev) => ({
                                                    ...prev,
                                                    [providerId]:
                                                      !prev[providerId],
                                                  })
                                                )
                                              }}
                                            >
                                              <div className="flex items-center gap-2">
                                                <ChevronDown
                                                  className={cn(
                                                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                                    openCodeModelConfigExpanded[
                                                      providerId
                                                    ] && "rotate-180"
                                                  )}
                                                />
                                                <span className="text-[11px] font-medium">
                                                  {t(
                                                    "openCode.modelManagement"
                                                  )}
                                                </span>
                                              </div>
                                              <span className="text-[11px] text-muted-foreground">
                                                {t("openCode.modelCount", {
                                                  count: provider.modelCount,
                                                })}
                                              </span>
                                            </button>
                                            <CollapsibleContent className="pt-2">
                                              <p className="text-[11px] text-muted-foreground">
                                                {t("openCode.modelDescription")}
                                              </p>

                                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <Input
                                                  value={
                                                    openCodeNewModelIds[
                                                      providerId
                                                    ] ?? ""
                                                  }
                                                  onChange={(event) => {
                                                    handleOpenCodeModelDraftChange(
                                                      providerId,
                                                      event.target.value
                                                    )
                                                  }}
                                                  className="w-[240px]"
                                                  placeholder="new-model-id"
                                                />
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={() => {
                                                    handleOpenCodeAddModel(
                                                      providerId
                                                    )
                                                  }}
                                                >
                                                  {t("openCode.addModel")}
                                                </Button>
                                              </div>

                                              {provider.modelIds.length ===
                                              0 ? (
                                                <div className="mt-2 text-[11px] text-muted-foreground">
                                                  {t("openCode.emptyModel")}
                                                </div>
                                              ) : (
                                                <div className="mt-2 space-y-1">
                                                  <div className="flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
                                                    <div className="min-w-0 flex-1">
                                                      {t("openCode.modelId")}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                      {t("openCode.modelName")}
                                                    </div>
                                                    <div className="size-8 shrink-0" />
                                                  </div>
                                                  {provider.modelIds.map(
                                                    (modelId) => {
                                                      const model =
                                                        provider.models[modelId]
                                                      if (!model) return null
                                                      const modelDraftKey = `${providerId}:${modelId}`
                                                      return (
                                                        <div
                                                          key={`${providerId}:${modelId}`}
                                                          className="flex items-center gap-2"
                                                        >
                                                          <Input
                                                            value={
                                                              openCodeModelIdDrafts[
                                                                modelDraftKey
                                                              ] ?? model.id
                                                            }
                                                            onChange={(
                                                              event
                                                            ) => {
                                                              handleOpenCodeModelIdDraftChange(
                                                                providerId,
                                                                modelId,
                                                                event.target
                                                                  .value
                                                              )
                                                            }}
                                                            onBlur={() => {
                                                              handleOpenCodeModelIdCommit(
                                                                providerId,
                                                                modelId
                                                              )
                                                            }}
                                                            onKeyDown={(
                                                              event
                                                            ) => {
                                                              if (
                                                                event.key ===
                                                                "Enter"
                                                              ) {
                                                                event.preventDefault()
                                                                handleOpenCodeModelIdCommit(
                                                                  providerId,
                                                                  modelId
                                                                )
                                                                event.currentTarget.blur()
                                                                return
                                                              }
                                                              if (
                                                                event.key ===
                                                                "Escape"
                                                              ) {
                                                                setOpenCodeModelIdDrafts(
                                                                  (prev) => {
                                                                    if (
                                                                      typeof prev[
                                                                        modelDraftKey
                                                                      ] ===
                                                                      "undefined"
                                                                    ) {
                                                                      return prev
                                                                    }
                                                                    const next =
                                                                      {
                                                                        ...prev,
                                                                      }
                                                                    delete next[
                                                                      modelDraftKey
                                                                    ]
                                                                    return next
                                                                  }
                                                                )
                                                                event.currentTarget.blur()
                                                              }
                                                            }}
                                                            className="h-8 min-w-0 flex-1"
                                                            placeholder="model.id"
                                                          />
                                                          <Input
                                                            value={model.name}
                                                            onChange={(
                                                              event
                                                            ) => {
                                                              handleOpenCodeModelFieldChange(
                                                                providerId,
                                                                modelId,
                                                                event.target
                                                                  .value
                                                              )
                                                            }}
                                                            className="h-8 min-w-0 flex-1"
                                                            placeholder="model.name"
                                                          />
                                                          <Button
                                                            type="button"
                                                            size="icon-sm"
                                                            variant="ghost"
                                                            className="shrink-0 text-muted-foreground hover:text-destructive"
                                                            aria-label={t(
                                                              "openCode.deleteModel",
                                                              { modelId }
                                                            )}
                                                            title={t(
                                                              "openCode.deleteModel",
                                                              { modelId }
                                                            )}
                                                            onClick={() => {
                                                              handleOpenCodeRemoveModel(
                                                                providerId,
                                                                modelId
                                                              )
                                                            }}
                                                          >
                                                            <Minus className="h-3.5 w-3.5" />
                                                          </Button>
                                                        </div>
                                                      )
                                                    }
                                                  )}
                                                </div>
                                              )}
                                            </CollapsibleContent>
                                          </div>
                                        </Collapsible>
                                        <div className="mt-3 flex justify-end">
                                          <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => {
                                              persistConfig(
                                                selectedAgent.agent_type,
                                                selectedDraft.configText,
                                                {
                                                  openCodeAuthJsonText:
                                                    selectedDraft.openCodeAuthJsonText,
                                                }
                                              )
                                                .then(() => {
                                                  toast.success(
                                                    t("toasts.providerSaved", {
                                                      providerId,
                                                    }),
                                                    {
                                                      description: `${t("toasts.openCodeConfigSynced")} ${t("toasts.configSavedHint")}`,
                                                    }
                                                  )
                                                })
                                                .catch((err) => {
                                                  console.error(
                                                    "[Settings] save opencode provider failed:",
                                                    err
                                                  )
                                                  const message =
                                                    err instanceof Error
                                                      ? err.message
                                                      : String(err)
                                                  toast.error(
                                                    t(
                                                      "toasts.saveProviderFailed",
                                                      {
                                                        providerId,
                                                      }
                                                    ),
                                                    {
                                                      description: message,
                                                    }
                                                  )
                                                })
                                            }}
                                            disabled={selectedIsSavingConfig}
                                          >
                                            {selectedIsSavingConfig ? (
                                              <>
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                {t("actions.saving")}
                                              </>
                                            ) : (
                                              <>
                                                <Save className="h-3.5 w-3.5" />
                                                {t(
                                                  "actions.saveCurrentProvider"
                                                )}
                                              </>
                                            )}
                                          </Button>
                                        </div>
                                      </CollapsibleContent>
                                    </div>
                                  </Collapsible>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            {t("openCode.nativeJsonConfig")}
                          </label>
                          <Textarea
                            value={selectedDraft.configText}
                            onChange={(event) => {
                              handleConfigTextChange(event.target.value)
                            }}
                            placeholder={`{
  "$schema": "https://opencode.ai/config.json",
  "model": "google/gemini-3-pro-preview",
  "provider": {
    "google": {
      "options": {
        "baseURL": "https://generativelanguage.googleapis.com/v1beta"
      }
    }
  }
}`}
                            className="min-h-44 max-h-96 overflow-y-auto font-mono text-xs"
                          />
                          {selectedConfigError && (
                            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-400">
                              {selectedConfigError}
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={() => {
                              persistConfig(
                                selectedAgent.agent_type,
                                selectedDraft.configText,
                                {
                                  openCodeAuthJsonText:
                                    selectedDraft.openCodeAuthJsonText,
                                }
                              )
                                .then(async () => {
                                  // Native multi-provider save clears the shared
                                  // model_provider binding so refresh stays in
                                  // native mode (same as Hermes/Cline).
                                  await persistEnv(
                                    "open_code",
                                    selectedAgent.enabled,
                                    selectedDraft.envText,
                                    null
                                  )
                                  toast.success(t("toasts.openCodeSaved"), {
                                    description: t("toasts.configSavedHint"),
                                  })
                                })
                                .catch((err) => {
                                  console.error(
                                    "[Settings] save opencode config failed:",
                                    err
                                  )
                                  const message = toErrorMessage(err)
                                  toast.error(t("toasts.saveOpenCodeFailed"), {
                                    description: message,
                                  })
                                })
                            }}
                            disabled={selectedIsSavingConfig}
                          >
                            {selectedIsSavingConfig ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t("actions.saving")}
                              </>
                            ) : (
                              <>
                                <Save className="h-3.5 w-3.5" />
                                {t("actions.saveOpenCodeConfig")}
                              </>
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : selectedAgent.agent_type === "cline" ? (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div>
                      <label className="text-xs font-medium">Cline</label>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("cline.configDescription")}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("cline.authModeLabel")}
                      </label>
                      <Select
                        value={selectedDraft.clineAuthMode}
                        onValueChange={(value) =>
                          handleClineAuthModeChange(value as ClineAuthMode)
                        }
                        disabled={selectedIsSavingConfig}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="native">
                            {t("cline.authModeNative")}
                          </SelectItem>
                          <SelectItem value="model_provider">
                            {t("cline.authModeModelProvider")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedDraft.clineAuthMode === "model_provider"
                          ? t("cline.authModeModelProviderHint")
                          : t("cline.authModeNativeHint")}
                      </p>
                    </div>

                    {selectedDraft.clineAuthMode === "model_provider" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("selectModelProvider")}
                        </label>
                        {selectedModelProviders.length > 0 ? (
                          <Select
                            value={
                              selectedDraft.modelProviderId != null
                                ? String(selectedDraft.modelProviderId)
                                : ""
                            }
                            onValueChange={handleModelProviderSelect}
                            disabled={selectedIsSavingConfig}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={t("selectModelProvider")}
                              />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {selectedModelProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={String(provider.id)}
                                >
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {t("noModelProviderAvailable")}
                          </p>
                        )}
                      </div>
                    )}

                    {selectedDraft.clineAuthMode === "model_provider" &&
                      renderProviderModelPicker({
                        value: selectedDraft.model || selectedDraft.clineModel,
                        placeholder: "gpt-5 / claude-sonnet-5",
                      })}

                    {selectedDraft.clineAuthMode === "model_provider" && (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            persistEnv(
                              "cline",
                              selectedDraft.enabled,
                              selectedDraft.envText,
                              selectedDraft.modelProviderId
                            )
                          }
                          disabled={
                            selectedIsSavingEnv || selectedMissingModelProvider
                          }
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
                    )}

                    {selectedDraft.clineAuthMode === "native" && (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            Provider
                          </label>
                          <Select
                            value={selectedDraft.clineProvider}
                            onValueChange={(value) => {
                              handleClineFieldChange("clineProvider", value)
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLINE_PROVIDERS.map((p) => (
                                <SelectItem key={p.value} value={p.value}>
                                  {p.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            API Key
                          </label>
                          <div className="flex items-center gap-2">
                            <Input
                              type={
                                showApiKeys[selectedAgent.agent_type]
                                  ? "text"
                                  : "password"
                              }
                              value={selectedDraft.clineApiKey}
                              onChange={(event) => {
                                handleClineFieldChange(
                                  "clineApiKey",
                                  event.target.value
                                )
                              }}
                              placeholder="sk-..."
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setShowApiKeys((prev) => ({
                                  ...prev,
                                  [selectedAgent.agent_type]:
                                    !prev[selectedAgent.agent_type],
                                }))
                              }}
                              title={
                                showApiKeys[selectedAgent.agent_type]
                                  ? t("actions.hideApiKey")
                                  : t("actions.showApiKey")
                              }
                            >
                              {showApiKeys[selectedAgent.agent_type] ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            Model
                          </label>
                          <Input
                            value={selectedDraft.clineModel}
                            onChange={(event) => {
                              handleClineFieldChange(
                                "clineModel",
                                event.target.value
                              )
                            }}
                            placeholder="claude-sonnet-5"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            API URL
                          </label>
                          <Input
                            value={selectedDraft.clineBaseUrl}
                            onChange={(event) => {
                              handleClineFieldChange(
                                "clineBaseUrl",
                                event.target.value
                              )
                            }}
                            placeholder="https://api.openai.com"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            {t("nativeJsonConfig")} (config)
                          </label>
                          <Textarea
                            value={selectedDraft.configText}
                            onChange={(event) => {
                              handleConfigTextChange(event.target.value)
                            }}
                            className="min-h-24 font-mono text-xs"
                            placeholder={`{
  "apiProvider": "anthropic",
  "apiKey": "sk-...",
  "model": "claude-sonnet-5"
}`}
                          />
                          {selectedConfigError && (
                            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-400">
                              {selectedConfigError}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              Promise.all([
                                persistConfig(
                                  selectedAgent.agent_type,
                                  selectedDraft.configText
                                ),
                                // When saving native config, clear model_provider_id
                                // from DB so the UI doesn't revert on refresh.
                                selectedDraft.clineAuthMode === "native"
                                  ? acpUpdateAgentEnv("cline", {
                                      enabled: selectedAgent.enabled,
                                      env: parseEnvText(selectedDraft.envText),
                                      modelProviderId: null,
                                    })
                                  : Promise.resolve(),
                              ])
                                .then(() => {
                                  toast.success(t("toasts.clineSaved"), {
                                    description: t("toasts.configSavedHint"),
                                  })
                                })
                                .catch((err) => {
                                  console.error(
                                    "[Settings] save cline config failed:",
                                    err
                                  )
                                  const message = toErrorMessage(err)
                                  toast.error(t("toasts.saveClineFailed"), {
                                    description: message,
                                  })
                                })
                            }}
                            disabled={selectedIsSavingConfig}
                          >
                            {selectedIsSavingConfig ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t("actions.saving")}
                              </>
                            ) : (
                              <>
                                <Save className="h-3.5 w-3.5" />
                                {t("actions.saveClineConfig")}
                              </>
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : selectedAgent.agent_type === "open_claw" ? (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div>
                      <label className="text-xs font-medium">
                        {t("openClaw.gatewayConfig")}
                      </label>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("openClaw.gatewayDescription")}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("openClaw.authModeLabel")}
                      </label>
                      <Select
                        value={selectedDraft.openClawAuthMode}
                        onValueChange={(value) => {
                          const next = value as OpenClawAuthMode
                          updateSelectedDraft((current) => ({
                            ...current,
                            openClawAuthMode: next,
                            modelProviderId:
                              next === "model_provider"
                                ? current.modelProviderId
                                : null,
                          }))
                        }}
                        disabled={selectedIsSavingEnv || selectedIsSavingConfig}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="gateway">
                            {t("openClaw.authModeGateway")}
                          </SelectItem>
                          <SelectItem value="model_provider">
                            {t("openClaw.authModeModelProvider")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedDraft.openClawAuthMode === "model_provider"
                          ? t("openClaw.authModeModelProviderHint")
                          : t("openClaw.authModeGatewayHint")}
                      </p>
                    </div>

                    {selectedDraft.openClawAuthMode === "model_provider" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("selectModelProvider")}
                        </label>
                        {selectedModelProviders.length > 0 ? (
                          <Select
                            value={
                              selectedDraft.modelProviderId != null
                                ? String(selectedDraft.modelProviderId)
                                : ""
                            }
                            onValueChange={handleModelProviderSelect}
                            disabled={
                              selectedIsSavingEnv || selectedIsSavingConfig
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={t("selectModelProvider")}
                              />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {selectedModelProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={String(provider.id)}
                                >
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {t("noModelProviderAvailable")}
                          </p>
                        )}
                      </div>
                    )}

                    {selectedDraft.openClawAuthMode === "model_provider" &&
                      renderProviderModelPicker({
                        value: selectedDraft.model,
                        placeholder: "gpt-5 / claude-sonnet-5",
                      })}

                    {selectedDraft.openClawAuthMode === "model_provider" && (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            persistEnv(
                              "open_claw",
                              selectedDraft.enabled,
                              selectedDraft.envText,
                              selectedDraft.modelProviderId
                            )
                          }
                          disabled={
                            selectedIsSavingEnv || selectedMissingModelProvider
                          }
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
                    )}

                    {selectedDraft.openClawAuthMode === "gateway" && (
                      <>
                        {openClawDiscovery && (
                          <div className="space-y-1">
                            <p className="text-[11px] text-muted-foreground">
                              {openClawDiscovery.gatewayUrl
                                ? openClawDiscovery.gatewayReachable
                                  ? t("openClaw.discoveryReachable", {
                                      url: openClawDiscovery.gatewayUrl,
                                    })
                                  : t("openClaw.discoveryUnreachable", {
                                      url: openClawDiscovery.gatewayUrl,
                                    })
                                : openClawDiscovery.configExists
                                  ? t("openClaw.discoveryConfigNoGateway", {
                                      path: openClawDiscovery.configPath,
                                    })
                                  : t("openClaw.discoveryNotFound", {
                                      path: openClawDiscovery.configPath,
                                    })}
                            </p>
                            {openClawDiscovery.gatewayUrl &&
                              openClawDiscovery.gatewayUrlSource && (
                                <p className="text-[11px] text-muted-foreground">
                                  {t("openClaw.discoveryFound", {
                                    source:
                                      openClawDiscovery.gatewayUrlSource ??
                                      "config",
                                    path: openClawDiscovery.configPath,
                                  })}
                                </p>
                              )}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={
                              openClawDiscovery?.gatewayReachable
                                ? "outline"
                                : "default"
                            }
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
                          <p className="text-[11px] text-muted-foreground">
                            {t("readiness.hint.openClawStartGateway")}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            Gateway URL
                          </label>
                          <Input
                            value={selectedDraft.openClawGatewayUrl}
                            onChange={(event) => {
                              handleOpenClawFieldChange(
                                "openClawGatewayUrl",
                                event.target.value
                              )
                            }}
                            placeholder={
                              openClawDiscovery?.gatewayUrl ??
                              t("openClaw.gatewayUrlPlaceholder")
                            }
                          />
                          <p className="text-[11px] text-muted-foreground">
                            {t("openClaw.gatewayUrlHint")}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            Gateway Token
                          </label>
                          <div className="flex items-center gap-2">
                            <Input
                              type={
                                showApiKeys[selectedAgent.agent_type]
                                  ? "text"
                                  : "password"
                              }
                              value={selectedDraft.openClawGatewayToken}
                              onChange={(event) => {
                                handleOpenClawFieldChange(
                                  "openClawGatewayToken",
                                  event.target.value
                                )
                              }}
                              placeholder={t(
                                "openClaw.gatewayTokenPlaceholder"
                              )}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setShowApiKeys((prev) => ({
                                  ...prev,
                                  [selectedAgent.agent_type]:
                                    !prev[selectedAgent.agent_type],
                                }))
                              }}
                              title={
                                showApiKeys[selectedAgent.agent_type]
                                  ? t("actions.hideToken")
                                  : t("actions.showToken")
                              }
                            >
                              {showApiKeys[selectedAgent.agent_type] ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {t("openClaw.gatewayTokenHint")}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            Session Key
                          </label>
                          <Input
                            value={selectedDraft.openClawSessionKey}
                            onChange={(event) => {
                              handleOpenClawFieldChange(
                                "openClawSessionKey",
                                event.target.value
                              )
                            }}
                            placeholder="agent:main:main"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            {t("openClaw.sessionKeyHint")}
                          </p>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              Promise.all([
                                persistEnv(
                                  selectedAgent.agent_type,
                                  selectedDraft.enabled,
                                  selectedDraft.envText,
                                  selectedDraft.modelProviderId
                                ),
                                persistConfig(
                                  selectedAgent.agent_type,
                                  selectedDraft.configText
                                ),
                              ])
                                .then(() => {
                                  toast.success(t("toasts.openClawSaved"), {
                                    description: t("toasts.configSavedHint"),
                                  })
                                })
                                .catch((err) => {
                                  console.error(
                                    "[Settings] save openclaw config failed:",
                                    err
                                  )
                                  const message = toErrorMessage(err)
                                  toast.error(t("toasts.saveOpenClawFailed"), {
                                    description: message,
                                  })
                                })
                            }}
                            disabled={
                              selectedIsSavingEnv || selectedIsSavingConfig
                            }
                          >
                            {selectedIsSavingEnv || selectedIsSavingConfig ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t("actions.saving")}
                              </>
                            ) : (
                              <>
                                <Save className="h-3.5 w-3.5" />
                                {t("actions.saveOpenClawConfig")}
                              </>
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : selectedAgent.agent_type === "hermes" ? (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div>
                      <label className="text-xs font-medium">
                        {t("hermes.configManagement")}
                      </label>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("hermes.configDescription")}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("hermes.authModeLabel")}
                      </label>
                      <Select
                        value={selectedDraft.hermesAuthMode}
                        onValueChange={(value) =>
                          handleHermesAuthModeChange(value as HermesAuthMode)
                        }
                        disabled={selectedIsSavingConfig}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="native">
                            {t("hermes.authModeNative")}
                          </SelectItem>
                          <SelectItem value="model_provider">
                            {t("hermes.authModeModelProvider")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedDraft.hermesAuthMode === "model_provider"
                          ? t("hermes.authModeModelProviderHint")
                          : t("hermes.authModeNativeHint")}
                      </p>
                    </div>

                    {selectedDraft.hermesAuthMode === "model_provider" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("selectModelProvider")}
                        </label>
                        {selectedModelProviders.length > 0 ? (
                          <Select
                            value={
                              selectedDraft.modelProviderId != null
                                ? String(selectedDraft.modelProviderId)
                                : ""
                            }
                            onValueChange={handleModelProviderSelect}
                            disabled={selectedIsSavingConfig}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={t("selectModelProvider")}
                              />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {selectedModelProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={String(provider.id)}
                                >
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {t("noModelProviderAvailable")}
                          </p>
                        )}
                      </div>
                    )}

                    {selectedDraft.hermesAuthMode === "model_provider" &&
                      renderProviderModelPicker({
                        value: selectedDraft.model,
                        placeholder: "gpt-5 / claude-sonnet-5",
                      })}

                    {selectedDraft.hermesAuthMode === "model_provider" && (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={() =>
                            persistEnv(
                              "hermes",
                              selectedAgent.enabled,
                              selectedDraft.envText,
                              selectedDraft.modelProviderId
                            )
                          }
                          disabled={
                            selectedIsSavingEnv || selectedMissingModelProvider
                          }
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
                    )}

                    {selectedDraft.hermesAuthMode === "native" && (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            {t("hermes.providerLabel")}
                          </label>
                          <Select
                            value={selectedDraft.hermesProvider}
                            onValueChange={(value) =>
                              handleHermesFieldChange("hermesProvider", value)
                            }
                            disabled={selectedIsSavingConfig}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {/* Preserve an existing config's provider in the list
                              even when it's outside the curated table, so the
                              dropdown shows the real value instead of going blank. */}
                              {selectedDraft.hermesProvider &&
                                !HERMES_PROVIDERS.some(
                                  (p) => p.id === selectedDraft.hermesProvider
                                ) && (
                                  <SelectItem
                                    value={selectedDraft.hermesProvider}
                                  >
                                    {selectedDraft.hermesProvider}
                                  </SelectItem>
                                )}
                              {(
                                [
                                  ["apiKey", t("hermes.groupApiKey")],
                                  ["oauth", t("hermes.groupOauth")],
                                  ["aws", t("hermes.groupAws")],
                                ] as const
                              ).map(([kind, groupLabel]) => {
                                const items = HERMES_PROVIDERS.filter(
                                  (p) => p.kind === kind
                                )
                                if (items.length === 0) return null
                                return (
                                  <SelectGroup key={kind}>
                                    <SelectLabel>{groupLabel}</SelectLabel>
                                    {items.map((provider) => (
                                      <SelectItem
                                        key={provider.id}
                                        value={provider.id}
                                      >
                                        {provider.label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                )
                              })}
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-muted-foreground">
                            {t("hermes.providerHint")}
                          </p>
                        </div>

                        {selectedHermesProviderOption?.kind === "apiKey" && (
                          <div className="space-y-1.5">
                            <label className="text-[11px] text-muted-foreground">
                              API Key
                            </label>
                            <div className="flex items-center gap-2">
                              <Input
                                type={
                                  showApiKeys[selectedAgent.agent_type]
                                    ? "text"
                                    : "password"
                                }
                                value={selectedDraft.apiKey}
                                onChange={(event) =>
                                  handleHermesFieldChange(
                                    "apiKey",
                                    event.target.value
                                  )
                                }
                                placeholder="sk-..."
                                disabled={selectedIsSavingConfig}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setShowApiKeys((prev) => ({
                                    ...prev,
                                    [selectedAgent.agent_type]:
                                      !prev[selectedAgent.agent_type],
                                  }))
                                }}
                                title={
                                  showApiKeys[selectedAgent.agent_type]
                                    ? t("actions.hideApiKey")
                                    : t("actions.showApiKey")
                                }
                              >
                                {showApiKeys[selectedAgent.agent_type] ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {t("hermes.apiKeyHint")}
                            </p>
                          </div>
                        )}

                        {selectedHermesProviderOption?.needsBaseUrl && (
                          <div className="space-y-1.5">
                            <label className="text-[11px] text-muted-foreground">
                              API URL
                            </label>
                            <Input
                              value={selectedDraft.apiBaseUrl}
                              onChange={(event) =>
                                handleHermesFieldChange(
                                  "apiBaseUrl",
                                  event.target.value
                                )
                              }
                              placeholder="https://api.example.com/v1"
                              disabled={selectedIsSavingConfig}
                            />
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            {t("hermes.modelName")}
                          </label>
                          <Input
                            value={selectedDraft.model}
                            onChange={(event) =>
                              handleHermesFieldChange(
                                "model",
                                event.target.value
                              )
                            }
                            placeholder="moonshotai/kimi-k2"
                            disabled={selectedIsSavingConfig}
                          />
                        </div>

                        {selectedHermesProviderOption?.kind === "oauth" && (
                          <p className="text-[11px] text-muted-foreground">
                            {t("hermes.oauthHint")}
                          </p>
                        )}

                        {selectedHermesProviderOption?.kind === "aws" && (
                          <p className="text-[11px] text-muted-foreground">
                            {t("hermes.awsHint")}
                          </p>
                        )}

                        {!selectedHermesProviderOption && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-500">
                            {t("hermes.unsupportedProvider")}
                          </p>
                        )}

                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={() => handleSaveHermesConfig("structured")}
                            disabled={
                              selectedIsSavingConfig ||
                              !selectedHermesProviderOption
                            }
                          >
                            {selectedIsSavingConfig ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t("actions.saving")}
                              </>
                            ) : (
                              <>
                                <Save className="h-3.5 w-3.5" />
                                {t("actions.saveHermesConfig")}
                              </>
                            )}
                          </Button>
                        </div>

                        <div className="space-y-2 rounded-md border p-3">
                          <div>
                            <label className="text-[11px] font-medium">
                              {t("hermes.setupTitle")}
                            </label>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {t("hermes.setupHint")}
                            </p>
                          </div>
                          {hermesCanUseNativeSetup && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  runHermesSetupCommand(
                                    "setup",
                                    selectedDraft.hermesSetupCommand
                                  )
                                }
                              >
                                <Wrench className="h-3.5 w-3.5" />
                                {t("hermes.runSetup")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  runHermesSetupCommand(
                                    "model",
                                    selectedDraft.hermesModelCommand
                                  )
                                }
                              >
                                {t("hermes.configureModel")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRevealHermesHome}
                              >
                                {t("hermes.openConfigFolder")}
                              </Button>
                            </div>
                          )}
                          {selectedDraft.hermesSetupCommand && (
                            <div className="flex items-center gap-2">
                              <code className="flex-1 overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] font-mono whitespace-nowrap">
                                {selectedDraft.hermesSetupCommand}
                              </code>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 shrink-0 p-0"
                                onClick={async () => {
                                  const ok = await copyTextToClipboard(
                                    selectedDraft.hermesSetupCommand
                                  )
                                  if (ok) {
                                    toast.success(t("hermes.commandCopied"))
                                  }
                                }}
                                title={t("hermes.copyCommand")}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>

                        <details className="rounded-md border p-3">
                          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                            {t("hermes.advancedTitle")}
                          </summary>
                          <div className="mt-2 space-y-2">
                            <p className="text-[11px] text-muted-foreground">
                              {t("hermes.rawConfigHint")}
                            </p>
                            <Textarea
                              value={selectedDraft.hermesConfigYaml}
                              onChange={(event) =>
                                handleHermesFieldChange(
                                  "hermesConfigYaml",
                                  event.target.value
                                )
                              }
                              placeholder={`model:\n  provider: openrouter\n  default: moonshotai/kimi-k2`}
                              className="min-h-40 max-h-80 font-mono text-xs"
                              disabled={selectedIsSavingConfig}
                            />
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSaveHermesConfig("raw")}
                                disabled={selectedIsSavingConfig}
                              >
                                {selectedIsSavingConfig ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {t("actions.saving")}
                                  </>
                                ) : (
                                  <>
                                    <Save className="h-3.5 w-3.5" />
                                    {t("hermes.saveRawConfig")}
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </details>
                      </>
                    )}
                  </div>
                ) : selectedAgent.agent_type === "code_buddy" ? (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">
                        {t("codebuddy.authModeLabel")}
                      </label>
                      <Select
                        value={selectedDraft.codeBuddyAuthMode}
                        onValueChange={(value) =>
                          handleCodeBuddyAuthModeChange(
                            value as CodeBuddyAuthMode
                          )
                        }
                        disabled={selectedIsSavingConfig}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="native">
                            {t("codebuddy.authModeNative")}
                          </SelectItem>
                          <SelectItem value="model_provider">
                            {t("codebuddy.authModeModelProvider")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedDraft.codeBuddyAuthMode === "model_provider"
                          ? t("codebuddy.authModeModelProviderHint")
                          : t("codebuddy.authModeNativeHint")}
                      </p>
                    </div>

                    {selectedDraft.codeBuddyAuthMode === "model_provider" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("selectModelProvider")}
                        </label>
                        {selectedModelProviders.length > 0 ? (
                          <Select
                            value={
                              selectedDraft.modelProviderId != null
                                ? String(selectedDraft.modelProviderId)
                                : ""
                            }
                            onValueChange={handleModelProviderSelect}
                            disabled={selectedIsSavingConfig}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={t("selectModelProvider")}
                              />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {selectedModelProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={String(provider.id)}
                                >
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {t("noModelProviderAvailable")}
                          </p>
                        )}
                      </div>
                    )}

                    {selectedDraft.codeBuddyAuthMode === "model_provider" &&
                      renderProviderModelPicker({
                        value: selectedDraft.model,
                        placeholder: "glm-5.1 / gpt-5",
                      })}

                    {selectedDraft.codeBuddyAuthMode === "model_provider" && (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={() =>
                            persistEnv(
                              "code_buddy",
                              selectedAgent.enabled,
                              selectedDraft.envText,
                              selectedDraft.modelProviderId
                            )
                          }
                          disabled={
                            selectedIsSavingEnv || selectedMissingModelProvider
                          }
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
                    )}

                    {selectedDraft.codeBuddyAuthMode === "native" && (
                      <CodeBuddyConfigPanel
                        agent={selectedAgent}
                        saving={Boolean(savingEnv[selectedAgent.agent_type])}
                        onSave={(env, enabled) =>
                          persistEnv(
                            selectedAgent.agent_type,
                            enabled,
                            envMapToText(env),
                            // Native save clears shared model_provider binding.
                            null
                          )
                        }
                      />
                    )}
                  </div>
                ) : selectedAgent.agent_type === "kimi_code" ? (
                  <KimiCodeConfigPanel
                    agent={selectedAgent}
                    onSaved={refreshAgents}
                    modelProviders={modelProviders}
                    onSaveModelProvider={(env, enabled, modelProviderId) =>
                      persistEnv(
                        "kimi_code",
                        enabled,
                        envMapToText(
                          Object.fromEntries(
                            Object.entries(env).filter(
                              ([, v]) => v.trim() !== ""
                            )
                          )
                        ),
                        modelProviderId
                      )
                    }
                  />
                ) : selectedAgent.agent_type === "pi" ? (
                  <div className="space-y-3">
                    <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                      <div>
                        <label className="text-xs font-medium">
                          {t("pi.configManagement")}
                        </label>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t("pi.configDescription")}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">
                          {t("pi.authModeLabel")}
                        </label>
                        <Select
                          value={selectedDraft.piAuthMode}
                          onValueChange={(value) =>
                            handlePiAuthModeChange(value as PiAuthMode)
                          }
                          disabled={selectedIsSavingConfig}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="start">
                            <SelectItem value="model_provider">
                              {t("pi.authModeModelProvider")}
                            </SelectItem>
                            <SelectItem value="native">
                              {t("pi.authModeNative")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">
                          {selectedDraft.piAuthMode === "model_provider"
                            ? t("pi.authModeModelProviderHint")
                            : t("pi.authModeNativeHint")}
                        </p>
                      </div>

                      {selectedDraft.piAuthMode === "model_provider" && (
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            {t("selectModelProvider")}
                          </label>
                          {selectedModelProviders.length > 0 ? (
                            <Select
                              value={
                                selectedDraft.modelProviderId != null
                                  ? String(selectedDraft.modelProviderId)
                                  : ""
                              }
                              onValueChange={handleModelProviderSelect}
                              disabled={selectedIsSavingConfig}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue
                                  placeholder={t("selectModelProvider")}
                                />
                              </SelectTrigger>
                              <SelectContent align="start">
                                {selectedModelProviders.map((provider) => (
                                  <SelectItem
                                    key={provider.id}
                                    value={String(provider.id)}
                                  >
                                    {provider.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              {t("noModelProviderAvailable")}
                            </p>
                          )}
                        </div>
                      )}

                      {selectedDraft.piAuthMode === "model_provider" &&
                        renderProviderModelPicker({
                          value: selectedDraft.model,
                          placeholder: "glm-5.1 / gpt-5",
                        })}

                      {selectedDraft.piAuthMode === "model_provider" && (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={() =>
                              persistEnv(
                                "pi",
                                selectedAgent.enabled,
                                selectedDraft.envText,
                                selectedDraft.modelProviderId
                              )
                            }
                            disabled={
                              selectedIsSavingEnv ||
                              selectedMissingModelProvider
                            }
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
                      )}
                    </div>

                    {selectedDraft.piAuthMode === "native" && (
                      <PiConfigPanel
                        agent={selectedAgent}
                        saving={Boolean(savingEnv[selectedAgent.agent_type])}
                        onSaveEnv={(env, enabled) =>
                          persistEnv(
                            selectedAgent.agent_type,
                            enabled,
                            envMapToText(env),
                            // Native pi save clears shared model_provider
                            // binding so refresh stays in native mode.
                            null
                          )
                        }
                        onSaved={async () => {
                          // Credential save goes through acp_update_pi_config,
                          // not env; still clear model_provider_id so refresh
                          // doesn't snap back to model_provider mode.
                          await persistEnv(
                            "pi",
                            selectedAgent.enabled,
                            selectedDraft.envText,
                            null
                          )
                          await refreshAgents()
                        }}
                      />
                    )}
                  </div>
                ) : selectedAgent.agent_type === "mimo_code" ? (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div>
                      <label className="text-xs font-medium">
                        {t("configManagement")}
                      </label>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("modelProviderHint")}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("selectModelProvider")}
                      </label>
                      {selectedModelProviders.length > 0 ? (
                        <Select
                          value={
                            selectedDraft.modelProviderId != null
                              ? String(selectedDraft.modelProviderId)
                              : ""
                          }
                          onValueChange={handleModelProviderSelect}
                          disabled={selectedIsSavingConfig}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue
                              placeholder={t("selectModelProvider")}
                            />
                          </SelectTrigger>
                          <SelectContent align="start">
                            {selectedModelProviders.map((provider) => (
                              <SelectItem
                                key={provider.id}
                                value={String(provider.id)}
                              >
                                {provider.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          {t("noModelProviderAvailable")}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-md border bg-muted/10 p-3">
                    <div>
                      <label className="text-xs font-medium">
                        {t("configManagement")}
                      </label>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {selectedAgent.agent_type === "claude_code"
                          ? t("generalConfigDescriptionClaude")
                          : t("generalConfigDescriptionDefault")}
                      </p>
                    </div>

                    {selectedAgent.agent_type === "claude_code" && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          {t("claude.authMode")}
                        </label>
                        <Select
                          value={selectedDraft.claudeAuthMode}
                          onValueChange={(value) => {
                            if (
                              CLAUDE_AUTH_MODES.includes(
                                value as ClaudeAuthMode
                              )
                            ) {
                              handleClaudeAuthModeChange(
                                value as ClaudeAuthMode
                              )
                            }
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="start">
                            <SelectItem value="official_subscription">
                              {t("authModeOfficialSubscription")}
                            </SelectItem>
                            <SelectItem value="custom">
                              {t("authModeCustomEndpoint")}
                            </SelectItem>
                            <SelectItem value="model_provider">
                              {t("authModeModelProvider")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">
                          {selectedDraft.claudeAuthMode ===
                          "official_subscription"
                            ? t("claude.officialSubscriptionHint")
                            : selectedDraft.claudeAuthMode === "custom"
                              ? t("authModeCustomEndpointHint")
                              : t("modelProviderHint")}
                        </p>
                      </div>
                    )}

                    {selectedAgent.agent_type === "claude_code" &&
                      selectedDraft.claudeAuthMode === "model_provider" && (
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            {t("selectModelProvider")}
                          </label>
                          {selectedModelProviders.length > 0 ? (
                            <Select
                              value={
                                selectedDraft.modelProviderId != null
                                  ? String(selectedDraft.modelProviderId)
                                  : ""
                              }
                              onValueChange={handleModelProviderSelect}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue
                                  placeholder={t("selectModelProvider")}
                                />
                              </SelectTrigger>
                              <SelectContent align="start">
                                {selectedModelProviders.map((provider) => (
                                  <SelectItem
                                    key={provider.id}
                                    value={String(provider.id)}
                                  >
                                    {provider.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              {t("noModelProviderAvailable")}
                            </p>
                          )}
                        </div>
                      )}

                    {(selectedAgent.agent_type !== "claude_code" ||
                      selectedDraft.claudeAuthMode === "custom" ||
                      selectedDraft.claudeAuthMode === "model_provider") && (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            API URL
                          </label>
                          <Input
                            value={selectedDraft.apiBaseUrl}
                            readOnly={
                              selectedAgent.agent_type === "claude_code" &&
                              selectedDraft.claudeAuthMode === "model_provider"
                            }
                            onChange={(event) => {
                              handleImportantConfigChange(
                                "apiBaseUrl",
                                event.target.value
                              )
                            }}
                            placeholder="https://api.example.com"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            API Key
                          </label>
                          <div className="flex items-center gap-2">
                            <Input
                              type={
                                showApiKeys[selectedAgent.agent_type]
                                  ? "text"
                                  : "password"
                              }
                              value={selectedDraft.apiKey}
                              readOnly={
                                selectedAgent.agent_type === "claude_code" &&
                                selectedDraft.claudeAuthMode ===
                                  "model_provider"
                              }
                              onChange={(event) => {
                                handleImportantConfigChange(
                                  "apiKey",
                                  event.target.value
                                )
                              }}
                              placeholder="sk-..."
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setShowApiKeys((prev) => ({
                                  ...prev,
                                  [selectedAgent.agent_type]:
                                    !prev[selectedAgent.agent_type],
                                }))
                              }}
                              title={
                                showApiKeys[selectedAgent.agent_type]
                                  ? t("actions.hideApiKey")
                                  : t("actions.showApiKey")
                              }
                            >
                              {showApiKeys[selectedAgent.agent_type] ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </>
                    )}

                    {selectedAgent.agent_type === "claude_code" ? (
                      <div className="space-y-2">
                        {selectedDraft.claudeAuthMode === "model_provider" ? (
                          renderProviderModelPicker({
                            value: selectedDraft.claudeMainModel,
                            placeholder: "claude-sonnet-5",
                          })
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className="text-[11px] text-muted-foreground">
                                {t("claude.mainModel")}
                              </label>
                              <Input
                                value={selectedDraft.claudeMainModel}
                                onChange={(event) => {
                                  handleImportantConfigChange(
                                    "claudeMainModel",
                                    event.target.value
                                  )
                                }}
                                placeholder="claude-sonnet-5"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[11px] text-muted-foreground">
                                {t("claude.reasoningModel")}
                              </label>
                              <Input
                                value={selectedDraft.claudeReasoningModel}
                                onChange={(event) => {
                                  handleImportantConfigChange(
                                    "claudeReasoningModel",
                                    event.target.value
                                  )
                                }}
                                placeholder="claude-opus-4-8"
                              />
                            </div>
                          </div>
                        )}
                        {selectedDraft.claudeAuthMode !== "model_provider" && (
                          <p className="text-[11px] text-muted-foreground">
                            {t("modelHintDefault")}
                          </p>
                        )}
                        <details className="group border-t border-border/60 pt-3">
                          <summary className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors list-none">
                            <svg
                              className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
                              viewBox="0 0 12 12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M4 2l4 4-4 4" />
                            </svg>
                            {t("claude.advancedModelSettings")}
                          </summary>
                          <div className="mt-3 space-y-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-1.5">
                                <label className="text-[11px] text-muted-foreground">
                                  {t("claude.haikuDefaultModel")}
                                </label>
                                <Input
                                  value={selectedDraft.claudeDefaultHaikuModel}
                                  onChange={(event) => {
                                    handleImportantConfigChange(
                                      "claudeDefaultHaikuModel",
                                      event.target.value
                                    )
                                  }}
                                  placeholder="claude-haiku-4-5"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[11px] text-muted-foreground">
                                  {t("claude.sonnetDefaultModel")}
                                </label>
                                <Input
                                  value={selectedDraft.claudeDefaultSonnetModel}
                                  onChange={(event) => {
                                    handleImportantConfigChange(
                                      "claudeDefaultSonnetModel",
                                      event.target.value
                                    )
                                  }}
                                  placeholder="claude-sonnet-5"
                                />
                              </div>
                              <div className="space-y-1.5 md:col-span-2">
                                <label className="text-[11px] text-muted-foreground">
                                  {t("claude.opusDefaultModel")}
                                </label>
                                <Input
                                  value={selectedDraft.claudeDefaultOpusModel}
                                  onChange={(event) => {
                                    handleImportantConfigChange(
                                      "claudeDefaultOpusModel",
                                      event.target.value
                                    )
                                  }}
                                  placeholder="claude-opus-4-8"
                                />
                              </div>
                            </div>
                            <div className="border-t border-border/40 pt-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-1.5 md:col-span-2">
                                  <label className="text-[11px] text-muted-foreground">
                                    {t("claude.customModelOption")}
                                  </label>
                                  <Input
                                    value={
                                      selectedDraft.claudeCustomModelOption
                                    }
                                    onChange={(event) => {
                                      handleImportantConfigChange(
                                        "claudeCustomModelOption",
                                        event.target.value
                                      )
                                    }}
                                    placeholder="my-gateway/claude-opus-4-8"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[11px] text-muted-foreground">
                                    {t("claude.customModelOptionName")}
                                  </label>
                                  <Input
                                    value={
                                      selectedDraft.claudeCustomModelOptionName
                                    }
                                    onChange={(event) => {
                                      handleImportantConfigChange(
                                        "claudeCustomModelOptionName",
                                        event.target.value
                                      )
                                    }}
                                    placeholder="Gateway Opus"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[11px] text-muted-foreground">
                                    {t("claude.customModelOptionDescription")}
                                  </label>
                                  <Input
                                    value={
                                      selectedDraft.claudeCustomModelOptionDescription
                                    }
                                    onChange={(event) => {
                                      handleImportantConfigChange(
                                        "claudeCustomModelOptionDescription",
                                        event.target.value
                                      )
                                    }}
                                    placeholder="Routed via custom gateway"
                                  />
                                </div>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-2">
                                {t("claude.customModelOptionHint")}
                              </p>
                            </div>
                          </div>
                        </details>
                        <div className="space-y-1.5">
                          <label className="text-[11px] text-muted-foreground">
                            {t("claude.effortLevel")}
                          </label>
                          <Select
                            value={selectedDraft.claudeEffortLevel || "default"}
                            onValueChange={(nextValue) => {
                              handleClaudeEffortLevelChange(
                                nextValue === "default"
                                  ? ""
                                  : (nextValue as ClaudeEffortLevel)
                              )
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue
                                placeholder={t("claude.effortLevelDefault")}
                              />
                            </SelectTrigger>
                            <SelectContent align="start">
                              <SelectItem value="default">
                                {t("claude.effortLevelDefault")}
                              </SelectItem>
                              {CLAUDE_EFFORT_LEVEL_VALUES.map((value) => (
                                <SelectItem key={value} value={value}>
                                  {t(`claude.effortLevel_${value}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground">
                          Model
                        </label>
                        <Input
                          value={selectedDraft.model}
                          readOnly={selectedDraft.modelProviderId != null}
                          onChange={(event) => {
                            handleImportantConfigChange(
                              "model",
                              event.target.value
                            )
                          }}
                          placeholder="gpt-5 / claude-sonnet / gemini-2.5-pro"
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-muted-foreground">
                        {t("nativeJsonConfig")}
                      </label>
                      <Textarea
                        value={selectedDraft.configText}
                        onChange={(event) => {
                          handleConfigTextChange(event.target.value)
                        }}
                        placeholder={`{
  "apiBaseUrl": "https://api.example.com",
  "apiKey": "sk-...",
  "model": "gpt-5",
  "env": {
    "CUSTOM_KEY": "VALUE"
  }
}`}
                        className="min-h-36 font-mono text-xs"
                      />
                      {selectedConfigError && (
                        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-400">
                          {selectedConfigError}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => {
                          if (selectedMissingModelProvider) {
                            toast.error(t("toasts.modelProviderRequired"))
                            return
                          }
                          // When a Claude provider is bound, the on-disk config
                          // loaded into configText may carry stale model keys
                          // (e.g. a leftover custom model option) from before the
                          // binding — re-derive them from the provider so
                          // persistConfig cannot write a stale value back over
                          // the backend bind cascade (invalid JSON passes through
                          // so persistConfig still surfaces the error). Sequence
                          // env→config (never parallel): persistEnv also rewrites
                          // config.env on the backend, so concurrent writes would
                          // interleave two writers of ~/.claude/settings.json.
                          const configToSave = configTextForClaudeSave(
                            selectedDraft.configText,
                            selectedAgent.agent_type,
                            selectedDraft.modelProviderId,
                            modelProviders.find(
                              (p) => p.id === selectedDraft.modelProviderId
                            )
                          )
                          persistEnv(
                            selectedAgent.agent_type,
                            selectedDraft.enabled,
                            selectedDraft.envText,
                            selectedDraft.modelProviderId
                          )
                            .then(() =>
                              persistConfig(
                                selectedAgent.agent_type,
                                configToSave
                              )
                            )
                            .then(() => {
                              // Reflect the provider-authoritative rewrite in the
                              // editor so the textarea doesn't keep showing a
                              // stale value (e.g. a cleared custom model option)
                              // until reload — only when the rewrite changed it.
                              // The inner guard preserves any edit the user typed
                              // into the still-editable textarea while the save
                              // was in flight (don't clobber a newer draft).
                              if (configToSave !== selectedDraft.configText) {
                                const synced = normalizeConfigText(configToSave)
                                updateSelectedDraft((current) =>
                                  current.configText ===
                                  selectedDraft.configText
                                    ? { ...current, configText: synced }
                                    : current
                                )
                              }
                              toast.success(t("toasts.configSaved"), {
                                description: t("toasts.configSavedHint"),
                              })
                            })
                            .catch((err) => {
                              console.error(
                                "[Settings] save config management failed:",
                                err
                              )
                              const message = toErrorMessage(err)
                              toast.error(
                                t("toasts.saveConfigManagementFailed"),
                                {
                                  description: message,
                                }
                              )
                            })
                        }}
                        disabled={selectedIsSavingEnv || selectedIsSavingConfig}
                      >
                        {selectedIsSavingEnv || selectedIsSavingConfig ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {t("actions.saving")}
                          </>
                        ) : (
                          <>
                            <Save className="h-3.5 w-3.5" />
                            {t("actions.saveConfigManagement")}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
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
