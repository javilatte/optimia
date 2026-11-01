'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { readLegacyDefaults, buildMigrationPreview, applyMigration } = require('../../server/migrate/legacyImport');
const { loadSettings } = require('../../server/store/settingsStore');
const { claudeSettingsPath } = require('../../server/bridge/claudeSettingsSync');

function writeLegacyProject(dir, { systemPrompt, deny, securityMd } = {}) {
  fs.mkdirSync(path.join(dir, '.optimia'), { recursive: true });
  if (systemPrompt !== undefined) {
    fs.writeFileSync(path.join(dir, '.optimia', 'system-prompt.md'), systemPrompt);
  }
  if (securityMd !== undefined) {
    fs.writeFileSync(path.join(dir, '.optimia', 'security.md'), securityMd);
  }
  if (deny !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(claudeSettingsPath(dir), JSON.stringify({ permissions: { deny } }));
  }
}

test('readLegacyDefaults: nothing legacy present -> instructions/noGo both null', (t) => {
  const dir = mkTmpDir('legacy');
  t.after(() => rmTmpDir(dir));
  const legacy = readLegacyDefaults(dir);
  assert.equal(legacy.instructions, null);
  assert.equal(legacy.noGo, null);
  assert.equal(legacy.sources.securityFoundButNotParsed, false);
});

test('readLegacyDefaults: reads system-prompt.md and permissions.deny from .claude/settings.json', (t) => {
  const dir = mkTmpDir('legacy');
  t.after(() => rmTmpDir(dir));
  writeLegacyProject(dir, { systemPrompt: '# old prompt\n', deny: ['Read(**/.env*)'] });

  const legacy = readLegacyDefaults(dir);
  assert.equal(legacy.instructions, '# old prompt\n');
  assert.deepEqual(legacy.noGo, ['Read(**/.env*)']);
  assert.equal(legacy.sources.noGo, '.claude/settings.json');
});

test('readLegacyDefaults: security.md without a parseable .claude/settings.json flags securityFoundButNotParsed, does not guess noGo', (t) => {
  const dir = mkTmpDir('legacy');
  t.after(() => rmTmpDir(dir));
  writeLegacyProject(dir, { securityMd: 'Never touch .env files or run rm -rf.' });

  const legacy = readLegacyDefaults(dir);
  assert.equal(legacy.noGo, null);
  assert.equal(legacy.sources.securityFoundButNotParsed, true);
});

test('buildMigrationPreview: is read-only and reports changed=true when legacy differs from current', (t) => {
  const dir = mkTmpDir('legacy');
  t.after(() => rmTmpDir(dir));
  writeLegacyProject(dir, { systemPrompt: 'nuevas instrucciones', deny: ['Bash(rm -rf *)'] });

  const preview = buildMigrationPreview(dir);
  assert.equal(preview.instructions.changed, true);
  assert.equal(preview.instructions.proposed, 'nuevas instrucciones');
  assert.equal(preview.noGo.changed, true);
  assert.deepEqual(preview.noGo.proposed, ['Bash(rm -rf *)']);

  // read-only: settings.json must not have been created by just building a preview
  assert.equal(fs.existsSync(path.join(dir, '.optimia', 'settings.json')), false);
});

test('applyMigration: writes proposed values into settings.json and resyncs .claude/settings.json deny', (t) => {
  const dir = mkTmpDir('legacy');
  t.after(() => rmTmpDir(dir));
  writeLegacyProject(dir, { systemPrompt: 'instrucciones migradas', deny: ['Write(**/*.pem)'] });

  const next = applyMigration(dir);
  assert.equal(next.preferences.instructions, 'instrucciones migradas');
  assert.deepEqual(next.preferences.noGo, ['Write(**/*.pem)']);

  const reloaded = loadSettings(dir);
  assert.equal(reloaded.preferences.instructions, 'instrucciones migradas');

  const claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath(dir), 'utf8'));
  assert.deepEqual(claudeSettings.permissions.deny, ['Write(**/*.pem)']);
});

test('applyMigration: a second run with nothing new to migrate leaves current settings untouched', (t) => {
  const dir = mkTmpDir('legacy');
  t.after(() => rmTmpDir(dir));
  writeLegacyProject(dir, { systemPrompt: 'v1', deny: ['a'] });
  applyMigration(dir);

  const next = applyMigration(dir); // same legacy source, nothing "changed" the second time
  assert.equal(next.preferences.instructions, 'v1');
  assert.deepEqual(next.preferences.noGo, ['a']);
});
