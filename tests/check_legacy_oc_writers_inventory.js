'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const expectedNames = ['updateOrder', 'actualizarCalidadOrdenSupabase'];

// Inventario de escritoras legacy: no se permite añadir nuevas mutaciones de
// coi_ordenes desde PostgREST mientras se migra a RPC. Un legacy existente
// puede migrarse y desaparecer de esta lista sin bloquear el test.
assert.match(html, /const T_ORDENES='coi_ordenes'/, 'El alias auditado debe seguir apuntando a coi_ordenes');
const directWrites = [...html.matchAll(
  /\.from\(\s*(?:T_ORDENES|['"`"]coi_ordenes['"`"])\s*\)\s*\.\s*(?:update|insert|delete|upsert)\s*\(/g
)];
const contexts = directWrites.map(m => {
  const left = html.slice(Math.max(0, m.index - 900), m.index);
  const candidates = [...left.matchAll(/async function (\w+)\s*\(/g)];
  return { name: candidates.at(-1)?.[1] || '(desconocida)', index: m.index };
});
const unexpected = contexts.filter(x => !expectedNames.includes(x.name));
assert.deepEqual(unexpected, [], 'Se detectó una nueva escritura directa sobre coi_ordenes; usar RPC');

assert.ok(contexts.length <= expectedNames.length, 'La cantidad de writers legacy no debe aumentar');
for (const name of new Set(contexts.map(x => x.name))) {
  assert.ok(expectedNames.includes(name), 'Writer directo no inventariado: ' + name);
}

assert.match(html, /\.rpc\('coi_actualizar_orden_integral'/,
  'La aplicación debe conservar la RPC canónica de actualización OC');
assert.match(html, /\.rpc\('coi_guardar_orden_integral'/,
  'La aplicación debe conservar la RPC de guardado integral de OC');

console.log('COI V3: direct OC writers inventariados y nuevas escrituras directas bloqueadas: PASS', contexts.map(x=>x.name));
