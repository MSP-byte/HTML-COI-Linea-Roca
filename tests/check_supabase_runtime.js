#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const READER_ID = '99999999-9999-4999-8999-999999999999';
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const POSITION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IDEMPOTENCY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DELETE_ORDER_ID = '12121212-1212-4212-8212-121212121212';
const DELETE_STATION_ID = '13131313-1313-4313-8313-131313131313';

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

async function main(){
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  try{
    await db.exec(baselineSchema);
    const migrations = fs.readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort();
    for (const file of migrations){
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
      if (file.includes('0001')){
        await db.exec(`
          insert into auth.users values
            ('${ADMIN_ID}', 'admin@example.com'),
            ('${READER_ID}', 'reader@example.com');
          insert into public.profiles(id,email,rol,activo) values
            ('${ADMIN_ID}', 'admin@example.com', 'administrador', true),
            ('${READER_ID}', 'reader@example.com', 'consulta', true);
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
          select set_config('request.jwt.claim.sub','${ADMIN_ID}',false);
          select set_config('request.jwt.claim.email','admin@example.com',false);
        `);
        const preflight = await db.query('select public.coi_preflight_integridad() as result');
        assert.equal(preflight.rows[0].result.posiciones_duplicadas, 0);
      }
    }

    await db.exec('set role authenticated');
    const payload = JSON.stringify([{
      posicion_id: POSITION_ID,
      cantidad: 2,
      monto: 200,
      acta_nro: '1'
    }]);
    await db.query(
      'select * from public.coi_certificar_posiciones($1::jsonb,$2::uuid,$3::jsonb)',
      [payload, IDEMPOTENCY_ID, '{}']
    );
    await db.query(
      'select * from public.coi_certificar_posiciones($1::jsonb,$2::uuid,$3::jsonb)',
      [payload, IDEMPOTENCY_ID, '{}']
    );

    let balance = (await db.query(`
      select cantidad_consumida::float8 as q, monto_consumido::float8 as m,
             cantidad_disponible::float8 as aq, monto_disponible::float8 as am
        from public.coi_posiciones_oc where id=$1
    `, [POSITION_ID])).rows[0];
    assert.deepEqual(balance, { q: 2, m: 200, aq: 8, am: 800 });
    assert.equal((await db.query('select count(*)::int as n from public.coi_consumos_posicion')).rows[0].n, 1);

    await assert.rejects(
      db.query(
        'select * from public.coi_certificar_posiciones($1::jsonb,$2::uuid,$3::jsonb)',
        [JSON.stringify([{ posicion_id: POSITION_ID, cantidad: 3, monto: 300 }]), IDEMPOTENCY_ID, '{}']
      ),
      /COI_IDEMPOTENCY_CONFLICT/
    );

    const ledgerId = (await db.query('select id from public.coi_consumos_posicion limit 1')).rows[0].id;
    await db.query(
      'select public.coi_actualizar_consumo_posicion($1::uuid,$2::jsonb)',
      [ledgerId, JSON.stringify({ periodo: 'AGO-2026', acta_nro: '1' })]
    );
    await db.query(
      'select public.coi_anular_consumo_posicion($1::uuid,$2::text)',
      [ledgerId, 'Corrección de prueba']
    );
    balance = (await db.query(`
      select cantidad_consumida::float8 as q, monto_consumido::float8 as m,
             cantidad_disponible::float8 as aq, monto_disponible::float8 as am
        from public.coi_posiciones_oc where id=$1
    `, [POSITION_ID])).rows[0];
    assert.deepEqual(balance, { q: 0, m: 0, aq: 10, am: 1000 });

    await db.query(
      'select public.coi_actualizar_orden_integral($1::uuid,$2::jsonb)',
      [ORDER_ID, JSON.stringify({ estacion: 'Lomas de Zamora', ramal: 'Roca Sur' })]
    );
    const station = (await db.query(`
      select estacion,ramal from public.coi_ordenes_estaciones
       where orden_id=$1 and es_principal
    `, [ORDER_ID])).rows[0];
    assert.deepEqual(station, { estacion: 'Lomas de Zamora', ramal: 'Roca Sur' });

    const circuit = (await db.query(
      'select public.coi_confirmar_etapa_circuito($1::uuid,$2::text,$3::text) as result',
      [ORDER_ID, 'ejecucion', 'Confirmación de prueba']
    )).rows[0].result;
    assert.equal(circuit.nombre, 'OBRA/SERVICIO EN EJECUCIÓN');
    assert.equal(circuit.ya_confirmada, false);
    assert.equal(circuit.historial.length, 2);
    const circuitRetry = (await db.query(
      'select public.coi_confirmar_etapa_circuito($1::uuid,$2::text,$3::text) as result',
      [ORDER_ID, 'ejecucion', 'No debe duplicar']
    )).rows[0].result;
    assert.equal(circuitRetry.ya_confirmada, true);
    assert.equal(circuitRetry.historial.length, 0);
    assert.equal((await db.query(`
      select count(*)::int as n from public.coi_historial_oc
       where orden_id=$1 and tipo_evento='Circuito administrativo' and campo_modificado='ejecucion'
    `, [ORDER_ID])).rows[0].n, 1);

    const firstLink = (await db.query(
      'select public.coi_guardar_link_documental($1::uuid,$2::text,$3::jsonb) as result',
      [ORDER_ID, null, JSON.stringify({
        tipo_link: 'Carpeta OneDrive', titulo: 'Carpeta principal',
        url: 'https://example.com/uno', estado: 'Validado', es_principal: true
      })]
    )).rows[0].result;
    assert.equal(firstLink.documental.estado, 'Validado');
    assert.equal(firstLink.documental.url_principal, 'https://example.com/uno');

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
    assert.equal(secondLink.documental.url_principal, 'https://example.com/dos');
    const secondLinkId = secondLink.link.id;
    const deletedLink = (await db.query(
      'select public.coi_eliminar_link_documental($1::text) as result', [secondLinkId]
    )).rows[0].result;
    assert.equal(deletedLink.documental.estado, 'Incompleto');
    assert.equal(deletedLink.documental.url_principal, null);

    const freeId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await db.query(`
      insert into public.coi_posiciones_oc(
        id,orden_id,nro_oc,posicion,descripcion,cantidad_total,
        precio_unitario,monto_total,moneda
      ) values ($1,$2,'4530008964','170.10','LIBRE',1,50,50,'ARS')
    `, [freeId, ORDER_ID]);
    const deletion = (await db.query(
      'select public.coi_eliminar_posiciones_sin_movimientos($1::uuid[]) as result',
      [[freeId]]
    )).rows[0].result;
    assert.equal(deletion.count, 1);

    await assert.rejects(
      db.query(`insert into public.coi_consumos_posicion(
        posicion_id,orden_id,nro_oc,posicion,cantidad,monto,idempotency_key,creado_por
      ) values ($1,$2,'4530008964','160.10',1,100,$3,$4)`, [POSITION_ID, ORDER_ID, '12121212-1212-4212-8212-121212121212', ADMIN_ID]),
      /permission denied/
    );

    await assert.rejects(
      db.query(`insert into public.coi_links_documentales(
        orden_id,nro_oc,tipo_link,titulo,url,es_principal
      ) values ($1,'4530008964','Otro','Directo','https://example.com/directo',false)`, [ORDER_ID]),
      /permission denied/
    );
    await assert.rejects(
      db.query(`insert into public.coi_historial_oc(
        orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,creado_por
      ) values ($1,'4530008964','Circuito administrativo','finalizada','Forjado',$2)`, [ORDER_ID, ADMIN_ID]),
      /row-level security|permission denied/
    );
    await db.query(`insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,creado_por
    ) values ($1,'OC-INCORRECTA','Observación circuito administrativo','ejecucion','Observación válida',$2)`, [ORDER_ID, ADMIN_ID]);
    const normalizedHistory = (await db.query(`
      select nro_oc,usuario_email from public.coi_historial_oc
       where orden_id=$1 and valor_nuevo='Observación válida'
    `, [ORDER_ID])).rows[0];
    assert.deepEqual(normalizedHistory, { nro_oc: '4530008964', usuario_email: 'admin@example.com' });

    await assert.rejects(
      db.query('select public.coi_eliminar_orden_integral($1::uuid)', [ORDER_ID]),
      /COI_ORDER_HAS_DEPENDENCIES/
    );

    await db.query(`
      insert into public.coi_ordenes(id,nro_oc,id_obra,estacion,ramal,sector,monto_total,moneda)
      values ($1,'4530008999','OB-DELETE','Temperley','Roca','Andenes',50,'ARS')
    `, [DELETE_ORDER_ID]);
    await db.query(`
      insert into public.coi_ordenes_estaciones(id,orden_id,estacion,ramal,sector,es_principal)
      values ($1,$2,'Temperley','Roca','Andenes',true)
    `, [DELETE_STATION_ID, DELETE_ORDER_ID]);
    const orderDeletion = (await db.query(
      'select public.coi_eliminar_orden_integral($1::uuid) as result', [DELETE_ORDER_ID]
    )).rows[0].result;
    assert.equal(orderDeletion.deleted.id, DELETE_ORDER_ID);
    assert.equal(orderDeletion.estaciones_eliminadas, 1);
    assert.equal((await db.query('select count(*)::int as n from public.coi_ordenes where id=$1', [DELETE_ORDER_ID])).rows[0].n, 0);

    await db.exec(`
      select set_config('request.jwt.claim.sub','${READER_ID}',false);
      select set_config('request.jwt.claim.email','reader@example.com',false);
    `);
    await assert.rejects(
      db.query('select public.coi_actualizar_orden_integral($1::uuid,$2::jsonb)', [ORDER_ID, JSON.stringify({ proveedor: 'No autorizado' })]),
      /COI_ROLE_REQUIRED/
    );
    await assert.rejects(
      db.query('select public.coi_confirmar_etapa_circuito($1::uuid,$2::text,$3::text)', [ORDER_ID, 'finalizada', null]),
      /COI_ROLE_REQUIRED/
    );
    await assert.rejects(
      db.query(`insert into public.coi_certificaciones(id,orden_id,nro_oc)
        values ('14141414-1414-4414-8414-141414141414',$1,'4530008964')`, [ORDER_ID]),
      /row-level security|permission denied/
    );
    await assert.rejects(
      db.query(`insert into public.coi_sesiones(id,usuario_id,estado)
        values ('15151515-1515-4515-8515-151515151515',$1,'abierta')`, [ADMIN_ID]),
      /row-level security|permission denied/
    );

    console.log('Runtime Supabase: ledger, idempotencia, RLS core/legacy, circuito, links y borrado transaccional aprobados.');
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
