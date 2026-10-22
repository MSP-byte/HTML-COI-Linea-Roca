'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, '__coi_security_html_gate_fixture__.html');
const checker = path.join(__dirname, 'security_surface_report.js');

// Control negativo obligatorio: si se publica otra entrada HTML ejecutable
// en la raíz, el escáner de la CI tiene que fallar (no sólo advertir).
assert.equal(fs.existsSync(file), false, 'El fixture del test no debe preexistir');

try {
  fs.writeFileSync(file, '<!doctype html><title>Security gate fixture</title>\n', { flag: 'wx' });
  const run = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 512 * 1024
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 1, 'El escáner debe rechazar un HTML raíz adicional');
  assert.match(run.stdout, /UNSUPPORTED_PUBLISHED_HTML_ENTRYPOINT/, 'Debe identificar el hallazgo de publicación');
  assert.match(run.stdout, /__coi_security_html_gate_fixture__\.html/, 'Debe indicar el nombre del HTML inseguro');
} finally {
  fs.rmSync(file, { force: true });
}

const positive = spawnSync(process.execPath, [checker], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30000,
  maxBuffer: 512 * 1024
});
if (positive.error) throw positive.error;
assert.equal(positive.status, 0, 'Sin duplicados, el escáner debe terminar correctamente');

console.log('Security publication gate: positive + negative controls PASS');
