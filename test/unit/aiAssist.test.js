'use strict';

// Real `claude -p ...` calls cost real API usage, so this file keeps the
// live-binary coverage to a single bounded call (the unknown-field branch
// below never spawns a process, so it's free and exercised fully).

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { getAiAssistSuggestion } = require('../../server/bridge/aiAssist');

function claudeAvailable() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('getAiAssistSuggestion: returns an error for an unknown field, without spawning a process', () => {
  const result = getAiAssistSuggestion({ field: 'bogus', prompt: 'x' }, { projectRoot: process.cwd() });
  assert.equal(result.suggestion, null);
  assert.match(result.error, /unknown field/);
});

test('getAiAssistSuggestion: a real "nogo" request returns a non-empty suggestion from the claude CLI', { skip: !claudeAvailable() && 'claude CLI not installed in this environment' }, () => {
  const result = getAiAssistSuggestion(
    { field: 'nogo', prompt: 'no dejes que se borren los ficheros .env' },
    { projectRoot: process.cwd() }
  );
  assert.equal(result.error, null);
  assert.equal(typeof result.suggestion, 'string');
  assert.ok(result.suggestion.length > 0);
});
