"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Pencil, Plus, Server, Trash2 } from "lucide-react"
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
import { listModelProviders, deleteModelProvider } from "@/lib/api"
import type { ModelProviderInfo } from "@/lib/types"
import { AddModelProviderDialog } from "./add-model-provider-dialog"
import { EditModelProviderDialog } from "./edit-model-provider-dialog"

/**
 * Model-provider list body. When `embedded` is true, omit the outer ScrollArea
 * so a parent page can compose this with Vision Bridge under one scroller.
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
      await deleteModelProvider(deleteTarget.id)
      toast.success(t("deleteSuccess"))
      setDeleteTarget(null)
      await loadProviders()
    } catch (err: unknown) {
      const raw = err as Record<string, unknown>
      const msg =
        typeof raw?.message === "string"
          ? raw.message
          : err instanceof Error
            ? err.message
            : String(err)
      const prefix = "PROVIDER_IN_USE:"
      if (msg.includes(prefix)) {
        const agentNames = msg.substring(msg.indexOf(prefix) + prefix.length)
        toast.error(t("deleteBlockedByAgent", { agents: agentNames }))
      } else {
        toast.error(msg)
      }
    }
  }, [deleteTarget, loadProviders, t])

  const body = (
    <>
      <section className="space-y-3 px-3 pt-3 md:px-4 md:pt-4">
        <div>
          <h2 className="text-sm font-semibold">{t("sectionTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("sectionDescription")}
          </p>
        </div>
      </section>

      <section className="mt-4 space-y-2 px-3 pb-3 md:px-4 md:pb-4">
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("addProvider")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Server className="h-8 w-8 mb-2 opacity-40" />
            <span className="text-xs">{t("noProviders")}</span>
          </div>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground font-mono">
                    {p.api_url}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
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
            ))}
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
  return <ScrollArea className="h-full">{body}</ScrollArea>
}

export function ModelProviderSettings() {
  return <ModelProviderSettingsBody />
}