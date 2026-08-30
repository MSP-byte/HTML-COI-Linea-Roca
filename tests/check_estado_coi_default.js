#!/usr/bin/env node
'use strict';

/*
  H02.1 — Default de public.coi_ordenes.estado_coi

  Produccion tiene el default 'En ejecución'; staging lo tenia como
  'En ejecuciÃ³n', es decir la secuencia UTF-8 de 'ó' (C3 B3) reinterpretada
  como Latin-1. 202608300001_reconcile_estado_coi_default.sql reconcilia ese
  valor sin tocar datos.

  Este control verifica:
    1. tras aplicar todas las migraciones, el default es exactamente el correcto;
    2. la migracion no contiene operaciones de escritura ni destructivas;
    3. reaplicarla deja el mismo default (idempotencia);
    4. control negativo: partiendo de un default mojibake, la migracion lo corrige
       y no modifica las filas ya existentes.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const DIR = 'supabase/migrations';
const MIGRACION = '202608300001_reconcile_estado_coi_default.sql';

const ESPERADO = 'En ejecución';
// El mismo texto mal decodificado: UTF-8 de 'ó' leido como Latin-1.
const MOJIBAKE = 'En ejecuciÃ³n';

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

const leer = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

async function defaultDeEstadoCoi(db) {
  const { rows } = await db.query(
    "select column_default from information_schema.columns " +
    "where table_schema='public' and table_name='coi_ordenes' and column_name='estado_coi'"
  );
  return rows.length ? rows[0].column_default : null;
}

// Extrae el literal de un default de la forma 'texto'::text
const literalDe = (def) => {
  const m = /^'((?:[^']|'')*)'/.exec(String(def || ''));
  return m ? m[1].replace(/''/g, "'") : null;
};

async function baseConMigraciones() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(leer(f));
  }
  return db;
}

async function main() {
  // --- 1. El default resultante es el correcto.
  const db = await baseConMigraciones();
  const def = await defaultDeEstadoCoi(db);
  check(def !== null, 'no existe la columna public.coi_ordenes.estado_coi');
  check(
    literalDe(def) === ESPERADO,
    `default de estado_coi: ${JSON.stringify(literalDe(def))}, se esperaba ${JSON.stringify(ESPERADO)}`
  );
  check(
    !String(def).includes('Ã'),
    `el default conserva mojibake: ${def}`
  );

  // --- 3. Reaplicarla deja el mismo default.
  await db.exec(leer(MIGRACION));
  const def2 = await defaultDeEstadoCoi(db);
  check(def2 === def, `reaplicar la migracion cambio el default: ${def} -> ${def2}`);
  await db.close();

  // --- 2. La migracion no escribe datos ni destruye objetos.
  const sql = leer(MIGRACION);
  const cuerpo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const prohibidas = [
    [/\binsert\s+into\b/i, 'insert'],
    [/\bupdate\s+\w+\s+set\b/i, 'update'],
    [/\bdelete\s+from\b/i, 'delete'],
    [/\btruncate\b/i, 'truncate'],
    [/\bdrop\b/i, 'drop'],
    [/\bset\s+not\s+null\b/i, 'cambio de nullability'],
    [/\bdrop\s+not\s+null\b/i, 'cambio de nullability'],
    [/\balter\s+column\s+\w+\s+type\b/i, 'cambio de tipo']
  ];
  for (const [re, nombre] of prohibidas) {
    check(!re.test(cuerpo), `la migracion contiene una operacion prohibida (${nombre})`);
  }
  check(
    /alter\s+column\s+estado_coi\s+set\s+default/i.test(cuerpo),
    'la migracion deberia fijar el default de estado_coi'
  );

  // --- 4. Control negativo: default mojibake corregido, filas intactas.
  const db2 = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db2.exec(PLATAFORMA);
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.sql')).sort()) {
    if (f === MIGRACION) continue; // se aplica despues, como en staging
    await db2.exec(leer(f));
  }
  // Se simula el estado de staging. El DDL no admite parametros enlazados, de
  // modo que el literal va inline, escapando las comillas simples.
  const literalSql = (v) => "'" + String(v).split("'").join("''") + "'";
  await db2.exec(
    'alter table public.coi_ordenes alter column estado_coi set default ' + literalSql(MOJIBAKE)
  );
  check(
    literalDe(await defaultDeEstadoCoi(db2)) === MOJIBAKE,
    'no se pudo simular el default mojibake de staging'
  );

  // Una OC preexistente que quedo con el estado mal codificado. Se inserta junto
  // con su estacion principal en la misma transaccion, porque coi_ordenes exige
  // exactamente una (COI_ORDER_REQUIRES_ONE_PRINCIPAL_STATION).
  await db2.exec(`
    insert into public.coi_ordenes(id, nro_oc, tipo, estado_coi)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '4530008964', 'Obra', ${literalSql(MOJIBAKE)});
    insert into public.coi_ordenes_estaciones(id, orden_id, nro_oc, estacion, es_principal)
    values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '4530008964', 'Banfield', true);
  `);
  const antes = await db2.query('select nro_oc, estado_coi from public.coi_ordenes');

  await db2.exec(leer(MIGRACION));

  check(
    literalDe(await defaultDeEstadoCoi(db2)) === ESPERADO,
    'la migracion no corrigio el default mojibake'
  );
  const despues = await db2.query('select nro_oc, estado_coi from public.coi_ordenes');
  check(
    JSON.stringify(antes.rows) === JSON.stringify(despues.rows),
    'la migracion modifico filas existentes: solo debe cambiar el default'
  );

  // Una insercion nueva, sin estado_coi explicito, ya toma el valor correcto.
  await db2.exec(`
    insert into public.coi_ordenes(id, nro_oc, tipo)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '4530009999', 'Servicio');
    insert into public.coi_ordenes_estaciones(id, orden_id, nro_oc, estacion, es_principal)
    values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '4530009999', 'Temperley', true);
  `);
  const nueva = await db2.query(
    "select estado_coi from public.coi_ordenes where nro_oc = '4530009999'"
  );
  check(
    nueva.rows[0].estado_coi === ESPERADO,
    `una OC nueva nace con ${JSON.stringify(nueva.rows[0].estado_coi)}, se esperaba ${JSON.stringify(ESPERADO)}`
  );
  await db2.close();

  console.log(`Default de estado_coi: ${JSON.stringify(ESPERADO)} verificado tras todas las migraciones.`);
  console.log('  idempotencia            : reaplicar la migracion deja el mismo default');
  console.log('  operaciones de escritura: ninguna (sin insert/update/delete/truncate/drop)');
  console.log('  nullability y tipo      : sin cambios');
  console.log('  control negativo        : default mojibake corregido y filas existentes intactas');
  console.log(`${aprobados} controles de estado_coi aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('Default de estado_coi: FALLO');
  console.error(error.message || error);
  process.exit(1);
});
