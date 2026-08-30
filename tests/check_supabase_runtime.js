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
  administrador: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin@coiroca.com'],
  jefatura: ['a1111111-1111-4111-8111-111111111111', 'jefatura@example.com'],
  editor: ['a2222222-2222-4222-8222-222222222222', 'editor@example.com'],
  planificacion: ['a3333333-3333-4333-8333-333333333333', 'planificacion@example.com'],
  control: ['a4444444-4444-4444-8444-444444444444', 'control@example.com'],
  supervisor: ['a5555555-5555-4555-8555-555555555555', 'supervisor@example.com'],
  consulta: ['99999999-9999-4999-8999-999999999999', 'consulta@coiroca.com']
};
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const POSITION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const KEY2 = 'e1111111-1111-4111-8111-111111111111';

// Solo los prerequisitos que Supabase provee de fabrica. El esquema de aplicacion
// lo crea ahora 202608090000_core_schema_baseline.sql, de modo que este control
// ejercita las migraciones reales en lugar de un andamiaje propio.
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
      // Las columnas de consumo las agrega el ledger financiero: los fixtures se
      // siembran recien despues de esa migracion.
      if (file === '202608100002_financial_ledger.sql') {
        const values = Object.entries(USERS).map(([role,[id,email]]) => `('${id}','${email}','${role}')`).join(',');
        await db.exec(`
          insert into auth.users(id,email)
          select id::uuid,email from (values ${values}) source(id,email,rol);
          insert into public.profiles(id,email,rol,activo)
          select id::uuid,email,rol,true from (values ${values}) source(id,email,rol);
          insert into public.coi_ordenes(id,nro_oc,id_obra,tipo,estacion,ramal,sector,monto_total,moneda,estado_coi)
          values ('${ORDER_ID}','4530008964','OB-1','Obra','Banfield','Roca','Andenes',1000,'ARS','OBRA/SERVICIO EN EJECUCIÓN');
          insert into public.coi_ordenes_estaciones(id,orden_id,nro_oc,estacion,ramal,sector,es_principal)
          values ('${STATION_ID}','${ORDER_ID}','4530008964','Banfield','Roca','Andenes',true);
          insert into public.coi_posiciones_oc(
            id,orden_id,nro_oc,posicion,descripcion,cantidad_total,precio_unitario,monto_total,moneda,
            cantidad_consumida,monto_consumido
          ) values ('${POSITION_ID}','${ORDER_ID}','4530008964','160.10','MTO',10,100,1000,'ARS',0,0);
        `);
      }
    }

    await db.exec('set role authenticated');
    await setUser(db, 'administrador');

    // Timeline/Mailing: CRUD compartido, lectura por consulta y auditoría.
    const timelineConstraints = await db.query(`
      select count(*)::int n from pg_constraint
       where conrelid='public.coi_timeline_events'::regclass
         and conname in ('coi_timeline_id_required','coi_timeline_title_required','coi_timeline_status_valid','coi_timeline_risk_valid')
    `);
    assert.equal(timelineConstraints.rows[0].n, 4);

    const invalidAtomicBatch = JSON.stringify([
      { id: 'TL-ATOMIC-ROLLBACK-1', fecha: '2026-08-25', titulo: 'Debe revertirse', estado: 'Informativo', riesgo: 'Bajo' },
      { id: 'TL-ATOMIC-ROLLBACK-2', fecha: '2026-08-25', titulo: 'Inválido', estado: 'Informativo', riesgo: 'RIESGO_INVALIDO' }
    ]);
    await assert.rejects(
      db.query('select id from public.coi_timeline_upsert_events($1::jsonb)', [invalidAtomicBatch]),
      /coi_timeline_risk_valid|check constraint/i
    );
    assert.equal((await db.query("select count(*)::int n from public.coi_timeline_events where id like 'TL-ATOMIC-ROLLBACK-%'")).rows[0].n, 0);

    const validAtomicBatch = JSON.stringify([
      { id: 'TL-ATOMIC-1', fecha: '2026-08-25', titulo: 'Lote atómico 1', estado: 'Informativo', riesgo: 'Bajo' },
      { id: 'TL-ATOMIC-2', fecha: '2026-08-25', titulo: 'Lote atómico 2', estado: 'En revisión', riesgo: 'Medio' }
    ]);
    const atomicRows = await db.query('select id from public.coi_timeline_upsert_events($1::jsonb) order by id', [validAtomicBatch]);
    assert.deepEqual(atomicRows.rows.map(row => row.id), ['TL-ATOMIC-1', 'TL-ATOMIC-2']);

    const firstPage = await db.query(
      'select id,fecha,hora from public.coi_timeline_list_page(null,null,null,1)'
    );
    const cursor = firstPage.rows[0];
    const secondPage = await db.query(
      'select id from public.coi_timeline_list_page($1::date,$2::time,$3::text,1)',
      [cursor.fecha, cursor.hora, cursor.id]
    );
    assert.equal(firstPage.rows.length, 1);
    assert.equal(secondPage.rows.length, 1);
    assert.notEqual(firstPage.rows[0].id, secondPage.rows[0].id);

    const staleStamp = (await db.query(
      "select actualizado_en from public.coi_timeline_events where id='TL-ATOMIC-1'"
    )).rows[0].actualizado_en;
    await db.query(
      "update public.coi_timeline_events set titulo='Edición ganadora' where id='TL-ATOMIC-1'"
    );
    const stalePayload = JSON.stringify([{
      id: 'TL-ATOMIC-1', fecha: '2026-08-25', titulo: 'Edición obsoleta',
      estado: 'Informativo', riesgo: 'Bajo', expected_actualizado_en: staleStamp
    }]);
    await assert.rejects(
      db.query('select id from public.coi_timeline_upsert_events($1::jsonb)', [stalePayload]),
      /COI_TIMELINE_STALE_WRITE/
    );
    assert.equal((await db.query(
      "select titulo from public.coi_timeline_events where id='TL-ATOMIC-1'"
    )).rows[0].titulo, 'Edición ganadora');

    const timelineId = 'TL-RUNTIME-SUPABASE-FIRST';
    const insertedTimeline = await db.query(`
      insert into public.coi_timeline_events(
        id, orden_id, nro_oc, fecha, hora, titulo, tipo_evento, origen,
        estado, riesgo, descripcion, creado_por
      ) values (
        $1, $2, 'OC-IGNORADA', '2026-08-25', '09:30', 'Mailing runtime',
        'Mailing', 'Mailing', 'Informativo', 'Bajo', 'Prueba transaccional', 'QA'
      ) returning id, orden_id, nro_oc, semana, created_by
    `, [timelineId, ORDER_ID]);
    assert.equal(insertedTimeline.rows[0].nro_oc, '4530008964');
    assert.equal(insertedTimeline.rows[0].orden_id, ORDER_ID);
    assert.equal(insertedTimeline.rows[0].created_by, USERS.administrador[0]);
    assert.equal(insertedTimeline.rows[0].semana, '2026-W35');

    await setUser(db, 'consulta');
    assert.equal((await db.query('select count(*)::int n from public.coi_timeline_events where id=$1', [timelineId])).rows[0].n, 1);
    await assert.rejects(
      db.query(`insert into public.coi_timeline_events(id,fecha,titulo) values ('TL-CONSULTA-BLOCKED','2026-08-25','No autorizado')`),
      /row-level security|permission denied/i
    );
    await assert.rejects(
      db.query("select id from public.coi_timeline_upsert_events('[{\"id\":\"TL-CONSULTA-RPC\",\"fecha\":\"2026-08-25\",\"titulo\":\"No autorizado\"}]'::jsonb)"),
      /COI_ROLE_REQUIRED|permission denied/i
    );
    await assert.rejects(
      db.query("select id from public.coi_timeline_replace_events('[]'::jsonb)"),
      /COI_ROLE_REQUIRED|permission denied/i
    );

    await setUser(db, 'editor');
    const editedTimeline = await db.query(
      "update public.coi_timeline_events set estado='En revisión' where id=$1 returning estado,updated_by",
      [timelineId]
    );
    assert.equal(editedTimeline.rows[0].estado, 'En revisión');
    assert.equal(editedTimeline.rows[0].updated_by, USERS.editor[0]);
    const editorDelete = await db.query('delete from public.coi_timeline_events where id=$1 returning id', [timelineId]);
    assert.equal(editorDelete.rows.length, 0);

    await setUser(db, 'administrador');
    await db.exec('reset role');
    await db.exec('alter table public.coi_ordenes disable trigger coi_order_number_dependency_guard');
    await db.query("update public.coi_ordenes set nro_oc='4530008965' where id=$1", [ORDER_ID]);
    assert.equal((await db.query('select nro_oc from public.coi_timeline_events where id=$1', [timelineId])).rows[0].nro_oc, '4530008965');
    await db.query("update public.coi_ordenes set nro_oc='4530008964' where id=$1", [ORDER_ID]);
    assert.equal((await db.query('select nro_oc from public.coi_timeline_events where id=$1', [timelineId])).rows[0].nro_oc, '4530008964');
    await db.exec('alter table public.coi_ordenes enable trigger coi_order_number_dependency_guard');
    await db.exec('set role authenticated');
    await setUser(db, 'administrador');

    const deletedTimeline = await db.query('delete from public.coi_timeline_events where id=$1 returning id', [timelineId]);
    assert.equal(deletedTimeline.rows[0].id, timelineId);
    await db.query("delete from public.coi_timeline_events where id in ('TL-ATOMIC-1','TL-ATOMIC-2')");
    assert.equal((await db.query("select count(*)::int n from public.coi_operaciones_auditoria where entidad='coi_timeline_events' and registro_id=$1", [timelineId])).rows[0].n >= 4, true);

    const replaceSeed = JSON.stringify([
      { id: 'TL-REPLACE-OLD-1', fecha: '2026-08-25', titulo: 'Anterior 1', estado: 'Informativo', riesgo: 'Bajo' },
      { id: 'TL-REPLACE-OLD-2', fecha: '2026-08-25', titulo: 'Anterior 2', estado: 'Informativo', riesgo: 'Bajo' }
    ]);
    await db.query('select id from public.coi_timeline_upsert_events($1::jsonb)', [replaceSeed]);
    const exactRestoreStamp = '2026-08-26T12:34:56.000Z';
    const exactSnapshot = JSON.stringify([
      {
        id: 'TL-REPLACE-ONLY', fecha: '2026-08-26', titulo: 'Snapshot exacto',
        estado: 'Cerrado', riesgo: 'Bajo', actualizado_en: exactRestoreStamp
      }
    ]);
    const replaced = await db.query(
      'select id,actualizado_en from public.coi_timeline_replace_events($1::jsonb)',
      [exactSnapshot]
    );
    assert.deepEqual(replaced.rows.map(row => row.id), ['TL-REPLACE-ONLY']);
    assert.equal(new Date(replaced.rows[0].actualizado_en).toISOString(), exactRestoreStamp);
    assert.equal((await db.query('select count(*)::int n from public.coi_timeline_events')).rows[0].n, 1);
    await db.query("select id from public.coi_timeline_replace_events('[]'::jsonb)");
    assert.equal((await db.query('select count(*)::int n from public.coi_timeline_events')).rows[0].n, 0);

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

    console.log('Runtime Supabase RC2: writers legacy contenidos y recuperación idempotente server-side: PASS');
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
