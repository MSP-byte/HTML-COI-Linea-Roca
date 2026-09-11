'use strict';

const fs = require('fs');
const path = require('path');

const migrationName = '202609110001_coi_privacy_defense_in_depth.sql';
const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', migrationName);
const fixturePath = path.join(__dirname, 'fixtures', 'production_schema_contract.json');
const sql = fs.readFileSync(migrationPath, 'utf8');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function check(ok, label) {
  if (!ok) {
    console.error(`❌ Privacy hardening: ${label}`);
    process.exit(1);
  }
}
function must(re, label) { check(re.test(sql), label); }

must(/left\s*\(\s*c\.relname\s*,\s*4\s*\)\s*=\s*'coi_'/i,
  'el barrido de revocación debe cubrir todos los objetos coi_*');
must(/c\.relname\s*=\s*'profiles'/i,
  'el barrido de revocación debe incluir profiles');
must(/revoke\s+all\s+privileges\s+on\s+table[\s\S]*?from\s+anon/i,
  'anon debe quedar sin privilegios directos sobre tablas COI');
must(/revoke\s+all\s+privileges\s+on\s+sequence[\s\S]*?from\s+anon/i,
  'anon debe quedar sin privilegios directos sobre secuencias COI');
must(/coi_documentos_oc_backup_[\s\S]*?revoke\s+all\s+privileges\s+on\s+table[\s\S]*?from\s+authenticated/i,
  'los backups documentales no deben ser accesibles por clientes authenticated');

for (const policy of [
  'coi_alertas_select_guard_privacy',
  'coi_alertas_insert_guard_privacy',
  'coi_alertas_update_guard_privacy',
  'coi_observaciones_select_guard_privacy',
  'coi_observaciones_insert_guard_privacy',
  'coi_observaciones_update_guard_privacy'
]) {
  must(new RegExp(`create\\s+policy\\s+${policy}[\\s\\S]*?as\\s+restrictive`, 'i'),
    `${policy} debe existir y ser RESTRICTIVE`);
}

must(/coi_alertas_select_guard_privacy[\s\S]*?coi_current_role\(\)\s+is\s+not\s+null/i,
  'leer alertas requiere perfil COI activo');
must(/coi_observaciones_select_guard_privacy[\s\S]*?coi_current_role\(\)\s+is\s+not\s+null/i,
  'leer observaciones requiere perfil COI activo');
must(/coi_registrar_auditoria_frontend[\s\S]*?COI_ADMIN_REQUIRED/i,
  'auditoría frontend debe mantener guard de administrador');
must(/coi_marcar_alerta_revisada[\s\S]*?COI_ADMIN_REQUIRED/i,
  'marcar alerta revisada debe mantener guard de administrador');
must(/coi_listar_alertas_revisadas[\s\S]*?COI_ADMIN_REQUIRED/i,
  'listar alertas revisadas debe mantener guard de administrador');
must(/to_regprocedure\('public\.coi_assert_role\(text\[\]\)'\)[\s\S]*?revoke\s+all\s+on\s+function\s+public\.coi_assert_role\(text\[\]\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'coi_assert_role debe quedar fuera de la superficie RPC directa');
must(/to_regprocedure\('public\.coi_record_direct_order_update\(jsonb,jsonb\)'\)[\s\S]*?revoke\s+all\s+on\s+function\s+public\.coi_record_direct_order_update\(jsonb,jsonb\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'coi_record_direct_order_update debe quedar fuera de la superficie RPC directa');

const expectedPolicies = {
  coi_alertas: [
    'coi_alertas_select_guard_privacy',
    'coi_alertas_insert_guard_privacy',
    'coi_alertas_update_guard_privacy'
  ],
  coi_observaciones_oc: [
    'coi_observaciones_select_guard_privacy',
    'coi_observaciones_insert_guard_privacy',
    'coi_observaciones_update_guard_privacy'
  ]
};
for (const [table, names] of Object.entries(expectedPolicies)) {
  const actual = new Set((fixture[table]?.policies || []).map((p) => p.nombre));
  for (const name of names) check(actual.has(name), `${table}: fixture debe registrar ${name} como estado productivo`);
}

const h11 = fixture?._divergencias_pendientes?.objetos_h11 || [];
check(h11.length >= 4 && h11.every((x) => x.produccion === 'presente' && x.repo === 'presente'),
  'el contrato debe reflejar H11 ya aplicado en STAGING/PROD');

console.log('✅ Privacy hardening contract OK · anon cerrado, RLS restrictiva y H11 reconciliado');
