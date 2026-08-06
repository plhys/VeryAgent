"use client"

/**
 * Vision Bridge settings — multimodal vision plugin config.
 * Layout matches General / Appearance:
 *   outer: w-full space-y-4 p-3 md:p-4
 *   cards: rounded-xl border bg-card p-4 space-y-4
 *   labels: text-xs font-medium text-muted-foreground
 *   hints: text-xs / text-[11px] text-muted-foreground
 *
 * When `embedded`, omit outer ScrollArea / page padding — parent supplies it
 * (same pattern as ModelProviderSettingsBody).
 */

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, Eye, Loader2, Server, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  type VisionBridgeSettings,
  type VisionBridgeConfig,
  visionBridgeGetConfig,
  visionBridgeSaveConfig,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { ALL_AGENT_TYPES, AGENT_LABELS, type AgentType } from "@/lib/types"
import { primeVisionBridgeConfig } from "@/hooks/use-vision-bridge-enabled"

// OpenClaw doesn't support MCP, so exclude it from the vision bridge grid.
const VISION_CAPABLE_AGENT_TYPES: AgentType[] = ALL_AGENT_TYPES.filter(
  (t) => t !== "open_claw"
)

/** Simple model item from the /v1/models response. */
interface ModelItem {
  id: string
  name: string
}

/** Strip common API path suffixes to get the base URL. */
function stripApiPathSuffixes(raw: string): string {
  const suffixes = [
    "/v1/chat/completions",
    "/v1/messages",
    "/v1/images/generations",
    "/v1/images/edits",
    "/chat/completions",
    "/completions",
    "/messages",
    "/images/generations",
    "/images/edits",
  ]
  let base = raw.trim().replace(/\/+$/, "")
  for (const suffix of suffixes) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length).replace(/\/+$/, "")
      break
    }
  }
  return base
}

/** Build the /v1/models URL from an API URL. */
function modelsUrl(apiUrl: string): string {
  const base = stripApiPathSuffixes(apiUrl)
  if (!base) return ""
  if (base.endsWith("/v1")) return `${base}/models`
  return `${base}/v1/models`
}

async function fetchModelsFromApi(
  apiUrl: string,
  apiKey: string
): Promise<ModelItem[]> {
  const url = modelsUrl(apiUrl)
  if (!url) throw new Error("Invalid API URL")
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "api-key": apiKey,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = (await res.json()) as { data?: { id: string; name?: string }[] }
  if (!body.data || !Array.isArray(body.data)) {
    throw new Error("Unexpected response format from /models")
  }
  return body.data.map((m) => ({ id: m.id, name: m.name ?? m.id }))
}

