// @ts-nocheck
"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import { Reorder, useDragControls } from "motion/react"
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
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox"
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
  acpUpdateKimiCodeConfig,
  acpFetchKimiModels,
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
  FixAction,
  HermesLocalConfig,
  ModelProviderInfo,
  OpenClawGatewayDiscovery,
  OpenCodeCatalogProvider,
  PreflightResult,
  ProviderModelItem,
} from "@/lib/types"
import { HERMES_PROVIDERS } from "@/lib/types"
import {
  buildAgentReadiness,
  isReadinessPilotAgent,
  readinessToneClass,
  type AgentReadiness,
  type AgentReadinessKind,
} from "@/lib/agent-readiness"
import {
  OpenCodeConnectDialog,
  OpenCodeCustomProviderDialog,
} from "@/components/settings/opencode-connect-dialog"
import {
  buildConnectedModelOptions,
  buildConnectedProviders,
  disconnectProvider,
  formatContextWindow,
  modelReferencesProvider,
  setProviderApiKey,
  setProviderEnabled,
  type OpenCodeModelOptionGroup,
} from "@/lib/opencode-connect"
import { toErrorMessage } from "@/lib/app-error"
import { getInstallErrorHintKey } from "@/lib/agent-install-error"
import { useAgentInstallStream } from "@/hooks/use-agent-install-stream"
import { OpencodePluginsModal } from "./opencode-plugins-modal"
import { CodeBuddyConfigPanel } from "./codebuddy-config-panel"
import { PiConfigPanel } from "./pi-config-panel"
// @ts-nocheck
const CLINE_PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai-native", label: "OpenAI" },
  { value: "openai", label: "OpenAI Compatible" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "gemini", label: "Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "vertex", label: "GCP Vertex" },
  { value: "ollama", label: "Ollama" },
] as const

type ClineProvider = (typeof CLINE_PROVIDERS)[number]["value"]

type ClaudeModelKey = keyof typeof CLAUDE_MODEL_ENV_KEYS
type ImportantConfigKey = "apiBaseUrl" | "apiKey" | "model" | ClaudeModelKey
type ImportantDraftPatch = Partial<Pick<AgentDraft, ImportantConfigKey>>

interface ConfigParseResult {
  config: Record<string, unknown>
  error: string | null
}

function importantEnvKeysByAgent(agentType: AgentType): ImportantEnvKeys {
  if (agentType === "claude_code") {
    return {
      apiBaseUrl: ["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "API_BASE_URL"],
      apiKey: ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
      model: ["ANTHROPIC_MODEL", "OPENAI_MODEL", "MODEL"],
    }
  }
  if (agentType === "gemini") {
    return {
      apiBaseUrl: ["GOOGLE_GEMINI_BASE_URL", "GEMINI_BASE_URL", "API_BASE_URL"],
      apiKey: [
        GEMINI_ENV_KEYS.geminiApiKey,
        GEMINI_ENV_KEYS.googleApiKey,
        GEMINI_ENV_KEYS.legacyGeminiApiKey,
        "API_KEY",
      ],
      model: ["GEMINI_MODEL", "MODEL"],
    }
  }
  return {
    apiBaseUrl: ["OPENAI_BASE_URL", "API_BASE_URL"],
    apiKey: ["OPENAI_API_KEY", "API_KEY"],
    model: ["OPENAI_MODEL", "MODEL"],
  }
}

function parseConfigJsonText(configText: string): ConfigParseResult {
  const trimmed = configText.trim()
  if (!trimmed) return { config: {}, error: null }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        config: {},
        error: acpText(
          "errors.nativeJsonMustBeObject",
          "Native JSON config must be an object"
        ),
      }
    }
    return { config: parsed as Record<string, unknown>, error: null }
  } catch (err) {
    const message = toErrorMessage(err)
    return {
      config: {},
      error: acpText(
        "errors.nativeJsonInvalid",
        "Native JSON config format error: {message}",
        { message }
      ),
    }
  }
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseOpenCodeAuthJsonText(authJsonText: string): {
  authObject: Record<string, unknown> | null
  error: string | null
} {
  const trimmed = authJsonText.trim()
  if (!trimmed) return { authObject: {}, error: null }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        authObject: null,
        error: acpText(
          "errors.openCodeAuthMustBeObject",
          "OpenCode auth.json must be a JSON object"
        ),
      }
    }
    return { authObject: parsed as Record<string, unknown>, error: null }
  } catch (err) {
    const message = toErrorMessage(err)
    return {
      authObject: null,
      error: acpText(
        "errors.openCodeAuthInvalid",
        "OpenCode auth.json format error: {message}",
        { message }
      ),
    }
  }
}

