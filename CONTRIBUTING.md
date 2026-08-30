# Contributing

Thank you for helping improve ACM Helper.

## Development setup

1. Install Node.js LTS, Rust stable, and the Tauri 2 prerequisites for Windows.
2. Run `npm ci`.
3. Start the desktop application with `npm run tauri dev`.
4. Run frontend tests with `npm test` and Rust tests with
   `cargo test --manifest-path src-tauri/Cargo.toml`.

The language toolchains used to execute solutions are optional. Configure G++,
GDB, Python, Javac, Java, and JDB from the application settings or make them
available on `PATH`.

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- Add a regression test for bug fixes whenever practical.
- Do not commit OJ cookies, API keys, source-code drafts, notes, translations,
  cached problem statements, diagnostics, or other data-center contents.
- Do not add copyrighted problem archives to the repository.
- Keep network concurrency bounded and preserve clear failure messages.

## Reporting bugs

Include the application version, operating system, affected platform, operation,
and a sanitized error message. Never paste cookies, authorization headers,
captchas, API keys, private source code, or personal paths into a public issue.
