'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

// Carpetas que nunca son "resultado de la etapa": dependencias, metadatos y
// el propio estado de optimia.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.optimia', '.claude', '.codegraph']);
const MAX_FILES = 500;
const MAX_PREVIEW_BYTES = 1_000_000;

// Ficheros tocados desde sinceMs dentro del worktree, incluidos los ignorados por
// git (p. ej. docs/ esta en .gitignore y no aparece en git status).
function listFilesModifiedSince(worktreeDir, sinceMs) {
  const out = [];
  const walk = (dir) => {
    if (out.length >= MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs);
      } else if (entry.isFile()) {
        const stat = fs.statSync(abs);
        if (stat.mtimeMs >= sinceMs) out.push(path.relative(worktreeDir, abs).split(path.sep).join('/'));
      }
    }
  };
  walk(worktreeDir);
  return out.sort();
}

// Devuelve la ruta absoluta solo si queda dentro del worktree. Nunca sale de el.
function resolveInside(worktreeDir, rel) {
  if (typeof rel !== 'string' || !rel.trim() || path.isAbsolute(rel)) return null;
  const abs = path.resolve(worktreeDir, rel);
  const root = path.resolve(worktreeDir) + path.sep;
  return abs.startsWith(root) && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

function docxText(abs) {
  const xml = execFileSync('unzip', ['-p', abs, 'word/document.xml'], { encoding: 'utf8', maxBuffer: MAX_PREVIEW_BYTES });
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Previsualizacion sin ejecutar nada del documento: texto plano para md/docx/txt,
// y html solo se muestra dentro de un iframe sin scripts en el cliente.
function readPreview(abs) {
  const ext = path.extname(abs).toLowerCase();
  if (fs.statSync(abs).size > MAX_PREVIEW_BYTES) return { kind: 'unsupported', reason: 'fichero demasiado grande para previsualizar' };
  if (['.md', '.txt', '.csv', '.json'].includes(ext)) return { kind: 'text', content: fs.readFileSync(abs, 'utf8') };
  if (['.html', '.htm'].includes(ext)) return { kind: 'html', content: fs.readFileSync(abs, 'utf8') };
  if (ext === '.docx') {
    try { return { kind: 'text', content: docxText(abs) }; }
    catch (err) { return { kind: 'unsupported', reason: `no se pudo leer el docx: ${err.message}` }; }
  }
  return { kind: 'unsupported', reason: 'no hay previsualizacion para este tipo de fichero' };
}

// Abre el fichero (o su carpeta) con la app por defecto del sistema.
function openWithSystem(abs, { reveal = false, platform = process.platform } = {}) {
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = reveal ? ['-R', abs] : [abs];
  } else if (platform === 'linux') {
    cmd = 'xdg-open';
    args = [reveal ? path.dirname(abs) : abs];
  } else {
    return Promise.reject(new Error(`no hay forma de abrir ficheros en ${platform}`));
  }
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => {
      if (err && err.code === 'ENOENT') return reject(new Error(`no se encontro ${cmd} en este sistema`));
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = { listFilesModifiedSince, resolveInside, readPreview, openWithSystem };
