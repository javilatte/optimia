'use strict';

const { execFileSync } = require('child_process');

/**
 * `claude` CLI validates --model against an internal list of recognized
 * Claude model names BEFORE sending the request — verified empirically: an
 * arbitrary local model name (e.g. "qwen2.5:0.5b") is rejected client-side
 * with "There's an issue with the selected model" even though the endpoint
 * behind ANTHROPIC_BASE_URL serves it fine. The workaround, also verified:
 * alias the local model to a recognized Claude model name with `ollama cp`,
 * then pass that alias as --model. Ollama resolves the alias to the real
 * weights on its end; claude CLI only ever sees a name it recognizes.
 *
 * This ties "Local AI" mode to Ollama specifically (the alias step is
 * Ollama tooling) — matches the Fase 0 spike, which confirmed Ollama >=0.14
 * serves a native Anthropic-compatible /v1/messages endpoint.
 */
const ALIAS_MODEL_NAME = 'claude-haiku-4-5';

function ensureOllamaAlias(realModelName) {
  try {
    execFileSync('ollama', ['cp', realModelName, ALIAS_MODEL_NAME], { timeout: 30_000 });
  } catch (err) {
    throw new Error(`could not alias local model "${realModelName}" via Ollama — is it pulled? (${err.message})`);
  }
}

/**
 * Lists models actually pulled in the local Ollama install, for the Settings/
 * composer model picker. Excludes ALIAS_MODEL_NAME itself — it's an internal
 * implementation detail (see ensureOllamaAlias above), not a real local model
 * a user would pick.
 */
function listLocalModels() {
  let out;
  try {
    out = execFileSync('ollama', ['list'], { encoding: 'utf8', timeout: 10_000 });
  } catch {
    return [];
  }
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, , size] = line.split(/\s{2,}/);
      return { name, size };
    })
    .filter((m) => m.name && m.name !== `${ALIAS_MODEL_NAME}:latest` && m.name !== ALIAS_MODEL_NAME);
}

module.exports = { ALIAS_MODEL_NAME, ensureOllamaAlias, listLocalModels };
