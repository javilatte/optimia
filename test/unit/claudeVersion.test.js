'use strict';

// Runs against the real `claude` binary on PATH rather than mocking
// execFileSync — a mock here would just re-assert the test's own fake
// --help output, and could stay green after a real `claude` CLI regression.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { checkClaudeCapabilities, REQUIRED_FLAGS } = require('../../server/bridge/claudeVersion');

function claudeAvailable() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('checkClaudeCapabilities: the real claude CLI on this machine has all required flags', { skip: !claudeAvailable() && 'claude CLI not installed in this environment' }, () => {
  const result = checkClaudeCapabilities();
  assert.equal(result.error, null);
  assert.deepEqual(result.missing, []);
  assert.equal(result.ok, true);
});

test('checkClaudeCapabilities: a nonexistent command reports ok=false with all flags missing', () => {
  const result = checkClaudeCapabilities('__optimia_nonexistent_cli__');
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, REQUIRED_FLAGS);
  assert.match(result.error, /__optimia_nonexistent_cli__/);
});
