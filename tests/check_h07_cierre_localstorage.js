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

// ============ 5) la señal del Timeline no rebota
check(html.indexOf("let timelineOrigenRecarga='local';") >= 0,
  'el Timeline tiene que distinguir el origen de la recarga');
check(html.indexOf("if(timelineOrigenRecarga!=='storage'){") >= 0,
  'una recarga originada por otra pestaña NO puede volver a emitir la señal');
check(html.indexOf("timelineOrigenRecarga='storage';") >= 0,
  'el listener de storage tiene que marcar el origen antes de releer');

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
check(html.indexOf('const claveObs = (o) => {') >= 0,
  'la comparacion tiene que apoyarse en una clave determinista');
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

console.log('H07 cierre Supabase-first: capa verificada.');
console.log('  Documental  : modelo por referencia externa RETIRADO; activo = Storage + coi_documentos_oc');
console.log('  Migraciones : H07 no crea ninguna tabla nueva');
console.log('  Legado      : conservado, en cuarentena, exportable y nunca autoimportado');
console.log('  Timeline    : la señal entre pestañas no rebota');
console.log('  Observaciones: cuarentena conciliada fila por fila, con salida explicita');
console.log(`${aprobados} controles H07 aprobados; 0 fallidos.`);
