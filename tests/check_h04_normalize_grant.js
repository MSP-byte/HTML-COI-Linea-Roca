#!/usr/bin/env node
'use strict';

/*
  H04 — La prevalidacion del frontend usa la MISMA identidad de OC que la base.

  La integridad final ya vive en 202608310004 (trigger + FK). Pero la capa H05
  conserva una prevalidacion remota —y debe conservarla: mientras las migraciones
  del PR no esten desplegadas, es la unica defensa fail-closed—, y esa
  prevalidacion resolvia la OC con eq()/ilike() sobre el texto crudo. Eso es una
  segunda definicion de identidad, mas estrecha que coi_normalize_order_number:
  «OC 4530008964» designa la misma orden para PostgreSQL y la UI lo rechazaba
  antes de intentar escribirlo.

  La solucion minima fue conceder EXECUTE de esa funcion a authenticated, en
  lugar de reimplementar la normalizacion. Este control verifica:

    1) authenticated puede ejecutar coi_normalize_order_number;
    2) anon NO puede;
    3) la funcion sigue siendo pura: sql, immutable, strict y NO security definer;
    4) las variantes que el frontend va a mandar normalizan al mismo valor que la
       forma almacenada por coi_ordenes;
    5) la migracion no crea ni altera funciones, tablas, policies ni datos;
    6) reaplicarla es NO-OP.

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
const MIGRACION = '202608310005_h04_normalize_order_number_grant.sql';
const FUNCION = 'coi_normalize_order_number';

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

  // 3) la funcion sigue siendo pura: eso es lo que hace inocuo el grant.
  const { rows: meta } = await db.query(`
    select p.provolatile, p.proisstrict, p.prosecdef, l.lanname
      from pg_proc p
      join pg_language l on l.oid = p.prolang
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`, [FUNCION]);
  check(meta.length === 1, `se esperaba una unica firma de ${FUNCION} y hay ${meta.length}`);
  check(meta[0].lanname === 'sql', `${FUNCION} deberia ser SQL plano y es ${meta[0].lanname}`);
  check(meta[0].provolatile === 'i', `${FUNCION} deberia ser IMMUTABLE`);
  check(meta[0].proisstrict === true, `${FUNCION} deberia ser STRICT`);
  check(meta[0].prosecdef === false,
    `${FUNCION} NO puede ser security definer: exponerla dejaria de ser inocuo`);

  // Ejecuta una consulta haciendose pasar por un rol concreto.
  async function como(rol, sql, params) {
    await db.exec('begin;');
    try {
      await db.exec(`set local role ${rol};`);
      const r = await db.query(sql, params || []);
      await db.exec('commit;');
      return r;
    } catch (error) {
      await db.exec('rollback;');
      throw error;
    }
  }

  // 1) authenticated puede ejecutarla.
  const errorAuth = await fallo(() => como('authenticated',
    `select public.${FUNCION}($1) v`, ['OC 4530008964']));
  check(!errorAuth, `authenticated deberia poder normalizar un numero de OC: ${errorAuth}`);

  // 2) anon no.
  const errorAnon = await fallo(() => como('anon', `select public.${FUNCION}($1) v`, ['4530008964']));
  check(Boolean(errorAnon), 'anon NO deberia poder ejecutar la normalizacion');
  check(/permission denied/i.test(errorAnon), `anon deberia ser rechazado por privilegios: ${errorAnon}`);

  // 4) las variantes que el operador puede escribir resuelven al valor que
  //    coi_ordenes almacena. Es la garantia de que la UI y la base coinciden.
  await db.exec('begin;');
  const { rows: orden } = await db.query(
    `insert into public.coi_ordenes (nro_oc, tipo, estado_coi)
     values ('4530-008964', 'Servicio', 'En ejecución') returning id, nro_oc`);
  await db.query(
    `insert into public.coi_ordenes_estaciones (orden_id, nro_oc, estacion, es_principal)
     values ($1, $2, 'PLAZA CONSTITUCION', true)`, [orden[0].id, orden[0].nro_oc]);
  await db.exec('commit;');

  const almacenado = orden[0].nro_oc;
  check(almacenado === '4530008964',
    `coi_ordenes almacena el numero ya normalizado y quedo ${almacenado}`);

  for (const variante of [
    '4530008964', '4530-008964', '4530.008964', '4530 008964',
    'OC 4530008964', 'OC-4530008964', 'oc 4530-008964', '  4530008964  '
  ]) {
    const { rows } = await como('authenticated', `select public.${FUNCION}($1) v`, [variante]);
    check(rows[0].v === almacenado,
      `«${variante}» deberia normalizar a ${almacenado} y dio ${rows[0].v}`);
    // Y con ese valor la busqueda por igualdad encuentra exactamente una orden,
    // que es el flujo que hace la capa.
    const { rows: halladas } = await db.query(
      'select nro_oc from public.coi_ordenes where nro_oc = $1', [rows[0].v]);
    check(halladas.length === 1,
      `buscando por «${variante}» normalizado deberia haber exactamente 1 orden y hay ${halladas.length}`);
  }

  // Un numero que no designa ninguna orden normaliza igual, pero no encuentra nada.
  const { rows: otro } = await como('authenticated', `select public.${FUNCION}($1) v`, ['OC 4530999999']);
  const { rows: ninguna } = await db.query(
    'select nro_oc from public.coi_ordenes where nro_oc = $1', [otro[0].v]);
  check(ninguna.length === 0, 'un numero inexistente no puede encontrar ninguna orden');

  // 6) idempotencia.
  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar la migracion fallo: ${reaplicar}`);
  const sigueAuth = await fallo(() => como('authenticated', `select public.${FUNCION}('4530008964') v`));
  check(!sigueAuth, 'reaplicar la migracion no puede quitarle el permiso a authenticated');
  const sigueAnon = await fallo(() => como('anon', `select public.${FUNCION}('4530008964') v`));
  check(Boolean(sigueAnon), 'reaplicar la migracion no puede darle el permiso a anon');

  await db.close();

  // 5) la migracion es solo un grant.
  const cuerpo = leer(MIGRACION).replace(/--[^\n]*/g, '');
  for (const patron of [
    /\bcreate\s+or\s+replace\s+function\b/i,
    /\bcreate\s+table\b/i,
    /\balter\s+table\b/i,
    /\bcreate\s+policy\b/i,
    /\bdrop\b/i,
    /\btruncate\b/i,
    /\bdelete\s+from\b/i,
    /\binsert\s+into\b/i,
    /\bupdate\s+public\./i
  ]) check(!patron.test(cuerpo), `la migracion deberia ser solo un grant y contiene: ${patron}`);
  check(/grant execute on function public\.coi_normalize_order_number\(text\) to authenticated;/i.test(cuerpo),
    'falta el grant a authenticated');
  check(/revoke all on function public\.coi_normalize_order_number\(text\) from public, anon;/i.test(cuerpo),
    'anon tiene que quedar explicitamente revocado');
  check(!/to anon/i.test(cuerpo), 'la migracion no puede concederle nada a anon');

  console.log('H04: la prevalidacion de OC usa la identidad canonica de PostgreSQL.');
  console.log(`  ${FUNCION} : sql, immutable, strict, NO security definer`);
  console.log('  authenticated                            : puede normalizar');
  console.log('  anon                                     : sigue revocado');
  console.log('  OC 4530008964 / 4530-008964 / 4530.008964: normalizan a 4530008964');
  console.log('  Numero inexistente                       : normaliza pero no encuentra orden');
  console.log('  Migracion                                : solo un grant');
  console.log('  Idempotencia                             : reaplicar es NO-OP');
  console.log(`${aprobados} controles H04 de normalizacion aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('H04 normalize grant FAIL:', error.message || error);
  process.exit(1);
});
