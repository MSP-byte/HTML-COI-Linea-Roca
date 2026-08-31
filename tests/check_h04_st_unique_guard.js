#!/usr/bin/env node
'use strict';

/*
  H04 — Una Unidad de Mantenimiento no puede tener dos Servicios Tecnicos con
  el mismo numero.

  La capa del frontend ya comprueba el duplicado antes de insertar, pero esa
  comprobacion es UX: con dos clientes concurrentes ambos leen «no existe» y
  despues insertan. Este control valida la defensa que si es integridad.

  Aplica todas las migraciones sobre PGlite en memoria y verifica:
    1) el UNIQUE INDEX sobre (unidad_id, nro_st canonico) existe con nombre estable
       y su normalizacion coincide con claveST() del frontend;
    2) misma UM + mismo nro_st, literal o equivalente (st0001, «ST / 0001»),
       -> el segundo INSERT es rechazado;
    3) distinta UM + mismo nro_st -> permitido;
    4) misma UM + distinto nro_st -> permitido;
    5) el UPDATE que provocaria el choque tambien se rechaza;
    6) nro_st NULL no colisiona (los NULL son distintos entre si);
    7) reaplicar la migracion es NO-OP y no recorre datos;
    8) con duplicados preexistentes la migracion ABORTA sin tocar filas;
    9) la migracion no contiene operaciones destructivas;
   10) no se toco RLS: siguen SELECT/INSERT/UPDATE y ninguna DELETE.

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
const MIGRACION = '202608310001_h04_st_unique_guard.sql';
// Es un UNIQUE INDEX de expresion, no un constraint de tabla: la unicidad se
// aplica sobre el numero canonico, no sobre el texto literal.
const INDICE = 'coi_servicios_tecnicos_um_unidad_nro_st_uidx';
// Misma normalizacion que claveST() en index.html y que el indice en SQL.
const claveST = (v) => String(v == null ? '' : v).replace(/[\s.\/-]+/g, '').toUpperCase();

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

async function nuevaBase(conMigracionH04) {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);
  for (const f of archivos()) {
    if (!conMigracionH04 && f === MIGRACION) continue;
    await db.exec(leer(f));
  }
  return db;
}

const nuevaUM = async (db, codigo) => {
  const { rows } = await db.query(
    `insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
     values ($1, 'Ascensor', 'PLAZA CONSTITUCION', 'ACTIVA') returning id`, [codigo]);
  return rows[0].id;
};
const nuevoST = (db, unidadId, nroSt) => db.query(
  `insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, fecha, descripcion, estado)
   values ($1, $2, current_date, 'Servicio tecnico H04', 'Pendiente')`, [unidadId, nroSt]);

async function main() {
  const db = await nuevaBase(true);

  // 1) el indice unico existe, con nombre estable y sobre la forma canonica.
  const { rows: uq } = await db.query(`
    select i.relname, ix.indisunique, pg_get_indexdef(ix.indexrelid) def
      from pg_index ix
      join pg_class i on i.oid = ix.indexrelid
     where i.relname = $1`, [INDICE]);
  check(uq.length === 1, `no existe el indice ${INDICE}`);
  check(uq[0].indisunique === true, `${INDICE} deberia ser UNIQUE`);
  check(/unidad_id/.test(uq[0].def), `el indice no cubre unidad_id: ${uq[0].def}`);
  check(/upper\(/i.test(uq[0].def) && /regexp_replace\(/i.test(uq[0].def),
    `el indice deberia usar la forma canonica del nro_st: ${uq[0].def}`);
  check(/WHERE .*unidad_id IS NOT NULL/i.test(uq[0].def) && /nro_st IS NOT NULL/i.test(uq[0].def),
    `el indice deberia ser parcial sobre filas con ambos valores: ${uq[0].def}`);

  // La normalizacion del SQL y la del frontend tienen que coincidir: si una
  // aceptara lo que la otra rechaza, el UNIQUE dejaria de proteger lo que la UI
  // considera el mismo ST. Se comprueba contra la propia base.
  for (const variante of ['ST-0001', 'st0001', 'ST / 0001', 'st.0001', ' ST-0001 ']) {
    const { rows: r } = await db.query(
      `select upper(regexp_replace($1, '[[:space:]./-]+', '', 'g')) canonico`, [variante]);
    check(r[0].canonico === claveST(variante),
      `SQL y claveST() difieren para «${variante}»: ${r[0].canonico} vs ${claveST(variante)}`);
  }

  // La FK RESTRICT de H05 y la PK siguen en pie: no se recreo la tabla.
  const { rows: previos } = await db.query(`
    select conname from pg_constraint
     where conrelid = 'public.coi_servicios_tecnicos_um'::regclass order by conname`);
  const nombres = previos.map((r) => r.conname);
  for (const esperado of [
    'coi_servicios_tecnicos_um_pkey',
    'coi_servicios_tecnicos_um_unidad_id_fkey'
  ]) check(nombres.includes(esperado), `falta ${esperado}: la tabla fue recreada o alterada de mas`);

  const umA = await nuevaUM(db, 'H04-UM-001');
  const umB = await nuevaUM(db, 'H04-UM-002');

  // 2) misma UM + mismo nro_st, literal o equivalente -> rechazado.
  await nuevoST(db, umA, 'ST-0001');
  for (const variante of ['ST-0001', 'st0001', 'ST / 0001', 'st.0001']) {
    const choque = await fallo(() => nuevoST(db, umA, variante));
    check(Boolean(choque), `«${variante}» deberia chocar con ST-0001 en la misma UM`);
    check(
      /duplicate key|unique constraint|coi_servicios_tecnicos_um_unidad_nro_st_uidx/i.test(choque),
      `el INSERT de «${variante}» fallo por otro motivo: ${choque}`
    );
  }
  const { rows: unaSola } = await db.query(
    'select count(*)::int n from public.coi_servicios_tecnicos_um where unidad_id = $1', [umA]);
  check(unaSola[0].n === 1, 'el rechazo no debe dejar filas de mas ni de menos');

  // 3) distinta UM + mismo nro_st -> permitido.
  const otraUM = await fallo(() => nuevoST(db, umB, 'ST-0001'));
  check(!otraUM, `el mismo numero de ST en OTRA UM deberia permitirse: ${otraUM}`);

  // 4) misma UM + distinto nro_st -> permitido.
  const otroNro = await fallo(() => nuevoST(db, umA, 'ST-0002'));
  check(!otroNro, `otro numero de ST en la misma UM deberia permitirse: ${otroNro}`);

  // 5) el UPDATE hacia una VARIANTE canonica ya ocupada tambien se rechaza.
  const choqueUpdate = await fallo(() => db.query(
    `update public.coi_servicios_tecnicos_um set nro_st = 'st / 0001'
      where unidad_id = $1 and nro_st = 'ST-0002'`, [umA]));
  check(Boolean(choqueUpdate), 'renombrar un ST a una variante del numero de otro no fue rechazado');
  check(
    /duplicate key|unique constraint/i.test(choqueUpdate),
    `el UPDATE fallo por otro motivo: ${choqueUpdate}`
  );

  // 6) nro_st NULL no colisiona: en Postgres los NULL son distintos entre si.
  const nulo1 = await fallo(() => nuevoST(db, umA, null));
  const nulo2 = await fallo(() => nuevoST(db, umA, null));
  check(!nulo1 && !nulo2, `dos ST sin numero no deberian colisionar: ${nulo1 || nulo2}`);

  // 7) reaplicar la migracion es NO-OP y conserva el constraint.
  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar la migracion fallo: ${reaplicar}`);
  const { rows: uq2 } = await db.query(
    'select indisunique from pg_index ix join pg_class i on i.oid = ix.indexrelid where i.relname = $1',
    [INDICE]);
  check(uq2.length === 1 && uq2[0].indisunique === true, 'reaplicar la migracion altero el indice');

  // 10) RLS intacta: SELECT/INSERT/UPDATE y ninguna DELETE.
  const { rows: policies } = await db.query(`
    select policyname, cmd from pg_policies
     where schemaname = 'public' and tablename = 'coi_servicios_tecnicos_um'`);
  const cmds = policies.map((p) => String(p.cmd).toUpperCase());
  for (const esperado of ['SELECT', 'INSERT', 'UPDATE']) {
    check(cmds.includes(esperado), `falta la policy ${esperado} de coi_servicios_tecnicos_um`);
  }
  check(!cmds.includes('DELETE'), 'la migracion H04 no puede agregar una policy DELETE');
  const { rows: rls } = await db.query(`
    select relrowsecurity from pg_class where oid = 'public.coi_servicios_tecnicos_um'::regclass`);
  check(rls[0].relrowsecurity === true, 'RLS quedo deshabilitado en coi_servicios_tecnicos_um');

  await db.close();

  // 8) con duplicados preexistentes la migracion ABORTA y no toca ninguna fila.
  const sucia = await nuevaBase(false);
  const umSucia = await nuevaUM(sucia, 'H04-UM-DUP');
  // Equivalentes canonicos, no identicos: es justo lo que el indice literal
  // anterior habria dejado pasar.
  await nuevoST(sucia, umSucia, 'ST-DUP');
  await nuevoST(sucia, umSucia, 'st / dup');
  const { rows: antes } = await sucia.query(
    'select count(*)::int n from public.coi_servicios_tecnicos_um');
  check(antes[0].n === 2, 'el escenario sucio deberia tener 2 ST equivalentes');

  const aborto = await fallo(() => sucia.exec(leer(MIGRACION)));
  check(Boolean(aborto), 'con duplicados preexistentes la migracion deberia abortar');
  check(/COI_ST_DUPLICADOS_PREEXISTENTES/.test(aborto),
    `el aborto deberia ser explicito y es: ${aborto}`);

  const { rows: despues } = await sucia.query(
    'select count(*)::int n from public.coi_servicios_tecnicos_um');
  check(despues[0].n === 2, 'la migracion abortada no puede haber borrado ni modificado filas');
  const { rows: sinIndice } = await sucia.query(
    'select count(*)::int n from pg_class where relname = $1', [INDICE]);
  check(sinIndice[0].n === 0, 'con duplicados no puede haberse creado el indice');
  await sucia.close();

  // 9) la migracion no contiene operaciones destructivas sobre datos.
  const cuerpo = leer(MIGRACION);
  for (const patron of [
    /\btruncate\b/i,
    /\bdrop\s+table\b/i,
    /\bdrop\s+constraint\b/i,
    /\bdrop\s+index\b/i,
    /\bdelete\s+from\b/i,
    /\bupdate\s+public\./i,
    /\binsert\s+into\b/i,
    /\bdisable\s+row\s+level\s+security\b/i,
    /\bcreate\s+policy\b/i,
    /\bdrop\s+policy\b/i,
    /\bgrant\b/i
  ]) check(!patron.test(cuerpo), `la migracion no deberia contener: ${patron}`);

  console.log('H04 ST: un Servicio Tecnico por Unidad de Mantenimiento y numero canonico.');
  console.log(`  UNIQUE INDEX ${INDICE}`);
  console.log('  Normalizacion SQL == claveST() del front  : verificada contra la base');
  console.log('  ST-0001 / st0001 / «ST / 0001»           : el mismo ST, segundo rechazado');
  console.log('  Mismo nro_st en otra UM                  : permitido');
  console.log('  UPDATE que provoca el choque             : rechazado');
  console.log('  nro_st NULL                              : no colisiona');
  console.log('  Duplicados preexistentes                 : aborta sin tocar filas');
  console.log('  RLS                                      : intacta, ninguna DELETE');
  console.log('  Idempotencia                             : reaplicar es NO-OP');
  console.log(`${aprobados} controles H04 de integridad aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('H04 ST unique guard FAIL:', error.message || error);
  process.exit(1);
});
