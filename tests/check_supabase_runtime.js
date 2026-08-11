#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));

const USERS = {
  administrador: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin@example.com'],
  jefatura: ['a1111111-1111-4111-8111-111111111111', 'jefatura@example.com'],
  editor: ['a2222222-2222-4222-8222-222222222222', 'editor@example.com'],
  planificacion: ['a3333333-3333-4333-8333-333333333333', 'planificacion@example.com'],
  control: ['a4444444-4444-4444-8444-444444444444', 'control@example.com'],
  supervisor: ['a5555555-5555-4555-8555-555555555555', 'supervisor@example.com'],
  consulta: ['99999999-9999-4999-8999-999999999999', 'consulta@example.com']
};

const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const POSITION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IDEMPOTENCY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const IDEMPOTENCY_ACTIVE_ID = 'e1111111-1111-4111-8111-111111111111';

const baselineSchema = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select jsonb_build_object('email', current_setting('request.jwt.claim.email', true))
  $$;

  create table public.coi_ordenes(
    id uuid primary key, nro_oc text not null, id_obra text, tipo text,
    tipo_trabajo text, especialidad text, descripcion text, proveedor text,
    estacion text, ramal text, sector text, expediente text,
    monto_total numeric(20,2), moneda text, fecha_acta_inicio date,
    plazo_dias integer, fecha_vencimiento date, proxima_certificacion date,
    fecha_recepcion_documentacion date, fecha_envio_planificacion date,
    estado_coi text, estado_documental text, estado_registro text,
    observaciones text, certificable_con_saldo boolean,
    justificacion_administrativa text, link_documental_principal text,
    estado_link_documental text, calidad_datos_estado text,
    calidad_datos_score numeric, prioridad_operativa text,
    responsable_coi text, fecha_ultimo_control date, requiere_accion boolean,
    motivo_requiere_accion text, estado_envio_pyc text,
    fecha_cierre_operativo date, observacion_cierre text,
    control_terceros_hasta date, control_terceros_estado text,
    actualizado_por uuid, fecha_actualizacion timestamptz
  );
  create table public.coi_ordenes_estaciones(
    id uuid primary key,
    orden_id uuid not null references public.coi_ordenes(id),
    estacion text, ramal text, sector text,
    es_principal boolean not null default false
  );
  create table public.coi_posiciones_oc(
    id uuid primary key,
    orden_id uuid not null references public.coi_ordenes(id),
    nro_oc text not null, posicion text not null, descripcion text,
    cantidad_total numeric(20,6) not null default 0, unidad_medida text,
    precio_unitario numeric(20,6) not null default 0,
    monto_total numeric(20,2) not null default 0, moneda text, remito text,
    observaciones text, usuario_email text, origen_carga text,
    cantidad_consumida numeric(20,6) not null default 0,
    monto_consumido numeric(20,2) not null default 0,
    cantidad_disponible numeric(20,6) not null default 0,
    monto_disponible numeric(20,2) not null default 0,
    estado text not null default 'LIBRE'
  );
  create table public.coi_certificaciones(id uuid primary key, orden_id uuid, nro_oc text);
  create table public.coi_documentos_oc(id uuid primary key, orden_id uuid, nro_oc text);
  create table public.coi_timeline_events(id text primary key, orden_id uuid, nro_oc text);
  create table public.coi_auditorias_calidad(id uuid primary key);
  create table public.coi_auditoria_global(id uuid primary key, usuario_id uuid);
  create table public.coi_sesiones(id uuid primary key, usuario_id uuid, estado text);
  create table public.coi_documentos_versiones(id uuid primary key, orden_id uuid, nro_oc text);
  create table public.coi_security_health_checks(id uuid primary key);
