'use strict';

const chatLog = document.getElementById('chat-log');
const input = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const effortSelect = document.getElementById('model-select');
const chatModelSelect = document.getElementById('chat-model-select');
const thinkingOrb = document.getElementById('thinking-orb');

// Same list the Settings "Claude Code" pane offers (web/index.html's
// setting-claude-model) — a verified set of recognized model names, not a
// guess. Local mode instead lists whatever Ollama actually has pulled (see
// GET /api/local-models), since there's no fixed list to hardcode there.
const CLAUDE_MODEL_OPTIONS = [
  ['default', 'Default'],
  ['fable', 'fable'],
  ['opus', 'opus'],
  ['sonnet', 'sonnet']
];

async function populateChatModelSelect(settings) {
  chatModelSelect.innerHTML = '';
  if (settings.ai.mode === 'local') {
    const models = await fetch('/api/local-models').then((r) => r.json()).catch(() => []);
    if (models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Sin modelos locales (ollama pull ...)';
      chatModelSelect.appendChild(opt);
      chatModelSelect.disabled = true;
      return;
    }
    chatModelSelect.disabled = false;
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = `${m.name} (${m.size})`;
      chatModelSelect.appendChild(opt);
    }
    chatModelSelect.value = settings.ai.localAi.model || models[0].name;
  } else {
    chatModelSelect.disabled = false;
    for (const [value, label] of CLAUDE_MODEL_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      chatModelSelect.appendChild(opt);
    }
    chatModelSelect.value = settings.ai.claude.model || 'default';
  }
}

chatModelSelect.addEventListener('change', async () => {
  const settings = await fetch('/api/settings').then((r) => r.json());
  if (settings.ai.mode === 'local') settings.ai.localAi.model = chatModelSelect.value;
  else settings.ai.claude.model = chatModelSelect.value;
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  appendMessage('system', `Modelo actualizado a "${chatModelSelect.value}" para la proxima sesion.`);
});
const connectionStatus = document.getElementById('connection-status');
const modeLabel = document.getElementById('mode-label');
const projectLabel = document.getElementById('project-label');

// Un punto de color con el texto en tooltip: el estado de conexion no ocupa
// espacio en la barra superior, solo aparece como texto si el usuario lo busca.
function setConnectionState(connected, label) {
  connectionStatus.classList.toggle('offline', !connected);
  connectionStatus.title = label;
  connectionStatus.setAttribute('aria-label', label);
}
const clockEl = document.getElementById('clock');
const chatTabs = document.getElementById('chat-tabs');
const chatNewButton = document.getElementById('chat-new-button');

let ws = null;
let wsOpen = false;
let currentChatId = null;
const chatsMeta = new Map(); // chatId -> {id, title, updatedAt, ...} (no messages)
let waitingForResult = false;
let currentAssistantBubble = null;

// Pending image attachments for the next chat message: {mediaType, base64Data, dataUrl}.
// Sent as inline base64 content blocks (see server/bridge/claudeProcess.js
// ClaudeSession.send) — confirmed in the Fase 0 spike that `claude -p
// --input-format stream-json` accepts Messages-API-style image blocks
// directly, so no file-on-disk fallback is needed.
let pendingImages = [];
const chatInputArea = document.querySelector('.chat-input-area');
const attachmentsEl = document.getElementById('chat-attachments');
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const colInProgress = document.getElementById('col-in_progress');
const colReadyToTest = document.getElementById('col-ready_to_test');

// taskId -> { task, lastStep }. lastStep is a human-readable label derived
// from the most recent claude_event for that task's dedicated session
// (there is no separate plan/implement/test sub-agent pipeline — one
// worktree, one claude session per task, doing whatever it judges needed).
const tasks = new Map();

// task_id -> { chatId, description, lastStep, finished, status, summary,
// interrupted }. Subagents launched with Claude's own `Agent` tool from
// inside a chat turn (e.g. "crea un agente para buscar X") never go through
// /api/tasks — there's no worktree, no dedicated ClaudeSession, just a
// backgrounded task inside the same headless session. Their lifecycle is
// driven entirely by Claude Code's own `system/task_*` events (see the
// `event.type === 'system'` branch in handleClaudeEvent): task_started
// creates the entry, task_progress updates lastStep, task_updated/
// task_notification mark it finished and attach its final summary so it can
// move to "Ready to review" instead of just vanishing. Entries persist there
// until the user dismisses them with the card's ✕ (tracked in localStorage
// per chat so a reload doesn't resurrect a dismissed card via replay).
const chatAgents = new Map();

function dismissedAgentsKey(chatId) { return `optimia:dismissed-agents:${chatId}`; }
function loadDismissedAgents(chatId) {
  try { return new Set(JSON.parse(localStorage.getItem(dismissedAgentsKey(chatId)) || '[]')); }
  catch { return new Set(); }
}
function isAgentDismissed(chatId, taskId) { return loadDismissedAgents(chatId).has(taskId); }
function markAgentDismissed(chatId, taskId) {
  const ids = loadDismissedAgents(chatId);
  ids.add(taskId);
  try { localStorage.setItem(dismissedAgentsKey(chatId), JSON.stringify([...ids])); } catch { /* best-effort only */ }
}

function stepLabelFor(event) {
  if (event.type === 'assistant') {
    const block = (event.message?.content || []).find((b) => b.type === 'tool_use');
    if (block) return `usando ${block.name}`;
    return 'escribiendo respuesta...';
  }
  if (event.type === 'result') return event.is_error ? 'error' : 'turno completado';
  return null;
}

// Lo que hace cada agente de tarea, linea a linea, desde que la pestaña esta abierta.
const taskLogs = new Map();
const openTaskLogs = new Set();
const TASK_LOG_MAX = 200;

