'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const root = path.join(__dirname, '..', 'supabase', 'migrations');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const must = (source, re, msg) => assert.match(source, re, msg);

const least = read('20261005231823_security_least_privilege_20261005.sql');
const surface = read('20261005231826_security_function_surface_20261005.sql');
const defaults = read('20261005231828_secure_function_defaults_20261005.sql');
const legacy = read('20261005232108_security_close_legacy_audit_rpc_20261005.sql');
const restoreTrigger = read('20261005232739_security_restore_trigger_helper_execute_20261005.sql');
const storage = read('20261005232832_security_storage_profile_guard_20261005.sql');
const privateAudit = read('20261005234000_security_private_direct_update_audit_helper_20261005.sql');
const restoreRole = read('20261005235000_security_restore_assert_role_definer_20261005.sql');

must(least, /revoke\s+truncate\s*,\s*references\s*,\s*trigger[\s\S]*?from\s+authenticated/i,
  'authenticated debe perder TRUNCATE/REFERENCES/TRIGGER');
must(least, /revoke\s+all\s+privileges[\s\S]*?from\s+anon/i,
  'anon debe quedar sin grants directos sobre datos COI/profiles');
must(least, /coi_alertas_revisadas[\s\S]*?coi_idempotency_requests[\s\S]*?coi_rpc_only_no_client_access/i,
  'tablas RPC-only deben quedar cerradas al cliente');
must(defaults, /alter\s+default\s+privileges[\s\S]*?revoke\s+execute\s+on\s+functions\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'funciones futuras deben nacer fail-closed');
must(surface, /coi_assert_role\(text\[\]\)[\s\S]*?security\s+invoker/i,
  'la migración intermedia debe explicitar el cambio de superficie');
must(restoreRole, /coi_assert_role\(text\[\]\)[\s\S]*?security\s+definer/i,
  'el estado final del guard de rol debe conservar SECURITY DEFINER compatible');
must(legacy, /coi_record_direct_order_update\(jsonb,jsonb\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'la RPC legacy debe cerrarse durante el hardening');
must(restoreTrigger, /grant\s+execute[\s\S]*?coi_record_direct_order_update\(jsonb,jsonb\)[\s\S]*?to\s+authenticated/i,
  'la reconciliación histórica debe preservar el trigger hasta migrarlo');
must(storage, /create\s+policy\s+coi_documentos_storage_select_guard[\s\S]*?as\s+restrictive/i,
  'Storage documental debe exigir perfil activo');
must(privateAudit, /coi_private\.record_direct_order_update[\s\S]*?security\s+definer/i,
  'el writer privilegiado de auditoría debe vivir en schema privado');
must(privateAudit, /public\.coi_record_direct_order_update\(jsonb,jsonb\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'la firma pública histórica debe quedar cerrada al final');

const DIST_DIR = path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO_URL = pathToFileURL(path.join(DIST_DIR, 'pgcrypto.tar.gz'));
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

async function main() {
  const db = new PGlite({ extensions: { pgcrypto: PGCRYPTO_URL } });
  await db.exec(PLATAFORMA);

  const files = fs.readdirSync(root).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      await db.exec(read(file));
    } catch (error) {
      try { await db.exec('rollback'); } catch {}
      throw new Error(`hardening: migración ${file} no reproducible: ${error.message}`);
    }
  }

  let q = await db.query(`
    select c.relname
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','p')
       and (c.relname like 'coi_%' or c.relname='profiles')
       and not c.relrowsecurity`);
  assert.deepEqual(q.rows, [], 'toda tabla COI/profiles expuesta debe tener RLS');

  q = await db.query(`
    select table_name, privilege_type
      from information_schema.table_privileges
     where table_schema='public' and grantee='anon'
       and (table_name like 'coi_%' or table_name='profiles')`);
  assert.deepEqual(q.rows, [], 'anon no debe conservar privilegios directos sobre tablas COI/profiles');

  q = await db.query(`
    select table_name, privilege_type
      from information_schema.table_privileges
     where table_schema='public' and grantee='authenticated'
       and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
       and (table_name like 'coi_%' or table_name='profiles')`);
  assert.deepEqual(q.rows, [], 'authenticated no debe tener privilegios estructurales');

  q = await db.query(`
    select p.proname
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef and p.proname like 'coi_%'
       and has_function_privilege('anon', p.oid, 'EXECUTE')`);
  assert.deepEqual(q.rows, [], 'anon no debe ejecutar funciones COI SECURITY DEFINER');

  q = await db.query(`
    select p.proname
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef and p.proname like 'coi_%'
       and not exists (
         select 1 from unnest(coalesce(p.proconfig,array[]::text[])) cfg
          where cfg like 'search_path=%'
       )`);
  assert.deepEqual(q.rows, [], 'toda función COI SECURITY DEFINER debe fijar search_path');

  q = await db.query(`
    select p.prosecdef,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where p.oid='public.coi_assert_role(text[])'::regprocedure`);
  assert.equal(q.rows.length, 1, 'debe existir coi_assert_role(text[])');
  assert.equal(q.rows[0].prosecdef, true, 'coi_assert_role debe terminar SECURITY DEFINER');
  assert.equal(q.rows[0].auth_exec, true, 'authenticated debe poder invocar el guard de rol');
  assert.equal(q.rows[0].anon_exec, false, 'anon no debe invocar el guard de rol');

  q = await db.query(`
    select has_function_privilege(
      'authenticated',
      'public.coi_record_direct_order_update(jsonb,jsonb)'::regprocedure,
      'EXECUTE'
    ) allowed`);
  assert.equal(q.rows[0].allowed, false, 'el helper público legacy de auditoría debe quedar cerrado');

  q = await db.query(`
    select p.prosecdef
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='coi_private' and p.proname='record_direct_order_update'`);
  assert.equal(q.rows.length, 1, 'debe existir el helper privado de auditoría');
  assert.equal(q.rows[0].prosecdef, true, 'el helper privado puede elevar sólo para escribir auditoría');

  q = await db.query(`
    select permissive
      from pg_policies
     where schemaname='public' and tablename='coi_alertas_revisadas'
       and policyname='coi_rpc_only_no_client_access'`);
  assert.equal(q.rows[0]?.permissive, 'RESTRICTIVE', 'la tabla RPC-only debe tener policy RESTRICTIVE');

  // PGlite aplica ALTER DEFAULT PRIVILEGES pero no materializa pg_default_acl.
  // Ese contrato se valida arriba sobre la migración; los privilegios efectivos
  // soportados por PGlite se verifican por catálogo en los bloques anteriores.


  console.log(`✅ Security hardening catalog OK · ${files.length} migraciones aplicadas y privilegios efectivos verificados`);
  await db.close();
}

main().catch((error) => {
  console.error('❌ Security hardening 2026-10-05:', error);
  process.exitCode = 1;
});
