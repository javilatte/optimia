'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { WebSocketServer, WebSocket } = require('ws');
const { loadSettings, saveSettings } = require('./store/settingsStore');
const { loadTasks, addTask, updateTask, updateTaskPhase, deleteTask } = require('./store/taskStore');
const { listChats, loadChat, createChat, updateChatMeta, appendMessage, deleteChat } = require('./store/chatStore');
const { checkClaudeCapabilities } = require('./bridge/claudeVersion');
const { ClaudeSession } = require('./bridge/claudeProcess');
const { PtySession } = require('./bridge/ptySession');
const { syncClaudeSettings } = require('./bridge/claudeSettingsSync');
const { buildMigrationPreview, applyMigration } = require('./migrate/legacyImport');
const { buildSessionOptions } = require('./bridge/sessionOptions');
const { createTaskWorktree, stageForReview, removeTaskWorktree, listLocalBranches, branchNameProblem, commitTaskWorktree, worktreeIsClean, mergeTaskBranch, filesChangedBy, changedFiles } = require('./bridge/worktree');
const { pickFile } = require('./bridge/filePicker');
const logger = require('./bridge/logger');

const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);
// Texto de preguntas y respuestas que se guarda en el registro, recortado.
const cut = (text, n = 500) => (typeof text !== 'string' ? null : text.length > n ? `${text.slice(0, n)}…` : text);
// Ruta relativa a la base del proyecto o del worktree, para que el registro no
// dependa de la carpeta donde está el repo del usuario.
function relPath(base, p) {
  if (typeof p !== 'string' || !p) return null;
  return path.isAbsolute(p) ? path.relative(base, p) : p;
}
const { ensureGitGuardHooks } = require('./bridge/gitGuard');
const { listFilesModifiedSince, resolveInside, readPreview, openWithSystem } = require('./bridge/taskFiles');
const { STAGE_PHASE, firstStage, stageTools, stageDisallowed, approvalRule, canRun, buildStagePrompt, answerPrompt, decideAfterStage } = require('./bridge/taskStages');
const { loadMemory, saveMemory } = require('./store/memoryStore');
const { listSkills, createSkill } = require('./bridge/skills');
const { getClaudeAuthStatus, openAuthLoginInTerminal } = require('./bridge/claudeAuth');
const { listLocalModels } = require('./bridge/localAi');
const { getAiAssistSuggestion } = require('./bridge/aiAssist');

const WEB_DIR = path.join(__dirname, '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  execFile(cmd, [url], () => {}); // best-effort; a failed auto-open is not fatal, the URL is printed either way
}

// Written once per server start, after the real (possibly ephemeral) port is
// known. --mcp-config needs this on disk before any ClaudeSession spawns, so
// chat/task sessions can reach create_task/update_task_progress back over
// plain HTTP (the MCP server runs as a child of `claude`, not of this
// process — see server/mcp/tasksServer.js).
function writeMcpConfig(projectRoot, port) {
  const dir = path.join(projectRoot, '.optimia');
  fs.mkdirSync(dir, { recursive: true });
  const config = {
    mcpServers: {
      'optimia-tasks': {
        command: 'node',
        args: [path.join(__dirname, 'mcp', 'tasksServer.js')],
        env: { OPTIMIA_PORT: String(port) }
      }
    }
  };
  fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify(config, null, 2) + '\n');
}