function describeTaskEvent(event) {
  if (event.type === 'assistant') {
    const lines = [];
    for (const block of event.message?.content || []) {
      if (block.type === 'text' && block.text?.trim()) lines.push(block.text.trim().slice(0, 300));
      if (block.type === 'tool_use') {
        const detail = block.input?.command || block.input?.description || block.input?.file_path || block.input?.pattern || '';
        lines.push(`→ ${block.name}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
      }
    }
    return lines;
  }
  if (event.type === 'result') return [event.is_error ? '— turno con error —' : '— turno completado —'];
  if (event.type === 'system' && event.subtype === 'permission_denied') return [`× bloqueado: ${event.tool_name || 'herramienta'}`];
  return [];
}

function logTaskEvent(taskId, event) {
  const lines = describeTaskEvent(event);
  if (!lines.length) return;
  const log = taskLogs.get(taskId) || [];
  log.push(...lines);
  if (log.length > TASK_LOG_MAX) log.splice(0, log.length - TASK_LOG_MAX);
  taskLogs.set(taskId, log);
}

const PHASE_LABELS = { plan: 'Plan', implement: 'Implementacion', test: 'Tests & review' };

function renderPhaseChips(task) {
  const wrap = document.createElement('div');
  wrap.className = 'task-phases';
  for (const phase of task.phases || []) {
    const chip = document.createElement('span');
    chip.className = `phase-chip phase-${phase.status}`;
    chip.textContent = PHASE_LABELS[phase.key] || phase.key;
    wrap.appendChild(chip);
  }
  return wrap;
}

function renderDeleteButton(onClick) {
  const btn = document.createElement('button');
  btn.className = 'card-delete-btn';
  btn.type = 'button';
  btn.textContent = '✕';
  btn.title = 'Eliminar';
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

async function deleteRealTask(taskId) {
  const entry = tasks.get(taskId);
  if (!entry) return;
  const branch = entry.task.branch ? `\nRama: ${entry.task.branch}` : '';
  const ok = confirm(`Se borran la tarea, su worktree y sus cambios sin commitear.${branch}\n\n¿Continuar?`);
  if (!ok) return;
  const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    appendMessage('system', `No se pudo eliminar la tarea: ${data.error || res.status}`);
    return;
  }
  tasks.delete(taskId);
  renderTasks();
}

function dismissChatAgent(taskId) {
  const agent = chatAgents.get(taskId);
  if (!agent) return;
  markAgentDismissed(agent.chatId, taskId);
  chatAgents.delete(taskId);
  renderTasks();
}

const STAGE_LABELS = {
  plan: 'Plan',
  research: 'Investigacion',
  implement: 'Implementacion',
  write: 'Redaccion',
  review: 'Revision final',
  commit: 'Preparar commit'
};

// Valores de los formularios de las tarjetas, por `${taskId}:${campo}`. El
// tablero se re-renderiza en cada evento del agente; sin esto se perderia lo
// que el usuario estaba escribiendo.
const cardDrafts = new Map();

function keepDraft(el, key, initial) {
  el.value = cardDrafts.has(key) ? cardDrafts.get(key) : (initial ?? '');
  const save = () => cardDrafts.set(key, el.value);
  el.addEventListener('input', save);
  el.addEventListener('change', save);
  return el;
}

function actionButton(label, { primary = false, disabled = false, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  if (primary) btn.className = 'primary';
  btn.disabled = disabled;
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

function renderPermissionRequest(taskId, perm) {
  const box = document.createElement('div');
  box.className = 'task-permission';
  const label = document.createElement('div');
  label.textContent = perm.command
    ? `El agente quiere ejecutar: ${perm.command}`
    : `El agente quiere usar ${perm.tool}.`;
  box.appendChild(label);
  const row = document.createElement('div');
  row.className = 'task-actions';
  row.appendChild(actionButton('Permitir y reintentar', { primary: true, onClick: () => approveTaskPermission(taskId, perm) }));
  box.appendChild(row);
  return box;
}

async function approveTaskPermission(taskId, perm) {
  const res = await fetch(`/api/tasks/${taskId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: perm.tool, command: perm.command })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    appendMessage('system', `No se pudo aprobar el permiso: ${data.error || res.status}`);
    return;
  }
  applyTaskFromServer(data);
  renderTasks();
}

async function runTaskStage(taskId, body) {
  const res = await fetch(`/api/tasks/${taskId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  const entry = tasks.get(taskId);
  if (!res.ok) {
    if (entry) {
      tasks.set(taskId, { ...entry, task: { ...entry.task, error: data.error || 'no se pudo lanzar la etapa' } });
      renderTasks();
    }
    return;
  }
  applyTaskFromServer(data);
  renderTasks();
}

// La respuesta HTTP de una accion y el task_updated por WebSocket pueden llegar
// en cualquier orden. La respuesta HTTP es un snapshot anterior al evento: no
// debe pisar una version mas nueva que ya estuviera en el tablero.
function applyTaskFromServer(task) {
  const entry = tasks.get(task.id);
  if (entry && entry.task.updatedAt >= task.updatedAt) return;
  tasks.set(task.id, { task, lastStep: entry ? entry.lastStep : null });
}

function taskStepText(task, lastStep) {
  const stage = STAGE_LABELS[task.stage] || 'Agente';
  switch (task.status) {
    case 'in_progress': return `${stage} · ${lastStep || 'iniciando...'}`;
    case 'awaiting_input':
      return task.pendingQuestion?.kind === 'doc-options'
        ? 'investigacion lista · elige modo, formato y destino'
        : `${stage} · necesita tu respuesta para continuar`;
    case 'ready_to_test': return `${stage} · lista para revisar (cambios en stage, sin commitear)`;
    default: return task.error || 'pendiente';
  }
}

// Preguntas que puede hacer una etapa, y la etapa que se reanuda al responder.
const QUESTION_STAGE = { 'plan-details': 'plan', 'research-details': 'research', 'implement-details': 'implement' };

function renderAnswerForm(taskId, stage) {
  const form = document.createElement('div');
  form.className = 'task-form';
  const key = `${taskId}:answer`;
  const area = keepDraft(document.createElement('textarea'), key);
  area.rows = 3;
  area.placeholder = 'Tu respuesta al agente';
  form.appendChild(area);
  form.appendChild(actionButton('Responder y continuar', {
    primary: true,
    onClick: () => {
      const answer = area.value.trim();
      if (!answer) return;
      cardDrafts.delete(key);
      runTaskStage(taskId, { stage, answer });
    }
  }));
  return form;
}

function renderPathPicker(input) {
  const row = document.createElement('div');
  row.className = 'path-picker';
  row.appendChild(input);
  row.appendChild(actionButton('Elegir…', {
    onClick: async () => {
      const res = await fetch('/api/pick-file', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        appendMessage('system', `No se pudo abrir el explorador: ${data.error || res.status}`);
        return;
      }
      if (!data.path) return;
      input.value = data.path;
      input.dispatchEvent(new Event('change'));
    }
  }));
  return row;
}

function renderDocOptions(taskId, task) {
  const form = document.createElement('div');
  form.className = 'task-form';
  const modeKey = `${taskId}:mode`;
  const modes = [
    ['new', 'Documento nuevo'],
    ['edit', 'Editar un documento existente'],
    ['fragments', 'Trozos para anadir a un documento existente']
  ];
  const selectedMode = cardDrafts.get(modeKey) || task.docOptions?.mode || 'new';
  for (const [value, label] of modes) {
    const row = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `mode-${taskId}`;
    radio.value = value;
    radio.checked = value === selectedMode;
    radio.addEventListener('change', () => cardDrafts.set(modeKey, value));
    row.appendChild(radio);
    row.appendChild(document.createTextNode(label));
    form.appendChild(row);
  }
  const target = keepDraft(document.createElement('input'), `${taskId}:target`, task.docOptions?.targetPath || '');
  target.type = 'text';
  target.placeholder = 'Ruta relativa del documento (obligatoria para editar o anadir trozos)';
  form.appendChild(renderPathPicker(target));

  const format = keepDraft(document.createElement('select'), `${taskId}:format`, task.docOptions?.format || 'md');
  for (const f of ['md', 'html', 'docx']) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    format.appendChild(opt);
  }
  format.value = cardDrafts.get(`${taskId}:format`) || task.docOptions?.format || 'md';
  form.appendChild(format);

  const template = keepDraft(document.createElement('input'), `${taskId}:template`, task.docOptions?.template || '');
  template.type = 'text';
  template.placeholder = 'Plantilla opcional (ruta relativa)';
  form.appendChild(renderPathPicker(template));

  form.appendChild(actionButton('Generar', {
    primary: true,
    onClick: () => {
      const mode = (form.querySelector(`input[name="mode-${taskId}"]:checked`) || {}).value || 'new';
      runTaskStage(taskId, {
        stage: 'write',
        docOptions: {
          mode,
          format: format.value,
          targetPath: target.value.trim(),
          template: template.value.trim()
        }
      });
    }
  }));
  return form;
}

function renderCommitAndMerge(taskId, task) {
  const box = document.createElement('div');
  box.className = 'task-workspace';
  if (!task.lastCommit) {
    const row = document.createElement('div');
    row.className = 'task-file';
    const msg = keepDraft(document.createElement('input'), `${taskId}:commit`, `feat: ${task.title}`.slice(0, 72));
    msg.type = 'text';
    msg.className = 'task-commit-msg';
    row.appendChild(msg);
    row.appendChild(actionButton('Commit', { primary: true, onClick: () => commitTask(taskId, msg.value) }));
    box.appendChild(row);
    return box;
  }
  const meta = document.createElement('div');
  meta.className = 'task-meta';
  meta.textContent = `Commit ${task.lastCommit.slice(0, 7)}: ${task.lastCommitMessage || ''}`;
  box.appendChild(meta);
  if (task.mergedInto) {
    const done = document.createElement('div');
    done.className = 'task-meta';
    done.textContent = `Fusionada en ${task.mergedInto}`;
    box.appendChild(done);
  } else {
    const row = document.createElement('div');
    row.className = 'task-actions';
    row.appendChild(actionButton(`Fusionar en ${task.baseBranch || 'la base'}`, { primary: true, onClick: () => mergeTask(taskId) }));
    box.appendChild(row);
  }
  return box;
}

async function commitTask(taskId, message) {
  const res = await fetch(`/api/tasks/${taskId}/commit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { appendMessage('system', `Commit no realizado: ${data.error || res.status}`); return; }
  applyTaskFromServer(data);
  renderTasks();
}

async function mergeTask(taskId) {
  const res = await fetch(`/api/tasks/${taskId}/merge`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { appendMessage('system', `Fusion no realizada: ${data.error || res.status}`); return; }
  applyTaskFromServer(data);
  renderTasks();
}

function renderReadyActions(taskId) {
  const row = document.createElement('div');
  row.className = 'task-actions';
  row.appendChild(actionButton('Revision final', { onClick: () => runTaskStage(taskId, { stage: 'review' }) }));
  row.appendChild(actionButton('Preparar git add y commit', { onClick: () => runTaskStage(taskId, { stage: 'commit' }) }));
  return row;
}

const ORB_LABELS = { planning: 'Planificando…', working: 'Trabajando…', thinking: 'Pensando…' };

function renderOrb(state) {
  const row = document.createElement('div');
  row.className = `agent-orb ${state}`;
  const orb = document.createElement('span');
  orb.className = 'orb';
  const label = document.createElement('span');
  label.textContent = ORB_LABELS[state];
  row.append(orb, label);
  return row;
}

function renderTaskWorkspace(taskId, task) {
  const box = document.createElement('div');
  box.className = 'task-workspace';
  if (task.branch) {
    const meta = document.createElement('div');
    meta.className = 'task-meta';
    meta.textContent = `Rama: ${task.branch}${task.baseBranch ? ` · base: ${task.baseBranch}` : ''}`;
    box.appendChild(meta);
  }
  const files = task.outputFiles || [];
  if (files.length) {
    const title = document.createElement('div');
    title.className = 'task-meta';
    title.textContent = 'Ficheros generados (incluidos los ignorados por git):';
    box.appendChild(title);
    for (const rel of files) {
      const row = document.createElement('div');
      row.className = 'task-file';
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'task-file-name marquee-text';
      name.textContent = rel;
      name.title = 'Abrir con la aplicacion del sistema';
      name.addEventListener('click', (e) => { e.stopPropagation(); openTaskFile(taskId, rel, false); });
      row.appendChild(name);
      row.appendChild(actionButton('Ver', { onClick: () => openFilePreview(taskId, rel) }));
      row.appendChild(actionButton('Carpeta', { onClick: () => openTaskFile(taskId, rel, true) }));
      box.appendChild(row);
    }
  }
  const logRow = document.createElement('div');
  logRow.className = 'task-actions';
  const open = openTaskLogs.has(taskId);
  logRow.appendChild(actionButton(open ? 'Ocultar registro' : 'Ver registro del agente', {
    onClick: () => { if (open) openTaskLogs.delete(taskId); else openTaskLogs.add(taskId); renderTasks(); }
  }));
  box.appendChild(logRow);
  if (open) {
    const log = document.createElement('pre');
    log.className = 'task-log';
    const lines = taskLogs.get(taskId) || [];
    log.textContent = lines.length ? lines.join('\n') : 'Sin actividad registrada desde que abriste esta pestaña.';
    box.appendChild(log);
  }
  return box;
}

async function openTaskFile(taskId, rel, reveal) {
  const res = await fetch(`/api/tasks/${taskId}/files/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: rel, reveal })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) appendMessage('system', `No se pudo abrir ${rel}: ${data.error || res.status}`);
}

function openFilePreview(taskId, rel) {
  const overlay = document.createElement('div');
  overlay.className = 'file-preview-overlay';
  const panel = document.createElement('div');
  panel.className = 'file-preview';
  const head = document.createElement('div');
  head.className = 'file-preview-head';
  const title = document.createElement('span');
  title.textContent = rel;
  head.appendChild(title);
  head.appendChild(actionButton('Abrir con el sistema', { onClick: () => openTaskFile(taskId, rel, false) }));
  head.appendChild(actionButton('Cerrar', { onClick: () => overlay.remove() }));
  const body = document.createElement('div');
  body.className = 'file-preview-body';
  body.textContent = 'Cargando...';
  panel.append(head, body);
  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  fetch(`/api/tasks/${taskId}/files/preview?path=${encodeURIComponent(rel)}`)
    .then((r) => r.json())
    .then((data) => {
      body.textContent = '';
      if (data.error) { body.textContent = data.error; return; }
      if (data.kind === 'text') {
        const pre = document.createElement('pre');
        pre.textContent = data.content;
        body.appendChild(pre);
      } else if (data.kind === 'html') {
        // Sin scripts ni acceso al origen: el HTML generado no puede ejecutar nada.
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', '');
        frame.srcdoc = data.content;
        body.appendChild(frame);
      } else {
        body.textContent = data.reason || 'Sin previsualizacion. Usa "Abrir con el sistema".';
      }
    })
    .catch(() => { body.textContent = 'No se pudo cargar la previsualizacion.'; });
}

function buildTaskCard(taskId, task, lastStep) {
  const ready = task.status === 'ready_to_test';
  const card = document.createElement('div');
  card.className = 'task-card' + (ready ? ' ready' : '') + (task.status === 'awaiting_input' ? ' awaiting' : '');
  // Tambien en curso: borrar la tarea mata su sesion de Claude (ver DELETE en server/index.js).
  card.appendChild(renderDeleteButton(() => deleteRealTask(taskId)));

  const title = document.createElement('div');
  title.className = 'task-title marquee-text';
  title.textContent = task.title;
  card.appendChild(title);
  if (task.phases?.length) card.appendChild(renderPhaseChips(task));

  const step = document.createElement('div');
  step.className = 'task-step marquee-text';
  step.textContent = taskStepText(task, lastStep);
  card.appendChild(step);
  if (task.status === 'in_progress') {
    const planning = task.stage === 'plan' || task.stage === 'research';
    card.appendChild(renderOrb(!lastStep ? 'thinking' : planning ? 'planning' : 'working'));
  }

  const answerStage = task.status === 'awaiting_input' ? QUESTION_STAGE[task.pendingQuestion?.kind] : null;
  const question = answerStage ? task.pendingQuestion.text : null;
  const text = question || (ready || task.status === 'pending' ? task.output : null);
  if (text) {
    const output = document.createElement('div');
    output.className = 'task-output';
    output.textContent = text;
    card.appendChild(output);
  }
  if (task.error) {
    const err = document.createElement('div');
    err.className = 'task-error';
    err.textContent = task.error;
    card.appendChild(err);
  }

  card.appendChild(renderTaskWorkspace(taskId, task));

  if (answerStage) {
    card.appendChild(renderAnswerForm(taskId, answerStage));
  } else if (task.status === 'awaiting_input' && task.pendingQuestion?.kind === 'doc-options') {
    card.appendChild(renderDocOptions(taskId, task));
  } else if (ready) {
    card.appendChild(renderCommitAndMerge(taskId, task));
    card.appendChild(renderReadyActions(taskId));
  } else if (task.status === 'pending' && task.pendingPermission) {
    card.appendChild(renderPermissionRequest(taskId, task.pendingPermission));
  } else if (task.status === 'pending' && task.stage) {
    const row = document.createElement('div');
    row.className = 'task-actions';
    row.appendChild(actionButton('Reintentar etapa', { onClick: () => runTaskStage(taskId, { stage: task.stage }) }));
    card.appendChild(row);
  }
  return card;
}

function renderTasks() {
  colInProgress.innerHTML = '';
  colReadyToTest.innerHTML = '';
  for (const [taskId, { task, lastStep }] of tasks) {
    const card = buildTaskCard(taskId, task, lastStep);
    if (task.status === 'ready_to_test') colReadyToTest.appendChild(card);
    else colInProgress.appendChild(card);
  }
  for (const [taskId, agent] of chatAgents) {
    if (agent.chatId !== currentChatId) continue;
    const card = document.createElement('div');
    card.className = 'task-card chat-agent-card'
      + (agent.interrupted ? ' interrupted' : '')
      + (agent.finished ? ' ready' : '');
    if (agent.finished) card.appendChild(renderDeleteButton(() => dismissChatAgent(taskId)));
    const title = document.createElement('div');
    title.className = 'task-title marquee-text';
    title.textContent = agent.description;
    card.appendChild(title);
    const step = document.createElement('div');
    step.className = 'task-step marquee-text';
    step.textContent = agent.finished
      ? (agent.status === 'failed' ? 'agente de chat · fallido' : 'agente de chat · completado')
      : agent.interrupted
        ? 'interrumpido · necesita permiso en la terminal'
        : `agente de chat · ${agent.lastStep || 'iniciando...'}`;
    card.appendChild(step);
    if (!agent.finished && !agent.interrupted) card.appendChild(renderOrb(agent.lastStep ? 'working' : 'thinking'));
    if (agent.finished) {
      const output = document.createElement('div');
      output.className = 'task-output';
      output.textContent = agent.summary || 'El agente no devolvio un resumen de texto.';
      card.appendChild(output);
    }
    if (agent.finished) colReadyToTest.appendChild(card);
    else colInProgress.appendChild(card);
  }
}

async function loadInitialTasks() {
  const list = await fetch('/api/tasks').then((r) => r.json());
  for (const task of list) tasks.set(task.id, { task, lastStep: null });
  renderTasks();
}


let clockFormat = 'datetime';

function tickClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (clockFormat === 'time') { clockEl.textContent = time; return; }
  const weekday = now.toLocaleDateString('es-ES', { weekday: 'long' });
  const day = now.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  clockEl.textContent = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}\u00A0\u00A0${time}`;
}

// Aplica tema y formato de reloj. "system" quita el atributo para seguir al sistema.
// Texto que no cabe en una linea se desplaza de lado a lado al pasar el raton.
const marqueeFrames = new Map();

function marqueeStart(el) {
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0 || marqueeFrames.has(el)) return;
  const duration = Math.max(900, max * 12);
  const started = performance.now();
  el.classList.add('marquee-active');
  const step = (now) => {
    if (!el.isConnected) { marqueeFrames.delete(el); return; }
    const t = ((now - started) / duration) % 2;
    el.scrollLeft = max * (t <= 1 ? t : 2 - t);
    marqueeFrames.set(el, requestAnimationFrame(step));
  };
  marqueeFrames.set(el, requestAnimationFrame(step));
}

function marqueeStop(el) {
  const frame = marqueeFrames.get(el);
  if (frame !== undefined) cancelAnimationFrame(frame);
  marqueeFrames.delete(el);
  el.classList.remove('marquee-active');
  el.scrollLeft = 0;
}

document.addEventListener('mouseover', (e) => {
  const el = e.target.closest?.('.marquee-text');
  if (el) marqueeStart(el);
});
document.addEventListener('mouseout', (e) => {
  const el = e.target.closest?.('.marquee-text');
  if (el && !el.contains(e.relatedTarget)) marqueeStop(el);
});

// Separador entre chat y tareas: arrastrar cambia el ancho del chat y se recuerda en este navegador.
const layoutEl = document.querySelector('.layout');
const layoutSplitter = document.getElementById('layout-splitter');
const chatPanelEl = document.getElementById('chat-panel');
const CHAT_MIN = 320;
const TASKS_MIN = 320;

function setChatWidth(px) {
  layoutEl.style.setProperty('--chat-w', `${Math.round(px)}px`);
}

try {
  const saved = Number(localStorage.getItem('optimia:chat-width'));
  if (saved >= CHAT_MIN) setChatWidth(saved);
} catch { /* sin localStorage: ancho por defecto */ }

layoutSplitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  layoutSplitter.setPointerCapture(e.pointerId);
  layoutSplitter.classList.add('dragging');
  const startX = e.clientX;
  const startWidth = chatPanelEl.getBoundingClientRect().width;
  const maxWidth = layoutEl.clientWidth - layoutSplitter.offsetWidth - TASKS_MIN - 28;
  const onMove = (ev) => setChatWidth(Math.min(maxWidth, Math.max(CHAT_MIN, startWidth + ev.clientX - startX)));
  const onUp = () => {
    layoutSplitter.classList.remove('dragging');
    layoutSplitter.removeEventListener('pointermove', onMove);
    layoutSplitter.removeEventListener('pointerup', onUp);
    try { localStorage.setItem('optimia:chat-width', String(Math.round(chatPanelEl.getBoundingClientRect().width))); } catch { /* sin persistencia */ }
  };
  layoutSplitter.addEventListener('pointermove', onMove);
  layoutSplitter.addEventListener('pointerup', onUp);
});

layoutSplitter.addEventListener('dblclick', () => {
  layoutEl.style.removeProperty('--chat-w');
  try { localStorage.removeItem('optimia:chat-width'); } catch { /* sin persistencia */ }
});

function applyUi(ui) {
  if (ui.theme && ui.theme !== 'system') document.documentElement.dataset.theme = ui.theme;
  else delete document.documentElement.dataset.theme;
  clockFormat = ui.clock === 'time' ? 'time' : 'datetime';
  tickClock();
}
tickClock();
setInterval(tickClock, 1000 * 30);

function appendMessage(role, text, images = []) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  if (images.length) {
    const imgRow = document.createElement('div');
    imgRow.className = 'msg-images';
    for (const src of images) {
      const img = document.createElement('img');
      img.src = src;
      imgRow.appendChild(img);
    }
    el.appendChild(imgRow);
  }
  if (text) {
    const textEl = document.createElement('span');
    textEl.textContent = text;
    el.appendChild(textEl);
  }
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

function renderAttachments() {
  attachmentsEl.innerHTML = '';
  attachmentsEl.hidden = pendingImages.length === 0;
  pendingImages.forEach((img, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'attachment-thumb';
    const preview = document.createElement('img');
    preview.src = img.dataUrl;
    thumb.appendChild(preview);
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'Quitar';
    removeBtn.addEventListener('click', () => {
      pendingImages.splice(idx, 1);
      renderAttachments();
    });
    thumb.appendChild(removeBtn);
    attachmentsEl.appendChild(thumb);
  });
}

function addPendingImage(file) {
  if (!IMAGE_MIME_TYPES.has(file.type)) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const base64Data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    pendingImages.push({ mediaType: file.type, base64Data, dataUrl });
    renderAttachments();
  };
  reader.readAsDataURL(file);
}

function addImageFilesFromList(fileList) {
  for (const file of fileList) addPendingImage(file);
}

input.addEventListener('paste', (e) => {
  const items = Array.from(e.clipboardData?.items || []);
  const imageItems = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
  if (!imageItems.length) return;
  e.preventDefault();
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (file) addPendingImage(file);
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  chatInputArea.addEventListener(eventName, (e) => {
    e.preventDefault();
    chatInputArea.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  chatInputArea.addEventListener(eventName, (e) => {
    e.preventDefault();
    chatInputArea.classList.remove('drag-over');
  });
});

chatInputArea.addEventListener('drop', (e) => {
  addImageFilesFromList(e.dataTransfer?.files || []);
});

function setWaiting(isWaiting) {
  waitingForResult = isWaiting;
  const canStop = isWaiting && wsOpen && Boolean(currentChatId);
  sendButton.textContent = canStop ? 'Parar' : 'Enviar';
  sendButton.classList.toggle('stop', canStop);
  sendButton.disabled = isWaiting ? !canStop : (!currentChatId || !wsOpen);
  thinkingOrb.hidden = !isWaiting;
}

function stopCurrentChat() {
  if (!currentChatId || !wsOpen) return;
  ws.send(JSON.stringify({ type: 'stop_chat', chatId: currentChatId }));
}

function renderAssistantEvent(event) {
  const blocks = event.message?.content || [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      if (!currentAssistantBubble) currentAssistantBubble = appendMessage('assistant', block.text);
      else currentAssistantBubble.textContent += block.text;
    } else if (block.type === 'tool_use' && block.name === 'Agent' && !event.parent_tool_use_id) {
      // A top-level Agent call (no parent) is a new subagent the user asked
      // for. Its own tool_result arrives almost immediately as just an
      // acknowledgement that it was backgrounded, NOT its actual result —
      // so the card itself is driven entirely by the system/task_* events
      // below (task_started/task_progress/task_updated/background_tasks_
      // changed), not by this tool_use or its tool_result. This block only
      // announces the launch in the chat log.
      appendMessage('system', `→ lanzando agente: ${block.input?.description || 'Agente'}`);
    } else if (block.type === 'tool_use' && event.parent_tool_use_id) {
      // A tool call made BY a subagent (WebSearch, Bash, ToolSearch...) —
      // its progress already reaches the card via system/task_progress
      // (last_tool_name), so skip the generic chat line to avoid flooding
      // the log with another agent's internal steps.
    } else if (block.type === 'tool_use') {
      appendMessage('system', `→ usando herramienta: ${block.name}`);
    } else if (block.type === 'tool_result') {
      appendMessage('system', '✓ resultado de herramienta recibido');
    }
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

function handleClaudeEvent(event) {
  if (event.type === 'assistant') {
    renderAssistantEvent(event);
  } else if (event.type === 'system') {
    // Claude Code's own background-task bookkeeping for the Agent tool —
    // the authoritative source for whether a subagent is still running,
    // confirmed against real stream-json output (task_started carries
    // description/subagent_type, task_progress carries last_tool_name,
    // task_updated's patch.status flips to 'completed'/'failed',
    // task_notification carries the agent's actual final text answer in
    // `summary`, and background_tasks_changed gives the full live snapshot).
    let agentsChanged = false;
    if (event.subtype === 'task_started' && event.task_id) {
      if (!isAgentDismissed(currentChatId, event.task_id)) {
        chatAgents.set(event.task_id, { chatId: currentChatId, description: event.description || 'Agente', lastStep: 'iniciando...' });
        agentsChanged = true;
      }
    } else if (event.subtype === 'task_progress' && chatAgents.has(event.task_id)) {
      if (event.last_tool_name) chatAgents.get(event.task_id).lastStep = `usando ${event.last_tool_name}`;
      agentsChanged = true;
    } else if (event.subtype === 'task_updated' && event.patch?.status && event.patch.status !== 'running') {
      // Terminal status, but the agent's own task_notification (with its
      // actual output) can still be in flight — move the card to "ready to
      // review" instead of deleting it, so the user sees what it produced.
      const agent = chatAgents.get(event.task_id);
      if (agent) { agent.finished = true; agent.status = event.patch.status; agentsChanged = true; }
    } else if (event.subtype === 'task_notification' && event.task_id) {
      const agent = chatAgents.get(event.task_id);
      if (agent) {
        agent.finished = true;
        agent.status = agent.status || event.status;
        agent.summary = event.summary;
        agentsChanged = true;
      } else if (!isAgentDismissed(currentChatId, event.task_id)) {
        chatAgents.set(event.task_id, {
          chatId: currentChatId, description: 'Agente', finished: true, status: event.status, summary: event.summary
        });
        agentsChanged = true;
      }
    } else if (event.subtype === 'background_tasks_changed') {
      const liveIds = new Set((event.tasks || []).map((t) => t.task_id));
      for (const [id, agent] of chatAgents) {
        // Only reap entries nothing else is tracking — once an agent is
        // finished it stays for review until the user dismisses it, even
        // after it drops out of Claude Code's own live-task snapshot.
        if (agent.chatId === currentChatId && !agent.finished && !liveIds.has(id)) { chatAgents.delete(id); agentsChanged = true; }
      }
      for (const t of event.tasks || []) {
        if (!chatAgents.has(t.task_id) && !isAgentDismissed(currentChatId, t.task_id)) {
          chatAgents.set(t.task_id, { chatId: currentChatId, description: t.description || 'Agente', lastStep: 'iniciando...' });
          agentsChanged = true;
        }
      }
    }
    if (agentsChanged) renderTasks();
  } else if (event.type === 'result') {
    currentAssistantBubble = null;
    setWaiting(false);
    if (event.is_error) appendMessage('error', typeof event.result === 'string' ? event.result : 'Error en la sesión de Claude.');
    // NOTE: deliberately no chatAgents cleanup here. A `result` only closes
    // this turn's synchronous text reply — background agents (the whole
    // point of the Agent tool's backgrounding) keep running and report their
    // own task_progress/task_updated afterwards, sometimes across a `result`
    // boundary (confirmed against a real two-agent run: the text reply's
    // `result` arrived before one agent's `task_updated`). Wiping chatAgents
    // here used to delete cards for agents that were still genuinely
    // running. Lifecycle is owned entirely by the system/task_* handlers and
    // background_tasks_changed above, plus the terminal_handoff guard below.
  }
  // 'user' (tool_result echoes) and the remaining 'system' subtypes (init,
  // hook_started, thinking_tokens...) are diagnostic only — kept out of the
  // chat log to avoid clutter, visible in devtools.
  else {
    console.debug('[optimia] claude_event', event.type, event);
  }
}

function connect() {
  setConnectionState(false, 'Conectando...');

  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    wsOpen = true;
    setConnectionState(true, 'Conectado');
    setWaiting(waitingForResult);
    if (currentChatId) ws.send(JSON.stringify({ type: 'subscribe', chatId: currentChatId }));
    if (window.TerminalView && window.TerminalView.isOpen()) ws.send(JSON.stringify({ type: 'terminal_subscribe' }));
  });

  ws.addEventListener('message', (raw) => {
    const msg = JSON.parse(raw.data);
    if (msg.type === 'claude_event') {
      if (msg.chatId === currentChatId) handleClaudeEvent(msg.event);
    } else if (msg.type === 'bridge_error') {
      if (!msg.chatId || msg.chatId === currentChatId) {
        appendMessage('error', msg.error);
        setWaiting(false);
      }
    } else if (msg.type === 'chat_renamed') {
      const meta = chatsMeta.get(msg.chatId);
      if (meta) { meta.title = msg.title; renderChatTabs(); }
    } else if (msg.type === 'chat_stopped') {
      if (msg.chatId === currentChatId) {
        currentAssistantBubble = null;
        appendMessage('system', 'Consulta parada. La conversacion se conserva; el siguiente mensaje continua desde aqui.');
        setWaiting(false);
      }
    } else if (msg.type === 'claude_exit') {
      if (msg.chatId === currentChatId) {
        appendMessage('system', 'La sesion de Claude Code para este chat termino. Se reanudara con el siguiente mensaje.');
        setWaiting(false);
      }
    } else if (msg.type === 'client_error') {
      console.warn('[optimia] client_error', msg.error);
      appendMessage('error', msg.error);
      setWaiting(false);
    } else if (msg.type === 'permission_needed') {
      if (msg.scope === 'chat' ? msg.id === currentChatId : true) {
        appendMessage('system', `Permiso denegado: ${msg.toolName}. Abriendo la terminal para continuar de forma interactiva.`);
      }
      if (window.TerminalView) window.TerminalView.flagAttention();
    } else if (msg.type === 'terminal_handoff') {
      if (msg.scope === 'chat' ? msg.id === currentChatId : true) {
        appendMessage('system', `Abriendo la terminal (${msg.toolName} necesitaba permiso). Al cerrarla, esta conversacion sigue aqui.`);
        setWaiting(false);
      }
      if (msg.scope === 'chat') {
        // The headless session gets killed for the handoff, so any agent
        // card still "running" for this chat never gets its task_updated —
        // and per Claude Code's own terminal output, the background agent
        // itself gets orphaned, not just its status report. Mark the card
        // rather than delete it: making it vanish silently while the chat
        // text may still say "cuando termine, te aviso" is more confusing
        // than an honest "interrumpido" state. It clears itself next time a
        // background_tasks_changed snapshot confirms it's really gone (e.g.
        // on the next message sent in this chat).
        let agentsChanged = false;
        for (const [id, agent] of chatAgents) {
          if (agent.chatId === msg.id && !agent.interrupted && !agent.finished) { agent.interrupted = true; agentsChanged = true; }
        }
        if (agentsChanged) renderTasks();
      }
      if (window.TerminalView) window.TerminalView.open();
    } else if (msg.type === 'chat_resumed') {
      if (msg.chatId === currentChatId) {
        appendMessage('system', 'Terminal cerrada. La conversacion sigue aqui, puedes continuar.');
        setWaiting(false);
      }
    } else if (msg.type === 'task_updated') {
      const entry = tasks.get(msg.task.id);
      const prevStatus = entry ? entry.task.status : null;
      tasks.set(msg.task.id, { task: msg.task, lastStep: entry ? entry.lastStep : null });
      renderTasks();
      notifyTaskInChat(msg.task, prevStatus);
    } else if (msg.type === 'task_deleted') {
      if (tasks.delete(msg.taskId)) renderTasks();
    } else if (msg.type === 'task_claude_event') {
      logTaskEvent(msg.taskId, msg.event);
      const entry = tasks.get(msg.taskId);
      if (entry) {
        entry.lastStep = stepLabelFor(msg.event) || entry.lastStep;
        renderTasks();
      } else if (openTaskLogs.has(msg.taskId)) {
        renderTasks();
      }
    } else if (msg.type === 'task_error') {
      console.warn('[optimia] task_error', msg.taskId, msg.error);
    } else if (msg.type === 'terminal_scrollback') {
      if (window.TerminalView) window.TerminalView.handleScrollback(msg.data);
    } else if (msg.type === 'terminal_data') {
      if (window.TerminalView) window.TerminalView.handleData(msg.data);
    } else if (msg.type === 'terminal_exit') {
      if (window.TerminalView) window.TerminalView.handleExit(msg.info);
    }
  });

  ws.addEventListener('close', () => {
    wsOpen = false;
    setConnectionState(false, 'Desconectado');
    setWaiting(true);
    setTimeout(connect, 1500);
  });

  ws.addEventListener('error', () => ws.close());
}

// Modo del chat: "chat" es una conversacion normal; "coding" y "documentation"
// convierten cada mensaje en una tarea con su flujo fijo (ver taskStages.js).
const CHAT_KIND_LABEL = { coding: 'de código', documentation: 'de documentación' };
const chatKindSelect = document.getElementById('chat-kind-select');
chatKindSelect.value = localStorage.getItem('optimia:chat-kind') || 'chat';
const taskBaseSelect = document.getElementById('task-base-select');
const taskBranchInput = document.getElementById('task-branch-input');

async function loadTaskBranches() {
  const { current, branches } = await fetch('/api/git/branches').then((r) => r.json());
  const saved = localStorage.getItem('optimia:task-base');
  taskBaseSelect.innerHTML = '';
  for (const name of branches) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    taskBaseSelect.appendChild(opt);
  }
  taskBaseSelect.value = branches.includes(saved) ? saved : current;
}

function syncTaskControls() {
  const isTask = chatKindSelect.value !== 'chat';
  for (const el of document.querySelectorAll('.task-only')) el.hidden = !isTask;
  if (isTask) loadTaskBranches().catch(() => {});
}

taskBaseSelect.addEventListener('change', () => localStorage.setItem('optimia:task-base', taskBaseSelect.value));
chatKindSelect.addEventListener('change', () => { localStorage.setItem('optimia:chat-kind', chatKindSelect.value); syncTaskControls(); });
syncTaskControls();

async function createTaskFromChat(kind, text) {
  if (!currentChatId) return;
  if (!text) return;
  if (pendingImages.length > 0) {
    appendMessage('system', 'Las tareas todavía no admiten imágenes. Quítalas o cambia el modo a Chat.');
    return;
  }
  const title = text.split('\n')[0].slice(0, 80);
  input.value = '';
  input.style.height = 'auto';
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      type: kind,
      instruction: text,
      chatId: currentChatId,
      baseBranch: taskBaseSelect.value || undefined,
      branchName: taskBranchInput.value.trim() || undefined
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    appendMessage('system', `No se pudo lanzar la tarea: ${data.error || res.status}`);
    return;
  }
  applyTaskFromServer(data);
  taskBranchInput.value = '';
  renderTasks();
  appendMessage('system', `Tarea ${CHAT_KIND_LABEL[kind]} lanzada: "${title}". Te avisaré aquí si necesita algo.`);
}

