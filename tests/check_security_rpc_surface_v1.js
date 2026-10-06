'use strict';

const fs = require('node:fs');
const path = require('node:path');

const migration = path.join(__dirname, '..', 'supabase', 'migrations', '202610060001_security_hardening_v1.sql');
const sql = fs.readFileSync(migration, 'utf8');

function must(re, label) {
  if (!re.test(sql)) {
    console.error('❌ Security hardening V1:', label);
    process.exit(1);
  }
}

must(/left\s*\(\s*p\.proname\s*,\s*4\s*\)\s*=\s*'coi_'/i,
  'la revocación debe cubrir todas las funciones public.coi_*');
must(/revoke\s+all\s+on\s+function[\s\S]*?from\s+public\s*,\s*anon/i,
  'PUBLIC y anon deben quedar sin EXECUTE sobre RPC COI');
must(/alter\s+default\s+privileges[\s\S]*?revoke\s+execute\s+on\s+functions\s+from\s+public/i,
  'las funciones futuras deben nacer cerradas a PUBLIC');
if (/from\s+authenticated/i.test(sql)) {
  console.error('❌ Security hardening V1: la migración no debe revocar authenticated');
  process.exit(1);
}

console.log('✅ Security hardening V1: superficie RPC anónima cerrada sin alterar authenticated.');
