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
check(headScript.includes("else if(state==='error')"),
  'un fallo remoto sin snapshot confirmado debe dejar un estado de error explícito');
check(headScript.includes('const hasConfirmedSnapshot=snapshotCount!==null&&snapshotCount!==undefined&&uid!==\'\';'),
  'una relectura del mismo operador debe reconocer el último snapshot remoto confirmado');
check(headScript.includes("else if(hasConfirmedSnapshot&&(!readyUid||uid===readyUid))"),
  'un refresh del mismo usuario no debe ocultar datos que ya fueron confirmados remotamente');
check(headScript.includes('let observedAuthUid=null;')&&headScript.includes('observedAuthUid=uid;'),
  'el gate debe recordar la identidad informada por Supabase Auth');
check(headScript.includes("const identityMatches=observedAuthUid===null||(observedAuthUid!==''&&uid===observedAuthUid);"),
  'un snapshot H06 solo puede reutilizarse si pertenece a la identidad Auth observada');
check(headScript.includes("if(!identityMatches){setState('pendiente');return;}"),
  'un cambio o cierre de sesión debe mantener el gate cerrado mientras H06 invalida/adopta identidad');
check(headScript.includes("if(!uid||(readyUid&&uid!==readyUid))"),
  'un cambio real de identidad debe limpiar el UID previamente autorizado');
check(headScript.includes('window.recargarDatosDesdeSupabase||window.cargarOrdenesPrincipal'),
  'Reintentar debe usar el camino canónico de lectura Supabase');
check(!/localStorage|sessionStorage/.test(headScript),
  'el Startup Data Gate no puede leer una cache local como autoridad');
check(!/setTimeout\([^)]*(1500|4800)/.test(headScript),
  'el gate no puede decidir readiness por temporizadores históricos');
check(headScript.includes("gate&&gate.dataset.coiGateRenderKey!==renderKey")&&headScript.includes('gate.dataset.coiGateRenderKey=renderKey'),
  'el poll no debe reescribir el DOM cuando estado y detalle efectivos no cambiaron');
check(headScript.includes("if(gate.getAttribute('aria-busy')!==busy)gate.setAttribute('aria-busy',busy);"),
  'aria-busy también debe actualizarse solo ante cambio efectivo');

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

const preloadPos=html.indexOf('<link rel="preload" href="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.2"');
const supabaseLoaderPos=html.indexOf('id="coi-supabase-loader-r36"');
check(preloadPos>=0&&preloadPos<headEnd,
  'supabase-js debe pre-cargarse desde <head> antes del bootstrap tardío');
check(html.includes('<link rel="preconnect" href="https://ooepgbzqlpjrtpaoqawc.supabase.co" crossorigin>'),
  'el arranque debe preconectar con el origen de Supabase');
check(supabaseLoaderPos>preloadPos,
  'el preload debe anteceder al loader dinámico de supabase-js');

check(html.includes("options.coalescer === true && requestedUid && requestedUid === supabaseCargaUid"),
  'solo se coalescen lecturas concurrentes de la misma identidad');
check(html.includes("supabaseCargaPendiente = true;"),
  'una lectura concurrente de otra identidad debe quedar encolada');
check(html.includes("supabaseCargaUid = null;"),
  'la identidad de la lectura en vuelo debe limpiarse al finalizar');
check(html.includes("cargarOrdenesPrincipal({ coalescer: true, origen: 'startup-session', authUid: user.id })"),
  'la verificación inicial de sesión debe usar la vía coalescida');
check(html.includes("event === 'SIGNED_IN'"),
  'SIGNED_IN debe conservar la capacidad de cargar cuando realmente hace falta');
check(html.includes("authUid: session.user.id"),
  'la recarga SIGNED_IN debe identificar explícitamente al usuario que la solicitó');
check(html.includes("ordenesLecturaEstado === 'listo' &&\n                  ordenesConfirmadasUid === session.user.id"),
  'SIGNED_IN repetido del mismo usuario no debe releer un catálogo ya confirmado');
check(!html.includes("['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION', 'USER_UPDATED'].includes(event) && session?.user)"),
  'INITIAL_SESSION/TOKEN_REFRESHED no deben conservar el disparador legacy de recarga completa');

console.log('Startup authoritative loading gate: OK');
console.log('  Primer paint : sin filas legacy/parciales');
console.log('  Autoridad    : H06 + lectura remota confirmada');
console.log('  Error        : fail-closed con reintento Supabase');
console.log('  Render       : bloqueado hasta estado listo');
console.log(`${ok} controles aprobados; 0 fallidos.`);
