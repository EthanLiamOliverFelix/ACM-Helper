import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Language } from '../types'
import { normalizeOutputLineLimit } from '../utils/outputLimit'
import { getDataCenterValue, saveDataCenterValue } from '../dataCenter'

export interface ToolchainPaths {
  cppCompiler: string
  cppDebugger: string
  pythonInterpreter: string
  javaCompiler: string
  javaRuntime: string
  javaDebugger: string
}

export const DEFAULT_CODE_TEMPLATES: Record<Language, string> = {
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n',
  python: 'import sys\n\ndef solve():\n    pass\n\nif __name__ == "__main__":\n    solve()\n',
  java: 'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        FastScanner fs = new FastScanner(System.in);\n    }\n\n    static class FastScanner {\n        private final InputStream in;\n        private final byte[] buffer = new byte[1 << 16];\n        private int ptr = 0, len = 0;\n        FastScanner(InputStream in) { this.in = in; }\n        int read() throws IOException {\n            if (ptr >= len) { len = in.read(buffer); ptr = 0; if (len <= 0) return -1; }\n            return buffer[ptr++];\n        }\n    }\n}\n',
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = getDataCenterValue<{
    codeTemplates?: Partial<Record<Language, string>>
    outputLineLimit?: number
    formatOnSave?: boolean
    luoguCppLanguageId?: number
    luoguPythonLanguageId?: number
    luoguEnableO2?: boolean
    toolchainPaths?: Partial<ToolchainPaths>
  }>('settings', {})

  const codeTemplates = reactive<Record<Language, string>>({
    cpp: saved.codeTemplates?.cpp ?? DEFAULT_CODE_TEMPLATES.cpp,
    python: saved.codeTemplates?.python ?? DEFAULT_CODE_TEMPLATES.python,
    java: saved.codeTemplates?.java ?? DEFAULT_CODE_TEMPLATES.java,
  })
  const outputLineLimit = ref(normalizeOutputLineLimit(saved.outputLineLimit))
  const formatOnSave = ref(saved.formatOnSave ?? false)
  const cppLanguageIds = [3, 4, 11, 12, 27, 28, 34]
  const pythonLanguageIds = [7, 25]
  const luoguCppLanguageId = ref(cppLanguageIds.includes(Number(saved.luoguCppLanguageId)) ? Number(saved.luoguCppLanguageId) : 34)
  const luoguPythonLanguageId = ref(pythonLanguageIds.includes(Number(saved.luoguPythonLanguageId)) ? Number(saved.luoguPythonLanguageId) : 25)
  const luoguEnableO2 = ref(saved.luoguEnableO2 ?? false)
  const toolchainPaths = reactive<ToolchainPaths>({
    cppCompiler: saved.toolchainPaths?.cppCompiler ?? '',
    cppDebugger: saved.toolchainPaths?.cppDebugger ?? '',
    pythonInterpreter: saved.toolchainPaths?.pythonInterpreter ?? '',
    javaCompiler: saved.toolchainPaths?.javaCompiler ?? '',
    javaRuntime: saved.toolchainPaths?.javaRuntime ?? '',
    javaDebugger: saved.toolchainPaths?.javaDebugger ?? '',
  })

  function save() {
    outputLineLimit.value = normalizeOutputLineLimit(outputLineLimit.value)
    if (!cppLanguageIds.includes(Number(luoguCppLanguageId.value))) luoguCppLanguageId.value = 34
    if (!pythonLanguageIds.includes(Number(luoguPythonLanguageId.value))) luoguPythonLanguageId.value = 25
    return saveDataCenterValue('settings', {
      codeTemplates,
      outputLineLimit: outputLineLimit.value,
      formatOnSave: formatOnSave.value,
      luoguCppLanguageId: luoguCppLanguageId.value,
      luoguPythonLanguageId: luoguPythonLanguageId.value,
      luoguEnableO2: luoguEnableO2.value,
      toolchainPaths,
    })
  }

  function resetTemplate(language: Language) {
    codeTemplates[language] = DEFAULT_CODE_TEMPLATES[language]
    save()
  }

  return {
    codeTemplates,
    outputLineLimit,
    formatOnSave,
    luoguCppLanguageId,
    luoguPythonLanguageId,
    luoguEnableO2,
    toolchainPaths,
    save,
    resetTemplate,
  }
})
