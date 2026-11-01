# optimIA

[![npm](https://img.shields.io/npm/v/@javilatte/optimia?logo=npm&style=flat-square)](https://www.npmjs.com/package/@javilatte/optimia)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org/)
[![macOS](https://img.shields.io/badge/macOS-tested-brightgreen?style=flat-square&logo=apple)](https://www.apple.com/macos)
[![Linux](https://img.shields.io/badge/Linux-untested-yellow?style=flat-square&logo=linux)](https://github.com/)
[![Windows](https://img.shields.io/badge/Windows-untested%20%2F%20WIP-yellow?style=flat-square&logo=windows)](https://www.microsoft.com/windows)

Run `optimia` in any project directory. It starts a local web server and opens a
dashboard in your browser: a chat against a real **Claude Code** session (or a
local model via **Ollama**), plus a kanban board for coding agent tasks running
in git worktrees.

```
$ optimia

optimia running at http://127.0.0.1:54213 (project: /path/to/your-project)
```

That's it — no terminal wizard, no questions to answer up front. Everything else
(model, local AI endpoint, instructions, project memory, permission rules,
skills) is configured from the Settings panel in the web UI.

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
| `node` ≥ 18 | yes | runs the server and the CLI launcher |
| [`claude`](https://claude.ai/code) (Claude Code CLI) | yes | the chat is a real `claude` subprocess — optimia never calls the Anthropic API directly |
| [Ollama](https://ollama.com) | optional | local AI mode, used as an Anthropic-Messages-API-compatible backend |
| `npx`/`git` | optional | only needed if you enable CodeGraph indexing |

---

## What `optimia` does on launch

```
optimia
  │
  ├─ 1. Create .optimia/ in the current directory (project-local state)
  │
  ├─ 2. In a git repo: offer to enable CodeGraph
  │       Not enabled yet  → ask once, remembered in .optimia/codegraph.json
  │       Enabled, not initialised → offer to run `npx @colbymchenry/codegraph init -i`
  │       Enabled, initialised     → offer to sync
  │       Also: symlink .codegraph → .optimia/.codegraph, update .gitignore
  │
  └─ 3. Start the local web server (random free port) and open it in your browser
```

From there, everything happens in the browser:

- **Chat** — talks to a long-lived `claude` CLI subprocess over a WebSocket bridge (NDJSON). Multi-turn, with cost reported per turn. Paste or drag-and-drop a screenshot straight into the chat input.
- **Settings** — Claude model/effort, local AI (Ollama) endpoint, free-text Instructions (appended to the system prompt via `--append-system-prompt`), project Memory (`.optimia/memory.md`), a No-go list of denied file/command patterns (synced 1:1 into `.claude/settings.json`'s `permissions.deny`), and Skills (`.claude/skills/*/SKILL.md`).
- **Tasks** — a kanban board; each task gets its own git worktree so coding agents don't collide with your working tree.

If `.optimia/system-prompt.md` or `.claude/settings.json` already exist from an
older optimia project, the Settings UI offers a one-time migration preview
before overwriting anything.

---

## Project-local directory — `.optimia/`

All per-project state lives in `.optimia/` (added to `.gitignore` automatically in git repos):

```
.optimia/
├── settings.json     AI mode, model/effort, local AI config, instructions, no-go list
├── memory.md          Free-text project memory, included in every session's system prompt
├── tasks.json         Kanban task board state
├── codegraph.json     Whether CodeGraph is enabled/initialised for this repo
└── .codegraph/         CodeGraph SQLite database (symlinked to ./.codegraph at the root)
```

---

## Supported AI backends

Only two, by design:

- **Claude Code** — the `claude` CLI, run as a real subprocess per session.
- **Local AI** — any Ollama instance exposing the Anthropic-Messages-API-compatible `/v1/messages` endpoint (Ollama ≥ 0.14). Configure the URL and model name in Settings → IA local.

No other AI CLI (opencode, Gemini CLI, GitHub Copilot CLI) is orchestrated by optimia.

---

## CLI

```
optimia              Set up .optimia/ (+ CodeGraph prompt), start the server, open the browser
optimia --version    Print version
optimia --help        Print help
```

There is no other subcommand — tool/config/repo management from the old
multi-tool wizard is gone. Everything configurable now lives in the web UI's
Settings panel.

---

## License

MIT
