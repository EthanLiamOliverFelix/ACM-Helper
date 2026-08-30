export type Difficulty =
  | '暂无评定' | '入门' | '普及-' | '普及' | '普及+/提高-'
  | '提高' | '提高+/省选-' | '省选/NOI-' | 'NOI/NOI+/CTS'
export type Language = 'cpp' | 'python' | 'java'
export type Platform = 'codeforces' | 'luogu' | 'atcoder' | 'local'

/** CF 评测状态 */
export type Verdict =
  | 'Pending'
  | 'Compiling'
  | 'Running'
  | 'Accepted'
  | 'Wrong Answer'
  | 'Time Limit Exceeded'
  | 'Runtime Error'
  | 'Memory Limit Exceeded'
  | 'Compilation Error'
  | 'Skipped'
  | 'Interrupted'
  | 'Failed'

export interface Problem {
  id: string
  title: string
  rating?: number
  difficulty?: Difficulty
  tags: string[]
  platform: Platform
  source?: string
  contentFormat?: 'html' | 'markdown' | 'text'
  description?: string
  url?: string
  timeLimitMs?: number
  memoryLimitMb?: number
  input?: string
  output?: string
  note?: string
  samples?: SampleCase[]
}

export interface LuoguTag {
  id: number
  name: string
  tagType: number
}

export interface LuoguProblemPage {
  problems: Problem[]
  count: number
  perPage: number
  tags: LuoguTag[]
}

export interface LuoguTrainingCategory {
  key: string
  name: string
}

export interface LuoguTrainingSummary {
  id: number
  name: string
  providerName: string
  problemCount: number
  markCount: number
  trainingType: string
}

export interface LuoguTrainingPage {
  trainings: LuoguTrainingSummary[]
  count: number
  perPage: number
  categories: LuoguTrainingCategory[]
}

export interface LuoguTrainingDetail {
  id: number
  name: string
  description: string
  providerName: string
  problems: Problem[]
}

export interface SampleCase {
  input: string
  output: string
}

export interface RunResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  compileDurationMs?: number
  timedOut: boolean
}

export type LocalTestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'completed' | 'error'

export interface LocalTestCase {
  id: string
  input: string
  expectedOutput: string
  actualOutput: string
  stderr: string
  status: LocalTestStatus
  durationMs?: number
  compileDurationMs?: number
  timedOut?: boolean
}

export interface DebugResult {
  success: boolean
  adapter: string
  output: string
  stdout: string
  stderr: string
  durationMs: number
  diagnostic?: string
}

export interface DebugVariable {
  name: string
  value: string
  error?: string | null
}

export interface DebugSessionState {
  sessionId: string
  adapter: string
  active: boolean
  paused: boolean
  line?: number | null
  function: string
  variables: DebugVariable[]
  watches: DebugVariable[]
  stdout: string
  stderr: string
  message: string
}

export interface ToolchainInfo {
  id: string
  label: string
  available: boolean
  version: string
  purpose: string
}

export interface DraftFileInfo {
  platform: Platform
  problemId: string
  title?: string
  language: Language
  path: string
  createdAt: number
  unbound: boolean
}

export interface WorkspaceEntry {
  name: string
  path: string
  isDirectory: boolean
  language?: Language | null
  draft?: DraftFileInfo | null
  children: WorkspaceEntry[]
}

export interface NoteEntry {
  name: string
  path: string
  isDirectory: boolean
  updatedAt: number
  children: NoteEntry[]
}

export interface NoteDocument {
  name: string
  path: string
  content: string
  updatedAt: number
}

export type SkillStatus = 'locked' | 'available' | 'learning' | 'mastered'

export interface SkillNode {
  id: string
  name: string
  category: string
  description: string
  prerequisites: string[]
  tags: string[]
  level: number
}

export interface LearningProfile {
  solvedProblems: string[]
  learningSkills: string[]
  masteredSkills: string[]
  updatedAt: number
  skillEvidence: Record<string, string[]>
  /** Latest plan kept for backward compatibility with older profiles. */
  skillPlans: Record<string, SkillLearningPlan>
  /** Every generated practice plan, ordered oldest to newest. */
  skillPlanPages: Record<string, SkillLearningPlan[]>
  /** Last time a solved problem exercised this skill. */
  skillLastPracticedAt: Record<string, number>
}

export interface SkillPlanProblem {
  platform: 'codeforces' | 'luogu'
  id: string
  title: string
  url: string
  rating?: number
  reason: string
}

export interface SkillLearningPlan {
  skillId: string
  generatedAt: number
  problems: SkillPlanProblem[]
}

export interface ContestProblemAnalysis {
  id: string
  title: string
  rating?: number
  tags: string[]
  missingSkills: string[]
}

export interface ContestAnalysis {
  platform: Platform
  contestId: string
  title: string
  url: string
  tags: string[]
  problems: ContestProblemAnalysis[]
}

export type AssistanceLevel = 'hint' | 'guided' | 'full'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  problemSet?: GeneratedProblemSet
}

export interface GeneratedProblemSet {
  name: string
  problems: SkillPlanProblem[]
}

export interface AiChatResult {
  text: string
  responseId?: string
}

export interface Submission {
  id: string
  problemId: string
  status: Verdict
  language: Language
  timestamp: number
  timeMs?: number
  memoryBytes?: number
  platform?: Platform
  message?: string
  remoteId?: number
  score?: number
}

export interface LuoguRecordTestCase {
  id: number
  status: number
  score: number
  timeMs: number
  memoryBytes: number
  description?: string
  signal?: number
  exitCode?: number
}

export interface LuoguRecordSubtask {
  id: number
  status: number
  score: number
  testCases: LuoguRecordTestCase[]
}

export interface LuoguRecordDetail {
  recordId: number
  problemId: string
  problemTitle: string
  status: number
  score?: number
  submitTime?: number
  language?: string | number
  sourceCodeLength?: number
  timeMs?: number
  memoryBytes?: number
  compileSuccess?: boolean
  compileMessage?: string
  subtasks: LuoguRecordSubtask[]
}
