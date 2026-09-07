#!/usr/bin/env node
'use strict';

/*
  H10 — Cerrar vs Archivar, y navegacion persistente por URL.

  Control reproducible sin navegador. COMPLEMENTA a
  tests/h10_routing_cierre_archivo.spec.js; no lo reemplaza.

  Lo que se fija aca:

    1) el cierre operativo viaja por el repositorio canonico y escribe
       estado_coi + fecha_cierre_operativo + observacion_cierre;
    2) el cierre NO toca estado_registro, y el archivo NO toca estado_coi:
       son dos ejes separados;
    3) solo se archiva una OC cerrada, y desarchivar no reabre;
    4) ningun camino de cierre o archivo persiste en localStorage;
    5) los textos son operativos, sin jerga tecnica;
    6) el routing publica e interpreta location.hash con guard de reentrada,
       espera los datos autoritativos antes de abrir una entidad y responde a
       una ruta invalida con un mensaje, no con una pantalla en blanco;
    7) H10 no crea migraciones: los tres campos del cierre y estado_registro
       ya existen y ya estan permitidos por coi_actualizar_orden_integral.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');

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

// Para las verificaciones «esto NO puede aparecer» hay que mirar el codigo,
// no los comentarios: la documentacion interna nombra a proposito los campos
// que el codigo tiene prohibido escribir.
const sinComentarios = (codigo) => codigo
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((linea) => {
    let dentro = '';
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (dentro) { if (c === dentro && linea[i - 1] !== '\\') dentro = ''; continue; }
      if (c === "'" || c === '"' || c === '`') { dentro = c; continue; }
      if (c === '/' && linea[i + 1] === '/') return linea.slice(0, i);
    }
    return linea;
  })
  .join('\n');

const cierre = bloque('coi-h10-cierre-operativo');
const router = bloque('coi-h10-routing-hash');
const archivo = bloque('coi-h09-archivar-oc-supabase');

const cierreCodigo = sinComentarios(cierre);
const routerCodigo = sinComentarios(router);
const archivoCodigo = sinComentarios(archivo);

// ============ 1) el cierre usa el camino canonico existente
check(cierre.indexOf('window.COI_REPOSITORY && window.COI_REPOSITORY.ordenes') >= 0,
  'el cierre tiene que apoyarse en el repositorio canonico de Ordenes');
check(/repo\.actualizar\(uuid, \{\s*\n\s*estado_coi: CERRADA,/.test(cierre),
  'el cierre tiene que escribir estado_coi por el repositorio, no por UPDATE directo');
check(cierre.indexOf('fecha_cierre_operativo: new Date().toISOString().slice(0, 10)') >= 0,
  'fecha_cierre_operativo es una columna date: se envia como fecha');
check(cierre.indexOf('observacion_cierre: texto(motivo)') >= 0,
  'el motivo del cierre tiene que persistirse en observacion_cierre');
check(cierre.indexOf("const CERRADA = 'Cerrada';") >= 0,
  "el valor operativo de cierre es 'Cerrada', del vocabulario ya existente");

// Los tres campos existen en el contrato remoto y estan permitidos por la RPC.
['estado_coi', 'fecha_cierre_operativo', 'observacion_cierre'].forEach((campo) => {
  check(new RegExp(`ALLOWED\\s*=\\s*Object\\.freeze\\(\\[[^\\]]*'${campo}'`).test(html),
    `${campo} tiene que estar entre los campos permitidos de la RPC canonica`);
});

// ============ 2) dos ejes separados
// El payload que cada camino le manda al repositorio es la prueba: leer un
// campo es legitimo, escribirlo es lo que no puede cruzarse.
const payload = (codigo, etiqueta) => {
  const i = codigo.indexOf('repo.actualizar(');
  check(i >= 0, `${etiqueta}: falta la llamada al repositorio canonico`);
  const j = codigo.indexOf('{', i);
  const k = codigo.indexOf('}', j);
  check(j > i && k > j, `${etiqueta}: no se pudo leer el payload`);
  return codigo.slice(j, k + 1);
};

const payloadCierre = payload(cierreCodigo, 'cierre');
check(payloadCierre.indexOf('estado_coi') >= 0, 'el cierre escribe estado_coi');
check(payloadCierre.indexOf('estado_registro') < 0,
  'el cierre NUNCA puede escribir estado_registro: esa columna es el estado de registro');

const payloadArchivo = payload(archivoCodigo, 'archivo');
check(payloadArchivo.indexOf('estado_registro') >= 0, 'archivar escribe estado_registro');
check(payloadArchivo.indexOf('estado_coi') < 0,
  'archivar NUNCA puede escribir estado_coi: es el estado operativo');
check(archivoCodigo.indexOf('await repo.actualizar(uuid, { estado_registro: destino })') >= 0,
  'archivar tiene que escribir solamente estado_registro');
check(cierre.indexOf('ESTADO OPERATIVO / CONTRACTUAL   !=   ESTADO DE REGISTRO') >= 0,
  'la separacion de ejes tiene que quedar documentada en el propio codigo');

// Archivar deja de contar como cierre operativo.
check(cierre.indexOf('if (oc && estaArchivada(oc) && !cerradaOperativa(oc)) return false;') >= 0,
  'una OC archivada y no cerrada no puede leerse como cerrada operativamente');
check(/Compatibilidad: el cierre historico escribia 'Cerrado' en estado_registro/.test(cierre) &&
  cierre.indexOf("if (norm(estadoRegistroDe(i)) === 'CERRADO') return true;") >= 0,
  'el cierre legado en estado_registro tiene que seguir leyendose como cerrado');

// ============ 3) regla de negocio
check(cierre.indexOf("avisar('Primero debe cerrar la OC para enviarla al historial.', 'error')") >= 0,
  'archivar una OC no cerrada tiene que quedar bloqueado');
check(cierre.indexOf('const bloquear = !archivada && !cerrada;') >= 0,
  'el boton de archivar tiene que deshabilitarse mientras la OC no este cerrada');
check(cierre.indexOf('// Desarchivar siempre se permite: no reabre nada.') >= 0,
  'desarchivar no puede quedar bloqueado por la regla de cierre');
check(archivoCodigo.indexOf('ejecutar(ref, ACTIVO)') >= 0,
  'desarchivar solo cambia el estado de registro');

// ============ 4) nada de persistencia local
[['cierre', cierreCodigo], ['router', routerCodigo]].forEach(([nombre, codigo]) => {
  const llamadas = codigo.match(/localStorage\.(setItem|getItem|removeItem)/g) || [];
  check(llamadas.length === 0, `${nombre}: no puede tocar localStorage (encontrado ${llamadas.join(', ')})`);
});
check(cierreCodigo.indexOf('guardarBaseLocal') < 0 && cierreCodigo.indexOf('v59GuardarBase') < 0,
  'el cierre no puede volver a persistir la base local');

// ============ 5) textos operativos
check(archivo.indexOf("'Mueve la OC al historial de archivadas. No se elimina y puede restaurarse.'") >= 0,
  'el tooltip de archivar tiene que ser operativo');
check(archivo.indexOf("'Devuelve la OC al registro consultable sin modificar su estado operativo.'") >= 0,
  'el tooltip de desarchivar tiene que aclarar que no cambia el estado operativo');
check(archivo.indexOf("'OC archivada correctamente.'") >= 0,
  'el aviso de exito tiene que ser el pedido');
check(cierre.indexOf('Finaliza operativamente la OC cuando ya no quedan actividades pendientes.') >= 0,
  'el tooltip de cerrar tiene que explicar que es una finalizacion operativa');
check(!/title[^\n]*Supabase/.test(archivo) && !/title[^\n]*Supabase/.test(cierre),
  'ningun tooltip puede nombrar Supabase al operador');
check(archivo.indexOf('Se va a mover la OC al historial de archivadas.') >= 0,
  'la confirmacion de archivado tiene que estar escrita en terminos operativos');

// El cierre de la cabecera ejecutiva se reencamina al canonico. Su listener
// vive en captura sobre document, asi que el interceptor tiene que estar en
// captura sobre window, que va antes en el recorrido del evento.
check(/window\.addEventListener\('click', \(ev\) => \{[\s\S]{0,400}?execBtnClose[\s\S]{0,200}?window\.cerrarOC\(\);\s*\n\s*\}, true\);/.test(cierre),
  '#execBtnClose tiene que interceptarse en captura sobre window');

// Jerarquia visual: las dos acciones no se leen como equivalentes.
check(cierre.indexOf('h10-sep-historial') >= 0 && cierre.indexOf('h10-accion-historial') >= 0,
  'cerrar y archivar tienen que quedar separadas visualmente');

// ============ 6) routing
check(router.indexOf("location.hash") >= 0 && router.indexOf("addEventListener('hashchange'") >= 0,
  'el routing tiene que publicar e interpretar location.hash');
check(router.indexOf('history.replaceState') >= 0,
  'la normalizacion de ruta no puede ensuciar el historial');
[['inicio', 'vistaDashboard'], ['ordenes', 'vistaOrdenes'], ['red', 'vistaRed'],
  ['um', 'vistaUnidadesMantenimiento'], ['ficha-oc', 'vistaFichaOC']].forEach(([ruta, vista]) => {
  check(router.indexOf(`['${ruta}', '${vista}']`) >= 0, `falta la ruta #${ruta}`);
});
['resumen', 'contractual', 'certificaciones', 'financiero', 'documentos', 'fotos', 'observaciones']
  .forEach((slug) => {
    check(new RegExp(`\\['${slug}', 'panelFicha`).test(router), `falta la subpestaña ${slug}`);
  });
check(router.indexOf("'ordenes/' + modoRegistro()") >= 0,
  'el filtro de estado de registro tiene que viajar en la URL');
check(router.indexOf("'um/servicios'") >= 0,
  'la pestaña de Servicios Tecnicos tiene que viajar en la URL');

// Guard de reentrada: sin esto el routing entra en bucle.
check(router.indexOf('if (aplicando) return;') >= 0 &&
  router.indexOf('if (silencio > 0) { silencio--; return; }') >= 0,
  'tiene que existir guard de reentrada en las dos direcciones');
check(router.indexOf('solicitada = texto(ruta);') >= 0,
  'las rutas que llegan durante una aplicacion se coalescen, no se pierden');

// Primero los datos, despues la entidad.
check(router.indexOf('async function esperarOC(referencia)') >= 0 &&
  router.indexOf('const item = await esperarOC(nro);') >= 0,
  'no se puede abrir una entidad antes de que el modelo pueda resolverla');
check(router.indexOf('function datosListos()') >= 0 &&
  router.indexOf('__COI_H06_ORDENES__') >= 0,
  'la restauracion tiene que apoyarse en la lectura confirmada de Supabase');
check(router.indexOf('await esperarArranque();') >= 0,
  'la ruta se aplica despues del arranque, no durante');

// Una OC archivada se resuelve por URL directa, sin depender del filtro.
check(router.indexOf('window.obtenerOC') >= 0 && router.indexOf('window.resolverOrdenActual') >= 0,
  'la resolucion por URL tiene que usar el mecanismo canonico, no el listado filtrado');

// Ruta invalida.
check(router.indexOf('No se encontró la Orden de Compra solicitada.') >= 0 &&
  router.indexOf('h10VolverAOrdenes') >= 0,
  'una ruta invalida tiene que informar y ofrecer volver a Ordenes');
check(router.indexOf("Sin hash se conserva la landing canonica vigente") >= 0,
  'sin hash se conserva la vista inicial vigente del sistema');

// La vista activa vive en el DOM: observarla cubre todos los caminos.
check(router.indexOf("attributeFilter: ['class']") >= 0,
  'el hash tiene que seguir a la vista real, no solo a mostrarVista');

// `ocActualId` y `estaciones` son bindings lexicos globales, no propiedades de
// window: leerlos solo por window deja las rutas mudas. Ver KI-031.
check(router.indexOf("if (typeof ocActualId !== 'undefined' && texto(ocActualId)) return texto(ocActualId);") >= 0,
  'la OC abierta tiene que leerse del binding lexico, no solo de window');
check(router.indexOf("if (typeof estaciones !== 'undefined' && Array.isArray(estaciones)) return estaciones;") >= 0,
  'las estaciones tienen que leerse del binding lexico, no solo de window');
check(router.indexOf('estacionVigente = texto(s && s.nombre);') >= 0,
  'la estacion abierta se toma del argumento de selectStation, no del titulo del panel');

// ============ 7) sin migraciones
const migraciones = fs.readdirSync('supabase/migrations').filter((f) => /h10/i.test(f));
check(migraciones.length === 0, `H10 no crea migraciones (encontradas: ${migraciones.join(', ')})`);

console.log('H10: cierre operativo, archivo de registro y navegación por URL.');
console.log('  Cerrar       : estado_coi + fecha_cierre_operativo + observacion_cierre, por la RPC canónica');
console.log('  Archivar     : estado_registro, y solo sobre una OC cerrada');
console.log('  Desarchivar  : devuelve al registro activo sin reabrir la contratación');
console.log('  Routing      : location.hash con guard de reentrada y datos antes que entidad');
console.log('  Migraciones  : H10 no crea ninguna');
console.log(`${aprobados} controles H10 aprobados; 0 fallidos.`);