`;

async function setUser(db, role) {
  const [id, email] = USERS[role];
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claim.email',$1,false)", [email]);
}

async function expectDenied(promise, label) {
  await assert.rejects(promise, /COI_ROLE_REQUIRED|permission denied|row-level security/i, label);
}

async function main() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  try {
    await db.exec(baselineSchema);
    const migrations = fs.readdirSync('supabase/migrations')
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of migrations) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
      if (file.includes('0001')) {
        const userValues = Object.entries(USERS)
          .map(([role, [id, email]]) => `('${id}','${email}','${role}')`)
          .join(',');
        await db.exec(`
          insert into auth.users(id,email)
          select id::uuid,email from (values ${userValues}) source(id,email,rol);
          insert into public.profiles(id,email,rol,activo)
          select id::uuid,email,rol,true from (values ${userValues}) source(id,email,rol);
          insert into public.coi_ordenes(
            id,nro_oc,id_obra,estacion,ramal,sector,monto_total,moneda
          ) values (
            '${ORDER_ID}','4530008964','OB-1','Banfield','Roca','Andenes',1000,'ARS'
          );
          insert into public.coi_ordenes_estaciones(
            id,orden_id,estacion,ramal,sector,es_principal
          ) values (
            '${STATION_ID}','${ORDER_ID}','Banfield','Roca','Andenes',true
          );
          insert into public.coi_posiciones_oc(
            id,orden_id,nro_oc,posicion,descripcion,cantidad_total,
            precio_unitario,monto_total,moneda,cantidad_consumida,monto_consumido
          ) values (
            '${POSITION_ID}','${ORDER_ID}','4530008964','160.10','MTO',10,100,1000,'ARS',0,0
          );
        `);
        await setUser(db, 'administrador');
        const preflight = (await db.query('select public.coi_preflight_integridad() as result')).rows[0].result;
        assert.equal(preflight.ordenes_nro_oc_duplicado, 0);
        assert.equal(preflight.posiciones_duplicadas, 0);
        assert.equal(preflight.estaciones_asociadas_duplicadas, 0);
      }
    }

    // Reaplicar la cadena completa prueba la idempotencia DDL/DML declarada.
    for (const file of migrations) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }

    await db.exec('set role authenticated');
    await setUser(db, 'administrador');

    // Los helpers y las versiones sustituidas no son API publicas.
    await assert.rejects(db.query('select public.coi_sync_order_balance($1::uuid)', [ORDER_ID]), /permission denied/i);
    await assert.rejects(
      db.query("select * from public.coi_certificar_posiciones('[]'::jsonb,$1::uuid,'{}'::jsonb)", [IDEMPOTENCY_ID]),
      /permission denied/i
    );
    await assert.rejects(
      db.query("select public.coi_confirmar_etapa_circuito($1::uuid,'ejecucion',null)", [ORDER_ID]),
      /permission denied/i
    );

    // Ni siquiera administrador puede saltar las RPC para mutar ordenes/estaciones.
    await assert.rejects(
      db.query("update public.coi_ordenes set proveedor='BYPASS' where id=$1", [ORDER_ID]),
      /permission denied/i
    );
    await assert.rejects(
      db.query("update public.coi_ordenes_estaciones set estacion='BYPASS' where id=$1", [STATION_ID]),
      /permission denied/i
    );
    await assert.rejects(
      db.query('delete from public.coi_ordenes where id=$1', [ORDER_ID]),
      /permission denied/i
    );

    // Ledger: commit unico, reintento idempotente y alcance por usuario.
    const firstPayload = JSON.stringify([{
      posicion_id: POSITION_ID,
      cantidad: 2,
      monto: 200,
      acta_nro: '1'
    }]);
    await db.query(
      'select * from public.coi_certificar_posiciones_v2($1::jsonb,$2::uuid,$3::jsonb)',
      [firstPayload, IDEMPOTENCY_ID, '{}']
    );
    await db.query(
      'select * from public.coi_certificar_posiciones_v2($1::jsonb,$2::uuid,$3::jsonb)',
      [firstPayload, IDEMPOTENCY_ID, '{}']
    );
    assert.equal((await db.query('select count(*)::int as n from public.coi_consumos_posicion')).rows[0].n, 1);
    let balance = (await db.query(`
      select cantidad_consumida::float8 as q, monto_consumido::float8 as m,
             cantidad_disponible::float8 as aq, monto_disponible::float8 as am
        from public.coi_posiciones_oc where id=$1
    `, [POSITION_ID])).rows[0];
    assert.deepEqual(balance, { q: 2, m: 200, aq: 8, am: 800 });

    await assert.rejects(
      db.query(
        'select * from public.coi_certificar_posiciones_v2($1::jsonb,$2::uuid,$3::jsonb)',
        [JSON.stringify([{ posicion_id: POSITION_ID, cantidad: 3, monto: 300 }]), IDEMPOTENCY_ID, '{}']
      ),
      /COI_IDEMPOTENCY_SCOPE_CONFLICT/
    );
    await setUser(db, 'jefatura');
    await assert.rejects(
      db.query(
        'select * from public.coi_certificar_posiciones_v2($1::jsonb,$2::uuid,$3::jsonb)',
        [firstPayload, IDEMPOTENCY_ID, '{}']
      ),
      /COI_IDEMPOTENCY_SCOPE_CONFLICT/
    );
    await setUser(db, 'administrador');

    const firstLedgerId = (await db.query('select id from public.coi_consumos_posicion limit 1')).rows[0].id;
    await db.query(
      'select public.coi_actualizar_consumo_posicion($1::uuid,$2::jsonb)',
      [firstLedgerId, JSON.stringify({ periodo: 'AGO-2026', acta_nro: '1' })]
    );
    await db.query(
      'select public.coi_anular_consumo_posicion($1::uuid,$2::text)',
      [firstLedgerId, 'Correccion de prueba']
    );
    balance = (await db.query(`
      select cantidad_consumida::float8 as q, monto_consumido::float8 as m,
             cantidad_disponible::float8 as aq, monto_disponible::float8 as am
        from public.coi_posiciones_oc where id=$1
    `, [POSITION_ID])).rows[0];
    assert.deepEqual(balance, { q: 0, m: 0, aq: 10, am: 1000 });

    const activePayload = JSON.stringify([{ posicion_id: POSITION_ID, cantidad: 6, monto: 600 }]);
    await db.query(
      'select * from public.coi_certificar_posiciones_v2($1::jsonb,$2::uuid,$3::jsonb)',
      [activePayload, IDEMPOTENCY_ACTIVE_ID, '{}']
    );
    await assert.rejects(
      db.query(
        'select public.coi_guardar_orden_integral($1::uuid,$2::jsonb)',
        [ORDER_ID, JSON.stringify({ monto_total: 500 })]
      ),
      /COI_ORDER_AMOUNT_BELOW_CONSUMED/
    );
    assert.equal((await db.query('select monto_total::float8 as total from public.coi_ordenes where id=$1', [ORDER_ID])).rows[0].total, 1000);

    // Edicion de orden y espejo de estacion principal bajo el mismo commit.
    const orderUpdate = (await db.query(
      'select public.coi_guardar_orden_integral($1::uuid,$2::jsonb) as result',
      [ORDER_ID, JSON.stringify({ estacion: 'Lomas de Zamora', ramal: 'Roca Sur' })]
    )).rows[0].result;
    assert.equal(orderUpdate.accion, 'updated');
    assert.deepEqual((await db.query(`
      select estacion,ramal from public.coi_ordenes_estaciones
       where orden_id=$1 and es_principal
    `, [ORDER_ID])).rows[0], { estacion: 'Lomas de Zamora', ramal: 'Roca Sur' });

    // Identidad de posiciones: nro_oc autoritativo y campos clave inmutables.
    const freePositionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await db.query(`
      insert into public.coi_posiciones_oc(
        id,orden_id,nro_oc,posicion,descripcion,cantidad_total,
        precio_unitario,monto_total,moneda
      ) values ($1,$2,'OC-FORJADA','170,10','LIBRE',1,50,50,'ARS')
    `, [freePositionId, ORDER_ID]);
    assert.deepEqual((await db.query(
      'select nro_oc,posicion from public.coi_posiciones_oc where id=$1', [freePositionId]
    )).rows[0], { nro_oc: '4530008964', posicion: '170.10' });
    await assert.rejects(
      db.query("update public.coi_posiciones_oc set posicion='999.99' where id=$1", [freePositionId]),
      /COI_POSITION_IDENTITY_IMMUTABLE/
    );
    const freeDeletion = (await db.query(
      'select public.coi_eliminar_posiciones_sin_movimientos($1::uuid[]) as result',
      [[freePositionId]]
    )).rows[0].result;
    assert.equal(freeDeletion.count, 1);

    // Estaciones asociadas: alta/edicion/cambio principal/eliminacion atomicos.
    const addedStation = (await db.query(
      'select public.coi_guardar_estacion_asociada($1::uuid,null,$2::jsonb) as result',
      [ORDER_ID, JSON.stringify({ estacion: 'Temperley', ramal: 'Roca', sector: 'Taller', tipo_alcance: 'Secundaria' })]
    )).rows[0].result.estacion;
    const stationUpdated = (await db.query(
      'select public.coi_guardar_estacion_asociada($1::uuid,$2::uuid,$3::jsonb) as result',
      [ORDER_ID, addedStation.id, JSON.stringify({ estacion: 'Temperley', sector: 'Deposito' })]
    )).rows[0].result.estacion;
    assert.equal(stationUpdated.sector, 'Deposito');
    await db.query(
      'select public.coi_marcar_estacion_principal($1::uuid,$2::uuid)',
      [ORDER_ID, addedStation.id]
    );
    assert.equal((await db.query(`
      select count(*)::int as n from public.coi_ordenes_estaciones
       where orden_id=$1 and es_principal
    `, [ORDER_ID])).rows[0].n, 1);
    assert.equal((await db.query('select estacion from public.coi_ordenes where id=$1', [ORDER_ID])).rows[0].estacion, 'Temperley');
    await db.query(
      'select public.coi_guardar_estacion_asociada($1::uuid,$2::uuid,$3::jsonb)',
      [ORDER_ID, addedStation.id, JSON.stringify({ estacion: 'Temperley Este' })]
    );
    assert.equal((await db.query('select estacion from public.coi_ordenes where id=$1', [ORDER_ID])).rows[0].estacion, 'Temperley Este');
    await assert.rejects(
      db.query('select public.coi_eliminar_estacion_asociada($1::uuid)', [addedStation.id]),
      /COI_CANNOT_DELETE_PRINCIPAL_STATION/
    );
    await db.query(
      'select public.coi_marcar_estacion_principal($1::uuid,$2::uuid)',
      [ORDER_ID, STATION_ID]
    );
    await db.query('select public.coi_eliminar_estacion_asociada($1::uuid)', [addedStation.id]);

    // Circuito: reintento no duplica; volver a una etapa antigua si deja traza.
    const circuit = (await db.query(
      'select public.coi_confirmar_etapa_circuito_v2($1::uuid,$2::text,$3::text) as result',
      [ORDER_ID, 'ejecucion', 'Confirmacion de prueba']
    )).rows[0].result;
    assert.equal(circuit.ya_confirmada, false);
    assert.equal(circuit.historial.length, 2);
    const retry = (await db.query(
      'select public.coi_confirmar_etapa_circuito_v2($1::uuid,$2::text,$3::text) as result',
      [ORDER_ID, 'ejecucion', 'No debe duplicar']
    )).rows[0].result;
    assert.equal(retry.ya_confirmada, true);
    assert.equal(retry.historial.length, 0);
    await db.query(
      'select public.coi_confirmar_etapa_circuito_v2($1::uuid,$2::text,$3::text)',
      [ORDER_ID, 'finalizada', null]
    );
    const reentry = (await db.query(
      'select public.coi_confirmar_etapa_circuito_v2($1::uuid,$2::text,$3::text) as result',
      [ORDER_ID, 'ejecucion', 'Reingreso operativo']
    )).rows[0].result;
    assert.equal(reentry.ya_confirmada, false);
    assert.equal(reentry.historial.length, 2);
    assert.equal((await db.query(`
      select count(*)::int as n from public.coi_historial_oc
       where orden_id=$1 and tipo_evento='Circuito administrativo' and campo_modificado='ejecucion'
    `, [ORDER_ID])).rows[0].n, 2);

    // Links documentales siguen siendo atomicos y conservan un solo principal.
    const firstLink = (await db.query(
      'select public.coi_guardar_link_documental($1::uuid,$2::text,$3::jsonb) as result',
      [ORDER_ID, null, JSON.stringify({
        tipo_link: 'Carpeta OneDrive', titulo: 'Carpeta principal',
        url: 'https://example.com/uno', estado: 'Validado', es_principal: true
      })]
    )).rows[0].result;
    assert.equal(firstLink.documental.estado, 'Validado');
    const secondLink = (await db.query(
      'select public.coi_guardar_link_documental($1::uuid,$2::text,$3::jsonb) as result',
      [ORDER_ID, null, JSON.stringify({
        tipo_link: 'Expediente', titulo: 'Expediente',
        url: 'https://example.com/dos', estado: 'Cargado', es_principal: true
      })]
    )).rows[0].result;
    assert.equal((await db.query(`
      select count(*)::int as n from public.coi_links_documentales
       where orden_id=$1 and es_principal
    `, [ORDER_ID])).rows[0].n, 1);
    const deletedLink = (await db.query(
      'select public.coi_eliminar_link_documental($1::text) as result', [secondLink.link.id]
    )).rows[0].result;
    assert.equal(deletedLink.documental.estado, 'Incompleto');

    // Historial critico no se puede forjar; observaciones validas se normalizan.
    await assert.rejects(
      db.query(`insert into public.coi_historial_oc(
        orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,creado_por
      ) values ($1,'4530008964','Circuito administrativo','finalizada','Forjado',$2)`, [ORDER_ID, USERS.administrador[0]]),
      /row-level security|permission denied/i
    );
    await db.query(`insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,creado_por
    ) values ($1,'OC-INCORRECTA','Observacion circuito administrativo','ejecucion','Observacion valida',$2)`, [ORDER_ID, USERS.administrador[0]]);
    assert.deepEqual((await db.query(`
      select nro_oc,usuario_email from public.coi_historial_oc
       where orden_id=$1 and valor_nuevo='Observacion valida'
    `, [ORDER_ID])).rows[0], { nro_oc: '4530008964', usuario_email: 'admin@example.com' });

    // Alta canonica: crea principal, y otra grafia actualiza la misma OC.
    const created = (await db.query(
      'select public.coi_guardar_orden_integral(null,$1::jsonb) as result',
      [JSON.stringify({
        nro_oc: 'OC-453-000-8999', id_obra: 'OB-RC1', tipo: 'Obra',
        estacion: 'Adrogue', ramal: 'Roca', sector: 'Andenes',
        proveedor: 'Proveedor inicial', monto_total: 50, moneda: 'ARS'
      })]
    )).rows[0].result;
    const createdId = created.orden.id;
    assert.equal(created.orden.nro_oc, '4530008999');
    assert.equal((await db.query(`
      select count(*)::int as n from public.coi_ordenes_estaciones
       where orden_id=$1 and es_principal
    `, [createdId])).rows[0].n, 1);
    const canonicalRetry = (await db.query(
      'select public.coi_guardar_orden_integral(null,$1::jsonb) as result',
      [JSON.stringify({ nro_oc: 'Orden de Compra 4530008999', proveedor: 'Proveedor actualizado' })]
    )).rows[0].result;
    assert.equal(canonicalRetry.accion, 'updated');
    assert.equal(canonicalRetry.orden.id, createdId);
    assert.equal((await db.query(`
      select count(*)::int as n from public.coi_ordenes
       where nro_oc='4530008999'
    `)).rows[0].n, 1);
    await assert.rejects(db.query('delete from public.coi_ordenes where id=$1', [createdId]), /permission denied/i);
    const orderDeletion = (await db.query(
      'select public.coi_eliminar_orden_integral($1::uuid) as result', [createdId]
    )).rows[0].result;
    assert.equal(orderDeletion.deleted.id, createdId);
    assert.equal(orderDeletion.estaciones_eliminadas, 1);

    // Matriz automatizada de roles core.
    const mutatingRoles = ['administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'];
    for (const role of Object.keys(USERS)) {
      await setUser(db, role);
      assert.ok((await db.query('select count(*)::int as n from public.coi_ordenes')).rows[0].n >= 1, `${role} debe leer ordenes`);
      const update = db.query(
        'select public.coi_guardar_orden_integral($1::uuid,$2::jsonb)',
        [ORDER_ID, JSON.stringify({ observaciones: `actualizado por ${role}` })]
      );
      if (mutatingRoles.includes(role)) await update;
      else await expectDenied(update, `${role} no debe editar OC`);
    }

    for (const role of ['editor', 'planificacion', 'control', 'supervisor', 'consulta']) {
      await setUser(db, role);
      await expectDenied(
        db.query("select * from public.coi_certificar_posiciones_v2('[]'::jsonb,$1::uuid,'{}'::jsonb)", ['f0000000-0000-4000-8000-000000000001']),
        `${role} no debe certificar`
      );
    }

    const createdByRole = [];
    for (const [index, role] of ['jefatura', 'editor'].entries()) {
      await setUser(db, role);
      const nro = `45300091${index + 10}`;
      const result = (await db.query(
        'select public.coi_guardar_orden_integral(null,$1::jsonb) as result',
        [JSON.stringify({ nro_oc: nro, id_obra: `ROL-${role}`, estacion: 'Banfield', monto_total: 1, moneda: 'ARS' })]
      )).rows[0].result;
      createdByRole.push(result.orden.id);
    }
    for (const [index, role] of ['planificacion', 'control', 'supervisor', 'consulta'].entries()) {
      await setUser(db, role);
      await expectDenied(
        db.query(
          'select public.coi_guardar_orden_integral(null,$1::jsonb)',
          [JSON.stringify({ nro_oc: `45300092${index + 10}`, estacion: 'Banfield', monto_total: 1, moneda: 'ARS' })]
        ),
        `${role} no debe crear OC`
      );
    }

    await setUser(db, 'consulta');
    await expectDenied(
      db.query("select public.coi_confirmar_etapa_circuito_v2($1::uuid,'finalizada',null)", [ORDER_ID]),
      'consulta no debe mover circuito'
    );
    await expectDenied(
      db.query('select public.coi_eliminar_orden_integral($1::uuid)', [ORDER_ID]),
      'consulta no debe eliminar OC'
    );
    await assert.rejects(
      db.query(`insert into public.coi_sesiones(id,usuario_id,estado)
        values ('15151515-1515-4515-8515-151515151515',$1,'abierta')`, [USERS.administrador[0]]),
      /row-level security|permission denied/i
    );

    await setUser(db, 'administrador');
    for (const id of createdByRole) {
      await db.query('select public.coi_eliminar_orden_integral($1::uuid)', [id]);
    }
    await assert.rejects(
      db.query('select public.coi_eliminar_orden_integral($1::uuid)', [ORDER_ID]),
      /COI_ORDER_HAS_DEPENDENCIES/
    );

    console.log(
      `Runtime Supabase: ${migrations.length} migraciones reaplicables; ledger/idempotencia, ` +
      'saldos, RLS, roles, ordenes/estaciones, posiciones, circuito, links y borrado atomico aprobados.'
    );
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
