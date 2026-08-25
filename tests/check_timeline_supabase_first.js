#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const sql = fs.readFileSync('supabase/migrations/202608250001_timeline_supabase_first.sql', 'utf8');
const actorIndexes = fs.readFileSync('supabase/migrations/202608250002_timeline_actor_indexes.sql', 'utf8');

for (const pattern of [
  /const TIMELINE_TABLE='coi_timeline_events'/,
  /const TIMELINE_MIGRATION_KEY='coi_timeline_supabase_migrated_v1'/,
  /async function fetchTimelineEventsSupabase/,
  /\.range\(from,from\+TIMELINE_PAGE_SIZE-1\)/,
  /\.upsert\(payload,\{onConflict:'id'\}\)\.select\(TIMELINE_DB_SELECT\)/,
  /\.delete\(\)\.eq\('id',id\)\.select\('id'\)/,
  /async function saveForm/,
  /async function importTimelineEvents/,
  /await initializeStore\(\)/,
  /Se eliminará el registro compartido de Supabase/,
  /Supabase es la fuente de verdad/
]) assert.match(html, pattern);

assert.doesNotMatch(html, /function saveEvents\(/);
assert.doesNotMatch(html, /window\.coiTimelineEvents=loadEvents\(\)/);
assert.doesNotMatch(html, /saveTimelineEventsSupabaseLegacyDisabled/);
assert.doesNotMatch(html, /Se conserva localStorage/);

for (const pattern of [
  /create table if not exists public\.coi_timeline_events/,
  /enable row level security/i,
  /coi_timeline_audit_row/,
  /coi_timeline_sync_order_number/,
  /coi_timeline_fecha_idx/,
  /coi_timeline_nro_oc_idx/
]) assert.match(sql, pattern);
assert.match(actorIndexes, /coi_timeline_created_by_idx/);
assert.match(actorIndexes, /coi_timeline_updated_by_idx/);

console.log('Timeline/Mailing Supabase-first: carga, CRUD, migración local y contrato SQL verificados.');
