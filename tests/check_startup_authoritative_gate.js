#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('index.html','utf8').replace(/\r\n?/g,'\n');
let ok=0;
function check(value,message){assert.ok(value,message);ok++;}

const styleStart=html.indexOf('<style id="coi-orders-startup-gate-style">');
const headScriptStart=html.indexOf('<script id="coi-orders-startup-gate-head">');
const headEnd=html.indexOf('</head>');
const gateDom=html.indexOf('id="coiOrdersStartupGate"');
const ordersToolbar=html.indexOf('class="ordenes-toolbar" role="search"');

check(styleStart>=0,'falta el CSS del Startup Data Gate');
check(headScriptStart>=0,'falta el script temprano del Startup Data Gate');
check(styleStart<headEnd&&headScriptStart<headEnd,'el gate debe instalarse en <head> antes del primer paint');
check(gateDom>=0&&gateDom<ordersToolbar,'el estado de carga debe estar antes de la tabla/filtros de Órdenes');

const headScript=html.slice(headScriptStart,html.indexOf('</'+'script>',headScriptStart));
check(headScript.includes("root.dataset.coiOrdersState=e2eBypass?'listo':'pendiente'"),
  'el primer estado visible debe ser pendiente fuera de E2E');
check(headScript.includes('window.__COI_H06_ORDENES__'),
  'el gate debe observar el contrato H06 de autoridad remota');
check(headScript.includes("state==='listo'&&confirmed"),
  'solo una lectura lista y confirmada puede liberar la tabla');
check(headScript.includes("else if(state==='error')setState('error'"),
  'un fallo remoto debe dejar un estado de error explícito');
check(headScript.includes('window.recargarDatosDesdeSupabase||window.cargarOrdenesPrincipal'),
  'Reintentar debe usar el camino canónico de lectura Supabase');
check(!/localStorage|sessionStorage/.test(headScript),
  'el Startup Data Gate no puede leer una cache local como autoridad');
check(!/setTimeout\([^)]*(1500|4800)/.test(headScript),
  'el gate no puede decidir readiness por temporizadores históricos');

const css=html.slice(styleStart,html.indexOf('</style>',styleStart));
check(css.includes('html[data-coi-orders-state="pendiente"] #vistaOrdenes .view-body > :not(#coiOrdersStartupGate)'),
  'durante pendiente debe ocultarse el contenido operativo');
check(css.includes('html[data-coi-orders-state="cargando"] #vistaOrdenes .view-body > :not(#coiOrdersStartupGate)'),
  'durante carga debe ocultarse el contenido operativo');
check(css.includes('html[data-coi-orders-state="error"] #vistaOrdenes .view-body > :not(#coiOrdersStartupGate)'),
  'ante error no deben reaparecer filas parciales');
check(css.includes('html[data-coi-orders-state="listo"] #coiOrdersStartupGate'),
  'el gate debe retirarse solo al llegar a listo');

check(html.includes("function renderOrdersFinal(){\n  if(window.__COI_ORDERS_STARTUP_GATE__&&!window.__COI_ORDERS_STARTUP_GATE__.allowRender()){orderRenderScheduled=false;return;}"),
  'el renderer final debe cortar antes de leer/renderizar filas no autoritativas');
check(html.includes("function renderOrdenesV581R(){\n    if(window.__COI_ORDERS_STARTUP_GATE__&&!window.__COI_ORDERS_STARTUP_GATE__.allowRender())return;"),
  'el renderer V58.1R también debe quedar bloqueado durante hidratación');

check(headScript.includes("location.hostname==='127.0.0.1'&&location.port==='4173'&&navigator.webdriver===true"),
  'el Quality Gate Chromium debe conservar su bypass controlado');
check(headScript.includes("!params.has('coi_force_startup_gate')"),
  'debe existir una forma explícita de probar el gate aun bajo webdriver');

console.log('Startup authoritative loading gate: OK');
console.log('  Primer paint : sin filas legacy/parciales');
console.log('  Autoridad    : H06 + lectura remota confirmada');
console.log('  Error        : fail-closed con reintento Supabase');
console.log('  Render       : bloqueado hasta estado listo');
console.log(`${ok} controles aprobados; 0 fallidos.`);
