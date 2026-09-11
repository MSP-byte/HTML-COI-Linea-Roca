const fs = require('fs');
const assert = require('assert');
const sql = fs.readFileSync('supabase/migrations/202609110003_obra_avance_manual.sql','utf8');
assert(sql.includes('avance_obra_pct numeric(5,2)'), 'falta columna avance_obra_pct');
assert(sql.includes('coi_actualizar_avance_obra'), 'falta RPC de avance manual');
assert(sql.includes('COI_OBRA_PROGRESS_ONLY_FOR_OBRA'), 'falta guard de tipo Obra');
assert(sql.includes('grant execute on function public.coi_actualizar_avance_obra(uuid, numeric) to authenticated'), 'falta grant authenticated');
assert(sql.includes('revoke all on function public.coi_actualizar_avance_obra(uuid, numeric) from anon'), 'anon no debe ejecutar RPC');
console.log('obra avance manual schema: OK');
