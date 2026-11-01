'use strict';

const pty = require('node-pty');
const { EventEmitter } = require('events');

const SCROLLBACK_LIMIT = 200_000; // chars kept in memory, oldest trimmed first

/**
 * Wraps one long-lived, real interactive `claude` process in a pseudo-terminal.
 * Unlike ClaudeSession (headless -p, --permission-prompts none), this is the
 * normal interactive CLI: no permission flags are passed, so .claude/settings.json
 * applies exactly as it would for a human running `claude` by hand in this
 * project — including real permission prompts, rendered and answerable because
 * there is now a real TTY on the other end.
 */
class PtySession extends EventEmitter {
  constructor({ cwd, mcpConfigPath, cols = 80, rows = 24, resumeSessionId } = {}) {
    super();
    this.scrollback = '';
    this._exited = false;

    const args = [];
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
    this.proc = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env
    });

    this.proc.onData((data) => {
      this.scrollback = (this.scrollback + data).slice(-SCROLLBACK_LIMIT);
      this.emit('data', data);
    });
    this.proc.onExit((info) => {
      this._exited = true;
      this.emit('exit', info);
    });
  }

  write(data) {
    if (this._exited) return;
    this.proc.write(data);
  }

  resize(cols, rows) {
    if (this._exited) return;
    this.proc.resize(cols, rows);
  }

  kill() {
    if (this._exited) return;
    this.proc.kill();
  }
}

module.exports = { PtySession };
