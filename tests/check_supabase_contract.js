#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = 'supabase/migrations';
const files = [
  '202608100001_preflight_reports.sql',
  '202608100002_financial_ledger.sql',
  '202608100003_atomic_order_update.sql',
  '202608100004_rls_policies.sql',
  '202608100005_operational_integrity.sql',
  '202608110006_release_candidate_hardening.sql'
];
for (const file of files) assert.ok(fs.existsSync(path.join(root, file)), `Falta ${file}`);

const preflight = fs.readFileSync(path.join(root, files[0]), 'utf8');
const ledger = fs.readFileSync(path.join(root, files[1]), 'utf8');
const orders = fs.readFileSync(path.join(root, files[2]), 'utf8');
const rls = fs.readFileSync(path.join(root, files[3]), 'utf8');
const operations = fs.readFileSync(path.join(root, files[4]), 'utf8');
const hardening = fs.readFileSync(path.join(root, files[5]), 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

assert.doesNotMatch(preflight, /\bdelete\s+from\b/i, 'El preflight no puede borrar datos');
assert.doesNotMatch(preflight, /\bupdate\s+public\.coi_/i, 'El preflight no puede modificar datos operativos');
assert.match(preflight, /coi_preflight_integridad/);
assert.match(preflight, /coi_normalize_order_number/);
assert.match(preflight, /estaciones_asociadas_duplicadas/);

assert.match(ledger, /create table if not exists public\.coi_consumos_posicion/i);
assert.match(ledger, /for update/gi);
assert.match(ledger, /idempotency_key/i);
assert.match(ledger, /coi_idempotency_requests/);
assert.match(ledger, /COI_IDEMPOTENCY_CONFLICT/);
assert.match(ledger, /COI_DUPLICATE_POSITION_IN_BATCH/);
assert.match(ledger, /coi_anular_consumo_posicion/);
assert.match(ledger, /set estado = 'ANULADA'/);
assert.doesNotMatch(ledger, /delete\s+from\s+public\.coi_consumos_posicion/i, 'El libro mayor no puede borrarse');
assert.match(ledger, /coi_eliminar_posiciones_sin_movimientos/);
assert.match(ledger, /coi_posiciones_oc_recompute_fields/);
assert.match(ledger, /COI_POSITION_AMOUNT_BELOW_CONSUMED/);

assert.match(orders, /coi_actualizar_orden_integral/);
assert.match(orders, /jsonb_populate_record/);
assert.match(orders, /COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD/);
assert.match(orders, /coi_ordenes_sync_principal_station/);
assert.match(orders, /COI_ORDER_REQUIRES_ONE_PRINCIPAL_STATION/);

for (const table of ['profiles','coi_ordenes','coi_ordenes_estaciones','coi_posiciones_oc','coi_consumos_posicion','coi_operaciones_auditoria','coi_idempotency_requests']) {
  assert.match(rls, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `Falta RLS para ${table}`);
}
assert.match(rls, /revoke insert, update, delete on public\.coi_consumos_posicion from authenticated/i);
assert.match(rls, /public\.coi_current_role\(\)/);
assert.match(rls, /as restrictive/i, 'Las políticas históricas no deben poder ampliar permisos');

assert.match(operations, /coi_confirmar_etapa_circuito/);
assert.match(operations, /coi_guardar_link_documental/);
assert.match(operations, /coi_eliminar_link_documental/);
assert.match(operations, /coi_eliminar_orden_integral/);
assert.match(operations, /COI_ORDER_HAS_DEPENDENCIES/);
assert.match(operations, /coi_links_documentales_principal_uq/);
assert.match(operations, /coi_historial_enforce_order/);
assert.match(operations, /'circuito administrativo', 'cambio de estado contractual', 'cambio de link documental'/);
assert.match(operations, /alter table public\.coi_historial_oc enable row level security/i);
assert.match(operations, /alter table public\.coi_links_documentales enable row level security/i);
assert.match(operations, /coi_optional_.*_guard_v2/);
assert.doesNotMatch(operations, /delete\s+from\s+public\.coi_consumos_posicion/i, 'El libro mayor tampoco puede borrarse desde operaciones');

assert.match(hardening, /coi_ordenes_nro_oc_normalizado_uq/);
assert.match(hardening, /COI_ORDER_AMOUNT_BELOW_CONSUMED/);
assert.match(hardening, /COI_POSITION_IDENTITY_IMMUTABLE/);
assert.match(hardening, /coi_guardar_orden_integral/);
assert.match(hardening, /coi_guardar_estacion_asociada/);
assert.match(hardening, /coi_marcar_estacion_principal/);
assert.match(hardening, /coi_eliminar_estacion_asociada/);
assert.match(hardening, /coi_certificar_posiciones_v2/);
assert.match(hardening, /COI_IDEMPOTENCY_SCOPE_CONFLICT/);
assert.match(hardening, /coi_confirmar_etapa_circuito_v2/);
assert.match(hardening, /REINGRESAR_ETAPA_CIRCUITO/);
assert.match(hardening, /revoke insert, update, delete on public\.coi_ordenes from authenticated/i);
assert.match(hardening, /revoke insert, update, delete on public\.coi_ordenes_estaciones from authenticated/i);
assert.match(hardening, /revoke all on function public\.coi_sync_order_balance\(uuid\) from public, anon, authenticated/i);

assert.match(html, /client\.rpc\('coi_certificar_posiciones_v2'/);
assert.match(html, /client\.rpc\('coi_actualizar_consumo_posicion'/);
assert.match(html, /client\.rpc\('coi_anular_consumo_posicion'/);
assert.match(html, /client\.rpc\('coi_eliminar_posiciones_sin_movimientos'/);
assert.match(html, /client\.rpc\('coi_actualizar_orden_integral'/);
assert.match(html, /client\.rpc\('coi_guardar_orden_integral'/);
assert.match(html, /client\.rpc\('coi_guardar_estacion_asociada'/);
assert.match(html, /client\.rpc\('coi_marcar_estacion_principal'/);
assert.match(html, /client\.rpc\('coi_eliminar_estacion_asociada'/);
assert.match(html, /client\.rpc\('coi_eliminar_orden_integral'/);
assert.match(html, /\.rpc\('coi_confirmar_etapa_circuito_v2'/);
assert.match(html, /\.rpc\('coi_guardar_link_documental'/);
assert.match(html, /\.rpc\('coi_eliminar_link_documental'/);
assert.doesNotMatch(html, /\.rpc\('coi_certificar_posiciones'/, 'El frontend no debe invocar la RPC financiera sustituida');
assert.doesNotMatch(html, /\.rpc\('coi_confirmar_etapa_circuito'/, 'El frontend no debe invocar la RPC de circuito sustituida');
assert.doesNotMatch(
  html,
  /\.from\((?:SUPABASE_TABLE|SUPABASE_STATIONS_TABLE|'coi_ordenes'|'coi_ordenes_estaciones')\)[\s\S]{0,220}?\.(?:insert|upsert|update|delete)\(/,
  'Ordenes y estaciones no pueden mutarse por DML directo desde el frontend'
);
assert.match(html, /const CACHE_VERSION=2/);
assert.match(html, /financialMutations:'supabase-rpc-only'/);

for (const [name, sql] of [['preflight', preflight], ['ledger', ledger], ['orders', orders], ['rls', rls], ['operations', operations], ['hardening', hardening]]) {
  assert.equal((sql.match(/\$\$/g) || []).length % 2, 0, `${name}: delimitadores $$ desbalanceados`);
  assert.match(sql, /^begin;/m, `${name}: falta BEGIN`);
  assert.match(sql, /commit;\s*$/i, `${name}: falta COMMIT final`);
  assert.doesNotMatch(sql, /service_role|password\s*=|secret\s*=/i, `${name}: posible secreto`);
}

console.log('Contrato Supabase: 6 migraciones, DML core cerrado, RPC v2, roles, ledger y RLS verificados.');
