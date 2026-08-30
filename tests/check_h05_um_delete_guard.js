#!/usr/bin/env node
'use strict';

/*
  H05 — Una Unidad de Mantenimiento no puede destruir por cascada su
  historial de Servicios Tecnicos.

  Este control aplica todas las migraciones sobre PGlite en memoria y valida:
    1) la FK unidad_id queda ON DELETE RESTRICT;
    2) la tabla no se recrea ni pierde sus constraints principales;
    3) un DELETE directo de una UM con ST asociado falla;
    4) UM y ST sobreviven al intento;
    5) sin ST dependiente, el borrado del padre vuelve a ser posible;
    6) reaplicar la migracion es idempotente;
    7) la migracion no contiene operaciones destructivas sobre datos.

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
const MIGRACION = '202608300003_h05_um_delete_guard.sql';

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

  const { rows: fk } = await db.query(`
    select confdeltype, pg_get_constraintdef(oid) def
      from pg_constraint
     where conname = 'coi_servicios_tecnicos_um_unidad_id_fkey'
       and conrelid = 'public.coi_servicios_tecnicos_um'::regclass`);
  check(fk.length === 1, 'no existe coi_servicios_tecnicos_um_unidad_id_fkey');
  check(fk[0].confdeltype === 'r', `la FK deberia ser RESTRICT y es «${fk[0].confdeltype}»`);
  check(/on delete restrict/i.test(fk[0].def), `definicion inesperada: ${fk[0].def}`);

  const { rows: constraints } = await db.query(`
    select conname
      from pg_constraint
     where conrelid in (
       'public.coi_unidades_mantenimiento'::regclass,
       'public.coi_servicios_tecnicos_um'::regclass
     )
     order by conname`);
  const nombres = constraints.map((r) => r.conname);
  for (const esperado of [
    'coi_unidades_mantenimiento_pkey',
    'coi_unidades_mantenimiento_codigo_um_key',
    'coi_servicios_tecnicos_um_pkey',
    'coi_servicios_tecnicos_um_unidad_id_fkey'
  ]) check(nombres.includes(esperado), `falta ${esperado}: alguna tabla fue recreada o alterada de mas`);

  const { rows: um } = await db.query(`
    insert into public.coi_unidades_mantenimiento
      (codigo_um, tipo, estacion, descripcion, estado)
    values
      ('H05-UM-001', 'Ascensor', 'PLAZA CONSTITUCION', 'UM de prueba H05', 'ACTIVA')
    returning id`);
  const unidadId = um[0].id;

  await db.query(`
    insert into public.coi_servicios_tecnicos_um
      (unidad_id, nro_st, fecha, descripcion, estado)
    values
      ($1, 'H05-ST-001', current_date, 'Servicio tecnico historico H05', 'Pendiente')`,
    [unidadId]
  );

  const errorPadre = await fallo(() =>
    db.query('delete from public.coi_unidades_mantenimiento where id = $1', [unidadId]));
  check(Boolean(errorPadre), 'el DELETE de una UM con ST asociado no fue rechazado');
  check(
    /violates foreign key constraint|coi_servicios_tecnicos_um_unidad_id_fkey/i.test(errorPadre),
    `el DELETE fallo por otro motivo: ${errorPadre}`
  );

  const { rows: sobreviven } = await db.query(`
    select
      (select count(*)::int from public.coi_unidades_mantenimiento where id = $1) um,
      (select count(*)::int from public.coi_servicios_tecnicos_um where unidad_id = $1) st`,
    [unidadId]
  );
  check(sobreviven[0].um === 1, 'la UM desaparecio pese a la FK RESTRICT');
  check(sobreviven[0].st === 1, 'el Servicio Tecnico fue destruido por cascada');

  await db.query('delete from public.coi_servicios_tecnicos_um where unidad_id = $1', [unidadId]);
  const errorSinDependencia = await fallo(() =>
    db.query('delete from public.coi_unidades_mantenimiento where id = $1', [unidadId]));
  check(!errorSinDependencia, `la FK bloqueo una UM sin ST dependiente: ${errorSinDependencia}`);

  const errorReaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!errorReaplicar, `reaplicar la migracion fallo: ${errorReaplicar}`);
  const { rows: fk2 } = await db.query(`
    select confdeltype
      from pg_constraint
     where conname = 'coi_servicios_tecnicos_um_unidad_id_fkey'
       and conrelid = 'public.coi_servicios_tecnicos_um'::regclass`);
  check(fk2.length === 1 && fk2[0].confdeltype === 'r', 'reaplicar la migracion altero la FK');

  const cuerpo = leer(MIGRACION);
  for (const patron of [
    /\btruncate\b/i,
    /\bdrop\s+table\b/i,
    /\bdelete\s+from\b/i,
    /\bupdate\s+public\./i,
    /\binsert\s+into\b/i
  ]) check(!patron.test(cuerpo), `la migracion contiene una operacion sobre datos: ${patron}`);
  const drops = cuerpo.match(/drop\s+constraint\s+([a-z0-9_]+)/gi) || [];
  check(
    drops.every((d) => /coi_servicios_tecnicos_um_unidad_id_fkey/i.test(d)),
    `la migracion elimina constraints ajenas: ${drops.join(', ')}`
  );

  await db.close();
  console.log('H05 UM: historial de Servicios Tecnicos protegido contra cascada.');
  console.log('  FK coi_servicios_tecnicos_um.unidad_id : ON DELETE RESTRICT');
  console.log('  DELETE de UM con ST                    : rechazado, 0 filas perdidas');
  console.log('  Control negativo sin ST                : permitido a nivel FK');
  console.log('  Idempotencia                            : reaplicar es NO-OP');
  console.log(`${aprobados} controles H05 de integridad aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('H05 UM delete guard FAIL:', error.message || error);
  process.exit(1);
});
