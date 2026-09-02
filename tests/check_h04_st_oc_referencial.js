#!/usr/bin/env node
'use strict';

/*
  H04 — La OC de un Servicio Tecnico es una referencia real por UUID.

  La identidad maestra de una Orden de Compra en este repositorio es su UUID:
  coi_ordenes.id. nro_oc es un identificador de NEGOCIO renumerable. Colgar de el
  la relacion tecnica ataba el vinculo ST -> OC a un texto que cambia; ademas la
  asociacion la sostenia el frontend, con lo que ni la normalizacion canonica ni
  la carrera entre validar y escribir estaban cubiertas.

  Este control aplica todas las migraciones sobre PGlite y verifica los ocho
  escenarios exigidos:

    A) ST nuevo con OC valida        -> guarda el orden_id correcto y el nro_oc
                                        canonico;
    B) variante «OC 4530008964»      -> resuelve al mismo UUID;
    C) OC inexistente                -> 0 escrituras;
    D) ST sin OC                     -> orden_id y nro_oc en NULL, permitido;
    E) OC renumerada                 -> el orden_id NO cambia;
    F) DELETE de una OC con ST       -> RESTRICT;
    G) backfill de ST preexistentes  -> resuelve el UUID;
    H) huerfano preexistente         -> la migracion ABORTA sin borrar ni
                                        modificar filas.

  Ademas: la FK tecnica NO cuelga de nro_oc, ambos campos son nullable, el
  trigger corre BEFORE en la misma sentencia que la escritura, y reaplicar la
  migracion es NO-OP.

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
const FK = 'coi_servicios_tecnicos_um_orden_id_fkey';
const FK_RETIRADA = 'coi_servicios_tecnicos_um_nro_oc_fkey';

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
// El alta escribe el numero, como lo haria un operador que solo conoce la OC por
// su numero: es el trigger el que tiene que completar la identidad tecnica.
const nuevoST = (db, unidadId, nroSt, nroOc) => db.query(
  `insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, nro_oc, fecha, descripcion, estado)
   values ($1, $2, $3, current_date, 'Servicio tecnico', 'Pendiente')`, [unidadId, nroSt, nroOc]);
const verST = async (db, nroSt) => {
  const { rows } = await db.query(
    'select orden_id, nro_oc from public.coi_servicios_tecnicos_um where nro_st = $1', [nroSt]);
  return rows[0];
};

async function main() {
  const db = await nuevaBase(true);

  // La columna existe, es uuid y es nullable: un ST puede no citar ninguna OC.
  const { rows: col } = await db.query(`
    select data_type, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = 'coi_servicios_tecnicos_um'
       and column_name = 'orden_id'`);
  check(col.length === 1, 'falta la columna orden_id');
  check(col[0].data_type === 'uuid', `orden_id deberia ser uuid y es ${col[0].data_type}`);
  check(col[0].is_nullable === 'YES', 'orden_id tiene que ser nullable');

  // La FK tecnica cuelga del UUID, con ON DELETE RESTRICT.
  const { rows: fk } = await db.query(`
    select confdeltype, pg_get_constraintdef(oid) def
      from pg_constraint
     where conname = $1 and conrelid = 'public.coi_servicios_tecnicos_um'::regclass`, [FK]);
  check(fk.length === 1, `no existe la FK ${FK}`);
  check(fk[0].confdeltype === 'r', 'la FK deberia ser ON DELETE RESTRICT');
  check(fk[0].def.indexOf('coi_ordenes(id)') >= 0, `destino inesperado: ${fk[0].def}`);

  // Y NO cuelga del numero de negocio: nro_oc es dato denormalizado.
  const { rows: fkVieja } = await db.query(
    'select count(*)::int n from pg_constraint where conname = $1', [FK_RETIRADA]);
  check(fkVieja[0].n === 0, 'nro_oc no puede ser la referencia tecnica');
  const { rows: fkNro } = await db.query(`
    select count(*)::int n from pg_constraint
     where conrelid = 'public.coi_servicios_tecnicos_um'::regclass and contype = 'f'
       and pg_get_constraintdef(oid) ilike '%FOREIGN KEY (nro_oc)%'`);
  check(fkNro[0].n === 0, 'ninguna FK puede colgar de nro_oc');

  // El chequeo de RESTRICT recorre la tabla hija: tiene que haber indice.
  const { rows: idx } = await db.query(`
    select count(*)::int n from pg_indexes
     where schemaname = 'public' and indexname = 'coi_servicios_tecnicos_um_orden_id_idx'`);
  check(idx[0].n === 1, 'falta el indice sobre orden_id');

  // El trigger de coherencia corre BEFORE, en la misma sentencia que la escritura.
  const { rows: trg } = await db.query(`
    select t.tgname, t.tgtype, t.tgattr
      from pg_trigger t
     where t.tgrelid = 'public.coi_servicios_tecnicos_um'::regclass
       and t.tgname = 'coi_st_resolver_nro_oc'`);
  check(trg.length === 1, 'falta el trigger de coherencia orden_id/nro_oc');
  // tgtype: bit 1 = FOR EACH ROW, bit 2 = BEFORE, bit 4 = INSERT, bit 16 = UPDATE.
  check((trg[0].tgtype & 1) === 1, 'el trigger tiene que ser FOR EACH ROW');
  check((trg[0].tgtype & 2) === 2, 'el trigger tiene que ser BEFORE: despues ya seria tarde');
  check((trg[0].tgtype & 4) === 4, 'el trigger tiene que cubrir INSERT');
  check((trg[0].tgtype & 16) === 16, 'el trigger tiene que cubrir UPDATE');
  // Y tiene que vigilar las DOS columnas: si solo mirara nro_oc, un UPDATE que
  // cambiara unicamente orden_id entraria sin resolver el numero visible.
  const { rows: vigiladas } = await db.query(`
    select array_agg(a.attname order by a.attname) cols
      from pg_trigger t
      join unnest(t.tgattr) att(num) on true
      join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = att.num
     where t.tgrelid = 'public.coi_servicios_tecnicos_um'::regclass
       and t.tgname = 'coi_st_resolver_nro_oc'`);
  check(JSON.stringify(vigiladas[0].cols) === JSON.stringify(['nro_oc', 'orden_id']),
    `el trigger deberia vigilar nro_oc y orden_id, y vigila ${JSON.stringify(vigiladas[0].cols)}`);

  const umA = await nuevaUM(db, 'OC-UM-001');

  // coi_order_number_guard normaliza el numero al escribir la orden, de modo que
  // la forma ALMACENADA es siempre la canonica.
  const ocA = await nuevaOC(db, '4530-008964');
  const { rows: comoQuedo } = await db.query(
    'select nro_oc from public.coi_ordenes where id = $1', [ocA]);
  check(comoQuedo[0].nro_oc === '4530008964',
    `la orden se almacena normalizada y quedo ${comoQuedo[0].nro_oc}`);

  // A) y B) ST nuevo con OC valida: guarda el UUID correcto y el numero canonico,
  //    escriba el operador la variante que escriba.
  const variantes = ['4530008964', '4530-008964', '4530.008964', '4530 008964', 'OC 4530008964'];
  for (let i = 0; i < variantes.length; i++) {
    const error = await fallo(() => nuevoST(db, umA, 'ST-VAR-' + i, variantes[i]));
    check(!error, `deberia aceptarse «${variantes[i]}»: ${error}`);
    const g = await verST(db, 'ST-VAR-' + i);
    check(g.orden_id === ocA,
      `«${variantes[i]}» deberia resolver al UUID de la orden y resolvio ${g.orden_id}`);
    check(g.nro_oc === '4530008964',
      `«${variantes[i]}» deberia guardarse como 4530008964 y guardo ${g.nro_oc}`);
  }

  // Se reutiliza la primera como el ST de referencia del resto del control.
  await db.query(
    "update public.coi_servicios_tecnicos_um set nro_st = 'ST-0001' where nro_st = 'ST-VAR-0'");

  // Tambien se acepta el camino inverso: llega el UUID y la base completa el
  // numero visible vigente. Es el que usa el frontend al confirmar una OC.
  await db.query(
    `insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, orden_id, fecha, descripcion, estado)
     values ($1, 'ST-UUID', $2, current_date, 'Alta por UUID', 'Pendiente')`, [umA, ocA]);
  const porUuid = await verST(db, 'ST-UUID');
  check(porUuid.orden_id === ocA && porUuid.nro_oc === '4530008964',
    'un alta por orden_id tiene que completar el numero visible vigente');

  // C) OC inexistente: 0 escrituras, tanto por numero como por UUID.
  const inexistente = await fallo(() => nuevoST(db, umA, 'ST-0003', '4530999999'));
  check(Boolean(inexistente), 'un ST con OC inexistente no deberia guardarse');
  check(/COI_ST_OC_INEXISTENTE|foreign key/i.test(inexistente),
    `el rechazo deberia ser explicito: ${inexistente}`);
  const { rows: noQuedo } = await db.query(
    "select count(*)::int n from public.coi_servicios_tecnicos_um where nro_st = 'ST-0003'");
  check(noQuedo[0].n === 0, 'el ST rechazado no puede haber quedado');

  const uuidFantasma = await fallo(() => db.query(
    `insert into public.coi_servicios_tecnicos_um (unidad_id, nro_st, orden_id, fecha, descripcion, estado)
     values ($1, 'ST-0005', '00000000-0000-4000-8000-000000000000', current_date, 'x', 'Pendiente')`,
    [umA]));
  check(Boolean(uuidFantasma), 'un orden_id inexistente no deberia guardarse');
  check(/COI_ST_OC_INEXISTENTE|foreign key/i.test(uuidFantasma),
    `el rechazo por UUID deberia ser explicito: ${uuidFantasma}`);

  // D) ST sin OC: ambos campos en NULL, permitido.
  const sinOC = await fallo(() => nuevoST(db, umA, 'ST-0004', null));
  check(!sinOC, `un ST sin OC deberia seguir permitido: ${sinOC}`);
  const libre = await verST(db, 'ST-0004');
  check(libre.orden_id === null && libre.nro_oc === null,
    'un ST sin OC tiene que quedar con los dos campos en NULL');

  // F) una OC con ST asociado no se puede borrar.
  const borrar = await fallo(() => db.query(
    'delete from public.coi_ordenes where id = $1', [ocA]));
  check(Boolean(borrar), 'no deberia poder borrarse una OC con Servicios Tecnicos asociados');
  check(/violates foreign key|RESTRICT/i.test(borrar), `el rechazo vino por otro motivo: ${borrar}`);
  const sobrevive = await verST(db, 'ST-0001');
  check(sobrevive.orden_id === ocA, 'el ST no puede quedar huerfano');

  // E) renumerar la OC NO cambia la identidad tecnica del vinculo.
  //
  //    Se reproduce el orden exacto de coi_renumerar_oc —unico camino que
  //    cambia coi_ordenes.nro_oc—: primero la orden maestra y despues las
  //    tablas dependientes por su numero anterior.
  await db.query(
    'update public.coi_ordenes set nro_oc = $1 where id = $2', ['4530-777777', ocA]);
  const trasRenumerarOrden = await verST(db, 'ST-0001');
  check(trasRenumerarOrden.orden_id === ocA,
    'renumerar la OC no puede mover el orden_id del ST');

  const { rows: sincronizados } = await db.query(
    'update public.coi_servicios_tecnicos_um set nro_oc = $1 where nro_oc = $2 returning 1',
    ['4530777777', '4530008964']);
  check(sincronizados.length === 6,
    `el UPDATE de la RPC deberia alcanzar los 6 ST asociados y alcanzo ${sincronizados.length}`);
  const renumerado = await verST(db, 'ST-0001');
  check(renumerado.orden_id === ocA && renumerado.nro_oc === '4530777777',
    `tras la renumeracion el ST conserva su UUID y muestra el numero nuevo: ${JSON.stringify(renumerado)}`);
  // La verificacion post-sync de la RPC: ningun ST puede quedar con el anterior.
  const { rows: rezagados } = await db.query(
    "select count(*)::int n from public.coi_servicios_tecnicos_um where nro_oc = '4530008964'");
  check(rezagados[0].n === 0, 'ningun ST puede quedar con el numero anterior');

  const volverAtras = await fallo(() => db.query(
    "update public.coi_servicios_tecnicos_um set nro_oc = '4530008964' where nro_st = 'ST-0001'"));
  check(Boolean(volverAtras), 'no deberia poder restaurarse un numero de OC que ya no existe');
  const sigueNuevo = await verST(db, 'ST-0001');
  check(sigueNuevo.nro_oc === '4530777777', 'el ST tiene que conservar el numero vigente');

  // Cambiar explicitamente de OC mueve las dos cosas a la vez.
  const ocB = await nuevaOC(db, '4530222222');
  const cambiar = await fallo(() => db.query(
    "update public.coi_servicios_tecnicos_um set nro_oc = '4530-22.22/22' where nro_st = 'ST-0001'"));
  check(!cambiar, `deberia poder cambiarse a otra OC existente: ${cambiar}`);
  const cambiado = await verST(db, 'ST-0001');
  check(cambiado.orden_id === ocB && cambiado.nro_oc === '4530222222',
    `cambiar de OC tiene que mover orden_id y nro_oc juntos: ${JSON.stringify(cambiado)}`);

  // Quitar la OC: los dos campos en NULL a la vez.
  const quitar = await fallo(() => db.query(
    "update public.coi_servicios_tecnicos_um set nro_oc = null, orden_id = null where nro_st = 'ST-0001'"));
  check(!quitar, `deberia poder quitarse la OC de un ST: ${quitar}`);
  const quitada = await verST(db, 'ST-0001');
  check(quitada.orden_id === null && quitada.nro_oc === null,
    'quitar la OC tiene que dejar los dos campos en NULL');
  await db.query(
    'update public.coi_servicios_tecnicos_um set orden_id = $1 where nro_st = $2', [ocB, 'ST-0001']);

  // Editar otro campo no toca la asociacion.
  await db.query(
    "update public.coi_servicios_tecnicos_um set descripcion = 'otra cosa' where nro_st = 'ST-0001'");
  const intacto = await verST(db, 'ST-0001');
  check(intacto.orden_id === ocB && intacto.nro_oc === '4530222222',
    'editar otro campo no puede mover la OC asociada');

  // ------------------------------------------------------------------
  // I) Modos de ROW LOCK contra la renumeracion concurrente.
  //
  // QUE VERIFICA ESTE BLOQUE Y QUE NO
  //   PGlite corre un unico backend: NO admite dos sesiones simultaneas, de
  //   modo que ni la carrera real —T1 escribe el ST mientras T2 renumera la
  //   OC—, ni un deadlock, ni el disparo efectivo del NOWAIT pueden EJECUTARSE
  //   aca. Nada de lo que sigue es una prueba de concurrencia
  //   multi-transaccion y no debe leerse como tal.
  //
  //   Lo que si se verifica de forma dura, sobre la definicion REALMENTE
  //   desplegada (pg_get_functiondef, no el texto del archivo):
  //
  //     1-2 · las dos rutas de resolucion toman `for update` BLOQUEANTE en el
  //           camino INSERT (por orden_id y por nro_oc);
  //     3-4 · las dos toman `for update nowait` en el camino UPDATE;
  //       5 · no queda ningun `for update` bloqueante en la rama UPDATE;
  //       6 · el conflicto de lock es fail-closed: se captura
  //           lock_not_available y se levanta COI_ST_OC_CONCURRENCIA, sin
  //           reintento dentro del trigger;
  //           y que el lock precede a la derivacion de nro_oc.
  //
  //   POR QUE ESTOS MODOS. En UPDATE, PostgreSQL bloquea el tuple ST
  //   (GetTupleForTrigger) ANTES de disparar el BEFORE ROW UPDATE. Un
  //   FOR UPDATE bloqueante daria «fila ST -> coi_ordenes» contra el
  //   «coi_ordenes -> fila ST» de coi_renumerar_oc: deadlock. Y no lockear
  //   tampoco alcanza, porque durante una REASOCIACION A -> B el ST todavia no
  //   pertenece a B para la transaccion que renumera B, de modo que su
  //   sincronizacion no lo alcanza y quedaria con el numero viejo. NOWAIT
  //   resuelve las dos cosas: nunca espera —no puede cerrar un ciclo— y falla
  //   en el acto si la orden esta tomada.
  //
  //   La semantica del lock en si —que FOR UPDATE serialice, que NOWAIT falle
  //   con 55P03 ante un conflicto— es una garantia de PostgreSQL, no del
  //   proyecto, y no se re-testea. Este control cubre que el proyecto pida el
  //   modo correcto en cada camino.
  const { rows: defTrigger } = await db.query(
    "select pg_get_functiondef('public.coi_st_resolver_nro_oc()'::regprocedure) def");
  const fn = defTrigger[0].def;
  const cuerpoFn = fn.replace(/--[^\n]*/g, '');

  // Se recortan las dos ramas de resolucion. Cada una es un `if tg_op =
  // 'INSERT' then ... else ... end if;` con el lock de una ruta.
  const ramas = cuerpoFn.match(/if tg_op = 'INSERT' then[\s\S]*?\n    end if;/gi) || [];
  check(ramas.length === 2,
    `se esperaban 2 ramas de resolucion con lock y hay ${ramas.length}`);
  const ramaPorUuid = ramas.find((r) => /where o\.id = new\.orden_id/i.test(r));
  const ramaPorNumero = ramas.find((r) => /where o\.id = v_id/i.test(r));
  check(Boolean(ramaPorUuid), 'falta la rama de resolucion por orden_id');
  check(Boolean(ramaPorNumero), 'falta la rama de resolucion por nro_oc');

  for (const [rama, etiqueta] of [[ramaPorUuid, 'por orden_id'], [ramaPorNumero, 'por nro_oc']]) {
    const corte = rama.toLowerCase().indexOf('else');
    check(corte > 0, `la rama ${etiqueta} tiene que separar INSERT de UPDATE`);
    const enInsert = rama.slice(0, corte);
    const enUpdate = rama.slice(corte);

    // 1 y 2 · INSERT: lock BLOQUEANTE.
    check(/for update;/i.test(enInsert),
      `el INSERT ${etiqueta} tiene que tomar un FOR UPDATE bloqueante`);
    check(!/nowait/i.test(enInsert),
      `el INSERT ${etiqueta} no puede usar NOWAIT: ahi esperar es seguro y necesario`);

    // 3 y 4 · UPDATE: NOWAIT.
    check(/for update nowait;/i.test(enUpdate),
      `el UPDATE ${etiqueta} tiene que tomar el lock con NOWAIT`);
    // 5 · y ningun FOR UPDATE bloqueante puede quedar en el camino UPDATE.
    check(!/for update(?!\s+nowait)/i.test(enUpdate),
      `el UPDATE ${etiqueta} no puede tomar un FOR UPDATE bloqueante: invertiria el orden de locks`);

    // 6 · el conflicto de lock es fail-closed, sin reintento en el trigger.
    check(/exception when lock_not_available then/i.test(enUpdate),
      `el UPDATE ${etiqueta} tiene que capturar lock_not_available explicitamente`);
    check(/COI_ST_OC_CONCURRENCIA/.test(enUpdate),
      `el conflicto de lock ${etiqueta} tiene que informarse como COI_ST_OC_CONCURRENCIA`);
    check(/errcode = '55P03'/.test(enUpdate),
      `el conflicto de lock ${etiqueta} tiene que conservar el SQLSTATE 55P03`);
    check(/hint =/.test(enUpdate),
      `el conflicto de lock ${etiqueta} tiene que decirle al operador que reintente`);
    check(!/loop|while|for\s+\w+\s+in/i.test(enUpdate),
      `el trigger no puede reintentar solo ante un conflicto de lock (${etiqueta})`);
  }

  // Ningun lock puede quedar fuera de esas dos ramas: uno suelto correria en
  // los dos caminos y volveria a mezclar los modos.
  const fueraDeRamas = ramas.reduce((t, r) => t.replace(r, ''), cuerpoFn);
  check(!/for update/i.test(fueraDeRamas),
    'no puede quedar ningun FOR UPDATE fuera de las ramas de resolucion');
  // Cuatro locks en total: bloqueante + NOWAIT por cada una de las dos rutas.
  check((cuerpoFn.match(/for update/gi) || []).length === 4,
    'se esperaban 4 locks: bloqueante y NOWAIT por cada ruta de resolucion');

  // El lock precede a la derivacion del numero en las dos rutas.
  const posLocks = [];
  for (let i = cuerpoFn.toLowerCase().indexOf('for update'); i >= 0;
       i = cuerpoFn.toLowerCase().indexOf('for update', i + 1)) posLocks.push(i);
  const posAsignaciones = [];
  for (let i = cuerpoFn.indexOf('new.nro_oc :='); i >= 0;
       i = cuerpoFn.indexOf('new.nro_oc :=', i + 1)) posAsignaciones.push(i);
  check(posAsignaciones.length === 2,
    `se esperaban 2 derivaciones de nro_oc y hay ${posAsignaciones.length}`);
  check(posAsignaciones.every((pos, idx) => posLocks[idx * 2] < pos && posLocks[idx * 2 + 1] < pos),
    'cada derivacion de nro_oc tiene que ocurrir DESPUES del lock de su ruta');

  // La unica lectura de coi_ordenes sin lock es la que localiza el UUID por
  // forma canonica: no deriva nada por si misma.
  check(/select o\.id into v_id/i.test(cuerpoFn) && /coi_normalize_order_number/i.test(cuerpoFn),
    'la ruta por numero tiene que localizar el UUID por la normalizacion canonica');

  // El trigger sigue siendo BEFORE.
  const { rows: tg } = await db.query(`
    select tgtype from pg_trigger
     where tgname = 'coi_st_resolver_nro_oc'
       and tgrelid = 'public.coi_servicios_tecnicos_um'::regclass`);
  check(tg.length === 1, 'falta el trigger de resolucion');
  check((tg[0].tgtype & 2) === 2, 'el trigger de resolucion tiene que ser BEFORE');

  // coi_renumerar_oc sigue lockeando la orden y sincronizando los ST: es la
  // contraparte contra la que se eligieron estos modos.
  const { rows: defRpc } = await db.query(
    "select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid = p.pronamespace" +
    " where n.nspname = 'public' and p.proname = 'coi_renumerar_oc' limit 1");
  check(defRpc.length === 1, 'no se encontro coi_renumerar_oc');
  const rpc = defRpc[0].def.replace(/--[^\n]*/g, '');
  check(/for update/i.test(rpc), 'coi_renumerar_oc deberia lockear la orden maestra');
  check(/update public\.coi_servicios_tecnicos_um/i.test(rpc),
    'coi_renumerar_oc deberia sincronizar coi_servicios_tecnicos_um');

  // Caso C · la propia renumeracion actualiza los ST mientras YA posee el lock
  // de esa orden. Pedirlo de nuevo desde la misma transaccion no conflictua:
  // esto SI se puede ejecutar en single-session, porque es una unica sesion.
  const ocMismaTx = await nuevaOC(db, '4530515151');
  const umMismaTx = await nuevaUM(db, 'UM-LOCK-01');
  await nuevoST(db, umMismaTx, 'ST-LOCK-01', '4530515151');
  await db.exec('begin;');
  await db.query('select id from public.coi_ordenes where id = $1 for update', [ocMismaTx]);
  await db.query('update public.coi_ordenes set nro_oc = $1 where id = $2', ['4530525252', ocMismaTx]);
  const sincronizar = await fallo(() => db.query(
    'update public.coi_servicios_tecnicos_um set nro_oc = $1 where nro_oc = $2',
    ['4530525252', '4530515151']));
  check(!sincronizar,
    `el NOWAIT no puede fallar contra un lock de la propia transaccion: ${sincronizar}`);
  await db.exec('commit;');

  // 7, 8, 9 · La semantica observable no cambio.
  const stRenumerado = await verST(db, 'ST-LOCK-01');
  check(stRenumerado.orden_id === ocMismaTx, 'la renumeracion no puede mover orden_id');
  check(stRenumerado.nro_oc === '4530525252', 'tras renumerar el ST muestra el numero nuevo');
  const viejo = await fallo(() => db.query(
    "update public.coi_servicios_tecnicos_um set nro_oc = '4530515151' where nro_st = 'ST-LOCK-01'"));
  check(Boolean(viejo) && /COI_ST_OC_INEXISTENTE/.test(viejo),
    `el numero anterior no puede restaurarse como asociacion valida: ${viejo}`);
  const borrarLock = await fallo(() => db.query(
    'delete from public.coi_ordenes where id = $1', [ocMismaTx]));
  check(Boolean(borrarLock) && /violates foreign key|RESTRICT/i.test(borrarLock),
    'una OC con ST asociado sigue protegida por ON DELETE RESTRICT');

  // Y la REASOCIACION —el caso que motivo el NOWAIT— sigue funcionando en el
  // camino normal, sin conflicto: el ST se mueve de una OC a otra y toma el
  // numero vigente de la nueva.
  const ocDestino = await nuevaOC(db, '4530535353');
  await db.query(
    'update public.coi_servicios_tecnicos_um set orden_id = $1 where nro_st = $2',
    [ocDestino, 'ST-LOCK-01']);
  const stReasociado = await verST(db, 'ST-LOCK-01');
  check(stReasociado.orden_id === ocDestino, 'la reasociacion tiene que mover el UUID');
  check(stReasociado.nro_oc === '4530535353',
    'la reasociacion tiene que traer el numero vigente de la orden destino');

  // Idempotencia.
  const reaplicar = await fallo(() => db.exec(leer(MIGRACION)));
  check(!reaplicar, `reaplicar la migracion fallo: ${reaplicar}`);
  const { rows: fk2 } = await db.query(
    'select count(*)::int n from pg_constraint where conname = $1', [FK]);
  check(fk2[0].n === 1, 'reaplicar la migracion duplico o elimino la FK');
  const trasReaplicar = await verST(db, 'ST-0001');
  check(trasReaplicar.orden_id === ocB, 'reaplicar la migracion no puede mover asociaciones');

  await db.close();

  // G) backfill: ST preexistentes que citaban una OC real quedan con su UUID.
  const previa = await nuevaBase(false);
  const umPrevia = await nuevaUM(previa, 'OC-UM-PREVIA');
  const ocPrevia = await nuevaOC(previa, '4530008964');
  await nuevoST(previa, umPrevia, 'ST-PREVIO', '4530008964');
  await nuevoST(previa, umPrevia, 'ST-PREVIO-SIN-OC', null);
  const { rows: antesBackfill } = await previa.query(
    "select count(*)::int n from information_schema.columns " +
    "where table_schema='public' and table_name='coi_servicios_tecnicos_um' and column_name='orden_id'");
  check(antesBackfill[0].n === 0, 'sin la migracion la columna orden_id no deberia existir');

  const backfill = await fallo(() => previa.exec(leer(MIGRACION)));
  check(!backfill, `el backfill fallo: ${backfill}`);
  const migrado = await verST(previa, 'ST-PREVIO');
  check(migrado.orden_id === ocPrevia,
    `el backfill deberia resolver el UUID y dejo ${migrado.orden_id}`);
  check(migrado.nro_oc === '4530008964', 'el backfill no puede alterar el numero visible vigente');
  const migradoSinOC = await verST(previa, 'ST-PREVIO-SIN-OC');
  check(migradoSinOC.orden_id === null && migradoSinOC.nro_oc === null,
    'el backfill no puede inventar una OC para un ST que no la citaba');
  await previa.close();

  // H) huerfano preexistente: la migracion ABORTA sin borrar ni modificar filas.
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
  const { rows: numeros } = await sucia.query(
    'select nro_oc from public.coi_servicios_tecnicos_um order by nro_oc');
  check(numeros.map((r) => r.nro_oc).join(',') === '4530008964,4530999999',
    `la migracion abortada no puede haber modificado los numeros: ${numeros.map((r) => r.nro_oc).join(',')}`);
  const { rows: sinFk } = await sucia.query(
    'select count(*)::int n from pg_constraint where conname = $1', [FK]);
  check(sinFk[0].n === 0, 'con datos sucios no puede haberse creado la FK');
  await sucia.close();

  // La migracion no borra datos ni toca autorizacion.
  const cuerpo = leer(MIGRACION).replace(/--[^\n]*/g, '');
  for (const patron of [
    /\btruncate\b/i,
    /\bdrop\s+table\b/i,
    /\bdrop\s+column\b/i,
    /\bdelete\s+from\b/i,
    /\bcreate\s+policy\b/i,
    /\bdrop\s+policy\b/i,
    /\bgrant\b/i,
    /\bdisable\s+row\s+level\s+security\b/i
  ]) check(!patron.test(cuerpo), `la migracion no deberia contener: ${patron}`);
  // El unico UPDATE admitido es el backfill de orden_id, y solo sobre filas que
  // ya apuntaban a una orden real.
  const updates = cuerpo.match(/update\s+public\.\w+/gi) || [];
  check(updates.length === 1 && /coi_servicios_tecnicos_um/i.test(updates[0]),
    `solo se admite el backfill de orden_id: ${updates.join(', ')}`);
  check(/coi_normalize_order_number/.test(cuerpo),
    'la resolucion tiene que usar la normalizacion canonica del proyecto');
  check(cuerpo.indexOf('references public.coi_ordenes(id)') >= 0,
    'la FK tecnica tiene que apuntar al UUID maestro');
  check(!/references\s+public\.coi_ordenes\s*\(\s*nro_oc\s*\)/i.test(cuerpo),
    'ninguna FK puede apuntar al numero de negocio');

  console.log('H04 ST/OC: la asociacion es una referencia real por UUID.');
  console.log(`  FK ${FK} -> coi_ordenes(id)`);
  console.log('  A · ST nuevo con OC valida               : orden_id correcto + nro_oc canonico');
  console.log('  B · «OC 4530008964»                      : resuelve al mismo UUID');
  console.log('  C · OC inexistente (numero o UUID)       : rechazada, 0 escrituras');
  console.log('  D · ST sin OC                            : orden_id y nro_oc en NULL');
  console.log('  E · OC renumerada                        : mismo orden_id, numero nuevo');
  console.log('  F · DELETE de OC con ST                  : RESTRICT');
  console.log('  G · backfill de ST preexistentes         : resuelve el UUID');
  console.log('  H · huerfano preexistente                : aborta sin tocar filas');
  console.log('  nro_oc                                   : dato denormalizado, sin FK');
  console.log('  Trigger BEFORE sobre nro_oc y orden_id   : validar y escribir en una sentencia');
  console.log('  I · INSERT                               : for update bloqueante en las 2 rutas');
  console.log('      UPDATE                               : for update NOWAIT, fail-closed 55P03');
  console.log('      Reasociacion A -> B                  : toma el numero vigente del destino');
  console.log('      (PGlite es single-session: ni la carrera, ni el deadlock, ni el NOWAIT se ejecutan)');
  console.log('  Idempotencia                             : reaplicar es NO-OP');
  console.log(`${aprobados} controles H04 de integridad ST/OC aprobados; 0 fallidos.`);
}

main().catch((error) => {
  console.error('H04 ST/OC referencial FAIL:', error.message || error);
  process.exit(1);
});
