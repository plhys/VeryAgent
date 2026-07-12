"use client"

/**
 * Vision Bridge settings page — a standalone plugin page that configures the
 * multimodal vision plugin. Lets text-only models "see" images by routing
 * through a vision-capable model.
 *
 * This is a full-page component (not a small card in General settings).
 * Mounted at `/settings/vision-bridge` with its own sidebar nav entry.
 */

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Eye, Loader2, Server } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import {
  type VisionBridgeSettings,
  type VisionBridgeConfig,
  visionBridgeGetConfig,
  visionBridgeSaveConfig,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import {
  ALL_AGENT_TYPES,
  AGENT_LABELS,
  type AgentType,
} from "@/lib/types"
import { primeVisionBridgeConfig } from "@/hooks/use-vision-bridge-enabled"

// OpenClaw doesn't support MCP, so exclude it from the vision bridge grid.
const VISION_CAPABLE_AGENT_TYPES: AgentType[] = ALL_AGENT_TYPES.filter(
  (t) => t !== "open_claw"
)

export function VisionBridgeSettings() {
  const t = useTranslations("VisionBridgeSettings")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [apiUrl, setApiUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [modelName, setModelName] = useState("")
  const [selectedAgents, setSelectedAgents] = useState<AgentType[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

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
        ? prev.filter((t) => t !== agentType)
        : [...prev, agentType]
    )
  }, [])

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  const save = useCallback(async () => {
    // Validate required fields when enabled
    const errors: Record<string, string> = {}
    if (enabled) {
      if (!apiUrl.trim()) errors.apiUrl = t("requiredField")
      if (!apiKey.trim()) errors.apiKey = t("requiredField")
      if (!modelName.trim()) errors.modelName = t("requiredField")
      if (selectedAgents.length === 0) errors.agentSelection = t("selectAtLeastOne")
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors)
      toast.error(t("validationFailed"))
      return
    }
    setValidationErrors({})

    // Filter out open_claw (doesn't support MCP) before saving
    const filteredAgents = selectedAgents.filter((t) => t !== "open_claw")
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
      // Filter open_claw from the response too
      setSelectedAgents(
        (applied.agent_types_list as AgentType[]).filter((t) => t !== "open_claw")
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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t("loading")}</span>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 px-1">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Eye className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
        </div>

        {loadError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {t("loadFailed", { detail: loadError })}
          </p>
        )}

        {/* Enable toggle */}
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
          <div className="min-w-0 space-y-1">
            <label htmlFor="vision-bridge-enabled" className="text-sm font-medium">
              {t("enable")}
            </label>
            <p className="text-xs text-muted-foreground">{t("enableHint")}</p>
          </div>
          <Switch
            id="vision-bridge-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={loading}
            className="shrink-0"
          />
        </div>

        {/* Vision model config — only visible when enabled */}
        {enabled && (
          <div className="space-y-4">
            <div className="space-y-4 rounded-lg border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Server className="h-4 w-4 text-muted-foreground" />
                {t("modelConfig")}
              </h2>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="vision-api-url" className="text-sm">
                    {t("apiUrl")}
                  </Label>
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
                    <p className="text-xs text-destructive">{validationErrors.apiUrl}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{t("apiUrlHint")}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vision-model-name" className="text-sm">
                    {t("modelName")}
                  </Label>
                  <Input
                    id="vision-model-name"
                    placeholder={t("modelNamePlaceholder")}
                    value={modelName}
                    onChange={(e) => {
                      setModelName(e.target.value)
                      setValidationErrors((prev) => ({ ...prev, modelName: "" }))
                    }}
                    disabled={loading || saving}
                    className={validationErrors.modelName ? "border-destructive" : ""}
                  />
                  {validationErrors.modelName && (
                    <p className="text-xs text-destructive">{validationErrors.modelName}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="vision-api-key" className="text-sm">
                  {t("apiKey")}
                </Label>
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
                  <p className="text-xs text-destructive">{validationErrors.apiKey}</p>
                )}
              </div>
            </div>

            {/* Agent types selection */}
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">{t("agentSelection")}</h2>
              <p className="text-xs text-muted-foreground">{t("agentSelectionHint")}</p>
              {validationErrors.agentSelection && (
                <p className="text-xs text-destructive">{validationErrors.agentSelection}</p>
              )}
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
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {AGENT_LABELS[agentType]}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        <div className="flex justify-end">
          <Button onClick={save} disabled={loading || saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}
