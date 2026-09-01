<script setup lang="ts">
import { ref } from 'vue'
import { useAiStore } from '../stores/aiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useProblemStore } from '../stores/problemStore'
import { useNoteStore } from '../stores/noteStore'
import type { ToolchainPaths } from '../stores/settingsStore'
import type { Language } from '../types'
import { openUrl } from '@tauri-apps/plugin-opener'
import { clearOjDiagnostics, exportOjDiagnostics, getOjDiagnostics, type OjDiagnosticEntry } from '../diagnostics'
import {
  currentDataCenterInfo,
  flushDataCenterWrites,
  createDataCenterBackup,
  exportDataCenter,
  importDataCenter,
  listDataCenterBackups,
  migrateDataCenter,
  pickDataCenterDirectory,
  pickToolchainExecutable,
  refreshDataCenterInfo,
  restoreDataCenterBackup,
  type DataCenterBackup,
  type DataCenterInfo,
} from '../dataCenter'

defineProps<{ layout: Record<'showSidebar' | 'showStatement' | 'showEditor' | 'showRunner', boolean> }>()
const emit = defineEmits<{ toggleView: [key: 'showSidebar' | 'showStatement' | 'showEditor' | 'showRunner'] }>()
const ai = useAiStore()
const settings = useSettingsStore()
const problems = useProblemStore()
const notes = useNoteStore()
const viewOpen = ref(false)
const settingsOpen = ref(false)
const settingsPage = ref<'main' | 'translation' | 'solution'>('main')
const language = ref<Language>('cpp')
const savedNotice = ref('')
const dataCenterInfo = ref<DataCenterInfo | null>(currentDataCenterInfo())
const dataCenterPath = ref(dataCenterInfo.value?.path ?? '')
const dataCenterBusy = ref(false)
const dataCenterMessage = ref('')
const dataCenterError = ref('')
const dataCenterBackups = ref<DataCenterBackup[]>([])
const ojDiagnostics = ref<OjDiagnosticEntry[]>([])
type ToolchainKey = keyof ToolchainPaths
const toolchainFields: { key: ToolchainKey; label: string; fallback: string }[] = [
  { key: 'cppCompiler', label: 'C++ 编译器', fallback: 'g++' },
  { key: 'cppDebugger', label: 'C++ 调试器', fallback: 'gdb' },
  { key: 'pythonInterpreter', label: 'Python 解释器', fallback: 'python' },
  { key: 'javaCompiler', label: 'Java 编译器', fallback: 'javac' },
  { key: 'javaRuntime', label: 'Java 运行时', fallback: 'java' },
  { key: 'javaDebugger', label: 'Java 调试器', fallback: 'jdb' },
]
const toolchainWebsites = [
  { label: 'GCC / GDB（MSYS2）', url: 'https://www.msys2.org/' },
  { label: 'Python', url: 'https://www.python.org/downloads/windows/' },
  { label: 'Java JDK（Eclipse Temurin）', url: 'https://adoptium.net/temurin/releases/' },
]
const views = [
  { key: 'showSidebar' as const, label: '题库、题单与资源管理器' },
  { key: 'showStatement' as const, label: '题面' },
  { key: 'showEditor' as const, label: '代码编辑器' },
  { key: 'showRunner' as const, label: '运行与提交' },
]

