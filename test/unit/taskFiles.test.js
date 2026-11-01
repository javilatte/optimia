'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { listFilesModifiedSince, resolveInside, readPreview, openWithSystem } = require('../../server/bridge/taskFiles');

test('listFilesModifiedSince: incluye ficheros ignorados por git y omite dependencias', (t) => {
  const dir = mkTmpDir('taskfiles-list');
  t.after(() => rmTmpDir(dir));
  const since = Date.now() - 1000;
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'seo.docx'), 'x');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'a.js'), 'x');
  assert.deepEqual(listFilesModifiedSince(dir, since), ['docs/seo.docx']);
});

test('resolveInside: no permite salir del worktree', (t) => {
  const dir = mkTmpDir('taskfiles-resolve');
  t.after(() => rmTmpDir(dir));
  fs.writeFileSync(path.join(dir, 'a.md'), 'hola');
  assert.ok(resolveInside(dir, 'a.md'));
  assert.equal(resolveInside(dir, '../a.md'), null);
  assert.equal(resolveInside(dir, '/etc/passwd'), null);
  assert.equal(resolveInside(dir, 'no-existe.md'), null);
});

test('readPreview: texto plano y html; tipos sin soporte se indican', (t) => {
  const dir = mkTmpDir('taskfiles-preview');
  t.after(() => rmTmpDir(dir));
  fs.writeFileSync(path.join(dir, 'a.md'), '# hola');
  fs.writeFileSync(path.join(dir, 'b.html'), '<p>x</p>');
  fs.writeFileSync(path.join(dir, 'c.bin'), 'x');
  assert.deepEqual(readPreview(path.join(dir, 'a.md')), { kind: 'text', content: '# hola' });
  assert.deepEqual(readPreview(path.join(dir, 'b.html')), { kind: 'html', content: '<p>x</p>' });
  assert.equal(readPreview(path.join(dir, 'c.bin')).kind, 'unsupported');
});

test('readPreview: extrae el texto de un docx', (t) => {
  const dir = mkTmpDir('taskfiles-docx');
  t.after(() => rmTmpDir(dir));
  fs.mkdirSync(path.join(dir, 'word'));
  fs.writeFileSync(path.join(dir, 'word', 'document.xml'),
    '<w:document><w:body><w:p><w:r><w:t>Hola &amp; adios</w:t></w:r></w:p></w:body></w:document>');
  try {
    execFileSync('zip', ['-q', '-r', 'doc.docx', 'word'], { cwd: dir });
  } catch {
    return t.skip('zip no disponible');
  }
  const preview = readPreview(path.join(dir, 'doc.docx'));
  assert.equal(preview.kind, 'text');
  assert.match(preview.content, /Hola & adios/);
});

test('openWithSystem: plataformas sin soporte fallan con mensaje claro', async () => {
  await assert.rejects(openWithSystem('/tmp/x', { platform: 'win32' }), /no hay forma de abrir ficheros en win32/);
});
