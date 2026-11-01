'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');

/**
 * Wraps one long-lived `claude -p --input-format stream-json --output-format
 * stream-json` process for a single chat/task. One process per open session,
 * fed NDJSON on stdin, emitting parsed NDJSON events read from stdout.
 *
 * `--permission-prompts none`: a headless process has no TTY to answer an
 * interactive permission prompt, so anything not already resolved by
 * .claude/settings.json (or --permission-mode) is auto-denied instead of
 * hanging forever. `--permission-mode` itself is left to the project's
 * normal settings.json — the bridge must behave like "claude code normal",
 * not grant itself extra permissions.
 */
class ClaudeSession extends EventEmitter {
  constructor({ projectRoot, sessionId, resumeSessionId, model, effort, baseUrl, authHeader, systemPrompt, mcpConfigPath, extraAllowedTools = [], disallowedTools = [], gitHooksPath } = {}) {
    super();
    this.projectRoot = projectRoot;
    this.sessionId = resumeSessionId || sessionId || crypto.randomUUID();
    this._buffer = '';
    this._exited = false;

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose'
    ];
    // Resuming a prior conversation pins its identity via --resume; a fresh
    // session instead picks its own --session-id so we can persist it.
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    } else {
      args.push('--session-id', this.sessionId);
    }
    args.push('--permission-prompts', 'none');
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
    const allowedTools = [];
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
      // A headless, --permission-prompts none session has no approval surface:
      // MCP tool calls are denied outright regardless of .claude/settings.json's
      // permissions.allow (verified against the real binary — allow-list entries
      // and enableAllProjectMcpServers are not enough on their own). --allowedTools
      // is the one mechanism that actually lets a specific MCP tool through
      // without granting bypassPermissions (which would also defeat the no-go
      // deny list).
      allowedTools.push('mcp__optimia-tasks__create_task', 'mcp__optimia-tasks__update_task_progress');
    }
    // Herramientas extra que una etapa de tarea necesita sin preguntar (ver
    // taskStages.js). Las reglas "deny" de .claude/settings.json siguen
    // ganando sobre estas.
    allowedTools.push(...extraAllowedTools);
    if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
    if (disallowedTools.length) args.push('--disallowedTools', disallowedTools.join(','));

    const env = { ...process.env };
    // Solo para sesiones de tarea: el hook bloquea commits y pushes aunque el
    // comando llegue con flags (git -c ...) que las reglas de texto no cubren.
    if (gitHooksPath) {
      env.GIT_CONFIG_COUNT = '1';
      env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
      env.GIT_CONFIG_VALUE_0 = gitHooksPath;
    }
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
    if (authHeader) env.ANTHROPIC_CUSTOM_HEADERS = authHeader;

    this.proc = spawn('claude', args, { cwd: projectRoot, env });

    this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
    this.proc.stderr.on('data', (chunk) => this.emit('stderr', chunk.toString('utf8')));
    this.proc.on('exit', (code, signal) => {
      this._exited = true;
      this.emit('exit', { code, signal });
    });
    this.proc.on('error', (err) => this.emit('error', err));
  }

  _onStdout(chunk) {
    this._buffer += chunk.toString('utf8');
    let newlineIndex;
    while ((newlineIndex = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, newlineIndex);
      this._buffer = this._buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (err) {
        this.emit('error', new Error(`unparseable stream-json line: ${line}`));
        continue;
      }
      this.emit('event', event);
    }
  }

  /** text: string, images: [{mediaType, base64Data}] */
  send(text, images = []) {
    if (this._exited) throw new Error('claude session already exited');
    const content = [];
    for (const img of images) {
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64Data } });
    }
    content.push({ type: 'text', text });
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content } });
    this.proc.stdin.write(line + '\n');
  }

  close() {
    if (this._exited) return;
    this.proc.stdin.end();
  }

  kill() {
    if (this._exited) return;
    this.proc.kill();
  }
}

module.exports = { ClaudeSession };