function serveStatic(req, res) {
  const reqPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(WEB_DIR, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function createApp(projectRoot, { onTaskCreated, onTaskUpdated, onTaskDeleted, onTaskRun, onTaskApprove, onChatDeleted } = {}) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/health' && req.method === 'GET') {
      const claudeCheck = checkClaudeCapabilities();
      return sendJson(res, 200, { ok: true, projectRoot, claude: claudeCheck });
    }

    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return sendJson(res, 200, loadSettings(projectRoot));
    }

    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      const body = await readJsonBody(req).catch(() => null);
      if (!body) return sendJson(res, 400, { error: 'invalid JSON body' });
      saveSettings(projectRoot, body);
      const saved = loadSettings(projectRoot);
      // .claude/settings.json is the actual enforcement layer — keep it in
      // lockstep with preferences.noGo on every save, never only in the UI.
      syncClaudeSettings(projectRoot, saved.preferences.noGo);
      return sendJson(res, 200, saved);
    }

    if (url.pathname === '/api/settings/migration-preview' && req.method === 'GET') {
      return sendJson(res, 200, buildMigrationPreview(projectRoot));
    }

    if (url.pathname === '/api/settings/migrate' && req.method === 'POST') {
      return sendJson(res, 200, applyMigration(projectRoot));
    }

    if (url.pathname === '/api/claude-auth' && req.method === 'GET') {
      return sendJson(res, 200, getClaudeAuthStatus());
    }

    if (url.pathname === '/api/claude-auth/login' && req.method === 'POST') {
      return sendJson(res, 200, await openAuthLoginInTerminal());
    }

    if (url.pathname === '/api/local-models' && req.method === 'GET') {
      return sendJson(res, 200, listLocalModels());
    }

    if (url.pathname === '/api/ai-assist' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.field || !body.prompt) return sendJson(res, 400, { error: 'field and prompt required' });
      const result = getAiAssistSuggestion(body, { projectRoot });
      if (result.error) return sendJson(res, 502, result);
      return sendJson(res, 200, result);
    }

    if (url.pathname === '/api/memory' && req.method === 'GET') {
      return sendJson(res, 200, { content: loadMemory(projectRoot) });
    }

    if (url.pathname === '/api/memory' && req.method === 'PUT') {
      const body = await readJsonBody(req).catch(() => null);
      if (!body || typeof body.content !== 'string') return sendJson(res, 400, { error: 'content (string) is required' });
      saveMemory(projectRoot, body.content);
      return sendJson(res, 200, { content: body.content });
    }

    if (url.pathname === '/api/skills' && req.method === 'GET') {
      return sendJson(res, 200, listSkills(projectRoot));
    }

    if (url.pathname === '/api/skills' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.slug) return sendJson(res, 400, { error: 'slug is required' });
      try {
        const skill = createSkill(projectRoot, body.slug, body.description);
        return sendJson(res, 201, skill);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      return sendJson(res, 200, loadTasks(projectRoot));
    }

    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.title) return sendJson(res, 400, { error: 'title is required' });
      const git = listLocalBranches(projectRoot);
      if (body.baseBranch && !git.branches.includes(body.baseBranch)) {
        return sendJson(res, 400, { error: `la rama base "${body.baseBranch}" no existe` });
      }
      if (body.branchName) {
        const problem = branchNameProblem(body.branchName);
        if (problem) return sendJson(res, 400, { error: problem });
        if (git.branches.includes(body.branchName)) return sendJson(res, 409, { error: `ya existe la rama ${body.branchName}` });
      }
      const task = addTask(projectRoot, body);
      onTaskCreated?.(task);
      return sendJson(res, 201, task);
    }

    // POST /api/tasks/:id/run { stage, answer?, docOptions? } lanza una etapa
    // (revision final, preparar commit, responder una pregunta, redactar...).
    if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/run') && req.method === 'POST') {
      const taskId = url.pathname.split('/')[3];
      const body = await readJsonBody(req).catch(() => null);
      if (!body || typeof body.stage !== 'string') return sendJson(res, 400, { error: 'stage is required' });
      const result = onTaskRun ? onTaskRun(taskId, body) : { error: 'not supported', code: 501 };
      if (result.error) return sendJson(res, result.code || 409, { error: result.error });
      return sendJson(res, 202, result.task);
    }

    if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/approve') && req.method === 'POST') {
      const taskId = url.pathname.split('/')[3];
      const body = await readJsonBody(req).catch(() => null);
      if (!body) return sendJson(res, 400, { error: 'invalid JSON body' });
      const result = onTaskApprove ? onTaskApprove(taskId, body) : { error: 'not supported', code: 501 };
      if (result.error) return sendJson(res, result.code || 409, { error: result.error });
      return sendJson(res, 202, result.task);
    }

    if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/phase') && req.method === 'PATCH') {
      const taskId = url.pathname.split('/')[3];
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.phase || !body.status) return sendJson(res, 400, { error: 'phase and status are required' });
      const updated = updateTaskPhase(projectRoot, taskId, body.phase, body.status);
      if (!updated) return sendJson(res, 404, { error: 'task or phase not found' });
      onTaskUpdated?.(updated);
      return sendJson(res, 200, updated);
    }

    if (url.pathname.startsWith('/api/tasks/') && req.method === 'PATCH') {
      const taskId = url.pathname.split('/')[3];
      const body = await readJsonBody(req).catch(() => null);
      if (!body) return sendJson(res, 400, { error: 'invalid JSON body' });
      const updated = updateTask(projectRoot, taskId, body);
      if (!updated) return sendJson(res, 404, { error: 'task not found' });
      return sendJson(res, 200, updated);
    }

    if (url.pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
      const taskId = url.pathname.split('/')[3];
      const task = loadTasks(projectRoot).find((t) => t.id === taskId);
      if (!task) return sendJson(res, 404, { error: 'task not found' });
      onTaskDeleted?.(taskId); // kills any live session before its worktree goes away
      try {
        removeTaskWorktree(projectRoot, task);
      } catch (err) {
        logger.error('task.delete_failed', { taskId, error: err.message });
        return sendJson(res, 500, { error: `no se pudo limpiar el worktree: ${err.message}` });
      }
      deleteTask(projectRoot, taskId);
      logger.info('task.delete', { taskId, branch: task.branch });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/files/preview') && req.method === 'GET') {
      const taskId = url.pathname.split('/')[3];
      const task = loadTasks(projectRoot).find((t) => t.id === taskId);
      if (!task?.worktreePath) return sendJson(res, 404, { error: 'la tarea no tiene worktree' });
      const abs = resolveInside(task.worktreePath, url.searchParams.get('path'));
      if (!abs) return sendJson(res, 404, { error: 'fichero no encontrado en el worktree de la tarea' });
      try {
        return sendJson(res, 200, readPreview(abs));
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/files/open') && req.method === 'POST') {
      const taskId = url.pathname.split('/')[3];
      const body = await readJsonBody(req).catch(() => null);
      const task = loadTasks(projectRoot).find((t) => t.id === taskId);
      if (!task?.worktreePath) return sendJson(res, 404, { error: 'la tarea no tiene worktree' });
      const abs = resolveInside(task.worktreePath, body?.path);
      if (!abs) return sendJson(res, 404, { error: 'fichero no encontrado en el worktree de la tarea' });
      try {
        await openWithSystem(abs, { reveal: body?.reveal === true });
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 501, { error: err.message });
      }
    }

    if (url.pathname === '/api/git/branches' && req.method === 'GET') {
      return sendJson(res, 200, listLocalBranches(projectRoot));
    }

    // Commit y fusion son acciones del usuario (desde su tarjeta), nunca de un agente.
    if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/commit') && req.method === 'POST') {
      const taskId = url.pathname.split('/')[3];
      const body = await readJsonBody(req).catch(() => null);
      const task = loadTasks(projectRoot).find((t) => t.id === taskId);
      if (!task) return sendJson(res, 404, { error: 'task not found' });
      if (task.status !== 'ready_to_test' || !task.worktreePath) return sendJson(res, 409, { error: 'la tarea no esta lista para revisar' });
      const message = typeof body?.message === 'string' ? body.message.trim() : '';
      if (!message) return sendJson(res, 400, { error: 'el mensaje de commit no puede estar vacio' });
      let sha;
      try {
        sha = commitTaskWorktree(task.worktreePath, message, task.outputFiles || []);
      } catch (err) {
        logger.warn('task.commit_failed', { taskId, error: err.message });
        return sendJson(res, 409, { error: `no se pudo hacer commit: ${err.message}` });
      }
      logger.info('task.commit', { taskId, sha, files: filesChangedBy(task.worktreePath, sha) });
      return sendJson(res, 200, updateTask(projectRoot, taskId, { lastCommit: sha, lastCommitMessage: message }));
    }

    if (url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/merge') && req.method === 'POST') {
      const taskId = url.pathname.split('/')[3];
      const task = loadTasks(projectRoot).find((t) => t.id === taskId);
      if (!task) return sendJson(res, 404, { error: 'task not found' });
      if (!task.lastCommit) return sendJson(res, 409, { error: 'haz commit de la tarea antes de fusionarla' });
      if (!task.baseBranch || !task.branch) return sendJson(res, 409, { error: 'la tarea no tiene rama base' });
      if (!worktreeIsClean(task.worktreePath)) return sendJson(res, 409, { error: 'quedan cambios sin commitear en la tarea' });
      let sha;
      try {
        sha = mergeTaskBranch(projectRoot, task.branch, task.baseBranch, `Merge ${task.branch} en ${task.baseBranch}`);
      } catch (err) {
        logger.warn('task.merge_failed', { taskId, error: err.message });
        return sendJson(res, 409, { error: err.message });
      }
      logger.info('task.merge', { taskId, into: task.baseBranch, sha, files: filesChangedBy(projectRoot, sha) });
      return sendJson(res, 200, updateTask(projectRoot, taskId, { mergedInto: task.baseBranch, mergeCommit: sha, mergedAt: new Date().toISOString() }));
    }

    if (url.pathname === '/api/logs' && req.method === 'GET') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
      return sendJson(res, 200, logger.readRecent(limit));
    }

    if (url.pathname === '/api/pick-file' && req.method === 'POST') {
      let chosen;
      try {
        chosen = await pickFile({ prompt: 'Elige un documento del proyecto' });
      } catch (err) {
        return sendJson(res, 501, { error: err.message });
      }
      if (!chosen) return sendJson(res, 200, { path: null });
      const rel = path.relative(projectRoot, chosen);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return sendJson(res, 400, { error: 'el fichero tiene que estar dentro del proyecto' });
      }
      return sendJson(res, 200, { path: rel.split(path.sep).join('/') });
    }

    if (url.pathname === '/api/chats' && req.method === 'GET') {
      return sendJson(res, 200, listChats(projectRoot));
    }

    if (url.pathname === '/api/chats' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      return sendJson(res, 201, createChat(projectRoot, body?.title));
    }

    if (url.pathname.startsWith('/api/chats/') && req.method === 'GET') {
      const chatId = url.pathname.split('/')[3];
      const chat = loadChat(projectRoot, chatId);
      if (!chat) return sendJson(res, 404, { error: 'chat not found' });
      return sendJson(res, 200, chat);
    }

    if (url.pathname.startsWith('/api/chats/') && req.method === 'PATCH') {
      const chatId = url.pathname.split('/')[3];
      const body = await readJsonBody(req).catch(() => null);
      if (!body) return sendJson(res, 400, { error: 'invalid JSON body' });
      const updated = updateChatMeta(projectRoot, chatId, body);
      if (!updated) return sendJson(res, 404, { error: 'chat not found' });
      return sendJson(res, 200, updated);
    }

    if (url.pathname.startsWith('/api/chats/') && req.method === 'DELETE') {
      const chatId = url.pathname.split('/')[3];
      onChatDeleted?.(chatId);
      const removed = deleteChat(projectRoot, chatId);
      if (!removed) return sendJson(res, 404, { error: 'chat not found' });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'not found' });
    }

    return serveStatic(req, res);
  };
}

