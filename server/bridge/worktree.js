'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function worktreeDir(projectRoot, taskId) {
  return path.join(projectRoot, '.optimia', 'worktrees', taskId);
}

function git(projectRoot, args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim();
}

/**
 * One git worktree + branch per task, so concurrent task sessions never
 * collide on uncommitted changes in the main checkout. Branches off whatever
 * the project's current HEAD is at creation time.
 */
function createTaskWorktree(projectRoot, taskId, { baseRef, branchName } = {}) {
  const dir = worktreeDir(projectRoot, taskId);
  const branch = branchName || `optimia/task-${taskId.slice(0, 8)}`;
  const base = baseRef || git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  git(projectRoot, ['worktree', 'add', '-b', branch, dir, base]);

  // .claude/ is gitignored (it's local enforcement config, not project source),
  // so a fresh worktree never has it. Without it, a headless `claude -p`
  // session auto-denies every tool call (see claudeProcess.js's
  // --permission-prompts none) and silently does nothing. Copy it in so the
  // task session gets the same permissions as the main project.
  const srcSettings = path.join(projectRoot, '.claude', 'settings.json');
  if (fs.existsSync(srcSettings)) {
    const destDir = path.join(dir, '.claude');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcSettings, path.join(destDir, 'settings.json'));
  }

  return { dir, branch };
}

/**
 * Stages all changes in the task's worktree so a human can review and commit
 * — never commits on its own. The golden rule ("no commit sin que el
 * usuario lo pida") applies to task worktrees exactly like the main repo.
 */
function stageForReview(worktreeDirPath) {
  execFileSync('git', ['add', '-A'], { cwd: worktreeDirPath });
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: worktreeDirPath, encoding: 'utf8' });
  return { hasChanges: status.trim().length > 0 };
}

/**
 * Removes a task's worktree (including any staged or uncommitted changes) and
 * its branch. Callers must have confirmed with the user first.
 */
function removeTaskWorktree(projectRoot, { worktreePath, branch }) {
  if (worktreePath && fs.existsSync(worktreePath)) {
    git(projectRoot, ['worktree', 'remove', '--force', worktreePath]);
  }
  git(projectRoot, ['worktree', 'prune']);
  if (branch) {
    const exists = (() => {
      try { git(projectRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); return true; }
      catch { return false; }
    })();
    if (exists) git(projectRoot, ['branch', '-D', branch]);
  }
}

function listLocalBranches(projectRoot) {
  const branches = git(projectRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean);
  return { current: git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), branches };
}

// Devuelve el motivo si el nombre no es una rama valida, o null.
function branchNameProblem(name) {
  try {
    execFileSync('git', ['check-ref-format', '--branch', name], { stdio: 'pipe' });
    return null;
  } catch {
    return `nombre de rama no valido: ${name}`;
  }
}

// Commit de los cambios de la tarea. Los ficheros generados (p. ej. docs/, que
// esta en .gitignore) se anaden de forma explicita, porque la tarea los produce.
function commitTaskWorktree(worktreeDirPath, message, outputFiles = []) {
  execFileSync('git', ['add', '-A'], { cwd: worktreeDirPath });
  const existing = outputFiles.filter((f) => fs.existsSync(path.join(worktreeDirPath, f)));
  if (existing.length) execFileSync('git', ['add', '-f', '--', ...existing], { cwd: worktreeDirPath });
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: worktreeDirPath, encoding: 'utf8' }).trim();
  if (!staged) throw new Error('no hay cambios que commitear');
  execFileSync('git', ['commit', '-m', message], { cwd: worktreeDirPath, encoding: 'utf8' });
  return git(worktreeDirPath, ['rev-parse', 'HEAD']);
}

function worktreeIsClean(worktreeDirPath) {
  return git(worktreeDirPath, ['status', '--porcelain']) === '';
}

// Ruta del worktree donde esta checkeada una rama, o null si no esta checkeada en ninguno.
function worktreeOfBranch(projectRoot, branch) {
  let current = null;
  for (const line of git(projectRoot, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}`) return current;
  }
  return null;
}

function mergeAt(dir, branch, targetBranch, message) {
  try {
    git(dir, ['merge', '--no-ff', '-m', message, branch]);
  } catch (err) {
    try { git(dir, ['merge', '--abort']); } catch { /* no habia merge en curso */ }
    throw new Error(`conflictos al fusionar ${branch} en ${targetBranch}; resuelvelos a mano. ${err.message.split('\n')[0]}`);
  }
  return git(dir, ['rev-parse', 'HEAD']);
}

// Fusiona la rama de la tarea en la base sin cambiar de rama en el checkout del usuario:
// si la base esta checkeada en algun worktree, se fusiona ahi (exigiendo que este limpio);
// si no, se usa un worktree temporal sobre la base que se borra al terminar.
function mergeTaskBranch(projectRoot, branch, targetBranch, message) {
  const checkedOutAt = worktreeOfBranch(projectRoot, targetBranch);
  if (checkedOutAt) {
    if (git(checkedOutAt, ['status', '--porcelain']) !== '') {
      throw new Error(`hay cambios sin commitear en ${checkedOutAt}; no se puede fusionar en "${targetBranch}" ahora`);
    }
    return mergeAt(checkedOutAt, branch, targetBranch, message);
  }
  const tmp = path.join(projectRoot, '.optimia', 'merge-tmp', `${targetBranch.replace(/[^A-Za-z0-9]/g, '-')}-${Date.now()}`);
  git(projectRoot, ['worktree', 'add', tmp, targetBranch]);
  try {
    return mergeAt(tmp, branch, targetBranch, message);
  } finally {
    try { git(projectRoot, ['worktree', 'remove', '--force', tmp]); } catch { /* ya borrado */ }
  }
}

module.exports = {
  worktreeDir, createTaskWorktree, stageForReview, removeTaskWorktree,
  listLocalBranches, branchNameProblem, commitTaskWorktree, worktreeIsClean, mergeTaskBranch
};
