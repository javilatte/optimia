'use strict';

// Unit tests for ClaudeSession's NDJSON line buffering (_onStdout) and the
// stdin payload built by send(). These exercise the real methods on the
// real prototype, but without going through the constructor (which spawns a
// real `claude` subprocess) — spawning a real process per assertion here
// would be slow and cost real API usage for logic that doesn't depend on it.
// The full real-subprocess path (spawn -> NDJSON in -> event out) is covered
// manually in Fase 3's done-when and by the live browser tests in Fase 9.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');

const HAS_CLAUDE = spawnSync('claude', ['--version'], { stdio: 'ignore' }).error === undefined;
const needsClaude = { skip: HAS_CLAUDE ? false : 'claude CLI not installed in this environment' };
const { EventEmitter } = require('events');
const { ClaudeSession } = require('../../server/bridge/claudeProcess');

function makeBareSession() {
  const session = Object.create(ClaudeSession.prototype);
  EventEmitter.call(session);
  session._buffer = '';
  session._exited = false;
  return session;
}

test('_onStdout: parses a single complete NDJSON line into an "event"', () => {
  const session = makeBareSession();
  const events = [];
  session.on('event', (e) => events.push(e));

  session._onStdout(Buffer.from('{"type":"result","result":"PONG"}\n'));

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: 'result', result: 'PONG' });
});

test('_onStdout: parses multiple NDJSON lines delivered in one chunk', () => {
  const session = makeBareSession();
  const events = [];
  session.on('event', (e) => events.push(e));

  session._onStdout(Buffer.from('{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n'));

  assert.deepEqual(events.map((e) => e.type), ['a', 'b', 'c']);
});

test('_onStdout: buffers a line split across two stdout chunks until the newline arrives', () => {
  const session = makeBareSession();
  const events = [];
  session.on('event', (e) => events.push(e));

  session._onStdout(Buffer.from('{"type":"result","resu'));
  assert.equal(events.length, 0); // no newline yet, nothing emitted

  session._onStdout(Buffer.from('lt":"PONG"}\n'));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: 'result', result: 'PONG' });
});

test('_onStdout: skips blank lines without erroring', () => {
  const session = makeBareSession();
  const events = [];
  session.on('event', (e) => events.push(e));

  session._onStdout(Buffer.from('\n{"type":"x"}\n\n'));
  assert.deepEqual(events.map((e) => e.type), ['x']);
});

test('_onStdout: an unparseable line emits "error" and does not break parsing of the next line', () => {
  const session = makeBareSession();
  const errors = [];
  const events = [];
  session.on('error', (e) => errors.push(e));
  session.on('event', (e) => events.push(e));

  session._onStdout(Buffer.from('not json\n{"type":"ok"}\n'));

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /unparseable stream-json line/);
  assert.deepEqual(events.map((e) => e.type), ['ok']);
});

test('send: text-only message writes a single text content block', () => {
  const session = makeBareSession();
  let written = null;
  session.proc = { stdin: { write: (line) => { written = line; } } };

  session.send('hola');

  const payload = JSON.parse(written);
  assert.equal(payload.type, 'user');
  assert.deepEqual(payload.message.content, [{ type: 'text', text: 'hola' }]);
});

test('send: images are placed before the text block as base64 content blocks', () => {
  const session = makeBareSession();
  let written = null;
  session.proc = { stdin: { write: (line) => { written = line; } } };

  session.send('que hay en la imagen?', [{ mediaType: 'image/png', base64Data: 'QUJD' }]);

  const payload = JSON.parse(written);
  assert.deepEqual(payload.message.content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
    { type: 'text', text: 'que hay en la imagen?' }
  ]);
});

test('send: throws once the session has exited, and never touches stdin', () => {
  const session = makeBareSession();
  session._exited = true;
  let writeCalled = false;
  session.proc = { stdin: { write: () => { writeCalled = true; } } };

  assert.throws(() => session.send('hola'), /already exited/);
  assert.equal(writeCalled, false);
});

// Real-subprocess checks for the --resume/--session-id branching. Closing
// stdin immediately, with no message ever sent, makes the real `claude`
// binary exit right away without starting a conversation turn — cheap and
// real, no API usage, same anti-mock approach as the rest of this suite.
test('constructor: with no resumeSessionId, spawns with a generated --session-id (no --resume)', needsClaude, async (t) => {
  const session = new ClaudeSession({ projectRoot: process.cwd() });
  t.after(() => session.kill());
  session.close(); // no message ever sent -> the real binary exits immediately, no API usage

  await new Promise((resolve) => session.on('exit', resolve));

  assert.ok(session.proc.spawnargs.includes('--session-id'));
  assert.ok(session.proc.spawnargs.includes(session.sessionId));
  assert.ok(!session.proc.spawnargs.includes('--resume'));
});

test('constructor: with resumeSessionId, spawns with --resume <id> (no --session-id)', needsClaude, async (t) => {
  const crypto = require('crypto');
  const resumeId = crypto.randomUUID();
  const session = new ClaudeSession({ projectRoot: process.cwd(), resumeSessionId: resumeId });
  t.after(() => session.kill());
  session.close(); // unknown session id -> the real binary errors out immediately, no API usage

  await new Promise((resolve) => session.on('exit', resolve));

  assert.equal(session.sessionId, resumeId);
  assert.ok(session.proc.spawnargs.includes('--resume'));
  assert.ok(session.proc.spawnargs.includes(resumeId));
  assert.ok(!session.proc.spawnargs.includes('--session-id'));
});

test('constructor: with mcpConfigPath, spawns with --mcp-config and --allowedTools for the MCP tasks tools', needsClaude, async (t) => {
  const session = new ClaudeSession({ projectRoot: process.cwd(), mcpConfigPath: '/tmp/does-not-exist-mcp.json' });
  t.after(() => session.kill());
  session.close();

  await new Promise((resolve) => session.on('exit', resolve));

  assert.ok(session.proc.spawnargs.includes('--mcp-config'));
  assert.ok(session.proc.spawnargs.includes('/tmp/does-not-exist-mcp.json'));
  assert.ok(session.proc.spawnargs.includes('--allowedTools'));
  const idx = session.proc.spawnargs.indexOf('--allowedTools');
  assert.match(session.proc.spawnargs[idx + 1], /mcp__optimia-tasks__create_task/);
  assert.match(session.proc.spawnargs[idx + 1], /mcp__optimia-tasks__update_task_progress/);
});

test('constructor: without mcpConfigPath, spawns with neither --mcp-config nor --allowedTools', needsClaude, async (t) => {
  const session = new ClaudeSession({ projectRoot: process.cwd() });
  t.after(() => session.kill());
  session.close();

  await new Promise((resolve) => session.on('exit', resolve));

  assert.ok(!session.proc.spawnargs.includes('--mcp-config'));
  assert.ok(!session.proc.spawnargs.includes('--allowedTools'));
});
