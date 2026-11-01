'use strict';

const fs = require('fs');
const path = require('path');

// Baseline allow-list and mode — not user-editable via the Settings UI for
// now ("No-go files & commands" only edits the deny side). Mirrors what the
// old wizard used to generate per project.
const DEFAULT_ALLOW = [
  'Read', 'Glob', 'Grep', 'LS', 'Edit', 'MultiEdit',
  'Write(src/**)', 'Write(tests/**)', 'Write(docs/**)',
  'Bash(npm run *)', 'Bash(npm test *)', 'Bash(npx tsc *)', 'Bash(npx prettier *)', 'Bash(npx eslint *)',
  'Bash(git status)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git add *)',
  // Pre-granted so background work (task worktrees, subagents spawned via
  // the Agent tool) runs end-to-end without hitting the terminal handoff
  // for routine research — only a genuinely unexpected tool should still
  // deny and hand off.
  'WebSearch', 'WebFetch',
  // Names verified against a real --mcp-config session's stream-json "init"
  // event (mcp__<server-key-in-mcp.json>__<tool-name>), not guessed.
  'mcp__optimia-tasks__create_task', 'mcp__optimia-tasks__update_task_progress'
];
const DEFAULT_MODE = 'acceptEdits';

function claudeSettingsPath(projectRoot) {
  return path.join(projectRoot, '.claude', 'settings.json');
}

/**
 * Regenerates .claude/settings.json's permissions.deny from
 * settings.preferences.noGo — this file is the actual enforcement layer
 * (Claude Code reads it at the OS level), so it must never drift from what
 * the user configured as "No-go files & commands". Preserves any other
 * top-level keys already in the file.
 */
function syncClaudeSettings(projectRoot, noGo) {
  const file = claudeSettingsPath(projectRoot);
  let current = {};
  if (fs.existsSync(file)) {
    try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { current = {}; }
  }
  const next = {
    ...current,
    // Loading an MCP server via --mcp-config needs its own project-trust
    // approval, separate from the tool-name permissions above — without
    // this, every mcp__* tool call is denied outright before the allow
    // list is even consulted (verified against the real binary).
    enableAllProjectMcpServers: true,
    permissions: {
      ...current.permissions,
      // Union, not "existing OR default": a project that already has its
      // own settings.json still picks up new DEFAULT_ALLOW entries added
      // later here, without ever dropping anything the user added.
      allow: Array.from(new Set([
        ...(Array.isArray(current.permissions?.allow) ? current.permissions.allow : []),
        ...DEFAULT_ALLOW
      ])),
      deny: noGo,
      defaultMode: current.permissions?.defaultMode || DEFAULT_MODE
    }
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { claudeSettingsPath, syncClaudeSettings, DEFAULT_ALLOW, DEFAULT_MODE };