// Avisa en la conversacion cuando una tarea lanzada desde ella necesita al usuario.
function notifyTaskInChat(task, prevStatus) {
  if (!task.chatId || task.chatId !== currentChatId || prevStatus === task.status) return;
  if (task.status === 'awaiting_input') {
    const q = task.pendingQuestion;
    if (q?.kind === 'doc-options') {
      appendMessage('system', `"${task.title}": la investigación está lista. Elige modo, formato y destino en el panel de agentes.`);
    } else {
      appendMessage('system', `"${task.title}" necesita tu respuesta. Contéstala en su tarjeta del panel de agentes.`);
    }
  } else if (task.status === 'ready_to_test') {
    appendMessage('system', `"${task.title}" está lista para revisar y ship en el panel de agentes.`);
  } else if (task.status === 'pending' && task.error) {
    appendMessage('system', `"${task.title}" se detuvo: ${task.error}`);
  }
}

function sendCurrentInput() {
  const text = input.value.trim();
  if (chatKindSelect.value !== 'chat') return createTaskFromChat(chatKindSelect.value, text);
  if ((!text && pendingImages.length === 0) || !currentChatId || !wsOpen || waitingForResult) return;
  const images = pendingImages.map(({ mediaType, base64Data }) => ({ mediaType, base64Data }));
  const previewUrls = pendingImages.map((img) => img.dataUrl);
  appendMessage('user', text, previewUrls);
  ws.send(JSON.stringify({ type: 'user_message', chatId: currentChatId, text, images }));
  input.value = '';
  input.style.height = 'auto';
  pendingImages = [];
  renderAttachments();
  setWaiting(true);
}

