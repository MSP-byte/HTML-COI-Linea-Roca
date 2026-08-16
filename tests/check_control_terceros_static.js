#!/usr/bin/env node
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const required = [
  "coi-v581r28-contractual-ct-script",
  "let ctEditState=null",
  "function setControlTercerosEditMode",
  "function cancelarEdicionControlTerceros",
  "c.from('coi_ordenes').select('id,nro_oc').eq('nro_oc',nro).limit(2)",
  "c.rpc('coi_guardar_orden_integral',{p_orden_id:lookup.data[0].id,p_datos:payload})",
  "control_terceros_hasta:fecha||null",
  "control_terceros_estado:estado",
  "year>=2000",
  "document.addEventListener('click'",
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
console.log(JSON.stringify({status:'pass', checks:required.length + 2}, null, 2));
