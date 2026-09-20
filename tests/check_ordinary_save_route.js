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
  /\['Gestión COI',\['estado_coi','observaciones'/,
  'Observaciones generales deben permanecer vinculadas a public.coi_ordenes.observaciones.'
);

assert.doesNotMatch(
  html,
  /\['Gestión COI',\[[^\]]*'estado_registro'/,
  'H10: estado_registro no puede exponerse en la edición ordinaria; Archivar tiene su transición controlada.'
);

assert.doesNotMatch(
  html,
  /\['Cierre',\['fecha_cierre_operativo','observacion_cierre'\]\]/,
  'H10: la auditoría del primer cierre no puede renderizarse como campos editables ordinarios.'
);

assert.match(
  html,
  /EDITOR_BLOCKED=new Set\(\['estado_registro','fecha_cierre_operativo','observacion_cierre'\]\)/,
  'H10: archivo y auditoría de cierre deben quedar fuera del payload del editor ordinario.'
);

console.log('Edición ordinaria RC2: observaciones generales editables; archivo y auditoría de cierre protegidos por H10.');
