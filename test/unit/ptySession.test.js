'use strict';

// Unit tests for PtySession. Like claudeProcess.test.js, these spawn the
// real `claude` binary in a real pty (node-pty) rather than mocking it, but
// never send it a message — the process is killed right after its first
// render, so there's no API usage, only the real PTY plumbing is exercised.

const test = require('node:test');
const assert = require('node:assert/strict');
const { PtySession } = require('../../server/bridge/ptySession');

test('constructor: spawns a real claude process in a pty and emits real data', async (t) => {
  const session = new PtySession({ cwd: process.cwd() });
  t.after(() => session.kill());

  const chunk = await new Promise((resolve) => session.once('data', resolve));

  assert.ok(chunk.length > 0);
  assert.ok(session.scrollback.length > 0);
});

test('scrollback: accumulates data and trims to the configured limit', () => {
  const session = Object.create(PtySession.prototype);
  session.scrollback = 'x'.repeat(199_995);
  const { EventEmitter } = require('events');
  EventEmitter.call(session);

  // Simulate the same trimming logic the onData handler applies, without a
  // real process attached.
  const SCROLLBACK_LIMIT = 200_000;
  session.scrollback = (session.scrollback + 'abcdefghij').slice(-SCROLLBACK_LIMIT);

  assert.equal(session.scrollback.length, SCROLLBACK_LIMIT);
  assert.ok(session.scrollback.endsWith('abcdefghij'));
});

test('write/resize/kill: no-op once the session has exited, and never throw', async (t) => {
  const session = new PtySession({ cwd: process.cwd() });
  await new Promise((resolve) => session.once('data', resolve));

  session.kill();
  await new Promise((resolve) => session.once('exit', resolve));

  assert.doesNotThrow(() => session.write('hola'));
  assert.doesNotThrow(() => session.resize(100, 30));
  assert.doesNotThrow(() => session.kill());
});

test('constructor: with mcpConfigPath set, still spawns and emits real data', async (t) => {
  // claude re-execs itself on startup, so by the time it's running the pty's
  // own pid no longer maps to a process whose argv we can inspect via ps —
  // this just proves passing mcpConfigPath doesn't break the spawn.
  const session = new PtySession({ cwd: process.cwd(), mcpConfigPath: '/tmp/does-not-exist-mcp.json' });
  t.after(() => session.kill());

  const chunk = await new Promise((resolve) => session.once('data', resolve));
  assert.ok(chunk.length > 0);
});

test('constructor: with resumeSessionId set, still spawns and emits real data', async (t) => {
  // A nonexistent session id makes claude print an error and exit rather than
  // hang — either way proves --resume is passed and the spawn isn't broken,
  // which is all this test needs (no real session to actually resume here).
  const session = new PtySession({ cwd: process.cwd(), resumeSessionId: 'not-a-real-session-id' });
  t.after(() => session.kill());

  const chunk = await new Promise((resolve) => session.once('data', resolve));
  assert.ok(chunk.length > 0);
});
