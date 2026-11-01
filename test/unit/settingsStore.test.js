'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { loadSettings, saveSettings, defaultSettings, settingsPath } = require('../../server/store/settingsStore');

test('loadSettings: returns defaults when settings.json does not exist', (t) => {
  const dir = mkTmpDir('settings');
  t.after(() => rmTmpDir(dir));

  const settings = loadSettings(dir);
  assert.deepEqual(settings, defaultSettings());
  assert.equal(fs.existsSync(settingsPath(dir)), false);
});

test('saveSettings: creates .optimia/ and persists settings.json', (t) => {
  const dir = mkTmpDir('settings');
  t.after(() => rmTmpDir(dir));

  const settings = defaultSettings();
  settings.ai.mode = 'local';
  settings.ai.localAi.url = 'http://localhost:11434';
  settings.preferences.instructions = 'be concise';

  saveSettings(dir, settings);

  assert.equal(fs.existsSync(settingsPath(dir)), true);
  const reloaded = loadSettings(dir);
  assert.equal(reloaded.ai.mode, 'local');
  assert.equal(reloaded.ai.localAi.url, 'http://localhost:11434');
  assert.equal(reloaded.preferences.instructions, 'be concise');
});

test('loadSettings: merges on-disk partial settings with defaults (missing fields do not crash)', (t) => {
  const dir = mkTmpDir('settings');
  t.after(() => rmTmpDir(dir));

  fs.mkdirSync(`${dir}/.optimia`, { recursive: true });
  fs.writeFileSync(settingsPath(dir), JSON.stringify({ ai: { claude: { effort: 'low' } } }));

  const settings = loadSettings(dir);
  assert.equal(settings.ai.claude.effort, 'low');
  assert.equal(settings.ai.claude.model, 'default'); // filled in from defaults
  assert.deepEqual(settings.preferences.noGo, []);
});

test('loadSettings: noGo falls back to default array if on-disk value is not an array', (t) => {
  const dir = mkTmpDir('settings');
  t.after(() => rmTmpDir(dir));

  fs.mkdirSync(`${dir}/.optimia`, { recursive: true });
  fs.writeFileSync(settingsPath(dir), JSON.stringify({ preferences: { noGo: 'not-an-array' } }));

  const settings = loadSettings(dir);
  assert.deepEqual(settings.preferences.noGo, []);
});

test('loadSettings: el tema y el reloj solo aceptan valores conocidos', (t) => {
  const dir = mkTmpDir('settings-ui');
  t.after(() => rmTmpDir(dir));
  fs.mkdirSync(`${dir}/.optimia`, { recursive: true });
  fs.writeFileSync(settingsPath(dir), JSON.stringify({ ui: { theme: 'dark', clock: 'time' } }));
  assert.deepEqual(loadSettings(dir).ui, { theme: 'dark', clock: 'time' });

  fs.writeFileSync(settingsPath(dir), JSON.stringify({ ui: { theme: 'glass', clock: 42 } }));
  assert.deepEqual(loadSettings(dir).ui, { theme: 'system', clock: 'datetime' });
});
