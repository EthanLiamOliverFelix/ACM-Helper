# ACM Helper 工作台 UI 重构施工方案

## 1. 文档目的

本方案把当前固定的“题目列表 + 题面/代码 + 评测区”界面，重构为接近 VS Code 的工作台：

- 单个应用窗口；
- 最左侧使用小型活动栏；
- 活动栏右侧共用一块可切换侧边栏；
- 中央第一阶段支持最多两个编辑器组；
- 每个编辑器组拥有独立标签页；
- 不同题目的代码可以同时打开；
- 同一道题的题面、代码、笔记和 AI 分析通过上下文绑定；
- 评测点放在左侧侧边栏；
- 重启后恢复活动栏、侧边栏、分栏、标签页及激活状态；
- 数据结构预留任意方向、多编辑器组扩展能力。

本文只规划应用内部的编辑器组，不创建多个 Windows 原生窗口。

## 2. 已确认的产品决策

1. “窗口”指同一应用内的编辑器组。
2. 允许同时打开不同题目的代码。
3. 同一题目的代码、题面、笔记和 AI 分析属于同一工作上下文。
4. 第一版只实现左右两个编辑器组，但布局数据使用可递归结构。
5. 评测点从右侧移入活动栏对应的左侧侧边栏。
6. 重启应用后恢复工作台布局和标签页。

## 3. 推荐界面结构

```text
┌──────────────────── 顶部菜单 / 全局设置 ────────────────────┐
│活动栏│     主侧边栏      │       编辑器组 A       │ 编辑器组 B │
│      │                   │ ┌────── 标签栏 ──────┐ │ ┌───────┐ │
│题库  │ 题库/筛选/题单     │ │题面│代码1│代码2    │ │ │笔记│AI│ │
│文件  │ 资源管理器         │ └───────────────────┘ │ └───────┘ │
│技能  │ 技能树导航         │                       │           │
│AI    │ 会话与快捷操作     │      当前标签内容      │ 标签内容   │
│评测  │ 当前代码的测试点   │                       │           │
│笔记  │ 笔记目录           │                       │           │
├──────┴───────────────────┴───────────────────────┴───────────┤
│ 可选底部工作台：编译错误 / 程序输出 / 调试控制台 / 提交记录     │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 活动栏

建议宽度为 46～50px，始终固定在左侧。按钮顺序：

1. 题库与题单；
2. 本地资源管理器；
3. 技能树与 VP；
4. AI 辅助；
5. 评测点；
6. 笔记；
7. 底部固定设置按钮。

点击已激活按钮时收起侧边栏；点击其他按钮时切换侧边栏内容。按钮应提供图标、悬浮提示、激活指示条和数量徽标，例如失败测试数量。

### 3.2 主侧边栏

侧边栏由所有活动共用，不再让 `ProblemList` 同时容纳题库、题单和资源管理器。建议拆分为：

- `ProblemExplorerPanel`：题库、搜索、筛选；
- `ProblemSetExplorerPanel`：题单、比赛收藏；
- `ResourceExplorerPanel`：本地文件；
- `LearningExplorerPanel`：技能树目录、VP 入口、统计入口；
- `AiExplorerPanel`：新建会话、历史会话、模式选择；
- `TestExplorerPanel`：当前代码上下文的测试点、运行全部；
- `NoteExplorerPanel`：笔记文件树。

第一版可以让“题库”和“题单”继续作为同一个活动内的两个小标签，资源管理器必须独立出来。

### 3.3 编辑器组与标签页

每个编辑器组包括：

- 标签栏；
- 当前标签内容；
- 组操作菜单；
- 可拖动的组间分隔条。

第一版支持：单组、左右双组、交换左右、关闭某一组、把标签移动到另一组。暂不实现上下分栏和拖拽任意嵌套。

## 4. 核心概念

### 4.1 工作上下文 `WorkspaceContext`

上下文表示“一道题或一个本地源文件的完整工作状态”，而不是一个可见标签。

```ts
type ContextId = string

