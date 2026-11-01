'use strict';

const fs = require('fs');
const path = require('path');

// Los commits y pushes los hace siempre el usuario. Las reglas de permiso
// comparan texto, asi que un `git -c ... commit` se les escapa; estos hooks se
// ejecutan siempre que git commitee o empuje, sea cual sea la sintaxis.
const HOOKS = ['pre-commit', 'pre-merge-commit', 'pre-rebase', 'pre-push'];
const MESSAGE = 'optimia: los commits, merges y pushes los hace el usuario, no un agente de tarea.';

function ensureGitGuardHooks(projectRoot) {
  const dir = path.join(projectRoot, '.optimia', 'git-guard');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of HOOKS) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\necho "${MESSAGE}" >&2\nexit 1\n`, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

module.exports = { ensureGitGuardHooks };