export function VisionBridgeSettingsBody({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const t = useTranslations("VisionBridgeSettings")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [apiUrl, setApiUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [modelName, setModelName] = useState("")
  const [selectedAgents, setSelectedAgents] = useState<AgentType[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({})

  // Collapsible + model list state
  const [configOpen, setConfigOpen] = useState(true)
  const [models, setModels] = useState<ModelItem[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

  useEffect(() => {
    let cancelled = false
    void visionBridgeGetConfig()
      .then((config: VisionBridgeConfig) => {
        if (cancelled) return
        setEnabled(config.enabled)
        setApiUrl(config.api_url)
        setApiKey(config.api_key)
        setModelName(config.model_name)
        setSelectedAgents(config.agent_types_list as AgentType[])
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(toErrorMessage(err))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleAgent = useCallback((agentType: AgentType) => {
    setSelectedAgents((prev) =>
      prev.includes(agentType)
        ? prev.filter((x) => x !== agentType)
        : [...prev, agentType]
    )
  }, [])

  const handleFetchModels = useCallback(async () => {
    if (!apiUrl.trim() || !apiKey.trim()) {
      toast.error(t("requiredField"))
      return
    }
    setFetchingModels(true)
    try {
      const list = await fetchModelsFromApi(apiUrl.trim(), apiKey.trim())
      setModels(list)
      if (list.length > 0) {
        toast.success(t("modelsFetched", { count: list.length }))
      } else {
        toast.error(t("noModelsFound"))
      }
    } catch (err: unknown) {
      toast.error(t("fetchModelsFailed"), {
        description: toErrorMessage(err),
      })
    } finally {
      setFetchingModels(false)
    }
  }, [apiUrl, apiKey, t])

  const save = useCallback(async () => {
    const errors: Record<string, string> = {}
    if (enabled) {
      if (!apiUrl.trim()) errors.apiUrl = t("requiredField")
      if (!apiKey.trim()) errors.apiKey = t("requiredField")
      if (!modelName.trim()) errors.modelName = t("requiredField")
      if (selectedAgents.length === 0)
        errors.agentSelection = t("selectAtLeastOne")
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors)
      toast.error(t("validationFailed"))
      return
    }
    setValidationErrors({})

    // Filter out open_claw (doesn't support MCP) before saving
    const filteredAgents = selectedAgents.filter((x) => x !== "open_claw")
    const payload: VisionBridgeSettings = {
      enabled,
      api_url: apiUrl,
      api_key: apiKey,
      model_name: modelName,
      agent_types_list: filteredAgents,
    }
    setSaving(true)
    try {
      const applied = await visionBridgeSaveConfig(payload)
      setEnabled(applied.enabled)
      setApiUrl(applied.api_url)
      setApiKey(applied.api_key)
      setModelName(applied.model_name)
      setSelectedAgents(
        (applied.agent_types_list as AgentType[]).filter(
          (x) => x !== "open_claw"
        )
      )
      // Prime the cross-window cache so conversation indicators update live.
      primeVisionBridgeConfig(applied)
      toast.success(t("saved"))
    } catch (err: unknown) {
      toast.error(t("saveFailed"), { description: toErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }, [enabled, apiUrl, apiKey, modelName, selectedAgents, t])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  const body = (
    <>
      {loadError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {t("loadFailed", { detail: loadError })}
        </div>
      )}

      {/* Single card: 多模态路由 — everything inside */}
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{t("title")}</h2>
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          {t("description")}
        </p>

        <label className="flex items-center gap-2">
          <Switch
            id="vision-bridge-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={loading}
          />
          <span className="text-xs text-muted-foreground">{t("enable")}</span>
        </label>
        <p className="text-[11px] text-muted-foreground">{t("enableHint")}</p>

        {/* Vision model config — collapsible, only when enabled */}
        {enabled && (
          <Collapsible
            open={configOpen}
            onOpenChange={setConfigOpen}
            className="rounded-lg border p-3"
          >
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t("modelConfig")}</h3>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-6 w-6"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      configOpen ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="space-y-4 pt-3">
              <div className="space-y-2">
                <label
                  htmlFor="vision-api-url"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("apiUrl")}
                </label>
                <Input
                  id="vision-api-url"
                  placeholder={t("apiUrlPlaceholder")}
                  value={apiUrl}
                  onChange={(e) => {
                    setApiUrl(e.target.value)
                    setValidationErrors((prev) => ({ ...prev, apiUrl: "" }))
                  }}
                  disabled={loading || saving}
                  className={validationErrors.apiUrl ? "border-destructive" : ""}
                />
                {validationErrors.apiUrl && (
                  <p className="text-xs text-destructive">
                    {validationErrors.apiUrl}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {t("apiUrlHint")}
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="vision-model-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("modelName")}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    {models.length > 0 ? (
                      <Select
                        value={modelName}
                        onValueChange={(v) => {
                          setModelName(v)
                          setValidationErrors((prev) => ({
                            ...prev,
                            modelName: "",
                          }))
                        }}
                      >
                        <SelectTrigger
                          className={
                            validationErrors.modelName
                              ? "border-destructive"
                              : ""
                          }
                        >
                          <SelectValue
                            placeholder={t("modelNamePlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="vision-model-name"
                        placeholder={t("modelNamePlaceholder")}
                        value={modelName}
                        onChange={(e) => {
                          setModelName(e.target.value)
                          setValidationErrors((prev) => ({
                            ...prev,
                            modelName: "",
                          }))
                        }}
                        disabled={loading || saving}
                        className={`w-full sm:w-64 ${
                          validationErrors.modelName ? "border-destructive" : ""
                        }`}
                      />
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !apiUrl.trim() || !apiKey.trim()}
                    title={t("fetchModels")}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${
                        fetchingModels ? "animate-spin" : ""
                      }`}
                    />
                  </Button>
                </div>
                {validationErrors.modelName && (
                  <p className="text-xs text-destructive">
                    {validationErrors.modelName}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {t("modelNameHint")}
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="vision-api-key"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("apiKey")}
                </label>
                <Input
                  id="vision-api-key"
                  type="password"
                  placeholder={t("apiKeyPlaceholder")}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setValidationErrors((prev) => ({ ...prev, apiKey: "" }))
                  }}
                  disabled={loading || saving}
                  className={validationErrors.apiKey ? "border-destructive" : ""}
                />
                {validationErrors.apiKey && (
                  <p className="text-xs text-destructive">
                    {validationErrors.apiKey}
                  </p>
                )}
              </div>

              {/* Agent selection — inside the collapsible vision model config */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-semibold">{t("agentSelection")}</h4>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("agentSelectionHint")}
                </p>
                {validationErrors.agentSelection && (
                  <p className="text-xs text-destructive">
                    {validationErrors.agentSelection}
                  </p>
                )}
                <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
                  <Checkbox
                    id="vision-agent-select-all"
                    checked={
                      selectedAgents.length > 0 &&
                      VISION_CAPABLE_AGENT_TYPES.every((t) =>
                        selectedAgents.includes(t)
                      )
                    }
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedAgents([...VISION_CAPABLE_AGENT_TYPES])
                      } else {
                        setSelectedAgents([])
                      }
                    }}
                    disabled={loading || saving}
                  />
                  <label
                    htmlFor="vision-agent-select-all"
                    className="text-xs font-medium leading-none text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t("selectAll")}
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {VISION_CAPABLE_AGENT_TYPES.map((agentType) => (
                    <div
                      key={agentType}
                      className="flex items-center gap-2 rounded-md border px-3 py-2"
                    >
                      <Checkbox
                        id={`vision-agent-${agentType}`}
                        checked={selectedAgents.includes(agentType)}
                        onCheckedChange={() => toggleAgent(agentType)}
                        disabled={loading || saving}
                      />
                      <label
                        htmlFor={`vision-agent-${agentType}`}
                        className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {AGENT_LABELS[agentType]}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Save button — at the bottom of the card */}
        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={save} disabled={loading || saving}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        </div>
      </section>
    </>
  )

  // Parent already supplies page padding — do not double-pad.
  if (embedded) return body

  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">{body}</div>
    </ScrollArea>
  )
}

export function VisionBridgeSettings() {
  return <VisionBridgeSettingsBody />
}