interface WorkspaceContext {
  id: ContextId
  resource:
    | { kind: 'problem'; platform: Platform; problemId: string }
    | { kind: 'local-file'; path: string }
  title: string
  problem: Problem | null
  activeLanguage: Language
  documents: Partial<Record<Language, CodeDocumentState>>
  testCases: LocalTestCase[]
  activeTestCaseId: string
  runState: RunState
  debugState: DebugState
  submissionState: SubmissionState
}
```

同一道题应生成稳定的上下文 ID：

- OJ 题目：`problem:${platform}:${problemId.toUpperCase()}`；
- 本地文件：`file:${normalizePath(path)}`。

### 4.2 文档标签 `WorkbenchTab`

标签只描述“显示什么”，不复制题目和代码数据。

```ts
type WorkbenchTab =
  | { id: string; kind: 'statement'; contextId: ContextId; pinned: boolean }
  | { id: string; kind: 'code'; contextId: ContextId; language: Language; pinned: boolean }
  | { id: string; kind: 'problem-note'; contextId: ContextId; notePath: string; pinned: boolean }
  | { id: string; kind: 'ai-analysis'; contextId: ContextId; conversationId: string; pinned: boolean }
  | { id: string; kind: 'global-note'; notePath: string; pinned: boolean }
  | { id: string; kind: 'learning'; page: string; pinned: boolean }
```

“捆绑”通过共同的 `contextId` 实现：

- 在代码标签点“题目笔记”，打开相同 `contextId` 的 `problem-note`；
- 在题面点“AI 分析”，AI 自动取得该上下文的题面、语言和代码；
- 激活任意绑定标签时，评测点侧边栏切换到对应上下文；
- 关闭某个标签不会连带关闭其他绑定标签。

### 4.3 编辑器组 `EditorGroup`

```ts
interface EditorGroup {
  id: string
  tabs: WorkbenchTab[]
  activeTabId: string | null
}
```

### 4.4 可扩展布局树

虽然 Demo 最多两个组，但不能把状态写死成 `leftGroup/rightGroup`。

```ts
type WorkbenchLayoutNode =
  | { type: 'group'; groupId: string }
  | {
      type: 'split'
      direction: 'horizontal' | 'vertical'
      ratio: number
      first: WorkbenchLayoutNode
      second: WorkbenchLayoutNode
    }
