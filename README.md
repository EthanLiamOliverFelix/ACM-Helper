# ACM Helper

ACM Helper 是一个面向算法竞赛与日常刷题的本地优先桌面工作台，使用 Vue 3、
Monaco Editor、Rust 与 Tauri 2 开发。

> 本项目是独立的社区项目，与 Codeforces、洛谷、AtCoder 或其他在线评测平台
> 不存在从属、合作或官方认可关系。

## 主要功能

- 浏览并筛选 Codeforces、洛谷与 AtCoder 题库；仅在用户打开题目时抓取具体题面，
  并可手动更新远端题目目录。
- 通过链接导入 Codeforces、洛谷和 AtCoder 题目，支持结构化 Markdown、LaTeX、
  图片与样例。
- 使用本地打包的 Monaco Editor 编写 C++、Python 和 Java，支持代码格式化、
  草稿持久化、快捷键和行号断点。
- 在 Windows 上无黑色控制台地编译运行代码；分别统计编译与运行耗时，并限制
  超长输出的展示行数。
- 管理多组本地测试点，分别展示输入、预期输出、实际输出和比较结果，并支持
  受限并发运行。
- 使用 GDB 调试 C++、内置跟踪器调试 Python、JDB 调试 Java；支持继续、下一步、
  步入、步出、监视表达式和当前执行行高亮。
- 自动提交到洛谷，包括验证码处理、结果回收和测试点详情。Codeforces 与 AtCoder
  采用人工接管方式：复制当前代码并打开官方提交页面。
- 创建、导入、搜索和拖动排序题单；AI 推荐题单与技能树题单共用本地题目引用。
- 提供包含 130 个节点的算法技能树、VP 知识缺口分析、间隔错题复习和题目笔记。
- 将草稿、笔记、翻译、设置、题单和诊断信息存入可移动的本地数据中心，支持
  校验迁移、备份、恢复、导入与导出。
- 将 Codeforces 的 AI 翻译缓存在本地，并支持主动重新翻译。
- 按需加载 Monaco 与 Markdown 渲染器，缩短软件首屏加载时间。

## 隐私与数据边界

- 本仓库只包含项目源代码。用户草稿、笔记、翻译、题单、AI 配置和诊断记录
  不属于源码目录，禁止提交到版本控制系统。
- OJ 密码仅在对应平台的官方 WebView 页面中输入；登录 Cookie 保存在系统管理的
  WebView 配置中，不会以普通文件形式导出。
- 只有用户主动启用本地保存时，软件才会持久化 AI API Key。
- OJ 诊断日志具有长度限制，并会脱敏 Authorization、Cookie、Token、验证码和
  API Key 等常见敏感字段。
- 单独编写的开发实战教程及其生成素材不会包含在本仓库中。

## 安装与运行

