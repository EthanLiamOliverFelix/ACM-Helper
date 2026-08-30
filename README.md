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

正式版本发布后，可以从 GitHub Releases 页面下载安装包。最终用户运行安装版
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

Windows 安装器会分别询问是否下载 GCC/GDB、便携 Python 与 Java 21 JDK；只有
用户确认的组件才会安装，并统一放在应用目录旁的 `tools` 文件夹。每个可执行文件
也可以在软件设置中单独选择；路径留空时依次查找随应用安装的工具和系统 `PATH`。

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
