const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');

assert(html.includes('coi-h13-ordenes-avance-acta-alertas'), 'falta bloque H13');
assert(html.includes("heads[si].textContent='% AVANCE'"), 'falta reemplazo Sector -> % AVANCE');
assert(html.includes("heads[ei].textContent='ULT. ACTA MED Nº'"), 'falta reemplazo Estado COI -> Ult. Acta MED Nº');
assert(html.includes('avance_obra_pct'), 'falta lectura de avance_obra_pct');
assert(html.includes("'control_terceros_estado','avance_obra_pct'"), 'hydration canónica debe incluir avance_obra_pct');
assert(html.includes('avance_obra_pct:r.avance_obra_pct??null'), 'mapRowToItem debe preservar avance_obra_pct');
assert(html.includes('dataset.h13ActaId=id'), 'Actas deben asociarse por UUID estable');
assert(html.includes('.range(from,from+pageSize-1)'), 'Actas deben paginarse');
assert(html.includes("b.textContent='⚠ Reintentar'"), 'fallos de Acta deben distinguirse y permitir reintento');
assert(html.includes("fail('No se pudo consultar la última Acta de Medición')"), 'fallos de consulta deben conservar un estado de error explícito');
assert(html.includes("x.title=r?'Última Acta de Medición registrada en Supabase':'Sin Acta de Medición registrada'"), 'consulta exitosa sin Acta debe distinguirse del error');
assert(html.includes("fold(typeOf(r))!=='OBRA'"), 'Servicios no deben mostrar porcentaje de avance de obra');
assert(html.includes("from('coi_certificaciones')"), 'la última Acta MED debe provenir de certificaciones Supabase');
assert(html.includes('acta_medicion_nro'), 'falta campo de número de Acta MED');
assert(html.includes("q('#btnCentroAlertas')"), 'falta binding directo del Centro de alertas');
assert(html.includes("window.mostrarVista('vistaCentroAlertas')"), 'falta navegación al Centro de alertas');
assert(html.includes("['SECTOR','ESTADO COI'].includes(fold(h.textContent))"), 'observer H13 debe reaccionar sólo al rerender legacy y no a sus propias celdas');
assert(!html.includes('x.onclick='), 'H13 no debe introducir manejadores onclick por propiedad');
assert(html.includes("document.createElement('button')"), 'retry de Acta debe renderizar un botón real');
assert(html.includes("b.type='button'"), 'retry de Acta debe usar type=button');
assert(html.includes("b.addEventListener('click',b._h13RetryClick)"), 'retry de Acta debe usar addEventListener en el botón');
assert(html.includes("await pageBy('nro_oc',ocs)"), 'fallback legacy debe consultar nro_oc también para órdenes con UUID');
assert(html.includes("else better(bestLegacyOc,text(r.nro_oc),r)"), 'fallback legacy sólo debe aceptar Actas sin orden_id');
assert(html.includes('function estadoContractualOrden(row)'), 'Órdenes debe tener un resolver explícito de Estado contractual');
assert(html.includes('obtenerPasoContractualDesdeEstadoDocumental'), 'Estado contractual debe resolverse contra el circuito canónico, no texto libre');
assert(html.includes('col-contractual">Estado contractual'), 'la tabla de Órdenes debe mostrar la columna Estado contractual');
assert(html.includes("'Estado contractual','Estado COI'"), 'Exportar CSV debe incluir Estado contractual');
assert(html.includes('window.obtenerEstadoContractualOrden=estadoContractualOrden'), 'el resolver contractual debe quedar disponible para todas las capas de Órdenes');

// Cierre H13: protege hidratación autoritativa, asociación estable, lectura paginada y retry sin onclick.
console.log('H13 ordenes/alertas static regression: OK');
