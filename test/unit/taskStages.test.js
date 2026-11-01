'use strict';

const test = require('node:test');
const { spawnSync } = require('child_process');
const path = require('path');
const { mkTmpDir, rmTmpDir } = require('./helpers');
const { ensureGitGuardHooks } = require('../../server/bridge/gitGuard');
const assert = require('node:assert/strict');
const {
  firstStage,
  validateDocOptions,
  canRun,
  buildStagePrompt,
  answerPrompt,
  stageTools,
  stageDisallowed,
  approvalRule,
  decideAfterStage
} = require('../../server/bridge/taskStages');

const base = { id: 't1', title: 'Anadir botones', instruction: 'Anadir botones al tablero', status: 'pending', stageOutputs: {}, phases: [] };

test('firstStage: documentacion investiga primero, codigo planifica', () => {
  assert.equal(firstStage('documentation'), 'research');
  assert.equal(firstStage('coding'), 'plan');
  assert.equal(firstStage(undefined), 'plan');
});

test('validateDocOptions: exige formato valido y ruta relativa segura para editar', () => {
  assert.equal(validateDocOptions({ mode: 'new', format: 'md' }), null);
  assert.equal(validateDocOptions({ mode: 'new', format: 'pdf' }), 'formato no valido (md, html o docx)');
  assert.match(validateDocOptions({ mode: 'edit', format: 'md' }), /ruta relativa/);
  assert.match(validateDocOptions({ mode: 'fragments', format: 'html', targetPath: '/etc/x.html' }), /ruta relativa/);
  assert.match(validateDocOptions({ mode: 'edit', format: 'md', targetPath: '../fuera.md' }), /ruta relativa/);
  assert.equal(validateDocOptions({ mode: 'edit', format: 'md', targetPath: 'docs/guia.md' }), null);
  assert.match(validateDocOptions({ mode: 'new', format: 'md', template: '../plantilla.docx' }), /plantilla/);
  assert.match(validateDocOptions({ mode: 'weird', format: 'md' }), /modo/);
});

test('canRun: una tarea pendiente puede lanzar plan o investigacion', () => {
  assert.equal(canRun(base, 'plan'), null);
  assert.equal(canRun({ ...base, status: 'in_progress' }, 'plan'), 'la etapa solo puede lanzarse desde una tarea pendiente');
});

test('canRun: revision y commit solo cuando esta lista para revisar', () => {
  assert.equal(canRun({ ...base, status: 'ready_to_test' }, 'review'), null);
  assert.equal(canRun({ ...base, status: 'ready_to_test' }, 'commit'), null);
  assert.match(canRun(base, 'review'), /lista para revisar/);
});

test('canRun: responder exige pregunta de implementacion pendiente y texto no vacio', () => {
  const awaiting = { ...base, status: 'awaiting_input', pendingQuestion: { kind: 'implement-details', text: '?' } };
  assert.equal(canRun(awaiting, 'implement', { answer: 'usa la opcion B' }), null);
  assert.equal(canRun(awaiting, 'implement', { answer: '   ' }), 'la respuesta no puede estar vacia');
  assert.match(canRun(base, 'implement', { answer: 'hola' }), /no hay preguntas pendientes/);
});

test('canRun: redactar exige opciones de documento validas, o reintentar con las guardadas', () => {
  const awaiting = { ...base, status: 'awaiting_input', pendingQuestion: { kind: 'doc-options', text: '' } };
  assert.equal(canRun(awaiting, 'write', { docOptions: { mode: 'new', format: 'html' } }), null);
  assert.match(canRun(awaiting, 'write', { docOptions: { mode: 'edit', format: 'md' } }), /ruta relativa/);
  assert.equal(canRun({ ...base, status: 'pending', docOptions: { mode: 'new', format: 'md' } }, 'write'), null);
  assert.match(canRun(base, 'write', { docOptions: { mode: 'new', format: 'md' } }), /elegir antes/);
});

test('buildStagePrompt: implementacion incluye el plan y el aviso de bloqueo', () => {
  const task = { ...base, stageOutputs: { plan: 'PASO 1: crear el boton' } };
  const prompt = buildStagePrompt(task, 'implement');
  assert.match(prompt, /PASO 1: crear el boton/);
  assert.match(prompt, /blocked/);
  assert.match(prompt, /No hagas git commit/);
});

test('buildStagePrompt: redaccion en modo fragmentos no toca el documento existente', () => {
  const prompt = buildStagePrompt({ ...base, type: 'documentation' }, 'write', {
    docOptions: { mode: 'fragments', format: 'md', targetPath: 'docs/guia.md' }
  });
  assert.match(prompt, /NO modifiques docs\/guia\.md/);
});

