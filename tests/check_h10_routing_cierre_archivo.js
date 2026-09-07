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
// Columna date: se envia como fecha, y la fecha es la del CALENDARIO del
// operador. La forma con toISOString que habia aca fijaba el bug del finding 3.
check(cierre.indexOf('fecha_cierre_operativo: fechaLocalISO()') >= 0,
  'fecha_cierre_operativo es una columna date y se envia con la fecha local, no UTC');
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
// El envoltorio usa el predicado LAXO a proposito: corrige una lectura
// historica de presentacion y no decide elegibilidad de archivado. La
// elegibilidad la decide cerradaOperativa, que desde el finding 1 solo
// reconoce cierres explicitos.
check(cierre.indexOf('if (oc && estaArchivada(oc) && !cierreLaxoHistorico(oc)) return false;') >= 0,
  'una OC archivada y sin ningun marcador de cierre no puede leerse como cerrada');
check(/Compatibilidad: el cierre historico escribia 'Cerrado' en estado_registro/.test(cierre) &&
  cierre.indexOf("if (norm(estadoRegistroDe(i)) === 'CERRADO') return true;") >= 0,
  'el cierre legado en estado_registro tiene que seguir leyendose como cerrado');

// ============ 3) regla de negocio
check(cierre.indexOf("avisar('Primero debe cerrar la OC para enviarla al historial.', 'error')") >= 0,
  'archivar una OC no cerrada tiene que quedar bloqueado');
check(cierre.indexOf('const bloquear = !archivada && !cerrada;') >= 0,
  'el boton de archivar tiene que deshabilitarse mientras la OC no este cerrada');
// El guard unificado del finding 2 deja pasar lo ya archivado: des/rearchivar
// no reabre nada y no escribe estado_coi.
check(cierre.indexOf('if (estaArchivada(item)) return true;') >= 0,
  'desarchivar no puede quedar bloqueado por la regla de cierre');
check(cierre.indexOf('Desarchivar NO se toca') >= 0,
  'la excepcion de desarchivado tiene que quedar documentada en el codigo');
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

// ============ 8) revision Codex sobre el PR #64 — 7 findings
//
// Cada control de este bloque esta escrito para FALLAR si se restaura la
// conducta anterior. La no-vacuidad esta comprobada: revertir el fix
// correspondiente rompe el control indicado.

// --- F1 (P1) · solo un cierre EXPLICITO habilita archivar -------------------
// Reintroducir FINALIZAD/DEFINITIVA en cerradaOperativa rompe estos controles.
const cuerpoCerrada = cierreCodigo.slice(
  cierreCodigo.indexOf('function cerradaOperativa(item)'),
  cierreCodigo.indexOf('function cierreLaxoHistorico'));
check(cuerpoCerrada.length > 0, 'no se encontro el predicado de cierre explicito');
check(cuerpoCerrada.indexOf('FINALIZAD') < 0,
  'FINALIZADA no es un cierre explicito: describe el fin del circuito tecnico, no el acto de cerrar');
check(cuerpoCerrada.indexOf('DEFINITIVA') < 0,
  'DEFINITIVA no es un cierre explicito');
check(cuerpoCerrada.indexOf('estadoDocumental') < 0 && cuerpoCerrada.indexOf('estadoVigenciaOperativa') < 0,
  'el estado documental y el de vigencia no pueden decidir un cierre operativo');
// Igualdad exacta, no «contiene»: «Cerrada parcialmente» no cierra nada.
check(/ESTADOS_CIERRE_EXPLICITO\.indexOf\(estado\) >= 0/.test(cuerpoCerrada),
  'el estado de cierre tiene que compararse por igualdad exacta, no por inclusion');
check(/ESTADOS_CIERRE_EXPLICITO = \['CERRADA', 'CERRADO'\]/.test(cierreCodigo),
  'los unicos estados de cierre explicito son Cerrada/Cerrado');
// Los tres marcadores canonicos siguen contando.
check(cuerpoCerrada.indexOf("norm(estadoRegistroDe(i)) === 'CERRADO'") >= 0,
  'compatibilidad historica: estado_registro = Cerrado sigue siendo cierre');
check(cuerpoCerrada.indexOf('fecha_cierre_operativo') >= 0,
  'fecha_cierre_operativo es marcador de cierre explicito');
// El predicado laxo sobrevive, pero SOLO para la lectura historica de
// presentacion: no puede tocar la elegibilidad de archivar.
check(cierreCodigo.indexOf('cierreLaxoHistorico(oc)') >= 0,
  'el predicado laxo solo se usa en el envoltorio de estaOCCerrada');
