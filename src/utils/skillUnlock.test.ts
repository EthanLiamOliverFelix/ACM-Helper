import { describe, expect, it } from 'vitest'
import type { SkillNode } from '../types'
import { skillPrerequisitesMet } from './skillUnlock'

const skill = { id: 'graphs', prerequisites: ['dfs', 'bfs'] } as SkillNode

describe('skill tree skip unlocks', () => {
  it('accepts mastered and skipped prerequisites together', () => {
    expect(skillPrerequisitesMet(skill, new Set(['dfs']), new Set(['bfs']))).toBe(true)
  })

  it('does not treat a missing prerequisite as completed', () => {
    expect(skillPrerequisitesMet(skill, new Set(['dfs']), new Set())).toBe(false)
  })

  it('relocks the node when a skip is removed', () => {
    const mastered = new Set(['dfs'])
    const skipped = new Set(['bfs'])
    expect(skillPrerequisitesMet(skill, mastered, skipped)).toBe(true)
    skipped.delete('bfs')
    expect(skillPrerequisitesMet(skill, mastered, skipped)).toBe(false)
  })
})
