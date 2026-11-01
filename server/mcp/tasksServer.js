'use strict';

// Stdio MCP server, launched as a child process of `claude` itself (via
// --mcp-config), not of the optimia HTTP server. It has no direct access to
// the running server's in-memory state, so every tool call round-trips back
// into it over plain HTTP, using the port the parent process passed through
// OPTIMIA_PORT (the real listening port is only known after server.listen()
// resolves, since optimia uses an ephemeral port — see server/index.js).

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const port = process.env.OPTIMIA_PORT;
if (!port) {
  console.error('tasksServer: OPTIMIA_PORT env var is required');
  process.exit(1);
}
const base = `http://127.0.0.1:${port}`;
const fixedTaskId = process.env.OPTIMIA_TASK_ID || null;

const server = new McpServer({ name: 'optimia-tasks', version: '1.0.0' });

server.registerTool(
  'create_task',
  {
    description:
      'Crea una tarea nueva para un agente de optimia a partir de un plan acordado con el usuario en el chat. ' +
      'Usar solo despues de cerrar un plan concreto con el usuario (p. ej. con la skill plan-optimizer), no para pedidos vagos.',
    inputSchema: {
      title: z.string().describe('Titulo corto de la tarea, visible en el panel de agentes'),
      type: z.enum(['coding', 'documentation']).describe('Tipo de tarea'),
      instruction: z.string().describe('Instruccion completa y autocontenida para el agente que ejecutara la tarea en su propio worktree')
    }
  },
  async ({ title, type, instruction }) => {
    const res = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, type, instruction })
    });
    if (!res.ok) {
      return { content: [{ type: 'text', text: `Error creando la tarea: HTTP ${res.status}` }], isError: true };
    }
    const task = await res.json();
    return { content: [{ type: 'text', text: `Tarea creada con id ${task.id}: ${task.title}` }] };
  }
);

server.registerTool(
  'update_task_progress',
  {
    description:
      'Reporta el progreso real de una tarea en una de sus 3 fases (plan, implement, test) para que el panel de ' +
      'agentes de optimia lo refleje. Llamar al empezar y al terminar cada fase, no solo al final.',
    inputSchema: {
      taskId: z
        .string()
        .optional()
        .describe('Id de la tarea. Si esta sesion ya corresponde a una tarea concreta, se puede omitir.'),
      phase: z.enum(['plan', 'implement', 'test']),
      status: z.enum(['pending', 'active', 'done', 'blocked'])
    }
  },
  async ({ taskId, phase, status }) => {
    const id = taskId || fixedTaskId;
    if (!id) {
      return { content: [{ type: 'text', text: 'Error: no se pudo determinar el taskId (no se paso y esta sesion no tiene uno fijo)' }], isError: true };
    }
    const res = await fetch(`${base}/api/tasks/${id}/phase`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, status })
    });
    if (!res.ok) {
      return { content: [{ type: 'text', text: `Error actualizando la fase: HTTP ${res.status}` }], isError: true };
    }
    return { content: [{ type: 'text', text: `Fase "${phase}" de la tarea ${id} actualizada a "${status}"` }] };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
