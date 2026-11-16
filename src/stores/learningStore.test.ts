import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SKILL_BY_ID } from '../data/skillTree'
import type { SkillPlanProblem } from '../types'
import { useLearningStore } from './learningStore'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const skill = SKILL_BY_ID.get('two-pointers')!
const problem: SkillPlanProblem = {
  platform: 'atcoder',
  id: 'ABC399_A',
  title: 'Hamming Distance',
  url: 'https://atcoder.jp/contests/abc399/tasks/abc399_a',
  reason: '基础巩固',
}

describe('AtCoder completion in skill plans', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(invoke).mockReset()
  })

  it('checks off an uppercase plan entry after recording a lowercase AC', async () => {
    const learning = useLearningStore()
    learning.profile.masteredSkills = ['complexity', 'sorting']
    await learning.startSkillPlan(skill, [problem])
    expect(learning.planProgress(skill.id)).toEqual({ solved: 0, total: 1 })

    await learning.recordAccepted('atcoder:abc399_a', [])

    expect(learning.isSolved('atcoder:ABC399_A')).toBe(true)
    expect(learning.planProgress(skill.id)).toEqual({ solved: 1, total: 1 })
    expect(learning.statusOf(skill)).toBe('mastered')
    expect(learning.profile.skillLastPracticedAt[skill.id]).toBeGreaterThan(0)
    expect(invoke).toHaveBeenLastCalledWith('save_learning_profile', {
      profile: expect.objectContaining({ masteredSkills: expect.arrayContaining([skill.id]) }),
    })
  })

  it('recognizes an existing AC after loading the profile without resubmission', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      solvedProblems: ['atcoder:abc399_a'],
      learningSkills: [skill.id],
      masteredSkills: ['complexity', 'sorting'],
      skillPlans: { [skill.id]: { skillId: skill.id, generatedAt: 1, problems: [problem] } },
    })
    const learning = useLearningStore()
    await learning.init()

    expect(learning.planProgress(skill.id)).toEqual({ solved: 1, total: 1 })
    expect(learning.statusOf(skill)).toBe('mastered')
    expect(learning.isSolved('codeforces:ABC399_A')).toBe(false)
  })
})