function renderChatTabs() {
  chatTabs.querySelectorAll('.chat-tab').forEach((el) => el.remove());
  const metas = Array.from(chatsMeta.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const meta of metas) {
    const btn = document.createElement('button');
    btn.className = 'chat-tab' + (meta.id === currentChatId ? ' active' : '');
    btn.title = meta.title || 'Chat';
    btn.addEventListener('click', () => selectChat(meta.id));

    const label = document.createElement('span');
    label.className = 'chat-tab-label';
    label.textContent = meta.title || 'Chat';
    btn.appendChild(label);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'chat-tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Eliminar chat';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(meta.id);
    });
    btn.appendChild(closeBtn);

    chatTabs.insertBefore(btn, chatNewButton);
  }
}

async function deleteChat(chatId) {
  await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
  chatsMeta.delete(chatId);
  if (chatId === currentChatId) {
    const next = Array.from(chatsMeta.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (next) {
      await selectChat(next.id);
    } else {
      await createAndSelectChat();
    }
  } else {
    renderChatTabs();
  }
}

// Replays a chat's persisted transcript through the exact same renderer used
// for live events, so there is only one code path for "what a message looks
// like" — recovering from a refresh is just feeding history through it.
function replayChat(chat) {
  chatLog.innerHTML = '';
  currentAssistantBubble = null;
  for (const m of chat.messages) {
    if (m.role === 'user') {
      const previews = (m.images || []).map((img) => `data:${img.mediaType};base64,${img.base64Data}`);
      appendMessage('user', m.text, previews);
    } else if (m.role === 'claude_event') {
      handleClaudeEvent(m.event);
    }
  }
}

async function selectChat(chatId) {
  currentChatId = chatId;
  renderChatTabs();
  const chat = await fetch(`/api/chats/${chatId}`).then((r) => r.json());
  replayChat(chat);
  setWaiting(false);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', chatId }));
  }
}

