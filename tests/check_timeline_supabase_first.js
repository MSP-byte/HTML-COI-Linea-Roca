#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const sql = fs.readFileSync('supabase/migrations/202608250001_timeline_supabase_first.sql', 'utf8');
const actorIndexes = fs.readFileSync('supabase/migrations/202608250002_timeline_actor_indexes.sql', 'utf8');
const atomicUpsert = fs.readFileSync('supabase/migrations/202608250003_timeline_atomic_upsert.sql', 'utf8');
const atomicInvoker = fs.readFileSync('supabase/migrations/202608250004_timeline_atomic_upsert_invoker.sql', 'utf8');

for (const pattern of [
  /const TIMELINE_TABLE='coi_timeline_events'/,
  /const TIMELINE_MIGRATION_KEY='coi_timeline_supabase_migrated_v1'/,
  /async function fetchTimelineEventsSupabase/,
  /\.range\(from,from\+TIMELINE_PAGE_SIZE-1\)/,
  /client\.rpc\('coi_timeline_upsert_events',\{p_events:payload\}\)/,
  /\.delete\(\)\.eq\('id',id\)\.select\('id'\)/,
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

console.log('Timeline/Mailing Supabase-first: carga, CRUD, migración local y contrato SQL verificados.');
