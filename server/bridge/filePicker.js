'use strict';

const { execFile } = require('child_process');

// Abre el explorador nativo del sistema y devuelve la ruta absoluta elegida,
// o null si el usuario cancela. La app corre en la maquina del usuario, asi
// que el dialogo aparece donde esta el.
function pickFile({ prompt = 'Elige un fichero', platform = process.platform } = {}) {
  if (platform === 'darwin') {
    const script = `POSIX path of (choose file with prompt ${JSON.stringify(prompt)})`;
    return run('osascript', ['-e', script]);
  }
  if (platform === 'linux') {
    return run('zenity', ['--file-selection', `--title=${prompt}`])
      .catch((err) => {
        if (err.code !== 'ENOENT') throw err;
        return run('kdialog', ['--getopenfilename', '.']);
      })
      .catch((err) => {
        if (err.code === 'ENOENT') throw new Error('instala zenity o kdialog para elegir ficheros');
        throw err;
      });
  }
  return Promise.reject(new Error(`no hay explorador de ficheros para ${platform}`));
}

// Cancelar el dialogo termina el proceso con codigo distinto de 0 y sin salida:
// eso es "sin seleccion", no un error.
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8' }, (err, stdout) => {
      if (err) {
        if (err.code === 'ENOENT') return reject(err);
        return resolve(null);
      }
      const chosen = String(stdout).trim();
      resolve(chosen || null);
    });
  });
}

module.exports = { pickFile };
