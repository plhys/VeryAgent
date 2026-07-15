"use client"

/**
 * OpenWiki settings page — Code Wiki knowledge layer for authorized agents.
 *
 * Opt-in master switch, per-agent read grants, session inject options,
 * init/update runner, and optional INSTRUCTIONS.md edit for the active workspace.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { BookOpen, Loader2, RefreshCw, Rocket, Server } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  type OpenWikiConfig,
  type OpenWikiStatus,
  listOpenFolderDetails,
  openwikiGetConfig,
  openwikiGetInstructions,
  openwikiRun,
  openwikiSaveConfig,
  openwikiSaveInstructions,
  openwikiStatus,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import {
  ALL_AGENT_TYPES,
  AGENT_LABELS,
  type AgentType,
  type FolderDetail,
} from "@/lib/types"

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

export function OpenWikiSettings() {
  const t = useTranslations("OpenWikiSettings")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<"init" | "update" | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [config, setConfig] = useState<OpenWikiConfig>(defaultConfig)
  const [status, setStatus] = useState<OpenWikiStatus | null>(null)
  const [folders, setFolders] = useState<FolderDetail[]>([])
  const [workspace, setWorkspace] = useState<string>("")
  const [instructions, setInstructions] = useState("")
  const [instructionsPath, setInstructionsPath] = useState("")
  const [instructionsDirty, setInstructionsDirty] = useState(false)
  const [savingInstructions, setSavingInstructions] = useState(false)

  const selectedAgents = useMemo(
    () => new Set(config.agent_types_list),
    [config.agent_types_list]
  )

  const refreshStatus = useCallback(async (ws: string | null) => {
    try {
      const st = await openwikiStatus(ws)
      setStatus(st)
    } catch {
      // Status is best-effort; keep the last snapshot on failure.
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
    let cancelled = false
    void (async () => {
      try {
        const [cfg, openFolders] = await Promise.all([
          openwikiGetConfig(),
          listOpenFolderDetails().catch(() => [] as FolderDetail[]),
        ])
        if (cancelled) return
        setConfig(cfg)
        setFolders(openFolders)
        const first = openFolders[0]?.path ?? ""
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
  }, [loadInstructions, refreshStatus])

  const toggleAgent = useCallback((agentType: AgentType) => {
    setConfig((prev) => {
      const has = prev.agent_types_list.includes(agentType)
      const agent_types_list = has
        ? prev.agent_types_list.filter((a) => a !== agentType)
        : [...prev.agent_types_list, agentType]
      // Keep agent_permissions aligned so unchecking truly revokes access.
      // Backend normalize() also enforces this; do it client-side so the UI
      // state matches what will be persisted.
      let agent_permissions = prev.agent_permissions.filter((p) =>
        agent_types_list.includes(p.agent_type as AgentType)
      )
      if (!has) {
        const already = agent_permissions.some((p) => p.agent_type === agentType)
        if (!already) {
          agent_permissions = [
            ...agent_permissions,
            { agent_type: agentType, capabilities: ["read_wiki"] },
          ]
        }
      }
      return { ...prev, agent_types_list, agent_permissions }
    })
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const applied = await openwikiSaveConfig(config)
      setConfig(applied)
      await refreshStatus(workspace || null)
      toast.success(t("saved"))
    } catch (err: unknown) {
      toast.error(t("saveFailed"), { description: toErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }, [config, refreshStatus, t, workspace])

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
      <div className="space-y-6 px-1 pb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" aria-hidden />
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

        <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
          <div className="min-w-0 space-y-1">
            <label htmlFor="openwiki-enabled" className="text-sm font-medium">
              {t("enable")}
            </label>
            <p className="text-xs text-muted-foreground">{t("enableHint")}</p>
          </div>
          <Switch
            id="openwiki-enabled"
            checked={config.enabled}
            onCheckedChange={(enabled) =>
              setConfig((prev) => ({ ...prev, enabled }))
            }
            disabled={saving}
            className="shrink-0"
          />
        </div>

        {status && (
          <div className="space-y-2 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("statusTitle")}</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refreshStatus(workspace || null)}
                disabled={!!running}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("refreshStatus")}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{status.message}</p>
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <span>
                {t("executable")}:{" "}
                {status.executable_found
                  ? status.executable_path || t("found")
                  : t("missing")}
              </span>
              <span>
                {t("wiki")}:{" "}
                {status.wiki_exists
                  ? status.wiki_path || t("ready")
                  : t("notInitialized")}
              </span>
            </div>
          </div>
        )}

        {config.enabled && (
          <>
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">{t("agentSelection")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("agentSelectionHint")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ALL_AGENT_TYPES.map((agentType) => (
                  <div
                    key={agentType}
                    className="flex items-center gap-2 rounded-md border px-3 py-2"
                  >
                    <Checkbox
                      id={`openwiki-agent-${agentType}`}
                      checked={selectedAgents.has(agentType)}
                      onCheckedChange={() => toggleAgent(agentType)}
                      disabled={saving}
                    />
                    <label
                      htmlFor={`openwiki-agent-${agentType}`}
                      className="text-sm font-medium leading-none"
                    >
                      {AGENT_LABELS[agentType]}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded-lg border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Server className="h-4 w-4 text-muted-foreground" />
                {t("injectTitle")}
              </h2>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <Label className="text-sm">{t("injectOnStart")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("injectOnStartHint")}
                  </p>
                </div>
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
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <Label className="text-sm">{t("injectAgentsMd")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("injectAgentsMdHint")}
                  </p>
                </div>
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
              <div className="space-y-2">
                <Label htmlFor="openwiki-dirname" className="text-sm">
                  {t("wikiDirname")}
                </Label>
                <Input
                  id="openwiki-dirname"
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
              <div className="space-y-2">
                <Label htmlFor="openwiki-exe" className="text-sm">
                  {t("executablePath")}
                </Label>
                <Input
                  id="openwiki-exe"
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
                <p className="text-xs text-muted-foreground">
                  {t("executableHint")}
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Rocket className="h-4 w-4 text-muted-foreground" />
                {t("workspaceTitle")}
              </h2>
              <div className="space-y-2">
                <Label htmlFor="openwiki-workspace" className="text-sm">
                  {t("workspace")}
                </Label>
                {folders.length > 0 ? (
                  <select
                    id="openwiki-workspace"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
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
                        {f.name} — {f.path}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="openwiki-workspace"
                    placeholder={t("workspacePlaceholder")}
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    disabled={!!running}
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!workspace || !!running || !config.commands.allow_init}
                  onClick={() => void runAction("code_init")}
                >
                  {running === "init" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {t("init")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    !workspace || !!running || !config.commands.allow_update
                  }
                  onClick={() => void runAction("code_update")}
                >
                  {running === "update" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {t("update")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("runnerHint")}</p>
            </div>

            <div className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">
                    {t("instructionsTitle")}
                  </h2>
                  {instructionsPath ? (
                    <p className="text-xs text-muted-foreground">
                      {instructionsPath}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !workspace ||
                    !instructionsDirty ||
                    savingInstructions ||
                    !!running
                  }
                  onClick={() => void saveInstructions()}
                >
                  {savingInstructions ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {t("saveInstructions")}
                </Button>
              </div>
              <Textarea
                value={instructions}
                onChange={(e) => {
                  setInstructions(e.target.value)
                  setInstructionsDirty(true)
                }}
                disabled={!workspace || savingInstructions}
                rows={10}
                placeholder={t("instructionsPlaceholder")}
                className="font-mono text-xs"
              />
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving || !!running}>
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
