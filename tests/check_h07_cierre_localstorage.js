#!/usr/bin/env node
'use strict';

/*
  H07 — cierre Supabase-first.

  Control reproducible sin navegador. COMPLEMENTA a
  tests/h07_cierre_localstorage.spec.js; no lo reemplaza.

  H07 NO crea un modelo documental nuevo. La baseline vigente manda:

    AGENTS.md          · «No reintroducir OneDrive ni `Agregar link documental`
                          en Ficha OC.»
                       · «Supabase Storage y las tablas documentales vigentes
                          son el camino activo.»
    BASELINE_OPERATIVA · Documentacion — no reintroducir OneDrive en Ficha OC.

  Por eso la documentacion por referencia externa queda RETIRADA del modelo
  operacional y el camino activo sigue siendo Supabase Storage +
  public.coi_documentos_oc. Lo que se verifica aca:

    1) no existe una tabla/migracion documental nueva ni divergencia declarada;
    2) documentacionOC no se siembra ni se persiste en localStorage;
    3) las acciones del editor documental retirado no pueden escribir;
    4) los lectores legados no reincorporan documentacion local;
    5) la señal de sincronizacion del Timeline no rebota entre pestañas;
    6) la cuarentena de observaciones se concilia fila por fila y tiene salida.

  No toca STAGING ni PRODUCCION.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n?/g, '\n');
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

// ============ 1) H07 no introduce un segundo modelo documental
const migraciones = fs.readdirSync(path.join('supabase', 'migrations'));
check(!migraciones.some((m) => /documentacion_oc/i.test(m)),
  'H07 no puede crear una migracion para un modelo documental por referencia externa');
const sql = migraciones
  .map((m) => fs.readFileSync(path.join('supabase', 'migrations', m), 'utf8'))
  .join('\n');
check(!/create table if not exists public\.coi_documentacion_oc/i.test(sql),
  'ninguna migracion puede crear public.coi_documentacion_oc');
const divergencias = contrato._divergencias_pendientes || {};
check(!(divergencias.tablas || []).some((t) => t.tabla === 'coi_documentacion_oc'),
  'no puede quedar declarada una divergencia por una tabla documental retirada');
check(!Object.prototype.hasOwnProperty.call(contrato, 'coi_documentacion_oc'),
  'el snapshot productivo no puede declarar la tabla retirada');
// El camino ACTIVO sigue existiendo y no se toca.
check(html.indexOf("const TABLE = 'coi_documentos_oc';") >= 0,
  'el camino documental activo (coi_documentos_oc + Storage) tiene que seguir en pie');
check(html.indexOf("const BUCKET = 'coi-documentos';") >= 0,
  'el bucket documental vigente tiene que seguir en pie');

// ============ 2) documentacionOC fuera del modelo operacional
const capa = bloque('coi-h07-documentacion-legacy-retirada');
const codigo = sinComentarios(capa);
check(codigo.indexOf("Object.defineProperty(window, 'documentacionOC'") >= 0,
  'documentacionOC tiene que quedar congelado');
check(/get\(\) \{ return VACIO; \}/.test(codigo),
  'documentacionOC operativo tiene que ser SIEMPRE vacio');
check(codigo.indexOf('window.v64CargarDocumentacionOC = function () { return []; };') >= 0,
  'la lectura documental no puede volver a salir de localStorage');
check(!/localStorage\.setItem/.test(codigo),
  'la capa de retiro no puede escribir en localStorage');
check(!/removeItem/.test(codigo),
  'H07 no puede borrar el material documental legado');
// El escritor historico tampoco persiste.
check(html.indexOf('function v64GuardarDocumentacionOC(){return window.documentacionOC;}') >= 0,
  'el choke point historico no puede persistir documentacion');
check(!/saveJSON\(LS_DOCUMENTACION_OC_V64/.test(html) && !/setItem\(LS_DOCUMENTACION_OC_V64/.test(html),
  'no puede quedar ninguna escritura de la clave documental legada');

// ============ 3) acciones del editor retirado deshabilitadas
for (const fn of ['v64GuardarDocumentoDesdeForm', 'v64EliminarDocumento', 'v64GuardarCarpetaOC']) {
  check(codigo.indexOf('window.' + fn + ' = rechazar;') >= 0,
    `la accion documental retirada ${fn} tiene que quedar deshabilitada`);
}
check(codigo.indexOf('window.v64MigrarDocsEmbebidos = function () { return false; };') >= 0,
  'la autoimportacion de documentos embebidos tiene que quedar desactivada');
check(codigo.indexOf('btnV64LimpiarDocGlobal') >= 0 && codigo.indexOf('stopImmediatePropagation') >= 0,
  'Limpiar documentacion global no puede anunciar exito sin autoridad detras');

// ============ 4) lectores legados aislados
check(codigo.indexOf('window.v62DocsGlobales = function () { return []; };') >= 0,
  'v62DocsGlobales no puede reincorporar documentacion legada al modelo');

// ============ 5) la señal del Timeline no rebota, y es segura ante solapamiento
// La decision viaja CON la peticion. Una unica global mutable con semantica
// guardar/restaurar dejaba el origen pegado en 'storage' cuando dos eventos se
// solapaban, y a partir de ahi ninguna mutacion local volvia a avisar.
check(!/timelineOrigenRecarga/.test(html),
  'no puede quedar una global mutable representando el origen de la recarga');
check(html.indexOf('function applyTimelineEvents(events,reason,{cache=true,emitirSync=true}={}){') >= 0,
  'la decision de emitir la señal tiene que ser un parametro de la peticion');
check(html.indexOf('        if(emitirSync){') >= 0,
  'la señal solo se emite cuando la peticion lo pide');
check(html.indexOf('    const estadoCarga={emitirSync:options.emitirSync!==false};') >= 0,
  'cada lectura necesita su propio estado, capturado por su closure');
check(html.indexOf('      if(timelineLoadState&&options.emitirSync===false)timelineLoadState.emitirSync=false;') >= 0,
  'engancharse a una lectura en curso desde otra pestaña tampoco puede reemitir');
check(html.indexOf('      Promise.resolve(loadEvents({emitirSync:false})).catch(()=>{});') >= 0,
  'el listener de storage tiene que pedir explicitamente NO reemitir');
check(html.indexOf('{uid:sesionTimeline.id,emitirSync:estadoCarga.emitirSync}') >= 0,
  'la decision tiene que propagarse hasta la publicacion del Timeline');

// ============ 6) cuarentena de observaciones: conciliacion y salida
check(html.indexOf('if (filas.length) ponerMarcador();') < 0,
  'el marcador de corte no puede ponerse solo porque Supabase tenga alguna fila');
const cuarentena = sinComentarios(html.slice(
  html.indexOf('  function registrarCuarentena() {'),
  html.indexOf('  function pendientesDeConciliar() {')));
check(cuarentena.indexOf('if (marcadorPuesto()) { runtime.legadoEnCuarentena = 0; return 0; }') >= 0,
  'con el corte ya resuelto no hay cuarentena pendiente');
check(cuarentena.indexOf('if (!runtime.sincronizado || !Array.isArray(runtime.confirmado))') >= 0,
  'sin lectura remota confirmada todo el legado cuenta como pendiente (fail-closed)');
check(cuarentena.indexOf('const remotas = new Set(runtime.confirmado.map(claveObs));') >= 0,
  'la cuarentena tiene que compararse fila por fila contra el remoto');
check(cuarentena.indexOf('if (!pendientes.length) ponerMarcador();') >= 0,
  'el corte solo se da por cumplido cuando TODAS las filas locales estan en el remoto');
check(html.indexOf("const claveObs = (o) => (o ? norm(obsOC(o)) + '|' + norm(obsTexto(o)) : '|');") >= 0,
  'la comparacion tiene que apoyarse en una clave determinista');
// Los alias son los MISMOS que v65NormalizarObservacion(): mantener dos
// normalizadores incompatibles dejaba una fila legada con numeroOC+descripcion
// produciendo la clave vacia y por lo tanto eternamente en cuarentena.
check(html.indexOf('  const obsOC = (o) => o.ocNro || o.OC_NRO || o.oc || o.numeroOC || o.nro_oc;') >= 0,
  'la clave de OC tiene que aceptar los mismos alias que la normalizacion canonica');
check(html.indexOf('  const obsTexto = (o) => o.texto || o.observacion || o.descripcion || o.detalle;') >= 0,
  'la clave de texto tiene que aceptar los mismos alias que la normalizacion canonica');
const canonica = html.slice(html.indexOf('function v65NormalizarObservacion('), html.indexOf('function v65CargarObservacionesOC('));
['ocNro', 'OC_NRO', 'oc', 'numeroOC'].forEach((alias) => {
  check(canonica.indexOf(alias) >= 0, `v65NormalizarObservacion tiene que seguir aceptando ${alias}`);
});
['texto', 'observacion', 'descripcion'].forEach((alias) => {
  check(canonica.indexOf(alias) >= 0, `v65NormalizarObservacion tiene que seguir aceptando ${alias}`);
});
// Salida explicita.
check(html.indexOf('conciliar: async function () {') >= 0,
  'la cuarentena tiene que ofrecer una conciliacion explicita');
check(html.indexOf('descartar: function (opciones) {') >= 0,
  'la cuarentena tiene que ofrecer un descarte explicito');
const descartar = html.slice(html.indexOf('descartar: function (opciones) {'), html.indexOf('exportarJSON: () => {'));
check(descartar.indexOf('opciones.confirmado === true') >= 0,
  'el descarte tiene que exigir confirmacion explicita');
check(descartar.indexOf('this.exportarJSON()') >= 0,
  'el descarte tiene que exportar antes de liberar el bloqueo');
check(descartar.indexOf('removeItem') < 0,
  'el descarte NO puede borrar el material legado');

// ============ 7) el legado publicado se retira ANTES del primer await
// El inicializador historico publica en window.observacionesOC lo que encuentra
// en la clave legada. Si la retirada esperaba a una operacion async, con red
// lenta quedaba una ventana con material local —posiblemente de otro operador
// del mismo navegador— visible como dato operativo.
const cargarObs = html.slice(
  html.indexOf('  function retirarLegadoPublicado() {'),
  html.indexOf('  // ---------------------------------------------------------- lectura paginada'));
check(cargarObs.indexOf('if (runtime.sincronizado === true && Array.isArray(runtime.confirmado)) return false;') >= 0,
  'una recarga de la misma sesion con snapshot confirmado no puede destruirlo');
check(cargarObs.indexOf('runtime.sincronizado = false;') >= 0,
  'el vacio no se puede presentar como una lectura remota confirmada');
check(!/removeItem|localStorage\.setItem/.test(cargarObs),
  'retirar el legado publicado NO puede tocar localStorage');
const inicioCargar = html.indexOf('  async function cargar() {\n    const generacion = ++runtime.generacion;');
check(inicioCargar > 0, 'no se encontro la carga inicial de observaciones');
const cuerpoCargar = html.slice(inicioCargar, html.indexOf('    const promesa = (async () => {\n      const c = cliente();'));
check(cuerpoCargar.indexOf('retirarLegadoPublicado();') >= 0,
  'la retirada tiene que correr ANTES del primer await de la carga');
check(!/await/.test(sinComentarios(cuerpoCargar)),
  'no puede haber ningun await antes de retirar el legado publicado');

// ============ 8) circuito user-facing para resolver la cuarentena
// Las operaciones existian pero solo eran alcanzables desde consola: un
// operador con cuarentena pendiente veia las mutaciones bloqueadas y no tenia
// ninguna salida visible.
const aviso = html.slice(html.indexOf('  function avisoCuarentenaHTML() {'), html.indexOf('  let cuarentenaEnCurso = false;'));
check(aviso.indexOf('const n = registrarCuarentena();') >= 0 && aviso.indexOf("if (!n) return '';") >= 0,
  'el aviso solo puede aparecer cuando hay cuarentena pendiente');
['data-h07-obs-conciliar', 'data-h07-obs-exportar', 'data-h07-obs-descartar'].forEach((attr) => {
  check(aviso.indexOf(attr) >= 0, `la salida de cuarentena tiene que ofrecer ${attr}`);
});
check(aviso.indexOf('No borra el archivo legado ni lo importa a Supabase.') >= 0,
  'la UI tiene que explicar que descartar NO borra ni importa');
check(html.indexOf('        return avisoCuarentenaHTML() + baseRenderObs.apply(this, arguments);') >= 0,
  'el aviso tiene que montarse sobre el sector de Observaciones existente');
const accion = html.slice(html.indexOf('  function accionCuarentena(cual) {'), html.indexOf('  // ---------------------------------------------------------- lectura paginada'));
check(accion.indexOf('const ok = window.confirm(') >= 0,
  'descartar desde la UI tiene que exigir confirmacion explicita del usuario');
check(accion.indexOf("api.descartar({ confirmado: true })") >= 0,
  'la UI tiene que usar las operaciones existentes, no una API paralela');
check(!/removeItem/.test(accion),
  'ninguna accion de la UI puede borrar el material legado');

// ============ 9) las alertas del modelo documental retirado no se emiten
const filtro = html.slice(html.indexOf('  const ALERTAS_RETIRADAS = ['), html.indexOf('  function instalarRetiro() {'));
[
  'OC sin carpeta documental',
  'OC activa sin carpeta documental',
  'OC sin Acta de Inicio',
  'Documento sin link'
].forEach((tipo) => {
  check(filtro.indexOf(tipo) >= 0, `la alerta retirada «${tipo}» tiene que quedar filtrada`);
});
check(filtro.indexOf('window.generarAlertasCOI = envuelto;') >= 0,
  'el filtro tiene que instalarse sobre el generador real de alertas');
check(html.indexOf('    instalarFiltroAlertas();') >= 0,
  'el filtro tiene que quedar instalado junto con el resto del retiro');
// El Diagnóstico avanzado V58.1 mostraba el mismo pedido con un boton que lo
// mandaba a Observaciones: era accionable, no codigo muerto.
const diag = html.slice(html.indexOf('  const esProblemaRetirado = (p) => {'), html.indexOf('  function instalarFiltroAlertas() {'));
check(diag.indexOf('/ONEDRIVE|SHAREPOINT|CARPETA DOCUMENTAL/.test(txt)') >= 0,
  'el problema documental del modelo retirado tiene que quedar filtrado');
check(diag.indexOf('window.renderAdminDiagnostico = envuelto;') >= 0,
  'hay que filtrar en el render, que es el camino que usa el boton del panel');
check(diag.indexOf('salida.problemasDocumentales = quedan.filter') >= 0,
  'el contador documental tiene que recalcularse tras el filtro');
check(html.indexOf('    instalarFiltroDiagnostico();') >= 0,
  'el filtro del diagnostico tiene que quedar instalado junto con el resto del retiro');
// El otro problema documental es del camino vigente y NO se filtra por tipo.
check(html.indexOf("descripcion:'Documento con fecha inválida.'") >= 0,
  'el problema documental del camino vigente no se puede perder');
check(diag.indexOf('Documento con fecha') < 0,
  'el problema documental del camino vigente no se puede filtrar');

// ============ 9b) el legado no se cuenta como documentacion activa
// getDocs() del bloque V58.1 delega en v62DocsGlobales(), que H07 deja vacio:
// la rama que lee las claves legadas es inalcanzable.
check(html.indexOf("    try{if(typeof v62DocsGlobales==='function')return v62DocsGlobales();}catch(e){}") >= 0,
  'getDocs tiene que seguir delegando en el lector que H07 neutraliza');
check(html.indexOf('window.v62DocsGlobales = function () { return []; };') >= 0,
  'v62DocsGlobales tiene que devolver vacio para que el conteo documental sea 0');
// Las alertas documentales del camino VIGENTE no se tocan.
[
  'OC activa sin Acta de Inicio',
  'Estado documental pendiente',
  'Falta expediente',
  'Falta última acta'
].forEach((tipo) => {
  check(html.indexOf(tipo) >= 0, `la alerta documental vigente «${tipo}» no se puede perder`);
  check(filtro.indexOf(tipo) < 0, `la alerta documental vigente «${tipo}» no se puede filtrar`);
});

// ============ 10) documentacion tecnica sin tablas retiradas
// La CADENA coi_documentacion_oc sigue siendo valida como nombre de la clave
// legada de localStorage. Lo que no puede sobrevivir es afirmar que existe una
// TABLA public.coi_documentacion_oc y que es autoridad.
check(!/La autoridad\s+es public\.coi_documentacion_oc/.test(html),
  'ningun comentario puede seguir declarando autoridad sobre la tabla retirada');
check(!/coi-h07-documentacion-supabase-first/.test(html),
  'no puede quedar referencia a la capa que daba autoridad al modelo retirado');
// Las UNICAS menciones admitidas a public.coi_documentacion_oc son las que
// narran su retiro: ninguna puede presentarla como tabla vigente.
html.split('\n').forEach((linea, i) => {
  if (linea.indexOf('public.coi_documentacion_oc') < 0) return;
  check(/NO existe|retirad|primer intento/i.test(linea),
    `la linea ${i + 1} menciona public.coi_documentacion_oc sin declararla retirada`);
});
check(/`public\.coi_documentacion_oc` NO existe/.test(html),
  'el codigo tiene que decir explicitamente que la tabla no existe');
check(/El unico camino documental activo es Supabase Storage/.test(html),
  'el comentario tiene que nombrar el camino documental vigente');
check(html.indexOf("const LS_DOCUMENTACION_OC_V64='coi_documentacion_oc';") >= 0,
  'la clave legada de localStorage se conserva: no se borra mecanicamente');

console.log('H07 cierre Supabase-first: capa verificada.');
console.log('  Documental  : modelo por referencia externa RETIRADO; activo = Storage + coi_documentos_oc');
console.log('  Migraciones : H07 no crea ninguna tabla nueva');
console.log('  Legado      : conservado, en cuarentena, exportable y nunca autoimportado');
console.log('  Timeline    : la señal entre pestañas no rebota');
console.log('  Observaciones: cuarentena conciliada fila por fila, con salida explicita');
console.log(`${aprobados} controles H07 aprobados; 0 fallidos.`);
