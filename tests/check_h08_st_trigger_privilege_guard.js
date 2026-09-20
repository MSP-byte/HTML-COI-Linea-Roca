#!/usr/bin/env node
'use strict';

/*
  H08 — El trigger ST -> OC necesita row locks sobre coi_ordenes sin abrir
  UPDATE directo a authenticated.

  Este control reproduce el hallazgo REAL del rollout, no una suposicion sobre
  los grants de la base sintetica:

    - construye el esquema hasta H07/H04/H05, SIN aplicar H08;
    - replica explicitamente el limite remoto confirmado en STAGING:
      authenticated NO tiene UPDATE directo sobre coi_ordenes;
    - demuestra que el INSERT de un ST vinculado falla antes de H08 porque el
      trigger invoker intenta SELECT ... FOR UPDATE sobre coi_ordenes;
    - aplica H08;
    - demuestra que el mismo INSERT pasa, sin devolver UPDATE directo al cliente;
    - verifica SECURITY DEFINER, search_path endurecido, EXECUTE directo revocado,
      resolucion UUID/numero canonico e idempotencia.

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
const H08 = '202609050001_h08_st_trigger_privilege_guard.sql';
const H08_RECONCILE = '202609050002_h08_st_trigger_privilege_reconcile.sql';
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

async function grantsOCAuthenticated(db) {
  const { rows } = await db.query(`
    select table_name, grantee, privilege_type
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'coi_ordenes'
       and grantee = 'authenticated'`);
  return rows.map((g) => String(g.privilege_type || '').toUpperCase()).sort();
}

async function execDirectoTrigger(db) {
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

  // Construccion PRE-H08: asi se prueba el fallo y luego su correccion.
  for (const f of archivos()) {
    if (f === H08 || f === H08_RECONCILE) continue;
    await db.exec(leer(f));
  }

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

  // El esquema sintetico historico puede traer grants mas amplios que el remoto.
  // Se replica aqui el limite REAL confirmado por el smoke de STAGING: el cliente
  // autenticado no tiene UPDATE directo sobre la tabla maestra de OCs.
  await db.exec('revoke update on public.coi_ordenes from authenticated;');

  let grants = await grantsOCAuthenticated(db);
  check(!grants.includes('UPDATE'),
    `fixture H08 invalido: authenticated conserva UPDATE sobre coi_ordenes (${grants.join(', ')})`);

  const { rows: antesFn } = await db.query(`
    select p.prosecdef
      from pg_proc p
     where p.oid = 'public.coi_st_resolver_nro_oc()'::regprocedure`);
  check(antesFn.length === 1 && antesFn[0].prosecdef === false,
    'antes de H08, coi_st_resolver_nro_oc() debe ejecutar con privilegios del invocante');

  // Non-vacuity 1: el cliente tampoco puede tomar ese lock directamente.
  const lockDirectoAntes = await fallo(() => como(db, 'authenticated', ADMIN,
    `select id from public.coi_ordenes where id = $1 for update`, [orden.id]));
  check(Boolean(lockDirectoAntes) && /permission denied/i.test(lockDirectoAntes),
    `PRE-H08: SELECT FOR UPDATE directo deberia fallar por privilegios: ${lockDirectoAntes}`);

  // Non-vacuity 2: se reproduce el bug exacto detectado en STAGING.
  const altaAntes = await fallo(() => como(db, 'authenticated', ADMIN,
    `insert into public.coi_servicios_tecnicos_um
       (unidad_id, nro_st, nro_oc, fecha, descripcion, estado)
     values ($1, 'H08-ST-001', 'OC 4530001234', current_date, 'Smoke pre H08', 'Pendiente')`,
    [unidadId]));
  check(Boolean(altaAntes) && /permission denied/i.test(altaAntes),
    `PRE-H08: el ST vinculado deberia reproducir permission denied en coi_ordenes: ${altaAntes}`);

  const { rows: ceroAntes } = await db.query(
    `select count(*)::int n from public.coi_servicios_tecnicos_um where nro_st='H08-ST-001'`);
  check(ceroAntes[0].n === 0, 'el intento PRE-H08 fallido no puede dejar un ST parcial');

  // Aplicacion del hotfix y de la reconciliacion final exactamente como en repo.
  await db.exec(leer(H08));
  await db.exec(leer(H08_RECONCILE));

  const { rows: fn } = await db.query(`
    select p.prosecdef, p.proconfig, r.rolname owner
      from pg_proc p
      join pg_roles r on r.oid = p.proowner
     where p.oid = 'public.coi_st_resolver_nro_oc()'::regprocedure`);
  check(fn.length === 1, 'falta coi_st_resolver_nro_oc() despues de H08');
  check(fn[0].prosecdef === true, 'H08 debe convertir coi_st_resolver_nro_oc() a SECURITY DEFINER');
  const config = String((fn[0].proconfig || []).join(' | '));
  check(/search_path=.*pg_catalog.*public.*pg_temp/i.test(config),
    `H08 debe fijar search_path endurecido; obtuvo: ${config}`);

  grants = await grantsOCAuthenticated(db);
  check(!grants.includes('UPDATE'),
    `H08 NO puede devolver UPDATE directo sobre coi_ordenes (${grants.join(', ')})`);

  const execDirecto = await execDirectoTrigger(db);
  check(execDirecto.length === 0,
    `PUBLIC/anon/authenticated no deben tener EXECUTE directo: ${execDirecto.map((g) => g.grantee).join(', ')}`);

  // El limite directo se mantiene DESPUES del fix.
  const lockDirectoDespues = await fallo(() => como(db, 'authenticated', ADMIN,
    `select id from public.coi_ordenes where id = $1 for update`, [orden.id]));
  check(Boolean(lockDirectoDespues) && /permission denied/i.test(lockDirectoDespues),
    `POST-H08: authenticated sigue sin poder lockear coi_ordenes directamente: ${lockDirectoDespues}`);

  // Pero el trigger, una vez autorizada la fila hija por RLS, ya puede tomar el
  // lock como su propietario y resolver la referencia sin ampliar grants cliente.
  const altaDespues = await fallo(() => como(db, 'authenticated', ADMIN,
    `insert into public.coi_servicios_tecnicos_um
       (unidad_id, nro_st, nro_oc, fecha, descripcion, estado)
     values ($1, 'H08-ST-001', 'OC 4530001234', current_date, 'Smoke post H08', 'Pendiente')`,
    [unidadId]));
  check(!altaDespues, `POST-H08: Administrador debe poder crear ST vinculado: ${altaDespues}`);

  const { rows: st } = await db.query(`
    select orden_id, nro_oc from public.coi_servicios_tecnicos_um
     where nro_st = 'H08-ST-001'`);
  check(st.length === 1, 'POST-H08: el ST de prueba no quedo insertado');
  check(st[0].orden_id === orden.id,
    `POST-H08: el trigger debe resolver UUID ${orden.id}; obtuvo ${st[0].orden_id}`);
  check(st[0].nro_oc === '4530001234',
    `POST-H08: el trigger debe guardar numero canonico; obtuvo ${st[0].nro_oc}`);

  // Reaplicar ambas migraciones es NO-OP funcional.
  const reaplicar = await fallo(async () => {
    await db.exec(leer(H08));
    await db.exec(leer(H08_RECONCILE));
  });
  check(!reaplicar, `reaplicar H08 debe ser idempotente: ${reaplicar}`);
  const { rows: trasFn } = await db.query(`
    select p.prosecdef from pg_proc p
     where p.oid = 'public.coi_st_resolver_nro_oc()'::regprocedure`);
  const trasExec = await execDirectoTrigger(db);
  const grantsTras = await grantsOCAuthenticated(db);
  check(trasFn[0].prosecdef === true && trasExec.length === 0 && !grantsTras.includes('UPDATE'),
    'reaplicar H08 debe conservar SECURITY DEFINER, EXECUTE revocado y UPDATE de OC sin conceder');

  // Controles estaticos complementarios para evitar que un cambio futuro vuelva
  // a resolver el problema con un GRANT amplio al cliente.
  const sql = (leer(H08) + '\n' + leer(H08_RECONCILE)).replace(/--[^\n]*/g, ' ');
  check(/security\s+definer/i.test(sql), 'H08 debe declarar SECURITY DEFINER');
  check(/revoke\s+all\s+on\s+function\s+public\.coi_st_resolver_nro_oc\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql),
    'H08 debe revocar EXECUTE directo a PUBLIC, anon y authenticated');
  check(!/grant\s+(?:update|all)\s+on\s+(?:table\s+)?public\.coi_ordenes\s+to\s+authenticated/i.test(sql),
    'H08 no puede resolver el lock concediendo UPDATE/ALL de coi_ordenes a authenticated');

  console.log(`OK H08 ST trigger privilege guard: ${aprobados} controles.`);
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
