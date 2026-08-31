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

// Desvios deliberados: una migracion del repositorio todavia no aplicada a los
// entornos remotos. El contrato sigue siendo el snapshot de produccion; aca se
// declara el valor que el repositorio DEBE producir mientras dure la diferencia,
// de modo que la brecha quede visible en lugar de disimulada dentro del snapshot.
const PENDIENTES_TODAS = (CONTRATO._divergencias_pendientes || {}).fk || [];
// «sin FK» en produccion = el repositorio agrega una FK nueva; el resto son
// cambios de accion sobre una FK que produccion ya tiene.
const PENDIENTES_FK_NUEVAS = PENDIENTES_TODAS.filter((d) => d.produccion === 'sin FK');
const PENDIENTES = PENDIENTES_TODAS.filter((d) => d.produccion !== 'sin FK');
const accionEsperada = (tabla, columna, accionProduccion) => {
  const d = PENDIENTES.find((x) => x.tabla === tabla && x.columna === columna);
  return d ? d.repo : accionProduccion;
};

// Mismo criterio para los UNIQUE que el repositorio crea de mas: el snapshot de
// cada tabla sigue siendo produccion y aca se declara el excedente. Se verifica
// que el constraint exista de verdad tras aplicar las migraciones, de modo que
// la divergencia quede probada y no sea solamente una anotacion.
const PENDIENTES_UNIQUE = (CONTRATO._divergencias_pendientes || {}).unique || [];
// Policies y grants que el repositorio endurece y produccion todavia no tiene.
// Mismo criterio: el snapshot sigue siendo produccion, y aca se declara —y se
// verifica— lo que el repositorio produce de mas.
const PENDIENTES_POLICIES = (CONTRATO._divergencias_pendientes || {}).policies || [];
const PENDIENTES_GRANTS = (CONTRATO._divergencias_pendientes || {}).grants || [];
// Grants sobre funciones: mismo criterio que los de tabla.
const PENDIENTES_GRANTS_FN = (CONTRATO._divergencias_pendientes || {}).grants_funciones || [];

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
  const policies = await db.query(
    "select tablename, policyname, cmd, permissive, roles::text, qual, with_check " +
    "from pg_policies where schemaname='public' order by 1,2"
  );
  return {
    policies: policies.rows.map((r) => [r.tablename, r.policyname, r.cmd, r.permissive, r.roles, r.qual, r.with_check].join('|')),
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

  // Los UNIQUE declarados como divergencia pendiente tienen que existir en el
  // repositorio: es lo que prueba que la migracion todavia no aplicada hace lo
  // que dice. Si alguno desapareciera, la divergencia seria falsa.
  const { rows: indices } = await db.query(`
    select i.relname, ix.indisunique, pg_get_indexdef(ix.indexrelid) def,
           t.relname tabla
      from pg_index ix
      join pg_class i on i.oid = ix.indexrelid
      join pg_class t on t.oid = ix.indrelid
      join pg_namespace n on n.oid = i.relnamespace
     where n.nspname = 'public'`);
  for (const d of PENDIENTES_UNIQUE) {
    const real = indices.find((i) => i.relname === d.indice);
    check(Boolean(real), `${d.tabla}: la divergencia pendiente declara el indice ${d.indice} y el repositorio no lo crea`);
    if (!real) continue;
    check(real.indisunique === true, `${d.indice}: deberia ser UNIQUE`);
    check(real.tabla === d.tabla, `${d.indice}: esta sobre ${real.tabla} y se declara sobre ${d.tabla}`);
    for (const col of d.columnas) {
      check(new RegExp('\\b' + col + '\\b').test(real.def), `${d.indice}: no cubre ${col} (${real.def})`);
    }
    if (d.expresion_canonica) {
      // Se comprueba la forma, no el texto exacto: Postgres reescribe la
      // expresion al guardarla.
      check(/upper\(/i.test(real.def) && /regexp_replace\(/i.test(real.def),
        `${d.indice}: deberia aplicar la forma canonica declarada (${real.def})`);
    }
    if (d.parcial) {
      check(/ WHERE /i.test(real.def), `${d.indice}: deberia ser parcial (${real.def})`);
    }
    // Y NO debe estar declarado en el snapshot productivo: si lo estuviera, ya
    // no seria una divergencia sino parte del contrato.
    //
    // Excepcion deliberada: cuando la divergencia declara una expresion canonica,
    // el objeto que agrega el repositorio NO es el mismo que el del snapshot.
    // coi_unidades_mantenimiento tiene en produccion el UNIQUE literal sobre
    // codigo_um, y lo que se suma es un indice unico sobre su forma normalizada:
    // conviven, y el literal se conserva a proposito. Exigir que la columna no
    // figure en el snapshot confundiria «misma columna» con «mismo constraint».
    const enSnapshot = (CONTRATO[d.tabla].unique || []).some(
      (cols) => JSON.stringify(cols.slice().sort()) === JSON.stringify(d.columnas.slice().sort())
    );
    if (d.expresion_canonica) {
      check(/upper\(/i.test(real.def) && /regexp_replace\(/i.test(real.def),
        `${d.indice}: se declara canonico y el indice real no normaliza (${real.def})`);
    } else {
      check(!enSnapshot,
        `${d.tabla}: UNIQUE (${d.columnas.join(', ')}) esta en el snapshot productivo y ademas declarado como pendiente`);
    }
  }

  // Grants de funcion pendientes: tienen que existir de verdad tras aplicar las
  // migraciones, y anon no puede haber recibido nada.
  for (const d of PENDIENTES_GRANTS_FN) {
    const nombre = d.funcion.replace(/\(.*$/, '');
    const { rows } = await db.query(`
      select has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
             has_function_privilege('anon', p.oid, 'EXECUTE') anon
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`, [nombre]);
    check(rows.length === 1, `${d.funcion}: se esperaba una unica firma y hay ${rows.length}`);
    if (!rows.length) continue;
    const esperaAuth = (d.repo.authenticated || []).indexOf('EXECUTE') >= 0;
    check(rows[0].auth === esperaAuth,
      `${d.funcion}: authenticated ${rows[0].auth ? 'puede' : 'no puede'} ejecutarla y el repo declara lo contrario`);
    check(rows[0].anon === ((d.repo.anon || []).indexOf('EXECUTE') >= 0),
      `${d.funcion}: anon no puede quedar con EXECUTE`);
  }

  // Grants pendientes: tras reproducir el repo tienen que ser EXACTAMENTE los
  // declarados en «repo». Si sobrara alguno, el endurecimiento no seria tal.
  if (PENDIENTES_GRANTS.length) {
    const { rows: grants } = await db.query(`
      select table_name, grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated')`);
    for (const d of PENDIENTES_GRANTS) {
      for (const rol of Object.keys(d.repo)) {
        const reales = grants
          .filter((g) => g.table_name === d.tabla && g.grantee === rol)
          .map((g) => String(g.privilege_type).toUpperCase())
          .filter((v, i, a) => a.indexOf(v) === i)
          .sort();
        const esperados = d.repo[rol].slice().sort();
        check(
          JSON.stringify(reales) === JSON.stringify(esperados),
          `${d.tabla}: grants de ${rol} son [${reales.join(', ')}] y el repo declara [${esperados.join(', ')}]`
        );
      }
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

  // FK: destino y accion ON DELETE exactos, segun el contrato productivo.
  const { rows: fks } = await db.query(`
    select c.relname tabla, k.conname, pg_get_constraintdef(k.oid) def
      from pg_constraint k join pg_class c on c.oid = k.conrelid
     where k.contype = 'f' and c.relnamespace = 'public'::regnamespace`);
  const accionDe = (def) => {
    const m = /on delete (cascade|set null|set default|restrict)/i.exec(def);
    return m ? m[1].toUpperCase() : 'NO ACTION';
  };
  for (const tabla of TABLAS_BASELINE) {
    const propias = fks.filter((f) => f.tabla === tabla);
    const esperadas = CONTRATO[tabla].fk || [];
    const nuevas = PENDIENTES_FK_NUEVAS.filter((d) => d.tabla === tabla);
    check(
      propias.length === esperadas.length + nuevas.length,
      `${tabla}: ${propias.length} FK, produccion tiene ${esperadas.length}` +
        (nuevas.length ? ` mas ${nuevas.length} declarada(s) como pendiente(s)` : '')
    );
    // Y las declaradas como pendientes tienen que existir de verdad, con la
    // forma exacta que se anuncio: si no, la divergencia seria una anotacion.
    for (const d of nuevas) {
      const real = propias.find((f) => new RegExp('FOREIGN KEY \\(' + d.columna + '\\)', 'i').test(f.def));
      check(Boolean(real), `${tabla}: se declara pendiente la FK sobre ${d.columna} y el repositorio no la crea`);
      if (!real) continue;
      // El destino se compara sin regex: «coi_ordenes(nro_oc)» trae parentesis
      // y escaparlos a mano es justo la clase de detalle que se rompe sola.
      check(real.def.toUpperCase().indexOf(d.destino.toUpperCase()) >= 0,
        `${tabla}.${d.columna}: referencia ${real.def}, se declara ${d.destino}`);
      check(new RegExp('ON UPDATE ' + d.on_update, 'i').test(real.def),
        `${tabla}.${d.columna}: se declara ON UPDATE ${d.on_update} y es ${real.def}`);
      check(new RegExp('ON DELETE ' + d.on_delete, 'i').test(real.def),
        `${tabla}.${d.columna}: se declara ON DELETE ${d.on_delete} y es ${real.def}`);
      // Y no puede figurar ya en el snapshot productivo.
      check(!esperadas.some((e) => e[0] === d.columna),
        `${tabla}: la FK sobre ${d.columna} esta en el snapshot y ademas declarada como pendiente`);
    }
    for (const [col, destino, accion] of esperadas) {
      const fk = propias.find((f) => new RegExp('FOREIGN KEY \\(' + col + '\\)', 'i').test(f.def));
      check(Boolean(fk), `${tabla}: falta la FK sobre ${col} -> ${destino}`);
      if (!fk) continue;
      check(
        new RegExp('REFERENCES (?:[a-z_]+\\.)?' + destino + '\\(', 'i').test(fk.def),
        `${tabla}.${col}: referencia ${fk.def}, produccion espera ${destino}`
      );
      const esperada = accionEsperada(tabla, col, accion);
      check(
        accionDe(fk.def) === esperada,
        `${tabla}.${col}: ON DELETE ${accionDe(fk.def)}, se espera ${esperada}`
      );
    }
  }

  // RLS y policies: nombre, comando, roles, permissive, USING y WITH CHECK.
  const { rows: rlsRows } = await db.query(`
    select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`);
  const rlsPorTabla = new Map(rlsRows.map((r) => [r.relname, r.relrowsecurity]));
  const { rows: policies } = await db.query(`
    select tablename, policyname, cmd, permissive, roles, qual, with_check
      from pg_policies where schemaname = 'public'`);
  const norm = (v) => String(v == null ? '' : v).replace(/[()\s]/g, '').toLowerCase();

  for (const tabla of TABLAS_BASELINE) {
    const spec = CONTRATO[tabla];
    if (spec.rls) {
      check(rlsPorTabla.get(tabla) === true, `${tabla}: produccion tiene RLS habilitado y aca no lo esta`);
    }
    for (const esperada of (spec.policies || [])) {
      const real = policies.find((x) => x.tablename === tabla && x.policyname === esperada.nombre);
      check(Boolean(real), `${tabla}: falta la policy ${esperada.nombre}`);
      if (!real) continue;
      check(
        real.cmd.toUpperCase() === esperada.cmd,
        `${esperada.nombre}: comando ${real.cmd}, produccion espera ${esperada.cmd}`
      );
      const roles = (Array.isArray(real.roles) ? real.roles : String(real.roles).replace(/[{}]/g, '').split(','))
        .map((r) => String(r).trim()).filter(Boolean);
      check(
        roles.length === esperada.roles.length && esperada.roles.every((r) => roles.includes(r)),
        `${esperada.nombre}: roles [${roles.join(', ')}], produccion espera [${esperada.roles.join(', ')}]`
      );
      const permissive = String(real.permissive).toUpperCase().startsWith('PERMISSIVE') || real.permissive === true;
      check(
        permissive === esperada.permissive,
        `${esperada.nombre}: ${permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} y produccion espera lo contrario`
      );
      check(
        norm(real.qual) === norm(esperada.using),
        `${esperada.nombre}: USING ${real.qual || 'ninguno'}, produccion espera ${esperada.using || 'ninguno'}`
      );
      check(
        norm(real.with_check) === norm(esperada.with_check),
        `${esperada.nombre}: WITH CHECK ${real.with_check || 'ninguno'}, produccion espera ${esperada.with_check || 'ninguno'}`
      );
    }
    // Las policies declaradas como divergencia pendiente tienen que existir de
    // verdad al reproducir el repo, con su forma exacta.
    for (const d of PENDIENTES_POLICIES.filter((x) => x.tabla === tabla)) {
      const real = policies.find((x) => x.tablename === tabla && x.policyname === d.nombre);
      check(Boolean(real), `${tabla}: la divergencia pendiente declara la policy ${d.nombre} y el repositorio no la crea`);
      if (!real) continue;
      check(real.cmd.toUpperCase() === d.cmd, `${d.nombre}: comando ${real.cmd}, el repo declara ${d.cmd}`);
      const roles = (Array.isArray(real.roles) ? real.roles : String(real.roles).replace(/[{}]/g, '').split(','))
        .map((r) => String(r).trim()).filter(Boolean);
      check(roles.length === d.roles.length && d.roles.every((r) => roles.includes(r)),
        `${d.nombre}: roles [${roles.join(', ')}], el repo declara [${d.roles.join(', ')}]`);
      const permissive = String(real.permissive).toUpperCase().startsWith('PERMISSIVE') || real.permissive === true;
      check(permissive === d.permissive,
        `${d.nombre}: ${permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} y el repo declara lo contrario`);
      check(norm(real.qual) === norm(d.using),
        `${d.nombre}: USING ${real.qual || 'ninguno'}, el repo declara ${d.using || 'ninguno'}`);
      check(norm(real.with_check) === norm(d.with_check),
        `${d.nombre}: WITH CHECK ${real.with_check || 'ninguno'}, el repo declara ${d.with_check || 'ninguno'}`);
      // Y no puede estar ya en el snapshot: entonces no seria una divergencia.
      check(!(spec.policies || []).some((e) => e.nombre === d.nombre),
        `${tabla}: ${d.nombre} figura en el snapshot productivo y ademas como pendiente`);
    }
    // Ninguna policy de mas sobre las tablas cuyo contrato de policies conocemos.
    // Las pendientes declaradas son el UNICO excedente admitido: cualquier otra
    // sigue siendo un fallo, para que nada entre sin quedar documentado.
    if (spec.policies) {
      const reales = policies.filter((x) => x.tablename === tabla).map((x) => x.policyname);
      const declaradas = PENDIENTES_POLICIES.filter((x) => x.tabla === tabla).map((x) => x.nombre);
      const sobran = reales.filter((n) =>
        !spec.policies.some((e) => e.nombre === n) && declaradas.indexOf(n) < 0);
      check(sobran.length === 0, `${tabla}: policies que produccion no tiene ni estan declaradas como pendientes: ${sobran.join(', ')}`);
    }
  }

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
    JSON.stringify(antes.policies) === JSON.stringify(despues.policies),
    'reaplicar el baseline modifico policies: debe ser un NO-OP estructural'
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
  const totalFk = TABLAS_BASELINE.reduce((a, t) => a + (CONTRATO[t].fk || []).length, 0);
  const totalPol = TABLAS_BASELINE.reduce((a, t) => a + (CONTRATO[t].policies || []).length, 0);
  const dif = PENDIENTES.length;
  console.log(
    `  CASO A · FK con accion ON DELETE     : ${totalFk} verificadas, ` +
    (dif ? `${dif} divergencia(s) pendientes de aplicar en remoto` : '0 diferencias')
  );
  PENDIENTES.forEach((d) => console.log(
    `    pendiente · ${d.tabla}.${d.columna}: repo ${d.repo}, produccion ${d.produccion} (${d.migracion})`
  ));
  if (PENDIENTES_FK_NUEVAS.length) {
    console.log(`  CASO A · FK nuevas del repo          : ${PENDIENTES_FK_NUEVAS.length} divergencia(s) pendientes de aplicar en remoto`);
    PENDIENTES_FK_NUEVAS.forEach((d) => console.log(
      `    pendiente · ${d.tabla}.${d.columna} -> ${d.destino} ON UPDATE ${d.on_update} ON DELETE ${d.on_delete} (${d.migracion})`
    ));
  }
  if (PENDIENTES_UNIQUE.length) {
    console.log(
      `  CASO A · UNIQUE excedentes del repo  : ${PENDIENTES_UNIQUE.length} divergencia(s) pendientes de aplicar en remoto`
    );
    PENDIENTES_UNIQUE.forEach((d) => console.log(
      `    pendiente · ${d.tabla} UNIQUE (${d.columnas.join(', ')}): repo ${d.repo}, produccion ${d.produccion} (${d.migracion})`
    ));
  }
  if (PENDIENTES_POLICIES.length) {
    console.log(`  CASO A · policies excedentes del repo : ${PENDIENTES_POLICIES.length} divergencia(s) pendientes de aplicar en remoto`);
    PENDIENTES_POLICIES.forEach((d) => console.log(
      `    pendiente · ${d.tabla}.${d.nombre} (${d.cmd}, ${d.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}): repo ${d.repo}, produccion ${d.produccion} (${d.migracion})`
    ));
  }
  if (PENDIENTES_GRANTS_FN.length) {
    console.log(`  CASO A · grants de funcion del repo  : ${PENDIENTES_GRANTS_FN.length} divergencia(s) pendientes de aplicar en remoto`);
    PENDIENTES_GRANTS_FN.forEach((d) => console.log(
      `    pendiente · ${d.funcion}: authenticated [${(d.repo.authenticated || []).join(', ') || 'ninguno'}], produccion ${d.produccion} (${d.migracion})`
    ));
  }
  if (PENDIENTES_GRANTS.length) {
    console.log(`  CASO A · grants endurecidos por el repo: ${PENDIENTES_GRANTS.length} divergencia(s) pendientes de aplicar en remoto`);
    PENDIENTES_GRANTS.forEach((d) => console.log(
      `    pendiente · ${d.tabla}: anon [${d.repo.anon.join(', ') || 'ninguno'}], authenticated [${d.repo.authenticated.join(', ')}] (${d.migracion})`
    ));
  }
  console.log(`  CASO A · policies (nombre/cmd/roles/permissive/using/with check): ${totalPol} verificadas, 0 diferencias`);
  console.log(`  CASO B · baseline reaplicado        : NO-OP (columnas, constraints, indices y datos intactos)`);
  console.log(`  CASO B · tablas condicionales       : ${b.creates} create table if not exists, 0 operaciones destructivas`);

  console.log(`${aprobados} controles de reproducibilidad aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('Reproducibilidad del esquema: FALLO');
  console.error(error.message || error);
  process.exit(1);
});
