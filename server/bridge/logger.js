'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;
let logFile = null;

// Un evento por línea en .optimia/logs/optimia.log. No guardar texto de mensajes,
// instrucciones ni contenido de ficheros: solo ids, estados y tamaños.
function initLogger(projectRoot) {
  const dir = path.join(projectRoot, '.optimia', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'optimia.log');
}

function rotateIfNeeded() {
  try {
    if (fs.statSync(logFile).size < MAX_BYTES) return;
    fs.renameSync(logFile, `${logFile}.1`);
  } catch { /* aún no existe o no se puede rotar: seguimos escribiendo */ }
}

function log(level, event, data = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (logFile) {
    try {
      rotateIfNeeded();
      fs.appendFileSync(logFile, line + '\n');
    } catch { /* disco lleno o permisos: el registro nunca tumba el servidor */ }
  }
  if (level === 'warn' || level === 'error') process.stderr.write(line + '\n');
}

// Entradas más recientes primero, leyendo el fichero actual y, si hace falta, el rotado.
function readRecent(limit = 200) {
  if (!logFile) return [];
  const lines = [];
  for (const file of [`${logFile}.1`, logFile]) {
    try {
      lines.push(...fs.readFileSync(file, 'utf8').split('\n').filter(Boolean));
    } catch { /* aún no existe */ }
  }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { out.push(JSON.parse(lines[i])); } catch { /* línea corrupta: se omite */ }
  }
  return out;
}

module.exports = {
  initLogger,
  readRecent,
  log,
  info: (event, data) => log('info', event, data),
  warn: (event, data) => log('warn', event, data),
  error: (event, data) => log('error', event, data),
};