async function createAndSelectChat() {
  const chat = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }).then((r) => r.json());
  chatsMeta.set(chat.id, chat);
  await selectChat(chat.id);
}

async function loadInitialChats() {
  const list = await fetch('/api/chats').then((r) => r.json());
  chatsMeta.clear();
  for (const meta of list) chatsMeta.set(meta.id, meta);
  const mostRecent = list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (mostRecent) {
    await selectChat(mostRecent.id);
  } else {
    await createAndSelectChat();
  }
}

chatNewButton.addEventListener('click', () => { createAndSelectChat(); });

sendButton.addEventListener('click', () => (waitingForResult ? stopCurrentChat() : sendCurrentInput()));

// Autocompletado de skills: al escribir "/" al inicio de una palabra se
// ofrecen las skills de .claude/skills/ y se insertan como "/slug ".
const skillSuggest = document.getElementById('skill-suggest');
let skillSuggestItems = [];
let skillSuggestIndex = 0;
let skillSuggestRange = null;
let skillSuggestToken = 0;

function currentSkillQuery() {
  const caret = input.selectionStart;
  const match = input.value.slice(0, caret).match(/(^|\s)\/([a-z0-9-]*)$/i);
  if (!match) return null;
  const query = match[2].toLowerCase();
  return { query, start: caret - query.length - 1, end: caret };
}

