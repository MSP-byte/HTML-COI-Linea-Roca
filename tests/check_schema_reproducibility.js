#!/usr/bin/env node
'use strict';

/*
  H02 · COI-AUD-008 — Reproducibilidad del esquema desde el repositorio.

  CASO A — base vacia
    Aplica TODAS las migraciones versionadas sobre PostgreSQL limpio, provisto
    unicamente de los prerequisitos que Supabase entrega de fabrica (roles
    anon/authenticated y el esquema auth). Verifica que la cadena completa
    aplica y que el contrato estructural resultante coincide con produccion:
    tablas, columnas, PK, FK, unicidad de nro_oc, RLS, RPC y triggers.

  CASO B — base con la estructura final ya presente
    Reaplica la migracion de baseline sobre una base que ya tiene todo creado y
    con datos, y verifica que se comporta como NO-OP estructural: no cambia
    columnas, no recrea tablas, no elimina constraints y no toca datos.

  Antes de 202608090000_core_schema_baseline.sql la cadena se cortaba en la
  segunda migracion con «relation "public.coi_ordenes" does not exist» y solo
  1 de 27 migraciones llegaba a aplicarse.

  CONTRATO AUTORITATIVO
    tests/fixtures/production_schema_contract.json guarda el snapshot de
    information_schema tomado en lectura sobre produccion y verificado identico
    en staging. El CASO A compara contra el, columna por columna: nombres,
    tipos, nullability, defaults y generated columns, mas PK, FK, UNIQUE y CHECK.
    Comprobar solo la cantidad de columnas producia falsos positivos.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const DIR = 'supabase/migrations';
const BASELINE = '202608090000_core_schema_baseline.sql';

// Las 18 tablas operativas de produccion y staging. Se excluyen a proposito
// coi_documentos_oc_backup_20260723 y coi_documentos_oc_backup_4550000286_20260723:
// son respaldos historicos puntuales, no parte de una instalacion nueva.
const TABLAS_OPERATIVAS = [
  'coi_alertas', 'coi_auditorias_calidad', 'coi_certificaciones', 'coi_consumos_posicion',
  'coi_contract_meta', 'coi_documentos_oc', 'coi_historial_oc', 'coi_idempotency_requests',
  'coi_links_documentales', 'coi_observaciones_oc', 'coi_operaciones_auditoria', 'coi_ordenes',
  'coi_ordenes_estaciones', 'coi_posiciones_oc', 'coi_servicios_tecnicos_um',
  'coi_timeline_events', 'coi_unidades_mantenimiento', 'profiles'
];

// Tablas que el frontend menciona pero que NO existen en produccion. Ninguna
// migracion debe crearlas: las migraciones solo las sondean con to_regclass.
const TABLAS_FANTASMA = [
  'coi_auditoria_global', 'coi_sesiones', 'coi_documentos_versiones', 'coi_security_health_checks'
];

// Contrato autoritativo de produccion (snapshot de information_schema en lectura,
// verificado identico en staging). Es la unica fuente de verdad de este control.
const CONTRATO = require('./fixtures/production_schema_contract.json');
const TABLAS_BASELINE = Object.keys(CONTRATO).filter((k) => !k.startsWith('_'));

// Columnas que el baseline llego a declarar por inferencia y que NO existen en
// produccion. El control falla si alguna reaparece.
// Ojo: tipo_um SI existe en coi_unidades_mantenimiento y en coi_certificaciones;
// lo que no existe es tipo_um en coi_servicios_tecnicos_um.
const COLUMNAS_FANTASMA = {
  coi_documentos_oc: ['id_documento', 'usuario_email'],
  coi_observaciones_oc: ['texto', 'usuario_email'],
  coi_unidades_mantenimiento: ['id_um', 'nombre', 'tipo', 'usuario_email'],
  coi_servicios_tecnicos_um: ['um_id', 'tipo_um', 'usuario_email'],
  coi_auditorias_calidad: ['nro_oc', 'orden_id', 'resultado', 'score', 'fecha_creacion'],
  coi_certificaciones: ['creado_por', 'actualizado_por']
};

const RPC_CRITICAS = [
  'coi_guardar_orden_integral', 'coi_actualizar_orden_integral', 'coi_eliminar_orden_integral',
  'coi_actualizar_consumo_posicion', 'coi_anular_consumo_posicion', 'coi_renumerar_oc',
  'coi_timeline_upsert_events', 'coi_timeline_replace_events', 'coi_timeline_list_page',
  'coi_timeline_delete_event', 'coi_current_role', 'coi_guardar_estacion_asociada',
  'coi_marcar_estacion_principal', 'coi_eliminar_estacion_asociada',
  'coi_eliminar_posiciones_sin_movimientos'
];

const TRIGGERS_CRITICOS = [
  'coi_direct_order_update_guard', 'coi_direct_order_update_audit', 'coi_ordenes_number_guard',
  'coi_ordenes_one_principal_ck', 'coi_posiciones_identity_guard',
  'coi_posiciones_oc_recompute_fields', 'coi_historial_enforce_order'
];

const PLATAFORMA = [
  'create role anon nologin;',
  'create role authenticated nologin;',
  'create schema auth;',
  'create table auth.users(id uuid primary key, email text);',
  'create function auth.uid() returns uuid language sql stable as $fn$',
  "  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid",
  '$fn$;',
  'create function auth.jwt() returns jsonb language sql stable as $fn$',
  "  select jsonb_build_object('email', current_setting('request.jwt.claim.email', true))",
  '$fn$;'
].join('\n');

let aprobados = 0;
const check = (ok, detalle) => {
  if (!ok) throw new assert.AssertionError({ message: detalle });
  aprobados++;
};

const archivos = () => fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const leer = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

async function baseNueva() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  return db;
}

// Radiografia estructural comparable entre dos momentos.
async function radiografia(db) {
  const columnas = await db.query(
    "select table_name, column_name, data_type, is_nullable, column_default " +
    "from information_schema.columns where table_schema='public' order by 1,2"
  );
  const constraints = await db.query(
    "select conrelid::regclass::text tabla, conname, contype from pg_constraint " +
    "where connamespace='public'::regnamespace order by 1,2"
  );
  const indices = await db.query(
    "select indexname, indexdef from pg_indexes where schemaname='public' order by 1"
  );
  return {
    columnas: columnas.rows.map((r) => [r.table_name, r.column_name, r.data_type, r.is_nullable, r.column_default].join('|')),
    constraints: constraints.rows.map((r) => [r.tabla, r.conname, r.contype].join('|')),
    indices: indices.rows.map((r) => r.indexname + '|' + r.indexdef)
  };
}

// ---------------------------------------------------------------- CASO A
async function casoA() {
  const db = await baseNueva();
  const files = archivos();

  let aplicadas = 0;
  let fallo = null;
  for (const f of files) {
    try { await db.exec(leer(f)); aplicadas++; }
    catch (error) {
      fallo = { archivo: f, motivo: String(error.message || error).split('\n')[0] };
      try { await db.exec('rollback'); } catch (e) { /* transaccion ya cerrada */ }
      break;
    }
  }

  check(
    !fallo,
    fallo ? `la cadena de migraciones se corta en ${fallo.archivo}: ${fallo.motivo}` : ''
  );
  check(
    aplicadas === files.length,
    `migraciones aplicadas desde cero: ${aplicadas} de ${files.length}`
  );

  const { rows } = await db.query(
    "select table_name from information_schema.tables " +
    "where table_schema='public' and table_type='BASE TABLE' order by 1"
  );
  const creadas = rows.map((r) => r.table_name);

  const faltantes = TABLAS_OPERATIVAS.filter((t) => !creadas.includes(t));
  check(faltantes.length === 0, `tablas operativas no creadas desde cero: ${faltantes.join(', ')}`);

  const respaldos = creadas.filter((t) => /_backup_/.test(t));
  check(respaldos.length === 0, `ninguna migracion debe crear tablas de respaldo: ${respaldos.join(', ')}`);

  const fantasmas = TABLAS_FANTASMA.filter((t) => creadas.includes(t));
  check(fantasmas.length === 0, `ninguna migracion debe crear tablas inexistentes en produccion: ${fantasmas.join(', ')}`);

  // Contrato exacto por tabla: nombres, tipos, nullability, defaults y generated.
  for (const tabla of TABLAS_BASELINE) {
    const esperado = CONTRATO[tabla].columnas;
    const { rows: cols } = await db.query(
      "select column_name, data_type, is_nullable, column_default, is_generated " +
      "from information_schema.columns where table_schema='public' and table_name=$1", [tabla]
    );
    const real = new Map(cols.map((r) => [r.column_name, r]));
    const nombresEsperados = Object.keys(esperado);

    const faltan = nombresEsperados.filter((c) => !real.has(c));
    check(faltan.length === 0, `${tabla}: faltan columnas de produccion: ${faltan.join(', ')}`);
    const sobran = [...real.keys()].filter((c) => !nombresEsperados.includes(c));
    check(sobran.length === 0, `${tabla}: columnas que produccion no tiene: ${sobran.join(', ')}`);

    for (const [col, spec] of Object.entries(esperado)) {
      const r = real.get(col);
      if (!r) continue;
      if (spec.nn !== undefined) {
        check(
          (r.is_nullable === 'NO') === spec.nn,
          `${tabla}.${col}: nullability ${r.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}, produccion espera ${spec.nn ? 'NOT NULL' : 'NULL'}`
        );
      }
      if (spec.tipo) {
        check(
          r.data_type.toLowerCase().includes(spec.tipo),
          `${tabla}.${col}: tipo ${r.data_type}, produccion espera ${spec.tipo}`
        );
      }
      if (spec.def !== undefined) {
        check(
          (r.column_default || '').toLowerCase().includes(String(spec.def).toLowerCase()),
          `${tabla}.${col}: default ${r.column_default || 'ninguno'}, produccion espera ${spec.def}`
        );
      }
      const generada = r.is_generated === 'ALWAYS';
      check(
        generada === Boolean(spec.gen),
        `${tabla}.${col}: ${generada ? 'es' : 'no es'} GENERATED y produccion espera lo contrario`
      );
    }
  }

  // Las columnas inferidas que produccion no tiene no deben reaparecer.
  for (const [tabla, fantasmas] of Object.entries(COLUMNAS_FANTASMA)) {
    const { rows: cols } = await db.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name=$1", [tabla]
    );
    const presentes = new Set(cols.map((r) => r.column_name));
    const reaparecidas = fantasmas.filter((c) => presentes.has(c));
    check(reaparecidas.length === 0, `${tabla}: columnas inexistentes en produccion: ${reaparecidas.join(', ')}`);
  }

  // UNIQUE y CHECK declarados por el contrato productivo.
  const { rows: constraints } = await db.query(`
    select conrelid::regclass::text tabla, conname, contype,
           pg_get_constraintdef(oid) def
      from pg_constraint where connamespace = 'public'::regnamespace`);
  const porTabla = (t) => constraints.filter((c) => c.tabla.replace(/^public\./, '') === t);
  for (const tabla of TABLAS_BASELINE) {
    const spec = CONTRATO[tabla];
    for (const cols of (spec.unique || [])) {
      const hay = porTabla(tabla).some((c) => (c.contype === 'u' || c.contype === 'p') &&
        cols.every((col) => new RegExp('\\b' + col + '\\b').test(c.def)));
      check(hay, `${tabla}: falta UNIQUE (${cols.join(', ')})`);
    }
    for (const col of (spec.check_columnas || [])) {
      const hay = porTabla(tabla).some((c) => c.contype === 'c' && new RegExp('\\b' + col + '\\b').test(c.def));
      check(hay, `${tabla}: falta CHECK sobre ${col}`);
    }
  }

  // PK: todas las operativas tienen clave primaria.
  const pk = await db.query(
    "select conrelid::regclass::text tabla from pg_constraint " +
    "where connamespace='public'::regnamespace and contype='p'"
  );
  const conPk = new Set(pk.rows.map((r) => r.tabla.replace(/^public\./, '')));
  const sinPk = TABLAS_OPERATIVAS.filter((t) => !conPk.has(t));
  check(sinPk.length === 0, `tablas operativas sin PK: ${sinPk.join(', ')}`);

  // FK: el arbol de relaciones raiz declarado por el esquema real.
  const fk = await db.query(`
    select c.relname origen, cf.relname destino
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_class cf on cf.oid = k.confrelid
     where k.contype = 'f' and c.relnamespace = 'public'::regnamespace`);
  const pares = new Set(fk.rows.map((r) => r.origen + '->' + r.destino));
  const HIJAS_DE_ORDENES = [
    'coi_ordenes_estaciones', 'coi_posiciones_oc', 'coi_alertas',
    'coi_certificaciones', 'coi_documentos_oc', 'coi_observaciones_oc'
  ];
  for (const hija of HIJAS_DE_ORDENES) {
    check(pares.has(hija + '->coi_ordenes'), `falta la FK ${hija} -> coi_ordenes`);
  }
  check(
    pares.has('coi_servicios_tecnicos_um->coi_unidades_mantenimiento'),
    'falta la FK coi_servicios_tecnicos_um -> coi_unidades_mantenimiento'
  );
  check(pares.has('coi_ordenes->users'), 'coi_ordenes debe conservar FK hacia auth.users');

  // Unicidad de nro_oc.
  const uq = await db.query(
    "select indexname from pg_indexes where schemaname='public' and indexname like '%nro_oc%uq%'"
  );
  const nombresUq = uq.rows.map((r) => r.indexname);
  check(
    nombresUq.includes('coi_ordenes_nro_oc_uq'),
    `falta el indice unico coi_ordenes_nro_oc_uq (encontrados: ${nombresUq.join(', ') || 'ninguno'})`
  );

  // RLS en las 18.
  const rls = await db.query(
    "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace " +
    "where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"
  );
  const sinRls = rls.rows.map((r) => r.relname).filter((t) => TABLAS_OPERATIVAS.includes(t));
  check(sinRls.length === 0, `tablas operativas sin RLS: ${sinRls.join(', ')}`);

  // RPC y triggers criticos.
  for (const rpc of RPC_CRITICAS) {
    const q = await db.query(
      "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
      "where n.nspname='public' and p.proname=$1", [rpc]
    );
    check(q.rows[0].n > 0, `falta la RPC ${rpc}`);
  }
  const trg = await db.query('select tgname from pg_trigger where not tgisinternal');
  const nombresTrg = new Set(trg.rows.map((r) => r.tgname));
  for (const t of TRIGGERS_CRITICOS) {
    check(nombresTrg.has(t), `falta el trigger ${t}`);
  }

  const radio = await radiografia(db);
  await db.close();
  return { files, creadas, radio };
}

