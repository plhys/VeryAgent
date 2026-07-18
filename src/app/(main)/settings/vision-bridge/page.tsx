import { redirect } from "next/navigation"

/** Legacy route — multimodal routing now lives under Model Providers. */
export default function SettingsVisionBridgePage() {
  redirect("/settings/model-providers")
}
