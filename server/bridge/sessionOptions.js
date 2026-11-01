'use strict';

const fs = require('fs');
const path = require('path');
const { ALIAS_MODEL_NAME, ensureOllamaAlias } = require('./localAi');
const { loadMemory } = require('../store/memoryStore');

const CHAT_TASKS_PROMPT = `## Crear tareas para agentes
Dispones de la tool MCP "create_task". Usala solo despues de cerrar un plan concreto con el
usuario (por ejemplo tras usar la skill plan-optimizer), nunca para un pedido vago o a mitad de
una exploracion. Cada tarea creada arranca un agente independiente en su propio worktree; dale una
instruccion autocontenida (el agente no vera el resto de esta conversacion).`;

function taskProgressPrompt(taskId) {
  return `## Reportar progreso de esta tarea
Esta sesion corresponde a la tarea con id "${taskId}". Dispones de la tool MCP "update_task_progress"
para reportar el avance real en el panel de agentes del usuario, en sus 3 fases: "plan" (al entender
el encargo y antes de tocar codigo), "implement" (mientras editas) y "test" (verificacion final).
Llama a la tool con ese taskId al EMPEZAR cada fase (status "active") y al TERMINARLA (status "done"),
o "blocked" si no puedes continuar. No esperes al final para reportar todo de golpe.`;
}

/**
 * Builds ClaudeSession constructor options from settings, for a given
 * working directory (the main project root for the chat panel, or a task's
 * worktree directory for a dedicated task session). Shared so both paths
 * apply the same local-AI aliasing (see Fase 4) and the same Instructions +
 * Memory system prompt (see Fase 8) — Memory is always read from the main
 * projectRoot's .optimia/memory.md, even for a task session running in a
 * worktree, since memory is project-wide, not per-worktree.
 *
 * `taskId`: pass it for a task's own session so it can self-report progress
 * via update_task_progress without having to carry its own id around; leave
 * it undefined for the main chat session, which instead gets create_task.
 */
function buildSessionOptions(settings, cwd, projectRoot = cwd, taskId) {
  const ai = settings.ai;
  const opts = { projectRoot: cwd };

  const mcpConfigPath = path.join(projectRoot, '.optimia', 'mcp.json');
  if (fs.existsSync(mcpConfigPath)) opts.mcpConfigPath = mcpConfigPath;

  const parts = [];
  if (settings.preferences?.instructions) parts.push(settings.preferences.instructions);
  const memory = loadMemory(projectRoot);
  if (memory.trim()) parts.push(`## Memoria del proyecto\n${memory}`);
  if (opts.mcpConfigPath) parts.push(taskId ? taskProgressPrompt(taskId) : CHAT_TASKS_PROMPT);
  if (parts.length) opts.systemPrompt = parts.join('\n\n');

  if (ai.mode === 'local') {
    opts.baseUrl = ai.localAi.url || undefined;
    opts.authHeader = ai.localAi.authHeader || undefined;
    if (ai.localAi.model) {
      ensureOllamaAlias(ai.localAi.model);
      opts.model = ALIAS_MODEL_NAME;
    }
  } else {
    opts.model = ai.claude.model && ai.claude.model !== 'default' ? ai.claude.model : undefined;
    opts.effort = ai.claude.effort || undefined;
  }
  return opts;
}

module.exports = { buildSessionOptions };
