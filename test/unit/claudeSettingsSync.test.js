'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { syncClaudeSettings, claudeSettingsPath, DEFAULT_ALLOW, DEFAULT_MODE } = require('../../server/bridge/claudeSettingsSync');

test('syncClaudeSettings: creates .claude/settings.json with deny list and defaults when none exists', (t) => {
  const dir = mkTmpDir('claudesync');
  t.after(() => rmTmpDir(dir));

  const noGo = ['Read(**/.env*)', 'Bash(rm -rf *)'];
  const result = syncClaudeSettings(dir, noGo);

  assert.deepEqual(result.permissions.deny, noGo);
  assert.deepEqual(result.permissions.allow, DEFAULT_ALLOW);
  assert.equal(result.permissions.defaultMode, DEFAULT_MODE);
  assert.equal(result.enableAllProjectMcpServers, true);

  const onDisk = JSON.parse(fs.readFileSync(claudeSettingsPath(dir), 'utf8'));
  assert.deepEqual(onDisk, result);
});

test('syncClaudeSettings: preserves unrelated top-level keys and custom allow/defaultMode already on disk', (t) => {
  const dir = mkTmpDir('claudesync');
  t.after(() => rmTmpDir(dir));

  fs.mkdirSync(`${dir}/.claude`, { recursive: true });
  fs.writeFileSync(claudeSettingsPath(dir), JSON.stringify({
    someOtherKey: 'keep-me',
    permissions: { allow: ['Read', 'Bash(my-custom-script *)'], deny: ['old-deny'], defaultMode: 'plan' }
  }));

  const result = syncClaudeSettings(dir, ['new-deny']);

  assert.equal(result.someOtherKey, 'keep-me');
  // Union, not overwrite: a custom entry already on disk survives, and any
  // DEFAULT_ALLOW entry not yet there (e.g. added in a later optimia
  // version) gets picked up too — projects never get stuck on a stale list.
  assert.ok(result.permissions.allow.includes('Bash(my-custom-script *)'));
  for (const entry of DEFAULT_ALLOW) assert.ok(result.permissions.allow.includes(entry));
  assert.equal(result.permissions.defaultMode, 'plan'); // preserved
  assert.deepEqual(result.permissions.deny, ['new-deny']); // deny is always overwritten from noGo
});

test('syncClaudeSettings: deny list never drifts from what was passed in, even if it is empty', (t) => {
  const dir = mkTmpDir('claudesync');
  t.after(() => rmTmpDir(dir));

  syncClaudeSettings(dir, ['a']);
  const result = syncClaudeSettings(dir, []);
  assert.deepEqual(result.permissions.deny, []);
});
