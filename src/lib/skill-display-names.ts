/**
 * Centralised display-name registry for built-in skills.
 *
 * Used by:
 *   - composer skill badges (ReferenceBadge)
 *   - image-generation skill label in message input
 *   - any other place that needs a human-readable name for a skill id
 */

export const SKILL_DISPLAY_NAMES: Record<string, string> = {
  veryagent_image: "通用出图网关",
}

export function getSkillDisplayName(skillId: string | null | undefined): string {
  if (!skillId) return ""
  const key = skillId.replace(/-/g, "_")
  return SKILL_DISPLAY_NAMES[key] ?? skillId
}
