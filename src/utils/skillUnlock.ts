import type { SkillNode } from '../types'

export function satisfiesSkillPrerequisite(skillId: string, mastered: ReadonlySet<string>, skipped: ReadonlySet<string>): boolean {
  return mastered.has(skillId) || skipped.has(skillId)
}

export function skillPrerequisitesMet(skill: SkillNode, mastered: ReadonlySet<string>, skipped: ReadonlySet<string>): boolean {
  return skill.prerequisites.every((skillId) => satisfiesSkillPrerequisite(skillId, mastered, skipped))
}
