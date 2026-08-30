#!/usr/bin/env node
'use strict';

/*
  H02 · COI-AUD-008 — Reproducibilidad del esquema desde el repositorio.

  Este control aplica TODAS las migraciones versionadas sobre una base PostgreSQL
  completamente vacia, provista unicamente de los prerequisitos que Supabase entrega
  de fabrica (roles anon/authenticated y el esquema auth). No se agrega ningun
  andamiaje de aplicacion.

  A diferencia de check_supabase_runtime.js —que construye a mano un esquema base
  dentro del propio test antes de aplicar las migraciones, y por eso NO puede
  detectar este problema— aca se mide lo unico que importa para poder levantar un
  entorno nuevo: que produce el repositorio por si solo.

  ESTADO ACTUAL (gap confirmado): la segunda migracion falla porque public.coi_ordenes
  no existe, de modo que solo 1 de 27 migraciones llega a aplicarse y solo 1 de las 18
  tablas operativas reales se crea.

  Cuando se incorpore la migracion de linea base (H02 Fase B, a partir de un
  pg_dump --schema-only del esquema real), hay que actualizar las constantes de este
  archivo a 27/27 y 18/18: el test pasa entonces a verificar reproducibilidad completa.
  Mientras tanto, fija el gap como contrato: falla si alguien agrega una dependencia
  no versionada nueva, y falla tambien cuando el gap se cierre sin actualizar el test.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const DIR = 'supabase/migrations';

// Las 18 tablas operativas reales de produccion y staging. Se excluyen a proposito
// coi_documentos_oc_backup_20260723 y coi_documentos_oc_backup_4550000286_20260723:
// son respaldos historicos puntuales, no parte del baseline de una instalacion nueva.
const TABLAS_OPERATIVAS = [
  'coi_alertas', 'coi_auditorias_calidad', 'coi_certificaciones', 'coi_consumos_posicion',
  'coi_contract_meta', 'coi_documentos_oc', 'coi_historial_oc', 'coi_idempotency_requests',
  'coi_links_documentales', 'coi_observaciones_oc', 'coi_operaciones_auditoria', 'coi_ordenes',
  'coi_ordenes_estaciones', 'coi_posiciones_oc', 'coi_servicios_tecnicos_um',
  'coi_timeline_events', 'coi_unidades_mantenimiento', 'profiles'
];

// Estado medido hoy. Actualizar junto con la migracion de linea base.
const ESPERADO = {
  migracionesAplicadas: 1,
  primeraQueFalla: '202608100002_financial_ledger.sql',
  motivoContiene: 'public.coi_ordenes',
  tablasCreadas: ['profiles']
};

// Prerequisitos de plataforma. No forman parte del esquema de la aplicacion.
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

const resultados = [];
const check = (ok, detalle) => {
  resultados.push({ ok, detalle });
  if (!ok) throw new assert.AssertionError({ message: detalle });
};

async function aplicarDesdeCero() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);

  const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let aplicadas = 0;
  let fallo = null;

  for (const archivo of archivos) {
    try {
      await db.exec(fs.readFileSync(path.join(DIR, archivo), 'utf8'));
      aplicadas++;
    } catch (error) {
      fallo = { archivo, motivo: String(error.message || error).split('\n')[0] };
      try { await db.exec('rollback'); } catch (e) { /* la transaccion ya estaba cerrada */ }
      break;
    }
  }

  const { rows } = await db.query(
    "select table_name from information_schema.tables " +
    "where table_schema='public' and table_type='BASE TABLE' order by 1"
  );
  await db.close();

  return { archivos, aplicadas, fallo, creadas: rows.map((r) => r.table_name) };
}

