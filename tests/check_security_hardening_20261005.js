'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'supabase', 'migrations');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const fail = (msg) => { console.error('❌ Security hardening 2026-10-05: ' + msg); process.exit(1); };
const must = (source, re, msg) => { if (!re.test(source)) fail(msg); };

const least = read('20261005231823_security_least_privilege_20261005.sql');
const surface = read('20261005231826_security_function_surface_20261005.sql');
const defaults = read('20261005231828_secure_function_defaults_20261005.sql');
const legacy = read('20261005232108_security_close_legacy_audit_rpc_20261005.sql');

must(least, /revoke\s+truncate\s*,\s*references\s*,\s*trigger[\s\S]*?from\s+authenticated/i,
  'authenticated debe perder TRUNCATE/REFERENCES/TRIGGER');
must(least, /revoke\s+all\s+privileges[\s\S]*?from\s+anon/i,
  'anon debe quedar sin grants directos sobre datos COI/profiles');
must(least, /coi_documentos_oc_backup_%[\s\S]*?coi_backup_no_client_access/i,
  'backups históricos deben quedar cerrados por grant y policy restrictiva');
must(least, /coi_alertas_revisadas[\s\S]*?coi_idempotency_requests[\s\S]*?coi_rpc_only_no_client_access/i,
  'tablas RPC-only deben quedar cerradas al cliente');
must(least, /alter\s+function\s+public\.coi_contractual_capabilities_v1\(\)\s+security\s+invoker/i,
  'capabilities debe ser SECURITY INVOKER');

must(surface, /alter\s+function\s+public\.coi_assert_role\(text\[\]\)\s+security\s+invoker/i,
  'coi_assert_role debe ser SECURITY INVOKER');
must(surface, /revoke\s+all\s+on\s+function\s+public\.coi_assert_role\(text\[\]\)\s+from\s+public\s*,\s*anon/i,
  'coi_assert_role debe permanecer cerrado a public/anon');

must(defaults, /alter\s+default\s+privileges[\s\S]*?revoke\s+execute\s+on\s+functions\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'funciones futuras deben nacer sin EXECUTE para roles cliente');

must(legacy, /coi_record_direct_order_update\(jsonb,jsonb\)[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'RPC legacy de auditoría no debe ser ejecutable por clientes');
must(legacy, /grant\s+execute[\s\S]*?coi_record_direct_order_update\(jsonb,jsonb\)[\s\S]*?to\s+service_role/i,
  'RPC legacy debe quedar disponible sólo para service_role');

console.log('✅ Security hardening 2026-10-05 contract OK');
