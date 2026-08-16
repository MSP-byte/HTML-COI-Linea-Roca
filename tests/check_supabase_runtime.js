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
const KEY1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const KEY2 = 'e1111111-1111-4111-8111-111111111111';

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

async function main() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  try {
    await db.exec(baselineSchema);
    const migrations = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
    for (const file of migrations) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
      if (file === '202608100001_preflight_reports.sql') {
        const values = Object.entries(USERS).map(([role,[id,email]]) => `('${id}','${email}','${role}')`).join(',');
        await db.exec(`
          insert into auth.users(id,email)
          select id::uuid,email from (values ${values}) source(id,email,rol);
          insert into public.profiles(id,email,rol,activo)
          select id::uuid,email,rol,true from (values ${values}) source(id,email,rol);
          insert into public.coi_ordenes(id,nro_oc,id_obra,estacion,ramal,sector,monto_total,moneda)
          values ('${ORDER_ID}','4530008964','OB-1','Banfield','Roca','Andenes',1000,'ARS');
          insert into public.coi_ordenes_estaciones(id,orden_id,estacion,ramal,sector,es_principal)
          values ('${STATION_ID}','${ORDER_ID}','Banfield','Roca','Andenes',true);
          insert into public.coi_posiciones_oc(
            id,orden_id,nro_oc,posicion,descripcion,cantidad_total,precio_unitario,monto_total,moneda,
            cantidad_consumida,monto_consumido
          ) values ('${POSITION_ID}','${ORDER_ID}','4530008964','160.10','MTO',10,100,1000,'ARS',0,0);
        `);
      }
    }

    await db.exec('set role authenticated');
    await setUser(db, 'administrador');

    // Writer legacy permitido, pero trazado server-side.
    const legacy = await db.query("update public.coi_ordenes set proveedor='LEGACY OK' where id=$1 returning proveedor", [ORDER_ID]);
    assert.equal(legacy.rows[0].proveedor, 'LEGACY OK');
    assert.equal((await db.query("select count(*)::int n from public.coi_operaciones_auditoria where accion='ACTUALIZAR_ORDEN_DIRECTO_COMPAT'")).rows[0].n, 1);

    // Renumerar directamente sigue bloqueado: solo RPC auditable.
    await assert.rejects(
      db.query("update public.coi_ordenes set nro_oc='4530009999' where id=$1", [ORDER_ID]),
      /COI_RENUMBER_REQUIRES_RPC/
    );

    // Campos de links no pueden ser alterados por roles fuera del circuito documental.
    await setUser(db, 'planificacion');
    await assert.rejects(
      db.query("update public.coi_ordenes set link_documental_principal='https://example.com' where id=$1", [ORDER_ID]),
      /COI_LINK_ROLE_REQUIRED/
    );
    await setUser(db, 'administrador');

    // RPC genérica sigue funcionando para campos allowlisted.
    const updated = (await db.query(
      'select public.coi_actualizar_orden_integral($1::uuid,$2::jsonb) result',
      [ORDER_ID, JSON.stringify({ proxima_certificacion: '2026-09-15' })]
    )).rows[0].result;
    assert.equal(updated.orden.proxima_certificacion, '2026-09-15');

    // Primer commit financiero.
    const payload = JSON.stringify([{
      posicion_id: POSITION_ID,
      cantidad: 2,
      monto: 200,
      remito: 'R-1',
      periodo: 'AGO-2026',
      observaciones: 'runtime recovery'
    }]);
    const first = await db.query(
      'select * from public.coi_certificar_posiciones_v2($1::jsonb,$2::uuid,$3::jsonb)',
      [payload, KEY1, JSON.stringify({ origen: 'runtime' })]
    );
    assert.equal(first.rows.length, 1);

    // Simula pérdida de respuesta + logout: nueva key, mismo usuario/solicitud.
    // Debe recuperar el ledger anterior, no crear un segundo consumo.
    const recovered = await db.query(
      'select * from public.coi_certificar_posiciones_v2($1::jsonb,$2::uuid,$3::jsonb)',
      [payload, KEY2, JSON.stringify({ origen: 'runtime-relogin' })]
    );
    assert.equal(recovered.rows.length, 1);
    assert.equal(recovered.rows[0].id, first.rows[0].id);
    assert.equal((await db.query('select count(*)::int n from public.coi_consumos_posicion')).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from public.coi_operaciones_auditoria where accion='RECONCILIAR_CERTIFICACION_IDEMPOTENTE'")).rows[0].n, 1);

    // Renumeración RPC conserva UUID y sincroniza hijo moderno.
    const renumber = (await db.query(
      "select public.coi_renumerar_oc($1::uuid,'4530009999','runtime') result",
      [ORDER_ID]
    )).rows[0].result;
    assert.equal(renumber.nro_oc_nuevo, '4530009999');
    assert.equal((await db.query('select nro_oc from public.coi_posiciones_oc where id=$1', [POSITION_ID])).rows[0].nro_oc, '4530009999');

    console.log('Runtime Supabase RC2: writers legacy contenidos, recuperación idempotente y renumeración consistente: PASS');
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
