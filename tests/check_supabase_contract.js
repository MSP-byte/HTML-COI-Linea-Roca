#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = 'supabase/migrations';
const names = {
  preflight: '202608100001_preflight_reports.sql',
  ledger: '202608100002_financial_ledger.sql',
  orders: '202608100003_atomic_order_update.sql',
  rls: '202608100004_rls_policies.sql',
  operations: '202608100005_operational_integrity.sql',
  hardening: '202608110006_release_candidate_hardening.sql',
  review: '202608160010_rc2_review_hardening.sql',
  timeline: '202608250001_timeline_supabase_first.sql',
  timelineIndexes: '202608250002_timeline_actor_indexes.sql',
  timelineAtomic: '202608250003_timeline_atomic_upsert.sql',
  timelineAtomicInvoker: '202608250004_timeline_atomic_upsert_invoker.sql'
};

const sql = {};
for (const [key, file] of Object.entries(names)) {
  const target = path.join(root, file);
  assert.ok(fs.existsSync(target), `Falta ${file}`);
  sql[key] = fs.readFileSync(target, 'utf8');
}
const html = fs.readFileSync('index.html', 'utf8');

// Preflight: solo lectura.
assert.doesNotMatch(sql.preflight, /\bdelete\s+from\b/i);
assert.doesNotMatch(sql.preflight, /\bupdate\s+public\.coi_/i);
assert.match(sql.preflight, /coi_preflight_integridad/);
assert.match(sql.preflight, /coi_normalize_order_number/);

// Ledger: idempotencia, inmutabilidad y anulacion trazada.
for (const pattern of [
  /coi_consumos_posicion/i, /idempotency_key/i, /coi_idempotency_requests/i,
  /COI_IDEMPOTENCY_CONFLICT/, /COI_DUPLICATE_POSITION_IN_BATCH/,
  /coi_anular_consumo_posicion/, /set estado = 'ANULADA'/,
  /coi_eliminar_posiciones_sin_movimientos/, /COI_POSITION_AMOUNT_BELOW_CONSUMED/
]) assert.match(sql.ledger, pattern);
assert.doesNotMatch(sql.ledger, /delete\s+from\s+public\.coi_consumos_posicion/i);

// Edicion de orden: RPC allowlisted y estacion principal atomica.
for (const pattern of [
  /coi_actualizar_orden_integral/, /jsonb_populate_record/,
  /COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD/, /coi_ordenes_sync_principal_station/,
  /COI_ORDER_REQUIRES_ONE_PRINCIPAL_STATION/
]) assert.match(sql.orders, pattern);

// RLS y privilegios core.
for (const table of ['profiles','coi_ordenes','coi_ordenes_estaciones','coi_posiciones_oc','coi_consumos_posicion','coi_operaciones_auditoria','coi_idempotency_requests']) {
  assert.match(sql.rls, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `Falta RLS para ${table}`);
}
assert.match(sql.rls, /as restrictive/i);
assert.match(sql.rls, /revoke insert, update, delete on public\.coi_consumos_posicion from authenticated/i);

// Operaciones administrativas y trazabilidad.
for (const pattern of [
  /coi_confirmar_etapa_circuito/, /coi_guardar_link_documental/,
  /coi_eliminar_link_documental/, /coi_eliminar_orden_integral/,
  /COI_ORDER_HAS_DEPENDENCIES/, /coi_links_documentales_principal_uq/,
  /coi_historial_enforce_order/
]) assert.match(sql.operations, pattern);
assert.doesNotMatch(sql.operations, /delete\s+from\s+public\.coi_consumos_posicion/i);

// RC1/RC2 hardening base.
for (const pattern of [
  /coi_ordenes_nro_oc_normalizado_uq/, /COI_ORDER_AMOUNT_BELOW_CONSUMED/,
  /COI_POSITION_IDENTITY_IMMUTABLE/, /coi_guardar_orden_integral/,
  /coi_certificar_posiciones_v2/, /COI_IDEMPOTENCY_SCOPE_CONFLICT/,
  /coi_confirmar_etapa_circuito_v2/, /REINGRESAR_ETAPA_CIRCUITO/
]) assert.match(sql.hardening, pattern);
assert.match(sql.hardening, /revoke insert, update, delete on public\.coi_ordenes from authenticated/i);

