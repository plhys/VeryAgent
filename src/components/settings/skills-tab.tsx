"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { FolderOpen, Loader2, RefreshCw } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  SkillAgentMatrix,
  type MatrixSkill,
} from "@/components/settings/skill-agent-matrix"
import {
  acpListAgents,
  expertsApplyLinks,
  expertsList,
  expertsListAllInstallStatuses,
  expertsOpenCentralDir,
  expertsReadContent,
  scienceApplyLinks,
  scienceList,
  scienceListAllInstallStatuses,
  scienceReadContent,
  openFolder,
} from "@/lib/api"
import { revealItemInDir } from "@/lib/platform"
import { getActiveRemoteConnectionId, isDesktop } from "@/lib/transport"
import { invalidateAgentSkillsCache } from "@/hooks/use-agent-skills"
import { piUsesCustomAgentDir } from "@/lib/pi-config"
import type { AcpAgentInfo, ExpertLinkState, ExpertListItem } from "@/lib/types"
import { toErrorMessage } from "@/lib/app-error"
import { getExpertIcon } from "@/lib/expert-presentation"
import { getScienceIcon } from "@/lib/science-presentation"
import { pickLocalized } from "@/lib/expert-presentation"

/** 技能源类型：experts 或 science */
type SkillSource = "experts" | "science"

/** 行业分类排序 */
const CATEGORY_SORT: Record<string, Record<string, number>> = {
  experts: {
    development: 1,
    office: 2,
    academic: 3,
    creative: 4,
    help: 5,
  },
  science: {
    academic: 1,
  },
}

interface SkillsBodyProps {
  source: SkillSource
  onRegisterRefresh?: (refresh: () => void) => void
}

export function SkillsBody({ source, onRegisterRefresh }: SkillsBodyProps) {
  const t = useTranslations(
    source === "experts" ? "ExpertsSettings" : "ScienceSettings"
  )
  const locale = useLocale()
  const isExperts = source === "experts"

  const [skills, setSkills] = useState<ExpertListItem[]>([])
  const [agents, setAgents] = useState<AcpAgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [skillList, agentList] = await Promise.all([
        isExperts ? expertsList() : scienceList(),
        acpListAgents(),
      ])
      setSkills(skillList)
      setAgents(agentList.filter((agent) => !piUsesCustomAgentDir(agent)))
      setReloadKey((k) => k + 1)
    } catch (err) {
      setLoadError(toErrorMessage(err))
      setSkills([])
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [isExperts])

  useEffect(() => {
    refresh().catch((err) => {
      console.error(`[SkillsBody/${source}] initial refresh failed:`, err)
    })
  }, [refresh, source])

  useEffect(() => {
    onRegisterRefresh?.(() => {
      refresh().catch((err) => {
        console.error(`[SkillsBody/${source}] refresh failed:`, err)
      })
    })
  }, [onRegisterRefresh, refresh, source])

  const translatedCategory = useCallback(
    (category: string): string => {
      return t(`categories.${category}` as any) || category
    },
    [t]
  )

  const translatedState = useCallback(
    (state: ExpertLinkState): string => {
      switch (state) {
        case "not_linked":
          return t("states.not_linked")
        case "linked":
          return t("states.linked_to_veryagent")
        default:
          return state
      }
    },
    [t]
  )

  const matrixSkills = useMemo<MatrixSkill[]>(
    () =>
      skills.map((s: any) => {
        const badge: MatrixSkill["badge"] = s.user_modified
          ? { label: t("badges.userModified"), tone: "amber" }
          : !isExperts && s.metadata?.needs_key
            ? { label: t("badges.needsKey"), tone: "amber" }
            : !isExperts && s.metadata?.needs_env
              ? { label: t("badges.needsSetup"), tone: "muted" }
              : undefined
        return {
          id: s.metadata.id,
          category: s.metadata.category,
          displayName:
            pickLocalized(s.metadata.display_name, locale) || s.metadata.id,
          description: pickLocalized(s.metadata.description, locale),
          icon: isExperts
            ? getExpertIcon(s.metadata.icon)
            : getScienceIcon(s.metadata.icon),
          ready: true,
          badge,
        }
      }),
    [skills, locale, t, isExperts]
  )

  const handleOpenCentralDir = useCallback(async () => {
    try {
      const path = await expertsOpenCentralDir()
      if (isDesktop() && getActiveRemoteConnectionId() === null) {
        await revealItemInDir(path)
      } else {
        await openFolder(path)
      }
    } catch (err) {
      toast.error(t("toasts.openFolderFailed"), {
        description: toErrorMessage(err),
      })
    }
  }, [t])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-3 md:p-4">
      {isExperts && (
        <div className="flex items-center justify-between gap-3 pb-4">
          <div>
            <h2 className="text-base font-semibold">{t("title")}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {t("description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                handleOpenCentralDir().catch((err) => {
                  console.error(
                    `[SkillsBody/${source}] open central dir failed:`,
                    err
                  )
                })
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("actions.openCentralDir")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                refresh().catch((err) => {
                  console.error(
                    `[SkillsBody/${source}] refresh failed:`,
                    err
                  )
                })
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("actions.refresh")}
            </Button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {loadError}
        </div>
      )}

      {skills.length === 0 ? (
        <div className="h-full rounded-lg border bg-card flex items-center justify-center text-sm text-muted-foreground">
          {isExperts ? t("emptyExperts") : t("emptySkills")}
        </div>
      ) : (
        <div className="flex-1 min-h-0 min-w-0">
          <SkillAgentMatrix
            key={reloadKey}
            skills={matrixSkills}
            agents={agents}
            categoryOrder={CATEGORY_SORT[source]}
            translateCategory={translatedCategory}
            translateState={translatedState}
            loadAllStatuses={
              isExperts
                ? expertsListAllInstallStatuses
                : scienceListAllInstallStatuses
            }
            applyLinks={isExperts ? expertsApplyLinks : scienceApplyLinks}
            loadContent={isExperts ? expertsReadContent : scienceReadContent}
            onApplied={(touched) =>
              touched.forEach((a) => invalidateAgentSkillsCache(a))
            }
            searchPlaceholder={t("searchPlaceholder")}
          />
        </div>
      )}
    </div>
  )
}