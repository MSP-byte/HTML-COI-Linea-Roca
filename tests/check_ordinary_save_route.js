'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n?/g, '\n');

assert.match(
  html,
  /window\.activarModoEdicionOC\(currentOCKeyFromGlobals\(\)\);/,
  'El botón histórico Editar OC debe delegar dinámicamente al editor RC2 expuesto en window.'
);

assert.doesNotMatch(
  html,
  /\n\s{6}activarModoEdicionOC\(currentOCKeyFromGlobals\(\)\);/,
  'El handler histórico no debe invocar su closure R12 y eludir el editor RC2.'
);

assert.match(
  html,
  /window\.activarModoEdicionOC=openEditor;/,
  'El editor transaccional RC2 debe seguir siendo la autoridad pública para edición de OC.'
);

assert.match(
  html,
  /rpc\('coi_actualizar_orden_integral',\{p_orden_id:ordenId,p_cambios:patch\}\)/,
  'El editor RC2 debe persistir cambios mediante patch transaccional.'
);

assert.match(
  html,
  /\['Gestión COI',\['estado_coi','estado_registro','observaciones'/,
  'Observaciones generales deben permanecer vinculadas a public.coi_ordenes.observaciones.'
);

assert.match(
  html,
  /\['Cierre',\['fecha_cierre_operativo','observacion_cierre'\]\]/,
  'Observación de cierre debe permanecer separada de Observaciones generales.'
);

console.log('Edición ordinaria RC2: botón histórico delega al editor transaccional y campos de observación quedan separados.');