check(cierreCodigo.indexOf('!cierreLaxoHistorico') >= 0,
  'el envoltorio de estaOCCerrada tiene que usar el predicado laxo');

// --- F2 (P1) · una sola puerta de archivado --------------------------------
// Quitar el guard del export de H09 rompe estos controles.
check(/function puedeArchivar\(referencia\)/.test(cierreCodigo),
  'tiene que existir UNA funcion de elegibilidad de archivado');
check(/window\.archivarOC = guardarArchivado\(/.test(cierreCodigo),
  'window.archivarOC tiene que pasar por el guard');
check(/api\.archivar = guardarArchivado\(/.test(cierreCodigo),
  'COI_ARCHIVO_OC_H09.archivar tiene que pasar por el mismo guard');
check(/protegerExportH09\(\);/.test(cierreCodigo),
  'el export de H09 tiene que protegerse al instalar');
// H09 se reinstala en varios tiempos: el guard tiene que cubrir cada
// reinstalacion o la puerta se reabre sola.
check(/\[0, 450, 1600, 3100, 6100\]\.forEach/.test(cierreCodigo),
  'el guard tiene que reaplicarse tras cada reinstalacion de H09');
check(cuerpoCerrada.indexOf('estado_registro') < 0,
  'el predicado de cierre no puede decidirse por estado_registro archivado');
// Self-review: en H09 las unicas entradas publicas que emiten ARCHIVADO son
// archivarOC y el export. desarchivarOC/restaurarOC solo emiten ACTIVO.
const emisoresArchivado = (archivoCodigo.match(/ejecutar\([^)]*ARCHIVADO/g) || []).length;
check(emisoresArchivado === 2,
  `se esperaban 2 emisores de ARCHIVADO en H09 (archivarOC y el export) y hay ${emisoresArchivado}`);
check(/window\.desarchivarOC = function/.test(archivoCodigo) &&
      !/desarchivarOC[\s\S]{0,200}ARCHIVADO/.test(archivoCodigo),
  'desarchivar no puede emitir ARCHIVADO: sacar del historial no reabre nada');

// --- F3 (P2) · fecha de cierre en calendario local -------------------------
// Volver a toISOString() rompe este control.
check(/function fechaLocalISO\(fecha\)/.test(cierreCodigo),
  'la fecha de cierre necesita un constructor con componentes locales');
check(/getFullYear\(\)[\s\S]{0,80}getMonth\(\) \+ 1[\s\S]{0,80}getDate\(\)/.test(cierreCodigo),
  'la fecha local se arma con getFullYear/getMonth/getDate, no con UTC');
check(cierreCodigo.indexOf('fecha_cierre_operativo: fechaLocalISO()') >= 0,
  'el cierre tiene que grabar la fecha del calendario del operador');
check(cierreCodigo.indexOf('toISOString') < 0,
  'toISOString convierte a UTC: en UTC-3 el cierre nocturno quedaba con la fecha del dia siguiente');

// --- F4 (P2) · la ruta UM espera el snapshot autoritativo ------------------
// Quitar esperarUM rompe estos controles.
check(/async function esperarUM\(id\)/.test(routerCodigo),
  'la ruta de ficha UM necesita su propia espera de snapshot');
check(routerCodigo.indexOf('__COI_UM_H05__') >= 0,
  'la espera de UM tiene que mirar el estado autoritativo que publica H05');
check(/h05\.sincronizado === true/.test(routerCodigo),
  'solo se resuelve la ficha UM con sincronizacion confirmada');
check(/const um = await esperarUM\(id\);/.test(routerCodigo),
  'la ruta ficha-um tiene que esperar antes de abrir');
for (const estado of ["'error'", "'ausente'"]) {
  check(routerCodigo.indexOf('um.estado === ' + estado) >= 0,
    `la ruta UM tiene que distinguir el estado ${estado}`);
}
check(/function mostrarUMNoEncontrada\(id\)/.test(routerCodigo),
  'una UM inexistente con remoto confirmado necesita su propio estado');
// Sin fallback local: H05/H06 dejaron Supabase como unica autoridad.
const cuerpoEsperarUM = routerCodigo.slice(
  routerCodigo.indexOf('function estadoUM()'),
  routerCodigo.indexOf('function mostrarErrorUM'));
check(cuerpoEsperarUM.indexOf('localStorage') < 0,
  'la espera de UM no puede caer a localStorage');

// --- F5 (P2) · error remoto no es entidad inexistente ----------------------
// Convertir el error en not-found rompe estos controles.
check(/function mostrarErrorCatalogo\(ruta\)/.test(routerCodigo),
  'un fallo de sincronizacion necesita su propio estado, distinto del not-found');
check(routerCodigo.indexOf('No se pudo cargar el catálogo de Órdenes desde el servidor.') >= 0,
  'el mensaje de fallo de catalogo tiene que ser explicito');
check(/if \(!datosListos\(\)\) \{ mostrarErrorCatalogo\(crudo\); return; \}/.test(routerCodigo),
  'no se puede afirmar que la OC no existe sin una lectura remota confirmada');
// restaurar() deja de ignorar el resultado de esperarArranque.
check(/const listo = await esperarArranque\(\);/.test(routerCodigo),
  'restaurar tiene que mirar el resultado de esperarArranque');
check(/if \(!listo\)/.test(routerCodigo),
  'un arranque sin datos autoritativos no puede seguir como si los tuviera');

// --- F6 (P2) · el not-found no conserva la OC anterior ---------------------
// Dejar la identidad stale rompe estos controles.
check(/let rutaError = '';/.test(routerCodigo),
  'los estados de error necesitan identidad de ruta propia');
check(/if \(rutaError\) return rutaError;/.test(routerCodigo),
  'rutaVigente tiene que devolver la ruta del estado de error, no la anterior');
const cuerpoNoEncontrada = routerCodigo.slice(routerCodigo.indexOf('function mostrarNoEncontrada(nro)'));
check(/fijarRutaError\('ficha-oc\/' \+ encodeURIComponent\(texto\(nro\)\)\)/.test(cuerpoNoEncontrada),
  'el not-found tiene que fijar como ruta la OC PEDIDA');
check(/limpiarRutaError\(\);/.test(routerCodigo),
  'al salir del estado de error hay que limpiar su identidad de ruta');
// No se muta el binding global: es compartido con la ficha y fragil.
check(routerCodigo.indexOf('window.ocActualId =') < 0,
  'el router no puede mutar ocActualId para arreglar la URL');

// --- F7 (P2) · hash malformado tiene estado visible ------------------------
// Volver a decodeURIComponent directo rompe estos controles.
check(/function safeDecode\(segmento\)/.test(routerCodigo),
  'la decodificacion de segmentos tiene que ser segura');
check(/return \{ ok: true, value: decodeURIComponent\(bruto\) \};/.test(routerCodigo) &&
      /catch \(e\) \{ return \{ ok: false, value: '' \}; \}/.test(routerCodigo),
  'safeDecode tiene que devolver un resultado estructurado, no lanzar');
check(/function mostrarRutaInvalida\(hashCrudo\)/.test(routerCodigo),
  'un hash malformado necesita un estado visible');
check(routerCodigo.indexOf('No se pudo interpretar la dirección solicitada.') >= 0,
  'el mensaje de ruta invalida tiene que ser explicito');
check(/if \(!d\.ok\) \{ mostrarRutaInvalida\(crudo\); return; \}/.test(routerCodigo),
  'cualquier segmento invalido tiene que cortar la aplicacion de la ruta');
// Ninguna llamada cruda queda en la aplicacion de rutas.
const decodesCrudos = (routerCodigo.match(/decodeURIComponent\(/g) || []).length;
check(decodesCrudos === 1,
  `solo safeDecode puede llamar a decodeURIComponent y hay ${decodesCrudos} llamadas`);

// ============ 7) sin migraciones
const migraciones = fs.readdirSync('supabase/migrations').filter((f) => /h10/i.test(f));
check(migraciones.length === 0, `H10 no crea migraciones (encontradas: ${migraciones.join(', ')})`);

console.log('H10: cierre operativo, archivo de registro y navegación por URL.');
console.log('  Cerrar       : estado_coi + fecha_cierre_operativo + observacion_cierre, por la RPC canónica');
console.log('  Archivar     : estado_registro, y solo sobre una OC cerrada');
console.log('  Desarchivar  : devuelve al registro activo sin reabrir la contratación');
console.log('  Routing      : location.hash con guard de reentrada y datos antes que entidad');
console.log('  Migraciones  : H10 no crea ninguna');
console.log('  Codex #64    : cierre explícito, puerta única de archivado, fecha local,');
console.log('                 espera UM, error != inexistente, not-found sin identidad stale,');
console.log('                 hash malformado con estado visible');
console.log(`${aprobados} controles H10 aprobados; 0 fallidos.`);