function patchOpenCodeAuthJsonText(
  authJsonText: string,
  mutator: (authObject: Record<string, unknown>) => void
): { authJsonText: string; recoveredFromInvalid: boolean } {
  const parsed = parseOpenCodeAuthJsonText(authJsonText)
  const authObject = parsed.error
    ? {}
    : (JSON.parse(JSON.stringify(parsed.authObject ?? {})) as Record<
        string,
        unknown
      >)
  mutator(authObject)
  return {
    authJsonText:
      Object.keys(authObject).length === 0
        ? ""
        : JSON.stringify(authObject, null, 2),
    recoveredFromInvalid: Boolean(parsed.error),
  }
}

function envFromConfig(
  config: Record<string, unknown>
): Record<string, string> {
  const raw = config.env
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue
    const trimmedKey = key.trim()
    const trimmedValue = value.trim()
    if (!trimmedKey || !trimmedValue) continue
    map[trimmedKey] = trimmedValue
  }
  return map
}

function pickFirstString(
  source: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

function findEnvValue(env: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = env[key]
    if (!value) continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return ""
}

function extractImportantConfigValues(
  agentType: AgentType,
  env: Record<string, string>,
  configText: string
): {
  apiBaseUrl: string
  apiKey: string
  model: string
  claudeMainModel: string
  claudeReasoningModel: string
  claudeDefaultHaikuModel: string
  claudeDefaultSonnetModel: string
  claudeDefaultOpusModel: string
  claudeCustomModelOption: string
  claudeCustomModelOptionName: string
  claudeCustomModelOptionDescription: string
  claudeEffortLevel: ClaudeEffortLevel
  configError: string | null
} {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.config
  const keys = importantEnvKeysByAgent(agentType)

  const configEnv = envFromConfig(config)
  const mergedEnv = { ...env, ...configEnv }

  const apiBaseUrl =
    pickFirstString(config, ["apiBaseUrl", "api_base_url"]) ??
    findEnvValue(mergedEnv, keys.apiBaseUrl)
  const apiKey =
    pickFirstString(config, ["apiKey", "api_key"]) ??
    findEnvValue(mergedEnv, keys.apiKey)
  const model =
    pickFirstString(config, ["model", "model_name"]) ??
    findEnvValue(mergedEnv, keys.model)
  const claudeMainModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeMainModel,
  ])
  const claudeReasoningModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeReasoningModel,
  ])
  const claudeDefaultHaikuModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeDefaultHaikuModel,
  ])
  const claudeDefaultSonnetModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeDefaultSonnetModel,
  ])
  const claudeDefaultOpusModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeDefaultOpusModel,
  ])
  const claudeCustomModelOption = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOption,
  ])
  const claudeCustomModelOptionName = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOptionName,
  ])
  const claudeCustomModelOptionDescription = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOptionDescription,
  ])

  const claudeEffortLevel: ClaudeEffortLevel =
    agentType === "claude_code"
      ? normalizeClaudeEffortLevel(config[CLAUDE_EFFORT_LEVEL_CONFIG_KEY])
      : ""

  return {
    apiBaseUrl: apiBaseUrl ?? "",
    apiKey: apiKey ?? "",
    model: model ?? "",
    claudeMainModel: agentType === "claude_code" ? (claudeMainModel ?? "") : "",
    claudeReasoningModel:
      agentType === "claude_code" ? claudeReasoningModel : "",
    claudeDefaultHaikuModel:
      agentType === "claude_code" ? claudeDefaultHaikuModel : "",
    claudeDefaultSonnetModel:
      agentType === "claude_code" ? claudeDefaultSonnetModel : "",
    claudeDefaultOpusModel:
      agentType === "claude_code" ? claudeDefaultOpusModel : "",
    claudeCustomModelOption:
      agentType === "claude_code" ? claudeCustomModelOption : "",
    claudeCustomModelOptionName:
      agentType === "claude_code" ? claudeCustomModelOptionName : "",
    claudeCustomModelOptionDescription:
      agentType === "claude_code" ? claudeCustomModelOptionDescription : "",
    claudeEffortLevel,
    configError: parseResult.error,
  }
}

interface GeminiImportantValues {
  authMode: GeminiAuthMode
  apiBaseUrl: string
  geminiApiKey: string
  googleApiKey: string
  googleCloudProject: string
  googleCloudLocation: string
  googleApplicationCredentials: string
  model: string
}

