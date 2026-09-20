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
    7) H10 no crea columnas ni tablas. La revisión final agrega un guard
       PostgreSQL de ciclo de vida para atomicidad e inmutabilidad del cierre.
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
check(router.indexOf('rutaNecesitaCatalogoOrdenes(inicial) ? await esperarArranque() : true') >= 0,
  'solo las rutas de Ficha OC deben esperar el catálogo de Órdenes en startup');

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
check(/const listo = rutaNecesitaCatalogoOrdenes\(inicial\) \? await esperarArranque\(\) : true/.test(routerCodigo),
  'restaurar tiene que esperar Órdenes solo cuando la ruta realmente usa ese catálogo');
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

// ============ 9) segunda revision Codex sobre el PR #64
// Controles de FORMA, complementarios de los casos DOM H10-44..H10-55.

// P1 · el cierre legacy se canonicaliza ANTES de archivar.
check(/function cierreSoloLegacy\(item\)/.test(cierreCodigo),
  'hace falta detectar el cierre legacy-only antes de archivarlo');
check(/async function canonicalizarCierreLegacy\(referencia\)/.test(cierreCodigo),
  'el cierre legacy tiene que preservarse en su eje propio antes del archivado');
const cuerpoCanon = cierreCodigo.slice(
  cierreCodigo.indexOf('async function canonicalizarCierreLegacy'),
  cierreCodigo.indexOf('function guardarArchivado'));
check(/repo\.actualizar\(uuid, \{ estado_coi: CERRADA \}\)/.test(cuerpoCanon),
  'la canonicalizacion tiene que escribir SOLO estado_coi por el repositorio');
check(cuerpoCanon.indexOf('fecha_cierre_operativo') < 0 &&
      cuerpoCanon.indexOf('observacion_cierre') < 0,
  'no se inventa fecha ni observacion de un cierre que nadie registro');
check(cuerpoCanon.indexOf('return false;') >= 0,
  'si la canonicalizacion falla no se archiva: fail closed');
