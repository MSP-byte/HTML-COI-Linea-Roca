const fs = require('fs');
const path = require('path');

const migrationName = '202609100001_h11_online_only_review_hardening.sql';
const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', migrationName);
const fixturePath = path.join(__dirname, 'fixtures', 'production_schema_contract.json');
const sql = fs.readFileSync(migrationPath, 'utf8');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function must(re, label, source = sql) {
  if (!re.test(source)) {
    console.error(`❌ H11 schema contract: ${label}`);
    process.exit(1);
  }
}

must(/create\s+table\s+if\s+not\s+exists\s+public\.coi_alertas_revisadas\s*\([\s\S]*?primary\s+key\s*\(\s*revisada_por\s*,\s*alerta_id\s*\)[\s\S]*?\);/i,
  'coi_alertas_revisadas debe tener PK compuesta por usuario + alerta');
must(/revisada_por\s+uuid\s+not\s+null\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
  'revisada_por debe referenciar auth.users con ON DELETE CASCADE');
must(/alter\s+table\s+public\.coi_alertas_revisadas\s+enable\s+row\s+level\s+security/i,
  'la tabla debe tener RLS habilitada');
must(/revoke\s+all\s+on\s+table\s+public\.coi_alertas_revisadas\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  'la tabla no debe exponer DML directo a roles de aplicación');

const audit = sql.match(/create\s+or\s+replace\s+function\s+public\.coi_registrar_auditoria_frontend[\s\S]*?\$\$;/i)?.[0] || '';
must(/security\s+definer/i, 'auditoría frontend debe ser SECURITY DEFINER', audit);
must(/v_role\s+is\s+distinct\s+from\s+'administrador'/i, 'auditoría frontend debe exigir administrador', audit);
must(/grant\s+execute\s+on\s+function\s+public\.coi_registrar_auditoria_frontend\([^;]+\)\s+to\s+authenticated/i,
  'authenticated debe ejecutar la RPC de auditoría, quedando la autorización dentro de la RPC');
must(/revoke\s+all\s+on\s+function\s+public\.coi_registrar_auditoria_frontend\([^;]+\)\s+from\s+public\s*,\s*anon/i,
  'public/anon no deben ejecutar auditoría frontend');

const mark = sql.match(/create\s+or\s+replace\s+function\s+public\.coi_marcar_alerta_revisada[\s\S]*?\$\$;/i)?.[0] || '';
must(/security\s+definer/i, 'marcar alerta revisada debe ser SECURITY DEFINER', mark);
must(/v_role\s+is\s+distinct\s+from\s+'administrador'/i,
  'marcar alerta revisada debe exigir administrador', mark);
must(/on\s+conflict\s*\(\s*revisada_por\s*,\s*alerta_id\s*\)/i,
  'el upsert de alertas revisadas debe ser por usuario + alerta', mark);
must(/values\s*\(\s*v_alerta\s*,\s*auth\.uid\(\)/i,
  'la identidad del revisor debe provenir de auth.uid()', mark);

const list = sql.match(/create\s+or\s+replace\s+function\s+public\.coi_listar_alertas_revisadas[\s\S]*?\$\$;/i)?.[0] || '';
must(/security\s+definer/i, 'listar alertas revisadas debe ser SECURITY DEFINER', list);
must(/v_role\s+is\s+distinct\s+from\s+'administrador'/i,
  'listar alertas revisadas debe exigir administrador', list);
must(/where\s+r\.revisada_por\s*=\s*auth\.uid\(\)/i,
  'el listado debe estar aislado por el usuario actual', list);

const pendingObjects = fixture?._divergencias_pendientes?.objetos_h11;
if (!Array.isArray(pendingObjects)) {
  console.error('❌ H11 schema contract: falta objetos_h11 en production_schema_contract.json');
  process.exit(1);
}
const names = new Set(pendingObjects.map((x) => x.objeto));
for (const expected of [
  'coi_alertas_revisadas',
  'coi_registrar_auditoria_frontend(text,text,text,text,jsonb,jsonb,jsonb)',
  'coi_marcar_alerta_revisada(text)',
  'coi_listar_alertas_revisadas()'
]) {
  if (!names.has(expected)) {
    console.error(`❌ H11 schema contract: falta divergencia pendiente ${expected}`);
    process.exit(1);
  }
}
if (pendingObjects.some((x) => x.migracion !== migrationName || x.repo !== 'presente' || x.produccion !== 'ausente')) {
  console.error('❌ H11 schema contract: metadatos de divergencia pendientes inconsistentes');
  process.exit(1);
}

console.log('✅ H11 review hardening schema contract OK');
