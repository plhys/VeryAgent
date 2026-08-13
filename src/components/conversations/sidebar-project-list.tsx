"use client"

import {
  useCallback,
  useState,
  useMemo,
  useRef,
  useEffect,
  type RefObject,
} from "react"
import {
  ChevronDown,
  Folder,
  GitBranch,
  FolderOpen,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Archive,
  Users,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useShallow } from "zustand/react/shallow"
import { toast } from "sonner"
import { toErrorMessage } from "@/lib/app-error"
import { useTeams } from "@/contexts/team-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { normalizeFolderThemeColor } from "@/lib/theme-presets"
import { formatConversationTitle } from "@/lib/conversation-title"
import type {
  FolderDetail,
  DbConversationSummary,
  ConversationStatus,
  TeamSummary,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { isLocalDesktop, revealItemInDir } from "@/lib/platform"
import { AgentIcon } from "@/components/agent-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  updateConversationTitle,
  deleteConversation,
  updateConversationStatus,
  updateConversationPinned,
  teamDelete,
  teamDisband,
} from "@/lib/api"
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
import { SidebarHoverTimeFlag } from "./sidebar-hover-time-flag"
import { TeamWorkspaceHoverCard } from "@/components/team/team-workspace-hover-card"
import { ConversationContextMenu } from "./conversation-context-menu"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"

/**
 * 侧边栏"项目"选项卡：可展开的文件夹列表，默认全部展开。
 * 每个文件夹展开后显示其下的会话，点击会话切换到该会话。
 */
