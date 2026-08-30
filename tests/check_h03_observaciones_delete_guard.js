#!/usr/bin/env node
'use strict';

/*
  H03 — Las observaciones no se destruyen al eliminar una OC.

  Hasta 202608300002_h03_observaciones_delete_guard.sql convivian dos huecos:

    - coi_observaciones_oc.orden_id era la unica dependencia de orden con
      «on delete cascade» (el resto usa restrict desde 202608100002/202608100005);
    - public.coi_eliminar_orden_integral no incluia esa tabla en su lista de
      dependencias comprobadas.

  Con ambos a la vez, borrar una OC cuya unica dependencia fueran observaciones
  las eliminaba en silencio, justo despues de que la UI declarase que las
  observaciones se conservan por trazabilidad.

  Este control aplica TODAS las migraciones sobre una base vacia y verifica las
  dos capas por separado, ademas del comportamiento real:

    1) la FK esta en RESTRICT;
    2) la RPC declara coi_observaciones_oc entre sus dependencias;
    3) un DELETE directo sobre la OC padre falla;
    4) la RPC rechaza el borrado con COI_ORDER_HAS_DEPENDENCIES e informa el
       conteo de observaciones;
    5) sin observaciones esa misma OC si se puede eliminar (control negativo:
       la guarda no bloquea el caso legitimo);
    6) reaplicar la migracion es un NO-OP.

  No toca produccion ni staging: todo corre en PGlite, en memoria.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const DIR = 'supabase/migrations';
const MIGRACION = '202608300002_h03_observaciones_delete_guard.sql';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OC_CON_OBS = '4530090001';
const OC_SIN_OBS = '4530090002';

// Mismos prerequisitos de plataforma que usa check_schema_reproducibility.js:
// Supabase los entrega de fabrica y ninguna migracion los crea.
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

async function baseConMigraciones() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of archivos()) await db.exec(leer(f));
  return db;
}

// Sesion simulada: auth.uid() lee el claim y coi_current_role() el perfil.
async function sembrar(db) {
  // La estacion principal es obligatoria por constraint trigger diferido, de
  // modo que orden y estacion deben entrar en la misma transaccion.
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@coiroca.com');
    insert into public.profiles (id, email, nombre, rol, activo)
      values ('${ADMIN}', 'admin@coiroca.com', 'Admin', 'administrador', true);
    select set_config('request.jwt.claim.sub', '${ADMIN}', false);
    select set_config('request.jwt.claim.email', 'admin@coiroca.com', false);
    begin;
    insert into public.coi_ordenes (nro_oc, tipo, estado_coi)
      values ('${OC_CON_OBS}', 'Obra', 'En ejecución'),
             ('${OC_SIN_OBS}', 'Obra', 'En ejecución');
    insert into public.coi_ordenes_estaciones (orden_id, nro_oc, estacion, es_principal)
      select o.id, o.nro_oc, 'CONSTITUCION', true
        from public.coi_ordenes o
       where o.nro_oc in ('${OC_CON_OBS}', '${OC_SIN_OBS}');
    commit;
  `);
  const { rows } = await db.query(
    'select id, nro_oc from public.coi_ordenes where nro_oc in ($1, $2)',
    [OC_CON_OBS, OC_SIN_OBS]
  );
  const porNro = {};
  rows.forEach((r) => { porNro[r.nro_oc] = r.id; });
  await db.query(
    `insert into public.coi_observaciones_oc (orden_id, nro_oc, observacion, creado_por)
     values ($1, $2, 'Observacion que debe sobrevivir al intento de borrado', $3)`,
    [porNro[OC_CON_OBS], OC_CON_OBS, ADMIN]
  );
  return porNro;
}

const fallo = async (fn) => {
  try { await fn(); return null; } catch (error) { return String(error.message || error); }
};

async function main() {
  const db = await baseConMigraciones();

  // --- 1) accion referencial de la FK -------------------------------------
  const { rows: fk } = await db.query(`
    select confdeltype, pg_get_constraintdef(oid) def
      from pg_constraint
     where conname = 'coi_observaciones_oc_orden_id_fkey'
       and conrelid = 'public.coi_observaciones_oc'::regclass`);
  check(fk.length === 1, 'no existe coi_observaciones_oc_orden_id_fkey');
  check(fk[0].confdeltype === 'r', `la FK deberia ser RESTRICT y es «${fk[0].confdeltype}»`);
  check(/on delete restrict/i.test(fk[0].def), `definicion inesperada: ${fk[0].def}`);

  // La tabla no se recreo: sus otras constraints siguen en pie.
  const { rows: otras } = await db.query(`
    select conname from pg_constraint
     where conrelid = 'public.coi_observaciones_oc'::regclass and contype in ('p', 'f')
     order by conname`);
  const nombres = otras.map((r) => r.conname);
  for (const c of [
    'coi_observaciones_oc_pkey',
    'coi_observaciones_oc_creado_por_fkey',
    'coi_observaciones_oc_resuelto_por_fkey'
  ]) check(nombres.includes(c), `falta ${c}: la tabla fue recreada`);

  // --- 2) la RPC declara la dependencia -----------------------------------
  const { rows: rpc } = await db.query(
    "select pg_get_functiondef(p.oid) def, p.prosecdef, p.proconfig::text cfg " +
    "from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
    "where n.nspname = 'public' and p.proname = 'coi_eliminar_orden_integral'"
  );
  check(rpc.length === 1, 'coi_eliminar_orden_integral no existe o esta duplicada');
  const def = rpc[0].def;
  check(/'coi_observaciones_oc'/.test(def), 'la RPC no comprueba coi_observaciones_oc');
  check(rpc[0].prosecdef === true, 'la RPC perdio SECURITY DEFINER');
  check(/search_path=public,pg_temp/.test(String(rpc[0].cfg).replace(/\s/g, '')), 'la RPC perdio su search_path');
  check(/coi_assert_role\(array\['administrador'\]\)/.test(def), 'la RPC perdio el control de rol');
  check(/ELIMINAR_ORDEN_INTEGRAL/.test(def), 'la RPC perdio el asiento de auditoria');
  // Las dependencias historicas siguen declaradas.
  for (const t of [
    'coi_posiciones_oc', 'coi_consumos_posicion', 'coi_certificaciones', 'coi_documentos_oc',
    'coi_historial_oc', 'coi_links_documentales', 'coi_auditorias_calidad', 'coi_timeline_events',
    'coi_documentos_versiones', 'coi_servicios_tecnicos_um'
  ]) check(new RegExp("'" + t + "'").test(def), `la RPC dejo de comprobar ${t}`);

  const { rows: grants } = await db.query(
    "select has_function_privilege('authenticated', p.oid, 'execute') ok " +
    "from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
    "where n.nspname='public' and p.proname='coi_eliminar_orden_integral'"
  );
  check(grants[0].ok === true, 'authenticated perdio el execute sobre la RPC');

  // --- 3) y 4) comportamiento real ----------------------------------------
  const ids = await sembrar(db);

  const conteo = await db.query(
    'select public.coi_count_order_dependencies($1, $2, $3) n',
    ['coi_observaciones_oc', ids[OC_CON_OBS], OC_CON_OBS]
  );
  check(Number(conteo.rows[0].n) === 1, `el contador de dependencias devolvio ${conteo.rows[0].n}`);

  const errorDirecto = await fallo(() =>
    db.query('delete from public.coi_ordenes where id = $1', [ids[OC_CON_OBS]]));
  check(Boolean(errorDirecto), 'el DELETE directo sobre la OC padre no fue rechazado');
  check(
    /violates foreign key constraint|coi_observaciones_oc_orden_id_fkey/i.test(errorDirecto),
    `el DELETE directo fallo por otro motivo: ${errorDirecto}`
  );

  const errorRpc = await fallo(() =>
    db.query('select public.coi_eliminar_orden_integral($1)', [ids[OC_CON_OBS]]));
  check(Boolean(errorRpc), 'la RPC no rechazo el borrado de una OC con observaciones');
  check(/COI_ORDER_HAS_DEPENDENCIES/.test(errorRpc), `la RPC fallo por otro motivo: ${errorRpc}`);

  const { rows: sobreviven } = await db.query(
    'select count(*)::int n from public.coi_observaciones_oc where orden_id = $1',
    [ids[OC_CON_OBS]]
  );
  check(sobreviven[0].n === 1, 'la observacion no sobrevivio al intento de borrado');
  const { rows: ocViva } = await db.query(
    'select count(*)::int n from public.coi_ordenes where id = $1', [ids[OC_CON_OBS]]);
  check(ocViva[0].n === 1, 'la OC se elimino pese a tener dependencias');

  // --- 5) control negativo: sin observaciones el borrado sigue funcionando --
  const errorLegitimo = await fallo(() =>
    db.query('select public.coi_eliminar_orden_integral($1)', [ids[OC_SIN_OBS]]));
  check(!errorLegitimo, `la guarda bloqueo un borrado legitimo: ${errorLegitimo}`);
  const { rows: borrada } = await db.query(
    'select count(*)::int n from public.coi_ordenes where id = $1', [ids[OC_SIN_OBS]]);
  check(borrada[0].n === 0, 'la OC sin dependencias no se elimino');
  const { rows: auditoria } = await db.query(
    "select count(*)::int n from public.coi_operaciones_auditoria " +
    "where accion = 'ELIMINAR_ORDEN_INTEGRAL' and registro_id = $1", [ids[OC_SIN_OBS]]);
  check(auditoria[0].n === 1, 'el borrado legitimo no dejo asiento de auditoria');

  // --- 6) idempotencia ----------------------------------------------------
  const errorReaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!errorReaplicar, `reaplicar la migracion fallo: ${errorReaplicar}`);
  const { rows: fk2 } = await db.query(`
    select confdeltype from pg_constraint
     where conname = 'coi_observaciones_oc_orden_id_fkey'
       and conrelid = 'public.coi_observaciones_oc'::regclass`);
  check(fk2.length === 1 && fk2[0].confdeltype === 'r', 'reaplicar la migracion altero la FK');
  const { rows: intactas } = await db.query(
    'select count(*)::int n from public.coi_observaciones_oc');
  check(intactas[0].n === 1, 'reaplicar la migracion toco datos');

  // --- la migracion no contiene operaciones destructivas -------------------
  // El unico «delete from» del archivo es el que ya vivia dentro del cuerpo de
  // la RPC (estaciones de la OC que se elimina): se excluye ese cuerpo y se
  // audita el resto del script.
  const cuerpo = leer(MIGRACION);
  const inicioFn = cuerpo.indexOf('create or replace function public.coi_eliminar_orden_integral');
  const finFn = cuerpo.indexOf('$$;', inicioFn);
  check(inicioFn > 0 && finFn > inicioFn, 'la migracion ya no define coi_eliminar_orden_integral');
  const fueraDeLaFuncion = cuerpo.slice(0, inicioFn) + cuerpo.slice(finFn + 3);
  for (const patron of [/\btruncate\b/i, /\bdrop\s+table\b/i, /\bdelete\s+from\b/i, /\bupdate\s+public\./i]) {
    check(!patron.test(fueraDeLaFuncion), `la migracion contiene una operacion destructiva: ${patron}`);
  }
  const dropsConstraint = (fueraDeLaFuncion.match(/drop\s+constraint\s+([a-z0-9_]+)/gi) || []);
  check(
    dropsConstraint.every((d) => /coi_observaciones_oc_orden_id_fkey/i.test(d)),
    `la migracion elimina constraints ajenas: ${dropsConstraint.join(', ')}`
  );

  await db.close();

  console.log('Borrado de OC con observaciones: la cascada quedo cerrada en las dos capas.');
  console.log('  FK coi_observaciones_oc.orden_id : ON DELETE RESTRICT (tabla no recreada)');
  console.log('  RPC coi_eliminar_orden_integral  : coi_observaciones_oc declarada, firma y auditoria intactas');
  console.log('  DELETE directo del padre         : rechazado por la FK');
  console.log('  Borrado integral con observacion : COI_ORDER_HAS_DEPENDENCIES, 0 filas perdidas');
  console.log('  Control negativo sin dependencias: la OC se elimina y queda auditada');
  console.log('  Idempotencia                     : reaplicar la migracion es NO-OP');
  console.log(`${aprobados} controles de borrado seguro aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('Borrado de OC con observaciones: FALLO');
  console.error(error.message || error);
  process.exit(1);
});