```

Demo 的命令层限制叶子数量不超过 2，渲染器仍按照树结构递归渲染。后续解除限制即可支持多组和上下分栏。

## 5. 标签打开与自动分栏规则

### 5.1 通用规则

1. 已存在完全相同的标签：直接激活，不重复创建。
2. 从题库或资源管理器打开代码：进入当前代码所在组，并作为新标签加入。
3. 从代码顶栏打开绑定题面、笔记或 AI：优先在另一编辑器组打开。
4. 另一组不存在时，自动建立左右分栏，建议比例为 `58:42`。
5. 两组已经存在时，绑定内容进入非代码组；如果两组都是代码，则进入非当前组。
6. 用户手动移动过标签后，记录该标签类型的最后目标组；以后优先尊重用户选择。
7. 用户可通过标签右键菜单选择“在当前组打开”“在侧边打开”“移动到另一组”。

### 5.2 预览标签

建议参考 VS Code 引入单个“预览标签”：

- 单击题目或文件时，以斜体预览标签打开；
- 双击、编辑、运行、固定或拖动后变成永久标签；
- 下一次单击可替换同组未固定的预览标签；
- 有未保存修改的标签永远不能被预览替换。

这可以避免浏览题库时快速堆积大量标签。

### 5.3 关闭标签

- 关闭无修改标签：直接关闭；
- 关闭有修改代码：先执行现有自动保存，失败时阻止关闭并提示；
- 关闭正在调试的代码：确认后结束该上下文的调试进程；
- 关闭最后一个标签：保留空编辑器组欢迎页；
- 关闭一个编辑器组：标签合并到剩余组，不能静默丢弃。

## 6. 评测点侧边栏

用户已确认评测点放在左侧，因此现有 `SubmitPanel` 需要拆分，而不是整体搬迁。

### 6.1 左侧保留

- 测试点列表；
- 新建、删除、复制测试点；
- 输入、预期输出、实际输出；
- 运行当前、运行全部；
- 测试状态与耗时。

### 6.2 底部或代码区保留

- 编译错误；
- 标准输出、标准错误；
- 调试控制台；
- 远程提交进度和详细判题结果。

活动栏“评测”按钮绑定当前活动上下文。若当前标签是全局笔记或技能树，不切换数据，侧边栏显示“请选择一个题目或代码标签”。

## 7. 状态管理重构

### 7.1 当前问题

现有 `problemStore` 只有一份：

- `currentProblem`；
- `currentCode`；
- `currentLanguage`；
- `testCases`；
- `runResult`；
- `debugSession`；
- `draftPath`。

多个代码标签直接共用这些字段会造成切换覆盖、异步抓取串台和代码保存到错误文件。因此不能只在视图层添加标签页。

### 7.2 推荐拆分

新增：

- `workbenchStore.ts`：活动栏、侧边栏、编辑器组、标签、布局、恢复；
- `workspaceSessionStore.ts`：多个题目/文件上下文；
- `problemCatalogStore.ts`：题库目录、筛选、分页、题单导入；
- 保留 `problemStore.ts` 作为过渡适配层，逐步缩小职责。

组件不再直接假设全局唯一题目，应接收 `contextId` 或从当前标签解析上下文：

```vue
<CodeEditor :context-id="tab.contextId" :language="tab.language" />
<ProblemDesc :context-id="tab.contextId" />
<ProblemNoteEditor :context-id="tab.contextId" />
<AiAnalysis :context-id="tab.contextId" />
```

### 7.3 过渡适配器

为降低一次性改造风险，第一阶段保留现有字段名，但将它们变成当前活动上下文的计算代理：

```ts
const currentCode = computed({
  get: () => activeSession.value?.documents[activeLanguage.value]?.code ?? '',
  set: value => sessionActions.updateCode(activeContextId.value, activeLanguage.value, value),
})
```

稳定后，再让组件直接使用 `workspaceSessionStore`。

## 8. 工作台状态持久化

数据中心新增版本化键：`ui-workbench-v1`。

```ts
interface PersistedWorkbenchStateV1 {
  version: 1
  activeActivity: ActivityId
  sidebarVisible: boolean
  sidebarWidth: number
  layout: WorkbenchLayoutNode
  groups: EditorGroup[]
  activeGroupId: string
  bottomPanel: {
    visible: boolean
    activeView: 'compile' | 'output' | 'debug' | 'submission'
    height: number
  }
}
```

持久化原则：

- 保存标签标识、布局和视图状态，不重复保存代码正文；
- 代码仍由现有草稿文件和数据中心负责；
- 笔记仍由笔记文件负责；
- 测试点仍按上下文键保存；
- 不恢复运行中、提交中或调试中的进程；
- 恢复不存在的本地文件时显示“资源已丢失”，允许关闭或重新定位；
- OJ 题目恢复失败时先显示缓存，再允许重新抓取；
- 状态损坏时回退为默认单组布局，不能阻止应用启动。

写入采用 300～500ms 防抖，并在窗口关闭前执行一次最终保存。

## 9. 组件规划

### 9.1 新增组件

```text
src/workbench/
  ActivityBar.vue
  PrimarySidebar.vue
  WorkbenchArea.vue
  SplitNode.vue
  EditorGroup.vue
  EditorTabs.vue
  EditorTab.vue
  EmptyGroup.vue
  BottomPanel.vue
  tabRegistry.ts
  tabRouting.ts
  workbenchTypes.ts
