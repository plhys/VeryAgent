"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  MessageSquare,
  Folder as FolderIcon,
  Search,
  SquarePen,
  Zap,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useTabActions } from "@/contexts/tab-context"
import { useSearchDialog } from "@/contexts/search-dialog-context"
import { useAutomationsView } from "@/contexts/automations-view-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import {
  SidebarConversationList,
  type SidebarConversationListHandle,
} from "@/components/conversations/sidebar-conversation-list"
import { SidebarProjectList } from "@/components/conversations/sidebar-project-list"
import { NewFolderDropdown } from "./new-folder-dropdown"
import { useIsMobile } from "@/hooks/use-mobile"
import { useIsMac } from "@/hooks/use-is-mac"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { formatShortcutLabel } from "@/lib/keyboard-shortcuts"
import {
  loadShowCompleted,
  loadSortMode,
  loadSectionOrder,
  type SidebarSortMode,
  type SidebarSectionOrder,
} from "@/lib/sidebar-view-mode-storage"
import { cn } from "@/lib/utils"

// Keyboard-shortcut hint at the trailing edge of the New chat / Search rows.
// Mirrors the folder count badge exactly — same chip (0.9375rem height,
// 0.3125rem radius, bg-primary/10, text-primary, 0.625rem text) per the request
// to match it. That pairing is also solidly legible (text-primary on
// primary/10 ≈ 14:1 light / 11:1 dark), unlike the muted-on-muted kbd it
// replaces (4.34:1). Revealed only on hover / keyboard focus of its row (each
// row is a `group`); font-mono renders the shortcut glyphs cleanly.
const SHORTCUT_BADGE_CLASS = cn(
  "ml-auto inline-flex h-[0.9375rem] shrink-0 items-center justify-center",
  "rounded-[0.3125rem] bg-primary/10 px-[0.25rem]",
  "font-mono text-[0.625rem] font-medium leading-none text-primary",
  "opacity-0 transition-opacity duration-150",
  "group-hover:opacity-100 group-focus-visible:opacity-100"
)

/**
 * A fixed top-of-sidebar action / route row. `active` marks the row as the
 * current workbench route (selected styling); `trailing` carries a shortcut hint
 * or a count badge. Extracting this keeps every fixed nav item — and any future
 * route — on one geometry instead of copy-pasting the className. Each row is a
 * `group` so a `group-hover`-revealed trailing element works.
 */
function SidebarNavButton({
  icon: Icon,
  label,
  onClick,
  active,
  trailing,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  active?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 w-full items-center gap-[0.4375rem] rounded-full pl-[0.4375rem] pr-1.5",
        "text-[0.875rem] text-sidebar-foreground outline-none",
        "transition-colors duration-150 hover:bg-sidebar-border dark:hover:bg-[#3D3D3D]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active && "bg-sidebar-primary/8"
      )}
    >
      <Icon className="h-[0.875rem] w-[0.875rem] shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      {trailing}
    </button>
  )
}

