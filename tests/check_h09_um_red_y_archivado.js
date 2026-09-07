#!/usr/bin/env node
'use strict';

/*
  H09 — UM como inventario de la RED ROCA + archivado de OC persistido.

  Control reproducible sin navegador. COMPLEMENTA a
  tests/h09_um_red_y_archivado.spec.js; no lo reemplaza.

  Lo que se fija aca:

    1) el modulo de UM figura en la navegacion real (la barra V2) y su vista no
       queda secuestrada dentro de Administracion;
    2) el inventario muestra los campos de la red —incluidos fabricante y
       modelo— y no reintroduce columnas que el esquema canonico no tiene;
    3) Servicios Tecnicos es una seccion consultable del modulo global;
    4) H09 no lee ni escribe localStorage y no siembra datos de demostracion;
    5) archivar/desarchivar viaja por la RPC canonica con `estado_registro`,
       nunca por `estado_coi` ni por localStorage;
    6) el listado ofrece Activas / Archivadas / Todas, con Activas por defecto.

  H09 no crea migraciones: `estado_registro` y coi_actualizar_orden_integral ya
  existen en produccion.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n?/g, '\n');

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
// Codigo ejecutable de una capa: sin el comentario de cabecera —que describe
// justamente lo que se retira— y sin comentarios de linea.
const cuerpo = (t) => {
  const i = t.indexOf('(function () {');
  return (i >= 0 ? t.slice(i) : t).split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');
};
const sinComentarios = cuerpo;

// ============ 0) H09 no aporta migraciones
const migraciones = fs.readdirSync(path.join('supabase', 'migrations'));
check(!migraciones.some((m) => /h09/i.test(m)),
  'H09 no puede crear migraciones: estado_registro y la RPC ya existen en produccion');

// ============ 1) el modulo es alcanzable desde la navegacion real
// La .module-nav legada esta oculta entera en la UI vigente: la navegacion real
// es la barra V2, y el inventario no figuraba en ella.
check(html.indexOf("{id:'btnUnidadesMantenimiento',view:'vistaUnidadesMantenimiento',label:'UM / Servicios Técnicos',icon:'map'},") >= 0,
  'el modulo UM tiene que figurar en la navegacion V2, que es la real');
const navV2 = html.slice(html.indexOf('  const NAV=['), html.indexOf('  let lastView='));
check(navV2.indexOf("section:'Gestión'") >= 0 && navV2.indexOf('btnUnidadesMantenimiento') > navV2.indexOf("section:'Gestión'"),
  'el inventario de la red va en Gestion, junto a la Red');

const capaUM = bloque('coi-h09-um-red-inventario');
const codigoUM = sinComentarios(capaUM);
check(codigoUM.indexOf("if (btn.hidden) btn.hidden = false;") >= 0,
  'restoreNavigation() vuelve a ocultar el boton: hay que reafirmar el acceso');
check(codigoUM.indexOf("panelAdmin.contains(vista)") >= 0,
  'ensureAdminUM() mueve la vista a Administracion: hay que devolverla a las vistas globales');
check(codigoUM.indexOf('attributeFilter:') >= 0 || codigoUM.indexOf("attributeFilter: ['hidden', 'style', 'aria-hidden']") >= 0,
  'el acceso se reafirma por observador, no peleando con temporizadores');

// ============ 2) inventario de la red: campos reales, sin columnas inventadas
check(html.indexOf("thead.innerHTML = ['Código UM', 'Tipo', 'Estación', 'Sector', 'Estado', 'Fabricante', 'Modelo', 'Ramal', 'Proveedor', 'N° de serie', 'ST', 'Ficha']") >= 0,
  'el inventario tiene que mostrar los campos de la red, incluidos fabricante y modelo');
check(html.indexOf("'<td>' + esc(u.marca || '—') + '</td>' +") >= 0 &&
  html.indexOf("'<td>' + esc(u.modelo || '—') + '</td>' +") >= 0,
  'fabricante y modelo salen de los campos canonicos marca y modelo');
check(html.indexOf("colspan=\\\"12\\\"") >= 0 || html.indexOf('colspan=\\"12\\"') >= 0 || /colspan=\\?"12\\?"/.test(html),
  'el colspan del estado vacio tiene que acompañar a las columnas nuevas');
// El esquema canonico no tiene criticidad ni ubicacion tecnica: no vuelven.
check(codigoUM.indexOf('criticidad') < 0 && codigoUM.indexOf('ubicacionTecnica') < 0,
  'H09 no puede reintroducir columnas que el esquema canonico no tiene');
check(codigoUM.indexOf("estaciones.size") >= 0,
  'falta el KPI de cobertura: estaciones con UM');

// ============ 3) Servicios Tecnicos como seccion del modulo global
check(codigoUM.indexOf("data-h09-tab=\"inventario\"") >= 0 && codigoUM.indexOf("data-h09-tab=\"servicios\"") >= 0,
  'el modulo necesita sus dos secciones: Inventario UM y Servicios Técnicos');
check(codigoUM.indexOf("id=\"h09PanelST\"") >= 0 || codigoUM.indexOf("panel.id = 'h09PanelST';") >= 0,
  'falta el panel global de Servicios Técnicos');
['h09StUM', 'h09StEstacion', 'h09StEstado', 'h09StDesde', 'h09StHasta', 'h09StBuscar'].forEach((id) => {
  check(codigoUM.indexOf(id) >= 0, `falta el filtro ${id} de Servicios Técnicos`);
});
check(codigoUM.indexOf('OC (referencial)') >= 0,
  'la OC se muestra como referencia, no como eje');
check(codigoUM.indexOf('No hay Servicios Técnicos cargados en Supabase.') >= 0,
  'remoto vacio es un estado valido y tiene que decirse');

// ============ 4) H09 no toca localStorage ni siembra datos
check(!/localStorage\s*\.\s*(get|set|remove|clear)/.test(codigoUM),
  'la capa de inventario no puede leer ni escribir localStorage');
check(codigoUM.indexOf('window.unidadesMantenimiento') >= 0 && codigoUM.indexOf('window.serviciosTecnicos') >= 0,
  'el modelo tiene que salir de lo que publica H05, que es Supabase-first');
check(!/(?:^|[^a-zA-Z])seed|sembrarDemo|DATOS_DEMO/.test(codigoUM),
  'H09 no puede sembrar inventario de demostracion');
// El camino de alta/edicion sigue siendo el de H05.
check(html.indexOf('window.renderUnidadesMantenimiento = function () { renderVistaUM(); return filtrarUM(); };') >= 0,
  'el render del inventario tiene que seguir siendo el de H05');

// ============ 5) archivado: RPC canonica y estado_registro
const capaArchivo = bloque('coi-h09-archivar-oc-supabase');
const codigoArchivo = sinComentarios(capaArchivo);
check(codigoArchivo.indexOf("const ACTIVO = 'Activo';") >= 0 && codigoArchivo.indexOf("const ARCHIVADO = 'Archivado';") >= 0,
  'los dos valores de estado_registro tienen que estar explicitos');
check(codigoArchivo.indexOf("repo.actualizar(uuid, { estado_registro: destino })") >= 0,
  'archivar tiene que ir por el repositorio canonico con estado_registro');
check(codigoArchivo.indexOf('estado_coi') < 0,
  'archivar NUNCA puede tocar estado_coi');
check(!/localStorage|guardarBaseLocal|saveJSON/.test(codigoArchivo),
  'el archivado no puede persistir nada en localStorage');
check(codigoArchivo.indexOf('window.COI_REPOSITORY && window.COI_REPOSITORY.ordenes') >= 0,
  'hay que reutilizar el repositorio existente, no abrir un camino paralelo');
// Sin optimismo: la UI se toca DESPUES de la confirmacion remota.
const ejecutar = html.slice(html.indexOf('  async function ejecutar(referencia, destino, opciones) {'),
  html.indexOf('  function confirmar(mensaje) {'));
check(ejecutar.indexOf('const salida = await cambiarEstadoRegistro(referencia, destino);') <
  ejecutar.indexOf('sincronizarBotones();'),
  'la interfaz solo puede cambiar despues de que Supabase confirme');
check(ejecutar.indexOf('El estado no cambió.') >= 0,
  'un fallo remoto tiene que informarse sin cambiar el estado');

// Desarchivar y Deshacer: reversion REAL.
check(codigoArchivo.indexOf('window.desarchivarOC = function (referencia)') >= 0,
  'tiene que existir el camino de desarchivado');
check(codigoArchivo.indexOf("btn.textContent = 'Deshaciendo…';") >= 0 &&
  codigoArchivo.indexOf("ejecutar(btn.getAttribute('data-h09-deshacer'), ACTIVO") >= 0,
  'Deshacer tiene que revertir contra Supabase, no solo en pantalla');
check(codigoArchivo.indexOf("btn.textContent = archivada ? 'Desarchivar OC' : 'Archivar OC';") >= 0,
  'el boton tiene que reflejar el estado de registro vigente');
check(codigoArchivo.indexOf('h09AvisoArchivada') >= 0,
  'la ficha tiene que decir con todas las letras que la OC esta archivada');

// ============ 6) listado por estado de registro
check(codigoArchivo.indexOf("<option value=\"activas\" selected>Activas</option>") >= 0,
  'el listado tiene que ofrecer Activas por defecto');
check(codigoArchivo.indexOf('<option value="archivadas">Archivadas</option>') >= 0 &&
  codigoArchivo.indexOf('<option value="todas">Todas</option>') >= 0,
  'una OC archivada nunca puede quedar inaccesible');
check(codigoArchivo.indexOf('window.filtrarOrdenes = envuelto;') >= 0,
  'el filtro se aplica sobre el filtrado canonico del listado');

console.log('H09: UM como inventario de la red y archivado persistido.');
console.log('  Navegación   : el módulo figura en la barra V2 y su vista es global');
console.log('  Inventario   : Estación → UM → historial de ST; la OC es referencial');
console.log('  Servicios    : sección consultable del módulo, no solo dentro de la ficha');
console.log('  Archivado    : RPC canónica con estado_registro; sin optimismo ni localStorage');
console.log('  Migraciones  : H09 no crea ninguna');
console.log(`${aprobados} controles H09 aprobados; 0 fallidos.`);