// ---------------------------------------------------------------- CASO B
async function casoB() {
  const db = await baseNueva();
  for (const f of archivos()) await db.exec(leer(f));

  // Datos representativos, incluyendo la relacion raiz.
  await db.exec(`
    insert into auth.users(id, email)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin@coiroca.com');
    insert into public.coi_ordenes(id, nro_oc, id_obra, tipo, estacion, estado_coi)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '4530008964', 'OB-1', 'Obra', 'Banfield', 'OBRA/SERVICIO EN EJECUCIÓN');
    insert into public.coi_ordenes_estaciones(id, orden_id, nro_oc, estacion, es_principal)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '4530008964', 'Banfield', true);
    insert into public.coi_posiciones_oc(id, orden_id, nro_oc, posicion, cantidad_total, precio_unitario, monto_total)
      values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '4530008964', '160.10', 10, 100, 1000);
  `);

  const antes = await radiografia(db);
  const datosAntes = await db.query(`
    select (select count(*)::int from public.coi_ordenes) ordenes,
           (select count(*)::int from public.coi_ordenes_estaciones) estaciones,
           (select count(*)::int from public.coi_posiciones_oc) posiciones,
           (select nro_oc from public.coi_ordenes limit 1) nro,
           (select monto_total from public.coi_posiciones_oc limit 1) monto`);

  // Reaplicacion del baseline sobre la estructura final ya existente.
  await db.exec(leer(BASELINE));

  const despues = await radiografia(db);
  const datosDespues = await db.query(`
    select (select count(*)::int from public.coi_ordenes) ordenes,
           (select count(*)::int from public.coi_ordenes_estaciones) estaciones,
           (select count(*)::int from public.coi_posiciones_oc) posiciones,
           (select nro_oc from public.coi_ordenes limit 1) nro,
           (select monto_total from public.coi_posiciones_oc limit 1) monto`);

  check(
    JSON.stringify(antes.columnas) === JSON.stringify(despues.columnas),
    'reaplicar el baseline modifico columnas: debe ser un NO-OP estructural'
  );
  check(
    JSON.stringify(antes.constraints) === JSON.stringify(despues.constraints),
    'reaplicar el baseline modifico constraints: debe ser un NO-OP estructural'
  );
  check(
    JSON.stringify(antes.indices) === JSON.stringify(despues.indices),
    'reaplicar el baseline modifico indices: debe ser un NO-OP estructural'
  );
  check(
    JSON.stringify(datosAntes.rows) === JSON.stringify(datosDespues.rows),
    'reaplicar el baseline modifico datos: nunca debe tocarlos'
  );

  // El baseline no debe contener ninguna operacion destructiva ni de escritura.
  const sql = leer(BASELINE);
  const cuerpo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const prohibido of [/\bdrop\s+/i, /\btruncate\b/i, /\bdelete\s+from\b/i, /\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i]) {
    check(!prohibido.test(cuerpo), `el baseline contiene una operacion prohibida: ${prohibido}`);
  }
  // Toda creacion de tabla debe ser condicional.
  const creates = cuerpo.match(/create\s+table[^(]*/gi) || [];
  const noCondicionales = creates.filter((c) => !/if\s+not\s+exists/i.test(c));
  check(noCondicionales.length === 0, `el baseline debe usar siempre «create table if not exists»: ${noCondicionales.join(' / ')}`);

  await db.close();
  return { creates: creates.length };
}