async function saveSettings() {
  await Promise.all([settings.save(), ai.saveConfig()])
  savedNotice.value = '设置已保存'
  window.setTimeout(() => { savedNotice.value = '' }, 1800)
}
async function openSettings() {
  settingsPage.value = 'main'
  settingsOpen.value = true
  viewOpen.value = false
  void problems.refreshAccounts()
  try {
    dataCenterInfo.value = await refreshDataCenterInfo()
    dataCenterPath.value = dataCenterInfo.value.path
    dataCenterBackups.value = await listDataCenterBackups()
    ojDiagnostics.value = await getOjDiagnostics(20)
  } catch (cause) { dataCenterError.value = String(cause) }
}
function diagnosticTime(timestamp: number) { return new Date(timestamp).toLocaleString() }
async function exportDiagnostics() {
  try {
    const path = await exportOjDiagnostics()
    if (path) dataCenterMessage.value = `诊断日志已导出到 ${path}`
  } catch (cause) { dataCenterError.value = String(cause) }
}
async function clearDiagnostics() {
  if (!window.confirm('清空本机 OJ 诊断日志？')) return
  await clearOjDiagnostics()
  ojDiagnostics.value = []
}
async function prepareDataCenterOperation() {
  await problems.persistDraft()
  await notes.saveActive()
  await Promise.all([settings.save(), ai.saveConfig()])
  await flushDataCenterWrites()
}
async function createBackup() {
  dataCenterBusy.value = true; dataCenterError.value = ''; dataCenterMessage.value = ''
  try {
    await prepareDataCenterOperation()
    const backup = await createDataCenterBackup()
    dataCenterBackups.value = await listDataCenterBackups()
    dataCenterMessage.value = `备份完成：${new Date(backup.createdAt * 1000).toLocaleString()}`
  } catch (cause) { dataCenterError.value = String(cause) }
  finally { dataCenterBusy.value = false }
}
async function restoreBackup(backup: DataCenterBackup) {
  if (!window.confirm(`恢复 ${new Date(backup.createdAt * 1000).toLocaleString()} 的备份？\n当前数据会先自动生成保护备份。`)) return
  dataCenterBusy.value = true; dataCenterError.value = ''; dataCenterMessage.value = ''
  try {
    await prepareDataCenterOperation()
    await restoreDataCenterBackup(backup.id)
    dataCenterMessage.value = '恢复完成，程序即将重新载入'
    window.setTimeout(() => window.location.reload(), 1200)
  } catch (cause) { dataCenterError.value = String(cause) }
  finally { dataCenterBusy.value = false }
}
async function exportAllData() {
  dataCenterBusy.value = true; dataCenterError.value = ''; dataCenterMessage.value = ''
  try {
    await prepareDataCenterOperation()
    const result = await exportDataCenter()
    if (result) dataCenterMessage.value = `已导出 ${result.fileCount} 个文件到 ${result.path}`
  } catch (cause) { dataCenterError.value = String(cause) }
  finally { dataCenterBusy.value = false }
}
async function importAllData() {
  if (!window.confirm('从外部数据中心导出目录导入？\n当前数据会先自动生成保护备份，导入完成后应用将重新载入。')) return
  dataCenterBusy.value = true; dataCenterError.value = ''; dataCenterMessage.value = ''
  try {
    await prepareDataCenterOperation()
    const result = await importDataCenter()
    if (result) {
      dataCenterMessage.value = `已导入 ${result.fileCount} 个文件，程序即将重新载入`
      window.setTimeout(() => window.location.reload(), 1200)
    }
  } catch (cause) { dataCenterError.value = String(cause) }
  finally { dataCenterBusy.value = false }
}
function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
async function browseDataCenter() {
  const selected = await pickDataCenterDirectory()
  if (selected) dataCenterPath.value = selected
}
function restoreDefaultDataCenter() {
  if (dataCenterInfo.value) dataCenterPath.value = dataCenterInfo.value.defaultPath
}
async function browseToolchain(key: ToolchainKey, label: string) {
  const selected = await pickToolchainExecutable(`选择${label}`)
  if (selected) settings.toolchainPaths[key] = selected
}
async function moveDataCenter() {
  const target = dataCenterPath.value.trim()
  dataCenterError.value = ''
  dataCenterMessage.value = ''
  if (!target) { dataCenterError.value = '请选择数据中心目录'; return }
  if (dataCenterInfo.value && target.toLowerCase() === dataCenterInfo.value.path.toLowerCase()) {
    dataCenterMessage.value = '当前已经使用这个目录'
    return
  }
  if (!window.confirm(`将全部业务数据迁移到：\n${target}\n\n迁移会在完整校验后切换目录，并清理旧目录中的业务文件。是否继续？`)) return
  dataCenterBusy.value = true
  try {
    await prepareDataCenterOperation()
    const result = await migrateDataCenter(target)
    dataCenterInfo.value = result.info
    dataCenterPath.value = result.info.path
    dataCenterMessage.value = result.cleanupWarning
      ? `迁移完成，但旧目录清理未完全成功：${result.cleanupWarning}`
      : `已迁移 ${result.migratedFiles} 个文件（${formatBytes(result.migratedBytes)}），程序即将重新载入`
    window.setTimeout(() => window.location.reload(), 1500)
  } catch (cause) {
    dataCenterError.value = String(cause)
  } finally {
    dataCenterBusy.value = false
  }
}
</script>

