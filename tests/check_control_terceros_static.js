#!/usr/bin/env node
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const required = [
  "V58.1R38.2-CONTROL-TERCEROS-FIX",
  "let ctEditState=null",
  "function setControlTercerosEditMode",
  "function cancelarEdicionControlTerceros",
  "c.from('coi_ordenes').update(payload).eq('nro_oc',nro)",
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
const oldVersion = (html.match(/V58\.1R38\.1-BOOT-FIX-FINANCIERO-OC/g) || []).length;
if (oldVersion) throw new Error(`Quedaron ${oldVersion} referencias a la versión anterior`);
console.log(JSON.stringify({status:'pass', checks:required.length + 2}, null, 2));
