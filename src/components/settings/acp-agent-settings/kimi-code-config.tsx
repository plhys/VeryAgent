import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Eye, EyeOff, Loader2, RefreshCw, Save } from "lucide-react"
import { toast } from "sonner"
import { toErrorMessage } from "@/lib/app-error"
import {
  fetchModelProviderModels,
  acpFetchKimiModels,
  acpUpdateKimiCodeConfig,
} from "@/lib/api"
import type {
  AcpAgentInfo,
  ModelProviderInfo,
  ProviderModelItem,
} from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type {
  KimiAuthMode,
  KimiInterfaceType,
  KimiNativeAuthType,
  KimiEndpointRegion,
  KimiInterfaceTypeMeta,
  KimiManagedConfig,
} from "./types"
import {
  KIMI_BASE_URL_INTERNATIONAL,
  KIMI_BASE_URL_CHINA,
  KIMI_MODEL_PLACEHOLDER,
  KIMI_INTERFACE_TYPES,
} from "./types"
import { findEnvValue, normalizeOpenAiCompatibleBaseUrl } from "./shared"

export function kimiInterfaceMeta(
  type: KimiInterfaceType
): KimiInterfaceTypeMeta {
  return (
    KIMI_INTERFACE_TYPES.find((meta) => meta.value === type) ??
    KIMI_INTERFACE_TYPES[0]
  )
}
export function kimiEndpointRegionFromBaseUrl(
  baseUrl: string
): KimiEndpointRegion {
  const raw = baseUrl.trim().toLowerCase()
  if (!raw) return "international"
  if (raw.includes("moonshot.cn")) return "china"
  if (raw.includes("moonshot.ai")) return "international"
  return "custom"
}

export function kimiBaseUrlForRegion(
  region: KimiEndpointRegion,
  customUrl: string
): string {
  if (region === "china") return KIMI_BASE_URL_CHINA
  if (region === "custom") return customUrl.trim()
  return KIMI_BASE_URL_INTERNATIONAL
}
export function parseKimiManagedConfig(
  configJson: string | null | undefined
): KimiManagedConfig {
  if (!configJson || !configJson.trim()) return {}
  try {
    return JSON.parse(configJson) as KimiManagedConfig
  } catch {
    return {}
  }
}

/**
 * Initial panel mode: the veryagent-managed API-key block wins; otherwise, when a
 * real (non-synthetic) OAuth login is already present, show login; else default
 * to the API-key form.
 */
export function kimiInitialMode(config: KimiManagedConfig): KimiAuthMode {
  if (config.hasManagedBlock) return "apikey"
  if (config.credentialPresent && !config.credentialSynthetic) return "login"
  return "apikey"
}

