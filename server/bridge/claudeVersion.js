'use strict';

const { execFileSync } = require('child_process');

// Required flags for the stream-json bridge (server/bridge/claudeProcess.js).
// Checked by substring match against `claude --help` instead of a pinned
// version number, since the exact version these flags landed in is unverified —
// this check is self-documenting and survives future claude releases either way.
const REQUIRED_FLAGS = ['--input-format', '--output-format', '--session-id', '--permission-mode'];

function checkClaudeCapabilities(command = 'claude') {
  let help;
  try {
    help = execFileSync(command, ['--help'], { encoding: 'utf8', timeout: 10_000 });
  } catch (err) {
    return { ok: false, missing: REQUIRED_FLAGS, error: `could not run "${command} --help": ${err.message}` };
  }
  const missing = REQUIRED_FLAGS.filter((flag) => !help.includes(flag));
  return { ok: missing.length === 0, missing, error: null };
}

module.exports = { checkClaudeCapabilities, REQUIRED_FLAGS };
