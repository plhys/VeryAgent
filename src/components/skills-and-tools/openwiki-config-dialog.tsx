"use client"

/**
 * OpenWiki configuration dialog for the first-party plugin card.
 * Agent enable/disable stays on the card switch; this dialog only edits
 * inject options, paths, workspace ops, and INSTRUCTIONS.md.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  BookOpen,
  Download,
  Loader2,
  RefreshCw,
  Rocket,
  Server,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useNpmInstallStream } from "@/hooks/use-npm-install-stream"
import {
  type OpenWikiConfig,
  type OpenWikiStatus,
  listOpenFolderDetails,
  npmInstallCli,
  npmUninstallCli,
  openwikiGetConfig,
  openwikiGetInstructions,
  openwikiRun,
  openwikiSaveConfig,
  openwikiSaveInstructions,
  openwikiStatus,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import type { FolderDetail } from "@/lib/types"
import { randomUUID } from "@/lib/utils"

function defaultConfig(): OpenWikiConfig {
  return {
    enabled: false,
    modes: { code: true, personal: false },
    agent_types_list: [],
    agent_permissions: [],
    inject: {
      on_session_start: true,
      inject_agents_md: false,
      inject_mode: "summary_and_path",
    },
    auto_update: {
      enabled: false,
      on_git_change: false,
      schedule_cron: null,
    },
    model: {
      use_openwiki_env: true,
      provider: null,
      model_id: null,
      api_key: "",
      base_url: null,
    },
    paths: {
      code_wiki_dirname: "openwiki",
      personal_wiki_root: null,
      executable: "",
    },
    commands: {
      allow_init: true,
      allow_update: true,
      allow_chat: false,
      allow_ingest: false,
      allow_cron: false,
      allow_auth: false,
      advanced_enabled: false,
    },
    ignore_patterns: [],
  }
}

export interface OpenWikiConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preferred workspace path (current conversation workingDir). */
  workspaceHint?: string | null
  onSaved?: () => void
}