function hideSkillSuggest() {
  skillSuggestToken++;
  skillSuggest.hidden = true;
  skillSuggestItems = [];
  skillSuggestRange = null;
}

function renderSkillSuggest() {
  skillSuggest.replaceChildren();
  skillSuggestItems.forEach((skill, i) => {
    const row = document.createElement('div');
    row.className = 'skill-suggest-item' + (i === skillSuggestIndex ? ' active' : '');
    row.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.className = 'skill-suggest-name';
    name.textContent = '/' + skill.slug;
    const source = document.createElement('span');
    source.className = 'skill-suggest-source';
    source.textContent = skill.source === 'claude' ? 'Claude' : 'proyecto';
    const head = document.createElement('div');
    head.className = 'skill-suggest-head';
    head.appendChild(name);
    head.appendChild(source);
    row.appendChild(head);
    if (skill.description) {
      const desc = document.createElement('span');
      desc.className = 'skill-suggest-desc';
      desc.textContent = skill.description;
      row.appendChild(desc);
    }
    // mousedown + preventDefault evita que el textarea pierda el foco antes de insertar.
    row.addEventListener('mousedown', (e) => { e.preventDefault(); applySkillSuggest(i); });
    skillSuggest.appendChild(row);
  });
  skillSuggest.hidden = false;
}

function applySkillSuggest(i) {
  const skill = skillSuggestItems[i];
  const range = skillSuggestRange;
  if (!skill || !range) return;
  const insert = '/' + skill.slug + ' ';
  input.value = input.value.slice(0, range.start) + insert + input.value.slice(range.end);
  const caret = range.start + insert.length;
  input.setSelectionRange(caret, caret);
  hideSkillSuggest();
  input.dispatchEvent(new Event('input'));
  input.focus();
}

