#!/usr/bin/env node
'use strict';

/*
  H04/H05 — El rol Administrador tambien manda en PostgreSQL.

  La UI reserva las mutaciones de UM y ST al Administrador, pero las policies
  remotas solo exigian estar autenticado: un perfil «consulta» podia llamar a
  PostgREST directamente y crear o modificar. Una restriccion que solo vive en
  JavaScript no es una restriccion.

  Este control aplica todas las migraciones sobre PGlite y ejerce las policies
  REALMENTE, cambiando de rol y de identidad, en vez de limitarse a leer el
  catalogo:

    1) administrador puede SELECT / INSERT / UPDATE en UM y ST;
    2) consulta puede SELECT;
    3) consulta NO puede INSERT;
    4) consulta NO puede UPDATE;
    5) un autenticado sin perfil activo no pasa el guard;
    6) anon no tiene ningun privilegio sobre las tablas;
    7) authenticated tiene exactamente SELECT/INSERT/UPDATE: sin DELETE,
       TRUNCATE, REFERENCES ni TRIGGER;
    8) no existe ninguna policy DELETE;
    9) RLS sigue habilitada en ambas tablas;
   10) la migracion es idempotente y no toca datos.

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
const MIGRACION = '202608310002_h04_h05_role_guard.sql';
const TABLAS = ['coi_unidades_mantenimiento', 'coi_servicios_tecnicos_um'];

const ADMIN = '11111111-1111-4111-8111-111111111111';
const CONSULTA = '22222222-2222-4222-8222-222222222222';
const SIN_PERFIL = '33333333-3333-4333-8333-333333333333';

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

async function main() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of archivos()) await db.exec(leer(f));

  // Perfiles: un administrador, un consulta y un usuario sin perfil activo.
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@coiroca.com'),
      ('${CONSULTA}', 'consulta@coiroca.com'),
      ('${SIN_PERFIL}', 'fantasma@coiroca.com');
    insert into public.profiles (id, email, rol, activo) values
      ('${ADMIN}', 'admin@coiroca.com', 'administrador', true),
      ('${CONSULTA}', 'consulta@coiroca.com', 'consulta', true);
  `);

  // Una UM y un ST de partida, creados como propietario (sin RLS de por medio).
  const { rows: semilla } = await db.query(`
    insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
    values ('ROL-UM-001', 'Ascensor', 'PLAZA CONSTITUCION', 'ACTIVA') returning id`);
  const unidadId = semilla[0].id;
  await db.query(`
    insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, fecha, descripcion, estado)
    values ($1, 'ROL-ST-001', current_date, 'Semilla', 'Pendiente')`, [unidadId]);

  // Ejecuta una sentencia haciendose pasar por un rol y una identidad concretos.
  async function como(rol, uid, sql, params) {
    await db.exec('begin;');
    try {
      await db.exec(`set local role ${rol};`);
      if (uid) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      else await db.query("select set_config('request.jwt.claim.sub', '', true)");
      const r = await db.query(sql, params || []);
      await db.exec('commit;');
      return r;
    } catch (error) {
      await db.exec('rollback;');
      throw error;
    }
  }
  const intento = (rol, uid, sql, params) => fallo(() => como(rol, uid, sql, params));

  // ---------------------------------------------------------------- 1) admin
  for (const tabla of TABLAS) {
    const lectura = await intento('authenticated', ADMIN, `select count(*) from public.${tabla}`);
    check(!lectura, `administrador deberia poder leer ${tabla}: ${lectura}`);
  }
  const altaUM = await intento('authenticated', ADMIN,
    `insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
     values ('ROL-UM-ADMIN', 'Ascensor', 'TEMPERLEY', 'ACTIVA')`);
  check(!altaUM, `administrador deberia poder crear UM: ${altaUM}`);
  const editaUM = await intento('authenticated', ADMIN,
    `update public.coi_unidades_mantenimiento set sector = 'Anden 1' where codigo_um = 'ROL-UM-001'`);
  check(!editaUM, `administrador deberia poder modificar UM: ${editaUM}`);

  const altaST = await intento('authenticated', ADMIN,
    `insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, fecha, descripcion, estado)
     values ($1, 'ROL-ST-ADMIN', current_date, 'Alta admin', 'Pendiente')`, [unidadId]);
  check(!altaST, `administrador deberia poder crear ST: ${altaST}`);
  const editaST = await intento('authenticated', ADMIN,
    `update public.coi_servicios_tecnicos_um set tecnico = 'A. Admin' where nro_st = 'ROL-ST-001'`);
  check(!editaST, `administrador deberia poder modificar ST: ${editaST}`);

  // ------------------------------------------------------------- 2) consulta
  for (const tabla of TABLAS) {
    const lectura = await intento('authenticated', CONSULTA, `select count(*) from public.${tabla}`);
    check(!lectura, `consulta deberia poder leer ${tabla}: ${lectura}`);
  }

  // ------------------------------------------------- 3) y 4) consulta no muta
  const insertConsultaUM = await intento('authenticated', CONSULTA,
    `insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
     values ('ROL-UM-CONSULTA', 'Ascensor', 'QUILMES', 'ACTIVA')`);
  check(Boolean(insertConsultaUM), 'un perfil consulta NO deberia poder crear UM');
  check(/row-level security|policy/i.test(insertConsultaUM),
    `el INSERT de consulta deberia frenarlo la RLS: ${insertConsultaUM}`);

  const insertConsultaST = await intento('authenticated', CONSULTA,
    `insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, fecha, descripcion, estado)
     values ($1, 'ROL-ST-CONSULTA', current_date, 'No permitido', 'Pendiente')`, [unidadId]);
  check(Boolean(insertConsultaST), 'un perfil consulta NO deberia poder crear ST');

  // Un UPDATE bloqueado por RLS no lanza error: no encuentra filas. Lo que
  // importa es que NO cambie nada, asi que se comprueba el dato.
  await intento('authenticated', CONSULTA,
    `update public.coi_unidades_mantenimiento set sector = 'PISOTON' where codigo_um = 'ROL-UM-001'`);
  const { rows: umTrasConsulta } = await db.query(
    `select sector from public.coi_unidades_mantenimiento where codigo_um = 'ROL-UM-001'`);
  check(umTrasConsulta[0].sector === 'Anden 1',
    `un perfil consulta NO deberia poder modificar UM y dejo sector=${umTrasConsulta[0].sector}`);

  await intento('authenticated', CONSULTA,
    `update public.coi_servicios_tecnicos_um set tecnico = 'PISOTON' where nro_st = 'ROL-ST-001'`);
  const { rows: stTrasConsulta } = await db.query(
    `select tecnico from public.coi_servicios_tecnicos_um where nro_st = 'ROL-ST-001'`);
  check(stTrasConsulta[0].tecnico === 'A. Admin',
    `un perfil consulta NO deberia poder modificar ST y dejo tecnico=${stTrasConsulta[0].tecnico}`);

  // ------------------------------------------- 5) autenticado sin perfil activo
  const sinPerfil = await intento('authenticated', SIN_PERFIL,
    `insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
     values ('ROL-UM-FANTASMA', 'Ascensor', 'BERNAL', 'ACTIVA')`);
  check(Boolean(sinPerfil), 'un autenticado sin perfil activo NO deberia poder crear UM');
  const { rows: leeSinPerfil } = await como('authenticated', SIN_PERFIL,
    'select count(*)::int n from public.coi_unidades_mantenimiento');
  check(leeSinPerfil[0].n === 0,
    'un autenticado sin perfil activo tampoco deberia ver filas: el guard de SELECT exige perfil');

  // -------------------------------------------------------------- 6) anon
  for (const tabla of TABLAS) {
    const lectura = await intento('anon', null, `select count(*) from public.${tabla}`);
    check(Boolean(lectura), `anon no deberia poder leer ${tabla}`);
    check(/permission denied/i.test(lectura), `anon deberia ser rechazado por privilegios: ${lectura}`);
  }

  // ------------------------------------------------------------ 7) grants
  const { rows: grants } = await db.query(`
    select table_name, grantee, privilege_type
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = any($1)
       and grantee in ('anon', 'authenticated')`, [TABLAS]);
  for (const tabla of TABLAS) {
    const deAnon = grants.filter((g) => g.table_name === tabla && g.grantee === 'anon');
    check(deAnon.length === 0, `anon conserva privilegios sobre ${tabla}: ${deAnon.map((g) => g.privilege_type).join(', ')}`);

    const deAuth = grants
      .filter((g) => g.table_name === tabla && g.grantee === 'authenticated')
      .map((g) => g.privilege_type.toUpperCase())
      .sort();
    check(
      JSON.stringify(deAuth) === JSON.stringify(['INSERT', 'SELECT', 'UPDATE']),
      `authenticated deberia tener exactamente SELECT/INSERT/UPDATE sobre ${tabla} y tiene: ${deAuth.join(', ')}`
    );
    for (const prohibido of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      check(!deAuth.includes(prohibido), `authenticated no deberia tener ${prohibido} sobre ${tabla}`);
    }
  }

  // -------------------------------------------------- 8) y 9) policies y RLS
  const { rows: policies } = await db.query(`
    select tablename, policyname, cmd, permissive, roles::text roles, qual, with_check
      from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLAS]);
  check(policies.filter((p) => String(p.cmd).toUpperCase() === 'DELETE').length === 0,
    'no puede existir ninguna policy DELETE sobre UM/ST');

  for (const tabla of TABLAS) {
    const restrictivas = policies.filter(
      (p) => p.tablename === tabla && String(p.permissive).toUpperCase() === 'RESTRICTIVE');
    check(restrictivas.length === 3,
      `${tabla} deberia tener 3 policies restrictivas (select/insert/update) y tiene ${restrictivas.length}`);
    for (const cmd of ['SELECT', 'INSERT', 'UPDATE']) {
      const r = restrictivas.find((x) => String(x.cmd).toUpperCase() === cmd);
      check(Boolean(r), `${tabla}: falta la restrictiva de ${cmd}`);
      if (!r) continue;
      check(/authenticated/.test(r.roles), `${r.policyname}: deberia aplicar a authenticated y aplica a ${r.roles}`);
      const cuerpo = String(r.qual || '') + ' ' + String(r.with_check || '');
      check(/coi_current_role/.test(cuerpo), `${r.policyname}: deberia consultar coi_current_role()`);
      if (cmd !== 'SELECT') {
        check(/administrador/.test(cuerpo), `${r.policyname}: deberia exigir el rol administrador`);
      }
    }
    // Las permisivas originales siguen existiendo: la restrictiva estrecha, no
    // reemplaza. Si alguien las hubiera borrado, la tabla quedaria sin acceso.
    const permisivas = policies.filter(
      (p) => p.tablename === tabla && String(p.permissive).toUpperCase() === 'PERMISSIVE');
    check(permisivas.length >= 3, `${tabla}: las policies permisivas originales no deberian eliminarse`);

    const { rows: rls } = await db.query(
      'select relrowsecurity from pg_class where oid = $1::regclass', ['public.' + tabla]);
    check(rls[0].relrowsecurity === true, `${tabla}: RLS quedo deshabilitada`);
  }

  // ------------------------------------------------------ 10) idempotencia
  const { rows: antes } = await db.query(`
    select (select count(*)::int from public.coi_unidades_mantenimiento) um,
           (select count(*)::int from public.coi_servicios_tecnicos_um) st`);
  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar la migracion fallo: ${reaplicar}`);
  const { rows: despues } = await db.query(`
    select (select count(*)::int from public.coi_unidades_mantenimiento) um,
           (select count(*)::int from public.coi_servicios_tecnicos_um) st`);
  check(antes[0].um === despues[0].um && antes[0].st === despues[0].st,
    'reaplicar la migracion no puede cambiar los datos');

  // Se analizan SENTENCIAS, no prosa: los comentarios de esta migracion nombran
  // a proposito DELETE y TRUNCATE para explicar que authenticated NO los tiene,
  // y buscarlos sobre el texto crudo daria un falso positivo.
  const sinComentarios = leer(MIGRACION).replace(/--[^\n]*/g, '');
  const cuerpo = sinComentarios;
  for (const patron of [
    /\btruncate\b/i,
    /\bdrop\s+table\b/i,
    /\bdelete\s+from\b/i,
    /\bupdate\s+public\./i,
    /\binsert\s+into\b/i,
    /\bcreate\s+policy\s+\w+\s+on\s+public\.\w+\s+for\s+delete\b/i,
    /\bdisable\s+row\s+level\s+security\b/i
  ]) check(!patron.test(cuerpo), `la migracion no deberia contener: ${patron}`);
  check(/grant select, insert, update/i.test(cuerpo), 'la migracion debe declarar los grants exactos');
  check(!/grant all/i.test(cuerpo), 'la migracion no puede otorgar ALL');

  await db.close();

  console.log('H04/H05 rol: la autorizacion deja de depender del navegador.');
  console.log('  administrador            : SELECT / INSERT / UPDATE en UM y ST');
  console.log('  consulta                 : SELECT; INSERT y UPDATE rechazados');
  console.log('  autenticado sin perfil   : no ve ni escribe');
  console.log('  anon                     : sin privilegios sobre ambas tablas');
  console.log('  authenticated            : exactamente SELECT/INSERT/UPDATE');
  console.log('  policies DELETE          : ninguna');
  console.log('  RLS                      : habilitada en ambas tablas');
  console.log('  Idempotencia             : reaplicar es NO-OP y no toca datos');
  console.log(`${aprobados} controles H04/H05 de rol aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('H04/H05 role guard FAIL:', error.message || error);
  process.exit(1);
});