test('buildStagePrompt: revision y commit prohiben modificar el repositorio', () => {
  assert.match(buildStagePrompt(base, 'review'), /No modifiques/);
  const commit = buildStagePrompt(base, 'commit');
  assert.match(commit, /No ejecutes git add, git commit/);
  assert.match(commit, /Co-Authored-By/);
});

test('decideAfterStage: plan encadena implementacion automaticamente', () => {
  const { patch, next } = decideAfterStage(base, 'plan', { text: 'plan final' });
  assert.equal(next, 'implement');
  assert.equal(patch.status, 'pending');
  assert.equal(patch.stageOutputs.plan, 'plan final');
});

test('decideAfterStage: plan sin texto no encadena y deja error', () => {
  const { patch, next } = decideAfterStage(base, 'plan', { text: '   ' });
  assert.equal(next, null);
  assert.equal(patch.status, 'pending');
  assert.match(patch.error, /no devolvio texto/);
});

test('decideAfterStage: implementacion bloqueada pasa a awaiting_input con la pregunta', () => {
  const { patch, next } = decideAfterStage(base, 'implement', { text: 'Necesito el color?', hasChanges: false, phaseStatus: 'blocked' });
  assert.equal(next, null);
  assert.equal(patch.status, 'awaiting_input');
  assert.deepEqual(patch.pendingQuestion, { kind: 'implement-details', text: 'Necesito el color?' });
});

test('decideAfterStage: implementacion con cambios queda lista para revisar', () => {
  const { patch } = decideAfterStage(base, 'implement', { text: 'hecho', hasChanges: true, phaseStatus: 'done' });
  assert.equal(patch.status, 'ready_to_test');
  assert.equal(patch.error, null);
});

test('decideAfterStage: implementacion sin cambios vuelve a pendiente con motivo', () => {
  const { patch } = decideAfterStage(base, 'implement', { text: 'nada', hasChanges: false });
  assert.equal(patch.status, 'pending');
  assert.match(patch.error, /no se detectaron cambios/);
});

test('decideAfterStage: investigacion pide opciones de documento al usuario', () => {
  const { patch, next } = decideAfterStage(base, 'research', { text: 'notas' });
  assert.equal(next, null);
  assert.equal(patch.status, 'awaiting_input');
  assert.equal(patch.pendingQuestion.kind, 'doc-options');
});

test('decideAfterStage: redaccion termina lista para revisar', () => {
  const { patch } = decideAfterStage(base, 'write', { text: 'documento', hasChanges: false });
  assert.equal(patch.status, 'ready_to_test');
});

test('decideAfterStage: revision y commit no sacan la tarea de lista para revisar, aunque fallen', () => {
  const ok = decideAfterStage(base, 'review', { text: 'sin hallazgos' });
  assert.equal(ok.patch.status, 'ready_to_test');
  const failed = decideAfterStage(base, 'commit', { text: '', isError: true });
  assert.equal(failed.patch.status, 'ready_to_test');
  assert.match(failed.patch.error, /error/);
});

test('decideAfterStage: error de una etapa deja la tarea pendiente para reintentar', () => {
  const { patch, next } = decideAfterStage(base, 'plan', { text: 'x', isError: true });
  assert.equal(next, null);
  assert.equal(patch.status, 'pending');
  assert.match(patch.error, /reintentar/);
});

test('canRun: responder vale para plan e investigacion si la pregunta es de esa etapa', () => {
  const planQ = { ...base, status: 'awaiting_input', pendingQuestion: { kind: 'plan-details', text: '?' } };
  assert.equal(canRun(planQ, 'plan', { answer: 'el color es azul' }), null);
  assert.match(canRun(planQ, 'implement', { answer: 'hola' }), /no hay preguntas pendientes/);
  const researchQ = { ...base, status: 'awaiting_input', pendingQuestion: { kind: 'research-details', text: '?' } };
  assert.equal(canRun(researchQ, 'research', { answer: 'el publico es interno' }), null);
  assert.match(canRun(researchQ, 'plan', { answer: 'x' }), /no hay preguntas pendientes/);
});

test('decideAfterStage: plan bloqueado pregunta al usuario y no encadena implementacion', () => {
  const { patch, next } = decideAfterStage(base, 'plan', { text: 'Que proveedor de pagos?', phaseStatus: 'blocked' });
  assert.equal(next, null);
  assert.equal(patch.status, 'awaiting_input');
  assert.deepEqual(patch.pendingQuestion, { kind: 'plan-details', text: 'Que proveedor de pagos?' });
});

