const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260914_h17_certificaciones_obra_servicio_campos.sql', 'utf8');

const obraFields = [
  'id_obra','tipo_servicio','acta_medicion_nro','proxima_acta_medicion_fecha','nro_oc','fecha_inicio','fecha_fin',
  'item_nro','descripcion','cantidad','unidad_medida','servicio_ejecutado_anterior','servicio_ejecutado_periodo',
  'servicio_ejecutado_acumulado','aux_porcentaje','actores_firmantes','ejecutado_100','posicion','nro_hes','nro_if','anio'
];
const servicioFields = [
  'acta_medicion_nro','proxima_acta_medicion_fecha','nro_oc','fecha_inicio','fecha_fin','item_nro','descripcion',
  'posicion','nro_hes','nro_if','cantidad','unidad_medida','servicio_ejecutado_anterior','servicio_ejecutado_periodo',
  'servicio_ejecutado_acumulado','aux_porcentaje','proveedor','tipo_um','actores_firmantes','ejecutado_100',
  'anexo_fotografia_actas','anio'
];
const obraHeaders = [
  'ID OBRA','TIPO DE SERVICIO','ACTA MEDICION N°','PROX ACTA MED FECHA','OC','FECHA INICIO','FECHA FIN',
  'ITEM_NRO','Descripcion','CANT','UM','SERVC EJEC. ANT','SERV.EJEC.PTE','SERV EJEC. ACUM','AUX %',
  'ACTORES FIRMANTES','EJECUTADO 100%','POS SAP','N° HES','N° IF','AÑO'
];
const servicioHeaders = [
  'ACTA MEDICION N°','PROX ACTA MED. FECHA','OC','FECHA INICIO','FECHA FIN','ITEM_NRO','Descripcion','POS SAP',
  'N° HES','N° IF','CANT','UM','SERVC EJEC. ANT','SERV.EJEC.PTE','SERV EJEC. ACUM','AUX %','PROVEEDOR','TIPO_UM',
  'ACTORES FIRMANTES','EJECUTADO 100%','ANEXO FOTOGRAFIA ACTAS','AÑO'
];

function compactArray(values) {
  return values.map(v => `'${v.replace(/'/g, "\\'")}'`).join(',');
}

assert(html.includes('const CERTIFICACION_SCHEMAS='), 'Falta CERTIFICACION_SCHEMAS');
assert(html.replace(/\s+/g, '').includes(`fields:[${compactArray(obraFields)}]`), 'Orden de campos OBRA incorrecto');
assert(html.replace(/\s+/g, '').includes(`headers:[${compactArray(obraHeaders)}]`), 'Encabezados OBRA incorrectos');
assert(html.replace(/\s+/g, '').includes(`fields:[${compactArray(servicioFields)}]`), 'Orden de campos SERVICIO incorrecto');
assert(html.replace(/\s+/g, '').includes(`headers:[${compactArray(servicioHeaders)}]`), 'Encabezados SERVICIO incorrectos');

for (const field of ['id_obra','proveedor','nro_hes','nro_if']) {
  assert(html.includes(`${field}:`), `Falta normalización/persistencia de ${field}`);
  assert(new RegExp(`add column if not exists\\s+${field}\\s+text`, 'i').test(migration), `Migración no agrega ${field}`);
}
assert(html.includes('sincronizarEsquemaCertificacion'), 'Falta sincronización Obra/Servicio');
assert(html.includes("tipoCargaActivo()"), 'La grilla no usa el tipo activo de Carga Operativa');
assert(html.includes('POS SAP'), 'Falta cabecera POS SAP');
assert(html.includes('N° HES') && html.includes('N° IF'), 'Faltan HES/IF');
assert(html.includes("GENERATED_FIELDS=new Set(['servicio_ejecutado_acumulado','aux_porcentaje'])"), 'Los calculados deben seguir siendo generados');

console.log('OK H17: Carga Certificación distingue OBRA/SERVICIO con campos y orden solicitados.');
