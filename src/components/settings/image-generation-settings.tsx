"use client"

/**
 * Platform image-generation settings — multi gateway + priority + note.
 * Collapsed row: note · priority · model · enable switch (one line).
 * Expanded: API URL / Key / model fetch / delete.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import {
  ChevronDown,
  ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  type ImageGenerationSettings,
  type ImageGenerationConfig,
  type ImageGenerationModelItem,
  type ImageGatewayEntry,
  imageGenerationGetConfig,
  imageGenerationSaveConfig,
  imageGenerationFetchModels,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { cn } from "@/lib/utils"

function newGatewayId(): string {
  return `gw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Distinct left-border accent colors for gateway cards. */
const GATEWAY_COLORS = [
  "border-l-4 border-l-sky-500",
  "border-l-4 border-l-emerald-500",
  "border-l-4 border-l-violet-500",
  "border-l-4 border-l-amber-500",
  "border-l-4 border-l-rose-500",
  "border-l-4 border-l-cyan-500",
  "border-l-4 border-l-orange-500",
  "border-l-4 border-l-teal-500",
  "border-l-4 border-l-pink-500",
  "border-l-4 border-l-indigo-500",
]

function emptyGateway(priority = 0): ImageGatewayEntry {
  return {
    id: newGatewayId(),
    note: "",
    priority,
    enabled: true,
    api_url: "",
    api_key: "",
    model_name: "",
    default_size: "1024x1024",
  }
}

function sortGateways(list: ImageGatewayEntry[]): ImageGatewayEntry[] {
  return [...list].sort((a, b) => {
    const pa = Math.min(9, Math.max(0, a.priority | 0))
    const pb = Math.min(9, Math.max(0, b.priority | 0))
    if (pa !== pb) return pa - pb
    return a.id.localeCompare(b.id)
  })
}

function isGatewayComplete(g: ImageGatewayEntry): boolean {
  return (
    g.enabled &&
    !!g.api_url.trim() &&
    !!g.api_key.trim() &&
    !!g.model_name.trim()
  )
}

function configToGateways(config: ImageGenerationConfig): ImageGatewayEntry[] {
  if (Array.isArray(config.gateways) && config.gateways.length > 0) {
    return sortGateways(
      config.gateways.map((g) => ({
        id: g.id || newGatewayId(),
        note: g.note ?? "",
        priority: Math.min(9, Math.max(0, Number(g.priority) || 0)),
        enabled: g.enabled !== false,
        api_url: g.api_url ?? "",
        api_key: g.api_key ?? "",
        model_name: g.model_name ?? "",
        default_size: g.default_size || "1024x1024",
      }))
    )
  }
  // Legacy flat fields → single gateway.
  if (config.api_url || config.api_key || config.model_name) {
    return [
      {
        id: newGatewayId(),
        note: "",
        priority: 0,
        enabled: true,
        api_url: config.api_url || "",
        api_key: config.api_key || "",
        model_name: config.model_name || "",
        default_size: config.default_size || "1024x1024",
      },
    ]
  }
  return []
}

function shortModelLabel(model: string): string {
  const s = model.trim()
  if (!s) return "—"
  if (s.length <= 22) return s
  return `${s.slice(0, 10)}…${s.slice(-8)}`
}

