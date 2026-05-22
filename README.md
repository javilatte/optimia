# optimIA

AI tool orchestrator for developers. Detects your repository, optionally syncs a [CodeGraph](https://github.com/colbymchenry/codegraph) code-intelligence index, and launches your configured AI CLI ([Claude Code](https://claude.ai/code), [opencode](https://opencode.ai), Gemini…) wrapped in [headroom](https://github.com/nicholasgasior/headroom) for 60–90% token savings — all with per-repo preferences.

```
$ optimia

  optimIA  v0.1.0

  ── New repo: my-project ──

  Which AI tool for this repo?
    1. claude
    2. opencode
    3. ask each time
  Choice [1-3]: 1

  Enable CodeGraph for this repo? (code-intelligence graph) [Y/n] y
  Initialize now? (builds code index) [Y/n] y
  → Building code index…
  ✓ CodeGraph initialized.
  ✓ Launching claude…
```

---

## Installation

### npm (recommended)

```bash
npm install -g @javilatte/optimia
```

### npx (no install)

```bash
npx @javilatte/optimia
```

### Manual

```bash
git clone https://github.com/jagoan/optimia
cd optimia
bash install.sh          # installs to /usr/local/bin (sudo if needed)
# or: PREFIX=~/.local bash install.sh
```

---

## Requirements

| Tool | Required | Purpose |
|---|---|---|
| `bash` ≥ 4.0 | yes | runs the script |
| `git` | yes | repo detection |
| `claude` | for AI | [Claude Code CLI](https://claude.ai/code) |
| `opencode` | for AI | [OpenCode CLI](https://opencode.ai) |
| `headroom` | recommended | token-efficient wrapper |
| `npx` / Node ≥ 14 | for codegraph | code intelligence |

---

## Commands

```
optimia                  Launch AI for the current directory
optimia tools list       List configured tools (with order and status)
optimia tools edit       Edit tools.conf in $EDITOR
optimia config show      Print global config
optimia config edit      Edit global config in $EDITOR
optimia repos list       List all known repositories
optimia repos show       Show config for the current repo
optimia repos forget     Remove current repo from known repos (re-runs wizard next time)
optimia agents           Open AGENTS.md in $EDITOR
optimia --version        Print version
optimia --help           Print help
```

---

## Configuration

All config lives in `~/.config/optimia/` (respects `$XDG_CONFIG_HOME`).

### Global config — `config.conf`

```ini
default_ai=claude          # Fallback AI tool if repo has no preference
use_headroom=true          # Wrap AI CLI with headroom
headroom_flags=--memory    # Flags passed to `headroom wrap`
ask_codegraph_update=true  # Ask to sync codegraph on every launch
```

### Tool definitions — `tools.conf`

Each `[section]` defines one tool. Edit with `optimia tools edit`.

```ini
[claude]
command=claude
description=Claude Code CLI by Anthropic
order=3
enabled=true
ai_tool=true          # appears in AI tool selection menus
wrapper=headroom      # wrap with headroom on launch
launch_args=          # extra flags appended to the command
```

**Adding a new AI tool:**

```ini
[cursor]
command=cursor
description=Cursor AI IDE
order=6
enabled=true
ai_tool=true
wrapper=headroom
launch_args=
```

**Disabling a tool:** set `enabled=false`.  
**Reordering:** change `order=`. Tools with lower numbers appear first.

### Per-repo config — `repos/<hash>.conf`

Generated automatically on first run. One file per repo (keyed by git remote URL hash or directory hash).

```ini
ai_tool=claude
use_codegraph=true
codegraph_initialized=true
use_headroom=true
```

Reset a repo to re-run the wizard: `optimia repos forget`

---

## Agent instructions — `AGENTS.md`

`~/.config/optimia/AGENTS.md` documents the full launch flow and all tools in a format that AI agents can read. Open it with `optimia agents`.

It describes:
- The exact launch sequence (repo detection → codegraph → AI tool → headroom)
- All available tools with their commands and when to use them
- Config file formats
- How to add new tools

AI agents working in an optimIA-managed repo can read this file to understand what tooling is available and how to use it.

---

## Launch flow

```
optimia
  │
  ├─ 1. Detect repo  (git remote URL → hash, or pwd → hash)
  │
  ├─ 2. First time?  → wizard
  │       Select AI tool
  │       Enable CodeGraph? (y/n)
  │
  ├─ 3. CodeGraph  (if enabled)
  │       Not initialised → ask: npx @colbymchenry/codegraph init -i
  │       Initialised     → ask: npx @colbymchenry/codegraph sync
  │
  ├─ 4. AI tool selection
  │       From repo config, or global default, or interactive ask
  │
  └─ 5. Launch
          headroom wrap <headroom_flags> <ai_tool> <launch_args>
          (direct launch if headroom is disabled or not installed)
```

---

## License

MIT