function inferGeminiAuthMode(values: {
  apiBaseUrl: string
  geminiApiKey: string
  googleApiKey: string
  googleCloudProject: string
  googleCloudLocation: string
  googleApplicationCredentials: string
}): GeminiAuthMode {
  if (values.apiBaseUrl.trim()) return "custom"
  if (values.geminiApiKey.trim()) return "gemini_api_key"
  if (values.googleApiKey.trim()) return "vertex_api_key"
  if (values.googleApplicationCredentials.trim())
    return "vertex_service_account"
  if (values.googleCloudProject.trim() || values.googleCloudLocation.trim()) {
    return "vertex_adc"
  }
  return "login_google"
}

function extractGeminiImportantValues(
  env: Record<string, string>,
  configText: string
): GeminiImportantValues {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.config
  const configEnv = envFromConfig(config)
  const mergedEnv = { ...env, ...configEnv }

  const apiBaseUrl = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.baseUrl,
    GEMINI_ENV_KEYS.legacyBaseUrl,
    "API_BASE_URL",
  ])
  const geminiApiKey = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.geminiApiKey,
    GEMINI_ENV_KEYS.legacyGeminiApiKey,
  ])
  const googleApiKey = findEnvValue(mergedEnv, [GEMINI_ENV_KEYS.googleApiKey])
  const googleCloudProject = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.cloudProject,
    GEMINI_ENV_KEYS.cloudProjectLegacy,
  ])
  const googleCloudLocation = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.cloudLocation,
  ])
  const googleApplicationCredentials = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.applicationCredentials,
  ])
  const model = findEnvValue(mergedEnv, [GEMINI_ENV_KEYS.model, "MODEL"])

  return {
    authMode: inferGeminiAuthMode({
      apiBaseUrl,
      geminiApiKey,
      googleApiKey,
      googleCloudProject,
      googleCloudLocation,
      googleApplicationCredentials,
    }),
    apiBaseUrl,
    geminiApiKey,
    googleApiKey,
    googleCloudProject,
    googleCloudLocation,
    googleApplicationCredentials,
    model: model ?? "",
  }
}

interface OpenClawImportantValues {
  gatewayUrl: string
  gatewayToken: string
  sessionKey: string
}

interface ClineImportantValues {
  provider: ClineProvider
  apiKey: string
  model: string
  baseUrl: string
}

function extractClineImportantValues(configText: string): ClineImportantValues {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.config
  return {
    provider: (typeof config.apiProvider === "string" && config.apiProvider
      ? config.apiProvider
      : "anthropic") as ClineProvider,
    apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
    model: typeof config.model === "string" ? config.model : "",
    baseUrl: typeof config.apiBaseUrl === "string" ? config.apiBaseUrl : "",
  }
}

function extractOpenClawImportantValues(
  env: Record<string, string>,
  configText: string
): OpenClawImportantValues {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.config
  const configEnv = envFromConfig(config)
  const mergedEnv = { ...env, ...configEnv }

  return {
    gatewayUrl: findEnvValue(mergedEnv, [OPENCLAW_ENV_KEYS.gatewayUrl]),
    gatewayToken: findEnvValue(mergedEnv, [OPENCLAW_ENV_KEYS.gatewayToken]),
    sessionKey: findEnvValue(mergedEnv, [OPENCLAW_ENV_KEYS.sessionKey]),
  }
}

function patchGeminiConfigText(
  configText: string,
  patch: {
    apiBaseUrl?: string
    model?: string
    geminiApiKey?: string
    googleApiKey?: string
    googleCloudProject?: string
    googleCloudLocation?: string
    googleApplicationCredentials?: string
  }
): {
  configText: string
  recoveredFromInvalid: boolean
} {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.error ? {} : { ...parseResult.config }
  const env =
    typeof config.env === "object" && config.env && !Array.isArray(config.env)
      ? { ...(config.env as Record<string, unknown>) }
      : {}

  const assignOrRemoveEnv = (key: string, value: string | undefined) => {
    if (typeof value !== "string") return
    const trimmed = value.trim()
    if (!trimmed) {
      delete env[key]
      return
    }
    env[key] = trimmed
  }

  if (typeof patch.model === "string") {
    delete config.model
    delete config.model_name
    assignOrRemoveEnv(GEMINI_ENV_KEYS.model, patch.model)
  }
  assignOrRemoveEnv(GEMINI_ENV_KEYS.baseUrl, patch.apiBaseUrl)
  if (typeof patch.apiBaseUrl === "string") {
    assignOrRemoveEnv(GEMINI_ENV_KEYS.legacyBaseUrl, "")
  }
  assignOrRemoveEnv(GEMINI_ENV_KEYS.geminiApiKey, patch.geminiApiKey)
  assignOrRemoveEnv(GEMINI_ENV_KEYS.googleApiKey, patch.googleApiKey)
  if (typeof patch.geminiApiKey === "string") {
    assignOrRemoveEnv(GEMINI_ENV_KEYS.legacyGeminiApiKey, "")
  }
  if (typeof patch.googleCloudProject === "string") {
    const project = patch.googleCloudProject.trim()
    if (!project) {
      delete env[GEMINI_ENV_KEYS.cloudProject]
      delete env[GEMINI_ENV_KEYS.cloudProjectLegacy]
    } else {
      env[GEMINI_ENV_KEYS.cloudProject] = project
      delete env[GEMINI_ENV_KEYS.cloudProjectLegacy]
    }
  }
  assignOrRemoveEnv(GEMINI_ENV_KEYS.cloudLocation, patch.googleCloudLocation)
  assignOrRemoveEnv(
    GEMINI_ENV_KEYS.applicationCredentials,
    patch.googleApplicationCredentials
  )

  if (Object.keys(env).length === 0) {
    delete config.env
  } else {
    config.env = env
  }

  return {
    configText:
      Object.keys(config).length === 0 ? "" : JSON.stringify(config, null, 2),
    recoveredFromInvalid: Boolean(parseResult.error),
  }
}

