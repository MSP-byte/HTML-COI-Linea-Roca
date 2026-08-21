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
assert.match(html, /client\.rpc\('coi_actualizar_orden_integral'/);
assert.match(html, /client\.rpc\('coi_guardar_orden_integral'/);
assert.match(html, /client\.rpc\('coi_guardar_estacion_asociada'/);
assert.match(html, /client\.rpc\('coi_eliminar_orden_integral'/);
assert.match(html, /\.rpc\('coi_confirmar_etapa_circuito_v2'/);
assert.doesNotMatch(html, /\.rpc\('coi_guardar_link_documental'/);
assert.doesNotMatch(html, /\.rpc\('coi_eliminar_link_documental'/);
assert.doesNotMatch(html, /@supabase\/supabase-js@2(?:['"/])/,'supabase-js debe quedar fijado a una versión exacta');
assert.match(html, /@supabase\/supabase-js@2\.112\.2/);
assert.match(html, /function coiURLHTTPValida\(value\)/);
assert.doesNotMatch(html, /if\(link\)window\.open\(link,'_blank'\)/);
assert.doesNotMatch(html, /data-exec-link-add|execBtnPyc|function\s+markPyC/);
const csvFunction = html.match(/function coiCSVCell\(value\)\{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(csvFunction, 'Debe existir el serializador CSV seguro');
const csvCell = Function(`${csvFunction}; return coiCSVCell;`)();
assert.equal(csvCell('=1+1'), '"\'=1+1"');
assert.equal(csvCell('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
assert.equal(csvCell(-5), '"-5"');
assert.doesNotMatch(html.replace(csvFunction, ''), /replace\(\/"\/g,'""'\)/, 'Las exportaciones deben usar coiCSVCell');

console.log('Integridad local: caché protegida, restore con rollback, mutaciones críticas por RPC y link contractual legacy retirado del frontend.');
