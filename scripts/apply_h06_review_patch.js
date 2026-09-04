'use strict';

const fs = require('node:fs');

const INDEX = 'index.html';
const TEST = 'tests/check_h06_localstorage_non_authoritative.js';

function countOf(text, needle) {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function replaceOnce(text, before, after, label) {
  const count = countOf(text, before);
  if (count !== 1) {
    throw new Error(`${label}: se esperaba 1 coincidencia y hubo ${count}`);
  }
  return text.replace(before, after);
}

let html = fs.readFileSync(INDEX, 'utf8');
let test = fs.readFileSync(TEST, 'utf8');

if (
  html.includes('let supabaseCargaPendiente = false;') &&
  html.includes('function applyTimelineConfirmed(') &&
  html.includes('canonicalApi().purgarPosicionConfirmada(id);') &&
  test.includes('Ordenes tiene que descartar cargas stale')
) {
  console.log('H06 review patch ya aplicado; no hay cambios.');
  process.exit(0);
}

html = replaceOnce(
  html,
  "  let supabaseCargaEnCurso = false;\n  let supabaseColumnas = new Set();",
  "  let supabaseCargaEnCurso = false;\n  let supabaseCargaPendiente = false;\n  let supabaseAuthGeneration = 0;\n  let supabaseColumnas = new Set();",
  'ordenes: variables de generacion'
);

html = replaceOnce(
  html,
  "    if (nuevo === (ordenesConfirmadasUid || null)) return false;\n    ordenesConfirmadas = null;",
  "    if (nuevo === (ordenesConfirmadasUid || null)) return false;\n    // La primera sesion recuperada adopta su UID sin borrar operaciones\n    // idempotentes pendientes de una pestaña que acaba de recargarse.\n    if (ordenesConfirmadasUid === null && ordenesConfirmadas === null && nuevo) {\n      ordenesConfirmadasUid = nuevo;\n      return false;\n    }\n    supabaseAuthGeneration++;\n    ordenesConfirmadas = null;",
  'ordenes: adopcion inicial y generacion'
);

html = replaceOnce(
  html,
  "    try { window.posicionesFinancieras = []; posicionesFinancieras = []; } catch (error) {}\n    return true;",
  "    try { window.posicionesFinancieras = []; posicionesFinancieras = []; } catch (error) {}\n    try { window.__COI_INVALIDAR_HISTORIAL_CIRCUITO__?.(); } catch (error) {}\n    return true;",
  'ordenes: invalidar historial hidratado'
);

html = replaceOnce(
  html,
  "  async function cargarOrdenesDesdeSupabase(options = {}) {\n    const client = getSupabaseClient();",
  "  async function cargarOrdenesDesdeSupabase(options = {}) {\n    const requestGeneration = options.authGeneration ?? supabaseAuthGeneration;\n    const requestUid = options.authUid || null;\n    const client = getSupabaseClient();",
  'ordenes: capturar generacion y uid'
);

html = replaceOnce(
  html,
  "    const { data, error } = await client.from(SUPABASE_TABLE).select('*').limit(10000);\n    if (error) throw error;\n    const rows = Array.isArray(data) ? data : [];",
  "    const { data, error } = await client.from(SUPABASE_TABLE).select('*').limit(10000);\n    if (error) throw error;\n    if (requestGeneration !== supabaseAuthGeneration || requestUid !== ((supabaseUsuario && supabaseUsuario.id) || null)) {\n      throw new Error('Carga de ordenes descartada por cambio de sesion.');\n    }\n    const rows = Array.isArray(data) ? data : [];",
  'ordenes: descartar completion stale'
);

html = replaceOnce(
  html,
  "  async function cargarOrdenesPrincipal(options = {}) {\n    if (supabaseCargaEnCurso) return false;\n    supabaseCargaEnCurso = true;",
  "  async function cargarOrdenesPrincipal(options = {}) {\n    if (supabaseCargaEnCurso) {\n      supabaseCargaPendiente = true;\n      return false;\n    }\n    supabaseCargaEnCurso = true;",
  'ordenes: encolar recarga pendiente'
);

html = replaceOnce(
  html,
  "      invalidarOperacionalPorIdentidad(user && user.id);\n      if (user && navigator.onLine) return await cargarOrdenesDesdeSupabase(options);",
  "      invalidarOperacionalPorIdentidad(user && user.id);\n      const authGeneration = supabaseAuthGeneration;\n      const authUid = (user && user.id) || null;\n      if (user && navigator.onLine) return await cargarOrdenesDesdeSupabase({ ...options, authGeneration, authUid });",
  'ordenes: pasar generacion y uid'
);

html = replaceOnce(
  html,
  "    } finally {\n      supabaseCargaEnCurso = false;\n    }\n  }\n\n  async function recargarDatosDesdeSupabase",
  "    } finally {\n      supabaseCargaEnCurso = false;\n      if (supabaseCargaPendiente) {\n        supabaseCargaPendiente = false;\n        Promise.resolve().then(() => cargarOrdenesPrincipal(options));\n      }\n    }\n  }\n\n  async function recargarDatosDesdeSupabase",
  'ordenes: ejecutar recarga pendiente'
);

html = replaceOnce(
  html,
  "  function deletePurgeConfirmedV60(result) {\n    const row = result.row;\n    estacionesDisponibles().forEach((station) => {",
  "  function deletePurgeConfirmedV60(result) {\n    const row = result.row;\n    ordenesConfirmadas = Array.isArray(ordenesConfirmadas)\n      ? ordenesConfirmadas.filter((item) => !deleteOrdersMatchV60(item, row))\n      : ordenesConfirmadas;\n    estacionesDisponibles().forEach((station) => {",
  'ordenes: purgar snapshot confirmado tras delete'
);

html = replaceOnce(
  html,
  "const CIRCUITO_CACHE_KEY='coi_circuito_historial_cache_v1';\nconst historialCircuitoCache=new Map();\nlet guardandoEtapaCircuito=false;",
  "const CIRCUITO_CACHE_KEY='coi_circuito_historial_cache_v1';\nconst historialCircuitoCache=new Map();\nwindow.__COI_INVALIDAR_HISTORIAL_CIRCUITO__=()=>{historialCircuitoCache.clear();};\nlet guardandoEtapaCircuito=false;",
  'circuito: hook de invalidacion hidratada'
);

html = replaceOnce(
  html,
  "    renderTimelineFichaActual();\n    return normalized;\n  }\n  function setTimelinePersistence(mode,message){",
  "    renderTimelineFichaActual();\n    return normalized;\n  }\n  function applyTimelineConfirmed(events,reason,options={}){\n    const normalized=applyTimelineEvents(events,reason,options);\n    timelineConfirmados=normalized;\n    if(options.uid!==undefined)timelineConfirmadosUid=options.uid||null;\n    return normalized;\n  }\n  function setTimelinePersistence(mode,message){",
  'timeline: helper confirmado'
);

const timelineReplacements = [
  ["            applyTimelineEvents(remote,'Timeline cargado desde Supabase');", "            applyTimelineConfirmed(remote,'Timeline cargado desde Supabase',{uid:sesionTimeline.id});", 'timeline: migracion warning'],
  ["        applyTimelineEvents(remote,'Timeline cargado desde Supabase');\n        timelineAuthoritativeReady=true;\n        timelineConfirmados=remote;\n        timelineConfirmadosUid=(sesionTimeline&&sesionTimeline.id)||null;", "        applyTimelineConfirmed(remote,'Timeline cargado desde Supabase',{uid:sesionTimeline.id});\n        timelineAuthoritativeReady=true;", 'timeline: carga normal'],
  ["          applyTimelineEvents(remote,reason||'Timeline reconciliado desde Supabase');", "          applyTimelineConfirmed(remote,reason||'Timeline reconciliado desde Supabase');", 'timeline: reconciliacion'],
  ["      applyTimelineEvents(remote,reason||'Timeline guardado en Supabase');", "      applyTimelineConfirmed(remote,reason||'Timeline guardado en Supabase');", 'timeline: save refresh'],
  ["      applyTimelineEvents(committed,reason||'Timeline guardado en Supabase');", "      applyTimelineConfirmed(committed,reason||'Timeline guardado en Supabase');", 'timeline: save fallback'],
  ["      applyTimelineEvents(remote,reason||'Timeline reemplazado en Supabase');", "      applyTimelineConfirmed(remote,reason||'Timeline reemplazado en Supabase');", 'timeline: restore refresh'],
  ["      applyTimelineEvents(committed,reason||'Timeline reemplazado en Supabase');", "      applyTimelineConfirmed(committed,reason||'Timeline reemplazado en Supabase');", 'timeline: restore fallback'],
  ["        applyTimelineEvents(remote,'Evento eliminado en Supabase');", "        applyTimelineConfirmed(remote,'Evento eliminado en Supabase');", 'timeline: delete refresh'],
  ["        applyTimelineEvents(committed,'Evento eliminado en Supabase');", "        applyTimelineConfirmed(committed,'Evento eliminado en Supabase');", 'timeline: delete fallback']
];
for (const [before, after, label] of timelineReplacements) html = replaceOnce(html, before, after, label);

html = replaceOnce(
  html,
  "  const runtime=window.__COI_FINANZAS_SUPABASE_RUNTIME__||{estado:STATES.CLIENTE_INICIALIZANDO,cliente:null,sesion:null,ultimaCarga:null,ultimoError:null,initPromise:null,reconnectPromise:null};\n  window.__COI_FINANZAS_SUPABASE_RUNTIME__=runtime;",
  "  const runtime=window.__COI_FINANZAS_SUPABASE_RUNTIME__||{estado:STATES.CLIENTE_INICIALIZANDO,cliente:null,sesion:null,ultimaCarga:null,ultimoError:null,initPromise:null,reconnectPromise:null};\n  runtime.authGeneration=Number(runtime.authGeneration)||0;runtime.reconnectGeneration=-1;runtime.reconnectUid=null;\n  window.__COI_FINANZAS_SUPABASE_RUNTIME__=runtime;",
  'finanzas: runtime generaciones'
);

html = replaceOnce(
  html,
  "  function invalidarFinPorIdentidad(uidNuevo){const nuevo=uidNuevo||null;if(nuevo===(confirmadasFinUid||null))return false;try{localStorage.removeItem(CACHE_KEY);}catch(error){}clearMemory();return true;}",
  "  function invalidarFinPorIdentidad(uidNuevo){const nuevo=uidNuevo||null;if(nuevo===(confirmadasFinUid||null))return false;if(confirmadasFinUid===null&&confirmadasFin===null&&nuevo){confirmadasFinUid=nuevo;return false;}runtime.authGeneration++;try{localStorage.removeItem(CACHE_KEY);}catch(error){}clearMemory();return true;}",
  'finanzas: identidad bootstrap y generacion'
);

html = replaceOnce(
  html,
  "  async function recargarCache(options={}){const [remote,consumptions]=await Promise.all([readPaged(TABLE,'*'),readPaged(CONSUMPTIONS_TABLE,'*')]);const confirmed=consumptions.filter(row=>text(row.estado).toUpperCase()==='CONFIRMADA');saveRemoteCache(remote,confirmed);const merged=confirmarMemoria(remote,confirmed);runtime.ultimaCarga=new Date().toISOString();runtime.ultimoError=null;setState(STATES.SUPABASE_FIRST);if(options.render!==false){try{window.renderOrdenes?.();const view=$('vistaFichaOC');if(view?.classList.contains('active'))window.renderFichaOC?.(window.ocActualId||'');}catch(error){console.warn('V60: no se pudo refrescar la vista financiera.',error);}}return merged;}",
  "  async function recargarCache(options={}){const requestGeneration=options.authGeneration??runtime.authGeneration,requestUid=options.authUid??runtime.sesion?.user?.id??null;const [remote,consumptions]=await Promise.all([readPaged(TABLE,'*'),readPaged(CONSUMPTIONS_TABLE,'*')]);if(requestGeneration!==runtime.authGeneration||requestUid!==(runtime.sesion?.user?.id||null))throw new Error('Carga financiera descartada por cambio de sesion.');const confirmed=consumptions.filter(row=>text(row.estado).toUpperCase()==='CONFIRMADA');saveRemoteCache(remote,confirmed);const merged=confirmarMemoria(remote,confirmed);runtime.ultimaCarga=new Date().toISOString();runtime.ultimoError=null;setState(STATES.SUPABASE_FIRST);if(options.render!==false){try{window.renderOrdenes?.();const view=$('vistaFichaOC');if(view?.classList.contains('active'))window.renderFichaOC?.(window.ocActualId||'');}catch(error){console.warn('V60: no se pudo refrescar la vista financiera.',error);}}return merged;}",
  'finanzas: recarga ligada a sesion'
);

html = replaceOnce(
  html,
  "    if(runtime.reconnectPromise)return runtime.reconnectPromise;\n    runtime.reconnectPromise=(async()=>{if(navigator.onLine===false)return applyCacheState(STATES.OFFLINE);const c=client()||await waitForSupabaseClient(options);if(!c)return applyCacheState(STATES.SIN_CLIENTE,'Cliente Supabase no disponible.');const access=await verificarAcceso(options);if(!access.user)return applyCacheState(STATES.SIN_SESION);try{return await recargarCache({render:options.render!==false});}catch(error){const state=isRlsError(error)?STATES.ERROR_RLS:STATES.SIN_CLIENTE;const cached=applyCacheState(state,error);if(options.soloRemoto)throw error;return cached;}})();",
  "    const requestGeneration=runtime.authGeneration,requestUid=runtime.sesion?.user?.id||null;\n    if(runtime.reconnectPromise){if(runtime.reconnectGeneration===requestGeneration&&runtime.reconnectUid===requestUid)return runtime.reconnectPromise;return runtime.reconnectPromise.finally(()=>reintentarConexion(options));}\n    runtime.reconnectGeneration=requestGeneration;runtime.reconnectUid=requestUid;\n    runtime.reconnectPromise=(async()=>{if(navigator.onLine===false)return applyCacheState(STATES.OFFLINE);const c=client()||await waitForSupabaseClient(options);if(!c)return applyCacheState(STATES.SIN_CLIENTE,'Cliente Supabase no disponible.');const access=await verificarAcceso(options);if(!access.user)return applyCacheState(STATES.SIN_SESION);try{return await recargarCache({render:options.render!==false,authGeneration:requestGeneration,authUid:requestUid});}catch(error){if(requestGeneration!==runtime.authGeneration||requestUid!==(runtime.sesion?.user?.id||null)){if(options.soloRemoto)throw error;return [];}const state=isRlsError(error)?STATES.ERROR_RLS:STATES.SIN_CLIENTE;const cached=applyCacheState(state,error);if(options.soloRemoto)throw error;return cached;}})();",
  'finanzas: reconnect ligada a sesion'
);

html = replaceOnce(
  html,
  "  async function procesarEventoAuth(event,session){if(!['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED','SIGNED_OUT'].includes(event))return;runtime.sesion=session||null;if(event==='SIGNED_OUT'||!session?.user){try{localStorage.removeItem(CACHE_KEY);}catch(error){}clearMemory();setState(STATES.SIN_SESION);return;}invalidarFinPorIdentidad(session.user.id);await reintentarConexion({render:false});}",
  "  async function procesarEventoAuth(event,session){if(!['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED','SIGNED_OUT'].includes(event))return;runtime.sesion=session||null;if(event==='SIGNED_OUT'||!session?.user){runtime.authGeneration++;try{localStorage.removeItem(CACHE_KEY);}catch(error){}clearMemory();setState(STATES.SIN_SESION);return;}invalidarFinPorIdentidad(session.user.id);await reintentarConexion({render:false});}",
  'finanzas: logout invalida generacion'
);

html = replaceOnce(
  html,
  "  const api={version:VERSION,states:STATES,waitForSupabaseClient,reintentarConexion,procesarEventoAuth,aplicarOffline,verificarAcceso,buscarOrdenPorOC,listarTodas,listarPorOC,guardarPosiciones,actualizarPosicion,eliminarPosicion,eliminarPosiciones,certificarPosiciones,actualizarCertificacion,anularCertificacion,recargarCache,obtenerCache:readCache,limpiarDatosSesion:clearMemory,diagnostico,migracion:{analizar:analizarLegacy,exportarBackup,exportarInforme,migrar:migrarLegacy,verificar:verificarMigracion}};",
  "  function purgarPosicionConfirmada(id){confirmadasFin=Array.isArray(confirmadasFin)?confirmadasFin.filter(row=>String(row?.id||row?.idPosicionFinanciera)!==String(id)):confirmadasFin;return confirmadasFin;}\n  const api={version:VERSION,states:STATES,waitForSupabaseClient,reintentarConexion,procesarEventoAuth,aplicarOffline,verificarAcceso,buscarOrdenPorOC,listarTodas,listarPorOC,guardarPosiciones,actualizarPosicion,eliminarPosicion,eliminarPosiciones,certificarPosiciones,actualizarCertificacion,anularCertificacion,recargarCache,purgarPosicionConfirmada,obtenerCache:readCache,limpiarDatosSesion:clearMemory,diagnostico,migracion:{analizar:analizarLegacy,exportarBackup,exportarInforme,migrar:migrarLegacy,verificar:verificarMigracion}};",
  'finanzas: API de purga confirmada'
);

html = replaceOnce(
  html,
  "    window.posicionesFinancieras=filter(window.posicionesFinancieras);\n    try{posicionesFinancieras=window.posicionesFinancieras;}catch(error){}\n  }\n  async function eliminarPosiciones(ids){",
  "    window.posicionesFinancieras=filter(window.posicionesFinancieras);\n    try{posicionesFinancieras=window.posicionesFinancieras;}catch(error){}\n    canonicalApi().purgarPosicionConfirmada(id);\n  }\n  async function eliminarPosiciones(ids){",
  'finanzas: purgar snapshot tras delete'
);

test = replaceOnce(
  test,
  "check(/cacheSupabaseOrders\\(normalized\\);\\n    ordenesConfirmadas = normalized;/.test(html),\n  'solo una lectura remota confirmada puede fijar el snapshot de Ordenes');\n// Y sin sesion no sobrevive.",
  "check(/cacheSupabaseOrders\\(normalized\\);\\n    ordenesConfirmadas = normalized;/.test(html),\n  'solo una lectura remota confirmada puede fijar el snapshot de Ordenes');\ncheck(html.includes('requestGeneration !== supabaseAuthGeneration') && html.includes('supabaseCargaPendiente = true;'),\n  'Ordenes tiene que descartar cargas stale y encolar la recarga de la identidad nueva');\n// Y sin sesion no sobrevive.",
  'test: stale orders'
);

test = replaceOnce(
  test,
  "check(invalidarOrdenes.indexOf(\"if (nuevo === (ordenesConfirmadasUid || null)) return false;\") >= 0,\n  'un TOKEN_REFRESHED del mismo UID no puede contar como cambio de identidad');\nfor (const linea of",
  "check(invalidarOrdenes.indexOf(\"if (nuevo === (ordenesConfirmadasUid || null)) return false;\") >= 0,\n  'un TOKEN_REFRESHED del mismo UID no puede contar como cambio de identidad');\ncheck(invalidarOrdenes.indexOf('ordenesConfirmadasUid === null && ordenesConfirmadas === null && nuevo') >= 0,\n  'la adopcion inicial del UID no puede purgar la operacion financiera idempotente pendiente');\ncheck(invalidarOrdenes.indexOf('__COI_INVALIDAR_HISTORIAL_CIRCUITO__') >= 0,\n  'un cambio real de identidad tiene que vaciar tambien el historial de circuito hidratado');\nfor (const linea of",
  'test: bootstrap e historial'
);

test = replaceOnce(
  test,
  "check(html.indexOf('invalidarFinPorIdentidad(session.user.id);') >= 0,\n  'el evento de auth financiero tiene que invalidar por identidad antes de reconectar');\n\n// ============================================ 3) TIMELINE / MAILING",
  "check(html.indexOf('invalidarFinPorIdentidad(session.user.id);') >= 0,\n  'el evento de auth financiero tiene que invalidar por identidad antes de reconectar');\ncheck(html.includes('requestGeneration!==runtime.authGeneration||requestUid!==(runtime.sesion?.user?.id||null)'),\n  'Finanzas tiene que rechazar resultados de una generacion o UID anterior');\ncheck(html.includes('runtime.reconnectPromise.finally(()=>reintentarConexion(options))'),\n  'Finanzas tiene que encolar una reconexion para la identidad nueva');\n\n// ============================================ 3) TIMELINE / MAILING",
  'test: stale finance'
);

test = replaceOnce(
  test,
  "check(html.indexOf('timelineConfirmados=remote;') >= 0,\n  'solo la lectura remota confirmada puede fijar el conjunto del Timeline');",
  "check(html.indexOf('function applyTimelineConfirmed(') >= 0,\n  'Timeline tiene que centralizar la actualizacion del snapshot confirmado');\nfor (const reason of ['Timeline guardado en Supabase', 'Timeline reemplazado en Supabase', 'Evento eliminado en Supabase', 'Timeline reconciliado desde Supabase']) {\n  check(html.includes(`applyTimelineConfirmed(remote,reason||'${reason}'`) || html.includes(`applyTimelineConfirmed(remote,'${reason}'`) || html.includes(`applyTimelineConfirmed(committed,'${reason}'`),\n    `Timeline tiene que confirmar su snapshot despues de ${reason}`);\n}\n\ncheck(/ordenesConfirmadas = Array\\.isArray\\(ordenesConfirmadas\\)[\\s\\S]*?deleteOrdersMatchV60\\(item, row\\)/.test(html),\n  'el borrado remoto de una OC tiene que quitarla del snapshot confirmado');\ncheck(html.includes('canonicalApi().purgarPosicionConfirmada(id);'),\n  'el borrado remoto de una posicion tiene que quitarla del snapshot financiero confirmado');",
  'test: timeline y deletes confirmados'
);

fs.writeFileSync(INDEX, html);
fs.writeFileSync(TEST, test);
console.log('H06 review patch aplicado de forma deterministica a index.html y test estatico.');
