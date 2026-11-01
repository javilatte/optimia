'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `optimia-${prefix}-`));
}

function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { mkTmpDir, rmTmpDir };
