# Security Policy

## Supported Versions

Only the latest minor version is actively supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in optimIA, please report it responsibly.

**Please do not open a public issue for security bugs.**

Instead, send an email to: **ai@jagoan.es**

Include as much detail as possible:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You can expect an initial response within 72 hours. We will work with you to validate the issue, develop a fix, and coordinate disclosure.

## What We Consider Security Issues

- Execution of arbitrary commands via manipulated config files
- Leakage of sensitive data (tokens, keys) through logs or temp files
- Path traversal or injection in repo detection logic
- Tampering with tool definitions that could lead to malicious code execution

## Best Practices for Users

- Keep your AI CLI tools (claude, opencode, etc.) updated independently.
- Review tool definitions in `~/.config/optimia/tools.conf` before enabling them.
- Do not paste untrusted repo configs into `~/.config/optimia/repos/`.
