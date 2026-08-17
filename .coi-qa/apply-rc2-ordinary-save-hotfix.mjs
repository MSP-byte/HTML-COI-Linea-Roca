import fs from 'node:fs';

const path = 'index.html';
const source = fs.readFileSync(path, 'utf8');
const before = '      activarModoEdicionOC(currentOCKeyFromGlobals());';
const after = '      window.activarModoEdicionOC(currentOCKeyFromGlobals());';
const matches = source.split(before).length - 1;

if (matches !== 1) {
  throw new Error(`Guardrail: se esperaba exactamente 1 handler legacy, encontrados ${matches}.`);
}
if (!source.includes('window.activarModoEdicionOC=openEditor;')) {
  throw new Error('Guardrail: no se encontró la autoridad pública del editor RC2.');
}
if (!source.includes("rpc('coi_actualizar_orden_integral',{p_orden_id:ordenId,p_cambios:patch})")) {
  throw new Error('Guardrail: el editor RC2 no conserva la RPC transaccional esperada.');
}

const patched = source.replace(before, after);
fs.writeFileSync(path, patched, 'utf8');

const verify = fs.readFileSync(path, 'utf8');
if (verify.includes(before) || !verify.includes(after)) {
  throw new Error('Verificación posterior del parche falló.');
}
console.log('RC2 ordinary-save hotfix: 1 reemplazo exacto aplicado.');
