"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import {
  Bot,
  Boxes,
  ChevronDown,
  FileSpreadsheet,
  GitBranch,
  Globe,
  Keyboard,
  Menu,
  MessageSquareText,
  SendHorizontal,
  Palette,
  PlugZap,
  Server,
  Settings,
  SlidersHorizontal,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { usePathname } from "next/navigation"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AppToaster } from "@/components/ui/app-toaster"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { detectEnvironment } from "@/lib/transport/detect"
import { AppTitleBar } from "@/components/layout/app-title-bar"
import { useIsMobile } from "@/hooks/use-mobile"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

type SettingsNavLabelKey =
  | "general"
  | "appearance"
  | "agents"
  | "model_providers"
  | "image_generation"
  | "mcp"
  | "experts"
  | "office_tools"
  | "skill_packs"
  | "quick_messages"
  | "shortcuts"
  | "version_control"
  | "chat_channels"
  | "system"
  | "web_service"
  | "logs"

interface SettingsNavItem {
  href: string
  labelKey: SettingsNavLabelKey
  icon: ComponentType<{ className?: string }>
}

type SettingsNavGroupId = "general" | "advanced"

interface SettingsNavGroup {
  id: SettingsNavGroupId
  titleKey: "groupGeneral" | "groupAdvanced"
  /** Expanded by default when no path-based override applies. */
  defaultOpen: boolean
  items: SettingsNavItem[]
}

/** General settings — expanded by default. */
const GENERAL_NAV_ITEMS: SettingsNavItem[] = [
  {
    href: "/settings/appearance",
    labelKey: "appearance",
    icon: Palette,
  },
  {
    href: "/settings/general",
    labelKey: "general",
    icon: SlidersHorizontal,
  },
  {
    href: "/settings/model-providers",
    labelKey: "model_providers",
    icon: Server,
  },
  // Image generation is configured from Skills (veryagent-image card Settings),
  // not a standalone settings nav entry.
  {
    href: "/settings/agents",
    labelKey: "agents",
    icon: Bot,
  },
  {
    href: "/settings/chat-channels",
    labelKey: "chat_channels",
    icon: SendHorizontal,
  },
]

/**
 * Advanced / expert settings — collapsed by default.
 * `mcp` and `shortcuts` were not named in the regroup request; they
 * stay available under advanced so no existing route is dropped from the nav.
 */
const ADVANCED_NAV_ITEMS: SettingsNavItem[] = [
  {
    href: "/settings/skill-packs",
    labelKey: "skill_packs",
    icon: Boxes,
  },
  {
    href: "/settings/quick-messages",
    labelKey: "quick_messages",
    icon: MessageSquareText,
  },
  {
    href: "/settings/mcp",
    labelKey: "mcp",
    icon: PlugZap,
  },
  {
    href: "/settings/shortcuts",
    labelKey: "shortcuts",
    icon: Keyboard,
  },
  {
    href: "/settings/version-control",
    labelKey: "version_control",
    icon: GitBranch,
  },
  {
    href: "/settings/web-service",
    labelKey: "web_service",
    icon: Globe,
  },
  {
    href: "/settings/logs",
    labelKey: "logs",
    icon: FileSpreadsheet,
  },
  {
    href: "/settings/system",
    labelKey: "system",
    icon: Settings,
  },
]

const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "general",
    titleKey: "groupGeneral",
    defaultOpen: true,
    items: GENERAL_NAV_ITEMS,
  },
  {
    id: "advanced",
    titleKey: "groupAdvanced",
    defaultOpen: false,
    items: ADVANCED_NAV_ITEMS,
  },
]

interface SettingsShellProps {
  children: ReactNode
}

function normalizePath(path: string): string {
  const noSuffix = path.replace(/\/index\.html$/, "").replace(/\.html$/, "")
  const noTrailingSlash = noSuffix.replace(/\/+$/, "")
  return noTrailingSlash || "/"
}

function isWindowsRuntime(): boolean {
  if (typeof navigator === "undefined") return false
  const platform = navigator.platform.toLowerCase()
  const userAgent = navigator.userAgent.toLowerCase()
  return platform.includes("win") || userAgent.includes("windows")
}

function itemIsActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function groupContainsPath(
  items: SettingsNavItem[],
  pathname: string
): boolean {
  return items.some((item) => itemIsActive(pathname, item.href))
}

