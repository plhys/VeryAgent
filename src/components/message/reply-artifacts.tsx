"use client"

import { memo, useMemo, useState } from "react"
import {
  ChevronRight,
  ExternalLink,
  FileDiff,
  FileIcon,
  FilePlus,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useWorkspaceActions } from "@/contexts/workspace-context"
import {
  CommitFileAdditions,
  CommitFileDeletions,
} from "@/components/ai-elements/commit"
import { UnifiedDiffPreview } from "@/components/diff/unified-diff-preview"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  fileNameOf,
  isAddedFileDiff,
  isRemovedFileDiff,
  normalizeSlashPath,
  toAbsoluteFilePath,
  toFolderRelativePath,
} from "@/lib/file-path-display"
import {
  extractReplyFileChanges,
  type FileChangeStat,
} from "@/lib/session-files"
import { isLocalDesktop, revealItemInDir } from "@/lib/platform"
import type { MessageTurn } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Quiet inline artifacts disclosure at the end of a completed assistant reply
 * (above the `TurnStats` action row inside `HistoricalMessageGroup`).
 *
 * Collapsed state matches TurnStats density: muted text, no card chrome.
 * Expanded content stays useful but stays nested under a soft left rule
 * instead of a full bordered panel.
 *
 * Two independently-collapsible sections:
 *  - "New files": every file the reply created. Open by default — a freshly
 *    written file is usually the thing you want to jump into.
 *  - "Files changed": modified/removed files as a single-open accordion.
 *    Collapsed by default.
 *
 * Diffs are parsed lazily and ONLY once the reply is persisted
 * (`isResponseComplete`), so the streaming hot path never runs diff parsing.
 */
