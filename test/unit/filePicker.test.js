'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickFile } = require('../../server/bridge/filePicker');

test('pickFile: plataformas sin explorador soportado fallan con un mensaje claro', async () => {
  await assert.rejects(pickFile({ platform: 'win32' }), /no hay explorador de ficheros para win32/);
});
