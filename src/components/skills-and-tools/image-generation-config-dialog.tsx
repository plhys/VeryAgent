"use client"

/**
 * Image-generation config dialog opened from the veryagent-image skill card.
 * Reuses the same platform settings body / storage as Settings → 通用出图网关.
 */

import { useTranslations } from "next-intl"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ImageGenerationSettingsBody } from "@/components/settings/image-generation-settings"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface ImageGenerationConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImageGenerationConfigDialog({
  open,
  onOpenChange,
}: ImageGenerationConfigDialogProps) {
  const t = useTranslations("ImageGenerationSettings")
  const tSkills = useTranslations("SkillsAndTools")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,820px)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
          <DialogTitle className="text-base">
            {tSkills("imageSkillSettingsTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {tSkills("imageSkillSettingsDesc")}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {/* Hide the duplicate page title row: body already has its own sections */}
            <ImageGenerationSettingsBody embedded />
          </div>
        </ScrollArea>
        <p className="shrink-0 border-t px-4 py-2 text-[11px] text-muted-foreground">
          {t("restartHint")}
        </p>
      </DialogContent>
    </Dialog>
  )
}
