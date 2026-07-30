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
function buildOpenCodeModelOptions(
  config: OpenCodeConfigView | null
): OpenCodeModelOptionGroup[] {
  if (!config) return []
  const groups: OpenCodeModelOptionGroup[] = []
  for (const providerId of config.providerIds) {
    const provider = config.providers[providerId]
    if (!provider || provider.modelIds.length === 0) continue
    groups.push({
      providerId,
      label: provider.name || providerId,
      models: provider.modelIds.map((modelId) => ({
        value: `${providerId}/${modelId}`,
        label: modelId,
      })),
    })
  }
  return groups
}

function OpenCodeModelCombobox({
  value,
  onValueChange,
  groups,
  placeholder,
}: {
  value: string
  onValueChange: (value: string) => void
  groups: OpenCodeModelOptionGroup[]
  placeholder: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSelect = useCallback(
    (next: string | null) => {
      if (typeof next === "string" && next !== value) {
        onValueChange(next)
      }
    },
    [onValueChange, value]
  )

  const handleBlur = useCallback(() => {
    const trimmed = (inputRef.current?.value ?? "").trim()
    if (trimmed !== value) {
      onValueChange(trimmed)
    }
  }, [onValueChange, value])

  return (
    <Combobox key={value} value={value} onValueChange={handleSelect}>
      <ComboboxInput
        ref={inputRef}
        placeholder={placeholder}
        onBlur={handleBlur}
        showClear={false}
      />
      <ComboboxContent>
        <ComboboxList>
          {groups.map((group) => (
            <ComboboxGroup key={group.providerId}>
              <ComboboxLabel>{group.label}</ComboboxLabel>
              {group.models.map((model) => {
                const contextLabel =
                  typeof model.context === "number"
                    ? formatContextWindow(model.context)
                    : ""
                return (
                  <ComboboxItem key={model.value} value={model.value}>
                    <span className="truncate">{model.value}</span>
                    {(model.reasoning || contextLabel) && (
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
                        {model.reasoning && (
                          <Badge
                            variant="outline"
                            className="px-1 text-[9px] font-normal"
                          >
                            {acpText("openCode.reasoningBadge", "reasoning")}
                          </Badge>
                        )}
                        {contextLabel && (
                          <span
                            className="text-[10px] text-muted-foreground"
                            title={acpText(
                              "openCode.contextWindow",
                              "Context window"
                            )}
                          >
                            {contextLabel}
                          </span>
                        )}
                      </span>
                    )}
                  </ComboboxItem>
                )
              })}
            </ComboboxGroup>
          ))}
          <ComboboxEmpty>
            {acpText("openCode.noMatchingModels", "No matching models")}
          </ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function buildOpenCodeNpmOptions(currentValue: string): string[] {
  const next = new Set<string>(
    OPENCODE_PROVIDER_NPM_OPTIONS.map((v) => v.value)
  )
  const current = currentValue.trim()
  if (current) next.add(current)
  return Array.from(next)
}

function extractOpenCodeConfigValues(
  configText: string,
  authJsonText: string
): OpenCodeConfigView {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.error ? {} : parseResult.config
  const authParsed = parseOpenCodeAuthJsonText(authJsonText)
  const authObject = authParsed.authObject ?? {}
  const providerRoot = asObjectRecord(config.provider) ?? {}
  const providerIds = Object.keys(providerRoot)
  const providers: Record<string, OpenCodeProviderView> = {}
  const knownModelKeys = new Set(["id", "name"])

  for (const providerId of providerIds) {
    const rawProvider = asObjectRecord(providerRoot[providerId]) ?? {}
    const options = asObjectRecord(rawProvider.options) ?? {}
    const models = asObjectRecord(rawProvider.models) ?? {}
    const modelIds = Object.keys(models)
    const providerModels: Record<string, OpenCodeModelView> = {}
    for (const modelId of modelIds) {
      const rawModel = asObjectRecord(models[modelId]) ?? {}
      providerModels[modelId] = {
        // OpenCode uses `provider.models.<model_id>` as the true model id.
        id: modelId,
        name:
          pickFirstString(rawModel, ["name"]) ??
          pickFirstString(rawModel, ["id"]) ??
          "",
        extraFieldCount: Object.keys(rawModel).filter(
          (key) => !knownModelKeys.has(key)
        ).length,
      }
    }
    const authEntry = asObjectRecord(authObject[providerId]) ?? {}
    const authKey = pickFirstString(authEntry, ["key"]) ?? ""
    providers[providerId] = {
      id: providerId,
      name: pickFirstString(rawProvider, ["name"]) ?? "",
      api: pickFirstString(rawProvider, ["api"]) ?? "",
      npm: pickFirstString(rawProvider, ["npm"]) ?? "",
      baseUrl: pickFirstString(options, ["baseURL", "baseUrl"]) ?? "",
      apiKey: pickFirstString(options, ["apiKey", "api_key"]) ?? authKey,
      modelCount: modelIds.length,
      modelIds,
      models: providerModels,
    }
  }

  return {
    model: pickFirstString(config, ["model"]) ?? "",
    smallModel:
      pickFirstString(config, ["small_model", "smallModel", "small-model"]) ??
      "",
    enabledProviders: Array.isArray(config.enabled_providers)
      ? config.enabled_providers
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    disabledProviders: Array.isArray(config.disabled_providers)
      ? config.disabled_providers
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    providerIds,
    providers,
  }
}

function patchOpenCodeConfigText(
  configText: string,
  mutator: (config: Record<string, unknown>) => void
): {
  configText: string
  recoveredFromInvalid: boolean
} {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.error
    ? {}
    : (JSON.parse(JSON.stringify(parseResult.config)) as Record<
        string,
        unknown
      >)
  mutator(config)
  return {
    configText:
      Object.keys(config).length === 0 ? "" : JSON.stringify(config, null, 2),
    recoveredFromInvalid: Boolean(parseResult.error),
  }
}

// Fill in `provider.<id>.npm` with the first option for any providers that
// lack it, so the displayed Select value matches what gets persisted to disk.
function ensureOpenCodeProviderNpm(configText: string): string {
  if (!configText.trim()) return configText
  const parseResult = parseConfigJsonText(configText)
  if (parseResult.error) return configText
  const config = parseResult.config
  const providerRoot = asObjectRecord(config.provider)
  if (!providerRoot) return configText
  let mutated = false
  for (const providerId of Object.keys(providerRoot)) {
    const provider = asObjectRecord(providerRoot[providerId])
    if (!provider) continue
    const currentNpm =
      typeof provider.npm === "string" ? provider.npm.trim() : ""
    if (!currentNpm) {
      provider.npm = OPENCODE_PROVIDER_NPM_OPTIONS[0].value
      mutated = true
    }
  }
  if (!mutated) return configText
  return JSON.stringify(config, null, 2)
}

interface CodexTomlImportantValues {
  model: string
  modelProvider: string
  modelReasoningEffort: CodexReasoningEffort
  providerNames: string[]
  providerBaseUrls: Record<string, string>
  providerSupportsWebsockets: Record<string, boolean>
  featureResponsesWebsocketsV2: boolean
  featureSkills: boolean
  serviceTierFast: boolean
}

interface CodexImportantValues {
  apiBaseUrl: string
  apiKey: string | null
  model: string
  modelProvider: string
  reasoningEffort: CodexReasoningEffort
  providerOptions: string[]
  supportsWebsockets: boolean
  skills: boolean
  serviceTierFast: boolean
}
