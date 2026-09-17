#!/usr/bin/env node
'use strict';

/*
  CAMBIO 3 — modalidad_certificacion en coi_ordenes.

  Se verifica sobre PGlite con TODAS las migraciones aplicadas, no sólo el
  texto del archivo: dominio cerrado, default, compatibilidad con registros
  históricos, ausencia de operaciones destructivas e idempotencia.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const DIR = 'supabase/migrations';
const MIGRACION = '202609170003_modalidad_certificacion.sql';

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
  try { await fn(); return null; } catch (e) { return String(e.message || e); }
};

async function nuevaBase() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of archivos()) await db.exec(leer(f));
  return db;
}

/* La OC y su estación principal se crean juntas: el guard de ciclo de vida
   exige exactamente una principal por orden. */
async function insertar(db, nro, modalidad) {
  await db.exec('begin;');
  try {
    const res = modalidad === undefined
      ? await db.query(
        "insert into public.coi_ordenes (nro_oc, tipo, estado_coi) values ($1, 'Servicio', 'En ejecución') returning id, modalidad_certificacion",
        [nro])
      : await db.query(
        "insert into public.coi_ordenes (nro_oc, tipo, estado_coi, modalidad_certificacion) values ($1, 'Servicio', 'En ejecución', $2) returning id, modalidad_certificacion",
        [nro, modalidad]);
    await db.query(
      `insert into public.coi_ordenes_estaciones (orden_id, nro_oc, estacion, es_principal)
       values ($1, $2, 'PLAZA CONSTITUCION', true)`, [res.rows[0].id, nro]);
    await db.exec('commit;');
    return res;
  } catch (error) {
    await db.exec('rollback;');
    throw error;
  }
}

async function main() {
  const texto = leer(MIGRACION);

  // Forma del archivo: incremental y no destructivo.
  check(/add column if not exists modalidad_certificacion text/.test(texto),
    'la columna tiene que agregarse de forma incremental');
  check(!/\bdrop\s+(table|column|constraint)\b/i.test(texto),
    'la migración no puede contener operaciones destructivas');
  check(!/\b(truncate|delete\s+from)\b/i.test(texto),
    'la migración no puede borrar datos');
  check(/coi_ordenes_modalidad_certificacion_check/.test(texto),
    'el dominio tiene que cerrarse con un check nombrado');

  const db = await nuevaBase();

  // Default: un alta que no informa modalidad queda SIN_DEFINIR, que no proyecta.
  const nueva = await insertar(db, '4530700001');
  check(nueva.rows[0].modalidad_certificacion === 'SIN_DEFINIR',
    `el default tiene que ser SIN_DEFINIR y vino ${nueva.rows[0].modalidad_certificacion}`);

  // Dominio cerrado.
  for (const valor of ['MENSUAL', 'A_DEMANDA', 'SIN_DEFINIR']) {
    const err = await fallo(() => insertar(db, '45307000' + valor.length + valor.charCodeAt(0), valor));
    check(!err, `${valor} tiene que ser un valor aceptado: ${err}`);
  }
  const rechazo = await fallo(() => insertar(db, '4530700099', 'QUINCENAL'));
  check(Boolean(rechazo) && /modalidad_certificacion_check/.test(rechazo),
    `un valor fuera del dominio tiene que rechazarse (vino ${rechazo})`);

  // Compatibilidad histórica: una fila anterior a la migración, simulada
  // poniendo la columna en NULL, se completa sin perder ningún otro dato.
  await db.query("update public.coi_ordenes set modalidad_certificacion = null where nro_oc = '4530700001'");
  await db.query("update public.coi_ordenes set observaciones = 'dato historico' where nro_oc = '4530700001'");
  await db.exec(texto);   // reaplicar la migración
  const post = await db.query(
    "select modalidad_certificacion m, observaciones o from public.coi_ordenes where nro_oc = '4530700001'");
  check(post.rows[0].m === 'SIN_DEFINIR', 'el backfill tiene que completar los históricos con SIN_DEFINIR');
  check(post.rows[0].o === 'dato historico', 'el backfill no puede tocar ningún otro dato');

  // Idempotencia: reaplicar no duplica constraints ni cambia valores.
  const antes = await db.query('select count(*)::int n from public.coi_ordenes');
  await db.exec(texto);
  await db.exec(texto);
  const despues = await db.query('select count(*)::int n from public.coi_ordenes');
  check(antes.rows[0].n === despues.rows[0].n, 'reaplicar la migración no puede cambiar el padrón');
  const constraints = await db.query(
    "select count(*)::int n from pg_constraint where conname = 'coi_ordenes_modalidad_certificacion_check'");
  check(constraints.rows[0].n === 1, 'el check no puede duplicarse al reaplicar');

  // Una modalidad ya elegida por el operador no se pisa al reaplicar.
  await db.query("update public.coi_ordenes set modalidad_certificacion = 'MENSUAL' where nro_oc = '4530700001'");
  await db.exec(texto);
  const conservada = await db.query(
    "select modalidad_certificacion m from public.coi_ordenes where nro_oc = '4530700001'");
  check(conservada.rows[0].m === 'MENSUAL', 'el backfill no puede pisar una modalidad ya definida');

  await db.close();
  console.log(`Modalidad de certificación: ${aprobados} controles aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('Modalidad de certificación FAIL:', error.message || error);
  process.exit(1);
});
