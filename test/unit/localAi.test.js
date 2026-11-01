'use strict';

// Runs against the real `ollama` binary rather than mocking child_process —
// the whole point of ensureOllamaAlias is a real, empirically-verified `ollama
// cp` workaround (see the comment in localAi.js), so a mock would hide a
// regression in Ollama's own CLI behavior.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { ensureOllamaAlias, ALIAS_MODEL_NAME, listLocalModels } = require('../../server/bridge/localAi');

function pulledOllamaModel() {
  try {
    const out = execFileSync('ollama', ['list'], { encoding: 'utf8' });
    const line = out.split('\n').slice(1).find((l) => l.trim());
    return line ? line.trim().split(/\s+/)[0] : null;
  } catch {
    return null;
  }
}

const model = pulledOllamaModel();

test('ensureOllamaAlias: aliases a real pulled model without throwing', { skip: !model && 'no ollama model pulled in this environment' }, () => {
  assert.doesNotThrow(() => ensureOllamaAlias(model));
  const aliases = execFileSync('ollama', ['list'], { encoding: 'utf8' });
  assert.match(aliases, new RegExp(ALIAS_MODEL_NAME.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
});

test('ensureOllamaAlias: throws a descriptive error for a model that was never pulled', { skip: !model && 'ollama not available in this environment' }, () => {
  assert.throws(
    () => ensureOllamaAlias('__optimia_nonexistent_model_xyz__'),
    /could not alias local model/
  );
});

test('listLocalModels: lists real pulled models with a name and size, excluding the internal alias', { skip: !model && 'ollama not available in this environment' }, () => {
  const models = listLocalModels();
  assert.ok(models.length > 0);
  for (const m of models) {
    assert.equal(typeof m.name, 'string');
    assert.equal(typeof m.size, 'string');
    assert.notEqual(m.name, `${ALIAS_MODEL_NAME}:latest`);
    assert.notEqual(m.name, ALIAS_MODEL_NAME);
  }
});

test('listLocalModels: returns an empty array when the ollama binary is not available', () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '';
  try {
    assert.deepEqual(listLocalModels(), []);
  } finally {
    process.env.PATH = originalPath;
  }
});
