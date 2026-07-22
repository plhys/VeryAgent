"use client"

/**
 * Combined settings page: Model Providers + Vision Bridge (multimodal routing).
 * Spacing matches General / Appearance exactly:
 *   outer ScrollArea > w-full space-y-4 p-3 md:p-4
 *   children render card sections only (no extra padding)
 */

import { ScrollArea } from "@/components/ui/scroll-area"
import { ModelProviderSettingsBody } from "@/components/settings/model-provider-settings"
import { VisionBridgeSettingsBody } from "@/components/settings/vision-bridge-settings"

export function ModelRoutingSettings() {
  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">
        <ModelProviderSettingsBody embedded />
        <VisionBridgeSettingsBody embedded />
      </div>
    </ScrollArea>
  )
}
