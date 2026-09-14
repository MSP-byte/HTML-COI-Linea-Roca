const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260914150000_certificaciones_obra_servicio_fields.sql', 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`H17 FAIL: ${message}`);
    process.exit(1);
  }
}

const serviceHeaders = [
  'TIPO DE SERVICIO','ACTA MEDICION N°','PROX ACTA MED. FECHA','OC','FECHA INICIO','FECHA FIN',
  'ITEM_NRO','Descripcion','POS SAP','N° HES','N° IF','CANT','UM','SERVC EJEC. ANT','SERV.EJEC.PTE',
  'SERV EJEC. ACUM','AUX %','PROVEEDOR','TIPO_UM','ACTORES FIRMANTES','EJECUTADO 100%',
  'ANEXO FOTOGRAFIA ACTAS','AÑO'
];

const obraHeaders = [
  'ID OBRA','TIPO DE SERVICIO','ACTA MEDICION N°','PROX ACTA MED FECHA','OC','FECHA INICIO','FECHA FIN',
  'ITEM_NRO','Descripcion','CANT','UM','SERVC EJEC. ANT','SERV.EJEC.PTE','SERV EJEC. ACUM','AUX %',
  'ACTORES FIRMANTES','EJECUTADO 100%','POS SAP','N° HES','N° IF','AÑO'
];

for (const header of serviceHeaders) {
  assert(html.includes(`'${header}'`), `falta encabezado de Servicio: ${header}`);
}
for (const header of obraHeaders) {
  assert(html.includes(`'${header}'`), `falta encabezado de Obra: ${header}`);
}

assert(html.includes('const CERTIFICACION_CONFIGS={'), 'falta configuración diferenciada Servicio/Obra');
assert(html.includes("let tipoGridCertificacion='Servicio';"), 'falta estado de tipo de grilla');
assert(html.includes('certificacionBorradores={Servicio:[],Obra:[]}'), 'faltan borradores independientes por tipo');
assert(html.includes("id_obra:normalized.id_obra||clean(order?.id_obra)||null"), 'ID OBRA no se persiste');
assert(html.includes("proveedor:normalized.proveedor||clean(order?.proveedor)||null"), 'PROVEEDOR no se persiste');
assert(html.includes('nro_hes:normalized.nro_hes||null'), 'N° HES no se persiste');
assert(html.includes('nro_if:normalized.nro_if||null'), 'N° IF no se persiste');
assert(html.includes("const zeroDefaults=new Set(['cantidad','servicio_ejecutado_anterior','servicio_ejecutado_periodo']);"), 'no está corregida la detección de filas vacías');
assert(html.includes('data-cert-tipo="${escapeHTML(tipoGridCertificacion)}"'), 'la tabla no identifica el tipo activo');

for (const column of ['id_obra', 'proveedor', 'nro_hes', 'nro_if']) {
  assert(new RegExp(`add column if not exists ${column}\\s+text`, 'i').test(migration), `la migración no crea ${column}`);
}

console.log(`H17 OK: Servicio ${serviceHeaders.length} columnas; Obra ${obraHeaders.length} columnas; contrato Supabase validado.`);
