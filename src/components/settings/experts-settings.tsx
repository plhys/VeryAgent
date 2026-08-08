"use client"

import { SkillsBody } from "@/components/settings/skills-tab"

/** Standalone Experts settings page (backward-compatible route). */
export function ExpertsSettings() {
  return <SkillsBody source="experts" />
}