#!/usr/bin/env node
'use strict';

/*
  H08 — El trigger ST -> OC necesita row locks sobre coi_ordenes sin abrir
  UPDATE directo a authenticated.

  Reproduce el hallazgo real del rollout: antes de H08 un Administrador podia
  pasar la RLS de coi_servicios_tecnicos_um pero el INSERT vinculado a una OC
  fallaba dentro de coi_st_resolver_nro_oc() con permission denied, porque
  SELECT ... FOR UPDATE sobre coi_ordenes exige privilegio UPDATE.

  El control exige simultaneamente:
    1) coi_st_resolver_nro_oc() es SECURITY DEFINER;
    2) search_path queda fijado a pg_catalog, public, pg_temp;
    3) authenticated sigue SIN UPDATE directo sobre coi_ordenes;
    4) anon/authenticated no pueden EXECUTE la funcion directamente;
    5) un Administrador autenticado SI puede crear un ST vinculado a una OC;
    6) el trigger completa orden_id y nro_oc canonico;
    7) reaplicar la migracion es idempotente.

  No toca STAGING ni PRODUCCION.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const DIR = 'supabase/migrations';
const MIGRACION = '202609050001_h08_st_trigger_privilege_guard.sql';
const ADMIN = '88888888-8888-4888-8888-888888888888';

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
const fallo = async (fn) => {
  try { await fn(); return null; } catch (error) { return String(error.message || error); }
};

async function como(db, rol, uid, sql, params) {
  await db.exec('begin;');
  try {
    await db.exec(`set local role ${rol};`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
    const r = await db.query(sql, params || []);
    await db.exec('commit;');
    return r;
  } catch (error) {
    await db.exec('rollback;');
    throw error;
  }
}

async function nuevaOC(db, nro) {
  await db.exec('begin;');
  try {
    const { rows } = await db.query(
      `insert into public.coi_ordenes (nro_oc, tipo, estado_coi)
       values ($1, 'Servicio', 'En ejecución') returning id, nro_oc`, [nro]);
    await db.query(
      `insert into public.coi_ordenes_estaciones (orden_id, nro_oc, estacion, es_principal)
       values ($1, $2, 'PLAZA CONSTITUCION', true)`, [rows[0].id, rows[0].nro_oc]);
    await db.exec('commit;');
    return rows[0];
  } catch (error) {
    await db.exec('rollback;');
    throw error;
  }
}

async function privilegiosDirectosTrigger(db) {
  const { rows } = await db.query(`
    select grantee, privilege_type
      from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name = 'coi_st_resolver_nro_oc'
       and grantee in ('PUBLIC', 'anon', 'authenticated')`);
  return rows.filter((g) => String(g.privilege_type || '').toUpperCase() === 'EXECUTE');
}

async function main() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of archivos()) await db.exec(leer(f));

  await db.exec(`
    insert into auth.users (id, email)
    values ('${ADMIN}', 'h08-admin@coiroca.com');
    insert into public.profiles (id, email, rol, activo)
    values ('${ADMIN}', 'h08-admin@coiroca.com', 'administrador', true);
  `);

  const orden = await nuevaOC(db, '4530-001234');
  const { rows: ums } = await db.query(`
    insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
    values ('H08-UM-001', 'Ascensor', 'PLAZA CONSTITUCION', 'ACTIVA') returning id`);
  const unidadId = ums[0].id;

  const { rows: fn } = await db.query(`
    select p.prosecdef, p.proconfig, r.rolname owner
      from pg_proc p
      join pg_roles r on r.oid = p.proowner
     where p.oid = 'public.coi_st_resolver_nro_oc()'::regprocedure`);
  check(fn.length === 1, 'falta coi_st_resolver_nro_oc()');
  check(fn[0].prosecdef === true, 'coi_st_resolver_nro_oc() debe ser SECURITY DEFINER');
  const config = String((fn[0].proconfig || []).join(' | '));
  check(/search_path=.*pg_catalog.*public.*pg_temp/i.test(config),
    `search_path inseguro o incompleto: ${config}`);

  // Mismo patron de inspeccion que check_h04_h05_role_guard.js: se traen las
  // filas de information_schema y se filtran en JS. Eso es portable en PGlite.
  const { rows: grantsOC } = await db.query(`
    select table_name, grantee, privilege_type
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'coi_ordenes'
       and grantee = 'authenticated'`);
  const updateDirecto = grantsOC.filter(
    (g) => String(g.privilege_type || '').toUpperCase() === 'UPDATE');
  check(updateDirecto.length === 0,
    'H08 no puede conceder UPDATE directo sobre coi_ordenes a authenticated');

  const execDirecto = await privilegiosDirectosTrigger(db);
  check(execDirecto.length === 0,
    `PUBLIC/anon/authenticated no deben tener EXECUTE directo: ${execDirecto.map((g) => g.grantee).join(', ')}`);

  // Prueba efectiva del limite: aunque sea Administrador, authenticated sigue
  // sin poder tomar por si mismo el lock de coi_ordenes.
  const directa = await fallo(() => como(db, 'authenticated', ADMIN,
    `select id from public.coi_ordenes where id = $1 for update`, [orden.id]));
  check(Boolean(directa) && /permission denied/i.test(directa),
    `authenticated sigue sin poder lockear coi_ordenes directamente: ${directa}`);

  // Pero el trigger SECURITY DEFINER SI puede tomar ese lock despues de que la
  // RLS de la tabla hija haya autorizado la mutacion del Administrador.
  const alta = await fallo(() => como(db, 'authenticated', ADMIN,
    `insert into public.coi_servicios_tecnicos_um
       (unidad_id, nro_st, nro_oc, fecha, descripcion, estado)
     values ($1, 'H08-ST-001', 'OC 4530001234', current_date, 'Smoke H08', 'Pendiente')`,
    [unidadId]));
  check(!alta, `un Administrador debe poder crear ST vinculado tras H08: ${alta}`);

  const { rows: st } = await db.query(`
    select orden_id, nro_oc from public.coi_servicios_tecnicos_um
     where nro_st = 'H08-ST-001'`);
  check(st.length === 1, 'el ST de prueba no quedo insertado');
  check(st[0].orden_id === orden.id,
    `el trigger debe resolver el UUID de la OC; obtuvo ${st[0].orden_id}`);
  check(st[0].nro_oc === '4530001234',
    `el trigger debe guardar el numero canonico; obtuvo ${st[0].nro_oc}`);

  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar H08 debe ser idempotente: ${reaplicar}`);

  const { rows: trasFn } = await db.query(`
    select p.prosecdef
      from pg_proc p
     where p.oid = 'public.coi_st_resolver_nro_oc()'::regprocedure`);
  const trasExec = await privilegiosDirectosTrigger(db);
  check(trasFn[0].prosecdef === true && trasExec.length === 0,
    'reaplicar H08 debe conservar SECURITY DEFINER y EXECUTE directo revocado');

  // Control estatico complementario: el SQL debe contener la revocacion, aun
  // si un motor de test expone routine_privileges de forma distinta a Postgres.
  const sql = leer(MIGRACION).replace(/--[^\n]*/g, ' ');
  check(/revoke\s+all\s+on\s+function\s+public\.coi_st_resolver_nro_oc\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql),
    'la migracion debe revocar EXECUTE directo a PUBLIC, anon y authenticated');

  console.log(`OK H08 ST trigger privilege guard: ${aprobados} controles.`);
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