test('decideAfterStage: investigacion bloqueada pregunta antes de pedir opciones de documento', () => {
  const { patch } = decideAfterStage(base, 'research', { text: 'Para quien es el manual?', phaseStatus: 'blocked' });
  assert.equal(patch.status, 'awaiting_input');
  assert.equal(patch.pendingQuestion.kind, 'research-details');
});

test('answerPrompt: cada etapa recibe la continuacion que le corresponde', () => {
  assert.match(answerPrompt('azul', 'plan'), /planificacion/);
  assert.match(answerPrompt('azul', 'research'), /investigacion/);
  assert.match(answerPrompt('azul', 'implement'), /implementacion/);
  assert.match(answerPrompt('azul', 'plan'), /Respuesta del usuario/);
});

test('buildStagePrompt: planificacion e investigacion pueden preguntar con fase blocked', () => {
  assert.match(buildStagePrompt(base, 'plan'), /"blocked"/);
  assert.match(buildStagePrompt({ ...base, type: 'documentation' }, 'research'), /"blocked"/);
});

test('stageTools: las etapas de lectura no pueden editar ni ejecutar npm', () => {
  const plan = stageTools('plan');
  assert.ok(plan.includes('Read'));
  assert.ok(!plan.includes('Edit') && !plan.includes('Write'));
  assert.ok(!plan.some((t) => t.startsWith('Bash(npm')));
});

test('stageTools: implementacion puede editar y usar Bash sin pedir permiso por comando', () => {
  const impl = stageTools('implement');
  assert.ok(impl.includes('Edit') && impl.includes('Write'));
  assert.ok(impl.includes('Bash'));
});

test('stageDisallowed: bloquea commits, pushes y acciones destructivas, tambien con git -c', () => {
  const deny = stageDisallowed();
  for (const rule of ['Bash(git commit*)', 'Bash(git push*)', 'Bash(git -c * commit*)', 'Bash(git reset --hard*)', 'Bash(rm *)']) {
    assert.ok(deny.includes(rule), `falta ${rule}`);
  }
});

test('stageTools: las etapas de lectura pueden consultar tokensave pero no editarlo', () => {
  const plan = stageTools('plan');
  assert.ok(plan.includes('mcp__tokensave__tokensave_context'));
  assert.ok(!plan.some((t) => t.startsWith('mcp__tokensave') && /str_replace|insert_at|replace_symbol|multi_str/.test(t)));
});

test('approvalRule: Bash se aprueba solo para el comando literal', () => {
  assert.equal(approvalRule('Bash', 'git ls-files src'), 'Bash(git ls-files src)');
  assert.equal(approvalRule('Bash', 'rm -rf *'), null);
  assert.equal(approvalRule('Bash', "node -e \"console.log('ok')\" 2>&1 | tail -1"), "Bash(node -e \"console.log('ok')\" 2>&1 | tail -1)");
  assert.equal(approvalRule('Bash', 'a\nb'), null);
  assert.equal(approvalRule('Bash', ''), null);
  assert.equal(approvalRule('Bash', undefined), null);
});

test('approvalRule: herramientas no Bash y MCP usan su nombre; nombres raros se rechazan', () => {
  assert.equal(approvalRule('WebSearch'), 'WebSearch');
  assert.equal(approvalRule('mcp__tokensave__tokensave_context'), 'mcp__tokensave__tokensave_context');
  assert.equal(approvalRule('Bash)(x'), null);
  assert.equal(approvalRule('../etc'), null);
});

test('stageTools: etapa desconocida no concede nada', () => {
  assert.deepEqual(stageTools('nope'), []);
});

test('buildStagePrompt: todas las etapas prohiben redirigir a /dev/null', () => {
  for (const stage of ['plan', 'implement', 'review', 'commit']) {
    assert.match(buildStagePrompt(base, stage), /2>&1/);
  }
});

test('ensureGitGuardHooks: los hooks de commit y push fallan siempre', () => {
  const dir = mkTmpDir('gitguard');
  try {
    const hooksDir = ensureGitGuardHooks(dir);
    for (const name of ['pre-commit', 'pre-push']) {
      const r = spawnSync('sh', [path.join(hooksDir, name)], { encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /los commits, merges y pushes los hace el usuario/);
    }
  } finally {
    rmTmpDir(dir);
  }
});