正式版本发布后，可以从 [GitHub Releases](https://github.com/EthanLiamOliverFelix/ACM-Helper/releases)
页面下载最新版安装包，双击安装即可。最终用户运行安装版
不需要安装 Node.js 或 Rust。

从源码运行需要安装：

- Node.js LTS 与 npm
- Rust stable
- Tauri 2 的 Windows 开发依赖

然后执行：

```powershell
npm ci
npm run tauri dev
```

项目根目录的 `一键运行.bat` 会优先启动已经构建好的 Release 程序；如果 Release
版本不存在，则检查 JavaScript 依赖并进入开发模式。

## 可选的代码运行工具链

只有使用对应语言的本地运行或调试功能时，才需要安装以下工具：

| 语言 | 运行工具 | 调试工具 |
| --- | --- | --- |
| C++ | G++ | GDB |
| Python | Python 或 PyPy | 内置跟踪器 |
| Java | Javac 与 Java | JDB |

Windows 安装器不捆绑或联网下载这些工具。设置页提供 MSYS2、Python 与 Eclipse
Temurin 的官方网站入口，也可以分别选择已有可执行文件；路径留空时使用系统
`PATH`，因此只阅读题面、整理题单和笔记的用户无需额外安装编译环境。

## 使用教程

### 功能速览

ACM Helper 将题库、编辑器、调试器、题单、笔记、技能树和 AI 助手集中在同一个
工作台中。Codeforces、洛谷与 AtCoder 题库均可浏览；点击题目操作按钮即可打开
题面。

![三大 OJ 题库列表](docs/images/tutorial/01-problem-library.png)

编辑器支持 C++、Python 和 Java 的编译、运行与调试。可以维护多组本地测试点，
分别查看输入、预期输出和运行结果。洛谷支持远程提交、判定状态回收和测试点查看；
Codeforces 与 AtCoder 会复制当前代码并打开官方提交页面，由用户完成提交和判定
确认。

![本地测试点](docs/images/tutorial/02-submit-workflow.png)

内嵌 AI 助手会自动读取当前题目、代码等上下文。算法笔记使用 Markdown 格式，
可以自由排版并插入图片。

![内嵌 AI 助手](docs/images/tutorial/03-ai-assistant.png)

![Markdown 算法笔记](docs/images/tutorial/04-markdown-notes.png)

内嵌资源管理器可直接管理练习文件。对于三个主流 OJ 以外的题目，也可以新建
自定义题目并关联 Markdown 笔记，自行维护题面。

![内嵌资源管理器](docs/images/tutorial/05-file-explorer.png)

![自定义题目与题面](docs/images/tutorial/06-custom-problem.png)

算法技能树会根据知识点依赖规划训练顺序，支持 AI 生成练习、跳过知识点，并在
同一界面查看算法概况和做题统计。

![算法技能树](docs/images/tutorial/07-skill-tree.png)

![算法概况](docs/images/tutorial/08-skill-overview.png)

![做题数据](docs/images/tutorial/09-practice-stats.png)

题单支持手动整理、拖动排序和批量导入，并会自动收集 Codeforces、AtCoder 比赛与
洛谷题单广场内容。

![题单管理](docs/images/tutorial/10-problem-lists.png)

### 设置

#### 代码片段

在设置中可以为 C++、Python 和 Java 分别添加新题目的默认代码。还可以选择主题、
启用保存时自动格式化，并配置洛谷提交语言和 OJ 账号。

![应用设置](docs/images/tutorial/11-code-snippets.png)

#### AI 配置

AI 配置分为翻译模型与解题模型：翻译模型用于英文题面翻译，解题模型用于题目
分析和题单生成。填写模型服务地址、接口协议、模型名与 API Key 后即可使用，也
可以按需选择 DeepSeek 等服务。只有勾选本地保存选项时，API Key 才会持久化到
这台电脑。

![AI 模型配置](docs/images/tutorial/12-ai-settings.png)

#### 编译器与 OJ 账号

按照设置页提示选择各语言的编译、运行和调试工具；页面附有官方下载入口。未
指定路径时，程序会从系统 `PATH` 中查找对应工具。

账号管理用于打开各 OJ 的官方登录页面，并可设置洛谷自动提交时使用的语言规则。

![编译工具与账号设置](docs/images/tutorial/13-toolchain-and-account-settings.png)

#### 数据管理与 OJ 诊断

数据中心可以迁移本地数据目录，其中包括代码、笔记、翻译、题单、测试点、学习
档案和提交记录，并支持备份、导出与导入。迁移前请确认目标目录有足够空间，并
避免在迁移过程中退出应用。

OJ 诊断页面展示题面、登录、提交和判定详情等链路的状态反馈，可用于自行排查
失败问题。日志不会保存 Cookie、验证码、代码或密码；分享诊断信息前仍应检查
其中是否包含个人信息。

![数据管理与 OJ 诊断](docs/images/tutorial/14-data-and-oj-diagnostics.png)

### 编辑器

编辑区的操作方式接近 VS Code，支持常用编辑快捷键。可以在设置中启用保存时自动
格式化，也可以通过“版本”按钮创建分支并保存多个代码版本，用于保留一题多解或
错误代码并在之后复盘。

![代码版本管理](docs/images/tutorial/15-code-versions.png)

### 题单

技能树中的学习题单每页包含 10 道题；可以重复生成，后续题目的难度会逐步提高。
生成结果可以一键导入“我的题单”。

![AI 生成的学习题单](docs/images/tutorial/16-ai-generated-list.png)

手工创建题单时，可以直接加入当前题目，也可以输入题号、题目名称或题目链接。
目前支持 Codeforces、洛谷与 AtCoder；暂不支持识别 Codeforces Gym 题目。

![手工创建题单](docs/images/tutorial/17-manual-list-import.png)

批量导入时每行填写一个链接，程序会一次识别并加入多道题目。

![批量链接导入](docs/images/tutorial/18-link-batch-import.png)

### 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+B` | 收起或展开左侧栏 |
| `Alt+Shift+F` | 格式化当前代码 |
| `Ctrl+Shift++` | 放大界面 |
| `Ctrl+Shift+-` | 缩小界面 |

编辑区同时支持保存、全选、撤销等常用快捷操作。具体按键可能因操作系统或键盘
布局略有差异。

### 界面布局与主题

题单、资源管理器等面板可以拖动调整大小；拖动面板标题可以重新排列工作区，操作
方式接近 VS Code。外观设置支持浅色、深色和跟随系统三种模式。

![拖动面板调整工作区](docs/images/tutorial/19-dock-layout.png)

![浅色界面主题](docs/images/tutorial/20-theme-settings.png)

## QOJ 比赛归档

QOJ 采用“比赛归档 → 赛事体系 → 届次/区域 → 具体比赛 → 题目”的多级浏览方式，
不会在后台扫描全站主题库。进入具体比赛时使用 QOJ 官方 WebView 读取真实题号；
若站点要求登录或 Cloudflare 验证，会在官方页面完成，应用不接触账号密码。题面
统一转换为 Markdown，样例输入输出单独显示，可复制或一键加入本地测试点。

QOJ 的后续接入范围和里程碑见 [QOJ 集成规划](docs/QOJ-集成规划.md)。

## 构建与测试

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

实时 OJ 测试依赖远端网络服务，因此默认处于忽略状态。核心解析、状态管理与数据
处理逻辑使用离线回归测试覆盖。

## 使用规范

- 遵守各在线评测平台的服务条款、访问频率限制和比赛规则。
- 在禁止 AI 辅助的比赛中，不要使用本项目的 AI 功能。
- 不要通过本项目重新分发缓存的题面，也不要将其用于建立题目内容镜像站。
- 本地代码执行不属于安全沙箱，只运行自己信任的代码。

## 参与贡献

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。涉及安全问题时，请按照
[SECURITY.md](SECURITY.md) 中的方式进行报告。

## 开源许可证

ACM Helper 使用 [MIT License](LICENSE) 开源。
