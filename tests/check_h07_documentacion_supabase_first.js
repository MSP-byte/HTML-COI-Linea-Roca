#!/usr/bin/env node
'use strict';

/*
  H07 — cierre Supabase-first.

  Control reproducible sin navegador. COMPLEMENTA a
  tests/h07_documentacion_supabase_first.spec.js; no lo reemplaza.

  Verifica lo que un test funcional no puede garantizar barato:
    1) la migracion de coi_documentacion_oc existe, respeta las convenciones del
       proyecto y esta declarada como divergencia pendiente de rollout;
    2) la capa documental no puede volver a leer ni escribir la clave legada;
    3) las tres caches operativas de H06 dejaron de recibir escrituras;
    4) el legado de observaciones ya no se publica como modelo operativo.

  No toca STAGING ni PRODUCCION.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n?/g, '\n');
const migracion = fs.readFileSync('supabase/migrations/202609040001_h07_documentacion_oc.sql', 'utf8');
const contrato = require('./fixtures/production_schema_contract.json');

let aprobados = 0;
const check = (ok, detalle) => {
  if (!ok) throw new assert.AssertionError({ message: detalle });
  aprobados++;
};

const bloque = (id) => {
  const abre = `<script id="${id}">`;
  const i = html.indexOf(abre);
  check(i >= 0, `falta el bloque ${id}`);
  const j = html.indexOf('</' + 'script>', i);
  check(j > i, `el bloque ${id} no cierra`);
  return html.slice(i, j);
};
const sinComentarios = (t) => t.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');

// ==================================================== 1) migracion H07
check(/create table if not exists public\.coi_documentacion_oc/i.test(migracion),
  'la migracion tiene que crear public.coi_documentacion_oc');
check(/orden_id uuid not null/i.test(migracion),
  'la identidad tecnica de la OC tiene que ser un uuid obligatorio');
check(/references public\.coi_ordenes\(id\) on delete restrict/i.test(migracion),
  'la FK contra coi_ordenes tiene que ser ON DELETE RESTRICT: borrar una OC no puede llevarse su historial documental');
// Solo se mira el cuerpo del create table: los comentarios explican por que NO
// se denormaliza, y nombrar el campo ahi no es declararlo.
const cuerpoTabla = (/create table if not exists public\.coi_documentacion_oc[\s\S]*?\n\);/i.exec(migracion) || [''])[0];
check(!/\bnro_oc\b/.test(cuerpoTabla),
  'la tabla NO debe denormalizar nro_oc: el numero vigente lo resuelve el cliente');
// Los 17 campos de negocio que la V64 usa realmente.
for (const columna of [
  'id_obra', 'id_servicio', 'tipo_registro', 'tipo_documento', 'nro_documento',
  'nombre_archivo', 'extension_archivo', 'repositorio', 'ruta_documental',
  'link_documento', 'link_carpeta', 'fecha_documento', 'periodo', 'acta_nro',
  'estado_documento', 'observaciones'
]) {
  check(new RegExp('\\n  ' + columna + ' ').test(migracion),
    `la tabla tiene que conservar el campo real ${columna} del modulo V64`);
}
check(/fecha_creacion timestamptz/i.test(migracion) && /fecha_actualizacion timestamptz/i.test(migracion),
  'la tabla tiene que llevar los timestamps del proyecto');
// RLS con el modelo de roles YA EXISTENTE, no uno nuevo.
check(/alter table public\.coi_documentacion_oc enable row level security/i.test(migracion),
  'la tabla tiene que tener RLS habilitada');
for (const cmd of ['select', 'insert', 'update', 'delete']) {
  check(new RegExp('for ' + cmd + ' to authenticated', 'i').test(migracion),
    `falta la policy RESTRICTIVE de ${cmd.toUpperCase()}`);
}
check((migracion.match(/as restrictive/gi) || []).length === 4,
  'las cuatro policies de guarda tienen que ser RESTRICTIVE, como en H04/H05');
check(/public\.coi_current_role\(\)/.test(migracion),
  'la autorizacion tiene que usar coi_current_role(), el modelo de roles existente');
check(!/create (or replace )?function public\.coi_[a-z_]*rol/i.test(migracion),
  'H07 no puede inventar un sistema de permisos nuevo');
check(/execute function public\.coi_version_servidor\(\)/i.test(migracion),
  'la version de fila tiene que reutilizar el guard server-side existente');
check(/revoke all on table public\.coi_documentacion_oc from anon/i.test(migracion),
  'anon no puede conservar ningun grant sobre la tabla');
check(/create index if not exists coi_documentacion_oc_orden_id_idx/i.test(migracion),
  'falta el indice por orden_id, que es como se lee operativamente');
check(/if not exists/i.test(migracion) && /drop policy if exists/i.test(migracion),
  'la migracion tiene que ser idempotente');

// La divergencia esta declarada y NO se afirma que produccion ya la tenga.
const divergencias = contrato._divergencias_pendientes || {};
const tablas = divergencias.tablas || [];
const entrada = tablas.find((t) => t.tabla === 'coi_documentacion_oc');
check(Boolean(entrada), 'la tabla H07 tiene que estar declarada como divergencia pendiente');
check(entrada.produccion === 'ausente' && entrada.repo === 'presente',
  'la divergencia tiene que decir la verdad: repo presente, produccion ausente');
check(entrada.migracion === '202609040001_h07_documentacion_oc.sql',
  'la divergencia tiene que citar la migracion H07');
check(!Object.prototype.hasOwnProperty.call(contrato, 'coi_documentacion_oc'),
  'el snapshot productivo NO puede declarar una tabla que produccion todavia no tiene');

// ==================================================== 2) capa documental
const capa = bloque('coi-h07-documentacion-supabase-first');
const codigo = sinComentarios(capa);

check(codigo.indexOf("const TABLA = 'coi_documentacion_oc'") >= 0,
  'la capa tiene que leer y escribir contra la tabla remota');
// La clave legada solo puede tocarse por el camino de cuarentena.
check(!/localStorage\.setItem\(\s*LEGACY_KEY/.test(codigo),
  'la capa documental no puede volver a escribir la clave legada');
check(!/saveJSON\(\s*LS_DOCUMENTACION_OC_V64/.test(codigo),
  'la capa documental no puede persistir documentacion en localStorage');
check(codigo.indexOf('window.v64CargarDocumentacionOC = function () { return copiar(lista()); };') >= 0,
  'la lectura de la V64 tiene que salir del snapshot confirmado, no de localStorage');
check(/window\.v64MigrarDocsEmbebidos = function \(\) \{ return false; \}/.test(codigo),
  'la autoimportacion de documentos embebidos tiene que quedar desactivada');
// Degradacion: nunca localStorage.
const conservar = codigo.slice(codigo.indexOf('const conservar = (motivo, origen)'), codigo.indexOf('if (!c) return conservar'));
check(conservar.indexOf('publicar(lista())') >= 0,
  'ante un fallo solo puede sobrevivir el snapshot confirmado de la sesion');
check(!/localStorage/.test(conservar),
  'la degradacion documental no puede leer localStorage');
// Identidad antes de adoptar.
const invalidar = codigo.slice(codigo.indexOf('function invalidarPorIdentidad('), codigo.indexOf('async function leerPaginado'));
check(invalidar.indexOf('if (nuevo === (runtime.authUserId || null)) return false;') >= 0,
  'un TOKEN_REFRESHED del mismo UID no puede contar como cambio de identidad');
check(invalidar.indexOf('runtime.confirmado = null;') < invalidar.indexOf('runtime.authUserId = nuevo;'),
  'el snapshot tiene que invalidarse ANTES de adoptar el UID nuevo');
check(invalidar.indexOf('crudasConfirmadas = null;') >= 0,
  'las filas crudas del remapeo tambien caen: si no, un timer republica la sesion anterior');
// Tabla ausente: falla claro, no cae a local.
check(codigo.indexOf('function esTablaAusente(error)') >= 0,
  'la capa tiene que distinguir el caso «la tabla todavia no existe»');
check(codigo.indexOf("'tabla-ausente'") >= 0,
  'la tabla ausente tiene que ser un estado propio y visible');
// Legado: cuarentena, ni autoimportacion ni borrado.
check(codigo.indexOf('__COI_DOC_H07_LEGACY__') >= 0,
  'el legado documental tiene que quedar accesible como material de recuperacion');
check(/if \(!\(opciones && opciones\.confirmado === true\)\)/.test(codigo),
  'la importacion del legado documental tiene que ser EXPLICITA');
check(!/localStorage\.removeItem\(\s*LEGACY_KEY/.test(codigo),
  'H07 no puede borrar la clave legada documental');

// ==================================================== 3) caches retiradas
check(html.indexOf('function purgarCacheOrdenesRetirada()') >= 0,
  'la cache de ordenes tiene que quedar retirada explicitamente');
check(html.indexOf('function cacheSupabaseOrders(') < 0,
  'no puede quedar el escritor de la cache de ordenes');
check(/function saveRemoteCache\(\)\{try\{localStorage\.removeItem\(CACHE_KEY\)/.test(html),
  'la cache financiera tiene que dejar de escribirse');
check(html.indexOf("const TIMELINE_SYNC_PING_KEY='coi_timeline_sync_ping_v1';") >= 0,
  'el Timeline tiene que sincronizar entre pestañas con una señal sin contenido operativo');
const applyTimeline = html.slice(html.indexOf('function applyTimelineEvents('), html.indexOf('function setTimelinePersistence('));
check(applyTimeline.indexOf('localStorage.removeItem(TIMELINE_STORAGE_KEY)') >= 0,
  'el Timeline tiene que retirar su cache de eventos');
check(!/localStorage\.setItem\(TIMELINE_STORAGE_KEY/.test(applyTimeline),
  'el Timeline no puede seguir escribiendo los eventos en localStorage');

// ==================================================== 4) observaciones H03
check(html.indexOf("'legacy-readonly'") < 0,
  'el legado de observaciones ya no puede publicarse como origen operativo');
check(html.indexOf('function legadoEnCuarentena()') >= 0,
  'las observaciones legadas tienen que quedar en cuarentena');
check(html.indexOf('__COI_OBS_H07_CUARENTENA__') >= 0,
  'la cuarentena de observaciones tiene que ser inspeccionable y exportable');
const cutover = html.slice(html.indexOf('function cutoverPendiente()'), html.indexOf('function avisoCutover()'));
check(cutover.indexOf('registrarCuarentena() > 0') >= 0,
  'la proteccion de KI-007 tiene que seguir bloqueando escrituras mientras haya legado');
check(!/localStorage\.removeItem\(\s*LEGACY_KEY\s*\)/.test(
  html.slice(html.indexOf('function legadoEnCuarentena()'), html.indexOf('function registrarCuarentena()'))),
  'H07 no puede borrar las observaciones legadas');

console.log('H07 cierre Supabase-first: capa verificada.');
console.log('  Migracion   : coi_documentacion_oc con orden_id UUID, RESTRICT, RLS por coi_current_role()');
console.log('  Divergencia : declarada como PENDIENTE de rollout, sin falsear el snapshot productivo');
console.log('  Documentacion: autoridad remota; el legado queda en cuarentena, sin autoimportar ni borrar');
console.log('  Caches H06  : ordenes, finanzas y timeline dejaron de escribirse');
console.log('  Observaciones: el legado sale del modelo operativo y conserva el bloqueo de KI-007');
console.log(`${aprobados} controles H07 aprobados; 0 fallidos.`);
