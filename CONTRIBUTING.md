# Contributing to optimIA

Thanks for your interest in contributing! optimIA is a developer tool, so clarity and reliability matter.

## Quick Start

1. Fork the repository.
2. Create a branch: `git checkout -b feature/my-feature` or `fix/something-broken`.
3. Make your changes.
4. Test locally (run the script, check `bash -n bin/optimia` for syntax errors).
5. Open a Pull Request against `main`.

## What We Need Help With

- Support for new AI CLI tools (add them to `tools.conf` schema).
- Better shell portability (POSIX sh compatibility is a goal).
- Bug fixes for edge cases in repo detection or config parsing.
- Documentation improvements and translations.

## Style Guide

- Shell scripts: follow the existing style in `bin/optimia`.
- Keep dependencies minimal — this is a wrapper/orchestrator, not a heavy framework.
- Document any new config options in `README.md` and the example `AGENTS.md`.

## Commit Messages

Use clear, descriptive commits. Example:

```
feat: add support for gemini CLI

- Added gemini tool definition schema
- Updated wizard to detect gemini installation
```

## Code of Conduct

Be respectful and constructive. See `CODE_OF_CONDUCT.md`.

## Questions?

Open a Discussion or Issue if you're unsure before starting work.