export const ReplyArtifacts = memo(function ReplyArtifacts({
  sourceTurns,
  isResponseComplete,
}: {
  sourceTurns: MessageTurn[]
  isResponseComplete: boolean
}) {
  const t = useTranslations("Folder.chat.replyArtifacts")
  const { activeFolder: folder } = useActiveFolder()
  const { openFilePreview } = useWorkspaceActions()
  const [newFilesOpen, setNewFilesOpen] = useState(true)
  const [changedOpen, setChangedOpen] = useState(false)
  // Single-open accordion: the path of the one changed file whose diff is open.
  const [openPath, setOpenPath] = useState<string | null>(null)

  // Guard parsing behind completion so mid-stream renders stay diff-free.
  const files = useMemo(
    () => (isResponseComplete ? extractReplyFileChanges(sourceTurns) : []),
    [isResponseComplete, sourceTurns]
  )

  // Split created files (their own rows) from modified/removed files (the
  // accordion). Removal wins over creation, so a create+delete in the same
  // reply lands in "changed", not "new files".
  const { addedFiles, changedFiles } = useMemo(() => {
    const addedFiles: FileChangeStat[] = []
    const changedFiles: FileChangeStat[] = []
    for (const file of files) {
      if (!isRemovedFileDiff(file.diff) && isAddedFileDiff(file.diff)) {
        addedFiles.push(file)
      } else {
        changedFiles.push(file)
      }
    }
    return { addedFiles, changedFiles }
  }, [files])

  if (!isResponseComplete) return null
  if (files.length === 0) return null

  const folderPath = folder?.path

  const openInTabs = (file: FileChangeStat) => {
    // openFilePreview accepts absolute paths (any location) and paths
    // relative to the active folder — agent-reported paths are one of the
    // two, so hand them over as-is.
    void openFilePreview(normalizeSlashPath(file.path))
  }

  const revealInFolder = (file: FileChangeStat) => {
    const absolute = toAbsoluteFilePath(file.path, folderPath)
    if (absolute) void revealItemInDir(absolute)
  }

  const totalAdditions = changedFiles.reduce((sum, f) => sum + f.additions, 0)
  const totalDeletions = changedFiles.reduce((sum, f) => sum + f.deletions, 0)

  return (
    <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
      {addedFiles.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={newFilesOpen}
            onClick={() => setNewFilesOpen((prev) => !prev)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <FilePlus className="h-3 w-3 shrink-0 opacity-70" />
            <span className="truncate">{t("newFilesTitle")}</span>
            <span className="tabular-nums opacity-70">
              {t("fileCount", { count: addedFiles.length })}
            </span>
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 opacity-50 transition-transform",
                newFilesOpen && "rotate-90"
              )}
            />
          </button>

          {newFilesOpen && (
            <TooltipProvider delayDuration={300}>
              <div className="@container ms-1.5 mt-0.5 max-h-80 overflow-y-auto border-s border-border/50 ps-2.5">
                <div className="grid gap-1 @md:grid-cols-2">
                  {addedFiles.map((file) => {
                    const displayPath = toFolderRelativePath(
                      file.path,
                      folderPath
                    )
                    const name = fileNameOf(displayPath)
                    const dir =
                      displayPath === name
                        ? ""
                        : displayPath.slice(
                            0,
                            displayPath.length - name.length - 1
                          )

                    return (
                      <div
                        key={file.id}
                        className="flex min-w-0 items-center gap-0.5 rounded-md transition-colors hover:bg-muted/40"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => openInTabs(file)}
                              title={displayPath}
                              aria-label={t("openFile", {
                                filePath: displayPath,
                              })}
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              <FileIcon className="h-3 w-3 shrink-0 opacity-70" />
                              <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                                <span className="truncate text-foreground/90">
                                  {name}
                                </span>
                                {dir && (
                                  <span className="min-w-0 flex-1 truncate text-[10px] opacity-60">
                                    {dir}
                                  </span>
                                )}
                              </span>
                              {file.additions > 0 && (
                                <CommitFileAdditions
                                  count={file.additions}
                                  className="shrink-0 font-mono text-[10px] opacity-80"
                                />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {t("openInEditor")}
                          </TooltipContent>
                        </Tooltip>

                        {isLocalDesktop() && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => revealInFolder(file)}
                                aria-label={t("revealInFolder")}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-60 transition-colors hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {t("revealInFolder")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </TooltipProvider>
          )}
        </div>
      )}

      {changedFiles.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={changedOpen}
            onClick={() => setChangedOpen((prev) => !prev)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <FileDiff className="h-3 w-3 shrink-0 opacity-70" />
            <span className="truncate">{t("title")}</span>
            <span className="tabular-nums opacity-70">
              {t("fileCount", { count: changedFiles.length })}
            </span>
            {/* Always render BOTH counts (incl. zeros) so a one-sided reply
                still shows its +N and -N. */}
            <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums opacity-80">
              <span className="text-green-600/80 dark:text-green-400/80">
                +{totalAdditions}
              </span>
              <span className="text-red-600/80 dark:text-red-400/80">
                -{totalDeletions}
              </span>
            </span>
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 opacity-50 transition-transform",
                changedOpen && "rotate-90"
              )}
            />
          </button>

          {changedOpen && (
            <ul className="ms-1.5 mt-0.5 max-h-80 space-y-0.5 overflow-y-auto border-s border-border/50 ps-2.5">
              {changedFiles.map((file) => {
                const displayPath = toFolderRelativePath(file.path, folderPath)
                const name = fileNameOf(displayPath)
                const dir =
                  displayPath === name
                    ? ""
                    : displayPath.slice(0, displayPath.length - name.length - 1)
                const isRemoved = isRemovedFileDiff(file.diff)
                const isOpen = openPath === file.path

                return (
                  <li key={file.id} className="min-w-0">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenPath(isOpen ? null : file.path)}
                      title={displayPath}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        isOpen && "bg-muted/30"
                      )}
                    >
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 shrink-0 opacity-50 transition-transform",
                          isOpen && "rotate-90"
                        )}
                      />
                      <FileIcon
                        className={cn(
                          "h-3 w-3 shrink-0 opacity-70",
                          isRemoved && "text-destructive opacity-90"
                        )}
                      />
                      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                        <span
                          className={cn(
                            "min-w-0 truncate text-foreground/90",
                            isRemoved && "text-destructive"
                          )}
                        >
                          {name}
                        </span>
                        {dir && (
                          <span className="min-w-0 flex-1 truncate text-[10px] opacity-60">
                            {dir}
                          </span>
                        )}
                      </span>
                      {isRemoved ? (
                        <span className="shrink-0 text-[10px] text-destructive/80">
                          {t("remove")}
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] opacity-80">
                          <CommitFileAdditions
                            count={file.additions}
                            className="text-[10px]"
                          />
                          <CommitFileDeletions
                            count={file.deletions}
                            className="text-[10px]"
                          />
                        </span>
                      )}
                    </button>

                    {isOpen &&
                      (file.diff ? (
                        <div className="mt-0.5 overflow-hidden rounded-md border border-border/60">
                          <UnifiedDiffPreview diffText={file.diff} embedded />
                        </div>
                      ) : (
                        <p className="px-1.5 py-1 text-[11px] opacity-70">
                          {t("noDiffDataAvailable", { filePath: displayPath })}
                        </p>
                      ))}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
})
