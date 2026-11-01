'use strict';

// Runs against the real `claude auth status` rather than mocking — only
// asserts the response shape, never the actual account/email value, so the
// test doesn't bake a real person's identity into the suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { getClaudeAuthStatus } = require('../../server/bridge/claudeAuth');

function claudeAvailable() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('getClaudeAuthStatus: returns a well-shaped status object from the real claude CLI', { skip: !claudeAvailable() && 'claude CLI not installed in this environment' }, () => {
  const status = getClaudeAuthStatus();
  assert.equal(typeof status.loggedIn, 'boolean');
  if (status.loggedIn) {
    assert.equal(typeof status.email, 'string');
  } else {
    assert.equal(typeof status.error, 'string');
  }
});

test('getClaudeAuthStatus: never throws, regardless of auth state', () => {
  assert.doesNotThrow(() => getClaudeAuthStatus());
});