```

### 9.2 调整现有组件

- `MainLayout.vue`：只负责组合顶部栏、活动栏、侧边栏和工作台；
- `Sidebar.vue`：拆成 `ActivityBar` 与 `PrimarySidebar`；
- `ProblemList.vue`：拆出题库、题单与资源管理器入口；
- `ProblemDesc.vue`：接收 `contextId`，题目笔记改为打开标签；
- `CodeEditor.vue`：接收 `contextId + language`，每个标签绑定独立 Monaco model；
- `AiAssistant.vue`：支持全局会话与题目绑定会话；
- `LearningPanel.vue`：既可显示侧边导航，也可作为编辑器标签打开完整页面；
- `SubmitPanel.vue`：拆为 `TestExplorerPanel`、`SubmissionView` 和底部输出面板；
- `NoteManager.vue`：目录放侧边栏，编辑器放标签页。

### 9.3 标签注册表

不要在 `EditorGroup.vue` 中堆积大量 `v-if`。使用注册表集中定义标签标题、图标、组件和关闭行为：

```ts
const tabRegistry = {
  statement: { component: ProblemDesc, icon: 'book' },
  code: { component: CodeEditor, icon: 'code' },
  'problem-note': { component: ProblemNoteEditor, icon: 'note' },
  'ai-analysis': { component: AiAnalysis, icon: 'sparkle' },
  'global-note': { component: NoteEditor, icon: 'notebook' },
  learning: { component: LearningPanel, icon: 'skill' },
}
```

## 10. Monaco 多标签注意事项

每个代码标签必须使用稳定 URI 创建 Monaco model，例如：

```text
acm://problem/codeforces/959F/cpp
acm://problem/atcoder/abc141_f/cpp
acm://local/<encoded-path>
```

要求：

- 不因切换标签销毁代码内容；
- 为每个标签保存光标、选择区和滚动位置；
- 标签关闭时释放不再使用的 model；
- 格式化、运行、断点和保存命令必须携带 `contextId`；
- 异步加载完成前再次切换标签，旧结果只能写回原上下文；
- 快捷键只作用于获得焦点的编辑器组。

## 11. 分阶段施工

### 阶段 0：建立测试与类型基础

- 定义上下文、标签、编辑器组、布局树类型；
- 编写标签去重、路由、分栏、序列化和恢复测试；
- 为现有 `problemStore` 添加上下文适配层，不修改 UI；
- 验证现有单题流程完全不变。

完成标准：现有功能和测试全部通过，新模型可以表示两个不同题目的代码状态。

### 阶段 1：活动栏与共用侧边栏

- 新建 `ActivityBar` 和 `PrimarySidebar`；
- 拆分题库、题单、资源管理器入口；
- 接入技能树、AI、评测点和笔记入口；
- 保存活动项、侧边栏显隐和宽度。

完成标准：所有旧入口均可从新活动栏到达，没有功能丢失。

### 阶段 2：单编辑器组与标签页

- 建立 `workbenchStore`；
- 将题面、代码、笔记、AI、技能页面注册为标签内容；
- 实现预览标签、固定、关闭、顺序调整；
- 将悬浮题目笔记改为标签页。

完成标准：单组内可以同时保留多个代码标签，切换不丢代码和视图状态。

### 阶段 3：双编辑器组 Demo

- 实现布局树渲染器；
- 支持左右分栏、比例拖动、交换和合并；
- 实现绑定内容的智能侧边打开；
- 支持标签在两组间移动。

完成标准：左侧编辑题目 A，右侧查看 A 的题面/笔记；也可以在两个组同时编辑 A、B 两道题。

### 阶段 4：评测与调试上下文化

- 拆分 `SubmitPanel`；
- 评测点侧边栏跟随活动代码上下文；
- 运行、调试、断点、输出绑定到上下文；
- 切换标签不会串用测试点或运行结果。

完成标准：A、B 两个代码标签分别运行，测试点与输出互不污染。

### 阶段 5：恢复与异常处理

- 持久化工作台布局；
- 启动时恢复标签和上下文；
- 处理文件丢失、题面缓存缺失和状态版本迁移；
- 恢复失败时安全回退。

完成标准：关闭并重启应用后，分栏、标签顺序和活动位置保持一致。

### 阶段 6：交互完善

- 标签右键菜单；
- 键盘切换标签与编辑器组；
- 未保存、运行中和错误状态标记；
- 小屏降级为单组；
- 无障碍标题和完整悬浮提示。

## 12. 建议快捷键

| 快捷键 | 行为 |
|---|---|
| `Ctrl+Tab` | 当前组切换标签 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+1` / `Ctrl+2` | 聚焦第一个/第二个编辑器组 |
| `Ctrl+\` | 在侧边打开当前标签 |
| `Ctrl+B` | 显示/隐藏主侧边栏；编辑器文字输入时维持现有加粗语义需避免冲突 |
| `Ctrl+J` | 显示/隐藏底部面板 |
| `Ctrl+Shift+E` | 打开资源管理器活动 |
| `Ctrl+Shift+T` | 打开评测点活动 |

最终快捷键需避开笔记 Markdown 编辑器和 Monaco 已占用组合。

## 13. 测试计划

### 13.1 单元测试

- 相同资源不重复打开相同标签；
- 不同语言代码标签具有稳定 ID；
- 绑定题面、笔记、AI 继承正确 `contextId`；
- 智能路由在 0、1、2 个编辑器组下均符合规则；
- 关闭组会迁移标签；
- 布局比例被限制在安全范围；
- V1 状态可序列化、恢复和容错；
- 异步题面返回不会覆盖另一个上下文；
- 测试点按上下文隔离。

### 13.2 组件测试

- 活动栏切换和收起侧边栏；
- 标签关闭、固定、排序和移动组；
- 两组同时渲染不同代码模型；
- 笔记按钮打开绑定标签而非悬浮层；
- 当前代码变化时评测点侧边栏正确切换。

### 13.3 手工验收场景

1. 同时打开 CF、洛谷、ATC 三道题的代码标签并分别编辑；
2. 从其中一道题的代码顶栏打开题面和笔记，确认进入另一组且绑定正确；
3. 切换回另一道题，确认评测点、输出和断点未串台；
4. 在两个组间移动标签、拖动分隔条并重启应用；
5. 删除一个已打开的本地源文件，再启动应用检查失效标签提示；
6. 开始调试后关闭对应代码标签，检查确认和进程清理；
7. 数据中心迁移后恢复工作台，标签引用仍然有效。

## 14. 风险与规避

### 高风险：全局状态串台

先改上下文数据模型，再改视觉布局；所有异步任务必须捕获发起时的 `contextId`。

### 高风险：Monaco 多 model 生命周期

集中管理 model，不由单个 Vue 组件随意创建和销毁；关闭标签后仅在没有其他引用时释放。

### 中风险：组件重构范围过大

使用过渡适配器逐步替换，阶段结束时都保持项目可运行，不建立长期并存的两套工作台。

### 中风险：恢复状态引用失效资源

持久化资源标识而不是完整对象；恢复逐项校验，单个标签失败不能导致整个布局恢复失败。

### 低风险：小屏空间不足

窗口宽度不足时自动隐藏侧边栏并把双组临时显示为单组，但不删除第二组状态。

## 15. Demo 明确不做的内容

- 任意数量编辑器组；
- 上下分栏；
- 标签跨原生窗口拖动；
- 编辑器组拖拽形成复杂嵌套布局；
- 云端同步布局；
- 恢复正在运行的程序或调试进程。

这些能力的数据结构均已预留，但不应阻塞第一版双组 Demo。

## 16. 推荐实施结论

本次重构应以“会话隔离”为主线，而不是先绘制 VS Code 风格外壳。推荐严格按照以下顺序推进：

```text
上下文模型 → 活动栏/侧边栏 → 单组标签页 → 双组布局
          → 评测与调试隔离 → 状态恢复 → 交互打磨
```

其中阶段 0～2 是最小可用基础；阶段 3 完成后才形成用户期望的双组 Demo；阶段 4～5 完成后才适合替换当前默认界面。
