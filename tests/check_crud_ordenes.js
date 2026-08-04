'use strict';
const assert = require('assert');
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const deleteBlock = html.match(/\/\* coi-delete-supabase:[\s\S]*?<\/script>/)?.[0] || '';
const deleteFunction = html.match(/async function eliminarOrdenEnSupabase\s*\([\s\S]*?async function recargarDatosDesdeSupabase/)?.[0] || '';
assert.strictEqual((html.match(/id="btnBorrarSeleccionadas"/g) || []).length, 1, 'El ID del botón debe ser único');
assert.ok(deleteBlock, 'No se encontró el bloque coi-delete-supabase');
assert.ok(deleteFunction, 'No se encontró el borrado remoto canónico');
assert.match(deleteBlock, /eliminarOrdenEnSupabase/);
assert.match(deleteFunction, /from\(SUPABASE_TABLE\)\.delete\(\)/);
assert.match(html, /const SUPABASE_TABLE\s*=\s*['"]coi_ordenes['"]/);
assert.match(deleteFunction, /await recargarDatosDesdeSupabase\(/);
assert.match(deleteBlock, /errores\.push[\s\S]*?(?:toastOrdenes|alert)\(/, 'Los errores Supabase deben mostrarse al usuario');
assert.match(deleteFunction, /await requireSupabaseWriteAccess\(\)/, 'El borrado debe exigir acceso de escritura');
assert.ok(!/localStorage\.clear\s*\(/.test(deleteBlock + deleteFunction));
assert.ok(!/crudOcDeleteModal|confirmDeletion|data-crud-confirm|data-crud-cancel/.test(html));
console.log('CRUD Órdenes: bloque coi-delete-supabase y borrado remoto administrador verificados.');
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
  /DELETE_ADMIN_EMAIL_V60\s*=\s*['"]admin@coiroca\.com['"]/,
  'Debe limitar el borrado al administrador autorizado'
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
  /from\(SUPABASE_TABLE\)\.delete\(\)\.eq\('id',\s*row\.id\)/,
  'El DELETE debe realizarse por UUID'
);

assert.match(
  canonicalBlock,
  /select\('id,nro_oc'\)\.eq\('id',\s*row\.id\)/,
  'Debe existir un SELECT posterior de verificación'
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
  'CRUD Órdenes V60: sesión admin, DELETE por UUID, verificación remota, modal ELIMINAR y limpieza posterior verificados.'
);
