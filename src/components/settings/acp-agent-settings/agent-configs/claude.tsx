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
const CLAUDE_AUTH_MODES = [
  "official_subscription",
  "custom",
  "model_provider",
] as const
type ClaudeAuthMode = (typeof CLAUDE_AUTH_MODES)[number]

interface AgentDraft {
  enabled: boolean
  envText: string
  configText: string
  apiBaseUrl: string
  apiKey: string
  model: string
  claudeAuthMode: ClaudeAuthMode
  modelProviderId: number | null
  geminiAuthMode: GeminiAuthMode
  geminiApiKey: string
  googleApiKey: string
  googleCloudProject: string
  googleCloudLocation: string
  googleApplicationCredentials: string
  codexAuthMode: CodexAuthMode
  codexModelProvider: string
  codexProviderOptions: string[]
  codexReasoningEffort: CodexReasoningEffort
  codexSupportsWebsockets: boolean
  codexSkills: boolean
  codexServiceTierFast: boolean
  claudeMainModel: string
  claudeReasoningModel: string
  claudeDefaultHaikuModel: string
  claudeDefaultSonnetModel: string
  claudeDefaultOpusModel: string
  claudeCustomModelOption: string
  claudeCustomModelOptionName: string
  claudeCustomModelOptionDescription: string
  claudeEffortLevel: ClaudeEffortLevel
  codexAuthJsonText: string
  codexConfigTomlText: string
  openCodeAuthJsonText: string
  openClawGatewayUrl: string
  openClawGatewayToken: string
  openClawSessionKey: string
  clineProvider: ClineProvider
  clineApiKey: string
  clineModel: string
  clineBaseUrl: string
  hermesAuthMode: HermesAuthMode
  openClawAuthMode: OpenClawAuthMode
  clineAuthMode: ClineAuthMode
  openCodeAuthMode: OpenCodeAuthMode
  piAuthMode: PiAuthMode
  codeBuddyAuthMode: CodeBuddyAuthMode
  // Hermes — `apiKey`/`model`/`apiBaseUrl` are reused for the active provider's
  // key, model.default, and model.base_url. These carry the rest.
  hermesProvider: string
  hermesConfigYaml: string
  hermesHome: string
  hermesSetupCommand: string
  hermesModelCommand: string
}

type RunningActionKind =
  | "download_binary"
  | "upgrade_binary"
  | "install_npx"
  | "upgrade_npx"
  | "uninstall_binary"
  | "uninstall_npx"
  | "redownload_binary"
  | "custom_install"
  | "install_uv"

type UiFixAction =
  | FixAction
  | {
      label: string
      kind:
        | "download_binary"
        | "upgrade_binary"
        | "install_npx"
        | "upgrade_npx"
        | "uninstall_binary"
        | "uninstall_npx"
        | "install_opencode_plugins"
        | "custom_install"
      payload: string
      // When true, the fix renders as a greyed-out button (e.g. the uvx
      // agent-install action while the uv runtime isn't ready yet).
      disabled?: boolean
    }

interface UiCheckItem {
  check_id: string
  label: string
  status: CheckStatus
  message: string
  fixes: UiFixAction[]
}

type AcpTranslator = (
  key: string,
  values?: Record<string, string | number>
) => string

let acpTranslator: AcpTranslator | null = null

function acpText(
  key: string,
  fallback: string,
  values?: Record<string, string | number>
): string {
  if (!acpTranslator) return fallback
  return acpTranslator(key, values)
}

function statusTone(status: CheckStatus): string {
  if (status === "pass") return "text-green-500"
  if (status === "warn") return "text-yellow-500"
  return "text-red-500"
}

function summarizeChecks(checks: UiCheckItem[]): CheckStatus | "unchecked" {
  if (checks.length === 0) return "unchecked"
  if (checks.some((check) => check.status === "fail")) return "fail"
  if (checks.some((check) => check.status === "warn")) return "warn"
  return "pass"
}

// Re-export readiness types for any settings consumers that imported them here.
export type { AgentReadiness, AgentReadinessKind }

function envMapToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

function parseEnvText(envText: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const idx = line.indexOf("=")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key) continue
    map[key] = value
  }
  return map
}

function patchEnvText(
  envText: string,
  patch: Record<string, string | undefined>
): string {
  const envMap = parseEnvText(envText)
  for (const [key, value] of Object.entries(patch)) {
    const trimmed = value?.trim() ?? ""
    if (!trimmed) {
      delete envMap[key]
    } else {
      envMap[key] = trimmed
    }
  }
  return envMapToText(envMap)
}

interface ImportantEnvKeys {
  apiBaseUrl: string[]
  apiKey: string[]
  model: string[]
}

const CLAUDE_MODEL_ENV_KEYS = {
  claudeMainModel: "ANTHROPIC_MODEL",
  claudeReasoningModel: "ANTHROPIC_REASONING_MODEL",
  claudeDefaultHaikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  claudeDefaultSonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  claudeDefaultOpusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  claudeCustomModelOption: "ANTHROPIC_CUSTOM_MODEL_OPTION",
  claudeCustomModelOptionName: "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME",
  claudeCustomModelOptionDescription:
    "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION",
} as const

const CLAUDE_EFFORT_LEVEL_CONFIG_KEY = "effortLevel"

type ClaudeEffortLevel = "" | "low" | "medium" | "high" | "xhigh"

const CLAUDE_EFFORT_LEVEL_VALUES: ReadonlyArray<
  Exclude<ClaudeEffortLevel, "">
> = ["low", "medium", "high", "xhigh"]

function normalizeClaudeEffortLevel(value: unknown): ClaudeEffortLevel {
  if (typeof value !== "string") return ""
  const normalized = value.trim().toLowerCase()
  // Upstream claude-agent-acp >=0.37 exposes the sentinel string "default";
  // collapse it to "" so our UI's "默认/Default" placeholder stays
  // canonical regardless of which side wrote the config.
  if (normalized === "" || normalized === "default") return ""
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized
  }
  return ""
}
