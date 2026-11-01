'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { createTaskWorktree, stageForReview, worktreeDir, removeTaskWorktree, listLocalBranches, branchNameProblem, commitTaskWorktree, mergeTaskBranch, filesChangedBy, changedFiles } = require('../../server/bridge/worktree');

function initGitRepo(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'hola\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

test('createTaskWorktree: creates a real git worktree on its own branch, copying .claude/settings.json', (t) => {
  const dir = mkTmpDir('worktree-repo');
  t.after(() => {
    try { execFileSync('git', ['worktree', 'remove', '--force', worktreeDir(dir, 'task-123')], { cwd: dir }); } catch { /* best effort */ }
    rmTmpDir(dir);
  });

  initGitRepo(dir);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{"permissions":{"deny":[]}}');

  const { dir: wtDir, branch } = createTaskWorktree(dir, 'task-123');

  assert.equal(wtDir, worktreeDir(dir, 'task-123'));
  assert.equal(branch, 'optimia/task-task-123'); // taskId.slice(0, 8) of "task-123" is "task-123" itself (8 chars)
  assert.equal(fs.existsSync(path.join(wtDir, 'README.md')), true);
  assert.equal(fs.existsSync(path.join(wtDir, '.claude', 'settings.json')), true);

  const branches = execFileSync('git', ['branch', '--list', branch], { cwd: dir, encoding: 'utf8' });
  assert.match(branches, new RegExp(branch));
});

test('createTaskWorktree: skips copying .claude/settings.json when the source project has none', (t) => {
  const dir = mkTmpDir('worktree-repo');
  t.after(() => {
    try { execFileSync('git', ['worktree', 'remove', '--force', worktreeDir(dir, 'task-456')], { cwd: dir }); } catch { /* best effort */ }
    rmTmpDir(dir);
  });

  initGitRepo(dir);
  const { dir: wtDir } = createTaskWorktree(dir, 'task-456');
  assert.equal(fs.existsSync(path.join(wtDir, '.claude')), false);
});

test('stageForReview: reports hasChanges false on a clean worktree and true after an edit', (t) => {
  const dir = mkTmpDir('worktree-repo');
  t.after(() => {
    try { execFileSync('git', ['worktree', 'remove', '--force', worktreeDir(dir, 'task-789')], { cwd: dir }); } catch { /* best effort */ }
    rmTmpDir(dir);
  });

  initGitRepo(dir);
  const { dir: wtDir } = createTaskWorktree(dir, 'task-789');

  assert.equal(stageForReview(wtDir).hasChanges, false);

  fs.writeFileSync(path.join(wtDir, 'README.md'), 'cambiado\n');
  assert.equal(stageForReview(wtDir).hasChanges, true);
});

test('removeTaskWorktree: quita el worktree con cambios sin commitear y su rama', (t) => {
  const dir = mkTmpDir('worktree-remove');
  t.after(() => rmTmpDir(dir));

  initGitRepo(dir);
  const { dir: wt, branch } = createTaskWorktree(dir, 'task-remove-1');
  fs.writeFileSync(path.join(wt, 'nuevo.txt'), 'cambio sin commitear\n');
  stageForReview(wt);

  removeTaskWorktree(dir, { worktreePath: wt, branch });

  assert.equal(fs.existsSync(wt), false);
  const branches = execFileSync('git', ['branch', '--list', branch], { cwd: dir, encoding: 'utf8' });
  assert.equal(branches.trim(), '');
});

test('removeTaskWorktree: una tarea sin worktree ni rama no falla', (t) => {
  const dir = mkTmpDir('worktree-remove-empty');
  t.after(() => rmTmpDir(dir));
  initGitRepo(dir);
  assert.doesNotThrow(() => removeTaskWorktree(dir, { worktreePath: null, branch: null }));
});

test('tareas: salen de la rama base elegida, con su propia rama, y se fusionan en la base', (t) => {
  const dir = mkTmpDir('worktree-flow');
  t.after(() => rmTmpDir(dir));
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), '/docs\n/.optimia\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'ignore docs'], { cwd: dir });
  execFileSync('git', ['checkout', '-q', '-b', 'fix/rebranding'], { cwd: dir });

  const listed = listLocalBranches(dir);
  assert.equal(listed.current, 'fix/rebranding');
  assert.ok(listed.branches.includes('fix/rebranding'));
  assert.equal(branchNameProblem('fix/rebranding-buttons'), null);
  assert.ok(branchNameProblem('mal..nombre'));

  const { dir: wt, branch } = createTaskWorktree(dir, 'task-flow-1', { baseRef: 'fix/rebranding', branchName: 'fix/rebranding-buttons' });
  t.after(() => { try { removeTaskWorktree(dir, { worktreePath: wt, branch }); } catch { /* best effort */ } });
  assert.equal(branch, 'fix/rebranding-buttons');

  fs.writeFileSync(path.join(wt, 'boton.css'), '.btn{}\n');
  fs.mkdirSync(path.join(wt, 'docs'));
  fs.writeFileSync(path.join(wt, 'docs', 'botones.docx'), 'x');
  const sha = commitTaskWorktree(wt, 'feat: botones', ['docs/botones.docx']);
  assert.match(sha, /^[0-9a-f]{40}$/);
  const committed = execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: dir, encoding: 'utf8' });
  assert.match(committed, /docs\/botones\.docx/);

  const mergeSha = mergeTaskBranch(dir, branch, 'fix/rebranding', 'Merge fix/rebranding-buttons en fix/rebranding');
  assert.match(mergeSha, /^[0-9a-f]{40}$/);
  assert.ok(fs.existsSync(path.join(dir, 'boton.css')));
});