export function KimiCodeConfigPanel({
  agent,
  onSaved,
  modelProviders,
  onSaveModelProvider,
}: {
  agent: AcpAgentInfo
  onSaved: () => Promise<void>
  modelProviders: ModelProviderInfo[]
  onSaveModelProvider: (
    env: Record<string, string>,
    enabled: boolean,
    modelProviderId: number | null
  ) => Promise<void>
}) {
  const t = useTranslations("AcpAgentSettings")
  const config = useMemo(
    () => parseKimiManagedConfig(agent.config_json),
    [agent.config_json]
  )

  // Determine initial auth mode: if model_provider_id is set, start in
  // model_provider mode; otherwise, infer from the config credentials.
  const [mode, setMode] = useState<KimiAuthMode>(() =>
    agent.model_provider_id != null ? "model_provider" : kimiInitialMode(config)
  )
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(
    () => agent.model_provider_id ?? null
  )
  const [selectedProviderModel, setSelectedProviderModel] = useState(
    () =>
      findEnvValue(agent.env ?? {}, ["KIMI_MODEL_NAME", "OPENAI_MODEL"]) ||
      config.modelId ||
      ""
  )
  const [providerModels, setProviderModels] = useState<ProviderModelItem[]>([])
  const [providerModelsLoading, setProviderModelsLoading] = useState(false)
  const [providerModelsError, setProviderModelsError] = useState<string | null>(
    null
  )
  const [providerModelsRefreshKey, setProviderModelsRefreshKey] = useState(0)
  const [saving, setSaving] = useState(false)

  // Filter model providers that serve kimi_code.
  const kimiModelProviders = useMemo(() => modelProviders, [modelProviders])
  const [showKey, setShowKey] = useState(false)

  // api-key mode (veryagent-managed config.toml provider + model)
  const [interfaceType, setInterfaceType] = useState<KimiInterfaceType>(
    () => config.interfaceType ?? "kimi"
  )
  const [region, setRegion] = useState<KimiEndpointRegion>(() =>
    kimiEndpointRegionFromBaseUrl(config.baseUrl ?? "")
  )
  // Editable base URL for kimi+custom and for non-kimi interface types.
  const [baseUrl, setBaseUrl] = useState(
    () =>
      config.baseUrl ??
      kimiInterfaceMeta(config.interfaceType ?? "kimi").defaultBaseUrl
  )
  const [authType, setAuthType] = useState<KimiNativeAuthType>(
    () => config.authType ?? "api_key"
  )
  const [apiKey, setApiKey] = useState(() => config.key ?? "")
  const [model, setModel] = useState(() => config.modelId ?? "")
  const [maxContext, setMaxContext] = useState(() =>
    config.maxContextSize ? String(config.maxContextSize) : ""
  )
  const [vertexProject, setVertexProject] = useState(
    () => config.vertexProject ?? ""
  )
  const [vertexLocation, setVertexLocation] = useState(
    () => config.vertexLocation ?? ""
  )

  // Models discovered via the provider's /models endpoint (doubles as a key test).
  const [models, setModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

  // raw editor
  const [rawConfig, setRawConfig] = useState(() => config.rawConfigToml ?? "")

  const meta = kimiInterfaceMeta(interfaceType)
  const isKimi = interfaceType === "kimi"
  const isVertex = interfaceType === "vertexai"
  // Resolved endpoint: kimi uses the region quick-select (custom falls back to
  // the editable field); other interfaces use the editable field directly.
  const effectiveBaseUrl = isKimi
    ? kimiBaseUrlForRegion(region, baseUrl)
    : baseUrl.trim()

  const handleInterfaceChange = useCallback((value: string) => {
    const next = value as KimiInterfaceType
    setInterfaceType(next)
    setModels([])
    if (next === "kimi") {
      setRegion("international")
      setBaseUrl("")
    } else {
      // Pre-fill the documented default base URL for the new interface.
      setBaseUrl(kimiInterfaceMeta(next).defaultBaseUrl)
    }
  }, [])

  const runSave = useCallback(
    async (params: Parameters<typeof acpUpdateKimiCodeConfig>[0]) => {
      setSaving(true)
      try {
        await acpUpdateKimiCodeConfig(params)
        await onSaved()
        toast.success(t("toasts.kimiCodeSaved"))
      } catch (error) {
        console.error("[KimiCode] save config failed", error)
        toast.error(t("toasts.saveKimiCodeFailed"))
      } finally {
        setSaving(false)
      }
    },
    [onSaved, t]
  )

  const handleSave = useCallback(() => {
    if (mode === "model_provider") {
      // Save via the model-provider path: persist env vars + modelProviderId.
      if (selectedProviderId == null) {
        toast.error(t("toasts.modelProviderRequired"))
        return
      }
      const provider = kimiModelProviders.find(
        (p) => p.id === selectedProviderId
      )
      if (!provider) return
      setSaving(true)
      onSaveModelProvider(
        {
          // Kimi appends `/chat/completions` itself; bare host roots fail silently.
          KIMI_MODEL_BASE_URL: normalizeOpenAiCompatibleBaseUrl(
            provider.api_url
          ),
          KIMI_MODEL_API_KEY: provider.api_key,
          KIMI_MODEL_NAME: selectedProviderModel.trim() || provider.model || "",
        },
        true,
        selectedProviderId
      )
        .then(() => {
          toast.success(t("toasts.kimiCodeSaved"))
        })
        .catch((error) => {
          console.error("[KimiCode] save model-provider failed", error)
          toast.error(t("toasts.saveKimiCodeFailed"))
        })
        .finally(() => {
          setSaving(false)
        })
      return
    }
    if (mode === "login") {
      void runSave({ mode: "login" })
      return
    }
    void runSave({
      mode: "apikey",
      interfaceType,
      authType: meta.usesApiKey ? authType : null,
      baseUrl: effectiveBaseUrl,
      apiKey: meta.usesApiKey ? apiKey : null,
      model,
      maxContextSize: maxContext.trim() ? Number(maxContext) : null,
      vertexProject: isVertex ? vertexProject : null,
      vertexLocation: isVertex ? vertexLocation : null,
    })
  }, [
    mode,
    selectedProviderId,
    selectedProviderModel,
    kimiModelProviders,
    onSaveModelProvider,
    interfaceType,
    meta,
    authType,
    effectiveBaseUrl,
    apiKey,
    model,
    maxContext,
    isVertex,
    vertexProject,
    vertexLocation,
    runSave,
    t,
  ])

  const handleSaveRaw = useCallback(() => {
    void runSave({ mode: "raw", rawConfigToml: rawConfig })
  }, [rawConfig, runSave])

  const handleFetchModels = useCallback(async () => {
    const url = effectiveBaseUrl
    const key = apiKey.trim()
    if (!url || !key) {
      toast.error(t("kimiCode.fetchModelsNeedsKey"))
      return
    }
    setFetchingModels(true)
    try {
      const list = await acpFetchKimiModels({ baseUrl: url, apiKey: key })
      setModels(list)
      toast.success(
        list.length
          ? t("kimiCode.fetchModelsOk", { count: list.length })
          : t("kimiCode.fetchModelsEmpty")
      )
    } catch (error) {
      console.error("[KimiCode] fetch models failed", error)
      toast.error(t("kimiCode.fetchModelsFailed"))
    } finally {
      setFetchingModels(false)
    }
  }, [effectiveBaseUrl, apiKey, t])

  useEffect(() => {
    if (mode !== "model_provider" || selectedProviderId == null) {
      setProviderModels([])
      setProviderModelsError(null)
      setProviderModelsLoading(false)
      return
    }
    let cancelled = false
    setProviderModelsLoading(true)
    setProviderModelsError(null)
    void fetchModelProviderModels(selectedProviderId)
      .then((list) => {
        if (cancelled) return
        setProviderModels(list)
      })
      .catch((error) => {
        if (cancelled) return
        console.error("[KimiCode] fetch provider models failed", error)
        setProviderModels([])
        setProviderModelsError(toErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setProviderModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, selectedProviderId, providerModelsRefreshKey])

  const keyToggle = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setShowKey((prev) => !prev)}
      title={showKey ? t("actions.hideApiKey") : t("actions.showApiKey")}
    >
      {showKey ? (
        <EyeOff className="h-3.5 w-3.5" />
      ) : (
        <Eye className="h-3.5 w-3.5" />
      )}
    </Button>
  )

  return (
    <div className="space-y-3 rounded-md border bg-muted/10 p-3">
      <div>
        <label className="text-xs font-medium">
          {t("kimiCode.configManagement")}
        </label>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("kimiCode.configDescription")}
        </p>
      </div>

      <div
        className={cn(
          "rounded-md border px-2.5 py-1.5 text-[11px]",
          config.credentialPresent
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        )}
      >
        {config.credentialPresent
          ? mode === "login"
            ? t("kimiCode.gateReadyLogin")
            : t("kimiCode.gateReadyApiKey")
          : t("kimiCode.gateNotReady")}
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] text-muted-foreground">
          {t("kimiCode.authModeLabel")}
        </label>
        <Select
          value={mode}
          onValueChange={(value) => {
            const next = value as KimiAuthMode
            setMode(next)
            if (next !== "model_provider") setSelectedProviderId(null)
          }}
          disabled={saving}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="apikey">
              {t("kimiCode.authModeApiKey")}
            </SelectItem>
            <SelectItem value="login">{t("kimiCode.authModeLogin")}</SelectItem>
            <SelectItem value="model_provider">
              {t("kimiCode.authModeModelProvider")}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {mode === "model_provider"
            ? t("kimiCode.authModeModelProviderHint")
            : t("kimiCode.authModeHint")}
        </p>
      </div>

      {mode === "model_provider" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">
              {t("selectModelProvider")}
            </label>
            {kimiModelProviders.length > 0 ? (
              <Select
                value={
                  selectedProviderId != null ? String(selectedProviderId) : ""
                }
                onValueChange={(value) =>
                  setSelectedProviderId(value ? Number(value) : null)
                }
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectModelProvider")} />
                </SelectTrigger>
                <SelectContent align="start">
                  {kimiModelProviders.map((provider) => (
                    <SelectItem key={provider.id} value={String(provider.id)}>
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
                  saving || providerModelsLoading || selectedProviderId == null
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
              list="kimi-provider-model-options"
              value={selectedProviderModel}
              onChange={(event) => setSelectedProviderModel(event.target.value)}
              placeholder={t("selectProviderModel")}
              disabled={saving}
            />
            {providerModels.length > 0 && (
              <datalist id="kimi-provider-model-options">
                {providerModels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
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
        </div>
      )}

      {mode === "apikey" && (
        <>
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">
              {t("kimiCode.interfaceTypeLabel")}
            </label>
            <Select
              value={interfaceType}
              onValueChange={handleInterfaceChange}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {KIMI_INTERFACE_TYPES.map((it) => (
                  <SelectItem key={it.value} value={it.value}>
                    {it.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {t("kimiCode.interfaceTypeHint")}
            </p>
          </div>

          {isKimi ? (
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">
                {t("kimiCode.endpointLabel")}
              </label>
              <Select
                value={region}
                onValueChange={(value) =>
                  setRegion(value as KimiEndpointRegion)
                }
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="international">
                    {t("kimiCode.regionInternational")}
                  </SelectItem>
                  <SelectItem value="china">
                    {t("kimiCode.regionChina")}
                  </SelectItem>
                  <SelectItem value="custom">
                    {t("kimiCode.endpointCustom")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {region === "custom" && (
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.example.com/v1"
                  disabled={saving}
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                {t("kimiCode.endpointHint")}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">
                {t("kimiCode.baseUrlLabel")}
              </label>
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                disabled={saving}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("kimiCode.baseUrlHint")}
              </p>
            </div>
          )}

          {meta.usesApiKey ? (
            <>
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">
                  {t("kimiCode.apiKeyLabel")}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-..."
                    disabled={saving}
                  />
                  {keyToggle}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("kimiCode.apiKeyHint")}
                </p>
              </div>

              <details className="rounded-md border bg-background/40 p-2">
                <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                  {t("kimiCode.authTypeLabel")}
                </summary>
                <div className="mt-2 space-y-1.5">
                  <Select
                    value={authType}
                    onValueChange={(value) =>
                      setAuthType(value as KimiNativeAuthType)
                    }
                    disabled={saving}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="api_key">
                        {t("kimiCode.authTypeApiKey")}
                      </SelectItem>
                      <SelectItem value="env">
                        {t("kimiCode.authTypeEnv")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {t("kimiCode.authTypeHint")}
                  </p>
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">
                  {t("kimiCode.vertexProjectLabel")}
                </label>
                <Input
                  value={vertexProject}
                  onChange={(event) => setVertexProject(event.target.value)}
                  placeholder="my-gcp-project"
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">
                  {t("kimiCode.vertexLocationLabel")}
                </label>
                <Input
                  value={vertexLocation}
                  onChange={(event) => setVertexLocation(event.target.value)}
                  placeholder="us-central1"
                  disabled={saving}
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("kimiCode.vertexHint")}
                </p>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">
              {t("kimiCode.modelLabel")}
            </label>
            <div className="flex items-center gap-2">
              <Input
                list="kimi-model-options"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={KIMI_MODEL_PLACEHOLDER}
                disabled={saving}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleFetchModels()}
                disabled={saving || fetchingModels}
                className="shrink-0 gap-1.5"
              >
                {fetchingModels ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t("kimiCode.fetchModels")}
              </Button>
            </div>
            {models.length > 0 && (
              <datalist id="kimi-model-options">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
            <p className="text-[11px] text-muted-foreground">
              {t("kimiCode.modelHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">
              {t("kimiCode.maxContextLabel")}
            </label>
            <Input
              type="number"
              value={maxContext}
              onChange={(event) => setMaxContext(event.target.value)}
              placeholder="262144"
              disabled={saving}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("kimiCode.maxContextHint")}
            </p>
          </div>
        </>
      )}

      {mode === "login" && (
        <p className="text-[11px] text-muted-foreground">
          {t("kimiCode.loginHint")}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5"
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("actions.saving")}
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              {t("actions.saveKimiCodeConfig")}
            </>
          )}
        </Button>
      </div>

      <details className="rounded-md border bg-background/40 p-2">
        <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
          {t("kimiCode.rawEditorLabel")}
        </summary>
        <div className="mt-2 space-y-1.5">
          <Textarea
            value={rawConfig}
            onChange={(event) => setRawConfig(event.target.value)}
            placeholder={t("kimiCode.rawEditorPlaceholder")}
            className="min-h-[140px] font-mono text-[11px]"
            disabled={saving}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("kimiCode.rawEditorHint")}
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleSaveRaw}
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("actions.saving")}
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  {t("actions.saveKimiCodeRawConfig")}
                </>
              )}
            </Button>
          </div>
        </div>
      </details>
    </div>
  )
}
