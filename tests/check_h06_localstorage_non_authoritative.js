#!/usr/bin/env node
'use strict';

/*
  H06 — localStorage deja de ser AUTORIDAD operacional.

  Control reproducible sin navegador. Fija lo que un test funcional no puede
  garantizar barato: que NINGUNA de las tres capas Supabase-first vuelva a
  promover una clave de localStorage a verdad operativa cuando el remoto falla,
  y que las tres invaliden el contexto del operador anterior ANTES de adoptar
  una identidad nueva.

  Las claves legadas NO se borran: H06 les quita autoridad, no las destruye.

  No toca STAGING ni PRODUCCION.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n?/g, '\n');

let aprobados = 0;
const check = (ok, detalle) => {
  if (!ok) throw new assert.AssertionError({ message: detalle });
  aprobados++;
};

// Cuerpo de una funcion declarada, cortando en el cierre de su indentacion.
function cuerpo(firma, etiqueta, cierre = '\n  }\n') {
  const i = html.indexOf(firma);
  check(i >= 0, `no se encontro ${etiqueta}`);
  const j = html.indexOf(cierre, i);
  check(j > i, `no se pudo delimitar ${etiqueta}`);
  return html.slice(i, j + cierre.length);
}
const sinComentarios = (t) => t.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');

// ============================================ 1) ORDENES · coi_ordenes
// El fallback leia coi_supabase_ordenes_cache_v2 y lo publicaba como listado
// operativo de OC. Ahora solo puede sobrevivir el snapshot confirmado en
// memoria por ESTA sesion.
const degradar = sinComentarios(cuerpo(
  '  function degradarSinAutoridadLocal(reason = ',
  'degradarSinAutoridadLocal() de la capa de Ordenes'));
check(degradar.indexOf('ordenesConfirmadas') >= 0,
  'la degradacion de Ordenes tiene que apoyarse en el snapshot confirmado en memoria');
check(!/readSupabaseCache|SUPABASE_CACHE_KEY|localStorage/.test(degradar),
  'la degradacion de Ordenes no puede volver a leer localStorage');
check(html.indexOf('function readSupabaseCache(') < 0,
  'no puede quedar un lector de la cache de Ordenes: era la via de autoridad local');
// El snapshot confirmado solo lo fija una lectura remota exitosa.
check(/cacheSupabaseOrders\(normalized\);\n    ordenesConfirmadas = normalized;/.test(html),
  'solo una lectura remota confirmada puede fijar el snapshot de Ordenes');
// Y sin sesion no sobrevive.
const vaciarSinSesion = sinComentarios(cuerpo(
  '  function vaciarDatosOperativosSinSesion() {', 'vaciarDatosOperativosSinSesion()'));
check(vaciarSinSesion.indexOf('ordenesConfirmadas = null;') >= 0,
  'sin sesion el snapshot confirmado de Ordenes tiene que caer');

// Cambio de identidad: invalidacion ANTES de adoptar el UID nuevo.
const invalidarOrdenes = sinComentarios(cuerpo(
  '  function invalidarOperacionalPorIdentidad(uidNuevo) {',
  'invalidarOperacionalPorIdentidad() de la capa de Ordenes'));
check(invalidarOrdenes.indexOf("if (nuevo === (ordenesConfirmadasUid || null)) return false;") >= 0,
  'un TOKEN_REFRESHED del mismo UID no puede contar como cambio de identidad');
for (const linea of ['ordenesConfirmadas = null;', 'SENSITIVE_OPERATIONAL_CACHE_KEYS', "aplicarOrdenesPrincipal([], 'Supabase');"]) {
  check(invalidarOrdenes.indexOf(linea) >= 0,
    `la invalidacion por identidad de Ordenes tiene que incluir ${linea}`);
}
// El listener de auth y la carga principal la invocan.
check(html.indexOf('invalidarOperacionalPorIdentidad(session.user.id);') >= 0,
  'el listener de auth tiene que invalidar por identidad antes de recargar');
check(html.indexOf('invalidarOperacionalPorIdentidad(user && user.id);') >= 0,
  'cargarOrdenesPrincipal tiene que comparar la identidad antes de leer');

// ============================================ 2) FINANZAS · coi_posiciones_oc
const applyCache = sinComentarios(cuerpo(
  '  function applyCacheState(state,error=null){', 'applyCacheState() de la capa financiera'));
check(applyCache.indexOf('confirmadasFin') >= 0,
  'la degradacion financiera tiene que apoyarse en el snapshot confirmado en memoria');
check(applyCache.indexOf('readCache()') < 0,
  'la degradacion financiera no puede volver a publicar la cache de localStorage');
check(html.indexOf('function confirmarMemoria(') >= 0,
  'debe existir un unico punto que confirme la memoria financiera desde el remoto');
check(/saveRemoteCache\(remote,confirmed\);const merged=confirmarMemoria\(remote,confirmed\);/.test(html),
  'solo la lectura remota exitosa puede confirmar la memoria financiera');
check(html.indexOf('invalidarFinPorIdentidad(session.user.id);') >= 0,
  'el evento de auth financiero tiene que invalidar por identidad antes de reconectar');

// ============================================ 3) TIMELINE / MAILING
const timelineCatch = html.slice(
  html.indexOf('        timelineAuthoritativeReady=false;\n        setTimelinePermissions('),
  html.indexOf('    })();\n    timelineLoadPromise=currentLoad;'));
check(timelineCatch.length > 0, 'no se pudo delimitar la degradacion del Timeline');
check(timelineCatch.indexOf('timelineConfirmados') >= 0,
  'la degradacion del Timeline tiene que apoyarse en la ultima lectura confirmada');
check(timelineCatch.indexOf('readTimelineCache()') < 0,
  'la degradacion del Timeline no puede publicar la cache local como Mailing operativo');
check(html.indexOf('timelineConfirmados=remote;') >= 0,
  'solo la lectura remota confirmada puede fijar el conjunto del Timeline');

// El modulo no tenia listener de identidad: timelineAuthGeneration se declaraba
// y nunca se incrementaba, de modo que un cambio de operador dejaba en pantalla
// los mailings del anterior.
check(html.indexOf('function instalarListenerIdentidad(){') >= 0,
  'el Timeline tiene que escuchar los cambios de identidad');
const invalidarTimeline = sinComentarios(cuerpo(
  '  function invalidarTimelinePorIdentidad(uidNuevo){', 'invalidarTimelinePorIdentidad()'));
check(invalidarTimeline.indexOf('if(nuevo===(timelineConfirmadosUid||null))return false;') >= 0,
  'un TOKEN_REFRESHED del mismo UID no puede invalidar el Timeline');
check(invalidarTimeline.indexOf('timelineAuthGeneration++;') >= 0,
  'el cambio de identidad tiene que descartar las lecturas del Timeline en vuelo');
check(invalidarTimeline.indexOf('timelineConfirmados=null;') >= 0,
  'el cambio de identidad tiene que soltar el conjunto confirmado del Timeline');
// El arranque no es un cambio de identidad: borrar ahi destruiria la migracion
// legada de una sola vez antes de que llegue a Supabase.
check(invalidarTimeline.indexOf('if(timelineConfirmadosUid===null&&timelineConfirmados===null){') >= 0,
  'la primera identidad de la pestaña no puede tratarse como cambio de identidad');

// ============================================ 4) H06 no destruye el legado
check(!/localStorage\.clear\(\)/.test(
  html.slice(html.indexOf('function degradarSinAutoridadLocal'), html.length)),
  'H06 no puede introducir un localStorage.clear()');
// Las claves legadas de UM/ST y el maestro siguen nombradas: se conservan.
for (const clave of [
  'roca_coi_intervenciones_v10', 'coi_linea_roca_master_v18',
  'coi_roca_unidades_mantenimiento', 'coi_observaciones_oc'
]) {
  check(html.indexOf(clave) >= 0, `la clave legada ${clave} no puede desaparecer: H06 no borra`);
}

// ============================================ 5) preferencias intactas
for (const clave of ['coi_v2_theme', 'coi_v2_sidebar_collapsed', 'coi_dashboard_filters_v33']) {
  check(html.indexOf(clave) >= 0, `la preferencia de interfaz ${clave} tiene que seguir funcionando`);
}

console.log('H06 localStorage no autoritativo: capa verificada.');
console.log('  Ordenes   : la degradacion usa el snapshot confirmado, no la cache local');
console.log('  Finanzas  : la degradacion usa el snapshot confirmado, no la cache local');
console.log('  Timeline  : la degradacion usa la ultima lectura confirmada; ya escucha auth');
console.log('  Identidad : las tres capas invalidan ANTES de adoptar el UID nuevo');
console.log('  Legado    : conservado fisicamente; sin autoridad y sin importacion automatica');
console.log('  Interfaz  : tema, sidebar y filtros siguen en localStorage');
console.log(`${aprobados} controles H06 aprobados; 0 fallidos.`);