// Comandos integrados de Claude Code. Lista estatica: los comandos de plugins
// o del usuario no aparecen aqui. Los de tipo interactivo (/model, /config,
// /vim...) necesitan la terminal; en el chat se insertan igual.
const CLAUDE_COMMANDS = [
  { slug: 'add-dir', description: 'Anade un directorio de trabajo a la sesion' },
  { slug: 'agents', description: 'Gestiona los subagentes' },
  { slug: 'bug', description: 'Informa de un error de Claude Code' },
  { slug: 'clear', description: 'Vacia la conversacion actual' },
  { slug: 'compact', description: 'Resume la conversacion para liberar contexto' },
  { slug: 'config', description: 'Abre la configuracion de Claude Code' },
  { slug: 'cost', description: 'Muestra el coste y la duracion de la sesion' },
  { slug: 'doctor', description: 'Comprueba la instalacion de Claude Code' },
  { slug: 'help', description: 'Ayuda de Claude Code' },
  { slug: 'init', description: 'Crea un CLAUDE.md para el proyecto' },
  { slug: 'login', description: 'Inicia sesion en Claude' },
  { slug: 'logout', description: 'Cierra la sesion de Claude' },
  { slug: 'mcp', description: 'Gestiona los servidores MCP' },
  { slug: 'memory', description: 'Edita los ficheros CLAUDE.md de memoria' },
  { slug: 'model', description: 'Cambia el modelo' },
  { slug: 'permissions', description: 'Gestiona los permisos' },
  { slug: 'pr-comments', description: 'Muestra los comentarios de un pull request' },
  { slug: 'review', description: 'Revisa un pull request' },
  { slug: 'status', description: 'Estado de la cuenta y la configuracion' },
  { slug: 'terminal-setup', description: 'Configura el terminal para atajos de teclado' },
  { slug: 'vim', description: 'Activa el modo vim en el editor de entrada' }
].map((c) => ({ ...c, source: 'claude' }));

async function updateSkillSuggest() {
  const range = currentSkillQuery();
  if (!range) return hideSkillSuggest();
  const token = ++skillSuggestToken;
  const skills = await fetch('/api/skills').then((r) => r.json()).catch(() => []);
  if (token !== skillSuggestToken) return;
  const q = range.query;
  const all = [...skills.map((s) => ({ ...s, source: 'project' })), ...CLAUDE_COMMANDS];
  const matches = all
    .filter((s) => s.slug.includes(q) || (s.name || '').toLowerCase().includes(q))
    .sort((a, b) => Number(!a.slug.startsWith(q)) - Number(!b.slug.startsWith(q))
      || (a.source === b.source ? 0 : a.source === 'project' ? -1 : 1)
      || a.slug.localeCompare(b.slug))
    .slice(0, 12);
  if (matches.length === 0) return hideSkillSuggest();
  skillSuggestItems = matches;
  skillSuggestIndex = 0;
  skillSuggestRange = range;
  renderSkillSuggest();
}

// Devuelve true si la tecla la ha consumido el menu de skills.
function handleSkillSuggestKey(e) {
  if (skillSuggest.hidden) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = skillSuggestItems.length;
    skillSuggestIndex = (skillSuggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    renderSkillSuggest();
    return true;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault();
    applySkillSuggest(skillSuggestIndex);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    hideSkillSuggest();
    return true;
  }
  return false;
}

input.addEventListener('keydown', (e) => {
  if (handleSkillSuggestKey(e)) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrentInput();
  }
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  updateSkillSuggest();
});

input.addEventListener('blur', hideSkillSuggest);
input.addEventListener('click', updateSkillSuggest);

// The effort selector tunes the real `--effort` flag the bridge already
// supports (server/bridge/claudeProcess.js) — not a model-name picker, since
// this app has no verified list of installed/available Claude model ids to
// offer without guessing at strings.
effortSelect.addEventListener('change', async () => {
  const settings = await fetch('/api/settings').then((r) => r.json());
  settings.ai.claude.effort = effortSelect.value;
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  appendMessage('system', `Effort actualizado a "${effortSelect.value}" para la proxima sesion.`);
});

async function loadInitialSettings() {
  const settings = await fetch('/api/settings').then((r) => r.json());
  applyUi(settings.ui || {});
  modeLabel.textContent = settings.ai.mode === 'local' ? 'IA local' : 'Claude Code';
  effortSelect.value = settings.ai.claude.effort || 'default';
  await populateChatModelSelect(settings);

  const health = await fetch('/api/health').then((r) => r.json());
  projectLabel.textContent = health.projectRoot.split('/').pop();
}

// ---- settings modal ----

const settingsOverlay = document.getElementById('settings-overlay');
const settingsButton = document.getElementById('settings-button');
const settingsClose = document.getElementById('settings-close');
const settingsSave = document.getElementById('settings-save');
const settingsSaveStatus = document.getElementById('settings-save-status');
const settingsPaneTitle = document.getElementById('settings-pane-title');
const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const settingsPanes = document.querySelectorAll('.settings-pane');

const claudeAccountInfo = document.getElementById('claude-account-info');
const claudeAccountSwitch = document.getElementById('claude-account-switch');
const claudeAccountRefresh = document.getElementById('claude-account-refresh');
const claudeAccountSwitchNote = document.getElementById('claude-account-switch-note');
const claudeModelSelect = document.getElementById('setting-claude-model');
const claudeEffortSelect = document.getElementById('setting-claude-effort');
const uiThemeSelect = document.getElementById('setting-ui-theme');
const uiClockSelect = document.getElementById('setting-ui-clock');
const currentUiDraft = () => ({ theme: uiThemeSelect.value, clock: uiClockSelect.value });
for (const el of [uiThemeSelect, uiClockSelect]) el.addEventListener('change', () => applyUi(currentUiDraft()));
const localUrlInput = document.getElementById('setting-local-url');
const localModelInput = document.getElementById('setting-local-model');
const localAuthInput = document.getElementById('setting-local-auth');
const instructionsTextarea = document.getElementById('setting-instructions');
const instructionsMigrationBanner = document.getElementById('instructions-migration-banner');
const memoryTextarea = document.getElementById('setting-memory');
const nogoList = document.getElementById('nogo-list');
const nogoInput = document.getElementById('nogo-input');
const nogoAddButton = document.getElementById('nogo-add');
const nogoMigrationBanner = document.getElementById('nogo-migration-banner');
const skillsList = document.getElementById('skills-list');
const skillSlugInput = document.getElementById('skill-slug-input');
const skillDescInput = document.getElementById('skill-desc-input');
const skillAddButton = document.getElementById('skill-add');

let currentSettings = null;

// "Ayuda con IA" buttons in Settings: ask the real `claude` CLI for a short
// suggestion and drop it into the field, never auto-saved — the user still
// reviews/edits it and clicks Guardar/Anadir/Crear themselves.
document.querySelectorAll('.ai-assist-button').forEach((button) => {
  const row = button.closest('.ai-assist-row');
  const promptInput = row.querySelector('.ai-assist-prompt');
  button.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    const target = document.getElementById(button.dataset.target);
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = '...';
    try {
      const res = await fetch('/api/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: button.dataset.field, prompt, current: target.value })
      });
      const data = await res.json();
      if (!res.ok || !data.suggestion) {
        settingsSaveStatus.textContent = data.error || 'No se pudo obtener una sugerencia.';
        return;
      }
      target.value = data.suggestion;
      promptInput.value = '';
    } catch (err) {
      settingsSaveStatus.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
});

function renderNogoList() {
  nogoList.innerHTML = '';
  currentSettings.preferences.noGo.forEach((pattern, idx) => {
    const row = document.createElement('div');
    row.className = 'nogo-item';
    const code = document.createElement('code');
    code.textContent = pattern;
    row.appendChild(code);
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'Quitar';
    removeBtn.addEventListener('click', () => {
      currentSettings.preferences.noGo.splice(idx, 1);
      renderNogoList();
    });
    row.appendChild(removeBtn);
    nogoList.appendChild(row);
  });
}

nogoAddButton.addEventListener('click', () => {
  const pattern = nogoInput.value.trim();
  if (!pattern) return;
  currentSettings.preferences.noGo.push(pattern);
  nogoInput.value = '';
  renderNogoList();
});
nogoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') nogoAddButton.click();
});

