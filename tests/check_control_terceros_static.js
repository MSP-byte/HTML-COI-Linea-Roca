#!/usr/bin/env node
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const required = [
  'coi-v581r28-contractual-ct-script',
  "'control_terceros_hasta','control_terceros_estado'",
  "controlTercerosHasta:r.control_terceros_hasta||''",
  "controlTercerosEstado:r.control_terceros_estado||''",
  "Object.prototype.hasOwnProperty.call(persisted,'control_terceros_hasta')",
  'return fechaISO(persisted.control_terceros_hasta)',
  'function calcularEstadoControlTerceros',
  'function setControlTercerosEditMode',
  "c.rpc('coi_guardar_orden_integral',{p_orden_id:orderId,p_datos:payload})",
  'control_terceros_hasta:fecha||null',
  'control_terceros_estado:estado',
  "select('id,nro_oc,control_terceros_hasta,control_terceros_estado').eq('id',orderId).limit(1)",
  'const permissionChanged=window.__coiPermisoEdicionFicha!==allowed',
  "permissionChanged&&document.getElementById('vistaFichaOC')?.classList.contains('active')",
  'window.coiRestoreContractualCT(reference)',
  "['Control de Terceros',['control_terceros_hasta']]",
  "patch.control_terceros_estado=calculator(patch.control_terceros_hasta).estado",
  "c.from('coi_ordenes').select('id,nro_oc').eq('nro_oc',nro).limit(2)",
  'window.coiRestoreContractualCT=injectCT',
  'await window.actualizarEstadoDocumentalDesdePasoContractual(nro,stage'
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
  'PLIEGOS EN PREPARACION',
  'PLIEGOS TERMINADO SIN SOLPED',
  'PLIEGO CON SOLPED SIN EXPTE',
  'PLIEGO CON OC',
  'PLIEGO CON EXPTE',
  'PLIEGO CON EXPTE Y CON OC EMITIDA, PERO SIN CONTROL DE 3',
  'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',
  'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO',
  'OBRA/SERVICIO EN EJECUCION',
  'OBRA/SERVICIO CANCELADA O SUSPENDIDA',
  'OBRA/SERVICIO FINALIZADA',
  'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA'
];
const expectedCodes = [
  'pliegos_preparacion',
  'pliegos_terminado_sin_solped',
  'solped_sin_expediente',
  'pliego_con_oc',
  'pliego_con_expediente',
  'oc_sin_control_terceros',
  'control_terceros_sin_acta',
  'control_terceros_con_acta',
  'ejecucion',
  'cancelada_suspendida',
  'finalizada',
  'finalizada_actas'
];
const circuitBlock = html.match(/const CIRCUITO_ADMINISTRATIVO_ETAPAS=\[(.*?)\];/s)?.[1] || '';
const renderedStages = [...circuitBlock.matchAll(/nombre:'([^']+)'/g)].map(match => match[1]);
const renderedCodes = [...circuitBlock.matchAll(/codigo:'([^']+)'/g)].map(match => match[1]);
if (JSON.stringify(renderedStages) !== JSON.stringify(expectedStages)) {
  throw new Error(`El circuito debe contener exactamente 12 etapas: ${JSON.stringify(renderedStages)}`);
}
if (JSON.stringify(renderedCodes) !== JSON.stringify(expectedCodes)) {
  throw new Error(`Los códigos contractuales no coinciden: ${JSON.stringify(renderedCodes)}`);
}
if (/enviada_pyc|finalizada_saldo_remanente/i.test(circuitBlock)) {
  throw new Error('El circuito activo contiene una etapa retirada o reutiliza saldo remanente');
}
if (!html.includes("const ESTADO_FINALIZADA_SALDO_REMANENTE={codigo:'finalizada_saldo_remanente',nombre:'OBRA/SERVICIO FINALIZADA PERO CON SALDO REMANENTE'}")) {
  throw new Error('Se perdió la semántica independiente de finalizada con saldo remanente');
}

const hotfixStart = html.indexOf('<script id="coi-v581r28-contractual-ct-script">');
const hotfixEnd = html.indexOf('</script>', hotfixStart);
const hotfixBlock = html.slice(hotfixStart, hotfixEnd);
const executiveStart = html.indexOf('<script id="coi-executive-quality-phase">');
const executiveEnd = html.indexOf('</script>', executiveStart);
const executiveBlock = html.slice(executiveStart, executiveEnd).replace(/const DOCUMENTOS_STORAGE_FIELDS=\[[^\]]+\];/, '');
const editorStart = html.indexOf("const ALLOWED=Object.freeze(['id_obra'");
const editorEnd = html.indexOf('</script>', editorStart);
const editorBlock = html.slice(editorStart, editorEnd);
const retiredPyc = /enviada_pyc|PYC_STAGE|persistirEtapaEnvioPyC|pycBadge|estado_envio_pyc|fecha_envio_planificacion|Enviadas? a PyC|Env[ií]o PyC|No enviada? a PyC|PLANIFICACION Y CONTROL/i;
for (const [name, block] of [['hotfix', hotfixBlock], ['ejecutivo', executiveBlock], ['editor', editorBlock]]) {
  if (retiredPyc.test(block)) throw new Error(`PyC continúa activo en el módulo ${name}`);
}

if (/<button\b[^>]*>[^<]*(?:Abrir\s+(?:en\s+)?OneDrive|Agregar\s+link\s+documental|Marcar\s+enviad[oa]\s+a\s+PyC)/i.test(html)) {
  throw new Error('Reapareció una acción contractual retirada');
}

console.log(JSON.stringify({ status: 'pass', checks: required.length + 16 }, null, 2));
