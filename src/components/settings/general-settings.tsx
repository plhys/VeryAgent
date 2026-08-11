"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, MonitorCog, Pin, Power, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import {
  getAppAutostartEnabled,
  getPinnedSummaryEnabled,
  getSystemRenderingSettings,
  setAppAutostartEnabled,
  setPinnedSummaryEnabled,
  updateSystemRenderingSettings,
} from "@/lib/api"
import { isDesktop } from "@/lib/platform"
import { getActiveRemoteConnectionId } from "@/lib/transport"
import { usePlatform } from "@/hooks/use-platform"
import { relaunchApp } from "@/lib/updater"
import { toErrorMessage } from "@/lib/app-error"
import { DelegationSettingsSection } from "@/components/settings/delegation-settings"
import { SessionFeedbackSettingsSection } from "@/components/settings/session-feedback-settings"
import { AskQuestionSettingsSection } from "@/components/settings/ask-question-settings"
import { SessionInfoSettingsSection } from "@/components/settings/session-info-settings"

// Captured the first time the rendering section loads: represents the value
// the running webview process was launched with. Survives settings-shell
// remounts so the "Restart now" banner doesn't vanish if the user navigates
// away and back without restarting.
let processStartDisableHwAccel: boolean | null = null

export function GeneralSettings() {
  const t = useTranslations("GeneralSettings")
  const { isWindows } = usePlatform()

  // Rendering settings are a local Tauri preference (preferences.json). They
  // are only meaningful when the active transport is the local Tauri shell —
  // remote workspace windows route every API call to a remote web server,
  // which deliberately does not expose this endpoint.
  const renderingSettingsLoadable =
    isDesktop() && getActiveRemoteConnectionId() === null
  const renderingSectionVisible = renderingSettingsLoadable && isWindows
  const autostartSectionVisible = renderingSettingsLoadable

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [savingAutostart, setSavingAutostart] = useState(false)

  const [pinSummaryEnabled, setPinSummaryEnabled] = useState(false)
  const [savingPinSummary, setSavingPinSummary] = useState(false)

  const [disableHwAccel, setDisableHwAccel] = useState(false)
  const [savingRendering, setSavingRendering] = useState(false)
  const [persistedDisableHwAccel, setPersistedDisableHwAccel] = useState(false)
  const [processStartLoaded, setProcessStartLoaded] = useState(
    processStartDisableHwAccel !== null
  )
  const renderingDirty =
    processStartLoaded && persistedDisableHwAccel !== processStartDisableHwAccel

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const [renderingSettings, autostart, pinSummary] = await Promise.all([
        renderingSettingsLoadable
          ? getSystemRenderingSettings()
          : Promise.resolve(null),
        autostartSectionVisible
          ? getAppAutostartEnabled()
          : Promise.resolve(false),
        getPinnedSummaryEnabled(),
      ])

      if (renderingSettings) {
        const value = renderingSettings.disable_hardware_acceleration
        setDisableHwAccel(value)
        setPersistedDisableHwAccel(value)
        if (processStartDisableHwAccel === null) {
          processStartDisableHwAccel = value
          setProcessStartLoaded(true)
        }
      }

      setAutostartEnabled(autostart)
      setPinSummaryEnabled(pinSummary)
    } catch (err) {
      const message = toErrorMessage(err)
      setLoadError(message)
      console.error("[Settings] load general settings failed:", err)
    } finally {
      setLoading(false)
    }
  }, [autostartSectionVisible, renderingSettingsLoadable])

  useEffect(() => {
    loadSettings().catch((err) => {
      console.error("[Settings] load general settings failed:", err)
    })
  }, [loadSettings])

  const saveAutostartSetting = useCallback(
    async (next: boolean, prev: boolean) => {
      setSavingAutostart(true)
      try {
        const applied = await setAppAutostartEnabled(next)
        setAutostartEnabled(applied)
      } catch (err) {
        setAutostartEnabled(prev)
        const message = toErrorMessage(err)
        toast.error(t("autostartSaveFailed", { message }))
      } finally {
        setSavingAutostart(false)
      }
    },
    [t]
  )

  const savePinSummarySetting = useCallback(
    async (next: boolean, prev: boolean) => {
      setSavingPinSummary(true)
      try {
        await setPinnedSummaryEnabled(next)
        setPinSummaryEnabled(next)
      } catch (err) {
        setPinSummaryEnabled(prev)
        const message = toErrorMessage(err)
        toast.error(t("pinSummarySaveFailed", { message }))
      } finally {
        setSavingPinSummary(false)
      }
    },
    [t]
  )

  const saveRenderingSettings = useCallback(
    async (next: boolean, prev: boolean) => {
      setSavingRendering(true)
      try {
        const result = await updateSystemRenderingSettings({
          disable_hardware_acceleration: next,
        })
        setDisableHwAccel(result.disable_hardware_acceleration)
        setPersistedDisableHwAccel(result.disable_hardware_acceleration)
      } catch (err) {
        setDisableHwAccel(prev)
        const message = toErrorMessage(err)
        toast.error(t("renderingSaveFailed", { message }))
      } finally {
        setSavingRendering(false)
      }
    },
    [t]
  )

  const restartNow = useCallback(async () => {
    try {
      await relaunchApp()
    } catch (err) {
      const message = toErrorMessage(err)
      toast.error(t("restartFailed", { message }))
    }
  }, [t])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">
        <section className="space-y-1">
          <h1 className="text-sm font-semibold">{t("sectionTitle")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("sectionDescription")}
          </p>
        </section>

        {loadError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            {t("loadFailed", { message: loadError })}
          </div>
        )}

        {autostartSectionVisible && (
          <section className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Power className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("autostartTitle")}</h2>
            </div>

            <p className="text-xs text-muted-foreground leading-5">
              {t("autostartDescription")}
            </p>

            <div className="flex items-center justify-between gap-3">
              <label htmlFor="app-autostart" className="text-sm">
                {t("enableAutostart")}
              </label>
              <Switch
                id="app-autostart"
                checked={autostartEnabled}
                onCheckedChange={(next) => {
                  const prev = autostartEnabled
                  setAutostartEnabled(next)
                  saveAutostartSetting(next, prev)
                }}
                disabled={savingAutostart}
                className="shrink-0"
              />
            </div>
          </section>
        )}

        {renderingSectionVisible && (
          <section className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <MonitorCog className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("renderingTitle")}</h2>
            </div>

            <p className="text-xs text-muted-foreground leading-5">
              {t("renderingDescription")}
            </p>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={disableHwAccel}
                disabled={savingRendering}
                onChange={(event) => {
                  const next = event.target.checked
                  const prev = disableHwAccel
                  setDisableHwAccel(next)
                  saveRenderingSettings(next, prev)
                }}
              />
              {t("disableHardwareAcceleration")}
            </label>

            {renderingDirty && (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {t("restartRequired")}
                </span>
                <Button
                  size="sm"
                  onClick={restartNow}
                  disabled={savingRendering}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("restartNow")}
                </Button>
              </div>
            )}
          </section>
        )}

        <DelegationSettingsSection />

        <SessionFeedbackSettingsSection />

        <AskQuestionSettingsSection />

        <SessionInfoSettingsSection />

        {/* ── Pinned conversation summary toggle ── */}
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Pin className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("pinSummaryTitle")}</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-5">
            {t("pinSummaryDescription")}
          </p>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="pin-summary" className="text-sm">
              {t("enablePinSummary")}
            </label>
            <Switch
              id="pin-summary"
              checked={pinSummaryEnabled}
              onCheckedChange={(next) => {
                const prev = pinSummaryEnabled
                setPinSummaryEnabled(next)
                savePinSummarySetting(next, prev)
              }}
              disabled={savingPinSummary}
              className="shrink-0"
            />
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}
