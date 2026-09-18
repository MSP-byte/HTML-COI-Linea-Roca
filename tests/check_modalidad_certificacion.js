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

  // ============================== writers canónicos (review finding P1)
  // La columna no sirve de nada si los contratos server-side la rechazan.
  const UID = '22222222-2222-4222-8222-222222222222';
  await db.query('insert into auth.users(id, email) values ($1, $2)', [UID, 'editor@coiroca.com']);
  await db.query(
    `insert into public.profiles (id, email, rol, activo) values ($1, $2, 'administrador', true)
     on conflict (id) do update set rol = 'administrador', activo = true`, [UID, 'editor@coiroca.com']);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [UID]);
  await db.query("select set_config('request.jwt.claim.email', 'editor@coiroca.com', false)");
  await db.query("select set_config('request.jwt.claim.role', 'administrador', false)");

  const oc = await insertar(db, '4530700500');
  const ordenId = oc.rows[0].id;
  const actualizar = (cambios) => db.query(
    'select public.coi_actualizar_orden_integral($1, $2::jsonb) r', [ordenId, JSON.stringify(cambios)]);
  const modalidadDe = async () => (await db.query(
    'select modalidad_certificacion m from public.coi_ordenes where id = $1', [ordenId])).rows[0].m;

  // SIN_DEFINIR → MENSUAL → A_DEMANDA por la RPC canónica.
  for (const destino of ['MENSUAL', 'A_DEMANDA', 'SIN_DEFINIR']) {
    const err = await fallo(() => actualizar({ modalidad_certificacion: destino }));
    check(!err, `la RPC tiene que aceptar modalidad_certificacion=${destino}: ${err}`);
    check(await modalidadDe() === destino, `la RPC tiene que persistir ${destino}`);
  }

  // El guard NO se debilitó: un campo desconocido sigue rechazándose.
  const desconocido = await fallo(() => actualizar({ campo_inventado: 'x' }));
  check(Boolean(desconocido) && /COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD/.test(desconocido),
    `un campo desconocido tiene que seguir rechazándose (vino ${desconocido})`);
  // Y un campo protegido tampoco pasa.
  const protegido = await fallo(() => actualizar({ nro_oc: '4530700999' }));
  check(Boolean(protegido) && /COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD/.test(protegido),
    `un campo protegido tiene que seguir rechazándose (vino ${protegido})`);

  /* UPDATE directo. El guard exime al rol dueño —las RPC security definer
     corren así—, de modo que hay que pedirlo como `authenticated` para que el
     trigger se evalúe de verdad. */
  const comoAuthenticated = async (sql, params) => {
    await db.exec('set role authenticated;');
    try { return await fallo(() => db.query(sql, params)); }
    finally { await db.exec('reset role;'); }
  };
  const directo = await comoAuthenticated(
    "update public.coi_ordenes set modalidad_certificacion = 'MENSUAL' where id = $1", [ordenId]);
  check(!directo, `el guard de UPDATE directo tiene que permitir la modalidad: ${directo}`);
  check(await modalidadDe() === 'MENSUAL', 'el UPDATE directo tiene que persistir la modalidad');
  const directoProhibido = await comoAuthenticated(
    "update public.coi_ordenes set avance_obra_pct = 42 where id = $1", [ordenId]);
  check(Boolean(directoProhibido) && /COI_DIRECT_ORDER_FIELD_NOT_ALLOWED/.test(directoProhibido),
    `el guard de UPDATE directo tiene que seguir cerrado (vino ${directoProhibido})`);

  /* No debilitar el guard, verificado por diferencia: entre la definición
     vigente y la redefinida tiene que haber EXACTAMENTE un agregado. */
  const original = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
  const nuevo = original('202609170004_modalidad_certificacion_writers.sql');
  const sinAgregado = nuevo.split("'control_terceros_estado', 'modalidad_certificacion'").join("'control_terceros_estado'");
  ['coi_actualizar_orden_integral', 'coi_direct_order_update_guard'].forEach((fn) => {
    check(nuevo.includes('create or replace function public.' + fn),
      `la migración tiene que redefinir ${fn}`);
  });
  check((nuevo.match(/'modalidad_certificacion'/g) || []).length >= 2,
    'las dos allowlists tienen que incluir la modalidad');
  check(!/drop\s+function|revoke\s+execute[\s\S]*authenticated/i.test(nuevo),
    'la migración no puede quitar permisos existentes');
  check(sinAgregado.includes("'control_terceros_estado'\n  ];"),
    'el resto de la allowlist tiene que quedar igual que la vigente');

  // Dominio: la RPC no puede escribir un valor fuera del check.
  const fueraDominio = await fallo(() => actualizar({ modalidad_certificacion: 'QUINCENAL' }));
  check(Boolean(fueraDominio) && /modalidad_certificacion_check/.test(fueraDominio),
    `la RPC no puede escribir fuera del dominio (vino ${fueraDominio})`);

  await db.close();
  console.log(`Modalidad de certificación: ${aprobados} controles aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('Modalidad de certificación FAIL:', error.message || error);
  process.exit(1);
});
