"use client"

/**
 * Combined settings page: Model Providers + Vision Bridge (multimodal routing).
 * Single nav entry keeps provider credentials and vision routing in one place.
 */

import { ScrollArea } from "@/components/ui/scroll-area"
import { ModelProviderSettingsBody } from "@/components/settings/model-provider-settings"
import { VisionBridgeSettingsBody } from "@/components/settings/vision-bridge-settings"

export function ModelRoutingSettings() {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-2">
        <ModelProviderSettingsBody embedded />
        <div className="mx-3 border-t md:mx-4" />
        <VisionBridgeSettingsBody embedded />
      </div>
    </ScrollArea>
  )
}
