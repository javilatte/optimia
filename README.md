# optimIA

[![npm](https://img.shields.io/npm/v/@javilatte/optimia?logo=npm&style=flat-square)](https://www.npmjs.com/package/@javilatte/optimia)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D14-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Linux](https://img.shields.io/badge/Linux-tested-brightgreen?style=flat-square&logo=linux)](https://github.com/)
[![macOS](https://img.shields.io/badge/macOS-tested-brightgreen?style=flat-square&logo=apple)](https://www.apple.com/macos)
[![Windows](https://img.shields.io/badge/Windows-untested%20%2F%20WIP-yellow?style=flat-square&logo=windows)](https://www.microsoft.com/windows)

AI tool orchestrator for developers. Run `optimia` in any project directory and it will:

- Ask which AI tool to use (once per repo, remembered)
- Build or sync a [CodeGraph](https://github.com/colbymchenry/codegraph) code-intelligence index
- Capture session context via three quick questions and inject it into the AI tool
- Write security constraints to `.claude/settings.json` and other tool config files
- Launch the AI CLI wrapped in [headroom](https://github.com/chopratejas/headroom) for 60–90% token savings

![optimIA demo](info.gif)

```
$ optimia

  ── New repo: my-project ──

  Which AI tool for this repo?
    1. claude
    2. opencode
    3. ask each time
  Choice [1-3]: 1

  Enable CodeGraph for this repo? [Y/n] y
  → Building code index…
  ✓ CodeGraph initialised.
  ✓ Security settings created → .claude/settings.json

  ── Quick questions (optional — press Enter to skip)

  1. What are we implementing this session?  JWT authentication
  2. Do you want me to ask questions about my doubts? [S/n] s
  3. Anything I need to keep in mind?  Use Postgres

  ✓ Context saved → .optimia/session.md
  ✓ Launching claude…
```

---

## Installation

```bash
npm install -g @javilatte/optimia
```

If you get a permission error (common on Linux with system Node), install to your user prefix instead:

```bash
npm install -g @javilatte/optimia --prefix ~/.local
```

Make sure `~/.local/bin` is in your `PATH` (`echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc`).

Or run without installing:

```bash
npx @javilatte/optimia
```

---

## Requirements

| Tool | Required | Purpose |
|---|---|---|
| `bash` ≥ 3.2 | yes | runs the script (macOS system bash works out of the box) |
| `node` / `npx` ≥ 14 | yes | CodeGraph |
| `claude` | one AI tool required | [Claude Code](https://claude.ai/code) |
| `opencode` | one AI tool required | [OpenCode](https://opencode.ai) |
| `gemini` | one AI tool required | [Gemini CLI](https://github.com/google-gemini/gemini-cli) |
| `gh copilot` | one AI tool required | [GitHub Copilot CLI](https://github.com/github/gh-copilot) |
| `headroom` | recommended | token savings wrapper |

You only need one AI tool. optimIA detects which ones are installed.

---

## Commands

```
optimia                  Launch AI for the current directory
optimia tools list       List all tools with install status
optimia tools edit       Edit tools.conf in $EDITOR
optimia config show      Show global config
optimia config edit      Edit global config in $EDITOR
optimia repos list       List known repositories
optimia repos show       Show config for current repo
optimia repos forget     Reset current repo (re-runs wizard next time)
optimia agents           Open AGENTS.md in $EDITOR
optimia --version        Print version
optimia --help           Print help
```

---

## AI tools

By default claude, opencode, and gemini are enabled. GitHub Copilot is available but **disabled by default** since it requires a separate install.

### GitHub Copilot CLI

Copilot CLI is **enabled by default**. Install it with:

```bash
gh extension install github/gh-copilot
```

If `gh` is installed as a snap (VS Code), that command may fail with a permissions error. In that case, install the standalone binary instead — just run `copilot` once and it will auto-install to `~/.local/bin/`.

> headroom wrapping is not applied to Copilot CLI — it uses the GitHub API, not Anthropic/OpenAI.

If an AI tool is selected but not installed, optimIA will show the install command and offer to launch a different installed tool instead.

---

## Session context — Quick questions

On every launch optimIA asks three optional questions (press Enter to skip any):

1. What are we implementing this session?
2. Do you want the AI to ask proactive questions?
3. Anything the AI needs to keep in mind?

Answers are injected as startup context for whichever AI tool you launch:

| AI tool | How context is injected |
|---|---|
| Claude Code | `@.optimia/CLAUDE.md` appended to project `CLAUDE.md` — read at startup |
| opencode | `@.optimia/AGENTS.md` appended to project `AGENTS.md` — read at startup |
| Gemini CLI | `@.optimia/GEMINI.md` appended to project `GEMINI.md` — read at startup |
| GitHub Copilot | session block in `.github/copilot-instructions.md` — updated each launch |
| Any tool | `OPTIMIA_SESSION_FILE` env var pointing to `.optimia/session.md` |

Disable: set `ask_quick_questions=false` in `~/.config/optimia/config.conf`

---

## Security settings

On first run in each project, optimIA creates `.claude/settings.json` with a locked-down permission set. This is enforced at the OS level by Claude Code — the AI cannot bypass it.

The same rules are injected as text instructions into `.github/copilot-instructions.md` (Copilot) and `.optimia/AGENTS.md` (opencode), where they are binding instructions rather than hard enforcement.

**Default allow list:** read/edit/write within `src/`, `tests/`, `docs/`; standard git read commands (`status`, `diff`, `log`, `add`); npm scripts and linters.

**Default deny list:** credentials and secrets (`.env*`, `*.pem`, `*.key`, `.ssh/`, `.aws/`, `.gcloud/`, etc.); destructive shell commands (`rm -rf`, `sudo`, `curl`, `wget`, `ssh`); irreversible git operations (`push --force`, `reset --hard`); `npm publish`; `docker`; and **`git commit`** — the AI proposes changes but the human reviews and commits.

Customise by editing `.claude/settings.json` directly. It is never overwritten by optimIA after the first write.

---

## Project-local directory — `.optimia/`

All per-project state lives in `.optimia/` (added to `.gitignore` automatically in git repos):

```
.optimia/
├── .codegraph/      CodeGraph SQLite database
├── openwiki/        OpenWiki generated docs (if openwiki is installed)
├── security.md      Security rules (included in AI context files)
├── session.md       Session context — raw answers
├── system-prompt.md Workflow system prompt (optional, opt-in)
├── CLAUDE.md        Session context for Claude Code
├── AGENTS.md        Session context for opencode (includes security rules)
└── GEMINI.md        Session context for Gemini CLI
```

A symlink `.codegraph → .optimia/.codegraph` is created at the project root so the codegraph CLI and MCP server find the database at the expected path. Likewise, when [OpenWiki](https://github.com/langchain-ai/openwiki) is enabled and installed, a symlink `openwiki → .optimia/openwiki` redirects its generated wiki (whose output path is hardcoded upstream to `openwiki/`) into `.optimia/`.

**Backwards compatibility:** if a real `.codegraph/` directory already exists at the project root, optimIA uses it as-is and skips the `.optimia/` setup entirely.

---

## Workflow tools (opt-in)

The first-time wizard offers an opt-in to install a **workflow system prompt** and the **`plan-optimizer` skill** into the project. Both are written once and never overwritten — edit them freely afterwards.

| Asset | Path | Purpose |
|---|---|---|
| System prompt | `.optimia/system-prompt.md` | Workflow rules: TODO system, plan mode, subagents, verification, anti-patterns. Referenced from `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` via `@include`. |
| `plan-optimizer` skill | `.claude/skills/plan-optimizer/SKILL.md` | Hill-climbing plan refinement — score / critique / rewrite until plateau. Load with `Skill plan-optimizer` when the user wants the best possible plan. |

State is tracked in `repos/<hash>.conf` as `workflow_tools_installed=true|skipped`.
Re-run the wizard with `optimia repos forget` to be asked again.

---

## Configuration

All global config lives in `~/.config/optimia/` (respects `$XDG_CONFIG_HOME`).

### `config.conf` — global settings

```ini
default_ai=claude                  # Fallback AI if repo has no preference
use_headroom=true                  # Wrap AI CLI with headroom
headroom_flags=                    # Extra flags for headroom wrap
ask_codegraph_update=true          # Ask to sync CodeGraph on every launch
ask_quick_questions=true           # Show quick questions at every launch
check_updates=true                 # Check npm for a newer optimIA on launch
update_check_interval_days=1       # Minimum days between registry checks
```

### `tools.conf` — tool definitions

Edit with `optimia tools edit`. Each `[section]` defines one tool:

```ini
[claude]
command=claude
description=Claude Code CLI by Anthropic
order=3
enabled=true
ai_tool=true          # shows in AI selection menu
wrapper=headroom      # wrap with headroom on launch
launch_args=          # extra args appended to command
install_hint=npm install -g @anthropic-ai/claude-code
```

**To add a custom AI tool:**

```ini
[aider]
command=aider
description=Aider AI coding assistant
order=8
enabled=true
ai_tool=true
wrapper=headroom
launch_args=
install_hint=pip install aider-chat
```

**To disable a tool:** `enabled=false`  
**To reorder:** change `order=` (lower = first)

### Per-repo config — `repos/<hash>.conf`

Created automatically on first run. Reset with `optimia repos forget`.

```ini
ai_tool=claude
use_codegraph=true
codegraph_initialized=true
use_headroom=true
```

---

## Launch flow

```
optimia
  │
  ├─ 1. Read config (~/.config/optimia/)
  │
  ├─ 2. Check for updates (if check_updates=true, not $CI, installed via npm -g)
  │       Registry lookup throttled to once every update_check_interval_days
  │       Newer version found → ask to update → npm install -g on confirm
  │
  ├─ 3. Set up .optimia/
  │       Create .optimia/, .codegraph symlink, update .gitignore
  │       Write .claude/settings.json (security — once only)
  │       Write .optimia/security.md (once only)
  │       Skip if legacy .codegraph/ exists at root
  │
  ├─ 4. Check installed packages
  │       Any enabled tool missing → show install hint
  │
  ├─ 5. First time in repo? → wizard
  │       Pick AI tool · Enable CodeGraph? · Install workflow tools?
  │
  ├─ 6. CodeGraph (if enabled)
  │       Not initialised → npx @colbymchenry/codegraph init -i
  │       Initialised     → offer to sync
  │
  ├─ 7. Quick questions (if ask_quick_questions=true)
  │       Write .optimia/session.md, CLAUDE.md, AGENTS.md, GEMINI.md
  │       Update .github/copilot-instructions.md session block
  │
  ├─ 8. Pick AI tool (from repo config, global default, or ask)
  │
  └─ 9. Launch
          headroom wrap [flags] <ai_tool> [launch_args]
          (direct if headroom disabled or not installed)
```

---

## OpenWiki — agent wiki for the codebase

[OpenWiki](https://github.com/langchain-ai/openwiki) (by langchain-ai) writes and maintains a documentation wiki for the repository (architecture, workflows, quickstart) that AI agents read for context. It ships enabled in the default `tools.conf`.

```bash
npm install -g openwiki    # install
openwiki code --init       # generate the wiki (first time in a repo)
openwiki code --update     # refresh docs after code changes
```

OpenWiki's output path is hardcoded upstream to `openwiki/` at the repo root. optimIA redirects it into the project-local state directory: when the tool is enabled and installed, launch creates `.optimia/openwiki/` plus a root symlink `openwiki → .optimia/openwiki`, and adds `/openwiki` to `.gitignore`. A pre-existing real `openwiki/` directory is left untouched.

Disable with `enabled=false` in the tools.conf `[openwiki]` section.

---

## Platform support

> **Currently only Linux is tested.** macOS and Windows are not tested yet.

| Platform | Status |
|---|---|
| Linux | Tested |
| macOS | Untested |
| Windows | Untested |

---

## Advanced optional tools

These are not included in the default tools.conf but can be added manually via `optimia tools edit`:

**[agentmemory](https://github.com/rohitg00/agentmemory)** — Persistent memory MCP server, compatible with Claude Code, opencode, Copilot CLI, Cursor, Gemini CLI, and any MCP client.
```bash
npm install -g @agentmemory/agentmemory@latest   # then add [agentmemory] section to tools.conf
```

---

## License

MIT
