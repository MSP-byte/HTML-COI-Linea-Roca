#!/usr/bin/env node
'use strict';

/*
  1° ETAPA — Pipeline contractual y gate de Acta de Inicio.

  Dos planos, ninguno de los cuales necesita navegador:

    A) SQL sobre PGlite con todas las migraciones aplicadas: la conciliacion de
       fecha_acta_inicio al confirmar el hito 8, en sus cuatro casos.
    B) CODIGO de la capa en index.html: clasificacion 1-8 / transversal /
       etapa 2, derivacion del estado visual, dias en etapa, modal previo a la
       escritura, gate, y ausencia de un segundo pipeline visible.

  Lo que NO cubre: el DOM real (render, click, modal en pantalla, refresh).
  Eso vive en tests/etapa1_pipeline_contractual.spec.js y necesita Chromium.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const DIR = 'supabase/migrations';
const MIGRACION = '202609150001_etapa1_acta_inicio_conciliacion.sql';
const CODIGO_ACTA = 'control_terceros_con_acta';

const PLATAFORMA = [
  'create role anon nologin;',
  'create role authenticated nologin;',
  'create schema auth;',
  'create table auth.users(id uuid primary key, email text);',
  'create function auth.uid() returns uuid language sql stable as $fn$',
  "  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid",
  '$fn$;',
  'create function auth.jwt() returns jsonb language sql stable as $fn$',
  "  select jsonb_build_object('email', current_setting('request.jwt.claim.email', true),",
  "    'role', current_setting('request.jwt.claim.role', true))",
  '$fn$;'
].join('\n');

let aprobados = 0;
const check = (ok, detalle) => {
  if (!ok) throw new assert.AssertionError({ message: detalle });
  aprobados++;
};
const archivos = () => fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const leer = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const fallo = async (fn) => {
  try { await fn(); return null; } catch (error) { return String(error.message || error); }
};

async function nuevaBase() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of archivos()) await db.exec(leer(f));
  return db;
}

const UID = '11111111-1111-4111-8111-111111111111';

async function nuevaOC(db, nro, actaInicio) {
  await db.exec('begin;');
  try {
    const { rows } = await db.query(
      `insert into public.coi_ordenes (nro_oc, tipo, estado_coi, fecha_acta_inicio)
       values ($1, 'Servicio', 'En ejecución', $2) returning id`, [nro, actaInicio || null]);
    await db.query(
      `insert into public.coi_ordenes_estaciones (orden_id, nro_oc, estacion, es_principal)
       values ($1, $2, 'PLAZA CONSTITUCION', true)`, [rows[0].id, nro]);
    await db.exec('commit;');
    return rows[0].id;
  } catch (error) {
    await db.exec('rollback;');
    throw error;
  }
}

const confirmar = (db, ordenId, codigo, obs) => db.query(
  'select public.coi_confirmar_etapa_circuito_v2($1, $2, $3) resultado',
  [ordenId, codigo, obs || null]);

// El driver devuelve Date; se formatea en SQL para comparar sin ambiguedad.
const actaDe = (db, ordenId) => db.query(
  `select to_char(fecha_acta_inicio, 'YYYY-MM-DD') acta, (fecha_acta_inicio is null) nula
     from public.coi_ordenes where id = $1`, [ordenId]);

const hoyLocal = (db) => db.query(
  "select to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD') d");

async function main() {
  const db = await nuevaBase();
  await db.query('insert into auth.users(id, email) values ($1, $2)', [UID, 'operador@coiroca.com']);
  // coi_current_role() lee el rol de public.profiles, no del JWT.
  await db.query(
    `insert into public.profiles (id, email, rol, activo) values ($1, $2, 'administrador', true)
     on conflict (id) do update set rol = 'administrador', activo = true`,
    [UID, 'operador@coiroca.com']);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [UID]);
  await db.query("select set_config('request.jwt.claim.email', 'operador@coiroca.com', false)");
  await db.query("select set_config('request.jwt.claim.role', 'administrador', false)");

  const { rows: hoy } = await hoyLocal(db);
  const HOY = hoy[0].d;

  // ================================================== A) SQL

  // A · confirmacion NUEVA del hito 8 con fecha_acta_inicio en NULL.
  const ocA = await nuevaOC(db, '4530900001', null);
  const rA = await confirmar(db, ocA, CODIGO_ACTA, 'Acta firmada');
  const actaA = rA.rows[0].resultado.acta_inicio;
  check(Boolean(actaA), 'la RPC tiene que devolver el bloque acta_inicio');
  check(actaA.estado === 'registrada', `caso A: se esperaba registrada y vino ${actaA.estado}`);
  const { rows: filaA } = await actaDe(db, ocA);
  check(filaA[0].acta === HOY,
    `caso A: se esperaba ${HOY} y quedo ${filaA[0].acta}`);

  // B · confirmacion nueva con la fecha ya igual: se conserva, no se reescribe.
  const ocB = await nuevaOC(db, '4530900002', HOY);
  const rB = await confirmar(db, ocB, CODIGO_ACTA, null);
  check(rB.rows[0].resultado.acta_inicio.estado === 'coincide',
    'caso B: una fecha que ya coincide se conserva');

  // C · confirmacion nueva con OTRA fecha: no se sobrescribe, hay conflicto.
  const ocC = await nuevaOC(db, '4530900003', '2026-03-10');
  const rC = await confirmar(db, ocC, CODIGO_ACTA, null);
  const actaC = rC.rows[0].resultado.acta_inicio;
  check(actaC.estado === 'conflicto', `caso C: se esperaba conflicto y vino ${actaC.estado}`);
  const { rows: filaC } = await actaDe(db, ocC);
  check(filaC[0].acta === '2026-03-10',
    `caso C: la fecha existente NO puede sobrescribirse (quedo ${filaC[0].acta})`);
  check(String(actaC.valor).slice(0, 10) === '2026-03-10' && Boolean(actaC.valor_confirmacion),
    'caso C: el conflicto tiene que exponer ambos valores');

  // D · el hito 8 YA estaba confirmado y no hay fecha. No se inventa ninguna.
  //     Es el caso del expediente historico: la evidencia del gate existe, la
  //     fecha contractual no, y la fecha de hoy no es la del acta.
  const ocD = await nuevaOC(db, '4530900004', null);
  await confirmar(db, ocD, CODIGO_ACTA, 'Primera confirmacion');
  await db.query('update public.coi_ordenes set fecha_acta_inicio = null where id = $1', [ocD]);
  const rD = await confirmar(db, ocD, CODIGO_ACTA, null);
  const resD = rD.rows[0].resultado;
  check(resD.acta_inicio.estado === 'legacy_sin_fecha',
    `caso D: se esperaba legacy_sin_fecha y vino ${resD.acta_inicio.estado}`);
  const { rows: filaD } = await actaDe(db, ocD);
  check(filaD[0].nula === true,
    `caso D: NO puede escribirse la fecha actual sobre un hito ya confirmado (quedo ${filaD[0].acta})`);
  // El gate sigue siendo interpretable: la confirmacion del hito existe.
  const { rows: gateD } = await db.query(
    `select count(*)::int n from public.coi_historial_oc
      where orden_id = $1 and tipo_evento = 'Circuito administrativo' and campo_modificado = $2`,
    [ocD, CODIGO_ACTA]);
  check(gateD[0].n >= 1, 'caso D: la evidencia del hito 8 tiene que seguir en el historial');

  // E · la transversal se registra sin exigir el hito 8.
  const ocE = await nuevaOC(db, '4530900005', null);
  const errorE = await fallo(() => confirmar(db, ocE, 'cancelada_suspendida', 'Suspendida por presupuesto'));
  check(!errorE, `caso E: cancelada/suspendida tiene que poder registrarse antes del acta: ${errorE}`);
  const { rows: filaE } = await actaDe(db, ocE);
  check(filaE[0].nula === true,
    'caso E: registrar la transversal no puede tocar la fecha de acta');
  // Y ninguna otra etapa recibe bloque acta_inicio.
  const rE2 = await confirmar(db, await nuevaOC(db, '4530900006', null), 'pliegos_preparacion', null);
  check(!rE2.rows[0].resultado.acta_inicio,
    'solo el hito 8 concilia el acta: ninguna otra etapa puede tocarla');

  // F2 · el helper interno NO puede quedar ejecutable por los roles de cliente.
  //      Es SECURITY DEFINER y escribe fecha_acta_inicio: con EXECUTE para
  //      authenticated seria una segunda puerta que saltea el coi_assert_role()
  //      de la RPC publica.
  const { rows: aclHelper } = await db.query(`
    select coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) auth_exec,
           coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) anon_exec,
           p.prosecdef
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'coi_conciliar_acta_inicio_etapa'`);
  check(aclHelper.length === 1, 'no se encontro el helper de conciliacion');
  check(aclHelper[0].prosecdef === true, 'el helper es SECURITY DEFINER');
  check(aclHelper[0].auth_exec === false,
    'el helper NO puede estar otorgado a authenticated: saltearia el control de rol');
  check(aclHelper[0].anon_exec === false, 'el helper NO puede estar otorgado a anon');
  check(!/grant\s+execute\s+on\s+function\s+public\.coi_conciliar_acta_inicio_etapa/i
    .test(leer(MIGRACION)), 'la migracion no puede otorgar EXECUTE del helper');
  // Desde 202609170001 el único writer de cliente es v3. v2 queda como
  // implementación interna SECURITY DEFINER y no puede ser invocada por authenticated.
  const { rows: aclRpc } = await db.query(`
    select p.proname,
           coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) auth_exec
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('coi_confirmar_etapa_circuito_v2','coi_confirmar_etapa_circuito_v3')`);
  const aclPorNombre = Object.fromEntries(aclRpc.map((r) => [r.proname, r.auth_exec]));
  check(aclPorNombre.coi_confirmar_etapa_circuito_v3 === true,
    'coi_confirmar_etapa_circuito_v3 tiene que ser ejecutable por authenticated');
  check(aclPorNombre.coi_confirmar_etapa_circuito_v2 === false,
    'coi_confirmar_etapa_circuito_v2 NO puede seguir ejecutable por authenticated');
  // El dueño conserva acceso interno a v2; los casos A-E la ejercitan como
  // regresión de la conciliación legacy sin reabrirla al cliente.

  // Idempotencia y no destructividad de la migracion.
  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar la migracion fallo: ${reaplicar}`);
  const cuerpo = leer(MIGRACION).replace(/--[^\n]*/g, '');
  for (const patron of [/\btruncate\b/i, /\bdrop\s+table\b/i, /\bdelete\s+from\b/i,
                        /\bcreate\s+table\b/i, /\balter\s+table\b/i]) {
    check(!patron.test(cuerpo), `la migracion no deberia contener: ${patron}`);
  }
  // La firma de la RPC no cambia: no hay sobrecarga ambigua.
  const { rows: firmas } = await db.query(
    "select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace" +
    " where ns.nspname = 'public' and p.proname = 'coi_confirmar_etapa_circuito_v2'");
  check(firmas[0].n === 1,
    `coi_confirmar_etapa_circuito_v2 tiene que seguir teniendo UNA sola firma y hay ${firmas[0].n}`);

  await db.close();

  // ================================================== B) CODIGO

  const html = fs.readFileSync('index.html', 'utf8');
  const i = html.indexOf('<script id="coi-etapa1-pipeline-contractual">');
  check(i >= 0, 'falta el bloque de 1° Etapa en index.html');
  const capa = html.slice(i, html.indexOf('</' + 'script>', i));
  // Para los controles «esto NO puede aparecer» hay que mirar el codigo, no la
  // documentacion: los comentarios nombran a proposito lo que esta prohibido.
  const codigo = capa
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');

  // F · la etapa 1 son 8 hitos, derivados de la configuracion canonica.
  check(/window\.CIRCUITO_ADMINISTRATIVO_ETAPAS/.test(codigo),
    'los hitos tienen que salir de la configuracion data-driven existente');
  check(/corte >= 0 \? todas\.slice\(0, corte \+ 1\) : todas\.slice\(0, 8\)/.test(codigo),
    'el corte de la etapa 1 tiene que seguir la configuracion, no una lista fija');
  check(codigo.indexOf("const CODIGO_ACTA = 'control_terceros_con_acta';") >= 0,
    'el hito 8 es el acta de inicio');

  // G · la transversal no cuenta en X/8 ni entra al pipeline secuencial.
  check(codigo.indexOf("const CODIGO_TRANSVERSAL = 'cancelada_suspendida';") >= 0,
    'cancelada/suspendida tiene que estar clasificada como transversal');
  check(/registradosCount: registrados\.length/.test(codigo),
    'X/8 se cuenta sobre los hitos contractuales registrados');
  const cuerpoEstado = codigo.slice(codigo.indexOf('function estadoPipeline'), codigo.indexOf('function visualDe'));
  check(/const registrados = hitos/.test(cuerpoEstado),
    'el conteo tiene que partir de los hitos de la etapa 1, no de todas las etapas');
  check(/function bloqueTransversal/.test(codigo),
    'la transversal se renderiza fuera del pipeline secuencial');

  // J/K · hito 8 COMPLETADO; ultimo 1-7 ACTUAL. Y una sola rama por condicion.
  const cuerpoVisual = codigo.slice(codigo.indexOf('function visualDe'), codigo.indexOf('function diasDeHito'));
  check(/if \(x\.etapa\.codigo === CODIGO_ACTA\) return 'completado';/.test(cuerpoVisual),
    'el hito 8 confirmado tiene que mostrarse COMPLETADO, nunca EN CURSO');
  check((cuerpoVisual.match(/'actual'/g) || []).length === 1,
    'visualDe no puede tener dos retornos actual para la misma condicion');

  // Dias en etapa: orden CONTRACTUAL, y nunca se fabrica duracion sobre un hueco.
  const cuerpoDias = codigo.slice(codigo.indexOf('function diasDeHito'), codigo.indexOf('function filaHito'));
  check(/const siguienteEtapa = indice >= 0 \? estado\.hitos\[indice \+ 1\] : null;/.test(cuerpoDias),
    'la duracion se mide contra el hito contractual N+1, no contra el proximo evento cronologico');
  check(/if \(!siguienteEv\)/.test(cuerpoDias),
    'si falta el hito inmediato siguiente no hay duracion que mostrar');
  check(/if\s*\(hastaDia\s*<\s*desdeDia\)\s*return null;/.test(cuerpoDias),
    'un backfill con día administrativo anterior no puede producir una duración');
  check(/if \(x\.etapa\.codigo === CODIGO_ACTA\) return null;/.test(cuerpoDias),
    'cerrada la etapa 1, el hito 8 no puede seguir acumulando dias contra NOW');
  check(/return\s+dias\s*<\s*0\s*\?\s*null\s*:\s*dias;/.test(codigo),
    'una diferencia invalida devuelve null, no un numero inventado');

  // F1 · el gate legacy se resuelve canonicamente, no por subcadena.
  check(/function resolverEtapaCanonica\(valor\)/.test(codigo),
    'el estado documental tiene que resolverse contra la configuracion canonica');
  check(/candidatos\.some\(\(c\) => fold\(c\) === v\)/.test(codigo),
    'la coincidencia tiene que ser exacta y normalizada, no por inclusion');
  check(/\[e\.codigo, e\.nombre\]\.concat\(e\.persistedNames \|\| \[\]\)/.test(codigo),
    'se comparan codigo, nombre y persistedNames');
  check(!/'EJECUCION', 'FINALIZADA', 'CERRADA', 'ARCHIVADA', 'ACTA'/.test(codigo),
    'la heuristica por subcadena habilitaba la etapa 2 con el hito 7: no puede volver');
  check(/const CODIGOS_POST_ACTA = \[CODIGO_ACTA\]\.concat\(CODIGOS_ETAPA2\);/.test(codigo),
    'solo los codigos posteriores al acta son evidencia legacy');
  check(/CODIGOS_POST_ACTA\.indexOf\(etapaVigente\.codigo\) >= 0/.test(codigo),
    'la evidencia legacy tiene que evaluarse sobre el codigo resuelto');

  // F3 · hito actual por indice contractual; ultima actualizacion por fecha.
  check(/registrados\.sort\(\(a, b\) => a\.indice - b\.indice\);/.test(codigo),
    'el hito actual sale del orden CONTRACTUAL, no del cronologico');
  check(/const ultimaActualizacion = registrados\.slice\(\)/.test(codigo) &&
        /new Date\(a\.ev\.fecha_evento \|\| 0\) - new Date\(b\.ev\.fecha_evento \|\| 0\)/.test(codigo),
    'la ultima actualizacion si es por fecha de evento');
  const cuerpoResumen = codigo.slice(codigo.indexOf('function resumen(estado)'), codigo.indexOf('function bloqueTransversal'));
  check(/const ult = estado\.hitoActual;/.test(cuerpoResumen),
    'el estado actual del resumen es el hito mas avanzado');
  check(/ultimaAct \? fechaHora\(ultimaAct\.ev\.fecha_evento\)/.test(cuerpoResumen),
    'la fecha de ultima actualizacion sale del evento mas reciente');
  check(/dias = ult && !estado\.etapa1Finalizada \? diasDeHito\(estado, ult\)/.test(cuerpoResumen),
    'los dias en estado reutilizan la fecha efectiva y lógica del hito actual');

  // F4 · el banner transversal solo si es el estado VIGENTE.
  check(/const transversalVigente = Boolean\(etapaVigente && etapaVigente\.codigo === CODIGO_TRANSVERSAL\);/.test(codigo),
    'el banner de cancelacion depende del estado vigente, no del historial');
  check(/if \(transversalVigente\) \{/.test(codigo),
    'una cancelacion superada no puede seguir mostrandose como condicion actual');
  check(/const transversal = ultimaConfirmacion\(historial, CODIGO_TRANSVERSAL\) \|\| null;/.test(codigo),
    'el evento historico de cancelacion conserva la confirmacion transversal mas reciente');

  // F5 · el repaint usa la fila confirmada por el servidor.
  check(/function reconciliarOrden\(orden, confirmada\)/.test(codigo),
    'hace falta reconciliar con la fila que devolvio Supabase');
  check(/const orden\s*=\s*reconciliarOrden\(/.test(codigo) &&
        /const resultId\s*=\s*identidadOrden\(resultado && resultado\.orden\)/.test(codigo) &&
        /contexto\.identidad && resultId && contexto\.identidad!==resultId/.test(codigo),
    'la confirmacion valida UUID del servidor y reconcilia la fila confirmada antes de repintar');
  check(/resultado && resultado\.orden/.test(codigo),
    'se usa la orden confirmada por la RPC, no el objeto local stale');
  check(/'fecha_acta_inicio', 'estado_documental', 'estado_coi'/.test(codigo),
    'la reconciliacion tiene que traer la fecha de acta confirmada');

  // El resumen distingue los casos acordados.
  check(codigo.indexOf("'Sin iniciar'") >= 0, 'sin hitos, el estado actual es Sin iniciar');
  check(codigo.indexOf("'1° Etapa finalizada'") >= 0,
    'con el hito 8 confirmado, el estado actual es 1° Etapa finalizada');
  check(codigo.indexOf('Fecha de Acta de Inicio pendiente de conciliación') >= 0,
    'la falta de fecha canonica se muestra como pendiente, no se inventa');

  // Gate: habilitado por evento, por fecha canonica o por evidencia legacy.
  // El gate sigue exactamente a la finalizacion de la etapa 1, que ya
  // contempla el evento, la fecha canonica y la evidencia legacy post-acta.
  check(/const etapa2Habilitada = etapa1Finalizada;/.test(codigo),
    'una OC historica ya iniciada no puede quedar con la etapa 2 bloqueada');
  check(codigo.indexOf('La 2° Etapa se habilita al registrar el Acta de Inicio.') >= 0,
    'la etapa 2 bloqueada tiene que decir por que');
  // La 2° Etapa SIEMPRE se ve: bloqueada lleva candado en el selector, no se oculta.
  check(/data-etapa1-bloqueada="si"/.test(codigo) && /etapa1-candado/.test(codigo),
    'la etapa 2 bloqueada tiene que seguir visible y marcada con candado');
  check(codigo.indexOf('SEGUIMIENTO CONTRACTUAL Y EJECUCIÓN') >= 0,
    'el bloque contractual tiene que anunciarse con su titulo');

  // L/M/N · el click abre modal, no escribe; doble submit bloqueado; aviso de salto.
  check(/abrirModal\(hito\.getAttribute\('data-etapa1-hito'\)/.test(codigo),
    'el click sobre un hito tiene que abrir el modal, no confirmar');
  check(/if \(guardando \|\| !modalActual\) return;/.test(codigo) && /guardando = true;/.test(codigo),
    'el doble submit tiene que quedar bloqueado');
  check(/if \(btn\) btn\.disabled = true;/.test(codigo) &&
        /finally \{[\s\S]*guardando = false;[\s\S]*if \(btn && btn\.isConnected\) btn\.disabled = false;/.test(codigo),
    'el boton se bloquea durante la escritura y se restaura siempre desde finally');
  check(codigo.indexOf('Existen hitos anteriores sin registrar') >= 0,
    'saltar un hito tiene que avisar');
  const cuerpoModal = codigo.slice(codigo.indexOf('async function abrirModal'), codigo.indexOf('function mostrarErrorModal'));
  check(!/confirmarEtapaCircuitoOC/.test(cuerpoModal),
    'abrir el modal no puede escribir nada');

  // I · ante error de Supabase la UI no simula exito.
  const cuerpoConfirmar = codigo.slice(codigo.indexOf('async function confirmar()'), codigo.indexOf('document.addEventListener'));
  check(cuerpoConfirmar.indexOf('await window.actualizarEstadoDocumentalDesdePasoContractual') >= 0,
    'la escritura tiene que ir por el helper canonico RPC-returning');
  const posError = cuerpoConfirmar.indexOf('catch (error)');
  const posCerrar = cuerpoConfirmar.indexOf('cerrarModal();');
  check(posCerrar >= 0 && posCerrar < posError,
    'el modal solo se cierra en el camino de exito');
  check(cuerpoConfirmar.slice(posError).indexOf('mostrarErrorModal') >= 0,
    'un error de Supabase tiene que mostrarse, no silenciarse');

  // Conciliacion del acta consumida desde la RPC, sin ocultar el conflicto.
  for (const estado of ['conflicto', 'legacy_sin_fecha']) {
    check(codigo.indexOf("acta.estado === '" + estado + "'") >= 0,
      `la UI tiene que contemplar acta_inicio.estado = ${estado}`);
  }

  // H · el estado se reconstruye desde el historial remoto, sin localStorage.
  check(codigo.indexOf('cargarHistorialCircuitoOC') >= 0,
    'el historial se lee por el camino canonico');
  check(codigo.indexOf('__COI_CIRCUITO_CACHE_GET__') >= 0,
    'se reutiliza la cache canonica del circuito, no una segunda fuente');
  // H11 exige cero referencias a almacenamiento del navegador en index.html;
  // este control lo reafirma para la capa nueva.
  check(!/localStorage|sessionStorage/.test(capa),
    'la capa no puede leer ni escribir almacenamiento del navegador');

  // P · persistencia de hitos: Supabase confirma, la UI consume esa respuesta
  // y ninguna capa contractual vuelve a guardar la OC por una ruta local.
  const canonIni=html.indexOf('async function actualizarEstadoDocumentalDesdePasoContractual(ocNro,paso,options={}){');
  const canonFin=html.indexOf('\n\nfunction formatearFechaHoraCOI',canonIni);
  const canonico=html.slice(canonIni,canonFin);
  check(canonIni>=0&&canonFin>canonIni,'no se encontro el writer contractual canonico');
  check(!/guardarBaseLocal\s*\(/.test(canonico),
    'el writer contractual canonico no puede persistir la OC en almacenamiento local');
  check(/fusionarHistorialCircuitoConfirmado\(nro,result\.data\?\.historial\)/.test(canonico),
    'la respuesta confirmada por Supabase tiene que entrar al historial canonico');

  const r28Ini=html.indexOf('async function actualizarEstadoDocumentalDesdePasoContractualR28(ocNro,paso,options={}){');
  const r28Fin=html.indexOf('\n  function renderCTCard',r28Ini);
  const r28=html.slice(r28Ini,r28Fin);
  check(r28Ini>=0&&r28Fin>r28Ini,'no se encontro el writer contractual R28');
  check(!/guardarLocal\s*\(\s*\)/.test(r28),
    'R28 no puede volver a persistir el hito por guardarLocal');
  check(/__COI_CIRCUITO_CACHE_MERGE__/.test(r28),
    'R28 tiene que publicar el historial devuelto por Supabase en la cache canonica');

  check(/__COI_CIRCUITO_CACHE_MERGE__\(contexto\.nro,resultado&&resultado\.historial\)/.test(cuerpoConfirmar),
    'el pipeline debe consumir el historial confirmado por el RPC antes de repintar');
  check(/repintar\(orden,contexto\.identidad\);/.test(cuerpoConfirmar),
    'fecha efectiva y X\/8 deben repintarse inmediatamente tras la confirmacion remota');

  // O · una sola representacion del circuito en la Ficha: se envuelve el punto
  //     por el que la ficha pide el bloque, sin borrar la funcion legacy que
  //     otras partes del sistema siguen usando.
  check(/window\.renderChecksDocumentales = checksEtapa1;/.test(codigo),
    'la ficha tiene que montar el pipeline nuevo por el punto canonico');
  check(/checksEtapa1\.__coiEtapa1Base = baseChecks;/.test(codigo),
    'la implementacion anterior se conserva como base, no se destruye');
  check(html.indexOf('function renderCircuitoAdministrativoOC(orden)') >= 0,
    'renderCircuitoAdministrativoOC no puede eliminarse: otras partes la usan');
  check(codigo.indexOf('return render(resuelto);') >= 0,
    'la ficha tiene que devolver el pipeline nuevo, no los dos');

  // Resolver unico por codigo: la tarjeta de saldo remanente tiene que poder
  // resolverse al hacer click, no solo pintarse.
  check(/function etapaPorCodigo\(codigo\)/.test(codigo),
    'hace falta un resolver unico por codigo');
  check(/extra && extra\.codigo === c \? Object\.assign\(\{\}, extra\) : null/.test(codigo),
    'el resolver tiene que contemplar ESTADO_FINALIZADA_SALDO_REMANENTE');
  check(/const etapa = etapaPorCodigo\(codigo\);/.test(codigo),
    'abrirModal tiene que usar el resolver unico');
  check(!/etapas\(\)\.find\(\(e\) => e\.codigo === codigo\)/.test(codigo),
    'no puede quedar un lookup que ignore las etapas fuera del array principal');

  // hito8Registrado != etapa1Finalizada.
  check(/const hito8Registrado = Boolean\(actaEvento\);/.test(codigo),
    'el hito 8 registrado depende de un evento REAL');
  check(/const etapa1Finalizada = hito8Registrado \|\| Boolean\(actaFecha\) \|\| legacyEjecucion;/.test(codigo),
    'la etapa 1 puede estar finalizada por evidencia historica');
  check(/const etapa1FinalizadaLegacy = etapa1Finalizada && !hito8Registrado;/.test(codigo),
    'hay que distinguir la finalizacion por evidencia historica');
  check(codigo.indexOf("'1° Etapa finalizada — evidencia histórica'") >= 0,
    'la finalizacion sin evento tiene que decirse como evidencia historica');
  check(/const actaPendienteConciliacion = hito8Registrado && !actaFecha;/.test(codigo),
    'el aviso de conciliacion solo aplica si el hito 8 tiene evento real');
  // El hito 8 no puede pintarse COMPLETADO sin evento: visualDe exige x.ev.
  const cuerpoVisual2 = codigo.slice(codigo.indexOf('function visualDe'), codigo.indexOf('function diasDeHito'));
  check(/if \(!x\.ev\) return 'pendiente';/.test(cuerpoVisual2),
    'sin evento real ningun hito puede figurar como registrado');

  // Conflicto de fecha de acta: advertencia persistente, no solo toast.
  check(/const conflictoActa = new Map\(\);/.test(codigo),
    'el conflicto de fecha tiene que quedar registrado, no perderse con el toast');
  check(/const conflicto = estado\.actaConflicto \|\| conflictoActa\.get\(estado\.nro\);/.test(codigo),
    'el resumen prioriza el conflicto reconstruido desde historial y usa el Map solo como fallback de sesión');
  check(codigo.indexOf('Existe una Fecha de Acta de Inicio diferente a la fecha de confirmación del Hito 8.') >= 0,
    'el texto del conflicto tiene que ser explicito');
  check(codigo.indexOf('Se preservó el dato contractual existente') >= 0,
    'el conflicto tiene que decir que no se sobrescribio nada');
  check(/if \(nro\) conflictoActa\.set\(nro,/.test(codigo),
    'el conflicto se registra al recibirlo de la RPC');
  check(/conflictoActa\.delete\(nro\);/.test(codigo),
    'una conciliacion posterior tiene que limpiar la advertencia');
  // El aviso no puede depender de que exista window.toast.
  const cuerpoAvisar = codigo.slice(codigo.indexOf('function avisarActaInicio'), codigo.indexOf('async function confirmar()'));
  check(cuerpoAvisar.indexOf('conflictoActa.set') < cuerpoAvisar.indexOf("aviso('La OC ya tenía"),
    'el conflicto se registra ANTES de intentar el toast');

  // Sin onclick inline.
  check(!/onclick=/.test(capa), 'la capa no puede usar onclick inline');

  console.log('1° ETAPA — pipeline contractual y gate de Acta de Inicio.');
  console.log('  Conciliación fecha_acta_inicio : registrada / coincide / conflicto / legacy_sin_fecha');
  console.log('  Caso D (hito ya confirmado)    : no escribe fecha, gate igualmente interpretable');
  console.log('  Pipeline                       : 8 hitos derivados de la configuración canónica');
  console.log('  cancelada_suspendida           : transversal, fuera del X/8');
  console.log('  Hito 8 confirmado              : COMPLETADO, cierra la 1° Etapa');
  console.log('  Modal                          : previo a la escritura, sin doble submit');
  console.log('  Ficha OC                       : una sola representación del circuito');
  console.log(`${aprobados} controles de 1° Etapa aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('1° Etapa pipeline contractual FAIL:', error.message || error);
  process.exit(1);
});
