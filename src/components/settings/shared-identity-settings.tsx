"use client"

/**
 * Shared identity + preferences settings — the VeryAgent "body" layer.
 *
 * Structured fields (agent name, how to address the user) plus free-form notes
 * are injected once on the first user prompt for brains the user opts in.
 * Storage root can be pointed at a durable folder so data survives reinstall.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Brain, FolderOpen, Loader2, RotateCcw, UserRound } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  type SharedIdentitySettings,
  type SharedProfile,
  type SharingConfig,
  getSharedIdentitySettings,
  setSharedIdentitySettings,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { openFileDialog, subscribe } from "@/lib/platform"
import {
  AGENT_LABELS,
  ALL_AGENT_TYPES,
  SHARED_IDENTITY_SETTINGS_CHANGED_EVENT,
  type AgentType,
} from "@/lib/types"

export function SharedIdentitySettingsPanel() {
  const t = useTranslations("SharedIdentitySettings")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [agentName, setAgentName] = useState("")
  const [userAddress, setUserAddress] = useState("")
  const [notes, setNotes] = useState("")
  const [identityPath, setIdentityPath] = useState("")

  const [enabled, setEnabled] = useState(false)
  const [agents, setAgents] = useState<Record<string, boolean>>({})
  const [maxChars, setMaxChars] = useState(2000)

  const [storageRoot, setStorageRoot] = useState("")
  const [defaultStorageRoot, setDefaultStorageRoot] = useState("")
  const [storageIsCustom, setStorageIsCustom] = useState(false)
  /** Last applied effective root — only send storage_root when the user changes it. */
  const [savedStorageRoot, setSavedStorageRoot] = useState("")
  const [savedStorageIsCustom, setSavedStorageIsCustom] = useState(false)

  const applySettings = useCallback((s: SharedIdentitySettings) => {
    setAgentName(s.profile.agent_name ?? "")
    setUserAddress(s.profile.user_address ?? "")
    setNotes(s.profile.notes ?? "")
    setIdentityPath(s.profile.path ?? "")
    setEnabled(s.sharing.enabled)
    setAgents({ ...s.sharing.agents })
    setMaxChars(s.sharing.max_chars)
    const root = s.storage_root ?? s.profile.storage_root ?? ""
    const custom = !!s.storage_is_custom
    setStorageRoot(root)
    setDefaultStorageRoot(
      s.default_storage_root ?? s.profile.default_storage_root ?? ""
    )
    setStorageIsCustom(custom)
    setSavedStorageRoot(root)
    setSavedStorageIsCustom(custom)
    setLoadError(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    void getSharedIdentitySettings()
      .then((s) => {
        if (cancelled) return
        applySettings(s)
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
  }, [applySettings])

  useEffect(() => {
    let unsub: (() => void) | undefined
    let cancelled = false
    void subscribe<SharedIdentitySettings>(
      SHARED_IDENTITY_SETTINGS_CHANGED_EVENT,
      (s) => {
        if (cancelled) return
        applySettings(s)
      }
    )
      .then((fn) => {
        if (cancelled) {
          fn()
          return
        }
        unsub = fn
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [applySettings])

  const agentRows = useMemo(
    () =>
      ALL_AGENT_TYPES.map((key: AgentType) => ({
        key,
        label: AGENT_LABELS[key] ?? key,
        on: agents[key] ?? false,
      })),
    [agents]
  )

  const toggleAgent = useCallback((key: string, on: boolean) => {
    setAgents((prev) => ({ ...prev, [key]: on }))
  }, [])

  const pickStorageDir = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        directory: true,
        multiple: false,
        title: t("pickStorageTitle"),
        defaultPath: storageRoot || defaultStorageRoot || undefined,
      })
      if (typeof picked === "string" && picked.trim()) {
        setStorageRoot(picked)
        setStorageIsCustom(true)
      }
    } catch (err: unknown) {
      toast.error(t("pickStorageFailed"), { description: toErrorMessage(err) })
    }
  }, [defaultStorageRoot, storageRoot, t])

  const resetStorageDir = useCallback(() => {
    setStorageRoot(defaultStorageRoot)
    setStorageIsCustom(false)
  }, [defaultStorageRoot])

  const save = useCallback(async () => {
    const profile: SharedProfile = {
      agent_name: agentName.trim(),
      user_address: userAddress.trim(),
      notes,
      path: identityPath,
      storage_root: storageRoot,
      default_storage_root: defaultStorageRoot,
    }
    const sharing: SharingConfig = {
      enabled,
      agents: { ...agents },
      max_chars: Math.max(
        200,
        Math.min(8000, Number.isFinite(maxChars) ? maxChars : 2000)
      ),
    }
    const storageChanged =
      storageIsCustom !== savedStorageIsCustom ||
      storageRoot.trim() !== savedStorageRoot.trim()

    setSaving(true)
    try {
      const applied = await setSharedIdentitySettings({
        profile,
        sharing,
        // Empty string resets to default; omit when unchanged.
        ...(storageChanged
          ? { storage_root: storageIsCustom ? storageRoot.trim() : "" }
          : {}),
      })
      applySettings(applied)
      toast.success(t("saved"))
    } catch (err: unknown) {
      toast.error(t("saveFailed"), { description: toErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }, [
    agentName,
    agents,
    applySettings,
    defaultStorageRoot,
    enabled,
    identityPath,
    maxChars,
    notes,
    savedStorageIsCustom,
    savedStorageRoot,
    storageIsCustom,
    storageRoot,
    t,
    userAddress,
  ])

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6 pb-10">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <UserRound className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground leading-6">
              {t("description")}
            </p>
          </div>
        </div>

        {loadError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {t("loadFailed", { detail: loadError })}
          </p>
        )}

        {/* Identity fields */}
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t("profileTitle")}</h2>
            <p className="text-xs text-muted-foreground leading-5">
              {t("profileHint")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="shared-agent-name" className="text-sm font-medium">
                {t("agentName")}
              </label>
              <Input
                id="shared-agent-name"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                disabled={loading}
                placeholder={t("agentNamePlaceholder")}
                maxLength={80}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("agentNameHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="shared-user-address"
                className="text-sm font-medium"
              >
                {t("userAddress")}
              </label>
              <Input
                id="shared-user-address"
                value={userAddress}
                onChange={(e) => setUserAddress(e.target.value)}
                disabled={loading}
                placeholder={t("userAddressPlaceholder")}
                maxLength={80}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("userAddressHint")}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="shared-notes" className="text-sm font-medium">
              {t("notes")}
            </label>
            <Textarea
              id="shared-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={loading}
              rows={8}
              className="text-sm leading-5 min-h-[140px]"
              placeholder={t("notesPlaceholder")}
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">{t("notesHint")}</p>
          </div>
        </section>

        {/* Storage location */}
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t("storageTitle")}</h2>
            <p className="text-xs text-muted-foreground leading-5">
              {t("storageHint")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={storageRoot}
              onChange={(e) => {
                setStorageRoot(e.target.value)
                setStorageIsCustom(
                  e.target.value.trim() !== "" &&
                    e.target.value.trim() !== defaultStorageRoot
                )
              }}
              disabled={loading}
              className="font-mono text-xs"
              spellCheck={false}
              aria-label={t("storageTitle")}
            />
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void pickStorageDir()}
                disabled={loading}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t("pickStorage")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetStorageDir}
                disabled={loading || !storageIsCustom}
                title={t("resetStorage")}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("resetStorage")}
              </Button>
            </div>
          </div>
          {identityPath ? (
            <p className="text-[11px] text-muted-foreground/80 font-mono break-all">
              {t("identityFile")}: {identityPath}
            </p>
          ) : null}
        </section>

        {/* Sharing */}
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">{t("sharingTitle")}</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-5">
            {t("sharingHint")}
          </p>

          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <label
                htmlFor="shared-identity-enabled"
                className="text-sm font-medium"
              >
                {t("enable")}
              </label>
              <p className="text-xs text-muted-foreground">{t("enableHint")}</p>
            </div>
            <Switch
              id="shared-identity-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={loading}
              className="shrink-0"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("agentsTitle")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {agentRows.map((row) => (
                <label
                  key={row.key}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 cursor-pointer hover:bg-muted/40"
                >
                  <span className="text-sm truncate">{row.label}</span>
                  <Switch
                    checked={row.on}
                    onCheckedChange={(on) => toggleAgent(row.key, on)}
                    disabled={loading || !enabled}
                    aria-label={row.label}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <label
                htmlFor="shared-identity-max-chars"
                className="text-sm font-medium"
              >
                {t("maxChars")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("maxCharsHint")}
              </p>
            </div>
            <Input
              id="shared-identity-max-chars"
              type="number"
              min={200}
              max={8000}
              step={100}
              value={maxChars}
              onChange={(e) => setMaxChars(Number(e.target.value) || 2000)}
              disabled={loading}
              className="w-28 shrink-0"
            />
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={save} disabled={loading || saving} size="sm">
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
      </div>
    </ScrollArea>
  )
}
