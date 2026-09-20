#!/usr/bin/env node
'use strict';

/*
  H04 / H05 — La version de una fila la pone PostgreSQL, no el navegador.

  fecha_actualizacion cumple dos funciones en coi_unidades_mantenimiento y en
  coi_servicios_tecnicos_um: es la marca de auditoria y es el token de
  concurrencia optimista (CAS) que viaja en el WHERE del UPDATE. Mientras la
  version NUEVA la escribia el cliente, las dos funciones quedaban colgadas del
  reloj del navegador: con el reloj congelado dos ediciones consecutivas
  escribian la MISMA version, con el reloj atrasado la fila retrocedia en el
  tiempo y un CAS viejo podia volver a matchear.

  Este control aplica todas las migraciones sobre PGlite y verifica:

    A) el trigger BEFORE UPDATE existe en UM y en ST;
    B) un UPDATE avanza la version, sin que el cliente la mande;
    C) un segundo UPDATE vuelve a avanzarla (estrictamente creciente);
    D) con la version anterior EN EL FUTURO —reloj del servidor atrasado o fila
       escrita por un cliente con el reloj adelantado— la version nueva sigue
       siendo mayor que la anterior, no menor;
    E) con fecha_actualizacion en NULL el trigger no falla y sella una version;
    F) la sincronizacion de nro_oc que hace coi_renumerar_oc —una escritura
       server-side, sin cliente— tambien avanza la version del ST;
    G) el CAS con el token viejo deja de matchear despues de un UPDATE;
    H) reaplicar la migracion es NO-OP;
    I) el frontend ya no manda una fecha_actualizacion autoritativa.

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
const MIGRACION = '202609020001_h04_h05_server_version_guard.sql';

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

async function nuevaBase() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of archivos()) await db.exec(leer(f));
  return db;
}

const nuevaOC = async (db, nro) => {
  await db.exec('begin;');
  try {
    const { rows } = await db.query(
      `insert into public.coi_ordenes (nro_oc, tipo, estado_coi)
       values ($1, 'Servicio', 'En ejecución') returning id`, [nro]);
    await db.query(
      `insert into public.coi_ordenes_estaciones (orden_id, nro_oc, estacion, es_principal)
       values ($1, $2, 'PLAZA CONSTITUCION', true)`, [rows[0].id, nro]);
    await db.exec('commit;');
    return rows[0].id;
  } catch (error) {
    await db.exec('rollback;');
    throw error;
  }
};

// El instante se lee como texto con microsegundos para poder compararlo sin
// perder resolucion: Date de JavaScript solo llega al milisegundo y el paso
// minimo del guard es 1 microsegundo.
const versionUM = async (db, id) => {
  const { rows } = await db.query(
    `select to_char(fecha_actualizacion at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') v
       from public.coi_unidades_mantenimiento where id = $1`, [id]);
  return rows[0].v;
};
const versionST = async (db, id) => {
  const { rows } = await db.query(
    `select to_char(fecha_actualizacion at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') v
       from public.coi_servicios_tecnicos_um where id = $1`, [id]);
  return rows[0].v;
};

async function main() {
  const db = await nuevaBase();

  // ---------------------------------------------------------------- A) triggers
  const { rows: triggers } = await db.query(`
    select t.tgname, c.relname, t.tgtype
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal
       and t.tgname in ('coi_um_version_servidor', 'coi_st_version_servidor')
     order by t.tgname`);
  check(triggers.length === 2, `se esperaban 2 triggers de versionado y hay ${triggers.length}`);
  const porTabla = new Map(triggers.map((t) => [t.relname, t]));
  check(porTabla.get('coi_unidades_mantenimiento'), 'falta el trigger de version en UM');
  check(porTabla.get('coi_servicios_tecnicos_um'), 'falta el trigger de version en ST');
  for (const t of triggers) {
    // tgtype: bit 1 = ROW, bit 2 = BEFORE, bit 16 = UPDATE.
    check((t.tgtype & 1) === 1, `${t.tgname} tiene que ser FOR EACH ROW`);
    check((t.tgtype & 2) === 2, `${t.tgname} tiene que ser BEFORE`);
    check((t.tgtype & 16) === 16, `${t.tgname} tiene que dispararse en UPDATE`);
    check((t.tgtype & 4) === 0, `${t.tgname} no debe dispararse en INSERT: el alta conserva su default`);
    check((t.tgtype & 8) === 0, `${t.tgname} no debe dispararse en DELETE`);
    // Sin lista de columnas: cualquier UPDATE avanza la version, incluido el de
    // coi_renumerar_oc sobre nro_oc.
    const { rows: cols } = await db.query(
      'select coalesce(array_length(tgattr, 1), 0)::int n from pg_trigger where tgname = $1', [t.tgname]);
    check(cols[0].n === 0, `${t.tgname} no puede limitarse a un subconjunto de columnas`);
  }

  // La formula es la del servidor, no la del cliente.
  const { rows: defs } = await db.query(
    "select pg_get_functiondef('public.coi_version_servidor()'::regprocedure) def");
  const fn = defs[0].def.replace(/--[^\n]*/g, '');
  check(/clock_timestamp\(\)/.test(fn), 'la version tiene que salir de clock_timestamp()');
  check(/greatest/i.test(fn), 'la version tiene que garantizarse estrictamente creciente con greatest()');
  check(/interval '1 microsecond'/.test(fn), 'el paso minimo tiene que ser 1 microsegundo');
  check(!/\bnow\(\)/.test(fn) && !/transaction_timestamp/.test(fn),
    'now()/transaction_timestamp() son constantes en la transaccion: no sirven como version');

  // ---------------------------------------------------------------- B) UM avanza
  const { rows: umRows } = await db.query(
    `insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
     values ('UM-VER-01', 'Ascensor', 'PLAZA CONSTITUCION', 'ACTIVA') returning id`);
  const umId = umRows[0].id;
  const umV0 = await versionUM(db, umId);
  check(Boolean(umV0), 'el alta deja una version inicial');

  // El UPDATE NO menciona fecha_actualizacion: es exactamente lo que manda el
  // frontend despues del fix.
  await db.query(
    "update public.coi_unidades_mantenimiento set observaciones = 'primera' where id = $1", [umId]);
  const umV1 = await versionUM(db, umId);
  check(umV1 > umV0, `la version de UM tiene que avanzar sin que el cliente la mande: ${umV0} -> ${umV1}`);

  // ---------------------------------------------------------------- C) segundo update
  await db.query(
    "update public.coi_unidades_mantenimiento set observaciones = 'segunda' where id = $1", [umId]);
  const umV2 = await versionUM(db, umId);
  check(umV2 > umV1, `el segundo UPDATE tiene que volver a avanzar la version: ${umV1} -> ${umV2}`);

  // ---------------------------------------------------------------- D) version anterior en el futuro
  // Reloj del servidor atrasado, o fila escrita antes del guard por un cliente
  // con el reloj adelantado: clock_timestamp() seria MENOR que la version
  // vigente. El greatest() tiene que ganar igual.
  await db.query(
    `update public.coi_unidades_mantenimiento
        set fecha_actualizacion = clock_timestamp() + interval '10 years' where id = $1`, [umId]);
  const umFuturo = await versionUM(db, umId);
  await db.query(
    "update public.coi_unidades_mantenimiento set observaciones = 'tercera' where id = $1", [umId]);
  const umTrasFuturo = await versionUM(db, umId);
  check(umTrasFuturo > umFuturo,
    `con la version anterior en el futuro la nueva sigue siendo mayor: ${umFuturo} -> ${umTrasFuturo}`);

  // ---------------------------------------------------------------- E) NULL
  await db.query(
    'update public.coi_unidades_mantenimiento set fecha_actualizacion = null where id = $1', [umId]);
  const { rows: nula } = await db.query(
    'select fecha_actualizacion from public.coi_unidades_mantenimiento where id = $1', [umId]);
  check(nula[0].fecha_actualizacion !== null,
    'con OLD en NULL el trigger igual tiene que sellar una version, no dejarla nula');
  const errorNulo = await fallo(() => db.query(
    "update public.coi_unidades_mantenimiento set observaciones = 'cuarta' where id = $1", [umId]));
  check(!errorNulo, `una version anterior NULL no puede romper el trigger: ${errorNulo}`);
  const umTrasNulo = await versionUM(db, umId);
  check(Boolean(umTrasNulo), 'tras el NULL la fila tiene que quedar versionada');

  // ---------------------------------------------------------------- F) ST y renumeracion
  const ocId = await nuevaOC(db, '4530414141');
  const { rows: stRows } = await db.query(
    `insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, nro_oc, fecha, descripcion, estado)
     values ($1, 'ST-VER-01', '4530414141', current_date, 'Servicio', 'Pendiente') returning id`, [umId]);
  const stId = stRows[0].id;
  const stV0 = await versionST(db, stId);

  await db.query(
    "update public.coi_servicios_tecnicos_um set tecnico = 'Operario' where id = $1", [stId]);
  const stV1 = await versionST(db, stId);
  check(stV1 > stV0, `la version del ST tiene que avanzar: ${stV0} -> ${stV1}`);

  // Renumeracion: se reproduce el orden de coi_renumerar_oc —orden maestra y
  // despues las dependientes—. Es una escritura server-side, sin cliente que
  // pueda versionar nada.
  await db.query('update public.coi_ordenes set nro_oc = $1 where id = $2', ['4530424242', ocId]);
  await db.query(
    'update public.coi_servicios_tecnicos_um set nro_oc = $1 where nro_oc = $2',
    ['4530424242', '4530414141']);
  const stV2 = await versionST(db, stId);
  check(stV2 > stV1,
    `la renumeracion server-side tiene que avanzar la version del ST: ${stV1} -> ${stV2}`);
  const { rows: stFila } = await db.query(
    'select orden_id, nro_oc from public.coi_servicios_tecnicos_um where id = $1', [stId]);
  check(stFila[0].orden_id === ocId, 'la renumeracion no puede mover la identidad tecnica');
  check(stFila[0].nro_oc === '4530424242', 'el ST tiene que quedar con el numero nuevo');

  // ---------------------------------------------------------------- G) CAS
  // El token viejo deja de matchear: es exactamente lo que hace el WHERE del
  // frontend con la fecha RENDERIZADA.
  const { rows: casViejo } = await db.query(
    `update public.coi_servicios_tecnicos_um set tecnico = 'Otro'
      where id = $1 and fecha_actualizacion = $2::timestamptz returning 1`,
    [stId, stV1 + '+00']);
  check(casViejo.length === 0, 'un CAS con la version anterior no puede matchear');
  const { rows: casVigente } = await db.query(
    `update public.coi_servicios_tecnicos_um set tecnico = 'Otro'
      where id = $1 and fecha_actualizacion = $2::timestamptz returning 1`,
    [stId, stV2 + '+00']);
  check(casVigente.length === 1, 'un CAS con la version vigente tiene que aplicar');
  const stV3 = await versionST(db, stId);
  check(stV3 > stV2, 'el UPDATE que gano el CAS tambien avanza la version');

  // ---------------------------------------------------------------- H) idempotencia
  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar la migracion fallo: ${reaplicar}`);
  const { rows: dobles } = await db.query(`
    select count(*)::int n from pg_trigger
     where not tgisinternal and tgname in ('coi_um_version_servidor', 'coi_st_version_servidor')`);
  check(dobles[0].n === 2, `reaplicar duplico o elimino triggers: hay ${dobles[0].n}`);
  await db.query(
    "update public.coi_unidades_mantenimiento set observaciones = 'quinta' where id = $1", [umId]);
  const umFinal = await versionUM(db, umId);
  check(umFinal > umTrasNulo, 'tras reaplicar la migracion la version sigue avanzando');

  // La migracion no toca datos ni autorizacion.
  const cuerpo = leer(MIGRACION).replace(/--[^\n]*/g, '');
  for (const patron of [
    /\btruncate\b/i, /\bdrop\s+table\b/i, /\bdrop\s+column\b/i, /\bdelete\s+from\b/i,
    /\bupdate\s+public\./i, /\bcreate\s+policy\b/i, /\bdrop\s+policy\b/i, /\bgrant\b/i
  ]) check(!patron.test(cuerpo), `la migracion no deberia contener: ${patron}`);

  await db.close();

  // ---------------------------------------------------------------- I) frontend
  // La capa ya no manda una version autoritativa: la nueva la pone PostgreSQL.
  const html = fs.readFileSync('index.html', 'utf8');
  const inicio = html.indexOf("const TABLA_UM = 'coi_unidades_mantenimiento';");
  check(inicio > 0, 'no se encontro la capa H05 en index.html');
  const capa = html.slice(inicio);
  check(!/fecha_actualizacion:\s*new Date\(\)\.toISOString\(\)/.test(capa),
    'la capa no puede escribir la version nueva con el reloj del navegador');
  check(capa.indexOf('delete cuerpo.fecha_actualizacion;') >= 0,
    'el cuerpo del UPDATE tiene que quedar sin fecha_actualizacion');
  // Y el token de CAS sigue viajando en el WHERE.
  check(capa.indexOf("consulta.eq('fecha_actualizacion', version)") >= 0,
    'la version renderizada tiene que seguir siendo el token de CAS del WHERE');

  console.log('H04/H05: la version de la fila la pone PostgreSQL, no el navegador.');
  console.log('  Triggers BEFORE UPDATE                   : UM y ST, por fila, sin lista de columnas');
  console.log('  Formula                                  : greatest(clock_timestamp(), old + 1 us)');
  console.log('  UPDATE / segundo UPDATE                  : version estrictamente creciente');
  console.log('  Version anterior en el futuro            : la nueva sigue siendo mayor');
  console.log('  fecha_actualizacion NULL                 : sella version, no falla');
  console.log('  Renumeracion server-side de ST           : avanza la version');
  console.log('  CAS con token viejo                      : no matchea');
  console.log('  Frontend                                 : no manda version nueva; CAS en el WHERE');
  console.log('  Idempotencia                             : reaplicar es NO-OP');
  console.log(`${aprobados} controles del guard de version aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('H04/H05 server version guard FAIL:', error.message || error);
  process.exit(1);
});
