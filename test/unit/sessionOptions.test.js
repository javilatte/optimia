'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { defaultSettings } = require('../../server/store/settingsStore');
const { saveMemory } = require('../../server/store/memoryStore');
const { buildSessionOptions } = require('../../server/bridge/sessionOptions');
const { ALIAS_MODEL_NAME } = require('../../server/bridge/localAi');

function ollamaAvailable() {
  try {
    execFileSync('ollama', ['list'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('buildSessionOptions: claude mode, no instructions/memory -> no systemPrompt, model "default" dropped', (t) => {
  const dir = mkTmpDir('sessopts');
  t.after(() => rmTmpDir(dir));

  const settings = defaultSettings(); // ai.mode === 'claude', model 'default', effort 'high'
  const opts = buildSessionOptions(settings, dir);

  assert.equal(opts.projectRoot, dir);
  assert.equal(opts.systemPrompt, undefined);
  assert.equal(opts.model, undefined); // 'default' is not a real model name, dropped
  assert.equal(opts.effort, 'high');
});

test('buildSessionOptions: claude mode with a real model name passes it through', (t) => {
  const dir = mkTmpDir('sessopts');
  t.after(() => rmTmpDir(dir));

  const settings = defaultSettings();
  settings.ai.claude.model = 'sonnet';
  const opts = buildSessionOptions(settings, dir);
  assert.equal(opts.model, 'sonnet');
});

test('buildSessionOptions: composes instructions + project memory into systemPrompt', (t) => {
  const dir = mkTmpDir('sessopts');
  t.after(() => rmTmpDir(dir));

  saveMemory(dir, 'Recuerda: el usuario prefiere respuestas breves.');
  const settings = defaultSettings();
  settings.preferences.instructions = 'Habla siempre en espanol.';

  const opts = buildSessionOptions(settings, dir);
  assert.match(opts.systemPrompt, /Habla siempre en espanol\./);
  assert.match(opts.systemPrompt, /Recuerda: el usuario prefiere respuestas breves\./);
});

test('buildSessionOptions: reads memory from projectRoot (not cwd) for a task running in a worktree', (t) => {
  const projectRoot = mkTmpDir('sessopts-main');
  const worktreeCwd = mkTmpDir('sessopts-worktree');
  t.after(() => { rmTmpDir(projectRoot); rmTmpDir(worktreeCwd); });

  saveMemory(projectRoot, 'memoria del proyecto principal');
  const settings = defaultSettings();

  const opts = buildSessionOptions(settings, worktreeCwd, projectRoot);
  assert.equal(opts.projectRoot, worktreeCwd); // session still runs in the worktree
  assert.match(opts.systemPrompt, /memoria del proyecto principal/); // but memory comes from the main project
});

test('buildSessionOptions: local mode aliases the Ollama model and sets baseUrl/authHeader', { skip: !ollamaAvailable() && 'ollama not available in this environment' }, (t) => {
  const dir = mkTmpDir('sessopts');
  t.after(() => rmTmpDir(dir));

  const settings = defaultSettings();
  settings.ai.mode = 'local';
  settings.ai.localAi = { url: 'http://localhost:11434', model: 'qwen2.5:0.5b', authHeader: 'Authorization: Bearer x' };

  const opts = buildSessionOptions(settings, dir);
  assert.equal(opts.baseUrl, 'http://localhost:11434');
  assert.equal(opts.authHeader, 'Authorization: Bearer x');
  assert.equal(opts.model, ALIAS_MODEL_NAME);
});
