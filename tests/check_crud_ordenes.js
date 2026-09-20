
'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');

const canonicalBlock =
  html.match(
    /\/\* coi-delete-v60-canonical:[\s\S]*?async function recargarDatosDesdeSupabase/
  )?.[0] || '';

assert.strictEqual(
  (html.match(/id="btnBorrarSeleccionadas"/g) || []).length,
  1,
  'El ID del botón Borrar seleccionadas debe ser único'
);

assert.ok(
  canonicalBlock,
  'No se encontró el bloque canónico coi-delete-v60-canonical'
);

assert.match(
  canonicalBlock,
  /async function deleteRequireAdminV60\s*\(/,
  'Debe existir la validación administrativa V60'
);

assert.match(
  canonicalBlock,
  /auth\.getSession\(\)/,
  'El borrado debe exigir una sesión Supabase real'
);

assert.match(
  canonicalBlock,
  /from\('profiles'\)\.select\('rol,activo'\)/,
  'Debe validar el rol administrador activo contra profiles'
);

assert.match(
  canonicalBlock,
  /navigator\.onLine\s*===\s*false/,
  'Debe bloquear el borrado sin conexión'
);

assert.match(
  canonicalBlock,
  /async function deleteRemoteRowV60\s*\(/,
  'Debe existir el DELETE remoto V60'
);

assert.match(
  canonicalBlock,
  /client\.rpc\('coi_eliminar_orden_integral',\s*\{\s*p_orden_id:\s*row\.id\s*\}\)/,
  'El DELETE debe delegarse a la RPC transaccional por UUID'
);

assert.doesNotMatch(
  canonicalBlock,
  /from\(SUPABASE_TABLE\)\.delete\(/,
  'El navegador no debe ejecutar DELETE directo sobre la OC'
);

assert.match(
  canonicalBlock,
  /coiDeleteModalV60/,
  'Debe existir el modal propio de confirmación'
);

assert.match(
  canonicalBlock,
  /trim\(\)\.toUpperCase\(\)\s*!==\s*'ELIMINAR'/,
  'La confirmación debe exigir escribir ELIMINAR'
);

assert.match(
  canonicalBlock,
  /deletePurgeConfirmedV60\s*\(/,
  'La limpieza local debe ocurrir después del éxito remoto'
);

assert.match(
  canonicalBlock,
  /await deleteRefreshAfterSuccessV60\s*\(/,
  'Debe refrescar la aplicación después del borrado'
);

assert.match(
  html,
  /window\.eliminarOrdenesPersistentesV60\s*=\s*eliminarOrdenesPersistentesV60/,
  'La API pública V60 debe quedar expuesta'
);

assert.ok(
  !/\/\* coi-delete-supabase:/.test(html),
  'El hotfix viejo coi-delete-supabase ya no debe existir'
);

assert.ok(
  !/function borrarOrdenesSeleccionadasR4\s*\(/.test(html),
  'El borrado local R4 no debe seguir activo'
);

assert.ok(
  !/localStorage\.clear\s*\(/.test(canonicalBlock),
  'El flujo V60 no debe vaciar todo localStorage'
);

console.log(
  'CRUD Órdenes V60: sesión, perfil admin, RPC atómica, modal ELIMINAR y limpieza posterior verificados.'
);
