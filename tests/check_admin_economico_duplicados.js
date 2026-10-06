'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('index.html','utf8');
const sql = fs.readFileSync('supabase/migrations/202610060002_admin_resumen_economico_duplicados.sql','utf8');
const lifecycleSql = fs.readFileSync('supabase/migrations/202610060003_duplicate_resolution_lifecycle.sql','utf8');
assert.match(lifecycleSql,/Cierre administrativo excepcional por resolución de registro duplicado/);
assert.match(lifecycleSql,/set estado_coi='Cerrada'/);
assert.match(lifecycleSql,/fecha_cierre_operativo=current_date/);
assert.match(lifecycleSql,/set estado_registro='Archivado'/);
assert.match(lifecycleSql,/cierre_administrativo_excepcional/);
assert.doesNotMatch(lifecycleSql,/delete\s+from\s+public\.coi_ordenes/i);


assert.match(sql,/coi_actualizar_resumen_economico_manual/);
assert.match(sql,/coi_assert_role\(array\['administrador'\]\)/);
assert.match(sql,/p_monto_total\s+numeric/);
assert.match(sql,/p_avance_pct\s+numeric/);
assert.match(sql,/p_monto_total\s*<\s*0/);
assert.match(sql,/p_avance_pct\s*<\s*0\s+or\s+p_avance_pct\s*>\s*100/);
assert.match(sql,/perform public\.coi_sync_order_balance\(p_orden_id\)/);
assert.match(sql,/monto_ejecutado_estimado/);
assert.match(sql,/monto_disponible_estimado/);

assert.match(sql,/coi_resolver_oc_duplicada/);
assert.match(sql,/estado_registro='Archivado'/);
assert.match(sql,/Resolución de duplicado/);
assert.match(sql,/RESOLVER_OC_DUPLICADA/);
const dup = sql.match(/create or replace function public\.coi_resolver_oc_duplicada[\s\S]*?\$\$;?/i)?.[0] || '';
assert.ok(dup,'No se encontró RPC de duplicados');
assert.doesNotMatch(dup,/delete\s+from\s+public\.coi_ordenes/i,'Resolver duplicado no debe borrar la OC');
assert.match(sql,/revoke all on function public\.coi_resolver_oc_duplicada[\s\S]*?from public, anon/);
assert.match(sql,/grant execute on function public\.coi_resolver_oc_duplicada[\s\S]*?to authenticated/);
assert.match(sql,/rolname='service_role'/);

assert.match(html,/COI_ADMIN_ECONOMICO_DUPLICADOS_20261006/);
assert.match(html,/coiAdminEconomicPanel/);
assert.match(html,/Monto disponible estimado/i);
assert.match(html,/Saldo real por posiciones/i);
assert.match(html,/coi_actualizar_resumen_economico_manual/);
assert.match(html,/coiSelectionActionBar/);
assert.match(html,/Editar monto\/avance/);
assert.match(html,/Resolver duplicado/);
assert.match(html,/btnBorrarSeleccionadas/);
assert.match(html,/coi_resolver_oc_duplicada/);
assert.match(html,/data-coi-obra-progress-manual/);

console.log('Admin económico/duplicados: RPCs, seguridad, cálculo derivado y UI sticky verificados.');