async function main() {
  const a = await casoA();
  const b = await casoB();

  console.log(`Reproducibilidad del esquema: ${a.files.length}/${a.files.length} migraciones aplicables desde una base vacia.`);
  console.log(`  CASO A · tablas operativas creadas : ${TABLAS_OPERATIVAS.length}/${TABLAS_OPERATIVAS.length}`);
  console.log(`  CASO A · tablas de respaldo        : 0`);
  console.log(`  CASO A · tablas inexistentes en prod: 0`);
  const totalCols = TABLAS_BASELINE.reduce((a, t) => a + Object.keys(CONTRATO[t].columnas).length, 0);
  console.log(`  CASO A · contrato exacto            : ${TABLAS_BASELINE.length} tablas, ${totalCols} columnas verificadas`);
  console.log(`  CASO A · nombres/tipos/nullability/defaults/generated: 0 diferencias con produccion`);
  console.log(`  CASO A · columnas inexistentes en prod: 0`);
  console.log(`  CASO B · baseline reaplicado        : NO-OP (columnas, constraints, indices y datos intactos)`);
  console.log(`  CASO B · tablas condicionales       : ${b.creates} create table if not exists, 0 operaciones destructivas`);

  console.log(`${aprobados} controles de reproducibilidad aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('Reproducibilidad del esquema: FALLO');
  console.error(error.message || error);
  process.exit(1);
});
