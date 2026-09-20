#!/usr/bin/env node
'use strict';

/*
  H05 — El codigo de Unidad de Mantenimiento es unico tambien en su forma
  canonica.

  El baseline solo trae UNIQUE (codigo_um), literal y sensible a mayusculas,
  mientras el frontend considera la misma UM a «ASC-001», «asc001» y
  «ASC / 001». Es decir que la base era MAS PERMISIVA que la propia interfaz:
  dos clientes concurrentes podian insertar variantes que despues la UI trataba
  como una sola unidad.

  Aplica todas las migraciones sobre PGlite en memoria y verifica:
    1) el indice unico canonico existe, es UNIQUE y usa la normalizacion
       declarada, que ademas coincide con claveUM() del frontend;
    2) el UNIQUE literal del baseline sigue en pie: la migracion suma, no
       reemplaza;
    3) ASC-001 + asc001 -> rechazado;
    4) ASC-001 + «ASC / 001» -> rechazado;
    5) ASC-001 + ASC-002 -> permitido;
    6) el UPDATE hacia una variante canonica ya ocupada -> rechazado;
    7) con duplicados canonicos preexistentes la migracion ABORTA sin tocar
       filas;
    8) reaplicarla es NO-OP;
    9) la migracion no contiene operaciones destructivas ni toca RLS.

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
const MIGRACION = '202608310003_h05_um_codigo_unique_guard.sql';
const INDICE = 'coi_unidades_mantenimiento_codigo_um_canonico_uidx';
const LITERAL = 'coi_unidades_mantenimiento_codigo_um_key';

// Misma normalizacion que claveUM() en index.html y que el indice en SQL.
const claveUM = (v) => String(v == null ? '' : v).replace(/[\s.\/-]+/g, '').toUpperCase();

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

async function nuevaBase(conMigracion) {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of archivos()) {
    if (!conMigracion && f === MIGRACION) continue;
    await db.exec(leer(f));
  }
  return db;
}

const nuevaUM = (db, codigo) => db.query(
  `insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
   values ($1, 'Ascensor', 'PLAZA CONSTITUCION', 'ACTIVA')`, [codigo]);

async function main() {
  const db = await nuevaBase(true);

  // 1) el indice canonico existe y usa la normalizacion declarada.
  const { rows: idx } = await db.query(`
    select i.relname, ix.indisunique, pg_get_indexdef(ix.indexrelid) def, t.relname tabla
      from pg_index ix
      join pg_class i on i.oid = ix.indexrelid
      join pg_class t on t.oid = ix.indrelid
     where i.relname = $1`, [INDICE]);
  check(idx.length === 1, `no existe el indice ${INDICE}`);
  check(idx[0].indisunique === true, `${INDICE} deberia ser UNIQUE`);
  check(idx[0].tabla === 'coi_unidades_mantenimiento', `${INDICE} esta sobre ${idx[0].tabla}`);
  check(/upper\(/i.test(idx[0].def) && /regexp_replace\(/i.test(idx[0].def),
    `el indice deberia usar la forma canonica: ${idx[0].def}`);
  check(/WHERE .*codigo_um IS NOT NULL/i.test(idx[0].def),
    `el indice deberia ser parcial sobre codigo_um no nulo: ${idx[0].def}`);

  // La normalizacion del SQL y la del frontend tienen que coincidir: si una
  // aceptara lo que la otra rechaza, la base volveria a ser mas permisiva que la UI.
  for (const variante of ['ASC-001', 'asc001', 'ASC / 001', 'asc.001', ' ASC-001 ']) {
    const { rows: r } = await db.query(
      `select upper(regexp_replace($1, '[[:space:]./-]+', '', 'g')) canonico`, [variante]);
    check(r[0].canonico === claveUM(variante),
      `SQL y claveUM() difieren para «${variante}»: ${r[0].canonico} vs ${claveUM(variante)}`);
  }

  // 2) el UNIQUE literal del baseline sigue existiendo: esto suma, no reemplaza.
  const { rows: literal } = await db.query(`
    select conname, contype from pg_constraint
     where conname = $1 and conrelid = 'public.coi_unidades_mantenimiento'::regclass`, [LITERAL]);
  check(literal.length === 1 && literal[0].contype === 'u',
    `el UNIQUE literal ${LITERAL} no puede desaparecer`);

  await nuevaUM(db, 'ASC-001');

  // 3) y 4) las variantes canonicas se rechazan.
  for (const variante of ['asc001', 'ASC / 001', 'asc.001', 'A S C - 0 0 1']) {
    const choque = await fallo(() => nuevaUM(db, variante));
    check(Boolean(choque), `«${variante}» deberia chocar con ASC-001`);
    check(/duplicate key|unique constraint|coi_unidades_mantenimiento_codigo_um_canonico_uidx/i.test(choque),
      `el INSERT de «${variante}» fallo por otro motivo: ${choque}`);
  }
  const { rows: unaSola } = await db.query(
    'select count(*)::int n from public.coi_unidades_mantenimiento');
  check(unaSola[0].n === 1, 'el rechazo no debe dejar filas de mas ni de menos');

  // 5) un codigo realmente distinto se permite.
  const otro = await fallo(() => nuevaUM(db, 'ASC-002'));
  check(!otro, `ASC-002 deberia permitirse: ${otro}`);

  // 6) el UPDATE hacia una variante ya ocupada tambien se rechaza.
  const choqueUpdate = await fallo(() => db.query(
    `update public.coi_unidades_mantenimiento set codigo_um = 'asc 001' where codigo_um = 'ASC-002'`));
  check(Boolean(choqueUpdate), 'renombrar una UM a una variante del codigo de otra no fue rechazado');
  check(/duplicate key|unique constraint/i.test(choqueUpdate),
    `el UPDATE fallo por otro motivo: ${choqueUpdate}`);

  // 8) reaplicar la migracion es NO-OP.
  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar la migracion fallo: ${reaplicar}`);
  const { rows: idx2 } = await db.query(
    'select indisunique from pg_index ix join pg_class i on i.oid = ix.indexrelid where i.relname = $1',
    [INDICE]);
  check(idx2.length === 1 && idx2[0].indisunique === true, 'reaplicar la migracion altero el indice');

  // RLS intacta y sin policy DELETE: esta migracion no toca autorizacion.
  const { rows: policies } = await db.query(`
    select cmd from pg_policies
     where schemaname = 'public' and tablename = 'coi_unidades_mantenimiento'`);
  check(policies.length > 0, 'las policies de UM no pueden desaparecer');
  check(!policies.some((p) => String(p.cmd).toUpperCase() === 'DELETE'),
    'esta migracion no puede agregar una policy DELETE');
  const { rows: rls } = await db.query(
    `select relrowsecurity from pg_class where oid = 'public.coi_unidades_mantenimiento'::regclass`);
  check(rls[0].relrowsecurity === true, 'RLS quedo deshabilitada en coi_unidades_mantenimiento');

  await db.close();

  // 7) con duplicados canonicos preexistentes la migracion ABORTA sin tocar filas.
  const sucia = await nuevaBase(false);
  await nuevaUM(sucia, 'ASC-001');
  // Pasa el UNIQUE literal pero es el mismo codigo canonico: exactamente lo que
  // el indice viene a cerrar.
  await nuevaUM(sucia, 'asc001');
  const { rows: antes } = await sucia.query(
    'select count(*)::int n from public.coi_unidades_mantenimiento');
  check(antes[0].n === 2, 'el escenario sucio deberia tener 2 UM equivalentes');

  const aborto = await fallo(() => sucia.exec(leer(MIGRACION)));
  check(Boolean(aborto), 'con duplicados canonicos preexistentes la migracion deberia abortar');
  check(/COI_UM_CODIGO_DUPLICADO_CANONICO/.test(aborto),
    `el aborto deberia ser explicito y es: ${aborto}`);

  const { rows: despues } = await sucia.query(
    'select count(*)::int n, string_agg(codigo_um, in_orden) codigos from ' +
    "(select codigo_um, ',' in_orden from public.coi_unidades_mantenimiento order by codigo_um) t");
  check(despues[0].n === 2, 'la migracion abortada no puede haber borrado ni modificado filas');
  const { rows: sinIndice } = await sucia.query(
    'select count(*)::int n from pg_class where relname = $1', [INDICE]);
  check(sinIndice[0].n === 0, 'con duplicados no puede haberse creado el indice');
  await sucia.close();

  // 9) la migracion no contiene operaciones destructivas.
  const cuerpo = leer(MIGRACION).replace(/--[^\n]*/g, '');
  for (const patron of [
    /\btruncate\b/i,
    /\bdrop\s+table\b/i,
    /\bdrop\s+index\b/i,
    /\bdrop\s+constraint\b/i,
    /\bdelete\s+from\b/i,
    /\bupdate\s+public\./i,
    /\binsert\s+into\b/i,
    /\bcreate\s+policy\b/i,
    /\bgrant\b/i,
    /\bdisable\s+row\s+level\s+security\b/i
  ]) check(!patron.test(cuerpo), `la migracion no deberia contener: ${patron}`);

  console.log('H05 UM: el codigo de Unidad de Mantenimiento es unico tambien en forma canonica.');
  console.log(`  UNIQUE INDEX ${INDICE}`);
  console.log('  Normalizacion SQL == claveUM() del front : verificada contra la base');
  console.log('  UNIQUE literal del baseline              : conservado');
  console.log('  ASC-001 / asc001 / «ASC / 001»           : la misma UM, segunda rechazada');
  console.log('  ASC-002                                  : permitido');
  console.log('  UPDATE hacia variante ocupada            : rechazado');
  console.log('  Duplicados canonicos preexistentes       : aborta sin tocar filas');
  console.log('  Idempotencia                             : reaplicar es NO-OP');
  console.log(`${aprobados} controles H05 de codigo canonico aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('H05 UM codigo unique guard FAIL:', error.message || error);
  process.exit(1);
});
