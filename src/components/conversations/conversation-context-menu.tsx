"use client"

import { useState, useCallback, type ReactNode } from "react"
import {
  Pencil,
  Trash2,
  Circle,
  Pin,
  PinOff,
  Info,
  Link2,
  FolderOpen,
  LayoutGrid,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type {
  DbConversationSummary,
  ConversationStatus,
  FolderDetail,
} from "@/lib/types"
import { STATUS_ORDER } from "@/lib/types"
import { copyTextToClipboard } from "@/lib/utils"
import { formatConversationTitle } from "@/lib/conversation-title"
import { useTabStore } from "@/contexts/tab-context"
import { ConversationStatusDot } from "./conversation-status-dot"
import { SessionDetailsDialog } from "./session-details-dialog"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * Shared right-click context menu for a conversation row. Used by BOTH the
 * "会话" (Sessions) list (`SidebarConversationCard`) and the "项目" (Projects)
 * list (`ProjectConversationRow`) so the two stay byte-for-byte identical and
 * can't drift apart. The `children` is the trigger element (wrapped via
 * `ContextMenuTrigger asChild`); all menu items, the rename dialog, the delete
 * confirmation, and the session-details dialog live here.
 */
interface ConversationContextMenuProps {
  conversation: DbConversationSummary
  folder?: FolderDetail | null
  children: ReactNode
  onRename: (id: number, newTitle: string) => Promise<void>
  onDelete: (id: number, agentType: string, folderId: number) => Promise<void>
  onStatusChange: (id: number, status: ConversationStatus) => Promise<void>
  onTogglePin?: (id: number, nextPinned: boolean) => void
}

export function ConversationContextMenu({
  conversation,
  folder,
  children,
  onRename,
  onDelete,
  onStatusChange,
  onTogglePin,
}: ConversationContextMenuProps) {
  const t = useTranslations("Folder.conversationCard")
  const tStatus = useTranslations("Folder.statusLabels")
  const tDetails = useTranslations("Folder.sessionDetails")
  const tTabs = useTranslations("Folder.tabs")
  const isTileMode = useTabStore((s) => s.isTileMode)
  const toggleTileMode = useTabStore((s) => s.toggleTileMode)

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")

  const isPinned = conversation.pinned_at != null

  const handleRenameOpen = useCallback(() => {
    setRenameValue(conversation.title || "")
    setRenameOpen(true)
  }, [conversation.title])

  const handleRenameConfirm = useCallback(async () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== conversation.title) {
      await onRename(conversation.id, trimmed)
    }
    setRenameOpen(false)
  }, [renameValue, conversation.id, conversation.title, onRename])

  const handleDeleteConfirm = useCallback(async () => {
    await onDelete(
      conversation.id,
      conversation.agent_type,
      conversation.folder_id
    )
    setDeleteOpen(false)
  }, [
    conversation.id,
    conversation.agent_type,
    conversation.folder_id,
    onDelete,
  ])

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild data-context-menu="true">
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="rounded-md p-1 min-w-40">
          {onTogglePin && (
            <ContextMenuItem
              onSelect={() => onTogglePin(conversation.id, !isPinned)}
            >
              {isPinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
              {isPinned ? t("unpin") : t("pin")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={handleRenameOpen}>
            <Pencil className="h-4 w-4" />
            {t("rename")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setDetailsOpen(true)}>
            <Info className="h-4 w-4" />
            {tDetails("menuLabel")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={async () => {
              const link = `veryagent://session/${conversation.agent_type}_${conversation.id}`
              const ok = await copyTextToClipboard(link)
              if (ok) {
                toast.success("对话链接已复制")
              }
            }}
          >
            <Link2 className="h-4 w-4" />
            复制对话链接
          </ContextMenuItem>
          {folder?.path && (
            <ContextMenuItem
              onSelect={async () => {
                const ok = await copyTextToClipboard(folder.path)
                if (ok) {
                  toast.success("任务路径已复制")
                }
              }}
            >
              <FolderOpen className="h-4 w-4" />
              复制任务路径
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={toggleTileMode}>
            <LayoutGrid className="h-4 w-4" />
            {isTileMode ? tTabs("untileDisplay") : tTabs("tileDisplay")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Circle className="h-4 w-4" />
              {t("status")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="rounded-md p-1 min-w-32">
              {STATUS_ORDER.filter((s) => s !== conversation.status).map(
                (s) => (
                  <ContextMenuItem
                    key={s}
                    onSelect={() => onStatusChange(conversation.id, s)}
                  >
                    <ConversationStatusDot status={s} />
                    {tStatus(s)}
                  </ContextMenuItem>
                )
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {t("delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameConversation")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.key === "Process") return
              if (e.key === "Enter") handleRenameConfirm()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleRenameConfirm}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConversationTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConversationDescription", {
                title:
                  formatConversationTitle(conversation.title) ||
                  t("untitledConversation"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detailsOpen && (
        <SessionDetailsDialog
          open
          onOpenChange={setDetailsOpen}
          summary={conversation}
        />
      )}
    </>
  )
}
