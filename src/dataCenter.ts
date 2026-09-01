import { invoke } from '@tauri-apps/api/core'

export interface DataCenterInfo {
  path: string
  defaultPath: string
  isCustom: boolean
  fileCount: number
  totalBytes: number
}

export interface DataCenterMigrationResult {
  info: DataCenterInfo
  migratedFiles: number
  migratedBytes: number
  cleanupWarning?: string | null
}

export interface DataCenterBackup {
  id: string
  createdAt: number
  reason: string
  fileCount: number
  totalBytes: number
}

export interface DataCenterOperationResult {
  path: string
  fileCount: number
  totalBytes: number
}

export type DataCenterKey =
  | 'settings'
  | 'ai-config'
  | 'practice-review'
  | 'problem-sets'
  | 'contest-favorites'
  | 'local-test-cases'
  | 'ui-layout'
  | 'workspace-tree-state'
  | 'submit-pane-sizes'
  | 'show-problem-tags'
  | 'problem-catalog'
  | 'qoj-archive'

const legacyKeys: Record<DataCenterKey, string> = {
  settings: 'acm-helper-settings',
  'ai-config': 'acm-helper-ai-config',
  'practice-review': 'acm-helper-practice-review-v1',
  'problem-sets': 'acm-helper-problem-sets-v1',
  'contest-favorites': 'acm-helper-contest-favorites-v1',
  'local-test-cases': 'acm-helper-local-test-cases-v1',
  'ui-layout': 'acm-helper-layout',
  'workspace-tree-state': 'acm-helper-workspace-tree-state-v1',
  'submit-pane-sizes': 'acm-helper-submit-pane-sizes',
  'show-problem-tags': 'acm-helper-show-problem-tags',
  'problem-catalog': 'acm-helper-problem-catalog-v1',
  'qoj-archive': 'acm-helper-qoj-archive-v1',
}

const cache = new Map<DataCenterKey, unknown>()
let runtimeInfo: DataCenterInfo | null = null
let backendAvailable = false
let writeQueue: Promise<void> = Promise.resolve()

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readLegacy(key: DataCenterKey): unknown {
  const raw = localStorage.getItem(legacyKeys[key])
  if (raw == null) return undefined
  try { return JSON.parse(raw) }
  catch { return undefined }
}

export async function initializeDataCenter() {
  try {
    runtimeInfo = await invoke<DataCenterInfo>('get_data_center_info')
    backendAvailable = true
    for (const key of Object.keys(legacyKeys) as DataCenterKey[]) {
      let value = await invoke<unknown | null>('read_data_center_value', { key })
      if (value == null) {
        const legacy = readLegacy(key)
        if (legacy !== undefined) {
          await invoke('write_data_center_value', { key, value: legacy })
          value = legacy
          localStorage.removeItem(legacyKeys[key])
        }
      } else {
        // 数据中心已经接管该项目，清理旧副本，避免两套状态再次分叉。
        localStorage.removeItem(legacyKeys[key])
      }
      if (value != null) cache.set(key, value)
    }
    void invoke('ensure_daily_data_center_backup').catch((error) => console.warn('自动备份失败', error))
  } catch (error) {
    console.error('数据中心初始化失败，临时使用旧版浏览器存储', error)
    backendAvailable = false
    for (const key of Object.keys(legacyKeys) as DataCenterKey[]) {
      const value = readLegacy(key)
      if (value !== undefined) cache.set(key, value)
    }
  }
}

export function getDataCenterValue<T>(key: DataCenterKey, fallback: T): T {
  const value = cache.get(key)
  return value === undefined ? fallback : value as T
}

export function saveDataCenterValue(key: DataCenterKey, value: unknown): Promise<void> {
  const snapshot = cloneJson(value)
  cache.set(key, snapshot)
  if (!backendAvailable) {
    localStorage.setItem(legacyKeys[key], JSON.stringify(snapshot))
    return Promise.resolve()
  }
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => invoke<void>('write_data_center_value', { key, value: snapshot }))
  return writeQueue
}

export async function flushDataCenterWrites() {
  await writeQueue
}

export function currentDataCenterInfo() {
  return runtimeInfo
}

export async function refreshDataCenterInfo() {
  runtimeInfo = await invoke<DataCenterInfo>('get_data_center_info')
  backendAvailable = true
  return runtimeInfo
}

export async function pickDataCenterDirectory() {
  return invoke<string | null>('pick_data_center_directory')
}

export async function pickToolchainExecutable(title: string) {
  return invoke<string | null>('pick_toolchain_executable', { title })
}

export async function migrateDataCenter(path: string) {
  await flushDataCenterWrites()
  const result = await invoke<DataCenterMigrationResult>('migrate_data_center', { newPath: path })
  runtimeInfo = result.info
  return result
}

export function listDataCenterBackups() {
  return invoke<DataCenterBackup[]>('list_data_center_backups')
}

export function createDataCenterBackup(reason = 'manual') {
  return invoke<DataCenterBackup>('create_data_center_backup', { reason })
}

export function restoreDataCenterBackup(id: string) {
  return invoke<DataCenterOperationResult>('restore_data_center_backup', { id })
}

export function exportDataCenter() {
  return invoke<DataCenterOperationResult | null>('export_data_center')
}

export function importDataCenter() {
  return invoke<DataCenterOperationResult | null>('import_data_center')
}
