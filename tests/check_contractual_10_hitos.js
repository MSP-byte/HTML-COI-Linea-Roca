#!/usr/bin/env node
'use strict';

/*
  SEGUIMIENTO CONTRACTUAL — invariantes de arquitectura (estático).

  El comportamiento se prueba en tests/contractual_10_hitos.spec.js contra el
  camino real. Esto fija las decisiones de arquitectura que hacen posible ese
  comportamiento, para que no vuelvan a romperse en silencio:

  1. UN resolver canónico de OC (exacto) exportado y usado por writer, lectura
     del historial y pipeline. La causa raíz del bug de 4530009514 fue que el
     pipeline llamaba a window.resolverOrdenActual, que en producción no
     existe: la reconciliación fabricaba un objeto {} sin nro_oc.
  2. UN resolver canónico de N° OC (prioriza el nro_oc persistido).
  3. UNA caché de historial, en memoria, sin almacenamiento del navegador y
     sin una segunda Map paralela en el pipeline.
  4. Lecturas completas (paginadas) y protegidas contra snapshots viejos.
  5. El modelo de 10 hitos lógicos.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');

let aprobados = 0;
const check = (ok, detalle) => { if (!ok) throw new assert.AssertionError({ message: detalle }); aprobados++; };
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');

const html = fs.readFileSync('index.html', 'utf8');

// ---------------------------------------------------------------- circuito r12
const ini = html.indexOf('const CIRCUITO_ADMINISTRATIVO_ETAPAS=[');
const fin = html.indexOf('window.__COI_CIRCUITO_CACHE_MERGE__=fusionarHistorialCircuitoConfirmado;', ini);
check(ini > 0 && fin > ini, 'no se encontró el módulo del circuito contractual');
const circuito = sinComentarios(html.slice(ini, fin + 80));

check(/function resolverOrdenCircuito\(ref\)\{/.test(circuito), 'falta el resolver canónico de OC del circuito');
check(/window\.resolverOrdenCircuito=resolverOrdenCircuito;/.test(circuito),
  'el resolver canónico tiene que estar exportado: el pipeline vive en otro script');
check(!/keyOfOrder\(o\)\.includes\(key\)/.test(circuito.slice(circuito.indexOf('function resolverOrdenCircuito'), circuito.indexOf('function detalleErrorCircuito'))),
  'el resolver canónico no puede coincidir por subcadena');
check(/return normOC\(\(raw&&clean\(raw\.nro_oc\)\)\|\|field\(item,'nro_oc','numeroOC','oc','OC_NRO','ocNro'\)/.test(circuito),
  'nroOCCircuito prioriza el nro_oc persistido y acepta un objeto con solo nro_oc');
const lectura = circuito.slice(circuito.indexOf('async function cargarHistorialCircuitoOC'), circuito.indexOf('function obtenerEstadoVisualEtapa'));
check(/const resolved=resolverOrdenCircuito\(orden\);/.test(lectura) && /const nro=nroOCCircuito\(resolved\)\|\|nroOCCircuito\(orden\);/.test(lectura),
  'la lectura del historial usa el resolver y la clave canónicos');
check(/if\(!nro\)return\[\];/.test(lectura), 'nunca se consulta el historial con una clave vacía');
check(/\.eq\('nro_oc',nro\)/.test(lectura) && /\.range\(desde,desde\+PAGINA_HISTORIAL_CIRCUITO-1\)/.test(lectura),
  'la lectura es completa y paginada: una OC con historial largo no pierde sus últimos eventos');
check(/if\(generacionHistorialCircuito\.get\(nro\)!==generacion\)/.test(lectura),
  'una lectura vieja no puede pisar una confirmación posterior');
check(!/sessionStorage|localStorage/.test(circuito), 'la caché contractual no puede persistirse en el navegador');
check(!/CIRCUITO_CACHE_KEY/.test(circuito), 'no puede volver la caché de historial en sessionStorage');
check((circuito.match(/new Map\(\)/g) || []).length === 2,
  'el circuito tiene exactamente la caché de historial y su contador de generación');
check(!/resolverOrdenActual\(/.test(circuito.slice(circuito.indexOf('function fusionarHistorialCircuitoConfirmado'))),
  'el writer, la lectura y el render del circuito usan el resolver canónico');

// ---------------------------------------------------------------- R28 writer
const r28Ini = html.indexOf('async function actualizarEstadoDocumentalDesdePasoContractualR28(');
const r28 = html.slice(r28Ini, html.indexOf('\n  function renderCTCard', r28Ini));
check(/setEstadoDocumentalLocal\(oc,result\.data\.nombre\|\|estado,result\.data\.orden\.fecha_ultimo_control\)/.test(r28),
  'la fecha_ultimo_control local es la del servidor, no el reloj del navegador');
check(/typeof window\.resolverOrdenCircuito==='function'/.test(html.slice(html.indexOf('  function findOrder(ref){'), html.indexOf('  function findOrder(ref){') + 800)),
  'R28 resuelve la OC por el resolver canónico');

// ---------------------------------------------------------------- pipeline
const pIni = html.indexOf('<script id="coi-etapa1-pipeline-contractual">');
const pipeline = sinComentarios(html.slice(pIni, html.indexOf('</' + 'script>', pIni)));
check(!/historialLocal/.test(pipeline), 'el pipeline no puede tener una segunda caché de historial');
check(/function ordenDe\(nro\) \{\s*try \{ return resolverOrdenPipeline\(nro\); \}/.test(pipeline),
  'el pipeline resuelve la OC por el resolver canónico');
check(/for \(const nombre of \['resolverOrdenCircuito', 'resolverOrdenActual'\]\)/.test(pipeline),
  'el resolver canónico tiene prioridad sobre el genérico');
check(/const destino = orden && typeof orden === 'object' \? orden : null;\s*if \(!destino\) return null;/.test(pipeline),
  'la reconciliación nunca fabrica un objeto vacío sin nro_oc');
check(/if \(!nroNuevo \|\| \(nroMontado && nroMontado!==nroNuevo\)\) return false;/.test(pipeline),
  'nunca se repinta sin N° OC ni con otra OC');
check(/if \(!orden\) \{/.test(pipeline.slice(pipeline.indexOf('async function abrirModal'))),
  'sin OC resuelta no se abre el modal con una fecha por defecto falsa');
check(/const TOTAL_HITOS_LOGICOS = 10;/.test(pipeline), 'el contador es global sobre 10 hitos lógicos');
check(/estado\.registradosCount \+ ' \/ ' \+ estado\.total/.test(pipeline), 'se muestra X / 10');
check(/Existen hitos intermedios sin registrar\./.test(pipeline), 'un salto de hitos se advierte');
check(/const VENTANA_ESPEJO_MS = 5000;/.test(pipeline), 'la fila espejo no duplica una transición');
check(!/localStorage|sessionStorage/.test(pipeline), 'el pipeline no usa almacenamiento del navegador');
check(/pestanaActiva\.set\(nroTab, destino\);/.test(pipeline), 'la pestaña activa sobrevive a un repintado');

console.log('Seguimiento contractual — 10 hitos, resolver canónico, caché única.');
console.log(`${aprobados} controles aprobados; 0 fallidos.`);