// Inventario estatico: que tablas tienen un CREATE TABLE versionado en algun archivo.
function tablasConCreateVersionado() {
  const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const encontradas = new Set();
  for (const archivo of archivos) {
    const sql = fs.readFileSync(path.join(DIR, archivo), 'utf8');
    for (const tabla of TABLAS_OPERATIVAS) {
      const re = new RegExp(
        'create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?' + tabla + '(?![a-z0-9_])',
        'is'
      );
      if (re.test(sql)) encontradas.add(tabla);
    }
  }
  return [...encontradas].sort();
}

async function main() {
  const r = await aplicarDesdeCero();

  // 1. Cuantas migraciones logran aplicarse realmente sobre una base vacia.
  check(
    r.aplicadas === ESPERADO.migracionesAplicadas,
    `migraciones aplicables desde cero: ${r.aplicadas} de ${r.archivos.length} ` +
    `(esperado ${ESPERADO.migracionesAplicadas}). Si el gap se cerro, actualizar ESPERADO en este archivo.`
  );

  // 2. La migracion exacta donde se corta la cadena, y por que.
  if (ESPERADO.primeraQueFalla) {
    check(Boolean(r.fallo), 'se esperaba un corte en la cadena de migraciones y no hubo ninguno');
    check(
      r.fallo.archivo === ESPERADO.primeraQueFalla,
      `la cadena se corta en ${r.fallo.archivo} (esperado ${ESPERADO.primeraQueFalla})`
    );
    check(
      r.fallo.motivo.includes(ESPERADO.motivoContiene),
      `motivo del corte: "${r.fallo.motivo}" (deberia mencionar ${ESPERADO.motivoContiene})`
    );
  }

  // 3. Que tablas operativas se crean realmente desde cero.
  const creadasOperativas = TABLAS_OPERATIVAS.filter((t) => r.creadas.includes(t)).sort();
  const faltantes = TABLAS_OPERATIVAS.filter((t) => !r.creadas.includes(t)).sort();
  check(
    JSON.stringify(creadasOperativas) === JSON.stringify([...ESPERADO.tablasCreadas].sort()),
    `tablas operativas creadas desde cero: [${creadasOperativas.join(', ')}] ` +
    `(esperado [${ESPERADO.tablasCreadas.join(', ')}])`
  );

  // 4. El inventario estatico de CREATE TABLE no debe degradarse en silencio.
  const conCreate = tablasConCreateVersionado();
  check(
    conCreate.length >= 8,
    `tablas con CREATE TABLE versionado: ${conCreate.length} (no deberia bajar de 8)`
  );

  // 5. Ninguna de las tablas de respaldo historico debe entrar al baseline.
  const respaldos = r.creadas.filter((t) => /_backup_/.test(t));
  check(
    respaldos.length === 0,
    `las tablas de respaldo historico no deben crearse desde migraciones: [${respaldos.join(', ')}]`
  );

  console.log(`Reproducibilidad del esquema: ${r.aplicadas}/${r.archivos.length} migraciones aplicables desde una base vacia.`);
  console.log(`  CREATE TABLE versionado    : ${conCreate.length}/${TABLAS_OPERATIVAS.length} -> ${conCreate.join(', ')}`);
  console.log(`  creadas realmente desde cero: ${creadasOperativas.length}/${TABLAS_OPERATIVAS.length} -> ${creadasOperativas.join(', ') || '(ninguna)'}`);
  if (r.fallo) {
    console.log(`  cadena cortada en           : ${r.fallo.archivo}`);
    console.log(`  motivo                      : ${r.fallo.motivo}`);
  }
  console.log(`  faltantes (${faltantes.length}): ${faltantes.join(', ')}`);
  console.log('');
  console.log('COI-AUD-008 sigue ABIERTO: el repositorio no puede recrear el esquema operativo.');
  console.log('Cerrarlo requiere la migracion de linea base de H02 Fase B (pg_dump --schema-only).');
  console.log(`${resultados.length} controles de reproducibilidad aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('Reproducibilidad del esquema: FALLO');
  console.error(error.message || error);
  process.exit(1);
});