export function ImageGenerationSettingsBody({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const t = useTranslations("ImageGenerationSettings")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [gateways, setGateways] = useState<ImageGatewayEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({})
  /** Models fetched per gateway id */
  const [modelsByGw, setModelsByGw] = useState<
    Record<string, ImageGenerationModelItem[]>
  >({})
  const [fallbackByGw, setFallbackByGw] = useState<Record<string, boolean>>({})
  const [fetchingGwId, setFetchingGwId] = useState<string | null>(null)
  /** Which gateway cards are expanded (default collapsed). */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void imageGenerationGetConfig()
      .then((config: ImageGenerationConfig) => {
        if (cancelled) return
        setEnabled(config.enabled)
        const list = configToGateways(config)
        setGateways(list)
        // Expand incomplete gateways so user can finish setup; collapse complete ones.
        const incomplete = list
          .filter(
            (g) => !g.api_url.trim() || !g.api_key.trim() || !g.model_name.trim()
          )
          .map((g) => g.id)
        setExpandedIds(new Set(incomplete))
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

  const sortedGateways = useMemo(() => sortGateways(gateways), [gateways])

  const updateGateway = useCallback(
    (id: string, patch: Partial<ImageGatewayEntry>) => {
      setGateways((prev) =>
        prev.map((g) => (g.id === id ? { ...g, ...patch } : g))
      )
      setValidationErrors((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${id}.`)) delete next[key]
        }
        return next
      })
    },
    []
  )

  const setExpanded = useCallback((id: string, open: boolean) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const addGateway = useCallback(() => {
    setGateways((prev) => {
      const used = new Set(prev.map((g) => g.priority))
      let p = 0
      while (p <= 9 && used.has(p)) p++
      if (p > 9) p = 9
      const gw = emptyGateway(p)
      setExpandedIds((ids) => new Set(ids).add(gw.id))
      return sortGateways([...prev, gw])
    })
  }, [])

  const removeGateway = useCallback((id: string) => {
    setGateways((prev) => prev.filter((g) => g.id !== id))
    setModelsByGw((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const fetchModelsFor = useCallback(
    async (gw: ImageGatewayEntry) => {
      const url = gw.api_url.trim()
      const key = gw.api_key.trim()
      if (!url || !key) {
        toast.error(t("fetchModelsNeedsCredentials"))
        return
      }
      setFetchingGwId(gw.id)
      try {
        const result = await imageGenerationFetchModels({
          apiUrl: url,
          apiKey: key,
        })
        setModelsByGw((prev) => ({ ...prev, [gw.id]: result.models }))
        setFallbackByGw((prev) => ({
          ...prev,
          [gw.id]: !!result.usedFallback,
        }))
        if (result.models.length === 0) {
          toast.message(t("fetchModelsEmpty"))
          return
        }
        const current = gw.model_name.trim()
        const inList =
          current && result.models.some((m) => m.id === current)
        if (!inList) {
          updateGateway(gw.id, { model_name: result.models[0].id })
        }
        toast.success(
          result.usedFallback
            ? t("fetchModelsOkFallback", { count: result.models.length })
            : t("fetchModelsOk", { count: result.models.length })
        )
      } catch (err: unknown) {
        toast.error(t("fetchModelsFailed"), {
          description: toErrorMessage(err),
        })
      } finally {
        setFetchingGwId(null)
      }
    },
    [t, updateGateway]
  )

  const save = useCallback(async () => {
    const errors: Record<string, string> = {}
    if (enabled) {
      const complete = gateways.filter(isGatewayComplete)
      if (complete.length === 0) {
        toast.error(t("needOneGateway"))
        return
      }
      for (const g of gateways) {
        if (!g.enabled) continue
        if (!g.api_url.trim()) errors[`${g.id}.apiUrl`] = t("requiredField")
        if (!g.api_key.trim()) errors[`${g.id}.apiKey`] = t("requiredField")
        if (!g.model_name.trim())
          errors[`${g.id}.modelName`] = t("requiredField")
      }
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors)
      // Auto-expand gateways with errors.
      setExpandedIds((prev) => {
        const next = new Set(prev)
        for (const key of Object.keys(errors)) {
          const id = key.split(".")[0]
          if (id) next.add(id)
        }
        return next
      })
      toast.error(t("validationFailed"))
      return
    }
    setValidationErrors({})

    const normalized = sortGateways(
      gateways.map((g) => ({
        ...g,
        priority: Math.min(9, Math.max(0, Number(g.priority) || 0)),
        note: g.note.trim(),
        api_url: g.api_url.trim(),
        model_name: g.model_name.trim(),
        default_size: g.default_size.trim() || "1024x1024",
      }))
    )
    const primary = normalized.find(isGatewayComplete) ?? normalized[0]

    const payload: ImageGenerationSettings = {
      enabled,
      gateways: normalized,
      api_url: primary?.api_url ?? "",
      api_key: primary?.api_key ?? "",
      model_name: primary?.model_name ?? "",
      default_size: primary?.default_size || "1024x1024",
    }
    setSaving(true)
    try {
      const { config: applied, affectedRunningSessions } =
        await imageGenerationSaveConfig(payload)
      setEnabled(applied.enabled)
      setGateways(configToGateways(applied))
      toast.success(t("saved"))
      if (affectedRunningSessions > 0) {
        toast.info(
          t("affectedRunningSessions", { count: affectedRunningSessions })
        )
      }
    } catch (err: unknown) {
      toast.error(t("saveFailed"), { description: toErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }, [enabled, gateways, t])

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

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{t("title")}</h2>
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          {t("description")}
        </p>

        <label className="flex items-center gap-2">
          <Switch
            id="image-generation-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={loading}
          />
          <span className="text-xs text-muted-foreground">{t("enable")}</span>
        </label>
        <p className="text-[11px] text-muted-foreground">{t("enableHint")}</p>
      </section>

      {enabled && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("gatewaysTitle")}</h2>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={addGateway}
              disabled={loading || saving}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("addGateway")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("gatewaysHint")}</p>

          {sortedGateways.length === 0 && (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              {t("gatewayEmpty")}
            </p>
          )}

          <div className="space-y-2">
            {sortedGateways.map((gw, index) => {
              const models = modelsByGw[gw.id] ?? []
              const usedFallback = fallbackByGw[gw.id]
              const modelSelectValue = gw.model_name.trim()
                ? gw.model_name
                : undefined
              const fetching = fetchingGwId === gw.id
              const open = expandedIds.has(gw.id)
              const noteLabel =
                gw.note.trim() || t("gatewayNotePlaceholder")
              const hasErr =
                !!validationErrors[`${gw.id}.apiUrl`] ||
                !!validationErrors[`${gw.id}.apiKey`] ||
                !!validationErrors[`${gw.id}.modelName`]

              return (
                <Collapsible
                  key={gw.id}
                  open={open}
                  onOpenChange={(v) => setExpanded(gw.id, v)}
                >
                  <div
                    className={cn(
                      "rounded-lg border bg-muted/20",
                      GATEWAY_COLORS[index % GATEWAY_COLORS.length],
                      !gw.enabled && "opacity-60",
                      hasErr && "border-destructive/50"
                    )}
                  >
                    {/* Collapsed header: one compact row */}
                    <div className="flex h-10 items-center gap-1.5 px-2">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={open ? t("collapseGateway") : t("expandGateway")}
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform",
                              open && "rotate-180"
                            )}
                          />
                        </button>
                      </CollapsibleTrigger>

                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                        #{index + 1}
                      </span>

                      {/* Note — truncated, click expands if empty */}
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-xs",
                          gw.note.trim()
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        )}
                        title={noteLabel}
                      >
                        {noteLabel}
                      </span>

                      {/* Priority 0–9 on the collapsed row */}
                      <Select
                        value={String(
                          Math.min(9, Math.max(0, gw.priority | 0))
                        )}
                        onValueChange={(v) =>
                          updateGateway(gw.id, {
                            priority: Number(v) as number,
                          })
                        }
                        disabled={loading || saving}
                      >
                        <SelectTrigger
                          className="h-7 w-[3.25rem] shrink-0 px-1.5 text-[11px]"
                          title={t("gatewayPriorityHint")}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 10 }, (_, i) => (
                            <SelectItem key={i} value={String(i)}>
                              P{i}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Model label on one line */}
                      <span
                        className="hidden max-w-[9rem] shrink-0 truncate rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline"
                        title={gw.model_name || t("modelNamePlaceholder")}
                      >
                        {shortModelLabel(gw.model_name)}
                      </span>

                      {/* Enable / disable */}
                      <Switch
                        checked={gw.enabled}
                        onCheckedChange={(v) =>
                          updateGateway(gw.id, { enabled: v })
                        }
                        disabled={loading || saving}
                        className="shrink-0 scale-90"
                        title={t("gatewayEnabled")}
                        aria-label={t("gatewayEnabled")}
                      />
                    </div>

                    <CollapsibleContent>
                      <div className="space-y-3 border-t px-3 pb-3 pt-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                          <div className="space-y-1.5">
                            <label className="text-[11px] font-medium text-muted-foreground">
                              {t("gatewayNote")}
                            </label>
                            <Input
                              value={gw.note}
                              onChange={(e) =>
                                updateGateway(gw.id, {
                                  note: e.target.value,
                                })
                              }
                              placeholder={t("gatewayNotePlaceholder")}
                              disabled={loading || saving}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="space-y-1.5">
                              <label className="text-[11px] font-medium text-muted-foreground">
                                {t("gatewayPriority")}
                              </label>
                              <Select
                                value={String(
                                  Math.min(9, Math.max(0, gw.priority | 0))
                                )}
                                onValueChange={(v) =>
                                  updateGateway(gw.id, {
                                    priority: Number(v) as number,
                                  })
                                }
                                disabled={loading || saving}
                              >
                                <SelectTrigger className="h-8 w-16 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Array.from({ length: 10 }, (_, i) => (
                                    <SelectItem key={i} value={String(i)}>
                                      {i}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <label className="flex items-center gap-1.5 pb-0.5 text-[11px] text-muted-foreground">
                              <Switch
                                checked={gw.enabled}
                                onCheckedChange={(v) =>
                                  updateGateway(gw.id, { enabled: v })
                                }
                                disabled={loading || saving}
                              />
                              {t("gatewayEnabled")}
                            </label>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {t("gatewayPriorityHint")}
                        </p>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-medium text-muted-foreground">
                            {t("apiUrl")}
                          </label>
                          <Input
                            placeholder={t("apiUrlPlaceholder")}
                            value={gw.api_url}
                            onChange={(e) =>
                              updateGateway(gw.id, {
                                api_url: e.target.value,
                              })
                            }
                            disabled={loading || saving}
                            className={cn(
                              "h-8 text-xs",
                              validationErrors[`${gw.id}.apiUrl`] &&
                                "border-destructive"
                            )}
                          />
                          {validationErrors[`${gw.id}.apiUrl`] && (
                            <p className="text-xs text-destructive">
                              {validationErrors[`${gw.id}.apiUrl`]}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-medium text-muted-foreground">
                            {t("apiKey")}
                          </label>
                          <Input
                            type="password"
                            placeholder={t("apiKeyPlaceholder")}
                            value={gw.api_key}
                            onChange={(e) =>
                              updateGateway(gw.id, {
                                api_key: e.target.value,
                              })
                            }
                            disabled={loading || saving}
                            className={cn(
                              "h-8 text-xs",
                              validationErrors[`${gw.id}.apiKey`] &&
                                "border-destructive"
                            )}
                          />
                          {validationErrors[`${gw.id}.apiKey`] && (
                            <p className="text-xs text-destructive">
                              {validationErrors[`${gw.id}.apiKey`]}
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[11px] font-medium text-muted-foreground">
                              {t("modelName")}
                            </label>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[11px]"
                              onClick={() => void fetchModelsFor(gw)}
                              disabled={loading || saving || fetching}
                            >
                              {fetching ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  {t("fetchingModels")}
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-3 w-3" />
                                  {t("fetchModels")}
                                </>
                              )}
                            </Button>
                          </div>

                          {models.length > 0 ? (
                            <Select
                              value={modelSelectValue}
                              onValueChange={(value) =>
                                updateGateway(gw.id, { model_name: value })
                              }
                              disabled={loading || saving}
                            >
                              <SelectTrigger
                                className={cn(
                                  "h-8 w-full text-xs",
                                  validationErrors[`${gw.id}.modelName`] &&
                                    "border-destructive"
                                )}
                              >
                                <SelectValue
                                  placeholder={t("modelNamePlaceholder")}
                                />
                              </SelectTrigger>
                              <SelectContent align="start">
                                {gw.model_name &&
                                  !models.some(
                                    (m) => m.id === gw.model_name
                                  ) && (
                                    <SelectItem value={gw.model_name}>
                                      {gw.model_name}
                                    </SelectItem>
                                  )}
                                {models.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>
                                    {m.name || m.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              placeholder={t("modelNamePlaceholder")}
                              value={gw.model_name}
                              onChange={(e) =>
                                updateGateway(gw.id, {
                                  model_name: e.target.value,
                                })
                              }
                              disabled={loading || saving}
                              className={cn(
                                "h-8 w-full text-xs",
                                validationErrors[`${gw.id}.modelName`] &&
                                  "border-destructive"
                              )}
                            />
                          )}
                          {validationErrors[`${gw.id}.modelName`] && (
                            <p className="text-xs text-destructive">
                              {validationErrors[`${gw.id}.modelName`]}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground">
                            {models.length > 0
                              ? usedFallback
                                ? t("modelListFallbackHint")
                                : t("modelListHint")
                              : t("fetchModelsHint")}
                          </p>
                        </div>

                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => removeGateway(gw.id)}
                            disabled={loading || saving}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("removeGateway")}
                          </Button>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">{t("sizeHint")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("restartHint")}
          </p>
        </section>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={loading || saving}
        >
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
    </>
  )

  if (embedded) return body

  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">{body}</div>
    </ScrollArea>
  )
}

export function ImageGenerationSettings() {
  return <ImageGenerationSettingsBody />
}