// Solo hacia el historial, y solo si el marcador es legacy-only.
check(/if \(item && !estaArchivada\(item\)\) \{/.test(cierreCodigo),
  'la canonicalizacion solo corre cuando la OC va hacia el historial');
// Que la funcion exista no alcanza: el guard tiene que LLAMARLA y respetar su
// resultado, o el archivado sigue destruyendo la evidencia del cierre.
check(/const preservado = await canonicalizarCierreLegacy\(ref\);/.test(cierreCodigo),
  'el guard de archivado tiene que llamar a la canonicalizacion');
check(/if \(!preservado\) return false;/.test(cierreCodigo),
  'si el cierre no se pudo preservar, el archivado se corta');
check(/if \(!item \|\| !cierreSoloLegacy\(item\)\) return true;/.test(cuerpoCanon),
  'una OC ya cerrada canonicamente no puede pagar una escritura extra');

// P2 · la ruta de ficha UM no depende del catalogo de Ordenes.
check(routerCodigo.indexOf('function rutaNecesitaCatalogoOrdenes(ruta)') >= 0,
  'el router debe clasificar las rutas que realmente dependen de Ordenes');
const gateArranque = routerCodigo.slice(routerCodigo.indexOf('function rutaNecesitaCatalogoOrdenes(ruta)'));
check(gateArranque.slice(0, 650).indexOf("cabeza.value === 'ficha-oc'") >= 0,
  'solo ficha-oc con identidad puede depender del catalogo de Ordenes');
check(gateArranque.slice(0, 650).indexOf("cabeza.value === 'ficha-um'") < 0,
  'ficha-um NO puede depender del snapshot de Ordenes: su autoridad es H05');

// P2 · Reintentar relee de verdad, por el camino canonico de cada modulo.
const cuerpoReintento = routerCodigo.slice(
  routerCodigo.indexOf("if (t.closest('#h10ReintentarCatalogo')"),
  routerCodigo.indexOf("if (t.closest('#h09Tabs"));
check(cuerpoReintento.indexOf("window.recargarDatosDesdeSupabase({ silencioso: true })") >= 0,
  'reintentar el catalogo tiene que releer por el camino canonico de Ordenes');
check(cuerpoReintento.indexOf('window.recargarUnidadesMantenimiento()') >= 0,
  'reintentar UM tiene que releer por el camino canonico de UM');
check(cuerpoReintento.indexOf('await aplicar(ruta)') >= 0,
  'la ruta pedida se reaplica DESPUES de la relectura');
check(cuerpoReintento.indexOf('location.reload') < 0 && cuerpoReintento.indexOf('localStorage') < 0,
  'reintentar no puede recargar la pagina ni leer localStorage');
check(cuerpoReintento.indexOf('.from(') < 0,
  'reintentar no puede abrir una lectura paralela a la tabla');

// P2 · #red limpia el contexto de estacion.
check(/function limpiarEstacion\(\)/.test(routerCodigo),
  'volver a la Red general necesita un reset explicito de estacion');
check(/estacionVigente = '';/.test(routerCodigo),
  'la estacion vigente tiene que limpiarse');
check(/panel\.classList\.remove\('active'\)/.test(routerCodigo),
  'el panel de estacion tiene que dejar de estar activo en la Red general');
check(/if \(cabeza === 'red' && !decodificados\[1\]\) \{/.test(routerCodigo),
  'la ruta exacta #red tiene que limpiar el contexto antes de abrir la vista');

// P2 · el filtro de registro vive en el renderer canonico.
const htmlSinComentarios = sinComentarios(html);
check(/function obtenerOrdenesFiltradas\(\)\{[\s\S]{0,200}coiFiltrarPorRegistro\(\[\.\.\.getRowsFinal\(\)\]\)/.test(htmlSinComentarios),
  'obtenerOrdenesFiltradas tiene que aplicar el filtro de estado de registro');
check(/function coiEstadoRegistroDeFila\(row\)/.test(htmlSinComentarios),
  'el estado de registro tiene que leerse con sus alias reales');
for (const alias of ['r.estadoRegistro', 'r.estado_registro', '_supabaseRaw&&r._supabaseRaw.estado_registro']) {
  check(htmlSinComentarios.indexOf(alias) >= 0, `falta el alias ${alias} del estado de registro`);
}
check(/const archivada=\(r\)=>\['ARCHIVADO','ARCHIVADA'\]\.includes\(coiEstadoRegistroDeFila\(r\)\);/.test(htmlSinComentarios),
  'el filtro de registro reconoce Archivado y la variante histórica Archivada');
check(/if\(modo==='archivadas'\)return rows\.filter\(archivada\);/.test(htmlSinComentarios),
  'archivadas incluye exclusivamente ambos marcadores archivados');
check(/return rows\.filter\(r=>!archivada\(r\)\);/.test(htmlSinComentarios),
  'activas excluye ambos marcadores archivados');
check(/if\(modo==='todas'\)return rows;/.test(htmlSinComentarios),
  'todas no filtra por estado de registro');

// CI · el DOM temporal del router se retira al salir del error.
check(/const IDS_ESTADO_RUTA = \[/.test(routerCodigo),
  'los estados del router tienen que estar enumerados para poder retirarlos');
check(/function limpiarDOMEstadoRuta\(\)/.test(routerCodigo),
  'hace falta retirar el nodo del estado de error, no solo taparlo');
check(/function limpiarRutaError\(\) \{ rutaError = ''; limpiarDOMEstadoRuta\(\); \}/.test(routerCodigo),
  'limpiar la ruta de error tiene que limpiar tambien su DOM');
for (const id of ['h10RutaInvalida', 'h10CatalogoNoDisponible', 'h10OCNoEncontrada',
                  'h10UMNoDisponible', 'h10UMNoEncontrada']) {
  check(routerCodigo.indexOf("'" + id + "'") >= 0, `${id} tiene que poder retirarse del DOM`);
}
// Se retira el nodo del estado, no el contenedor de la ficha.
check(routerCodigo.indexOf("removeChild(nodo)") >= 0 &&
      !/fichaOCBody'\)\.innerHTML = ''/.test(routerCodigo),
  'la limpieza no puede destruir una Ficha OC normal');

// ============ 7) hardening PostgreSQL, sin tablas ni columnas nuevas
const migraciones = fs.readdirSync('supabase/migrations').filter((f) => /h10/i.test(f));
check(migraciones.length === 1 && migraciones[0] === '202609070001_h10_order_lifecycle_guard.sql',
  `H10 requiere exactamente su migracion de guard (encontradas: ${migraciones.join(', ')})`);
const h10Sql = fs.readFileSync('supabase/migrations/202609070001_h10_order_lifecycle_guard.sql', 'utf8');
check(/before update of fecha_cierre_operativo, observacion_cierre/i.test(h10Sql),
  'la auditoria de cierre tiene un guard BEFORE UPDATE');
check(/before update of estado_coi, estado_registro/i.test(h10Sql),
  'estado operativo y archivo tienen un guard BEFORE UPDATE');
check(h10Sql.indexOf('COI_CLOSURE_IMMUTABLE') >= 0 && h10Sql.indexOf('COI_ARCHIVE_REQUIRES_CLOSED_ORDER') >= 0,
  'PostgreSQL protege primer cierre y cierre-antes-de-archivo');
check(!/create\s+table|alter\s+table[^;]*add\s+column/i.test(h10Sql),
  'H10 no agrega tablas ni columnas');

// ============ 10) revisión final Codex — invariantes de ciclo de vida
check(cierreCodigo.indexOf('leerCierreRemoto') < 0,
  'el cierre no puede hacer SELECT previo + UPDATE: la atomicidad vive en la transaccion PostgreSQL');
check(cierreCodigo.indexOf('COI_CLOSURE_IMMUTABLE') >= 0,
  'el frontend reconoce el conflicto atomico y refresca el primer cierre');
check(html.indexOf("const EDITOR_BLOCKED=new Set(['estado_registro','fecha_cierre_operativo','observacion_cierre'])") >= 0,
  'el editor separa campos de transicion de la allowlist del repositorio');
check(/for\(const name of EDITOR_FIELDS\)/.test(html),
  'saveEditor solo recorre campos realmente editables');
check(!/\['Gestión COI',\[[^\]]*'estado_registro'/.test(html),
  'estado_registro no puede editarse desde Gestion COI');
check(html.indexOf("['Cierre',['fecha_cierre_operativo','observacion_cierre']]") < 0,
  'fecha y observacion de cierre no se renderizan como inputs genericos');
check(/function validarLifecycleEditor\(current,baseline\)/.test(html),
  'el editor bloquea entrar/salir de Cerrada por el formulario generico');
check(/if \(!id\) \{[\s\S]{0,220}?vistaUnidadesMantenimiento[\s\S]{0,120}?aplicarTabUM\('inventario'\)/.test(routerCodigo),
  '#ficha-um sin id vuelve al inventario');

console.log('H10: cierre operativo, archivo de registro y navegación por URL.');
console.log('  Cerrar       : estado_coi + fecha_cierre_operativo + observacion_cierre, por la RPC canónica');
console.log('  Archivar     : estado_registro, y solo sobre una OC cerrada');
console.log('  Desarchivar  : devuelve al registro activo sin reabrir la contratación');
console.log('  Routing      : location.hash con guard de reentrada y datos antes que entidad');
console.log('  Migraciones  : 1 guard H10; sin tablas ni columnas nuevas');
console.log('  Codex #64    : cierre explícito, puerta única de archivado, fecha local,');
console.log('                 espera UM, error != inexistente, not-found sin identidad stale,');
console.log('                 hash malformado con estado visible');
console.log(`${aprobados} controles H10 aprobados; 0 fallidos.`);

// ============ 10) cierre final de review — invariantes de navegación/lifecycle
check(cierreCodigo.indexOf('function coincideMutacionExacta(item, referencia)') >= 0,
  'Cerrar/Archivar deben resolver identidad exacta antes de mutar');
check(cierreCodigo.indexOf('No se pudo identificar una OC exacta para archivar') >= 0,
  'el archivo debe fallar cerrado ante una referencia ambigua');
check(html.indexOf("reg.value='activas'") >= 0,
  'Limpiar filtros debe restablecer el filtro de registro a Activas');
check(html.indexOf("Archivar no es un estado operativo. Use «Archivar OC»") >= 0,
  'el editor debe rechazar Archivada/Archivado en estado_coi');
check(html.indexOf('[COI][ORDENES][UPDATE][POST_COMMIT_SYNC]') >= 0,
  'un refresh posterior al commit debe quedar como advertencia y no como rollback falso');
check(routerCodigo.indexOf("document.addEventListener('keydown', observarNavegacionUsuario, true)") >= 0,
  'el routing debe reconocer navegación originada por teclado');
check(routerCodigo.indexOf("if (!restaurando && !aplicando && !reintentando && !tecladoConIntencion) return;") >= 0,
  'la intención del operador debe cancelar restauración/aplicación y el teclado con destino debe contar incluso antes del restore');
check(routerCodigo.indexOf('let versionAplicacion = 0;') >= 0 &&
      routerCodigo.indexOf('function aplicacionObsoleta(version)') >= 0,
  'las rutas asincrónicas necesitan versionado para descartar aplicaciones obsoletas');
check(routerCodigo.indexOf("if (!vista) { mostrarRutaInvalida(crudo); return; }") >= 0,
  'un nombre de ruta desconocido debe mostrar estado inválido, no caer silenciosamente a Inicio');
check(routerCodigo.indexOf("const panel = panelDe(slug) || panelDe('resumen');") >= 0,
  'una subpestaña OC desconocida debe caer explícitamente en Resumen');
check(routerCodigo.indexOf('function estadoCatalogoOrdenes()') >= 0 &&
      routerCodigo.indexOf("estadoCatalogo === 'error'") >= 0,
  'la ausencia de una OC solo puede afirmarse con una lectura actual confirmada');

check(routerCodigo.indexOf("document.addEventListener('keydown', observarNavegacionUsuario, true);") >= 0,
  'H10 debe capturar Enter/Espacio antes del handler V2 durante una ruta pendiente');
check(routerCodigo.indexOf('ev.stopImmediatePropagation();') >= 0,
  'la intención de teclado H10 debe impedir que el handler legacy vuelva a sintetizar navegación');


// ============ 11) review final pre-merge PR #64
const bootstrapInicio = html.slice(
  html.indexOf('function bootstrapSupabasePrincipal()'),
  html.indexOf('window.initSupabase = initSupabase;'));
check(bootstrapInicio.length > 0,
  'se debe poder inspeccionar el bootstrap principal de Supabase');
check(bootstrapInicio.indexOf("fallbackLocalStorageSiFallaSupabase('Inicializando Supabase como fuente principal.')") < 0,
  'inicializar Supabase no puede marcar el catálogo como error antes del primer intento remoto');
check(/vaciarOrdenesEnMemoria\(\);[\s\S]{0,420}ordenesLecturaEstado = 'pendiente';[\s\S]{0,120}initSupabase\(\);/.test(bootstrapInicio),
  'el catálogo debe permanecer pendiente hasta que initSupabase resuelva éxito o error real');
check(cierreCodigo.indexOf("const BOTONES_CERRAR = ['btnCerrarOCFicha', 'btnCerrarOCFichaTop', 'btnCerrarOC', 'execBtnClose'];") >= 0,
  'el botón ejecutivo de cierre debe sincronizar texto, disabled y estado con los demás botones H10');


// ============ 12) cierre de los tres P2 posteriores al Quality Gate verde
check(h10Sql.indexOf("v_new_registro in ('ARCHIVADO', 'ARCHIVADA')") >= 0,
  'PostgreSQL debe reconocer ambas grafías archivadas al aplicar el lifecycle guard');
check(h10Sql.indexOf("v_new_registro = 'ARCHIVADA'") >= 0 &&
      h10Sql.indexOf('COI_ARCHIVE_STATE_CANONICAL_REQUIRED') >= 0,
  'una escritura nueva con Archivada debe rechazarse y exigir Archivado canónico');
check(cierreCodigo.indexOf("['ARCHIVADO','ARCHIVADA'].includes(norm(estadoRegistroDe(item)))") >= 0,
  'H10 debe leer Archivada histórica como archivada, no como activa');
check(archivoCodigo.indexOf("['ARCHIVADO','ARCHIVADA'].includes(norm(estadoRegistro(item)))") >= 0,
  'H09 debe leer Archivada histórica como archivada, no como activa');
check(archivoCodigo.indexOf('salida.resultado && salida.resultado.warnings') >= 0 &&
      archivoCodigo.indexOf("advertencias.join(' '), 'warning'") >= 0,
  'archivar/desarchivar debe propagar warnings de resincronización post-commit');
check(routerCodigo.indexOf('let reintentando = false;') >= 0,
  'el router debe modelar explícitamente una relectura de retry en vuelo');
check(routerCodigo.indexOf('navegacionUsuario !== versionUsuarioReintento || hashActual() !== hashReintento') >= 0,
  'un retry debe descartarse si el operador navegó durante la relectura');
check(routerCodigo.indexOf('aplicando || restaurando || reintentando') >= 0,
  'los repintados automáticos no pueden publicar una ruta transitoria durante retry');

console.log('H10 final review guards: OK');

check(cierreCodigo.indexOf('function guardarDesarchivado(fn, contexto)') >= 0,
  'desarchivar debe exigir identidad exacta antes de mutar');
check(cierreCodigo.indexOf("api.desarchivar = guardarDesarchivado(api.desarchivar, 'COI_ARCHIVO_OC_H09.desarchivar')") >= 0,
  'el export H09 desarchivar debe usar el mismo guard de identidad exacta');
console.log('H10 desarchive exact-identity final guard: OK');
