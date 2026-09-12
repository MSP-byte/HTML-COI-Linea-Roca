const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');

assert(html.includes('coi-h13-ordenes-avance-acta-alertas'), 'falta bloque H13');
assert(html.includes("heads[si].textContent='% AVANCE'"), 'falta reemplazo Sector -> % AVANCE');
assert(html.includes("heads[ei].textContent='ULT. ACTA MED Nº'"), 'falta reemplazo Estado COI -> Ult. Acta MED Nº');
assert(html.includes('avance_obra_pct'), 'falta lectura de avance_obra_pct');
assert(html.includes("fold(typeOf(r))!=='OBRA'"), 'Servicios no deben mostrar porcentaje de avance de obra');
assert(html.includes("from('coi_certificaciones')"), 'la última Acta MED debe provenir de certificaciones Supabase');
assert(html.includes('acta_medicion_nro'), 'falta campo de número de Acta MED');
assert(html.includes("q('#btnCentroAlertas')"), 'falta binding directo del Centro de alertas');
assert(html.includes("window.mostrarVista('vistaCentroAlertas')"), 'falta navegación al Centro de alertas');
assert(html.includes("['SECTOR','ESTADO COI'].includes(fold(h.textContent))"), 'observer H13 debe reaccionar sólo al rerender legacy y no a sus propias celdas');

console.log('H13 ordenes/alertas static regression: OK');
