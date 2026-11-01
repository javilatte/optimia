'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { loadMemory, saveMemory } = require('../../server/store/memoryStore');

test('loadMemory: returns "" when memory.md does not exist', (t) => {
  const dir = mkTmpDir('memory');
  t.after(() => rmTmpDir(dir));
  assert.equal(loadMemory(dir), '');
});

test('saveMemory then loadMemory: round-trips free text exactly, creating .optimia/', (t) => {
  const dir = mkTmpDir('memory');
  t.after(() => rmTmpDir(dir));

  saveMemory(dir, 'El usuario prefiere Spanish peninsular.\n');
  assert.equal(loadMemory(dir), 'El usuario prefiere Spanish peninsular.\n');
});

test('saveMemory: overwrites previous content', (t) => {
  const dir = mkTmpDir('memory');
  t.after(() => rmTmpDir(dir));

  saveMemory(dir, 'first');
  saveMemory(dir, 'second');
  assert.equal(loadMemory(dir), 'second');
});
