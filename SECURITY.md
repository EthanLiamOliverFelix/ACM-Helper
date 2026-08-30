# Security Policy

## Reporting a vulnerability

Please do not disclose an exploitable vulnerability in a public issue. Contact
the repository owner through the private contact options on their GitHub profile
and include only the minimum information required to reproduce the problem.

Do not send OJ passwords, session cookies, AI API keys, captchas, private source
code, or a complete data-center export.

## Local execution warning

ACM Helper can compile, run, and debug code with the permissions of the current
Windows user. It is not a security sandbox. Only execute code that you trust.

## Stored data

Business data such as drafts, notes, translations, settings, problem sets, and
diagnostics is stored in the user-selected local data center. OJ login sessions
remain in the system-managed WebView profile. Neither location belongs in source
control.
