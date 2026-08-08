"use client"

import { SkillsBody } from "@/components/settings/skills-tab"

/** Standalone Science settings page (backward-compatible route). */
export function ScienceSettings() {
  return <SkillsBody source="science" />
}