test('mergeTaskBranch: fusiona aunque el checkout principal este en otra rama, y no lo cambia', (t) => {
  const dir = mkTmpDir('worktree-merge-temp');
  t.after(() => rmTmpDir(dir));
  initGitRepo(dir);
  execFileSync('git', ['branch', 'fix/base'], { cwd: dir });
  execFileSync('git', ['checkout', '-q', '-b', 'fix/tarea-x', 'fix/base'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x\n');
  execFileSync('git', ['add', 'x.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'x'], { cwd: dir });
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir });
  const before = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

  mergeTaskBranch(dir, 'fix/tarea-x', 'fix/base', 'Merge fix/tarea-x en fix/base');

  const after = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(after, before);
  assert.ok(execFileSync('git', ['show', 'fix/base:x.txt'], { cwd: dir, encoding: 'utf8' }).includes('x'));
});

test('mergeTaskBranch: se niega si la base esta checkeada con cambios sin commitear', (t) => {
  const dir = mkTmpDir('worktree-merge-dirty');
  t.after(() => rmTmpDir(dir));
  initGitRepo(dir);
  execFileSync('git', ['checkout', '-q', '-b', 'fix/base'], { cwd: dir });
  execFileSync('git', ['checkout', '-q', '-b', 'fix/tarea-y'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'y.txt'), 'y\n');
  execFileSync('git', ['add', 'y.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'y'], { cwd: dir });
  execFileSync('git', ['checkout', '-q', 'fix/base'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'cambio sin guardar\n');
  assert.throws(() => mergeTaskBranch(dir, 'fix/tarea-y', 'fix/base', 'm'), /cambios sin commitear/);
});

test('filesChangedBy y changedFiles: listan los ficheros de un commit y los pendientes', (t) => {
  const dir = mkTmpDir('worktree-files');
  t.after(() => rmTmpDir(dir));
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  execFileSync('git', ['add', 'a.txt', 'b.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'dos ficheros'], { cwd: dir });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.deepEqual(filesChangedBy(dir, sha).sort(), ['a.txt', 'b.txt']);

  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  assert.deepEqual(changedFiles(dir), ['c.txt']);
});
