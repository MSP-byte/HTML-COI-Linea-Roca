'use strict';

const fs = require('fs');
const path = require('path');

const migrationName = '202610050002_security_least_privilege.sql';
const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', migrationName);
const functionMigrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '202610050003_security_function_surface.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const functionSql = fs.readFileSync(functionMigrationPath, 'utf8');
const defaultsMigrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '202610050004_secure_function_defaults.sql');
const defaultsSql = fs.readFileSync(defaultsMigrationPath, 'utf8');

function check(ok, label) {
  if (!ok) {
    console.error(`❌ Security least privilege: ${label}`);
    process.exit(1);
  }
}

function must(re, label, source = sql) {
  check(re.test(source), label);
}

must(/revoke\s+truncate\s*,\s*references\s*,\s*trigger\s+on\s+table[\s\S]*?from\s+authenticated/i,
  'authenticated no debe conservar TRUNCATE/REFERENCES/TRIGGER');

must(/c\.relname\s+like\s+'coi_documentos_oc_backup_%'/i,
  'los backups deben detectarse con un patrón de prefijo completo');

must(/revoke\s+all\s+privileges\s+on\s+table[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'los backups deben quedar cerrados a roles cliente');

must(/create\s+policy\s+coi_backup_no_client_access[\s\S]*?as\s+restrictive[\s\S]*?using\s*\(\s*false\s*\)[\s\S]*?with\s+check\s*\(\s*false\s*\)/i,
  'los backups deben tener deny-all RLS explícito');

for (const table of ['coi_alertas_revisadas', 'coi_idempotency_requests']) {
  must(new RegExp(`['"]${table}['"]`, 'i'),
    `${table} debe quedar identificado como RPC-only`);
}

must(/create\s+policy\s+coi_rpc_only_no_client_access[\s\S]*?as\s+restrictive[\s\S]*?using\s*\(\s*false\s*\)[\s\S]*?with\s+check\s*\(\s*false\s*\)/i,
  'las tablas RPC-only deben tener deny-all RLS explícito');

must(/alter\s+function\s+public\.coi_contractual_capabilities_v1\(\)\s+security\s+invoker/i,
  'la RPC de capabilities no debe conservar SECURITY DEFINER');

must(/revoke\s+all\s+on\s+function\s+public\.coi_contractual_capabilities_v1\(\)\s+from\s+public\s*,\s*anon/i,
  'la RPC de capabilities debe seguir cerrada a public/anon');

must(/grant\s+execute\s+on\s+function\s+public\.coi_contractual_capabilities_v1\(\)\s+to\s+authenticated/i,
  'authenticated debe poder consultar capabilities');

must(/alter\s+function\s+public\.coi_assert_role\(text\[\]\)\s+security\s+invoker/i,
  'coi_assert_role debe dejar de ser SECURITY DEFINER', functionSql);

must(/revoke\s+all\s+on\s+function\s+public\.coi_assert_role\(text\[\]\)\s+from\s+public\s*,\s*anon/i,
  'coi_assert_role debe permanecer cerrado a public/anon', functionSql);

must(/grant\s+execute\s+on\s+function\s+public\.coi_assert_role\(text\[\]\)\s+to\s+authenticated/i,
  'authenticated debe conservar el helper de validación de rol', functionSql);

check((sql.match(/\$\$/g) || []).length % 2 === 0, 'delimitadores $$ desbalanceados');
check((functionSql.match(/\$\$/g) || []).length % 2 === 0, 'delimitadores $$ desbalanceados en funciones');
must(/^begin;/mi, 'falta BEGIN');
must(/commit;\s*$/i, 'falta COMMIT final');
must(/^begin;/mi, 'falta BEGIN en migración de funciones', functionSql);
must(/commit;\s*$/i, 'falta COMMIT final en migración de funciones', functionSql);
check(!/service_role|password\s*=|secret\s*=/i.test(sql), 'la migración no debe contener secretos');
check(!/service_role|password\s*=|secret\s*=/i.test(functionSql), 'la migración de funciones no debe contener secretos');

must(/alter\s+default\s+privileges\s+for\s+role\s+postgres\s+in\s+schema\s+public[\s\S]*?revoke\s+execute\s+on\s+functions\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'las funciones nuevas deben nacer cerradas a roles cliente', defaultsSql);
check(!/service_role|password\s*=|secret\s*=/i.test(defaultsSql), 'la migración de defaults no debe contener secretos');

console.log('✅ Security least privilege OK · grants estructurales cerrados, RPC-only deny-all y superficie SECURITY DEFINER reducida');