export function Sidebar() {
  const t = useTranslations("Folder.sidebar")
  const { isOpen, toggle } = useSidebarContext()
  const { activeFolder } = useActiveFolder()
  const { openNewConversationTab, openChatModeTab } = useTabActions()
  const { setOpen: setSearchOpen } = useSearchDialog()
  const { unseenFailures } = useAutomationsView()
  const { routeId, setRoute, openConversations } = useWorkbenchRoute()
  const isMac = useIsMac()
  const { shortcuts } = useShortcutSettings()
  const isMobile = useIsMobile()
  const listRef = useRef<SidebarConversationListHandle>(null)

  const [showCompleted, setShowCompleted] = useState(false)
  const [activeTab, setActiveTab] = useState<"conversations" | "projects">("conversations")
  const [sortMode, setSortMode] = useState<SidebarSortMode>("created")
  const [sectionOrder, setSectionOrder] =
    useState<SidebarSectionOrder>("folders-first")
  const searchShortcutLabel = formatShortcutLabel(
    shortcuts.toggle_search,
    isMac
  )
  const newConversationShortcutLabel = formatShortcutLabel(
    shortcuts.new_conversation,
    isMac
  )

  useEffect(() => {
    setShowCompleted(loadShowCompleted())
    setSortMode(loadSortMode())
    setSectionOrder(loadSectionOrder())
  }, [])

  const handleNewConversation = useCallback(() => {
    // Starting a conversation always returns to the conversation workspace (in
    // case a route like Automations was taking over the content region).
    openConversations()
    // Defense-in-depth: with no active folder (e.g. a cold start that recovered
    // to nothing, or all folders closed) fall back to folderless chat mode
    // rather than no-op, so this entry point is never a dead end.
    if (!activeFolder) {
      openChatModeTab()
      return
    }
    openNewConversationTab(activeFolder.id, activeFolder.path)
  }, [activeFolder, openChatModeTab, openNewConversationTab, openConversations])

  if (!isOpen) return null

  return (
    <aside className="@container/sidebar flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground select-none px-2.5">
      {/* Fixed actions above the scrollable list. */}
      <div className="flex shrink-0 flex-col gap-0.5 px-1.5 pt-5">
        <SidebarNavButton
          icon={SquarePen}
          label={t("newChat")}
          onClick={handleNewConversation}
          trailing={
            newConversationShortcutLabel ? (
              <kbd className={SHORTCUT_BADGE_CLASS}>
                {newConversationShortcutLabel}
              </kbd>
            ) : null
          }
        />
        <SidebarNavButton
          icon={Search}
          label={t("search")}
          onClick={() => setSearchOpen(true)}
          trailing={
            searchShortcutLabel ? (
              <kbd className={SHORTCUT_BADGE_CLASS}>{searchShortcutLabel}</kbd>
            ) : null
          }
        />
        <SidebarNavButton
          icon={Zap}
          label={t("automations")}
          active={routeId === "automations"}
          onClick={() => setRoute("automations")}
          trailing={
            unseenFailures > 0 ? (
              <span className="ml-auto inline-flex h-[0.9375rem] min-w-[0.9375rem] shrink-0 items-center justify-center rounded-full bg-destructive/15 px-1 font-mono text-[0.625rem] font-medium leading-none text-destructive">
                {unseenFailures}
              </span>
            ) : null
          }
        />
        <SidebarNavButton
          icon={Wrench}
          label={t("skillsAndTools")}
          active={routeId === "skillsAndTools"}
          onClick={() => setRoute("skillsAndTools")}
        />
      </div>

      {/* Tab 切换：聊天 / 文件夹 + 右侧打开文件夹按钮 */}
      <div className="flex shrink-0 items-center pl-1.5 pr-0 pt-3.5 pb-0.5">
        <div className="flex items-center rounded-full border border-sidebar-border dark:border-[#4A4A4A] p-0 gap-px bg-sidebar">
          <button
            type="button"
            onClick={() => setActiveTab("conversations")}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.75rem] font-medium transition-all duration-150",
              activeTab === "conversations"
                ? "bg-[#F8F8F8] dark:bg-[#4A4A4A] text-sidebar-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                : "text-muted-foreground hover:text-sidebar-foreground"
            )}
          >
            <MessageSquare className="h-3 w-3" />
            {t("chats")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("projects")}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.75rem] font-medium transition-all duration-150",
              activeTab === "projects"
                ? "bg-[#F8F8F8] dark:bg-[#4A4A4A] text-sidebar-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                : "text-muted-foreground hover:text-sidebar-foreground"
            )}
          >
            <FolderIcon className="h-3 w-3" />
            {t("projects")}
          </button>
        </div>
        <div className="ml-auto pr-1.5">
          <NewFolderDropdown />
        </div>
      </div>

      {/* Content area: switches between conversation list and project list */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-hidden pt-1.5"
        onClick={
          isMobile && activeTab === "conversations"
            ? (e) => {
                const target = e.target as HTMLElement
                if (target.closest("[data-conversation-id]")) {
                  toggle()
                }
              }
            : undefined
        }
      >
        {activeTab === "conversations" ? (
          <SidebarConversationList
            ref={listRef}
            showCompleted={showCompleted}
            sortMode={sortMode}
            sectionOrder={sectionOrder}
            hideFolderSections
          />
        ) : (
          <SidebarProjectList />
        )}
      </div>
    </aside>
  )
}
