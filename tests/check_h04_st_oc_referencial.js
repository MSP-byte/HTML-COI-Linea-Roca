#!/usr/bin/env node
'use strict';

/*
  H04 — La OC de un Servicio Tecnico es una referencia real de PostgreSQL.

  Antes, la asociacion ST -> OC la sostenia el frontend: SELECT para validar y
  despues INSERT/UPDATE para escribir. Eso dejaba tres agujeros que ninguna
  validacion de navegador cierra: la normalizacion del numero, la carrera entre
  validar y escribir, y la renumeracion de OC.

  Este control aplica todas las migraciones sobre PGlite y verifica los seis
  escenarios exigidos:

    1) coi_order_number_guard normaliza el numero al escribir la orden, asi que
       la forma almacenada es siempre la canonica. El ST acepta cualquier
       variante que el operador escriba —«4530-008964», «4530.008964»,
       «OC 4530008964»— y guarda la vigente. Sin el trigger, la FK rechazaria
       esas variantes aunque la orden exista;
    2) una OC inexistente no se guarda;
    3) una OC con ST asociado no se puede borrar: jamas queda un ST huerfano;
    4) tras renumerar la OC, el ST sigue apuntando al numero NUEVO y el viejo no
       se puede restaurar;
    5) cambiar explicitamente de OC resuelve canonicamente la nueva;
    6) la integridad es de la base: el trigger corre en la misma sentencia que la
       escritura, sin ventana de carrera.

  Ademas: nro_oc sigue siendo nullable, con datos sucios preexistentes la
  migracion ABORTA sin tocar filas, y reaplicarla es NO-OP.

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
const MIGRACION = '202608310004_h04_st_oc_referencial.sql';
const FK = 'coi_servicios_tecnicos_um_nro_oc_fkey';

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

// Las OC se insertan sin pasar por la RPC: aca interesa la integridad, no el
// flujo de alta.
// Una orden exige exactamente una estacion principal, y ese control es un
// constraint trigger diferido: ambas filas tienen que entrar en la MISMA
// transaccion para que la comprobacion corra al COMMIT y no a mitad de camino.
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
const nuevaUM = async (db, codigo) => {
  const { rows } = await db.query(
    `insert into public.coi_unidades_mantenimiento (codigo_um, tipo_um, estacion, estado)
     values ($1, 'Ascensor', 'PLAZA CONSTITUCION', 'ACTIVA') returning id`, [codigo]);
  return rows[0].id;
};
const nuevoST = (db, unidadId, nroSt, nroOc) => db.query(
  `insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, nro_oc, fecha, descripcion, estado)
   values ($1, $2, $3, current_date, 'Servicio tecnico', 'Pendiente')`, [unidadId, nroSt, nroOc]);

async function main() {
  const db = await nuevaBase(true);

  // La FK existe y tiene las acciones que corresponden.
  const { rows: fk } = await db.query(`
    select confupdtype, confdeltype, pg_get_constraintdef(oid) def
      from pg_constraint
     where conname = $1 and conrelid = 'public.coi_servicios_tecnicos_um'::regclass`, [FK]);
  check(fk.length === 1, `no existe la FK ${FK}`);
  check(fk[0].confupdtype === 'c', 'la FK deberia ser ON UPDATE CASCADE para seguir las renumeraciones');
  check(fk[0].confdeltype === 'r', 'la FK deberia ser ON DELETE RESTRICT');
  check(/references coi_ordenes\(nro_oc\)/i.test(fk[0].def), `destino inesperado: ${fk[0].def}`);

  // El trigger de resolucion corre BEFORE, en la misma sentencia que la escritura.
  const { rows: trg } = await db.query(`
    select t.tgname, t.tgtype
      from pg_trigger t
     where t.tgrelid = 'public.coi_servicios_tecnicos_um'::regclass
       and t.tgname = 'coi_st_resolver_nro_oc'`);
  check(trg.length === 1, 'falta el trigger de resolucion canonica del nro_oc');
  // tgtype: bit 1 = FOR EACH ROW, bit 2 = BEFORE, bit 4 = INSERT, bit 16 = UPDATE.
  check((trg[0].tgtype & 1) === 1, 'el trigger tiene que ser FOR EACH ROW');
  check((trg[0].tgtype & 2) === 2, 'el trigger tiene que ser BEFORE: despues ya seria tarde');
  check((trg[0].tgtype & 4) === 4, 'el trigger tiene que cubrir INSERT');
  check((trg[0].tgtype & 16) === 16, 'el trigger tiene que cubrir UPDATE');

  const umA = await nuevaUM(db, 'OC-UM-001');

  // 1) coi_order_number_guard normaliza el numero al escribir la orden, de modo
  //    que la forma ALMACENADA es siempre la canonica. Lo que importa entonces
  //    es que el ST acepte cualquier variante que el operador escriba y termine
  //    guardando la vigente: sin el trigger, la FK rechazaria «4530-008964»
  //    aunque la orden exista.
  await nuevaOC(db, '4530-008964');
  const { rows: comoQuedo } = await db.query(
    "select nro_oc from public.coi_ordenes order by nro_oc");
  check(comoQuedo[0].nro_oc === '4530008964',
    `la orden se almacena normalizada y quedo ${comoQuedo[0].nro_oc}`);

  // Cada una de estas variantes designa la MISMA orden.
  const variantes = ['4530008964', '4530-008964', '4530.008964', '4530 008964', 'OC 4530008964'];
  for (let i = 0; i < variantes.length; i++) {
    const error = await fallo(() => nuevoST(db, umA, 'ST-VAR-' + i, variantes[i]));
    check(!error, `deberia aceptarse «${variantes[i]}»: ${error}`);
    const { rows: g } = await db.query(
      "select nro_oc from public.coi_servicios_tecnicos_um where nro_st = $1", ['ST-VAR-' + i]);
    check(g[0].nro_oc === '4530008964',
      `«${variantes[i]}» deberia guardarse como 4530008964 y guardo ${g[0].nro_oc}`);
  }

  // Se reutiliza la primera como el ST de referencia del resto del control.
  await db.query(
    "update public.coi_servicios_tecnicos_um set nro_st = 'ST-0001' where nro_st = 'ST-VAR-0'");

  // 2) una OC inexistente no se guarda.
  const inexistente = await fallo(() => nuevoST(db, umA, 'ST-0003', '4530999999'));
  check(Boolean(inexistente), 'un ST con OC inexistente no deberia guardarse');
  check(/COI_ST_OC_INEXISTENTE|foreign key/i.test(inexistente),
    `el rechazo deberia ser explicito: ${inexistente}`);
  const { rows: noQuedo } = await db.query(
    "select count(*)::int n from public.coi_servicios_tecnicos_um where nro_st = 'ST-0003'");
  check(noQuedo[0].n === 0, 'el ST rechazado no puede haber quedado');

  // nro_oc sigue siendo opcional.
  const sinOC = await fallo(() => nuevoST(db, umA, 'ST-0004', null));
  check(!sinOC, `un ST sin OC deberia seguir permitido: ${sinOC}`);

  // 3) una OC con ST asociado no se puede borrar.
  const borrar = await fallo(() => db.query(
    "delete from public.coi_ordenes where nro_oc = '4530008964'"));
  check(Boolean(borrar), 'no deberia poder borrarse una OC con Servicios Tecnicos asociados');
  check(/violates foreign key|RESTRICT/i.test(borrar), `el rechazo vino por otro motivo: ${borrar}`);
  const { rows: sobrevive } = await db.query(
    "select nro_oc from public.coi_servicios_tecnicos_um where nro_st = 'ST-0001'");
  check(sobrevive[0].nro_oc === '4530008964', 'el ST no puede quedar huerfano');

  // 4) renumerar la OC arrastra el ST y el numero viejo no se puede restaurar.
  await db.query(
    "update public.coi_ordenes set nro_oc = '4530-777777' where nro_oc = '4530008964'");
  const { rows: renumerado } = await db.query(
    "select nro_oc from public.coi_servicios_tecnicos_um where nro_st = 'ST-0001'");
  check(renumerado[0].nro_oc === '4530777777',
    `la renumeracion deberia propagarse al ST y quedo en ${renumerado[0].nro_oc}`);

  const volverAtras = await fallo(() => db.query(
    "update public.coi_servicios_tecnicos_um set nro_oc = '4530008964' where nro_st = 'ST-0001'"));
  check(Boolean(volverAtras), 'no deberia poder restaurarse un numero de OC que ya no existe');
  const { rows: sigueNuevo } = await db.query(
    "select nro_oc from public.coi_servicios_tecnicos_um where nro_st = 'ST-0001'");
  check(sigueNuevo[0].nro_oc === '4530777777', 'el ST tiene que conservar el numero vigente');

  // 5) cambiar explicitamente de OC resuelve canonicamente la nueva.
  await nuevaOC(db, '4530222222');
  const cambiar = await fallo(() => db.query(
    "update public.coi_servicios_tecnicos_um set nro_oc = '4530-22.22/22' where nro_st = 'ST-0001'"));
  check(!cambiar, `deberia poder cambiarse a otra OC existente: ${cambiar}`);
  const { rows: cambiado } = await db.query(
    "select nro_oc from public.coi_servicios_tecnicos_um where nro_st = 'ST-0001'");
  check(cambiado[0].nro_oc === '4530222222',
    `deberia haber adoptado la forma canonica y quedo ${cambiado[0].nro_oc}`);

  // 6) editar otro campo no toca la asociacion.
  await db.query(
    "update public.coi_servicios_tecnicos_um set descripcion = 'otra cosa' where nro_st = 'ST-0001'");
  const { rows: intacto } = await db.query(
    "select nro_oc, descripcion from public.coi_servicios_tecnicos_um where nro_st = 'ST-0001'");
  check(intacto[0].nro_oc === '4530222222' && intacto[0].descripcion === 'otra cosa',
    'editar otro campo no puede mover la OC asociada');

  // Idempotencia.
  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar la migracion fallo: ${reaplicar}`);
  const { rows: fk2 } = await db.query(
    'select count(*)::int n from pg_constraint where conname = $1', [FK]);
  check(fk2[0].n === 1, 'reaplicar la migracion duplico o elimino la FK');

  await db.close();

  // Datos sucios preexistentes: la migracion aborta sin tocar filas.
  const sucia = await nuevaBase(false);
  const umSucia = await nuevaUM(sucia, 'OC-UM-SUCIA');
  await nuevaOC(sucia, '4530008964');
  await nuevoST(sucia, umSucia, 'ST-OK', '4530008964');
  await nuevoST(sucia, umSucia, 'ST-HUERFANO', '4530999999');
  const { rows: antes } = await sucia.query(
    'select count(*)::int n from public.coi_servicios_tecnicos_um');
  check(antes[0].n === 2, 'el escenario sucio deberia tener 2 ST');

  const aborto = await fallo(() => sucia.exec(leer(MIGRACION)));
  check(Boolean(aborto), 'con ST huerfanos la migracion deberia abortar');
  check(/COI_ST_OC_HUERFANAS_PREEXISTENTES/.test(aborto),
    `el aborto deberia ser explicito y es: ${aborto}`);
  const { rows: despues } = await sucia.query(
    'select count(*)::int n, count(nro_oc)::int con_oc from public.coi_servicios_tecnicos_um');
  check(despues[0].n === 2 && despues[0].con_oc === 2,
    'la migracion abortada no puede haber borrado filas ni vaciado la columna');
  const { rows: sinFk } = await sucia.query(
    'select count(*)::int n from pg_constraint where conname = $1', [FK]);
  check(sinFk[0].n === 0, 'con datos sucios no puede haberse creado la FK');
  await sucia.close();

  // La migracion no borra datos ni toca autorizacion.
  const cuerpo = leer(MIGRACION).replace(/--[^\n]*/g, '');
  for (const patron of [
    /\btruncate\b/i,
    /\bdrop\s+table\b/i,
    /\bdelete\s+from\b/i,
    /\bcreate\s+policy\b/i,
    /\bdrop\s+policy\b/i,
    /\bgrant\b/i,
    /\bdisable\s+row\s+level\s+security\b/i
  ]) check(!patron.test(cuerpo), `la migracion no deberia contener: ${patron}`);
  // El unico UPDATE admitido es el que canonicaliza el formato antes de crear la
  // FK, y solo sobre filas que ya apuntan a una orden real.
  const updates = cuerpo.match(/update\s+public\.\w+/gi) || [];
  check(updates.length === 1 && /coi_servicios_tecnicos_um/i.test(updates[0]),
    `solo se admite la canonicalizacion previa: ${updates.join(', ')}`);
  check(/coi_normalize_order_number/.test(cuerpo),
    'la resolucion tiene que usar la normalizacion canonica del proyecto');

  console.log('H04 ST/OC: la asociacion es una referencia real, no un texto.');
  console.log(`  FK ${FK}`);
  console.log('  ON UPDATE CASCADE                        : la renumeracion arrastra el ST');
  console.log('  ON DELETE RESTRICT                       : no se borra una OC con historial');
  console.log('  Trigger BEFORE + FK                      : validar y escribir en una sentencia');
  console.log('  4530008964 -> OC «4530-008964»           : resuelto por forma canonica');
  console.log('  Numero viejo tras renumerar              : imposible de restaurar');
  console.log('  OC inexistente                           : rechazada, 0 filas');
  console.log('  ST huerfanos preexistentes               : aborta sin tocar filas');
  console.log('  Idempotencia                             : reaplicar es NO-OP');
  console.log(`${aprobados} controles H04 de integridad ST/OC aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('H04 ST/OC referencial FAIL:', error.message || error);
  process.exit(1);
});