export function SettingsShell({ children }: SettingsShellProps) {
  const t = useTranslations("SettingsShell")
  const pathname = usePathname()
  const router = useRouter()
  const normalizedPathname = normalizePath(pathname)
  const isMobile = useIsMobile()
  const [navOpen, setNavOpen] = useState(false)

  // Track open state per group. When the current route lives in a group that
  // starts collapsed (advanced), force that group open so the active item is
  // visible without an extra click.
  const [openGroups, setOpenGroups] = useState<Record<SettingsNavGroupId, boolean>>(
    () => {
      const initial = {} as Record<SettingsNavGroupId, boolean>
      for (const group of SETTINGS_NAV_GROUPS) {
        initial[group.id] = group.defaultOpen
      }
      return initial
    }
  )

  useEffect(() => {
    document.title = `${t("title")} - veryAgent`
  }, [t])

  useEffect(() => {
    setOpenGroups((prev) => {
      let changed = false
      const next = { ...prev }
      for (const group of SETTINGS_NAV_GROUPS) {
        if (groupContainsPath(group.items, normalizedPathname) && !next[group.id]) {
          next[group.id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [normalizedPathname])

  const navigateTo = useCallback(
    (href: string) => {
      if (typeof window === "undefined") return

      const target = normalizePath(href)
      const current = normalizePath(window.location.pathname)
      if (current === target) {
        setNavOpen(false)
        return
      }

      // Preserve current query string so the active remote workspace context
      // (`?remoteConnectionId=N`) carries over to sub-pages — without this,
      // navigating from /settings/appearance to /settings/mcp drops the
      // remote id and the next page falls back to the local Tauri backend.
      const search = window.location.search
      const fullTarget = search ? `${target}${search}` : target

      if (isWindowsRuntime()) {
        window.location.assign(fullTarget)
        return
      }

      router.push(fullTarget)
      setNavOpen(false)
    },
    [router]
  )

  const groups = useMemo(() => {
    return SETTINGS_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !(item.labelKey === "web_service" && detectEnvironment() === "web")
      ),
    })).filter((group) => group.items.length > 0)
  }, [])

  const renderNavItem = (item: SettingsNavItem) => {
    const Icon = item.icon
    const translationKey = `nav.${item.labelKey}` as const
    const active = itemIsActive(normalizedPathname, item.href)
    return (
      <Button
        key={item.href}
        variant={active ? "secondary" : "ghost"}
        size="sm"
        className={cn("w-full justify-start px-2")}
        type="button"
        onClick={() => navigateTo(item.href)}
        aria-current={active ? "page" : undefined}
      >
        <span className="inline-flex items-center gap-1">
          <Icon className="h-3.5 w-3.5" />
          {t(translationKey)}
        </span>
      </Button>
    )
  }

  const navContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <nav className="space-y-3">
          {groups.map((group) => {
            const open = openGroups[group.id] ?? group.defaultOpen
            return (
              <Collapsible
                key={group.id}
                open={open}
                onOpenChange={(next) =>
                  setOpenGroups((prev) => ({ ...prev, [group.id]: next }))
                }
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-1 rounded-md px-2 py-1.5",
                      "text-[11px] font-medium text-muted-foreground",
                      "hover:bg-muted/60 hover:text-foreground",
                      "outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    )}
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform duration-150",
                        !open && "-rotate-90"
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{t(group.titleKey)}</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1 space-y-1 pl-0.5">
                    {group.items.map(renderNavItem)}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </nav>
      </ScrollArea>
    </div>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      <AppTitleBar
        left={
          isMobile ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
          ) : undefined
        }
        center={
          <div className="text-sm font-bold tracking-tight">{t("title")}</div>
        }
      />

      <div className="flex-1 min-h-0 flex">
        {/* Desktop sidebar */}
        {!isMobile && (
          <aside className="flex min-h-0 w-56 shrink-0 flex-col border-r px-2 py-3">
            {navContent}
          </aside>
        )}

        {/* Mobile navigation Sheet */}
        {isMobile && (
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-[260px] p-3"
            >
              <SheetTitle className="sr-only">{t("title")}</SheetTitle>
              {navContent}
            </SheetContent>
          </Sheet>
        )}

        <section className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {children}
        </section>
      </div>
      <AppToaster position="bottom-right" closeButton duration={4000} />
    </div>
  )
}