function start({ projectRoot = process.cwd(), port = 0, open = true } = {}) {
  logger.initLogger(projectRoot);
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Both task and chat sessions are project-wide (one ClaudeSession per
  // task/chat, independent of which browser tab is open or whether any tab
  // is open at all) — closing or refreshing a WebSocket no longer kills the
  // underlying `claude` process; only the transcript viewer disconnects.
  const taskSessions = new Map(); // taskId -> ClaudeSession
  const chatSessions = new Map(); // chatId -> ClaudeSession
  let terminalSession = null; // one project-wide PtySession, independent of chat/task sessions
  let terminalOwner = null; // { scope, id } when the terminal is running because a chat/task was handed off to it

  function broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  // Called from both the task and chat event handlers below. The moment a
  // tool is denied, the headless session is no use for the rest of this turn
  // (--permission-prompts none means every further approval-requiring call
  // will deny too, see claude's own message to the user), so hand off right
  // away instead of waiting for the turn to finish — killing it here (not
  // after `result`) is what makes the handoff immediate, and since the old
  // process is dead before the terminal's is spawned, the same
  // "no dual-driving one session" rule from before still holds.
  function watchForPermissionHandoff(scope, id, session, sessionsMap, event) {
    if (event.type !== 'system' || event.subtype !== 'permission_denied') return;
    broadcast({ type: 'permission_needed', scope, id, toolName: event.tool_name, message: event.message });
    // Flagged so the session's own 'exit' handler (below) knows this kill is
    // an intentional handoff, not a real/unexpected end — without this, the
    // generic claude_exit broadcast races with terminal_handoff and the chat
    // shows a confusing "session ended" message right on top of the handoff.
    session._handoffInProgress = true;
    logger.warn('handoff.terminal', { scope, id, tool: event.tool_name });
    session.kill();
    sessionsMap.delete(id);
    startOrGetTerminalSession(session.sessionId, { scope, id });
    broadcast({ type: 'terminal_handoff', scope, id, toolName: event.tool_name });
  }

  // Lanza una etapa del pipeline de la tarea (ver bridge/taskStages.js) en su
  // worktree. Una sesion de Claude por etapa; al terminar, la etapa decide el
  // siguiente estado y, si toca, lanza la siguiente etapa automaticamente.
  // Devuelve { task } o { error, code } para que la ruta HTTP responda.
  function runTaskStage(taskId, { stage, answer, docOptions } = {}) {
    const task = loadTasks(projectRoot).find((t) => t.id === taskId);
    if (!task) return { error: 'task not found', code: 404 };
    if (taskSessions.has(taskId)) return { error: 'la tarea ya tiene un agente en marcha', code: 409 };

    const effectiveDocOptions = stage === 'write' ? (docOptions || task.docOptions) : undefined;
    const problem = canRun(task, stage, { answer, docOptions: effectiveDocOptions });
    if (problem) return { error: problem, code: 409 };

    let worktreeDir = task.worktreePath;
    let branch = task.branch;
    if (!worktreeDir) {
      try {
        const worktree = createTaskWorktree(projectRoot, task.id, { baseRef: task.baseBranch, branchName: task.branchName });
        worktreeDir = worktree.dir;
        branch = worktree.branch;
      } catch (err) {
        logger.error('task.worktree_error', { taskId: task.id, error: err.message });
        updateTask(projectRoot, task.id, { status: 'pending', error: `no se pudo crear el worktree: ${err.message}` });
        return { error: `no se pudo crear el worktree: ${err.message}`, code: 500 };
      }
    }

    let opts;
    const settings = loadSettings(projectRoot);
    try {
      opts = buildSessionOptions(settings, worktreeDir, projectRoot, task.id);
    } catch (err) {
      return { error: err.message, code: 500 };
    }

    // Responder a una pregunta de implementacion reanuda la misma conversacion
    // (la sesion de la etapa anterior) para que el agente conserve el contexto.
    const resuming = answer !== undefined && Boolean(task.sessionId);
    if (resuming) opts.resumeSessionId = task.sessionId;
    let prompt = buildStagePrompt(task, stage, { docOptions: effectiveDocOptions });
    if (answer !== undefined) prompt = resuming ? answerPrompt(answer, stage) : `${prompt}\n\nRespuesta del usuario a tus preguntas:\n${answer.trim()}`;

    const approved = Array.isArray(settings.preferences.approvedTools) ? settings.preferences.approvedTools : [];
    opts.extraAllowedTools = [...stageTools(stage), ...approved];
    opts.disallowedTools = stageDisallowed();
    opts.gitHooksPath = ensureGitGuardHooks(projectRoot);
    const session = new ClaudeSession(opts);
    taskSessions.set(taskId, session);
    updateTaskPhase(projectRoot, taskId, STAGE_PHASE[stage], 'active');
    logger.info('task.stage.start', { taskId, stage, branch, resumed: resuming });
    if (answer !== undefined) logger.info('task.answer', { taskId, stage, text: cut(answer) });
    const started = updateTask(projectRoot, taskId, {
      stage,
      status: 'in_progress',
      error: null,
      pendingQuestion: null,
      pendingPermission: null,
      branch,
      worktreePath: worktreeDir,
      sessionId: session.sessionId,
      docOptions: effectiveDocOptions || task.docOptions
    });
    broadcast({ type: 'task_updated', task: started });

    // El evento de denegacion solo trae el nombre de la herramienta; el comando
    // concreto viene en el bloque tool_use previo con el mismo id.
    const toolUses = new Map();
    session.on('event', (event) => {
      broadcast({ type: 'task_claude_event', taskId, event });
      if (event.type === 'assistant') {
        for (const block of event.message?.content || []) {
          if (block.type === 'tool_use') toolUses.set(block.id, { name: block.name, input: block.input });
          if (block.type === 'tool_use' && FILE_TOOLS.has(block.name)) {
            logger.info('file.edit', { scope: 'task', taskId, stage, tool: block.name, path: relPath(worktreeDir, block.input?.file_path) });
          }
        }
      }
      if (event.type === 'result') finishTaskStage(taskId, stage, worktreeDir, session, event);
      // Una tarea no es interactiva: si la etapa necesita un permiso que no tiene,
      // se detiene y la tarjeta ofrece aprobarlo y reintentar. No se abre la terminal.
      if (event.type === 'system' && event.subtype === 'permission_denied' && !session._stageDone) {
        session._stageDone = true;
        session.kill();
        if (taskSessions.get(taskId) === session) taskSessions.delete(taskId);
        const tool = event.tool_name || 'una herramienta';
        const use = toolUses.get(event.tool_use_id);
        const command = use?.name === 'Bash' ? use.input?.command : undefined;
        // Bash va libre en las etapas: lo que aun asi se deniega es politica
        // (comandos destructivos, commits) o el aviso de /dev/null, y no se
        // aprueba desde la tarjeta. Solo las demas herramientas se pueden aprobar.
        const rule = tool === 'Bash' ? null : approvalRule(tool);
        const approvedNow = loadSettings(projectRoot).preferences.approvedTools || [];
        const alreadyApproved = rule !== null && approvedNow.includes(rule);
        logger.warn('task.stage.denied', { taskId, stage, tool, alreadyApproved });
        const current = updateTask(projectRoot, taskId, {
          status: 'pending',
          error: tool === 'Bash'
            ? `la etapa "${stage}" se bloqueo en Bash${command ? `: ${command}` : ''}. Es una accion prohibida para agentes o un aviso de Claude Code; no se puede aprobar desde la tarjeta.`
            : alreadyApproved
              ? `la etapa "${stage}" fue bloqueada por ${tool} aunque ya estaba permitido. No se puede resolver desde la tarjeta.`
              : `la etapa "${stage}" necesita permiso para ${tool}.`,
          pendingPermission: rule && !alreadyApproved ? { tool } : null
        });
        if (current) broadcast({ type: 'task_updated', task: current });
      }
    });
    session.on('error', (err) => {
      logger.error('task.session_error', { taskId, stage, error: err.message });
      broadcast({ type: 'task_error', taskId, error: err.message });
    });
    session.on('exit', () => {
      if (taskSessions.get(taskId) === session) taskSessions.delete(taskId);
      if (session._stageDone) return;
      // Salida sin `result` (fallo, kill o handoff a la terminal): la tarea no
      // puede quedarse en in_progress para siempre.
      const current = updateTask(projectRoot, taskId, { status: 'pending', error: `la etapa "${stage}" termino sin completarse` });
      if (current) broadcast({ type: 'task_updated', task: current });
    });

    session._startedAt = Date.now();
    logger.info('claude.session.spawn', { scope: 'task', taskId, stage, sessionId: session.sessionId });
    session.send(prompt);
    return { task: started };
  }

  function approveAndRetryTask(taskId, { tool, command } = {}) {
    const task = loadTasks(projectRoot).find((t) => t.id === taskId);
    if (!task) return { error: 'task not found', code: 404 };
    if (!task.stage || !task.pendingPermission) return { error: 'la tarea no esta esperando ningun permiso', code: 409 };
    const rule = approvalRule(tool, command);
    if (!rule) return { error: 'esta herramienta no se puede aprobar desde la tarjeta', code: 400 };
    if (tool !== task.pendingPermission.tool || (tool === 'Bash' && command !== task.pendingPermission.command)) {
      return { error: 'el permiso pendiente ya no coincide con la peticion', code: 409 };
    }
    const settings = loadSettings(projectRoot);
    const approved = Array.isArray(settings.preferences.approvedTools) ? settings.preferences.approvedTools : [];
    if (!approved.includes(rule)) {
      settings.preferences.approvedTools = [...approved, rule];
      saveSettings(projectRoot, settings);
    }
    logger.info('task.approve', { taskId, rule });
    return runTaskStage(taskId, { stage: task.stage });
  }

  function finishTaskStage(taskId, stage, worktreeDir, session, event) {
    session._stageDone = true;
    if (taskSessions.get(taskId) === session) taskSessions.delete(taskId);
    const text = typeof event.result === 'string' ? event.result : '';

    let hasChanges = false;
    try {
      hasChanges = stageForReview(worktreeDir).hasChanges;
    } catch (err) {
      broadcast({ type: 'task_error', taskId, error: `no se pudo preparar el stage: ${err.message}` });
    }

    const current = loadTasks(projectRoot).find((t) => t.id === taskId);
    session.close();
    if (!current) return; // la tarea se borro mientras corria

    const phaseStatus = (current.phases || []).find((p) => p.key === STAGE_PHASE[stage])?.status;
    const { patch, next } = decideAfterStage(current, stage, {
      text,
      hasChanges,
      phaseStatus,
      isError: event.is_error === true
    });
    const touched = changedFiles(worktreeDir);
    logger.info('file.stage_changes', { taskId, stage, files: touched.slice(0, 200), total: touched.length });
    const outputFiles = listFilesModifiedSince(worktreeDir, session._startedAt || 0);
    const knownFiles = new Set(current.outputFiles || []);
    for (const f of outputFiles) knownFiles.add(f);
    if (patch.pendingQuestion) logger.info('task.question', { taskId, stage, kind: patch.pendingQuestion.kind, text: cut(patch.pendingQuestion.text) });
    const updated = updateTask(projectRoot, taskId, { ...patch, outputFiles: [...knownFiles].sort() });
    logger.info('task.stage.finish', { taskId, stage, status: updated?.status, hasChanges, outputFiles: knownFiles.size, error: patch.error || null });
    broadcast({ type: 'task_updated', task: updated });

    if (next) {
      const result = runTaskStage(taskId, { stage: next });
      if (result.error) broadcast({ type: 'task_error', taskId, error: result.error });
    }
  }

  function startTaskSession(task) {
    const result = runTaskStage(task.id, { stage: firstStage(task.type) });
    if (result.error) broadcast({ type: 'task_error', taskId: task.id, error: result.error });
  }

  // A chat's ClaudeSession lives here, keyed by chatId, independent of any
  // single WebSocket connection (same pattern as taskSessions above) — this
  // is what makes "refresh the tab" stop killing the conversation: the
  // browser is just a viewer that replays the persisted transcript and,
  // if it's still running, re-attaches to the same live process.
  function startOrGetChatSession(chatId) {
    const existing = chatSessions.get(chatId);
    if (existing) return existing;

    const chat = loadChat(projectRoot, chatId);
    if (!chat) return null;

    const settings = loadSettings(projectRoot);
    const opts = buildSessionOptions(settings, projectRoot);
    opts.resumeSessionId = chat.claudeSessionId || undefined;

    const session = new ClaudeSession(opts);
    chatSessions.set(chatId, session);
    logger.info('claude.session.spawn', { scope: 'chat', chatId, sessionId: session.sessionId, resumed: Boolean(chat.claudeSessionId) });
    if (!chat.claudeSessionId) {
      updateChatMeta(projectRoot, chatId, { claudeSessionId: session.sessionId });
    }

    session.on('event', (event) => {
      for (const block of event.message?.content || []) {
        if (event.type === 'assistant' && block.type === 'text' && block.text?.trim()) {
          logger.info('chat.reply', { chatId, text: cut(block.text) });
        }
        if (event.type === 'assistant' && block.type === 'tool_use' && FILE_TOOLS.has(block.name)) {
          logger.info('file.edit', { scope: 'chat', chatId, tool: block.name, path: relPath(projectRoot, block.input?.file_path) });
        }
      }
      appendMessage(projectRoot, chatId, { role: 'claude_event', event, ts: new Date().toISOString() });
      broadcast({ type: 'claude_event', chatId, event });
      watchForPermissionHandoff('chat', chatId, session, chatSessions, event);
    });
    session.on('error', (err) => broadcast({ type: 'bridge_error', chatId, error: err.message }));
    session.on('stderr', (text) => broadcast({ type: 'claude_stderr', chatId, text }));
    session.on('exit', (info) => {
      if (chatSessions.get(chatId) === session) chatSessions.delete(chatId);
      logger.info('claude.session.exit', { scope: 'chat', chatId, code: info?.code ?? null, signal: info?.signal ?? null, stopped: Boolean(session._stopRequested) });
      // A handoff-triggered kill is not a real end of the conversation (see
      // watchForPermissionHandoff) — terminal_handoff already told the chat
      // what's happening, so skip the generic "session ended" broadcast. The
      // same goes for a stop the user asked for (stopChatSession).
      if (!session._handoffInProgress && !session._stopRequested) broadcast({ type: 'claude_exit', chatId, info });
    });

    return session;
  }

  // Para la consulta en curso sin borrar la conversacion: el siguiente mensaje
  // reanuda la misma sesion (--resume) con el historial ya guardado.
  function stopChatSession(chatId) {
    const session = chatSessions.get(chatId);
    if (!session) return false;
    session._stopRequested = true;
    logger.info('chat.stop', { chatId });
    session.kill();
    chatSessions.delete(chatId);
    return true;
  }

  function killChatSession(chatId) {
    const session = chatSessions.get(chatId);
    if (session) {
      session.kill();
      chatSessions.delete(chatId);
    }
  }

  function killTaskSession(taskId) {
    const session = taskSessions.get(taskId);
    if (session) {
      session.kill();
      taskSessions.delete(taskId);
    }
    broadcast({ type: 'task_deleted', taskId });
  }

  // A real interactive `claude` process in a PTY — separate from chat/task
  // sessions, which stay headless. Lives here, server-side, independent of
  // any WebSocket connection: closing the terminal view doesn't kill it.
  function startOrGetTerminalSession(resumeSessionId, owner) {
    // Already running: never steal it, whatever it's doing — the caller
    // (watchForPermissionHandoff) only notifies in that case, it doesn't call this.
    if (terminalSession) return terminalSession;

    const mcpConfigPath = path.join(projectRoot, '.optimia', 'mcp.json');
    const session = new PtySession({ cwd: projectRoot, mcpConfigPath, resumeSessionId });
    terminalSession = session;
    terminalOwner = owner || null;

    session.on('data', (data) => broadcast({ type: 'terminal_data', data }));
    session.on('exit', (info) => {
      broadcast({ type: 'terminal_exit', info });
      const handedOffChat = terminalOwner && terminalOwner.scope === 'chat' ? terminalOwner.id : null;
      terminalSession = null;
      terminalOwner = null;
      // The terminal resolved whatever needed a human there — bring the
      // chat's headless session back right away (same --resume sessionId,
      // full history intact) instead of leaving it dead until the user
      // happens to type a new message. The terminal process has already
      // exited by this point, so there's no dual-driving risk.
      if (handedOffChat) {
        try {
          startOrGetChatSession(handedOffChat);
          broadcast({ type: 'chat_resumed', chatId: handedOffChat });
        } catch (err) {
          broadcast({ type: 'bridge_error', chatId: handedOffChat, error: err.message });
        }
      }
    });

    return session;
  }

  // Un agente que seguia corriendo al cerrar optimia ya no existe: sus tareas
  // quedan pendientes (reintentables) en vez de en in_progress para siempre.
  for (const task of loadTasks(projectRoot)) {
    if (task.status === 'in_progress') {
      updateTask(projectRoot, task.id, { status: 'pending', error: 'interrumpida al reiniciar optimia' });
    }
  }

  const app = createApp(projectRoot, {
    onTaskCreated: startTaskSession,
    onTaskRun: runTaskStage,
    onTaskApprove: approveAndRetryTask,
    onTaskUpdated: (task) => broadcast({ type: 'task_updated', task }),
    onTaskDeleted: killTaskSession,
    onChatDeleted: killChatSession
  });
  server.on('request', (req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) {
        logger.info('http.request', { method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - started });
      }
    });
    app(req, res);
  });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        return ws.send(JSON.stringify({ type: 'client_error', error: 'invalid JSON' }));
      }

      // Chat sessions are server-side and chatId-tagged on every broadcast;
      // a tab doesn't need to register interest before sending a message.
      if (msg.type === 'subscribe') return;

      if (msg.type === 'terminal_subscribe') {
        const session = startOrGetTerminalSession();
        ws.send(JSON.stringify({ type: 'terminal_scrollback', data: session.scrollback }));
        return;
      }

      if (msg.type === 'terminal_input') {
        if (terminalSession && typeof msg.data === 'string') terminalSession.write(msg.data);
        return;
      }

      if (msg.type === 'terminal_resize') {
        if (terminalSession && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
          terminalSession.resize(msg.cols, msg.rows);
        }
        return;
      }

      if (msg.type === 'stop_chat') {
        if (msg.chatId) {
          stopChatSession(msg.chatId);
          broadcast({ type: 'chat_stopped', chatId: msg.chatId });
        }
        return;
      }

      if (msg.type === 'user_message') {
        if (!msg.chatId) return ws.send(JSON.stringify({ type: 'client_error', error: 'chatId required' }));

        // Never start a second process on a --session-id the terminal already
        // owns (see watchForPermissionHandoff) — same chat, same conversation.
        if (terminalOwner && terminalOwner.scope === 'chat' && terminalOwner.id === msg.chatId) {
          return ws.send(JSON.stringify({ type: 'client_error', error: 'Esta conversacion esta abierta en la terminal ahora mismo. Cierra esa sesion de terminal para volver a usar el chat.' }));
        }

        let session;
        try {
          session = startOrGetChatSession(msg.chatId);
        } catch (err) {
          return ws.send(JSON.stringify({ type: 'bridge_error', chatId: msg.chatId, error: err.message }));
        }
        if (!session) return ws.send(JSON.stringify({ type: 'client_error', error: 'chat not found' }));

        appendMessage(projectRoot, msg.chatId, { role: 'user', text: msg.text, images: msg.images || [], ts: new Date().toISOString() });
        logger.info('chat.user', { chatId: msg.chatId, text: cut(msg.text), images: (msg.images || []).length });
        // El primer mensaje da nombre al chat; despues el nombre se queda fijo.
        const chatNow = loadChat(projectRoot, msg.chatId);
        const firstLine = (msg.text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
        if (chatNow?.title === 'Nuevo chat' && firstLine) {
          const title = firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
          updateChatMeta(projectRoot, msg.chatId, { title });
          broadcast({ type: 'chat_renamed', chatId: msg.chatId, title });
        }
        try {
          session.send(msg.text, msg.images || []);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'bridge_error', chatId: msg.chatId, error: err.message }));
        }
        return;
      }

      ws.send(JSON.stringify({ type: 'client_error', error: `unknown message type: ${msg.type}` }));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      const url = `http://127.0.0.1:${actualPort}`;
      writeMcpConfig(projectRoot, actualPort);
      console.log(`optimia running at ${url} (project: ${projectRoot})`);
      logger.info('server.start', { url, port: actualPort, projectRoot });
      if (open) openInBrowser(url);
      resolve({ server, wss, url, port: actualPort });
    });
  });
}

module.exports = { start, createApp };

if (require.main === module) {
  const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  start({ projectRoot });
}