export function OpenWikiConfigDialog({
  open,
  onOpenChange,
  workspaceHint,
  onSaved,
}: OpenWikiConfigDialogProps) {
  const t = useTranslations("OpenWikiSettings")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<"init" | "update" | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [config, setConfig] = useState<OpenWikiConfig>(defaultConfig)
  const [status, setStatus] = useState<OpenWikiStatus | null>(null)
  const [folders, setFolders] = useState<FolderDetail[]>([])
  const [workspace, setWorkspace] = useState("")
  const [instructions, setInstructions] = useState("")
  const [instructionsPath, setInstructionsPath] = useState("")
  const [instructionsDirty, setInstructionsDirty] = useState(false)
  const [savingInstructions, setSavingInstructions] = useState(false)
  const [installingCli, setInstallingCli] = useState(false)
  const [uninstallingCli, setUninstallingCli] = useState(false)
  const installStream = useNpmInstallStream("app://openwiki-install")
  const installLogEndRef = useRef<HTMLDivElement | null>(null)

  const refreshStatus = useCallback(async (ws: string | null) => {
    try {
      const st = await openwikiStatus(ws)
      setStatus(st)
    } catch {
      // Status is best-effort.
    }
  }, [])

  const loadInstructions = useCallback(async (ws: string) => {
    if (!ws) {
      setInstructions("")
      setInstructionsPath("")
      setInstructionsDirty(false)
      return
    }
    try {
      const body = await openwikiGetInstructions(ws)
      setInstructions(body.content)
      setInstructionsPath(body.path)
      setInstructionsDirty(false)
    } catch {
      setInstructions("")
      setInstructionsPath("")
      setInstructionsDirty(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const [cfg, openFolders] = await Promise.all([
          openwikiGetConfig(),
          listOpenFolderDetails().catch(() => [] as FolderDetail[]),
        ])
        if (cancelled) return
        setConfig(cfg)
        setFolders(openFolders)
        const hint = workspaceHint?.trim() || ""
        const first =
          (hint && openFolders.some((f) => f.path === hint) ? hint : "") ||
          hint ||
          openFolders[0]?.path ||
          ""
        setWorkspace(first)
        await refreshStatus(first || null)
        if (first) await loadInstructions(first)
        setLoadError(null)
      } catch (err: unknown) {
        if (cancelled) return
        setLoadError(toErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadInstructions, open, refreshStatus, workspaceHint])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      // Card switch may change grants while the dialog is open; only write
      // the shared plugin options this dialog owns.
      const latest = await openwikiGetConfig()
      const next: OpenWikiConfig = {
        ...latest,
        inject: config.inject,
        paths: {
          ...latest.paths,
          code_wiki_dirname: config.paths.code_wiki_dirname,
          executable: config.paths.executable,
        },
      }
      const applied = await openwikiSaveConfig(next)
      setConfig(applied)
      await refreshStatus(workspace || null)
      toast.success(t("saved"))
      onSaved?.()
    } catch (err: unknown) {
      toast.error(t("saveFailed"), { description: toErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }, [config, onSaved, refreshStatus, t, workspace])

  const runAction = useCallback(
    async (action: "code_init" | "code_update") => {
      if (!workspace) {
        toast.error(t("workspaceRequired"))
        return
      }
      setRunning(action === "code_init" ? "init" : "update")
      try {
        const result = await openwikiRun(action, workspace)
        if (result.success) {
          toast.success(
            action === "code_init" ? t("initSuccess") : t("updateSuccess")
          )
        } else {
          toast.error(
            action === "code_init" ? t("initFailed") : t("updateFailed"),
            {
              description:
                result.stderr.trim() ||
                result.stdout.trim() ||
                `exit ${result.exit_code ?? "?"}`,
            }
          )
        }
        await refreshStatus(workspace)
        await loadInstructions(workspace)
      } catch (err: unknown) {
        toast.error(
          action === "code_init" ? t("initFailed") : t("updateFailed"),
          { description: toErrorMessage(err) }
        )
      } finally {
        setRunning(null)
      }
    },
    [loadInstructions, refreshStatus, t, workspace]
  )

  const saveInstructions = useCallback(async () => {
    if (!workspace) {
      toast.error(t("workspaceRequired"))
      return
    }
    setSavingInstructions(true)
    try {
      const body = await openwikiSaveInstructions(workspace, instructions)
      setInstructions(body.content)
      setInstructionsPath(body.path)
      setInstructionsDirty(false)
      toast.success(t("instructionsSaved"))
    } catch (err: unknown) {
      toast.error(t("instructionsSaveFailed"), {
        description: toErrorMessage(err),
      })
    } finally {
      setSavingInstructions(false)
    }
  }, [instructions, t, workspace])

  // Keep install log scrolled to the latest line.
  useEffect(() => {
    const container = installLogEndRef.current?.parentElement
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [installStream.logs])

  // Drop the install subscription when the dialog closes / unmounts.
  useEffect(() => {
    if (!open) {
      installStream.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to open
  }, [open])

  useEffect(() => {
    return () => installStream.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installCli = useCallback(async () => {
    setInstallingCli(true)
    const taskId = randomUUID()
    // Subscribe before invoke so early Started/Progress lines are not missed.
    await installStream.start(taskId)
    try {
      const result = await npmInstallCli({
        packageName: "openwiki",
        binaryName: "openwiki",
        eventChannel: "app://openwiki-install",
        taskId,
        includeOptional: true,
      })
      // Always settle the bar even if the Completed event was dropped.
      installStream.forceComplete(result.message || result.executablePath || undefined)
      if (result.executablePath) {
        setConfig((prev) => {
          if (prev.paths.executable.trim()) return prev
          return {
            ...prev,
            paths: { ...prev.paths, executable: result.executablePath ?? "" },
          }
        })
      }
      try {
        const latest = await openwikiGetConfig()
        setConfig(latest)
      } catch {
        // best-effort
      }
      await refreshStatus(workspace || null)
      toast.success(t("installCliSuccess"), {
        description: result.executablePath || result.message,
      })
    } catch (err: unknown) {
      const message = toErrorMessage(err)
      installStream.forceFail(message)
      toast.error(t("installCliFailed"), {
        description: message,
      })
    } finally {
      setInstallingCli(false)
    }
    // installStream helpers are stable; status fields re-render via the hook itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installStream.start, installStream.forceComplete, installStream.forceFail, refreshStatus, t, workspace])

  const uninstallCli = useCallback(async () => {
    setUninstallingCli(true)
    try {
      const result = await npmUninstallCli({
        packageName: "openwiki",
        binaryName: "openwiki",
      })
      // Clear local executable path when the binary is gone.
      setConfig((prev) => ({
        ...prev,
        paths: { ...prev.paths, executable: "" },
      }))
      try {
        const latest = await openwikiGetConfig()
        setConfig(latest)
      } catch {
        // best-effort
      }
      await refreshStatus(workspace || null)
      if (result.success && !result.executablePath) {
        toast.success(t("uninstallCliSuccess"), {
          description: result.message,
        })
      } else {
        toast.error(t("uninstallCliFailed"), {
          description: result.message,
        })
      }
    } catch (err: unknown) {
      toast.error(t("uninstallCliFailed"), {
        description: toErrorMessage(err),
      })
    } finally {
      setUninstallingCli(false)
    }
  }, [refreshStatus, t, workspace])

  const showInstallProgress =
    installingCli ||
    installStream.status === "running" ||
    installStream.status === "success" ||
    installStream.status === "failed"

  const cliBusy = installingCli || uninstallingCli

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(34rem,calc(100dvh-2rem))] w-full max-w-[min(42rem,calc(100vw-2rem))] flex-col gap-3 overflow-hidden p-5 sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-1 pr-8">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-primary" aria-hidden />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="line-clamp-2 text-xs">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
            {loadError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {t("loadFailed", { detail: loadError })}
              </p>
            ) : null}

            {status ? (
              <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-xs font-medium">{status.message}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {t("executable")}:{" "}
                      {status.executable_found
                        ? status.executable_path || t("found")
                        : t("missing")}
                      {" · "}
                      {t("wiki")}:{" "}
                      {status.wiki_exists
                        ? status.wiki_path || t("ready")
                        : t("notInitialized")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!status.executable_found ||
                    installStream.status === "failed" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => void installCli()}
                        disabled={cliBusy || !!running || saving}
                      >
                        {installingCli ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {installingCli ? t("installingCli") : t("installCli")}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => void uninstallCli()}
                        disabled={cliBusy || !!running || saving}
                      >
                        {uninstallingCli ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {uninstallingCli
                          ? t("uninstallingCli")
                          : t("uninstallCli")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-7 w-7 shrink-0"
                      title={t("refreshStatus")}
                      aria-label={t("refreshStatus")}
                      onClick={() => void refreshStatus(workspace || null)}
                      disabled={!!running || cliBusy}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {showInstallProgress ? (
                  <div className="space-y-1.5 border-t border-border/60 pt-2">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {installStream.label ||
                          (installStream.status === "failed"
                            ? t("installCliFailed")
                            : installStream.status === "success"
                              ? t("installCliSuccess")
                              : t("installingCli"))}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {installStream.percent}%
                      </span>
                    </div>
                    <Progress
                      value={installStream.percent}
                      className="h-1.5"
                      aria-label={t("installProgress")}
                    />
                    {installStream.logs.length > 0 ? (
                      <div className="max-h-24 overflow-y-auto rounded-md border bg-background/80 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {installStream.logs.map((line, i) => (
                          <div
                            key={`${i}-${line.slice(0, 24)}`}
                            className={
                              line.startsWith("ERROR:")
                                ? "text-destructive"
                                : undefined
                            }
                          >
                            {line}
                          </div>
                        ))}
                        <div ref={installLogEndRef} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <section className="space-y-2.5 rounded-lg border p-3">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold">
                  <Server className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("injectTitle")}
                </h2>
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs font-normal leading-snug">
                    {t("injectOnStart")}
                  </Label>
                  <Switch
                    checked={config.inject.on_session_start}
                    onCheckedChange={(on_session_start) =>
                      setConfig((prev) => ({
                        ...prev,
                        inject: { ...prev.inject, on_session_start },
                      }))
                    }
                    disabled={saving}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-xs font-normal leading-snug">
                    {t("injectAgentsMd")}
                  </Label>
                  <Switch
                    checked={config.inject.inject_agents_md}
                    onCheckedChange={(inject_agents_md) =>
                      setConfig((prev) => ({
                        ...prev,
                        inject: { ...prev.inject, inject_agents_md },
                      }))
                    }
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="openwiki-dirname" className="text-xs">
                    {t("wikiDirname")}
                  </Label>
                  <Input
                    id="openwiki-dirname"
                    className="h-8 text-xs"
                    value={config.paths.code_wiki_dirname}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        paths: {
                          ...prev.paths,
                          code_wiki_dirname: e.target.value,
                        },
                      }))
                    }
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="openwiki-exe" className="text-xs">
                    {t("executablePath")}
                  </Label>
                  <Input
                    id="openwiki-exe"
                    className="h-8 text-xs"
                    placeholder={t("executablePlaceholder")}
                    value={config.paths.executable}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        paths: { ...prev.paths, executable: e.target.value },
                      }))
                    }
                    disabled={saving}
                  />
                </div>
              </section>

              <section className="flex min-h-0 flex-col gap-2.5 rounded-lg border p-3">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold">
                  <Rocket className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("workspaceTitle")}
                </h2>
                <div className="space-y-1.5">
                  <Label htmlFor="openwiki-workspace" className="text-xs">
                    {t("workspace")}
                  </Label>
                  {folders.length > 0 ? (
                    <select
                      id="openwiki-workspace"
                      className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-sm"
                      value={workspace}
                      onChange={(e) => {
                        const next = e.target.value
                        setWorkspace(next)
                        void refreshStatus(next || null)
                        void loadInstructions(next)
                      }}
                      disabled={!!running}
                    >
                      {folders.map((f) => (
                        <option key={f.id} value={f.path}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="openwiki-workspace"
                      className="h-8 text-xs"
                      placeholder={t("workspacePlaceholder")}
                      value={workspace}
                      onChange={(e) => setWorkspace(e.target.value)}
                      disabled={!!running}
                    />
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2.5 text-xs"
                    disabled={!workspace || !!running || !config.commands.allow_init}
                    onClick={() => void runAction("code_init")}
                  >
                    {running === "init" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {t("init")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2.5 text-xs"
                    disabled={
                      !workspace || !!running || !config.commands.allow_update
                    }
                    onClick={() => void runAction("code_update")}
                  >
                    {running === "update" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {t("update")}
                  </Button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-t pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="truncate text-xs">
                      {t("instructionsTitle")}
                    </Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={
                        !workspace ||
                        !instructionsDirty ||
                        savingInstructions ||
                        !!running
                      }
                      onClick={() => void saveInstructions()}
                    >
                      {savingInstructions ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {t("saveInstructions")}
                    </Button>
                  </div>
                  {instructionsPath ? (
                    <p className="truncate text-[10px] text-muted-foreground">
                      {instructionsPath}
                    </p>
                  ) : null}
                  <Textarea
                    value={instructions}
                    onChange={(e) => {
                      setInstructions(e.target.value)
                      setInstructionsDirty(true)
                    }}
                    disabled={!workspace || savingInstructions}
                    rows={5}
                    placeholder={t("instructionsPlaceholder")}
                    className="min-h-[6.5rem] flex-1 resize-none font-mono text-[11px] leading-snug"
                  />
                </div>
              </section>
            </div>
          </div>
        )}

        <DialogFooter className="shrink-0 gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving || !!running}
          >
            {t("close")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={loading || saving || !!running}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
