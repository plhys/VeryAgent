"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import {
  ShieldAlert,
  Terminal,
  ListTodo,
  Compass,
  FileText,
  Globe,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CodeBlock } from "@/components/ai-elements/code-block"
import { UnifiedDiffPreview } from "@/components/diff/unified-diff-preview"
import { MessageResponse } from "@/components/ai-elements/message"
import type { PendingPermission } from "@/contexts/acp-connections-context"
import { parsePermissionToolCall } from "@/lib/permission-request"
import { useConfigOptionLocalizer } from "@/lib/config-option-labels"

interface PermissionDialogProps {
  permission: PendingPermission | null
  onRespond: (requestId: string, optionId: string) => void
}

function formatKindLabel(kind: string, fallbackLabel: string): string {
  const normalized = kind.replace(/_/g, " ").trim()
  return normalized.length > 0 ? normalized : fallbackLabel
}

function isRejectKind(kind: string): boolean {
  const k = kind.toLowerCase()
  return k.includes("reject") || k.includes("deny") || k.includes("dont") || k.includes("don't")
}

export function PermissionDialog({
  permission,
  onRespond,
}: PermissionDialogProps) {
  const t = useTranslations("Folder.chat.permissionDialog")
  const localizer = useConfigOptionLocalizer()
  const parsed = useMemo(
    () => parsePermissionToolCall(permission?.tool_call),
    [permission?.tool_call]
  )
  if (!permission) return null

  const hasFileChanges = parsed.fileChanges.length > 0
  const hasPlan =
    parsed.planEntries.length > 0 || Boolean(parsed.planExplanation)
  const hasPlanMarkdown = Boolean(parsed.planMarkdown)
  const hasAllowedPrompts = parsed.allowedPrompts.length > 0
  const hasWeb = Boolean(parsed.url) || Boolean(parsed.query)
  const hasOtherStructured =
    Boolean(parsed.command) ||
    hasFileChanges ||
    hasPlan ||
    hasPlanMarkdown ||
    hasAllowedPrompts ||
    Boolean(parsed.modeTarget) ||
    hasWeb
  // Agent-provided description (ACP `content` text). Shown only when no richer
  // structured view exists, so it replaces the raw-JSON fallback for agents
  // like Kimi Code that carry the request text in `content` rather than
  // `rawInput`, while leaving command/diff/plan dialogs untouched.
  const hasContentText = Boolean(parsed.contentText)
  const hasStructured = hasOtherStructured || hasContentText

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold leading-tight text-amber-900 dark:text-amber-100">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="truncate">{parsed.title}</span>
          </div>
          <p className="text-[11px] leading-tight text-amber-700/80 dark:text-amber-300/80">{t("subtitle")}</p>
        </div>
        <Badge variant="outline" className="shrink-0 border-amber-500 text-amber-700 dark:text-amber-300 text-[10px] bg-amber-100 dark:bg-amber-900/40">
          {formatKindLabel(parsed.normalizedKind, t("kindFallbackTool"))}
        </Badge>
      </div>

      <div className="mt-2 max-h-[min(18vh,9rem)] space-y-1.5 overflow-y-auto pr-0.5 text-xs">
        {parsed.command && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Terminal className="h-3.5 w-3.5" />
              <span>{t("command")}</span>
            </div>
            <CodeBlock code={parsed.command} language="bash" />
            {parsed.cwd && (
              <div className="break-all text-xs text-muted-foreground">
                {t("cwd", { cwd: parsed.cwd })}
              </div>
            )}
          </div>
        )}

        {hasFileChanges && parsed.diffPreview && (
          <UnifiedDiffPreview diffText={parsed.diffPreview} />
        )}

        {hasPlan && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <ListTodo className="h-3.5 w-3.5" />
              <span>{t("plan")}</span>
            </div>
            {parsed.planExplanation && (
              <p className="text-xs text-foreground/90">
                {parsed.planExplanation}
              </p>
            )}
            {parsed.planEntries.length > 0 && (
              <div className="space-y-1 rounded-md bg-muted/40 p-2">
                {parsed.planEntries.map((entry, index) => (
                  <div key={`${entry.text}-${index}`} className="text-xs">
                    <span className="text-foreground/90">{entry.text}</span>
                    {entry.status && (
                      <span className="ml-2 text-muted-foreground">
                        ({entry.status})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {hasPlanMarkdown && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span>{t("plan")}</span>
            </div>
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none [&_ul]:list-inside [&_ol]:list-inside">
              <MessageResponse>{parsed.planMarkdown!}</MessageResponse>
            </div>
          </div>
        )}

        {hasAllowedPrompts && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Terminal className="h-3.5 w-3.5" />
              <span>{t("allowedActions")}</span>
            </div>
            <div className="space-y-1 rounded-md bg-muted/40 p-2">
              {parsed.allowedPrompts.map((item, index) => (
                <div
                  key={`${item.prompt}-${index}`}
                  className="flex items-center gap-2 text-xs"
                >
                  {item.tool && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {item.tool}
                    </Badge>
                  )}
                  <span className="text-foreground/90">{item.prompt}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {parsed.modeTarget && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Compass className="h-3.5 w-3.5" />
              <span>{t("targetMode", { mode: parsed.modeTarget })}</span>
            </div>
          </div>
        )}

        {hasWeb && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
            {parsed.url && (
              <div className="flex items-center gap-2 text-xs">
                <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="break-all font-mono text-foreground/90">
                  {parsed.url}
                </span>
              </div>
            )}
            {parsed.query && (
              <div className="flex items-center gap-2 text-xs">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="break-all text-foreground/90">
                  {parsed.query}
                </span>
              </div>
            )}
            {parsed.prompt && (
              <div className="mt-1 text-xs text-muted-foreground">
                <MessageResponse>{parsed.prompt}</MessageResponse>
              </div>
            )}
          </div>
        )}

        {!hasOtherStructured && parsed.contentText && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs text-foreground/90">
            <MessageResponse>{parsed.contentText}</MessageResponse>
          </div>
        )}

        {!hasStructured && (
          <pre className="max-h-44 overflow-auto rounded-md border border-border/60 bg-muted/20 p-2 text-xs whitespace-pre text-foreground/90">
            {parsed.jsonPreview}
          </pre>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {permission.options.map((opt) => {
          const reject = isRejectKind(opt.kind)
          const label = localizer.localizePermissionKind(opt.kind, opt.name)
          return (
            <Button
              key={opt.option_id}
              variant={reject ? "destructive" : "default"}
              className="h-auto min-h-8 whitespace-normal break-words text-left px-3 text-sm rounded-full"
              onClick={() => onRespond(permission.request_id, opt.option_id)}
            >
              {label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
