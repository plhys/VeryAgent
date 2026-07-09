"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { updateModelProvider } from "@/lib/api"
import {
  MODEL_PROVIDER_AGENT_TYPES,
  AGENT_LABELS,
  parseClaudeProviderModel,
  serializeClaudeProviderModel,
  extractAgentModel,
  type AgentType,
  type ClaudeProviderModel,
  type ModelProviderInfo,
} from "@/lib/types"

interface EditModelProviderDialogProps {
  provider: ModelProviderInfo | null
  onOpenChange: (open: boolean) => void
  onProviderUpdated: () => void
}

export function EditModelProviderDialog({
  provider,
  onOpenChange,
  onProviderUpdated,
}: EditModelProviderDialogProps) {
  const t = useTranslations("ModelProviderSettings")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [apiUrl, setApiUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [selectedAgentTypes, setSelectedAgentTypes] = useState<AgentType[]>([])
  const [agentModels, setAgentModels] = useState<Record<string, string>>({})
  const [claudeModel, setClaudeModel] = useState<ClaudeProviderModel>({})

  useEffect(() => {
    if (provider) {
      setName(provider.name)
      setApiUrl(provider.api_url)
      setApiKey("")
      setSelectedAgentTypes(provider.agent_types)

      // Parse per-agent model values from the multi-agent model JSON
      const newAgentModels: Record<string, string> = {}
      for (const at of provider.agent_types) {
        if (at === "claude_code") {
          const claudeStr = extractAgentModel(provider.model, at)
          setClaudeModel(parseClaudeProviderModel(claudeStr))
        } else {
          const modelVal = extractAgentModel(provider.model, at)
          newAgentModels[at] = modelVal ?? ""
        }
      }
      setAgentModels(newAgentModels)
      setError(null)
    }
  }, [provider])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setError(null)
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  const toggleAgentType = useCallback(
    (at: AgentType) => {
      setSelectedAgentTypes((prev) => {
        if (prev.includes(at)) {
          if (prev.length <= 1) return prev
          return prev.filter((x) => x !== at)
        }
        return [...prev, at]
      })
    },
    []
  )

  const getModelPlaceholder = useCallback(
    (at: AgentType) => {
      if (at === "codex") return t("modelPlaceholderCodex")
      if (at === "gemini") return t("modelPlaceholderGemini")
      if (at === "kimi_code") return t("modelPlaceholderKimi")
      if (at === "hermes") return t("modelPlaceholderHermes")
      return ""
    },
    [t]
  )

  const handleSubmit = useCallback(async () => {
    if (!provider) return
    if (!name.trim()) {
      setError(t("nameRequired"))
      return
    }
    if (!apiUrl.trim()) {
      setError(t("apiUrlRequired"))
      return
    }
    if (selectedAgentTypes.length === 0) {
      setError(t("agentTypeRequired"))
      return
    }

    // Build the models map: agent_type -> model string
    const models: Record<string, string> = {}
    for (const at of selectedAgentTypes) {
      if (at === "claude_code") {
        const claudeStr = serializeClaudeProviderModel(claudeModel)
        if (claudeStr) models[at] = claudeStr
      } else {
        const val = agentModels[at]?.trim()
        if (val) models[at] = val
      }
    }

    // Compute what changed
    const nameChanged = name.trim() !== provider.name
    const urlChanged = apiUrl.trim() !== provider.api_url
    const keyProvided = apiKey.trim().length > 0
    const agentTypesChanged =
      selectedAgentTypes.length !== provider.agent_types.length ||
      selectedAgentTypes.some((at, i) => at !== provider.agent_types[i])

    setLoading(true)
    setError(null)
    try {
      const { affectedRunningSessions } = await updateModelProvider({
        id: provider.id,
        name: nameChanged ? name.trim() : undefined,
        apiUrl: urlChanged ? apiUrl.trim() : undefined,
        apiKey: keyProvided ? apiKey.trim() : undefined,
        agentTypes: agentTypesChanged ? selectedAgentTypes : undefined,
        models: models, // Always send models (backend merges)
      })
      toast.success(t("editSuccess"))
      if (affectedRunningSessions > 0) {
        toast.info(
          t("affectedRunningSessions", { count: affectedRunningSessions })
        )
      }
      handleOpenChange(false)
      onProviderUpdated()
    } catch (err: unknown) {
      const raw = err as Record<string, unknown>
      const msg =
        typeof raw?.message === "string"
          ? raw.message
          : err instanceof Error
            ? err.message
            : String(err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [
    provider,
    name,
    apiUrl,
    apiKey,
    selectedAgentTypes,
    agentModels,
    claudeModel,
    handleOpenChange,
    onProviderUpdated,
    t,
  ])

  const showClaudeFields = selectedAgentTypes.includes("claude_code")

  return (
    <Dialog open={!!provider} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editProvider")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Provider Name */}
          <div className="space-y-1.5">
            <label htmlFor="edit-mp-name" className="text-xs font-medium">
              {t("providerName")}
            </label>
            <Input
              id="edit-mp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("providerNamePlaceholder")}
            />
          </div>

          {/* API URL — shared across all selected agents */}
          <div className="space-y-1.5">
            <label htmlFor="edit-mp-url" className="text-xs font-medium">
              {t("apiUrl")}
            </label>
            <Input
              id="edit-mp-url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={t("apiUrlPlaceholder")}
            />
          </div>

          {/* API Key — shared across all selected agents */}
          <div className="space-y-1.5">
            <label htmlFor="edit-mp-key" className="text-xs font-medium">
              {t("apiKey")}
            </label>
            <Input
              id="edit-mp-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t("apiKeyKeepCurrent")}
            />
          </div>

          {/* Agent Types — multi-select checkboxes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              {t("agentTypes")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {MODEL_PROVIDER_AGENT_TYPES.map((at) => (
                <label
                  key={at}
                  className="flex items-center gap-1.5 text-xs cursor-pointer"
                >
                  <Checkbox
                    checked={selectedAgentTypes.includes(at)}
                    onCheckedChange={() => toggleAgentType(at)}
                  />
                  {AGENT_LABELS[at]}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("agentTypesHint")}
            </p>
          </div>

          {/* Per-agent model inputs */}
          {selectedAgentTypes.map((at) => {
            if (at === "claude_code") return null
            return (
              <div key={at} className="space-y-1.5">
                <label className="text-xs font-medium">
                  {AGENT_LABELS[at]} {t("model")}
                </label>
                <Input
                  value={agentModels[at] ?? ""}
                  onChange={(e) =>
                    setAgentModels((prev) => ({
                      ...prev,
                      [at]: e.target.value,
                    }))
                  }
                  placeholder={getModelPlaceholder(at)}
                />
              </div>
            )
          })}

          {/* Claude model fields */}
          {showClaudeFields && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs font-medium">
                {AGENT_LABELS.claude_code} {t("model")}
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    {t("claudeMainModel")}
                  </label>
                  <Input
                    value={claudeModel.main ?? ""}
                    onChange={(e) =>
                      setClaudeModel((prev) => ({
                        ...prev,
                        main: e.target.value,
                      }))
                    }
                    placeholder="claude-sonnet-5"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    {t("claudeReasoningModel")}
                  </label>
                  <Input
                    value={claudeModel.reasoning ?? ""}
                    onChange={(e) =>
                      setClaudeModel((prev) => ({
                        ...prev,
                        reasoning: e.target.value,
                      }))
                    }
                    placeholder="claude-opus-4-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    {t("claudeHaikuDefaultModel")}
                  </label>
                  <Input
                    value={claudeModel.haiku ?? ""}
                    onChange={(e) =>
                      setClaudeModel((prev) => ({
                        ...prev,
                        haiku: e.target.value,
                      }))
                    }
                    placeholder="claude-haiku-4-5"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    {t("claudeSonnetDefaultModel")}
                  </label>
                  <Input
                    value={claudeModel.sonnet ?? ""}
                    onChange={(e) =>
                      setClaudeModel((prev) => ({
                        ...prev,
                        sonnet: e.target.value,
                      }))
                    }
                    placeholder="claude-sonnet-5"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium">
                    {t("claudeOpusDefaultModel")}
                  </label>
                  <Input
                    value={claudeModel.opus ?? ""}
                    onChange={(e) =>
                      setClaudeModel((prev) => ({
                        ...prev,
                        opus: e.target.value,
                      }))
                    }
                    placeholder="claude-opus-4-8"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium">
                    {t("claudeCustomModelOption")}
                  </label>
                  <Input
                    value={claudeModel.customOption ?? ""}
                    onChange={(e) =>
                      setClaudeModel((prev) => ({
                        ...prev,
                        customOption: e.target.value,
                      }))
                    }
                    placeholder="my-gateway/claude-opus-4-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    {t("claudeCustomModelOptionName")}
                  </label>
                  <Input
                    value={claudeModel.customOptionName ?? ""}
                    onChange={(e) =>
                      setClaudeModel((prev) => ({
                        ...prev,
                        customOptionName: e.target.value,
                      }))
                    }
                    placeholder="Gateway Opus"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    {t("claudeCustomModelOptionDescription")}
                  </label>
                  <Input
                    value={claudeModel.customOptionDescription ?? ""}
                    onChange={(e) =>
                      setClaudeModel((prev) => ({
                        ...prev,
                        customOptionDescription: e.target.value,
                      }))
                    }
                    placeholder="Routed via custom gateway"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground md:col-span-2">
                  {t("claudeCustomModelOptionHint")}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
