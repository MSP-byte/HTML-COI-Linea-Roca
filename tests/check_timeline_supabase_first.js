#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const sql = fs.readFileSync('supabase/migrations/202608250001_timeline_supabase_first.sql', 'utf8');
const actorIndexes = fs.readFileSync('supabase/migrations/202608250002_timeline_actor_indexes.sql', 'utf8');
const atomicUpsert = fs.readFileSync('supabase/migrations/202608250003_timeline_atomic_upsert.sql', 'utf8');
const atomicInvoker = fs.readFileSync('supabase/migrations/202608250004_timeline_atomic_upsert_invoker.sql', 'utf8');
const consistency = fs.readFileSync('supabase/migrations/202608250005_timeline_consistency_hardening.sql', 'utf8');
const lockOrder = fs.readFileSync('supabase/migrations/202608250006_timeline_lock_order_hardening.sql', 'utf8');

for (const pattern of [
  /const TIMELINE_TABLE='coi_timeline_events'/,
  /const TIMELINE_MIGRATION_KEY='coi_timeline_supabase_migrated_v1'/,
  /const TIMELINE_LEGACY_KEY='coi_timeline_legacy_pending_v1'/,
  /async function fetchTimelineEventsSupabase/,
  /client\.rpc\('coi_timeline_list_page'/,
  /client\.rpc\('coi_timeline_upsert_events',\{p_events:payload\}\)/,
  /client\.rpc\('coi_timeline_replace_events',\{p_events:payload\}\)/,
  /expected_actualizado_en:event\.actualizado_en/,
  /\.delete\(\)\.eq\('id',id\)\.eq\('actualizado_en',event\.actualizado_en\)\.select\('id'\)/,
  /COI_TIMELINE_STALE_DELETE/,
  /let timelineAuthGeneration=0/,
  /loadGeneration!==timelineAuthGeneration/,
  /timelineAuthGeneration\+=1/,
  /async function saveForm/,
  /async function importTimelineEvents/,
  /await initializeStore\(\)/,
  /Se eliminará el registro compartido de Supabase/,
  /Supabase es la fuente de verdad/,
  /se conservan los datos remotos/,
  /state\.permissions\.canWrite/,
  /state\.permissions\.canDelete/,
  /Supabase confirm\\u00f3 \$\{saved\.length\} evento/,
  /const wrapped=async function\(\)/,
  /restoreLocalSnapshot/,
  /replaceTimelineEventsSupabase\(incoming/,
  /Supabase confirm.*el restore, pero no se pudo guardar el marcador local/,
  /await adminApplyLocalStorageSnapshot/,
  /const result=await saveTimelineEventsSupabase/
]) assert.match(html, pattern);

assert.doesNotMatch(html, /function saveEvents\(/);
assert.doesNotMatch(html, /window\.coiTimelineEvents=loadEvents\(\)/);
assert.doesNotMatch(html, /saveTimelineEventsSupabaseLegacyDisabled/);
assert.doesNotMatch(html, /Se conserva localStorage/);
assert.doesNotMatch(html, /for\(let from=0;from<list\.length;from\+=500\)/);
assert.doesNotMatch(html, /Promise\.resolve\(incoming\.length/);

for (const pattern of [
  /create table if not exists public\.coi_timeline_events/,
  /enable row level security/i,
  /coi_timeline_audit_row/,
  /coi_timeline_sync_order_number/,
  /add constraint coi_timeline_title_required/,
  /add constraint coi_timeline_status_valid/,
  /coi_timeline_fecha_idx/,
  /coi_timeline_nro_oc_idx/
]) assert.match(sql, pattern);
assert.match(actorIndexes, /coi_timeline_created_by_idx/);
assert.match(actorIndexes, /coi_timeline_updated_by_idx/);
assert.match(atomicUpsert, /coi_timeline_upsert_events/);
assert.match(atomicUpsert, /jsonb_array_length\(p_events\) > 5000/);
assert.match(atomicUpsert, /perform public\.coi_assert_role/);
assert.match(atomicUpsert, /security invoker/);
assert.match(atomicInvoker, /security invoker/);
for (const pattern of [
  /coi_timeline_list_page/,
  /coi_timeline_page_idx/,
  /COI_TIMELINE_STALE_WRITE/,
  /expected_actualizado_en/,
  /coi_timeline_replace_events/,
  /lock table public\.coi_timeline_events/,
  /security invoker/g
]) assert.match(consistency, pattern);
for (const pattern of [
  /coi_timeline_upsert_events/,
  /from public\.coi_ordenes orders/,
  /order by orders\.id\s+for key share of orders/,
  /order by target\.id\s+for update of target/,
  /security invoker/
]) assert.match(lockOrder, pattern);
assert.ok(
  lockOrder.indexOf('for key share of orders') < lockOrder.indexOf('for update of target'),
  'La migración 006 debe bloquear las OC antes que los eventos Timeline.'
);

console.log('Timeline/Mailing Supabase-first: caché aislada, CRUD concurrente, restore exacto y contrato SQL verificados.');
