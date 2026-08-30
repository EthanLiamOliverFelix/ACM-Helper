# ACM Helper

ACM Helper is a local-first desktop workspace for competitive programming. It is
built with Vue 3, Monaco Editor, Rust, and Tauri 2.

> This is an independent community project. It is not affiliated with or
> endorsed by Codeforces, Luogu, AtCoder, or any other online judge.

## Highlights

- Browse and filter Codeforces and Luogu problem catalogs; fetch a problem
  statement only when it is opened.
- Import Codeforces, Luogu, and AtCoder problem links with structured Markdown,
  LaTeX, images, and sample cases.
- Edit C++, Python, and Java with a locally bundled Monaco Editor, formatting,
  persistent drafts, keyboard shortcuts, and line-number breakpoints.
- Compile and run code locally without a visible Windows console. Compilation
  and execution time are measured separately, and long output is truncated.
- Manage multiple local test cases with input, expected output, actual output,
  comparison results, and bounded parallel execution.
- Debug C++ with GDB, Python with the built-in tracer, and Java with JDB. The
  debugger supports continue, next, step in, step out, watched expressions, and
  current-line highlighting.
- Submit automatically to Luogu, including captcha handling and per-test judge
  details. Codeforces submission uses a deliberate handoff: copy the current
  code and open the official submission page.
- Create, import, reorder, and search problem sets. AI-generated and skill-tree
  plans use the same local problem references.
- Track a 130-node algorithm skill tree, VP knowledge gaps, spaced wrong-problem
  review, and per-problem Markdown notes.
- Store drafts, notes, translations, settings, plans, and diagnostics in a
  movable local data center with verified migration, backup, restore, import,
  and export.
- Cache Codeforces AI translations locally and allow an explicit retranslation.
- Load Monaco and Markdown renderers on demand for a faster first screen.

## Privacy and data boundaries

- The repository contains source code only. User drafts, notes, translations,
  problem sets, AI configuration, and diagnostics are not part of the project
  tree and must never be committed.
- OJ passwords are entered only in official WebView pages. Login cookies remain
  in the system-managed WebView profile and are not exported as ordinary files.
- An AI API key is saved only when the user enables local persistence.
- OJ diagnostics are length-limited and redact common authorization, cookie,
  token, captcha, and API-key fields.
- The separately authored development tutorial and its generation assets are
  intentionally excluded from this repository.

## Install and run

Download a Windows installer from the GitHub Releases page when a release is
available. The application itself does not require Node.js or Rust on the target
computer.

To run from source, install:

- Node.js LTS and npm
- Rust stable
- The Tauri 2 prerequisites for Windows

Then run:

```powershell
npm ci
npm run tauri dev
```

The root `一键运行.bat` launcher starts an existing release build when present,
otherwise it checks the JavaScript dependencies and enters development mode.

## Optional solution toolchains

These are only required for the corresponding local run/debug features:

| Language | Run | Debug |
| --- | --- | --- |
| C++ | G++ | GDB |
| Python | Python or PyPy | Built-in tracer |
| Java | Javac and Java | JDB |

Each executable can be selected in Settings; leaving a path empty uses `PATH`.

## Build and test

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Live OJ tests are ignored by default because they depend on remote services.
Core parsing and state logic is covered by offline regression tests.

## Responsible use

- Respect each online judge's terms, rate limits, and contest rules.
- Do not use AI assistance where a contest prohibits it.
- Do not redistribute cached problem statements or build a problem archive from
  this project.
- Local code execution is not sandboxed. Run only code you trust.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security-sensitive reports should follow
[SECURITY.md](SECURITY.md).

## License

ACM Helper is released under the [MIT License](LICENSE).
