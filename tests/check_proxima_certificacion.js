#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const updateBlock = html.match(
  /async function actualizarProximaCertificacionOrden\(nroOC\)\{[\s\S]*?\n  \}\n\n  async function refrescarModulosTrasCertificacion/
)?.[0] || '';
const saveBlock = html.match(
  /async function guardarCargaCertificaciones\(\)\{[\s\S]*?\n  \}\n\n  function csvValue/
)?.[0] || '';

assert.ok(updateBlock, 'No se encontró el flujo activo de próxima certificación');
assert.ok(saveBlock, 'No se encontró el guardado activo de certificaciones');

assert.match(
  updateBlock,
  /const payload=\{proxima_certificacion:target\}/,
  'La mutación debe limitarse a proxima_certificacion'
);
assert.match(
  updateBlock,
  /client\.rpc\('coi_actualizar_orden_integral',\{p_orden_id:order\.orden_id,p_cambios:payload\}\)/,
  'La próxima certificación debe actualizarse por la RPC allowlisted'
);
assert.doesNotMatch(
  updateBlock,
  /\.from\(ORDENES_TABLE\)\.update\(/,
  'El frontend no puede recuperar el UPDATE directo prohibido por la migración 006'
);
assert.match(updateBlock, /COI_NEXT_CERT_NOT_CONFIRMED/);
assert.match(updateBlock, /COI_NEXT_CERT_VERIFY_FAILED/);
assert.match(
  updateBlock,
  /\.from\(ORDENES_TABLE\)\.select\('id,nro_oc,proxima_certificacion'\)\.eq\('id',order\.orden_id\)\.limit\(1\)/,
  'La RPC debe verificarse con una lectura posterior de Supabase'
);
assert.doesNotMatch(updateBlock, /localStorage/, 'La mutación no puede persistirse sólo en localStorage');

assert.match(
  html,
  /function fechaProximaCertificacionPersistida\(item\)[\s\S]*?item\?\._supabaseRaw\?\.proxima_certificacion[\s\S]*?return raw \? parseFecha\(raw\) : null;/,
  'La lectura visual debe reconocer la fecha persistida por Supabase'
);
assert.match(
  html,
  /const prox=fechaProximaCertificacionPersistida\(item\) \|\| \(base \? addMeses\(base,1\) : null\);/,
  'La ficha debe priorizar la fecha persistida antes del cálculo legado'
);
assert.match(
  html,
  /const proximaCert=fechaProximaCertificacionPersistida\(item\) \|\| \(proximaBase \? addMeses\(proximaBase,1\) : null\);/,
  'Dashboard y filtros deben priorizar la fecha persistida antes del cálculo legado'
);
assert.match(
  html,
  /completed=Promise\.resolve\(r\)\.finally\(\(\)=>after\(\.\.\.args\)\);return r&&typeof r\.then==='function'\?completed:r/,
  'La recarga async debe esperar la reconciliación de metadatos antes de confirmar el refresco visual'
);
assert.match(
  html,
  /station\[collection\]\.push\([\s\S]*?window\.todasLasOC\?\.invalidarCache\?\.\(\);[\s\S]*?refreshCOIViews\(\)/,
  'Reemplazar la cartera desde Supabase debe invalidar las filas visuales memoizadas'
);
assert.match(
  html,
  /function mergeRows\(rows\)[^\n]*window\.todasLasOC\?\.invalidarCache\?\.\(\)/,
  'La reconciliación ejecutiva no puede dejar una vista memoizada anterior'
);

assert.match(saveBlock, /erroresFechaOC/);
assert.match(saveBlock, /próxima fecha NO actualizada/);
assert.match(saveBlock, /errors\.length\?'warning':'ok'/);
assert.match(saveBlock, /actualizarVisibilidadCargaCertificacion\(\{revalidar:false\}\)/);
assert.match(
  html,
  /window\.actualizarProximaCertificacionOrden=actualizarProximaCertificacionOrden/,
  'El flujo focalizado debe estar disponible para regresión de navegador'
);

console.log('Próxima certificación: RPC puntual, verificación remota y fallo visible sin autoridad local.');