// Findings PR #27: hardening forward-only.
for (const pattern of [
  /coi_child_order_number_guard/,
  /for key share/i,
  /coi_order_number_dependency_guard/,
  /COI_ORDER_NUMBER_DEPENDENCY_COLLISION/,
  /coi_servicios_tecnicos_um/,
  /coi_eliminar_orden_integral/,
  /'renumeracion de oc'/i,
  /coi_actualizar_orden_integral/
]) assert.match(sql.review, pattern);
const updater = sql.review.slice(sql.review.indexOf('create or replace function public.coi_actualizar_orden_integral'));
assert.doesNotMatch(updater, /'link_documental_principal'|'estado_link_documental'/);

// Timeline/Mailing: tabla canónica, RLS por rol, auditoría y sincronización OC.
for (const pattern of [
  /create table if not exists public\.coi_timeline_events/,
  /orden_id uuid references public\.coi_ordenes/,
  /coi_timeline_prepare_row/,
  /coi_timeline_audit_row/,
  /TIMELINE_CREAR/,
  /coi_timeline_sync_order_number/,
  /coi_timeline_select_guard_v1/,
  /notify pgrst, 'reload schema'/
]) assert.match(sql.timeline, pattern);
assert.match(sql.timeline, /revoke all on function public\.coi_timeline_prepare_row\(\) from public, anon, authenticated/i);
assert.match(sql.timeline, /'administrador','jefatura','editor','planificacion','control','supervisor'/i);
assert.match(sql.timelineIndexes, /coi_timeline_created_by_idx/);
assert.match(sql.timelineIndexes, /coi_timeline_updated_by_idx/);
for (const pattern of [
  /coi_timeline_upsert_events/,
  /jsonb_to_recordset\(p_events\)/,
  /jsonb_array_length\(p_events\) > 5000/,
  /perform public\.coi_assert_role/,
  /security invoker/,
  /on conflict \(id\) do update/,
  /grant execute on function public\.coi_timeline_upsert_events\(jsonb\) to authenticated/
]) assert.match(sql.timelineAtomic, pattern);
assert.match(sql.timelineAtomicInvoker, /alter function public\.coi_timeline_upsert_events\(jsonb\) security invoker/);

// El frontend debe consumir las APIs sustitutas y no reabrir el DML financiero.
for (const pattern of [
  /client\.rpc\('coi_certificar_posiciones_v2'/,
  /client\.rpc\('coi_actualizar_consumo_posicion'/,
  /client\.rpc\('coi_anular_consumo_posicion'/,
  /client\.rpc\('coi_actualizar_orden_integral'/,
  /client\.rpc\('coi_eliminar_orden_integral'/,
  /\.rpc\('coi_confirmar_etapa_circuito_v2'/
]) assert.match(html, pattern);
assert.doesNotMatch(html, /\.rpc\('coi_guardar_link_documental'/);
assert.doesNotMatch(html, /\.rpc\('coi_eliminar_link_documental'/);
assert.doesNotMatch(html, /\.rpc\('coi_certificar_posiciones'/);
assert.doesNotMatch(html, /\.rpc\('coi_confirmar_etapa_circuito'/);
assert.doesNotMatch(html, /\.from\(ORDENES_TABLE\)\.update\(\{proxima_certificacion:/);
assert.match(html, /const CACHE_VERSION=2/);
assert.match(html, /financialMutations:'supabase-rpc-only'/);

for (const [name, body] of Object.entries(sql)) {
  assert.equal((body.match(/\$\$/g) || []).length % 2, 0, `${name}: delimitadores $$ desbalanceados`);
  assert.match(body, /^begin;/m, `${name}: falta BEGIN`);
  assert.match(body, /commit;\s*$/i, `${name}: falta COMMIT final`);
  assert.doesNotMatch(body, /service_role|password\s*=|secret\s*=/i, `${name}: posible secreto`);
}

console.log('Contrato Supabase: 11 migraciones auditadas; Timeline Supabase-first, RPC atómica, RLS e integridad verificados.');
