"use client"

import { useCallback, useState, useMemo } from "react"
import { ChevronDown, Folder, GitBranch, MessageSquare, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { useShallow } from "zustand/react/shallow"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabStore } from "@/contexts/tab-context"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { normalizeFolderThemeColor } from "@/lib/theme-presets"
import { formatConversationTitle } from "@/lib/conversation-title"
import type { FolderDetail, DbConversationSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * 侧边栏"项目"选项卡：可展开的文件夹列表，默认全部展开。
 * 每个文件夹展开后显示其下的会话，点击会话切换到该会话。
 */
export function SidebarProjectList() {
  const t = useTranslations("Folder.sidebar")
  const { folders, conversations, removeFolderFromWorkspace, setActiveFolderId } =
    useAppWorkspaceStore(
      useShallow((s) => ({
        folders: s.folders,
        conversations: s.conversations,
        removeFolderFromWorkspace: s.removeFolderFromWorkspace,
        setActiveFolderId: s.setActiveFolderId,
      }))
    )
  const { activeFolderId } = useActiveFolder()
  const { openConversations } = useWorkbenchRoute()
  const switchTab = useTabStore((s) => s.switchTab)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openNewConversationTab = useTabStore(
    (s) => s.openNewConversationTab
  )

  // 默认全部展开
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})

  // 按 folder_id 分组会话
  const conversationsByFolder = useMemo(() => {
    const map = new Map<number, DbConversationSummary[]>()
    for (const conv of conversations) {
      const list = map.get(conv.folder_id) || []
      list.push(conv)
      map.set(conv.folder_id, list)
    }
    return map
  }, [conversations])

  const toggleFolder = useCallback((folderId: number) => {
    setCollapsed((prev) => ({ ...prev, [folderId]: !prev[folderId] }))
  }, [])

  const handleRemove = useCallback(
    (folderId: number) => {
      removeFolderFromWorkspace(folderId)
    },
    [removeFolderFromWorkspace]
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
      setActiveFolderId(conv.folder_id)
      openConversations()
      // 找到该会话对应的 tab 并切换
      const tab = tabs.find(
        (t) =>
          t.conversationId === conv.id && t.folderId === conv.folder_id
      )
      if (tab) {
        switchTab(tab.id)
      } else {
        // 没有打开的 tab，新建会话 tab
        const folder = folders.find((f) => f.id === conv.folder_id)
        if (folder) {
          openNewConversationTab(folder.id, folder.path)
        }
      }
    },
    [setActiveFolderId, openConversations, switchTab, tabs, folders, openNewConversationTab]
  )

  if (folders.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
        <div className="space-y-1.5">
          <Folder className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("noFolders")}
          </p>
          <p className="text-[0.75rem] text-muted-foreground/70">
            {t("noFoldersHint")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 px-1.5 pt-1.5">
      {folders.map((folder) => {
        const isActive = folder.id === activeFolderId
        const isCollapsed = collapsed[folder.id] ?? false
        const themeColor = normalizeFolderThemeColor(folder.color)
        const folderConvs = conversationsByFolder.get(folder.id) || []

        return (
          <div key={folder.id}>
            {/* 文件夹头部 */}
            <button
              type="button"
              onClick={() => toggleFolder(folder.id)}
              onDoubleClick={() => handleOpenFolder(folder)}
              className={cn(
                "group flex h-9 w-full items-center gap-[0.5rem] rounded-full pl-[0.625rem] pr-1.5",
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
                <Folder
                  className={cn(
                    "h-[0.875rem] w-[0.875rem]",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
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
                    "truncate text-[0.875rem] leading-tight",
                    isActive
                      ? "font-medium text-foreground"
                      : "text-sidebar-foreground"
                  )}
                >
                  {folder.name}
                </span>
                {folder.git_branch && (
                  <span className="flex items-center gap-0.5 text-[0.6875rem] leading-tight text-muted-foreground/70">
                    <GitBranch className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{folder.git_branch}</span>
                  </span>
                )}
              </span>
              {/* hover 时显示操作按钮 */}
              <span className="hidden items-center gap-px group-hover:flex">
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleNewConversation(folder)
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[0.375rem] text-muted-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  title={t("newConversation")}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </span>
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(folder.id)
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[0.375rem] text-muted-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  title={t("removeFromWorkspace")}
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </span>
            </button>

            {/* 展开的会话列表 — 树形子弹线 */}
            {!isCollapsed && (
              <div className="relative ml-[1.375rem] pl-4 pt-1 pb-1">
                {folderConvs.length === 0 ? (
                  <p className="py-1 text-[0.75rem] text-muted-foreground/60">
                    {t("emptyFolderHint")}
                  </p>
                ) : (() => {
                  // 找到选中项的索引
                  const activeIdx = folderConvs.findIndex(
                    (c) =>
                      activeTabId != null &&
                      tabs.find(
                        (tab) =>
                          tab.conversationId === c.id &&
                          tab.folderId === c.folder_id
                      )?.id === activeTabId
                  )
                  return (
                    <div className="flex flex-col">
                      {folderConvs.map((conv, idx) => {
                        const isConvActive = idx === activeIdx
                        const isLast = idx === folderConvs.length - 1
                        // 竖线：选中项以上(含)实线，以下虚线
                        const trunkSolid = activeIdx >= 0 && idx <= activeIdx
                        // 下方竖线：选中项以上实线，以下虚线
                        const belowSolid = activeIdx >= 0 && idx < activeIdx
                        // 水平分支：仅选中项实线
                        const branchSolid = isConvActive
                        return (
                          <div key={conv.id} className="relative mb-1.5">
                            {/* 上方竖线 */}
                            <div
                              className="absolute"
                              style={{
                                left: "-1rem",
                                top: 0,
                                height: "50%",
                                width: 0,
                                borderLeft: trunkSolid
                                  ? "1.5px solid var(--color-primary, var(--primary))"
                                  : "1px dashed var(--color-sidebar-border, #e5e5e5)",
                              }}
                            />
                            {/* 水平分支线 */}
                            <div
                              className="absolute"
                              style={{
                                left: "-1rem",
                                top: "50%",
                                width: "1rem",
                                height: 0,
                                borderTop: branchSolid
                                  ? "1.5px solid var(--color-primary, var(--primary))"
                                  : "1px dashed var(--color-sidebar-border, #e5e5e5)",
                                transform: "translateY(-0.5px)",
                              }}
                            />
                            {/* 下方竖线（最后一项不画） */}
                            {!isLast && (
                              <div
                                className="absolute"
                                style={{
                                  left: "-1rem",
                                  top: "50%",
                                  bottom: 0,
                                  width: 0,
                                  borderLeft: belowSolid
                                    ? "1.5px solid var(--color-primary, var(--primary))"
                                    : "1px dashed var(--color-sidebar-border, #e5e5e5)",
                                }}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => handleConversationClick(conv)}
                              className={cn(
                                "flex h-8 w-full items-center gap-1.5 rounded-full pl-2 pr-2",
                                "text-left text-[0.875rem] transition-colors duration-150",
                                "hover:bg-sidebar-border dark:hover:bg-[#3D3D3D]",
                                isConvActive
                                  ? "bg-sidebar-border dark:bg-[#3D3D3D] text-primary font-medium"
                                  : "text-sidebar-foreground/80"
                              )}
                            >
                              <MessageSquare className={cn(
                                "h-3 w-3 shrink-0",
                                isConvActive ? "text-primary" : "text-muted-foreground"
                              )} />
                              <span className="truncate">
                                {formatConversationTitle(conv.title) ||
                                  t("untitledConversation")}
                              </span>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
