#!/usr/bin/env node
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const required = [
  "coi-v581r28-contractual-ct-script",
  "let ctEditState=null",
  "function setControlTercerosEditMode",
  "function cancelarEdicionControlTerceros",
  "c.from('coi_ordenes').select('id,nro_oc').eq('nro_oc',nro).limit(2)",
  "c.rpc('coi_guardar_orden_integral',{p_orden_id:orderId,p_datos:payload})",
  "control_terceros_hasta:fecha||null",
  "control_terceros_estado:estado",
  "year>=2000",
  "document.addEventListener('click'",
  "coi-contractual-ct-hotfix-post-render",
  "function mountContractualCircuit",
  "window.coiRestoreContractualCT=injectCT",
  "select('id,nro_oc,control_terceros_hasta,control_terceros_estado').eq('id',orderId).limit(1)",
  "const synced=await syncCTSupabase(oc,fecha,estado)",
  "setCT(oc,persistedDate)",
  "const PYC_STAGE_CODE='enviada_pyc'",
  "async function persistirEtapaEnvioPyC",
  "const payload={estado_documental:PYC_STAGE_NAME,estado_coi:PYC_STAGE_NAME,estado_envio_pyc:'Enviado'}",
  "if(stage.codigo===PYC_STAGE_CODE)return persistirEtapaEnvioPyC(c,oc,nro,orderId)",
  "await window.actualizarEstadoDocumentalDesdePasoContractual(nro,stage",
];
for (const token of required) {
  if (!html.includes(token)) throw new Error(`Falta implementación requerida: ${token}`);
}
if (/data-r28-ct-(?:edit|save|cancel)[^>]*onclick=/i.test(html)) {
  throw new Error('Se detectó un onclick inline en Control de Terceros');
}
if (!/window\.coiR28InjectControlTerceros\s*=/.test(html)) {
  throw new Error('La API de inyección de Control de Terceros no quedó expuesta');
}
if (/allowLocalFallback\s*:\s*true/.test(html)) {
  throw new Error('El circuito contractual conserva un fallback local de autoridad');
}
if (/Control de Terceros guardado localmente/i.test(html)) {
  throw new Error('Control de Terceros todavía informa éxito local sin Supabase');
}
const saveStart = html.indexOf('async function saveCTFromButton');
const saveEnd = html.indexOf('function updateVersion', saveStart);
const saveBlock = html.slice(saveStart, saveEnd);
if (saveBlock.indexOf('syncCTSupabase(oc,fecha,estado)') > saveBlock.indexOf('setCT(oc,persistedDate)')) {
  throw new Error('Control de Terceros volvió a mutar localmente antes de Supabase');
}
const updateFieldsStart = html.indexOf('async function updateSupabaseFields');
const updateFieldsEnd = html.indexOf('async function syncCTSupabase', updateFieldsStart);
const updateFieldsBlock = html.slice(updateFieldsStart, updateFieldsEnd);
if (/result\.data\?*\.orden|result\.data\s*\.\s*orden/.test(updateFieldsBlock)) {
  throw new Error('Control de Terceros volvió a depender de result.data.orden');
}
const expectedStages = [
  'PLIEGOS EN PREPARACION', 'PLIEGOS TERMINADO SIN SOLPED', 'PLIEGO CON SOLPED SIN EXPTE',
  'PLIEGO CON OC', 'PLIEGO CON EXPTE', 'PLIEGO CON EXPTE Y CON OC EMITIDA, PERO SIN CONTROL DE 3',
  'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',
  'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO', 'OBRA/SERVICIO EN EJECUCION',
  'OBRA/SERVICIO CANCELADA O SUSPENDIDA', 'OBRA/SERVICIO FINALIZADA',
  'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA',
  'ENVIADO A PLANIFICACION Y CONTROL (R. de Escalada)'
];
const expectedCodes = [
  'pliegos_preparacion', 'pliegos_terminado_sin_solped', 'solped_sin_expediente',
  'pliego_con_oc', 'pliego_con_expediente', 'oc_sin_control_terceros',
  'control_terceros_sin_acta', 'control_terceros_con_acta', 'ejecucion',
  'cancelada_suspendida', 'finalizada', 'finalizada_actas', 'enviada_pyc'
];
const circuitBlock = html.match(/const CIRCUITO_ADMINISTRATIVO_ETAPAS=\[(.*?)\];/s)?.[1] || '';
const renderedStages = [...circuitBlock.matchAll(/nombre:'([^']+)'/g)].map(match => match[1]);
if (JSON.stringify(renderedStages) !== JSON.stringify(expectedStages)) {
  throw new Error(`El circuito debe conservar exactamente 13 etapas: ${JSON.stringify(renderedStages)}`);
}
const renderedCodes = [...circuitBlock.matchAll(/codigo:'([^']+)'/g)].map(match => match[1]);
if (JSON.stringify(renderedCodes) !== JSON.stringify(expectedCodes)) {
  throw new Error(`Los códigos contractuales no coinciden: ${JSON.stringify(renderedCodes)}`);
}
if (circuitBlock.includes('finalizada_saldo_remanente')) {
  throw new Error('La etapa PyC reutiliza finalizada_saldo_remanente');
}
if (!html.includes("const ESTADO_FINALIZADA_SALDO_REMANENTE={codigo:'finalizada_saldo_remanente',nombre:'OBRA/SERVICIO FINALIZADA PERO CON SALDO REMANENTE'}")) {
  throw new Error('Se perdió la semántica independiente de finalizada con saldo remanente');
}
const pycStart = html.indexOf('async function persistirEtapaEnvioPyC');
const pycEnd = html.indexOf('function updateEstadoDOM', pycStart);
const pycBlock = html.slice(pycStart, pycEnd);
if (!pycBlock.includes("estado_envio_pyc:'Enviado'") || !pycBlock.includes('fecha_envio_planificacion') || !pycBlock.includes('certificable_con_saldo') || !pycBlock.includes('saldo_remanente')) {
  throw new Error('La etapa PyC no valida todos los invariantes del readback');
}
if (/const payload=\{[^}]*finalizada_saldo_remanente|p_codigo\s*:\s*PYC_STAGE_CODE/s.test(pycBlock)) {
  throw new Error('La etapa PyC usa el código contractual reservado para saldo remanente');
}
const hotfixStart = html.indexOf('<script id="coi-v581r28-contractual-ct-script">');
const hotfixEnd = html.indexOf('</script>', hotfixStart);
const hotfixBlock = html.slice(hotfixStart, hotfixEnd);
if (/OneDrive|Agregar\s+link\s+documental|Marcar\s+enviad[oa]\s+a\s+PyC/i.test(hotfixBlock)) {
  throw new Error('El hotfix reintrodujo UX documental legacy');
}
if (/<button\b[^>]*>[^<]*(?:Abrir\s+(?:en\s+)?OneDrive|Agregar\s+link\s+documental|Marcar\s+enviad[oa]\s+a\s+PyC)/i.test(html)) {
  throw new Error('Reapareció una acción contractual retirada');
}
console.log(JSON.stringify({status:'pass', checks:required.length + 15}, null, 2));