function patchGeminiEnvText(
  envText: string,
  patch: {
    apiBaseUrl?: string
    geminiApiKey?: string
    googleApiKey?: string
    googleCloudProject?: string
    googleCloudLocation?: string
    googleApplicationCredentials?: string
    model?: string
  }
): string {
  const envPatch: Record<string, string | undefined> = {}
  if (typeof patch.apiBaseUrl === "string") {
    envPatch[GEMINI_ENV_KEYS.baseUrl] = patch.apiBaseUrl
    envPatch[GEMINI_ENV_KEYS.legacyBaseUrl] = ""
  }
  if (typeof patch.geminiApiKey === "string") {
    envPatch[GEMINI_ENV_KEYS.geminiApiKey] = patch.geminiApiKey
    envPatch[GEMINI_ENV_KEYS.legacyGeminiApiKey] = ""
  }
  if (typeof patch.googleApiKey === "string") {
    envPatch[GEMINI_ENV_KEYS.googleApiKey] = patch.googleApiKey
  }
  if (typeof patch.googleCloudProject === "string") {
    envPatch[GEMINI_ENV_KEYS.cloudProject] = patch.googleCloudProject
    envPatch[GEMINI_ENV_KEYS.cloudProjectLegacy] = ""
  }
  if (typeof patch.googleCloudLocation === "string") {
    envPatch[GEMINI_ENV_KEYS.cloudLocation] = patch.googleCloudLocation
  }
  if (typeof patch.googleApplicationCredentials === "string") {
    envPatch[GEMINI_ENV_KEYS.applicationCredentials] =
      patch.googleApplicationCredentials
  }
  if (typeof patch.model === "string") {
    envPatch[GEMINI_ENV_KEYS.model] = patch.model
  }
  return patchEnvText(envText, envPatch)
}

function patchGeminiAuthMode(
  current: GeminiImportantValues,
  mode: GeminiAuthMode
) {
  const next = {
    ...current,
    authMode: mode,
  }
  if (mode === "login_google") {
    next.apiBaseUrl = ""
    next.geminiApiKey = ""
    next.googleApiKey = ""
    next.googleCloudProject = ""
    next.googleCloudLocation = ""
    next.googleApplicationCredentials = ""
    return next
  }
  if (mode === "custom") {
    next.googleApiKey = ""
    next.googleCloudProject = ""
    next.googleCloudLocation = ""
    next.googleApplicationCredentials = ""
    return next
  }
  if (mode === "gemini_api_key") {
    next.apiBaseUrl = ""
    next.googleApiKey = ""
    next.googleCloudProject = ""
    next.googleCloudLocation = ""
    next.googleApplicationCredentials = ""
    return next
  }
  if (mode === "vertex_api_key") {
    next.apiBaseUrl = ""
    next.geminiApiKey = ""
    next.googleApplicationCredentials = ""
    return next
  }
  if (mode === "vertex_service_account") {
    next.apiBaseUrl = ""
    next.geminiApiKey = ""
    next.googleApiKey = ""
    return next
  }
  if (mode === "model_provider") {
    next.googleCloudProject = ""
    next.googleCloudLocation = ""
    next.googleApplicationCredentials = ""
    return next
  }
  next.apiBaseUrl = ""
  next.geminiApiKey = ""
  next.googleApiKey = ""
  next.googleApplicationCredentials = ""
  return next
}

