'use strict';

const fs = require('fs');
const path = require('path');

function memoryPath(projectRoot) {
  return path.join(projectRoot, '.optimia', 'memory.md');
}

function loadMemory(projectRoot) {
  const file = memoryPath(projectRoot);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function saveMemory(projectRoot, content) {
  const dir = path.join(projectRoot, '.optimia');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(memoryPath(projectRoot), content);
}

module.exports = { memoryPath, loadMemory, saveMemory };