function renderMigrationBanner(el, field, preview, label) {
  if (!preview[field].changed) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = '';
  const text = document.createElement('div');
  text.textContent = `Se encontro una configuracion antigua para "${label}" distinta de la actual. ¿Importarla?`;
  el.appendChild(text);
  const applyBtn = document.createElement('button');
  applyBtn.className = 'send-button';
  applyBtn.textContent = 'Importar';
  applyBtn.addEventListener('click', async () => {
    const next = await fetch('/api/settings/migrate', { method: 'POST' }).then((r) => r.json());
    currentSettings = next;
    populateSettingsForm();
    el.hidden = true;
    settingsSaveStatus.textContent = 'Configuracion antigua importada.';
  });
  el.appendChild(applyBtn);
}

async function renderSkillsList() {
  const skills = await fetch('/api/skills').then((r) => r.json());
  skillsList.innerHTML = '';
  for (const skill of skills) {
    const row = document.createElement('div');
    row.className = 'skill-item';
    const name = document.createElement('span');
    name.className = 'skill-name';
    name.textContent = skill.name;
    row.appendChild(name);
    const desc = document.createElement('span');
    desc.className = 'skill-desc';
    desc.textContent = skill.description || '(sin SKILL.md)';
    row.appendChild(desc);
    skillsList.appendChild(row);
  }
  if (skills.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No hay skills todavia.';
    skillsList.appendChild(empty);
  }
}

skillAddButton.addEventListener('click', async () => {
  const slug = skillSlugInput.value.trim();
  if (!slug) return;
  const description = skillDescInput.value.trim();
  const res = await fetch('/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, description })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    settingsSaveStatus.textContent = err.error || 'No se pudo crear la skill.';
    return;
  }
  skillSlugInput.value = '';
  skillDescInput.value = '';
  renderSkillsList();
});
[skillSlugInput, skillDescInput].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') skillAddButton.click();
  });
});

function populateSettingsForm() {
  uiThemeSelect.value = currentSettings.ui?.theme || 'system';
  uiClockSelect.value = currentSettings.ui?.clock || 'datetime';
  claudeModelSelect.value = currentSettings.ai.claude.model || 'default';
  claudeEffortSelect.value = currentSettings.ai.claude.effort || 'default';
  localUrlInput.value = currentSettings.ai.localAi.url || '';
  localModelInput.value = currentSettings.ai.localAi.model || '';
  localAuthInput.value = currentSettings.ai.localAi.authHeader || '';
  instructionsTextarea.value = currentSettings.preferences.instructions || '';
  renderNogoList();
}

function renderAccountInfo(auth) {
  if (auth.loggedIn === false) {
    claudeAccountInfo.textContent = auth.error ? `No se pudo leer la cuenta: ${auth.error}` : 'No hay sesion de Claude Code iniciada.';
  } else {
    claudeAccountInfo.textContent = [
      auth.email ? `Cuenta: ${auth.email}` : null,
      auth.orgName ? `Organizacion: ${auth.orgName}` : null,
      auth.subscriptionType ? `Plan: ${auth.subscriptionType}` : null,
      auth.authMethod ? `Metodo: ${auth.authMethod}` : null
    ].filter(Boolean).join(' · ') || 'Sesion activa.';
  }
}

async function refreshAccountInfo() {
  claudeAccountInfo.textContent = 'Comprobando...';
  const auth = await fetch('/api/claude-auth').then((r) => r.json());
  renderAccountInfo(auth);
}

async function openSettings() {
  settingsOverlay.hidden = false;
  settingsSaveStatus.textContent = '';
  claudeAccountInfo.textContent = 'Comprobando...';
  claudeAccountSwitchNote.hidden = true;

  const [settings, memory, auth, migrationPreview] = await Promise.all([
    fetch('/api/settings').then((r) => r.json()),
    fetch('/api/memory').then((r) => r.json()),
    fetch('/api/claude-auth').then((r) => r.json()),
    fetch('/api/settings/migration-preview').then((r) => r.json())
  ]);

  currentSettings = settings;
  populateSettingsForm();
  memoryTextarea.value = memory.content || '';
  renderSkillsList();
  renderAccountInfo(auth);

  renderMigrationBanner(instructionsMigrationBanner, 'instructions', migrationPreview, 'Instructions');
  renderMigrationBanner(nogoMigrationBanner, 'noGo', migrationPreview, 'No-go');
}

claudeAccountSwitch.addEventListener('click', async () => {
  claudeAccountSwitch.disabled = true;
  try {
    const result = await fetch('/api/claude-auth/login', { method: 'POST' }).then((r) => r.json());
    claudeAccountSwitchNote.hidden = false;
    if (result.ok === false) claudeAccountSwitchNote.textContent = result.error;
  } finally {
    claudeAccountSwitch.disabled = false;
  }
});

claudeAccountRefresh.addEventListener('click', refreshAccountInfo);

function closeSettings() {
  settingsOverlay.hidden = true;
}

settingsButton.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

settingsNavItems.forEach((item) => {
  item.addEventListener('click', () => {
    settingsNavItems.forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    const pane = item.dataset.pane;
    settingsPanes.forEach((p) => { p.hidden = p.dataset.pane !== pane; });
    settingsPaneTitle.textContent = item.textContent;
    if (pane === 'registro') loadLogPane();
  });
});

const logList = document.getElementById('log-list');
const logFilter = document.getElementById('log-filter');
const logRefresh = document.getElementById('log-refresh');
let logEntries = [];

function logDetail(entry) {
  return Object.entries(entry)
    .filter(([k]) => !['ts', 'level', 'event'].includes(k))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('  ');
}

const LOG_CATEGORIES = {
  todo: () => true,
  archivos: (e) => e.event.startsWith('file.') || e.event === 'task.commit' || e.event === 'task.merge',
  preguntas: (e) => e.event === 'chat.user' || e.event === 'task.question',
  respuestas: (e) => e.event === 'chat.reply' || e.event === 'task.answer',
};
let logCategory = 'todo';

function renderLogPane() {
  const needle = logFilter.value.trim().toLowerCase();
  logList.innerHTML = '';
  const rows = logEntries.filter((e) => LOG_CATEGORIES[logCategory](e) && (!needle || `${e.event} ${logDetail(e)}`.toLowerCase().includes(needle)));
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = logEntries.length ? 'Ningún evento coincide con el filtro.' : 'Todavía no hay eventos registrados en este proyecto.';
    logList.appendChild(empty);
    return;
  }
  for (const e of rows) {
    const row = document.createElement('div');
    row.className = `log-row ${e.level || 'info'}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(e.ts).toLocaleTimeString('es-ES');
    const event = document.createElement('span');
    event.className = 'log-event';
    event.textContent = e.event;
    const detail = document.createElement('span');
    detail.className = 'log-detail';
    detail.textContent = logDetail(e);
    row.append(time, event, detail);
    logList.appendChild(row);
  }
}

async function loadLogPane() {
  logEntries = await fetch('/api/logs?limit=300').then((r) => r.json()).catch(() => []);
  renderLogPane();
}

logFilter.addEventListener('input', renderLogPane);
document.querySelectorAll('#log-chips .log-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    logCategory = chip.dataset.cat;
    document.querySelectorAll('#log-chips .log-chip').forEach((c) => c.classList.toggle('on', c === chip));
    renderLogPane();
  });
});
logRefresh.addEventListener('click', loadLogPane);

settingsSave.addEventListener('click', async () => {
  currentSettings.ai.claude.model = claudeModelSelect.value;
  currentSettings.ai.claude.effort = claudeEffortSelect.value;
  currentSettings.ai.localAi.url = localUrlInput.value.trim();
  currentSettings.ai.localAi.model = localModelInput.value.trim();
  currentSettings.ai.localAi.authHeader = localAuthInput.value.trim();
  currentSettings.preferences.instructions = instructionsTextarea.value;
  currentSettings.ui = currentUiDraft();

  const saved = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentSettings)
  }).then((r) => r.json());
  await fetch('/api/memory', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: memoryTextarea.value })
  });

  currentSettings = saved;
  applyUi(saved.ui);
  effortSelect.value = saved.ai.claude.effort || 'default';
  modeLabel.textContent = saved.ai.mode === 'local' ? 'IA local' : 'Claude Code';
  await populateChatModelSelect(saved);
  settingsSaveStatus.textContent = 'Guardado. Se aplicara en la proxima sesion de Claude.';
});

loadInitialSettings();
loadInitialTasks();
setWaiting(true);
connect();
loadInitialChats();
