'use strict';

const { execFileSync, execFile } = require('child_process');

// Real account info from the `claude` CLI itself (email, org, subscription
// type) — never fabricated, since the Settings UI must not invent account
// details it has no verified source for (same rule applied to model names
// in Fase 6).
function getClaudeAuthStatus() {
  try {
    const out = execFileSync('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 10_000 });
    return JSON.parse(out);
  } catch (err) {
    return { loggedIn: false, error: err.message };
  }
}

// `claude auth login` is interactive (needs a TTY/browser), so it can't run
// through the headless pipe this server uses for chat/task sessions — it is
// opened in a real terminal window instead, same best-effort per-platform
// pattern as openInBrowser() in server/index.js.
const LINUX_TERMINALS = [
  ['x-terminal-emulator', ['-e', 'claude auth login']],
  ['gnome-terminal', ['--', 'claude', 'auth', 'login']],
  ['konsole', ['-e', 'claude auth login']],
  ['xfce4-terminal', ['-e', 'claude auth login']],
  ['xterm', ['-e', 'claude auth login']]
];

const MANUAL_HINT = 'Ejecuta "claude auth login" en una terminal.';

// Lanza un comando y resuelve true si el proceso arranca, false si el ejecutable no existe.
function trySpawn(cmd, args) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, () => {});
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });
}

async function openAuthLoginInTerminal() {
  const platform = process.platform;
  if (platform === 'darwin') {
    const ok = await trySpawn('osascript', ['-e', 'tell app "Terminal" to do script "claude auth login"']);
    return ok ? { ok: true } : { ok: false, error: `No se pudo abrir Terminal. ${MANUAL_HINT}` };
  }
  if (platform === 'win32') {
    const ok = await trySpawn('cmd', ['/c', 'start', 'cmd', '/k', 'claude auth login']);
    return ok ? { ok: true } : { ok: false, error: `No se pudo abrir cmd. ${MANUAL_HINT}` };
  }
  for (const [cmd, args] of LINUX_TERMINALS) {
    if (await trySpawn(cmd, args)) return { ok: true };
  }
  return { ok: false, error: `No encuentro un emulador de terminal (probado: ${LINUX_TERMINALS.map(([c]) => c).join(', ')}). ${MANUAL_HINT}` };
}

module.exports = { getClaudeAuthStatus, openAuthLoginInTerminal };
