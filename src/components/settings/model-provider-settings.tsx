"use client"

import { useCallback, useEffect, useState } from "react"
import {
  CheckCircle2,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Server,
  Trash2,
  XCircle,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  listModelProviders,
  deleteModelProvider,
  testModelProvider,
} from "@/lib/api"
import type { ModelProviderInfo, ModelProviderTestResult } from "@/lib/types"
import { AddModelProviderDialog } from "./add-model-provider-dialog"
import { EditModelProviderDialog } from "./edit-model-provider-dialog"

/**
 * Model-provider list body.
 * Layout matches General / Appearance:
 *   outer: w-full space-y-4 p-3 md:p-4
 *   cards: rounded-xl border bg-card p-4 space-y-4
 * When `embedded`, omit outer ScrollArea / page padding — parent supplies it.
 */
export function ModelProviderSettingsBody({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const t = useTranslations("ModelProviderSettings")
  const [providers, setProviders] = useState<ModelProviderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ModelProviderInfo | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ModelProviderInfo | null>(
    null
  )
  // Provider id → in-flight test / latest result.
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<
    Record<number, ModelProviderTestResult>
  >({})

  const loadProviders = useCallback(async () => {
    try {
      const rows = await listModelProviders()
      setProviders(rows)
    } catch {
      toast.error(t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadProviders().catch(console.error)
  }, [loadProviders])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      const result = await deleteModelProvider(deleteTarget.id)
      setDeleteTarget(null)
      await loadProviders()
      if (result.unlinkedAgents.length > 0) {
        toast.success(
          t("deleteUnlinkedSuccess", {
            agents: result.unlinkedAgents.join(", "),
          })
        )
      } else {
        toast.success(t("deleteSuccess"))
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : String(err)
      toast.error(msg)
    }
  }, [deleteTarget, loadProviders, t])

  const handleTest = useCallback(
    async (provider: ModelProviderInfo) => {
      setTestingId(provider.id)
      try {
        const result = await testModelProvider(provider.id)
        setTestResults((prev) => ({ ...prev, [provider.id]: result }))
        if (result.ok) {
          toast.success(t("testSuccess", { name: provider.name }))
        } else {
          toast.error(t("testFailed", { name: provider.name }))
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(t("testError", { name: provider.name, message: msg }))
      } finally {
        setTestingId(null)
      }
    },
    [t]
  )

  const body = (
    <>
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("sectionTitle")}</h2>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("sectionDescription")}
            </p>
          </div>
          <Button
            size="sm"
            className="h-8 shrink-0 text-xs"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("addProvider")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Server className="mb-2 h-8 w-8 opacity-40" />
            <span className="text-xs">{t("noProviders")}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => {
              const result = testResults[p.id]
              const testing = testingId === p.id
              return (
                <div key={p.id} className="rounded-md border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="truncate text-sm font-medium">
                        {p.name}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {p.api_url}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => handleTest(p)}
                        disabled={testing}
                      >
                        {testing ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Plug className="mr-1 h-3 w-3" />
                        )}
                        {testing ? t("testing") : t("test")}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditTarget(p)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setDeleteTarget(p)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {result && (
                    <div className="mt-2 space-y-1 border-t pt-2">
                      {result.probes.map((probe) => (
                        <div
                          key={probe.protocol}
                          className="flex items-start gap-1.5 text-[11px]"
                        >
                          {probe.ok ? (
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-green-600" />
                          ) : (
                            <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                          )}
                          <span className="min-w-0">
                            <span className="font-medium">
                              {probe.protocol === "openai"
                                ? t("protocolOpenai")
                                : probe.protocol === "anthropic"
                                  ? t("protocolAnthropic")
                                  : t("protocolModels")}
                            </span>
                            <span
                              className={
                                probe.ok
                                  ? "text-muted-foreground"
                                  : "text-destructive"
                              }
                            >
                              {probe.ok ? " ✓" : " ✗"} — {probe.detail}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <AddModelProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onProviderAdded={loadProviders}
      />

      <EditModelProviderDialog
        provider={editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
        onProviderUpdated={loadProviders}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmMessage", { name: deleteTarget?.name ?? "" })}
              {deleteTarget && deleteTarget.in_use_by.length > 0 && (
                <span className="mt-2 block text-amber-600">
                  {t("deleteWillUnlink", {
                    agents: deleteTarget.in_use_by.join(", "),
                  })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  if (embedded) return body

  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">{body}</div>
    </ScrollArea>
  )
}

export function ModelProviderSettings() {
  return <ModelProviderSettingsBody />
}
