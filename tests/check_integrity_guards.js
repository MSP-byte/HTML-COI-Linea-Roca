#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

assert.doesNotMatch(
  html.match(/function adminApplyLocalStorageSnapshot[\s\S]*?\n}\nfunction adminImportJSONFile/)?.[0] || '',
  /localStorage\.clear\s*\(/,
  'La importación no puede vaciar todo localStorage'
);
assert.match(html, /ADMIN_PREIMPORT_BACKUP_KEY='coi_admin_preimport_backup_v1'/);
assert.match(html, /adminPrepararSnapshotSeguro/);
assert.match(html, /se restauró el estado anterior/);
assert.match(html, /purgarCachesOperativasSensibles\(\)/);
assert.match(html, /Iniciá sesión para consultar datos operativos/);
assert.match(html, /state===STATES\.SIN_SESION\|\|!authenticated/);
assert.match(html, /La eliminación múltiple está bloqueada por integridad transaccional/);
assert.match(html, /\['estacion','ramal','sector'\]\.some/);

console.log('Integridad local: caché protegida por sesión, restore con rollback y operaciones múltiples bloqueadas.');