<template>
  <header class="topbar">
    <div class="topbar__brand">ACM Helper</div>
    <div class="topbar__menu">
      <button :class="{ active: viewOpen }" @click="viewOpen = !viewOpen">视图</button>
      <div v-if="viewOpen" class="view-menu">
        <label v-for="item in views" :key="item.key"><input type="checkbox" :checked="layout[item.key]" @change="emit('toggleView', item.key)" />{{ item.label }}</label>
        <small>显示状态和面板尺寸会自动保存在本机。</small>
      </div>
      <button @click="openSettings">设置</button>
    </div>
    <div class="topbar__hint">{{ savedNotice }}</div>
  </header>

  <div v-if="settingsOpen" class="settings-modal" @click.self="settingsOpen = false">
    <section class="settings-card">
      <header><button v-if="settingsPage !== 'main'" class="settings-back" @click="settingsPage = 'main'">‹</button><div><h2>{{ settingsPage === 'main' ? '设置' : settingsPage === 'translation' ? '翻译模型' : '解题模型' }}</h2><p>{{ settingsPage === 'main' ? '应用、账号与数据管理' : settingsPage === 'translation' ? '用于翻译 Codeforces 与 AtCoder 英文题面' : '用于刷题助手、题单生成与学习建议' }}</p></div><button class="settings-close" @click="settingsOpen = false">×</button></header>
      <div v-if="settingsPage === 'main'" class="settings-grid">
        <section>
          <h3>新题目默认代码</h3>
          <div class="language-tabs"><button v-for="item in (['cpp', 'python', 'java'] as Language[])" :key="item" :class="{ active: language === item }" @click="language = item">{{ item === 'cpp' ? 'C++' : item === 'python' ? 'Python' : 'Java' }}</button></div>
          <textarea v-model="settings.codeTemplates[language]" spellcheck="false" />
          <button class="secondary" @click="settings.resetTemplate(language)">恢复当前语言默认模板</button>
          <h3 class="runner-settings-title">本地运行输出</h3>
          <label>最多完整显示行数<input v-model.number="settings.outputLineLimit" type="number" min="1" max="10000" step="50" /></label>
          <p class="privacy">默认 300 行。超出后显示 [Truncated]，并保留最前面的指定行数。</p>
          <h3 class="runner-settings-title">代码格式化</h3>
          <label class="checkbox-label"><input v-model="settings.formatOnSave" type="checkbox" />每次按 Ctrl+S 保存时自动格式化</label>
          <p class="privacy">也可以随时按 Shift+Alt+F 手动格式化。内置支持 C++、Python 和 Java，无需另装格式化工具。</p>
          <h3 class="runner-settings-title">本地工具链路径</h3>
          <p class="privacy">留空时自动使用系统 PATH；适合免安装 MinGW、多 Python 环境或自定义 JDK。</p>
          <label v-for="field in toolchainFields" :key="field.key">{{ field.label }}<div class="path-picker"><input v-model="settings.toolchainPaths[field.key]" :placeholder="`留空使用 ${field.fallback}`" /><button type="button" @click="browseToolchain(field.key, field.label)">浏览</button></div></label>
          <div class="toolchain-websites"><span>获取工具链</span><button v-for="website in toolchainWebsites" :key="website.url" type="button" @click="openUrl(website.url)">{{ website.label }} ↗</button></div>
        </section>
        <section>
          <h3>AI 模型</h3>
          <div class="ai-entry-list">
            <button @click="settingsPage = 'translation'"><span>译</span><div><strong>翻译模型</strong><small>题面翻译 · {{ ai.translationConfigured ? ai.translationModel : '未配置' }}</small></div><b>进入 ›</b></button>
            <button @click="settingsPage = 'solution'"><span>解</span><div><strong>解题模型</strong><small>刷题助手、题单生成 · {{ ai.isConfigured ? ai.model : '未配置' }}</small></div><b>进入 ›</b></button>
          </div>
          <h3 class="account-title">洛谷提交</h3>
          <label>C++ 版本<select v-model.number="settings.luoguCppLanguageId"><option :value="3">C++98</option><option :value="4">C++11</option><option :value="11">C++14</option><option :value="28">C++14 (GCC 9)</option><option :value="12">C++17</option><option :value="27">C++20</option><option :value="34">C++23</option></select></label>
          <label>Python 版本<select v-model.number="settings.luoguPythonLanguageId"><option :value="7">Python 3</option><option :value="25">PyPy 3</option></select></label>
          <label class="checkbox-label"><input v-model="settings.luoguEnableO2" type="checkbox" />提交时开启 O2 优化</label>
          <p class="privacy">设置会用于之后的洛谷提交；Java 暂按 Java 21 提交。</p>
          <h3 class="account-title">OJ 账号</h3>
          <div class="account-row"><div><span>Codeforces</span><strong :class="{ offline: !problems.isLoggedIn }">{{ problems.isRefreshingAccounts ? '检测中…' : problems.isLoggedIn ? (problems.cfAccount || '已登录') : '未登录' }}</strong></div><button :disabled="problems.isCfLoginOpening" @click="problems.loginViaBrowser">{{ problems.isCfLoginOpening ? '打开中…' : problems.isLoggedIn ? '切换账号' : '登录' }}</button></div>
          <div class="account-row"><div><span>洛谷</span><strong :class="{ offline: !problems.luoguLoggedIn }">{{ problems.isRefreshingAccounts ? '检测中…' : problems.luoguLoggedIn ? (problems.luoguAccount || '已登录') : '未登录' }}</strong></div><button :disabled="problems.isLuoguLoginOpening" @click="problems.loginLuogu">{{ problems.isLuoguLoginOpening ? '打开中…' : problems.luoguLoggedIn ? '切换账号' : '登录' }}</button></div>
          <div class="account-row"><div><span>AtCoder</span><strong :class="{ offline: !problems.atcoderLoggedIn }">{{ problems.isRefreshingAccounts ? '检测中…' : problems.atcoderLoggedIn ? (problems.atcoderAccount || '已登录') : '未登录' }}</strong></div><button :disabled="problems.isAtcoderLoginOpening" @click="problems.loginExternalAccount('atcoder')">{{ problems.isAtcoderLoginOpening ? '登录中…' : problems.atcoderLoggedIn ? '切换账号' : '登录' }}</button></div>
          <button class="secondary" :disabled="problems.isRefreshingAccounts" @click="problems.refreshAccounts">刷新账号状态</button>
          <p class="privacy">AtCoder 仍使用单独的内嵌登录窗口；关闭窗口会立即结束本次登录进程。网页异常不会阻塞其他平台和网络任务。</p>
        </section>
      </div>
      <section v-else class="ai-model-settings">
        <template v-if="settingsPage === 'translation'">
          <label>API 地址<input v-model="ai.translationEndpoint" placeholder="https://api.openai.com/v1" /></label>
          <label>协议<select v-model="ai.translationProtocol"><option value="responses">Responses API</option><option value="chat_completions">Chat Completions</option></select></label>
          <label>模型<input v-model="ai.translationModel" placeholder="翻译模型 ID" /></label>
          <label>API Key<input v-model="ai.translationApiKey" type="password" autocomplete="off" placeholder="输入 API Key" /></label>
          <label class="checkbox-label"><input v-model="ai.translationRememberApiKey" type="checkbox" />将翻译模型的 API Key 保存在这台电脑</label>
          <p class="privacy">翻译只使用这一套接口，不会调用解题模型。旧版本的 AI 配置已自动复制到这里作为初始值。</p>
        </template>
        <template v-else>
          <label>API 地址<input v-model="ai.endpoint" placeholder="https://api.openai.com/v1" /></label>
          <label>协议<select v-model="ai.protocol"><option value="responses">Responses API</option><option value="chat_completions">Chat Completions</option></select></label>
          <label>模型<input v-model="ai.model" placeholder="解题模型 ID" /></label>
          <label>API Key<input v-model="ai.apiKey" type="password" autocomplete="off" placeholder="输入 API Key" /></label>
          <label class="checkbox-label"><input v-model="ai.rememberApiKey" type="checkbox" />将解题模型的 API Key 保存在这台电脑</label>
          <h3>AI 辅助强度</h3>
          <div class="assist-levels"><button v-for="item in [{ id: 'hint', name: '小提示' }, { id: 'guided', name: '分步引导' }, { id: 'full', name: '完整帮助' }]" :key="item.id" :class="{ active: ai.assistanceLevel === item.id }" @click="ai.assistanceLevel = item.id as typeof ai.assistanceLevel">{{ item.name }}</button></div>
          <p class="privacy">解题模型用于对话、知识点题单生成和学习建议，不参与题面翻译。</p>
        </template>
      </section>
      <section v-if="settingsPage === 'main'" class="data-center-settings">
        <div class="data-center-settings__heading"><div><h3>数据中心</h3><p>代码、笔记、翻译、题单、测试点、学习档案、提交记录和应用设置统一保存在这里。</p></div><span v-if="dataCenterInfo">{{ dataCenterInfo.fileCount }} 个文件 · {{ formatBytes(dataCenterInfo.totalBytes) }}</span></div>
        <label>最终存储地址<div class="path-picker"><input v-model="dataCenterPath" spellcheck="false" /><button type="button" :disabled="dataCenterBusy" @click="browseDataCenter">选择目录</button></div></label>
        <div class="data-center-settings__actions"><button v-if="dataCenterInfo?.isCustom" class="secondary" :disabled="dataCenterBusy" @click="restoreDefaultDataCenter">恢复默认地址</button><button class="migrate" :disabled="dataCenterBusy || !dataCenterPath.trim()" @click="moveDataCenter">{{ dataCenterBusy ? '正在复制并校验…' : '迁移全部数据并切换' }}</button></div>
        <div class="data-center-tools"><button :disabled="dataCenterBusy" @click="createBackup">立即备份</button><button :disabled="dataCenterBusy" @click="exportAllData">导出全部</button><button :disabled="dataCenterBusy" @click="importAllData">导入数据</button></div>
        <div v-if="dataCenterBackups.length" class="backup-list"><span>最近备份（自动保留 10 份）</span><button v-for="backup in dataCenterBackups.slice(0, 5)" :key="backup.id" :disabled="dataCenterBusy" @click="restoreBackup(backup)"><b>{{ new Date(backup.createdAt * 1000).toLocaleString() }}</b><small>{{ backup.reason }} · {{ backup.fileCount }} 个文件 · {{ formatBytes(backup.totalBytes) }}</small></button></div>
        <p class="privacy">默认地址是 %APPDATA%\\Vue。迁移成功前不会切换；WebView2 网页缓存仍由系统管理，不属于业务数据中心。</p>
        <p v-if="dataCenterMessage" class="data-center-settings__success">{{ dataCenterMessage }}</p><p v-if="dataCenterError" class="data-center-settings__error">{{ dataCenterError }}</p>
      </section>
      <section v-if="settingsPage === 'main'" class="diagnostic-settings">
        <div><h3>OJ 诊断</h3><p>记录题库、题面、登录、提交和评测详情的阶段、耗时与脱敏错误，不保存 Cookie、验证码、代码或密钥。</p></div>
        <div class="diagnostic-settings__actions"><button @click="exportDiagnostics">导出日志</button><button :disabled="!ojDiagnostics.length" @click="clearDiagnostics">清空</button></div>
        <div v-if="ojDiagnostics.length" class="diagnostic-list"><div v-for="item in ojDiagnostics.slice(0, 6)" :key="`${item.timestamp}-${item.platform}-${item.operation}`" :class="item.status"><span>{{ diagnosticTime(item.timestamp) }}</span><b>{{ item.platform }} · {{ item.operation }}</b><em>{{ item.status === 'success' ? `成功 · ${item.durationMs} ms` : item.message || '失败' }}</em></div></div>
        <p v-else class="privacy">暂无诊断记录。</p>
      </section>
      <footer><span>{{ savedNotice }}</span><button v-if="settingsPage !== 'main'" class="secondary" @click="settingsPage = 'main'">返回设置</button><button class="primary" @click="saveSettings">保存设置</button></footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.topbar { height: 36px; flex: 0 0 36px; display: flex; align-items: center; padding: 0 10px; border-bottom: 1px solid #383838; background: #181818; color: #ccc; user-select: none; &__brand { margin-right: 15px; color: #75bfff; font-size: 12px; font-weight: 700; } &__menu { position: relative; display: flex; height: 100%; align-items: center; > button { height: 27px; padding: 0 10px; border: 0; border-radius: 4px; background: transparent; color: #bbb; cursor: pointer; } > button:hover, > button.active { background: #353535; color: white; } } &__hint { margin-left: auto; color: #68c58e; font-size: 10px; } }
.view-menu { position: absolute; top: 32px; left: 0; z-index: 1300; width: 210px; padding: 7px; border: 1px solid #484848; border-radius: 6px; background: #252526; box-shadow: 0 8px 28px #0008; label { display: flex; gap: 8px; align-items: center; padding: 7px; border-radius: 4px; color: #ddd; font-size: 11px; cursor: pointer; &:hover { background: #37373d; } } small { display: block; padding: 7px; border-top: 1px solid #3b3b3b; color: #777; line-height: 1.4; } }
.settings-modal { position: fixed; inset: 0; z-index: 1800; display: flex; align-items: center; justify-content: center; padding: 24px; background: #000a; }
.settings-card { width: min(1080px, 96vw); max-height: 92vh; overflow: auto; border: 1px solid #4a4a4a; border-radius: 10px; background: #252526; color: #ddd; box-shadow: 0 20px 70px #000b; > header { display: flex; align-items: center; gap: 10px; padding: 17px 20px; border-bottom: 1px solid #3b3b3b; > div { min-width: 0; flex: 1; } h2 { margin: 0; font-size: 19px; } p { margin: 4px 0 0; color: #858585; font-size: 11px; } button { border: 0; background: transparent; color: #aaa; font-size: 24px; cursor: pointer; } .settings-back { width: 30px; padding: 0; color: #9cdcfe; font-size: 29px; }.settings-close { margin-left: auto; } } > footer { display: flex; justify-content: flex-end; align-items: center; gap: 15px; padding: 13px 20px; border-top: 1px solid #3b3b3b; span { color: #68c58e; font-size: 11px; } } }
.settings-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; padding: 20px; section { min-width: 0; } h3 { margin: 0 0 12px; font-size: 13px; } label { display: block; margin-bottom: 10px; color: #999; font-size: 10px; } input, select, textarea { box-sizing: border-box; width: 100%; margin-top: 4px; padding: 8px; border: 1px solid #444; border-radius: 4px; outline: none; background: #181818; color: #ddd; } textarea { height: 330px; resize: vertical; font: 11px/1.5 Consolas, monospace; } input:focus, select:focus, textarea:focus { border-color: #569cd6; } }
.language-tabs, .assist-levels { display: flex; gap: 5px; margin-bottom: 8px; button { padding: 6px 9px; border: 1px solid #444; border-radius: 4px; background: #1e1e1e; color: #aaa; cursor: pointer; &.active { border-color: #569cd6; background: #264f78; color: white; } } }
.ai-entry-list { display: grid; gap: 8px; margin-bottom: 20px; > button { display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 10px; padding: 12px; border: 1px solid #465968; border-radius: 7px; background: #1d2931; color: #ddd; text-align: left; cursor: pointer; &:hover { border-color: #569cd6; background: #203545; } > span { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 7px; background: #264f78; color: #d8efff; font-size: 13px; font-weight: 700; } > div { display: flex; min-width: 0; flex-direction: column; gap: 4px; } strong { font-size: 12px; } small { overflow: hidden; color: #8295a3; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; } b { color: #9cdcfe; font-size: 10px; } } }
.ai-model-settings { max-width: 720px; min-height: 390px; margin: 0 auto; padding: 28px 24px; label { display: block; margin-bottom: 13px; color: #999; font-size: 10px; } input, select { box-sizing: border-box; width: 100%; margin-top: 5px; padding: 9px; border: 1px solid #444; border-radius: 4px; outline: none; background: #181818; color: #ddd; &:focus { border-color: #569cd6; } } h3 { margin: 22px 0 10px; font-size: 13px; } }
.privacy { padding: 8px; background: #1e1e1e; color: #858585; font-size: 10px; line-height: 1.5; }.primary, .secondary { padding: 7px 13px; border: 0; border-radius: 4px; color: white; cursor: pointer; }.primary { background: #0e639c; }.secondary { background: #444; font-size: 10px; }
.runner-settings-title { margin-top: 20px !important; }
.checkbox-label { display: flex !important; align-items: center; gap: 7px; color: #ccc !important; input { width: auto; margin: 0; } }.account-title { margin-top: 20px !important; }.account-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 9px; border-bottom: 1px solid #3b3b3b; background: #1e1e1e; font-size: 11px; > div { display: flex; min-width: 0; flex-direction: column; gap: 3px; } strong { overflow: hidden; color: #4ec9b0; text-overflow: ellipsis; white-space: nowrap; } strong.offline { color: #858585; font-weight: 400; } button { flex: 0 0 auto; padding: 5px 8px; border: 1px solid #4b6274; border-radius: 4px; background: #203545; color: #9cdcfe; font-size: 9px; cursor: pointer; &:disabled { opacity: .4; } } }
.path-picker { display: flex; gap: 6px; margin-top: 4px; input { min-width: 0; margin-top: 0 !important; } button { flex: 0 0 auto; padding: 0 10px; border: 1px solid #4b6274; border-radius: 4px; background: #203545; color: #9cdcfe; cursor: pointer; &:disabled { opacity: .45; } } }
.toolchain-websites { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; padding: 8px; border: 1px solid #3b3b3b; border-radius: 5px; background: #1e1e1e; span { width: 100%; color: #858585; font-size: 10px; } button { padding: 5px 8px; border: 1px solid #4b6274; border-radius: 4px; background: #203545; color: #9cdcfe; font-size: 9px; cursor: pointer; } }
.data-center-settings { margin: 0 20px 20px; padding: 15px; border: 1px solid #3f5260; border-radius: 7px; background: #1d252b; label { display: block; color: #aaa; font-size: 10px; } input { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid #444; border-radius: 4px; outline: none; background: #181818; color: #ddd; } &__heading { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 12px; h3 { margin: 0 0 4px; font-size: 14px; } p { margin: 0; color: #8d9aa3; font-size: 10px; } span { flex: 0 0 auto; color: #7fc8f3; font-size: 10px; } } &__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }.migrate { padding: 7px 12px; border: 0; border-radius: 4px; background: #0e639c; color: white; cursor: pointer; &:disabled { opacity: .45; cursor: default; } } &__success { margin: 8px 0 0; color: #65c68b; font-size: 10px; } &__error { margin: 8px 0 0; color: #f48771; font-size: 10px; } }
.data-center-tools { display: flex; gap: 7px; margin-top: 10px; button { padding: 6px 10px; border: 1px solid #4b6274; border-radius: 4px; background: #203545; color: #9cdcfe; cursor: pointer; &:disabled { opacity: .45; } } }
.backup-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; margin-top: 10px; > span { grid-column: 1 / -1; color: #8d9aa3; font-size: 10px; } button { display: flex; min-width: 0; flex-direction: column; gap: 2px; padding: 7px 9px; border: 1px solid #3d4b54; border-radius: 4px; background: #182027; color: #ccc; text-align: left; cursor: pointer; b { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; } small { color: #7f929e; font-size: 9px; } } }
.diagnostic-settings { display: grid; grid-template-columns: 1fr auto; gap: 10px 20px; margin: 0 20px 20px; padding: 15px; border: 1px solid #444; border-radius: 7px; background: #202020; h3 { margin: 0 0 4px; font-size: 14px; } p { margin: 0; color: #8d8d8d; font-size: 10px; } &__actions { display: flex; gap: 6px; button { padding: 6px 9px; border: 1px solid #4b6274; border-radius: 4px; background: #203545; color: #9cdcfe; cursor: pointer; &:disabled { opacity: .4; } } } }
.diagnostic-list { grid-column: 1 / -1; display: grid; gap: 4px; div { display: grid; grid-template-columns: 140px 160px 1fr; gap: 8px; padding: 6px 8px; border-left: 3px solid #4ec9b0; background: #181818; color: #aaa; font-size: 9px; &.error { border-left-color: #f48771; } b { color: #ccc; } em { overflow: hidden; color: #8d9aa3; font-style: normal; text-overflow: ellipsis; white-space: nowrap; } } }
@media (max-width: 720px) { .settings-grid { grid-template-columns: 1fr; } }
</style>
