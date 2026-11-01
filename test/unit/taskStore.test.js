'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { loadTasks, addTask, updateTask } = require('../../server/store/taskStore');

test('loadTasks: returns [] when tasks.json does not exist', (t) => {
  const dir = mkTmpDir('tasks');
  t.after(() => rmTmpDir(dir));
  assert.deepEqual(loadTasks(dir), []);
});

test('addTask: persists a task with generated id, pending status, and mapped steps', (t) => {
  const dir = mkTmpDir('tasks');
  t.after(() => rmTmpDir(dir));

  const task = addTask(dir, { title: 'Fix bug', type: 'coding', steps: ['repro', 'fix'] });

  assert.equal(task.title, 'Fix bug');
  assert.equal(task.status, 'pending');
  assert.equal(task.steps.length, 2);
  assert.equal(task.steps[0].label, 'repro');
  assert.equal(task.steps[0].status, 'pending');
  assert.equal(task.instruction, 'Fix bug'); // falls back to title

  const reloaded = loadTasks(dir);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, task.id);
});

test('updateTask: patches an existing task and bumps updatedAt', async (t) => {
  const dir = mkTmpDir('tasks');
  t.after(() => rmTmpDir(dir));

  const task = addTask(dir, { title: 'Task A', type: 'coding', steps: [] });
  await new Promise((resolve) => setTimeout(resolve, 5)); // ensure updatedAt actually differs

  const updated = updateTask(dir, task.id, { status: 'in_progress' });
  assert.equal(updated.status, 'in_progress');
  assert.notEqual(updated.updatedAt, task.updatedAt);
});

test('updateTask: returns null for an unknown task id', (t) => {
  const dir = mkTmpDir('tasks');
  t.after(() => rmTmpDir(dir));
  assert.equal(updateTask(dir, 'does-not-exist', { status: 'in_progress' }), null);
});
