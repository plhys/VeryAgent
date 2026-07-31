"use client"

import { ArrowUpCircle, Loader2, RotateCcw } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAppUpdate } from "@/components/providers/update-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Compact green affordance in the title bar (right of the theme toggle).
 * Visible only when a newer release is known, or while an install/restart is
 * already in flight so the user can finish without opening settings.
 */
export function TitleBarUpdateButton({ className }: { className?: string }) {
  const t = useTranslations("Folder.folderTitleBar")
  const update = useAppUpdate()
  if (!update) return null

  const {
    availableVersion,
    state,
    isBusy,
    isUpdating,
    isRestarting,
    restartCountdown,
    startUpdate,
    restart,
  } = update

  const ready = state.status === "ready_to_restart"
  const restarting =
    isRestarting || restartCountdown !== null || state.status === "restarting"
  const show =
    !!availableVersion ||
    ready ||
    isUpdating ||
    restarting ||
    state.status === "error"

  if (!show) return null

  const versionLabel = availableVersion
    ? `v${availableVersion.replace(/^v/i, "")}`
    : state.version
      ? `v${String(state.version).replace(/^v/i, "")}`
      : ""

  let title = t("updateAvailable", { version: versionLabel || "…" })
  let label = t("updateNow")
  let onClick: (() => void) | undefined = () => void startUpdate()
  let busy = isBusy && !ready

  if (ready) {
    title = t("restartToUpdate")
    label = t("restartToUpdate")
    onClick = () => void restart()
    busy = false
  } else if (restarting) {
    title = t("updating")
    label = t("updating")
    onClick = undefined
    busy = true
  } else if (isUpdating) {
    title = t("updating")
    label = t("updating")
    onClick = undefined
    busy = true
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy && !ready}
      onClick={onClick}
      title={title}
      className={cn(
        "h-7 gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 text-[11px] font-medium text-emerald-600 hover:bg-emerald-500/25 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 mt-2.5",
        className
      )}
    >
      {busy && !ready ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : ready ? (
        <RotateCcw className="h-3.5 w-3.5" />
      ) : (
        <ArrowUpCircle className="h-3.5 w-3.5" />
      )}
      <span className="max-w-[5.5rem] truncate">{label}</span>
    </Button>
  )
}