function geminiAuthModeLabel(mode: GeminiAuthMode): string {
  if (mode === "custom")
    return acpText("authModeCustomEndpoint", "Custom Endpoint")
  if (mode === "login_google")
    return acpText("gemini.mode.loginGoogle", "Google Login (OAuth)")
  if (mode === "gemini_api_key") return "Gemini API Key"
  if (mode === "vertex_adc") return "Vertex AI (ADC)"
  if (mode === "vertex_service_account")
    return acpText(
      "gemini.mode.vertexServiceAccount",
      "Vertex AI (Service Account)"
    )
  if (mode === "model_provider")
    return acpText("authModeModelProvider", "Model Provider")
  return "Vertex AI API Key"
}

function geminiAuthModeHint(mode: GeminiAuthMode): string {
  if (mode === "custom") {
    return acpText(
      "gemini.hint.custom",
      "Fill API URL, API Key and Model, mapped to GOOGLE_GEMINI_BASE_URL / GEMINI_API_KEY / GEMINI_MODEL."
    )
  }
  if (mode === "login_google") {
    return acpText(
      "gemini.hint.loginGoogle",
      "Run gemini in terminal and complete Google login first; API key is not required."
    )
  }
  if (mode === "gemini_api_key") {
    return acpText(
      "gemini.hint.geminiApiKey",
      "Fill GEMINI_API_KEY when using Gemini API."
    )
  }
  if (mode === "vertex_adc") {
    return acpText(
      "gemini.hint.vertexAdc",
      "Use gcloud ADC; GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are recommended."
    )
  }
  if (mode === "vertex_service_account") {
    return acpText(
      "gemini.hint.vertexServiceAccount",
      "Set service account JSON path to GOOGLE_APPLICATION_CREDENTIALS."
    )
  }
  if (mode === "model_provider") {
    return acpText(
      "modelProviderHint",
      "Use API URL and API Key from a configured model provider."
    )
  }
  return acpText(
    "gemini.hint.vertexApiKey",
    "Fill GOOGLE_API_KEY when using Vertex AI API key."
  )
}

/**
 * Compare original and current config objects. For any key present in
 * original but missing in current, set it to `null` in the result so
 * the backend merge can delete it from the file on disk.
 */
function markRemovedKeysNull(
  original: Record<string, unknown>,
  current: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...current }
  for (const key of Object.keys(original)) {
    if (!(key in result)) {
      result[key] = null
    } else if (
      original[key] &&
      typeof original[key] === "object" &&
      !Array.isArray(original[key]) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = markRemovedKeysNull(
        original[key] as Record<string, unknown>,
        result[key] as Record<string, unknown>
      )
    }
  }
  return result
}

function normalizeConfigText(configText: string): string {
  const parseResult = parseConfigJsonText(configText)
  if (parseResult.error) return configText.trim()
  if (Object.keys(parseResult.config).length === 0) return ""
  return JSON.stringify(parseResult.config, null, 2)
}

interface OpenCodeProviderView {
  id: string
  name: string
  api: string
  npm: string
  baseUrl: string
  apiKey: string
  modelCount: number
  modelIds: string[]
  models: Record<string, OpenCodeModelView>
}

interface OpenCodeModelView {
  id: string
  name: string
  extraFieldCount: number
}

interface OpenCodeConfigView {
  model: string
  smallModel: string
  enabledProviders: string[]
  disabledProviders: string[]
  providerIds: string[]
  providers: Record<string, OpenCodeProviderView>
}

const OPENCODE_PROVIDER_NPM_OPTIONS = [
  {
    value: "@ai-sdk/openai-compatible",
    label: "@ai-sdk/openai-compatible",
  },
  {
    value: "@ai-sdk/cerebras",
    label: "@ai-sdk/cerebras",
  },
  {
    value: "@ai-sdk/azure",
    label: "@ai-sdk/azure",
  },
  {
    value: "@ai-sdk/xai",
    label: "@ai-sdk/xai",
  },
  {
    value: "@ai-sdk/anthropic",
    label: "@ai-sdk/anthropic",
  },
  {
    value: "@ai-sdk/amazon-bedrock",
    label: "@ai-sdk/amazon-bedrock",
  },
  {
    value: "@ai-sdk/google",
    label: "@ai-sdk/google",
  },
  {
    value: "@ai-sdk/google-vertex",
    label: "@ai-sdk/google-vertex",
  },
  {
    value: "@ai-sdk/deepseek",
    label: "@ai-sdk/deepseek",
  },
] as const
