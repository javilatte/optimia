'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const logger = require('../../server/bridge/logger');

test('logger: escribe un evento JSON por linea en .optimia/logs/optimia.log', (t) => {
  const dir = mkTmpDir('logger-lines');
  t.after(() => rmTmpDir(dir));
  logger.initLogger(dir);
  logger.info('task.stage.start', { taskId: 't1', stage: 'plan' });
  logger.warn('task.stage.denied', { taskId: 't1', tool: 'Bash' });

  const lines = fs.readFileSync(path.join(dir, '.optimia', 'logs', 'optimia.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.event, 'task.stage.start');
  assert.equal(first.level, 'info');
  assert.equal(first.stage, 'plan');
  assert.match(first.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(lines[1]).level, 'warn');
});

test('logger: sin inicializar no lanza y no escribe nada', () => {
  logger.initLogger(mkTmpDir('logger-noinit'));
  assert.doesNotThrow(() => logger.info('server.start', { url: 'x' }));
});

test('logger: rota el fichero al llegar a 5 MB', (t) => {
  const dir = mkTmpDir('logger-rotate');
  t.after(() => rmTmpDir(dir));
  logger.initLogger(dir);
  const file = path.join(dir, '.optimia', 'logs', 'optimia.log');
  fs.writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 10));
  logger.info('server.start', { url: 'http://127.0.0.1:1' });
  assert.ok(fs.existsSync(`${file}.1`));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').trim()).event, 'server.start');
});

test('readRecent: devuelve las entradas más recientes primero, con límite', (t) => {
  const dir = mkTmpDir('logger-recent');
  t.after(() => rmTmpDir(dir));
  logger.initLogger(dir);
  logger.info('a.first', {});
  logger.info('b.second', {});
  logger.info('c.third', {});
  const recent = logger.readRecent(2);
  assert.deepEqual(recent.map((e) => e.event), ['c.third', 'b.second']);
});