export function SidebarProjectList() {
  const t = useTranslations("Folder.sidebar")
  const tCommon = useTranslations("Folder.common")
  const {
    folders,
    conversations,
    removeFolderFromWorkspace,
    renameFolder,
    reorderFolders,
    setActiveFolderId,
    refreshConversations,
    updateConversationLocal,
    agentFilter,
  } = useAppWorkspaceStore(
    useShallow((s) => ({
      folders: s.folders,
      conversations: s.conversations,
      removeFolderFromWorkspace: s.removeFolderFromWorkspace,
      renameFolder: s.renameFolder,
      reorderFolders: s.reorderFolders,
      setActiveFolderId: s.setActiveFolderId,
      refreshConversations: s.refreshConversations,
      updateConversationLocal: s.updateConversationLocal,
      agentFilter: s.agentFilter,
    }))
  )
  const { activeFolderId } = useActiveFolder()
  const { teams } = useTeams()
  const { openConversations } = useWorkbenchRoute()
  const openTab = useTabStore((s) => s.openTab)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openNewConversationTab = useTabStore((s) => s.openNewConversationTab)
  const { closeConversationTab, closeTabsByFolder } = useTabActions()

  // Folder lookup for the per-conversation context menu ("复制任务路径").
  const folderById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders]
  )

  // Mirrors the "会话" list's conversation actions so both sidebars expose the
  // exact same right-click menu (see ConversationContextMenu).
  const handleRename = useCallback(
    async (id: number, newTitle: string) => {
      await updateConversationTitle(id, newTitle)
      refreshConversations()
    },
    [refreshConversations]
  )

  const handleDelete = useCallback(
    async (id: number, agentType: string, folderId: number) => {
      await deleteConversation(id)
      closeConversationTab(
        folderId,
        id,
        agentType as Parameters<typeof openTab>[2]
      )
      refreshConversations()
    },
    [closeConversationTab, refreshConversations, openTab]
  )

  const handleStatusChange = useCallback(
    async (id: number, status: ConversationStatus) => {
      updateConversationLocal(id, { status })
      await updateConversationStatus(id, status)
    },
    [updateConversationLocal]
  )

  const handleTogglePin = useCallback(
    async (id: number, nextPinned: boolean) => {
      updateConversationLocal(id, {
        pinned_at: nextPinned ? new Date().toISOString() : null,
      })
      await updateConversationPinned(id, nextPinned)
    },
    [updateConversationLocal]
  )

  // 默认全部展开
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  // 团队工作区操作确认：解散（软归档，可恢复）或彻底删除（物理清除，不可恢复）。
  // 普通工作区直接「从工作区移除」（无确认）。
  const [removeConfirm, setRemoveConfirm] = useState<{
    folderId: number
    folderName: string
    teamId?: string
    mode?: "disband" | "delete"
  } | null>(null)

  // 按 folder_id 分组会话（支持 agent 筛选）
  const conversationsByFolder = useMemo(() => {
    const filtered = agentFilter
      ? conversations.filter((c) => c.agent_type === agentFilter)
      : conversations
    const map = new Map<number, DbConversationSummary[]>()
    for (const conv of filtered) {
      const list = map.get(conv.folder_id) || []
      list.push(conv)
      map.set(conv.folder_id, list)
    }
    return map
  }, [conversations, agentFilter])

  const toggleFolder = useCallback((folderId: number) => {
    setCollapsed((prev) => ({ ...prev, [folderId]: !prev[folderId] }))
  }, [])

  // 解散团队：软归档，从侧边栏移除但记录保留（同工作区重建可恢复原团队）。
  const handleDisband = useCallback(
    (folderId: number, teamId: string, folderName: string) => {
      setRemoveConfirm({ folderId, folderName, teamId, mode: "disband" })
    },
    []
  )

  // 彻底删除团队：物理清除团队及所有会话记录（不可恢复），保留项目文件。
  const handleDeleteTeam = useCallback(
    (folderId: number, teamId: string, folderName: string) => {
      setRemoveConfirm({ folderId, folderName, teamId, mode: "delete" })
    },
    []
  )

  // 普通工作区：从工作区移除（仅隐藏，数据保留）。
  const handleRemoveFolder = useCallback(
    (folderId: number) => {
      void removeFolderFromWorkspace(folderId)
    },
    [removeFolderFromWorkspace]
  )

  const handleRemoveConfirm = useCallback(async () => {
    if (!removeConfirm) return
    const { folderId, teamId, mode } = removeConfirm
    try {
      closeTabsByFolder(folderId)
      if (teamId && mode === "delete") {
        // 彻底删除：物理清除团队及会话记录
        await teamDelete(teamId)
      } else if (teamId && mode === "disband") {
        // 解散：软归档（记录保留，同工作区重建可恢复）
        await teamDisband(teamId)
      }
      await removeFolderFromWorkspace(folderId)
      toast.success(
        t("toasts.folderRemoved", { name: removeConfirm.folderName })
      )
    } catch (e) {
      const msg = toErrorMessage(e)
      toast.error(t("toasts.removeFolderFailed", { message: msg }))
    } finally {
      setRemoveConfirm(null)
    }
  }, [
    removeConfirm,
    closeTabsByFolder,
    teamDelete,
    teamDisband,
    removeFolderFromWorkspace,
    t,
  ])

  const handleRenameFolder = useCallback(
    async (folderId: number, name: string) => {
      await renameFolder(folderId, name)
    },
    [renameFolder]
  )

  const handleOpenFolderPath = useCallback(async (path: string) => {
    if (!isLocalDesktop()) return
    try {
      await revealItemInDir(path)
    } catch (error) {
      console.error("[SidebarProjectList] failed to open workspace path", {
        path,
        error,
      })
    }
  }, [])

  const handlePinFolder = useCallback(
    (folderId: number) => {
      const orderedIds = [
        folderId,
        ...folders
          .filter((folder) => folder.id !== folderId)
          .map((folder) => folder.id),
      ]
      void reorderFolders(orderedIds)
    },
    [folders, reorderFolders]
  )

  const handleOpenFolder = useCallback(
    (folder: FolderDetail) => {
      setActiveFolderId(folder.id)
      openConversations()
    },
    [setActiveFolderId, openConversations]
  )

  const handleNewConversation = useCallback(
    (folder: FolderDetail) => {
      setActiveFolderId(folder.id)
      openConversations()
      openNewConversationTab(folder.id, folder.path)
    },
    [setActiveFolderId, openConversations, openNewConversationTab]
  )

  const handleConversationClick = useCallback(
    (conv: DbConversationSummary) => {
      // Align with the Sessions tab: open/focus this conversation so both the
      // parent folder and the conversation row can show selected state.
      setActiveFolderId(conv.folder_id)
      openConversations()
      openTab(conv.folder_id, conv.id, conv.agent_type, false)
    },
    [setActiveFolderId, openConversations, openTab]
  )

  if (folders.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
        <div className="space-y-1.5">
          <Folder className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("noFolders")}
          </p>
          <p className="text-[0.8rem] text-muted-foreground/70">
            {t("noFoldersHint")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-1 px-0.5 pt-1.5">
        {folders.map((folder) => {
          const isActive = folder.id === activeFolderId
          const isCollapsed = collapsed[folder.id] ?? false
          const themeColor = normalizeFolderThemeColor(folder.color)
          const folderConvs = conversationsByFolder.get(folder.id) || []
          // 该文件夹是否为团队 workspace（与文件夹名/图标渲染共用同一判定）。
          const teamForFolder =
            teams.find((team) => team.workspace === folder.path) ?? null

          return (
            <div key={folder.id}>
              <ProjectFolderHeader
                folder={folder}
                team={teamForFolder}
                isActive={isActive}
                isCollapsed={isCollapsed}
                themeColor={themeColor}
                onToggle={() => toggleFolder(folder.id)}
                onOpen={() => handleOpenFolder(folder)}
                onNewConversation={() => handleNewConversation(folder)}
                onRemove={() => handleRemoveFolder(folder.id)}
                onDisband={
                  teamForFolder
                    ? () =>
                        handleDisband(folder.id, teamForFolder.id, folder.name)
                    : undefined
                }
                onDeleteTeam={
                  teamForFolder
                    ? () =>
                        handleDeleteTeam(
                          folder.id,
                          teamForFolder.id,
                          folder.name
                        )
                    : undefined
                }
                onRename={(name) => handleRenameFolder(folder.id, name)}
                onOpenPath={() => handleOpenFolderPath(folder.path)}
                onPin={() => handlePinFolder(folder.id)}
                newConversationTitle={t("newConversation")}
                pinTitle={t("pinWorkspace")}
                renameTitle={t("renameWorkspace")}
                renameDialogTitle={t("renameWorkspaceTitle")}
                openTitle={t("openWorkspace")}
                removeTitle={t("removeFromWorkspace")}
                disbandTeamTitle={t("disbandTeam")}
                deleteTeamTitle={t("deleteTeamForever")}
              />

              {/* 展开的会话列表 — 树形子弹线 */}
              {!isCollapsed && (
                <div className="relative ml-[1.375rem] pl-4 pt-1 pb-1">
                  {folderConvs.length === 0 ? (
                    <p className="py-1 text-[0.75rem] text-muted-foreground/60">
                      {t("emptyFolderHint")}
                    </p>
                  ) : (
                    (() => {
                      // Prefer the active tab's conversationId so selection survives
                      // agent-type / tab-id edge cases and highlights with the folder.
                      const activeTab =
                        activeTabId != null
                          ? tabs.find((tab) => tab.id === activeTabId)
                          : undefined
                      const activeIdx = folderConvs.findIndex(
                        (c) =>
                          activeTab != null &&
                          activeTab.conversationId === c.id &&
                          activeTab.folderId === c.folder_id
                      )
                      return (
                        <div className="flex flex-col">
                          {folderConvs.map((conv, idx) => {
                            const isConvActive = idx === activeIdx
                            const isLast = idx === folderConvs.length - 1
                            // 竖线：选中项以上(含)主色，以下浅灰色
                            const trunkActive =
                              activeIdx >= 0 && idx <= activeIdx
                            // 下方竖线：选中项以上主色，以下浅灰色
                            const belowActive =
                              activeIdx >= 0 && idx < activeIdx
                            // 水平分支：仅选中项主色
                            const branchActive = isConvActive
                            const trunkColor = trunkActive
                              ? "var(--color-primary, var(--primary))"
                              : "var(--color-sidebar-border, #e5e5e5)"
                            const branchColor = branchActive
                              ? "var(--color-primary, var(--primary))"
                              : "var(--color-sidebar-border, #e5e5e5)"
                            const belowColor = belowActive
                              ? "var(--color-primary, var(--primary))"
                              : "var(--color-sidebar-border, #e5e5e5)"
                            return (
                              <div key={conv.id} className="relative mb-1.5">
                                {/* 细连接线：回到更干净的小细线，统一 1px，降低存在感。 */}
                                {/* 纯细线：不用 border、不用 scale、不要装饰，直接画 1px 背景线。 */}
                                <div
                                  className="absolute"
                                  style={{
                                    left: "calc(-1rem - 0.5px)",
                                    top: 0,
                                    height: "50%",
                                    width: "1px",
                                    opacity: 0.8,
                                    backgroundColor: trunkColor,
                                  }}
                                />
                                <div
                                  className="absolute"
                                  style={{
                                    left: "-1rem",
                                    top: "calc(50% - 0.5px)",
                                    width: "1rem",
                                    height: "1px",
                                    opacity: 0.8,
                                    backgroundColor: branchColor,
                                  }}
                                />
                                {!isLast && (
                                  <div
                                    className="absolute"
                                    style={{
                                      left: "calc(-1rem - 0.5px)",
                                      top: "50%",
                                      bottom: "-0.375rem",
                                      width: "1px",
                                      opacity: 0.8,
                                      backgroundColor: belowColor,
                                    }}
                                  />
                                )}
                                <ProjectConversationRow
                                  conv={conv}
                                  isActive={isConvActive}
                                  untitledLabel={t("untitledConversation")}
                                  folder={folderById.get(conv.folder_id)}
                                  onClick={() => handleConversationClick(conv)}
                                  onRename={handleRename}
                                  onDelete={handleDelete}
                                  onStatusChange={handleStatusChange}
                                  onTogglePin={handleTogglePin}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <AlertDialog
        open={removeConfirm !== null}
        onOpenChange={(open) => !open && setRemoveConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removeConfirm?.mode === "disband"
                ? t("disbandTeamTitle")
                : removeConfirm?.mode === "delete"
                  ? t("removeTeamFolderConfirmTitle")
                  : t("removeFolderConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removeConfirm?.mode === "disband"
                ? t("disbandTeamDescription", {
                    name: removeConfirm?.folderName ?? "",
                  })
                : removeConfirm?.mode === "delete"
                  ? t("removeTeamFolderConfirmDescription", {
                      name: removeConfirm?.folderName ?? "",
                    })
                  : t("removeFolderConfirmDescription", {
                      name: removeConfirm?.folderName ?? "",
                    })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveConfirm}>
              {tCommon("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ProjectFolderHeader({
  folder,
  team,
  isActive,
  isCollapsed,
  themeColor,
  onToggle,
  onOpen,
  onNewConversation,
  onRemove,
  onDisband,
  onDeleteTeam,
  onRename,
  onOpenPath,
  onPin,
  newConversationTitle,
  pinTitle,
  renameTitle,
  renameDialogTitle,
  openTitle,
  removeTitle,
  disbandTeamTitle,
  deleteTeamTitle,
}: {
  folder: FolderDetail
  /** 该文件夹对应的团队（若它是团队 workspace）。非团队为 null。 */
  team: TeamSummary | null
  isActive: boolean
  isCollapsed: boolean
  themeColor: string
  onToggle: () => void
  onOpen: () => void
  onNewConversation: () => void
  onRemove: () => void
  onDisband?: () => void
  onDeleteTeam?: () => void
  onRename: (name: string) => Promise<void>
  onOpenPath: () => void
  onPin: () => void
  newConversationTitle: string
  pinTitle: string
  renameTitle: string
  renameDialogTitle: string
  openTitle: string
  removeTitle: string
  disbandTeamTitle: string
  deleteTeamTitle: string
}) {
  const tCommon = useTranslations("Folder.common")
  const rowRef = useRef<HTMLButtonElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(folder.name)
  const [renameSaving, setRenameSaving] = useState(false)
  const isTeamWorkspace = team != null

  const handleRenameOpen = () => {
    setRenameValue(folder.name)
    setRenameOpen(true)
  }

  const handleRenameSubmit = async () => {
    const nextName = renameValue.trim()
    if (!nextName || nextName === folder.name || renameSaving) {
      if (!nextName) return
      setRenameOpen(false)
      return
    }
    setRenameSaving(true)
    try {
      await onRename(nextName)
      setRenameOpen(false)
    } finally {
      setRenameSaving(false)
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild data-context-menu="true">
          <button
            ref={rowRef}
            type="button"
            onClick={onToggle}
            onDoubleClick={onOpen}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            title={
              isTeamWorkspace && team
                ? `${team.name}（${team.member_count} 名成员 · ${folder.path}）`
                : folder.name
            }
            className={cn(
              "group flex h-9 w-full items-center gap-[0.5rem] rounded-md pl-[0.625rem] pr-1.5",
              "text-left outline-none transition-colors duration-150",
              "hover:bg-sidebar-border dark:hover:bg-[#3D3D3D]",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              isActive ? "bg-sidebar-border dark:bg-[#3D3D3D]" : ""
            )}
          >
            <ChevronDown
              className={cn(
                "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                isCollapsed && "-rotate-90"
              )}
            />
            <span className="relative flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center">
              {isTeamWorkspace ? (
                <Users
                  className={cn(
                    "h-[0.875rem] w-[0.875rem]",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
              ) : (
                <Folder
                  className={cn(
                    "h-[0.875rem] w-[0.875rem]",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
              )}
              {themeColor !== "neutral" && (
                <span
                  className="absolute -right-0.5 -bottom-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-sidebar"
                  style={{
                    backgroundColor: `var(--color-${themeColor}, var(--primary))`,
                  }}
                />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "truncate text-[0.9rem] leading-tight",
                  isActive
                    ? "font-medium text-foreground"
                    : "text-sidebar-foreground"
                )}
              >
                {isTeamWorkspace && team ? team.name : folder.name}
              </span>
              {folder.git_branch && (
                <span className="flex items-center gap-0.5 text-[0.6875rem] leading-tight text-muted-foreground/70">
                  <GitBranch className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{folder.git_branch}</span>
                </span>
              )}
            </span>
            {/* hover 时只显示新建会话按钮；删除移到右键菜单 */}
            <span className="hidden items-center gap-px group-hover:flex">
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onNewConversation()
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[0.375rem] text-muted-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                title={newConversationTitle}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </span>
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="rounded-md p-1 min-w-40">
          <ContextMenuItem onSelect={onPin}>
            <Pin className="h-4 w-4" />
            {pinTitle}
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleRenameOpen}>
            <Pencil className="h-4 w-4" />
            {renameTitle}
          </ContextMenuItem>
          <ContextMenuItem onSelect={onOpenPath}>
            <FolderOpen className="h-4 w-4" />
            {openTitle}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {team ? (
            <>
              <ContextMenuItem variant="destructive" onSelect={onDisband}>
                <Archive className="h-4 w-4" />
                {disbandTeamTitle}
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={onDeleteTeam}>
                <Trash2 className="h-4 w-4" />
                {deleteTeamTitle}
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 className="h-4 w-4" />
              {removeTitle}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{renameDialogTitle}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleRenameSubmit()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameOpen(false)}
              disabled={renameSaving}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void handleRenameSubmit()}
              disabled={renameSaving || !renameValue.trim()}
            >
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SidebarHoverTimeFlag
        hostRef={rowRef as RefObject<HTMLElement | null>}
        isHovered={isHovered}
        rawTimestamp={folder.last_opened_at}
      />
      {/* 团队工作区悬浮详情卡片：悬停时在时间旗标右侧展示成员/路径/项目简介 */}
      {isTeamWorkspace && team ? (
        <TeamWorkspaceHoverCard
          hostRef={rowRef as RefObject<HTMLElement | null>}
          isHovered={isHovered}
          teamId={team.id}
          workspace={folder.path}
        />
      ) : null}
    </>
  )
}

function ProjectConversationRow({
  conv,
  isActive,
  untitledLabel,
  folder,
  onClick,
  onRename,
  onDelete,
  onStatusChange,
  onTogglePin,
}: {
  conv: DbConversationSummary
  isActive: boolean
  untitledLabel: string
  folder?: FolderDetail | null
  onClick: () => void
  onRename: (id: number, newTitle: string) => Promise<void>
  onDelete: (id: number, agentType: string, folderId: number) => Promise<void>
  onStatusChange: (id: number, status: ConversationStatus) => Promise<void>
  onTogglePin: (id: number, nextPinned: boolean) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const projectAgentFilter = useAppWorkspaceStore((s) => s.agentFilter)

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const daysAgo = useMemo(() => {
    const iso = conv.updated_at || conv.created_at
    if (!iso) return null
    const ts = Date.parse(iso)
    if (Number.isNaN(ts)) return null
    const diff = Math.max(0, now - ts)
    const days = Math.floor(diff / 86400000)
    if (days === 0) return "今天"
    if (days === 1) return "昨天"
    return `${days}天前`
  }, [conv.updated_at, conv.created_at, now])

  const isPinned = conv.pinned_at != null

  return (
    <>
      <ConversationContextMenu
        conversation={conv}
        folder={folder}
        onRename={onRename}
        onDelete={onDelete}
        onStatusChange={onStatusChange}
        onTogglePin={onTogglePin}
      >
        <div
          ref={rowRef}
          className="group relative flex h-8 w-full items-center"
        >
          {/* 整行通栏的选中/悬停背景（与绘画标签一致，右缘延伸到容器边界） */}
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 rounded-md transition-colors duration-[120ms]",
              "left-[0.5rem] right-[0.5rem]",
              isActive
                ? "bg-sidebar-border dark:bg-[#3D3D3D]"
                : "group-hover:bg-sidebar-border dark:group-hover:bg-[#3D3D3D]"
            )}
          />
          <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={cn(
              "relative flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2",
              "text-left text-[0.875rem] transition-colors duration-150",
              isActive
                ? "text-primary font-medium"
                : "text-sidebar-foreground/80"
            )}
          >
            {projectAgentFilter && (
              <AgentIcon
                agentType={conv.agent_type}
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              />
            )}
            <span className="truncate">
              {formatConversationTitle(conv.title) || untitledLabel}
            </span>
          </button>
          {/* Right slot: days-ago by default, pin + archive on hover */}
          <div className="relative flex h-full shrink-0 items-center pr-4">
            <span
              className={cn(
                "flex items-center text-[0.65rem] text-muted-foreground/60 whitespace-nowrap",
                "group-hover:opacity-0 transition-opacity duration-150"
              )}
            >
              {daysAgo}
            </span>
            <div
              className={cn(
                "flex items-center gap-px opacity-0 transition-opacity duration-150",
                "group-hover:opacity-100 absolute right-4"
              )}
            >
              {onTogglePin && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTogglePin(conv.id, !isPinned)
                  }}
                  title={isPinned ? "取消置顶" : "置顶"}
                  aria-label={isPinned ? "取消置顶" : "置顶"}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md cursor-pointer outline-none transition-all duration-150 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/20"
                >
                  {isPinned ? (
                    <PinOff className="h-4 w-4" />
                  ) : (
                    <Pin className="h-4 w-4" />
                  )}
                </button>
              )}
              {onStatusChange && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStatusChange(conv.id, "completed")
                  }}
                  title="归档"
                  aria-label="归档"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md cursor-pointer outline-none transition-all duration-150 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/20"
                >
                  <Archive className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </ConversationContextMenu>
      <SidebarHoverTimeFlag
        hostRef={rowRef as RefObject<HTMLElement | null>}
        isHovered={isHovered}
        rawTimestamp={conv.updated_at || conv.created_at}
        agentType={conv.agent_type}
      />
    </>
  )
}
