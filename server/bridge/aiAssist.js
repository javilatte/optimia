'use strict';

const { execFileSync } = require('child_process');

// Short, field-specific framing so the suggestion matches what each Settings
// field actually expects (a single permission pattern vs. free-form prose).
const FIELD_PROMPTS = {
  instructions: (prompt, current) =>
    `Escribe una instruccion breve en espanol para anadir al system prompt de un asistente de codigo, segun esta peticion: "${prompt}".${current ? ` Instrucciones actuales: "${current}".` : ''} Responde solo con el texto de la instruccion, sin explicaciones ni comillas.`,
  memory: (prompt, current) =>
    `Escribe una nota breve en espanol de texto libre para la memoria de un proyecto, segun esta peticion: "${prompt}".${current ? ` Memoria actual: "${current}".` : ''} Responde solo con el texto de la nota, sin explicaciones ni comillas.`,
  nogo: (prompt) =>
    `Un usuario quiere prohibir esto a un asistente de codigo: "${prompt}". Responde con un unico patron de permiso estilo Claude Code "permissions.deny" (ej. "Read(**/.env*)" o "Bash(rm -rf *)"). Responde solo con el patron, sin explicaciones ni comillas.`,
  skills: (prompt) =>
    `Escribe una descripcion breve (una frase, en espanol) para una skill de Claude Code segun esta peticion: "${prompt}". Responde solo con la descripcion, sin explicaciones ni comillas.`
};

function buildPrompt(field, prompt, current) {
  const build = FIELD_PROMPTS[field];
  if (!build) return null;
  return build(prompt, current);
}

// Single non-interactive call, no tools or --mcp-config — same pattern as
// claudeVersion.js/claudeAuth.js. The suggestion is never auto-applied; the
// caller inserts it into the field for the user to review before Guardar.
function getAiAssistSuggestion({ field, prompt, current }, { projectRoot } = {}) {
  const fullPrompt = buildPrompt(field, prompt, current);
  if (!fullPrompt) return { suggestion: null, error: `unknown field: ${field}` };
  try {
    const out = execFileSync('claude', ['-p', fullPrompt, '--output-format', 'text'], {
      encoding: 'utf8',
      timeout: 30_000,
      cwd: projectRoot
    });
    return { suggestion: out.trim(), error: null };
  } catch (err) {
    return { suggestion: null, error: err.message };
  }
}

module.exports = { getAiAssistSuggestion };
