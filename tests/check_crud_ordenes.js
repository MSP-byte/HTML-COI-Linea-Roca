'use strict';
const assert = require('assert');
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const moduleSource = html.match(/<script id="coi-crud-ordenes-v601">([\s\S]*?)<\/script>/)?.[1] || '';
assert.ok(moduleSource, 'No se encontró el módulo CRUD canónico');

assert.strictEqual((html.match(/id="btnBorrarSeleccionadas"/g) || []).length, 1, 'El ID del botón debe ser único');
assert.strictEqual((moduleSource.match(/function handleBorrarSeleccionadasClick\s*\(/g) || []).length, 1, 'Debe existir un solo handler propietario');
assert.strictEqual((moduleSource.match(/document\.addEventListener\('click',handleBorrarSeleccionadasClick/g) || []).length, 1, 'Debe existir un solo binding delegado');
assert.match(moduleSource, /event\.target\?\.closest\?\.\('#btnBorrarSeleccionadas'\)/);
assert.match(moduleSource, /event\.preventDefault\(\)/);
assert.match(moduleSource, /document\.querySelectorAll\('\.chk-orden-row:checked'\)/);
assert.match(moduleSource, /\[COI DELETE\] CLICK RECIBIDO/);
assert.match(moduleSource, /No hay órdenes seleccionadas para borrar\./);
assert.match(moduleSource, /__coiDeleteUIAbortController\.abort\(\)/);
assert.match(moduleSource, /signal:controller\.signal/);
assert.match(moduleSource, /COI_DELETE_DIAGNOSTICO/);
assert.match(moduleSource, /await confirmDeletion\(deletable,blocked\)[\s\S]*?await requireAccess\(\)/, 'La confirmación debe abrir antes de validar Supabase/permisos');
assert.match(moduleSource, /deleteCanonical[\s\S]*?filas posteriores/);
assert.match(moduleSource, /No se pudo eliminar la OC en Supabase:/);
assert.ok(!/localStorage\.clear\s*\(/.test(moduleSource));
assert.ok(!html.includes('V60.1.2-DELETE-HANDLER-UNICO'));
assert.ok(html.includes('V60.1.4-DELETE-BUTTON-FUNCIONAL'));

for (const name of ['v45BorrarSeleccionadas', 'borrarOrdenesSeleccionadasR4']) {
  const match = html.match(new RegExp(`async function ${name}\\(\\)\\{([\\s\\S]*?)\\n\\s*\\}`));
  assert.ok(match, `No se encontró adaptador ${name}`);
  assert.strictEqual((match[1].match(/COI_CRUD_ORDENES\.eliminarSeleccionadasDesdeUI\s*\(/g) || []).length, 1);
  assert.ok(!/localStorage|guardarBaseLocal|estaciones\.forEach/.test(match[1]), `${name} contiene borrado legacy`);
}

// Modelo de interacción: un click real burbujea hasta el único listener documental.
class Target {
  constructor(parent=null, selector=''){this.parent=parent;this.selector=selector;this.listeners=[];}
  addEventListener(type,fn){if(type==='click')this.listeners.push(fn);}
  async click(){const target=this;const event={target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};event.target.closest=s=>s===target.selector?target:null;for(let node=this;node;node=node.parent)for(const fn of node.listeners)await fn(event);return event;}
}
(async()=>{
  const documentTarget=new Target();
  const button=new Target(documentTarget,'#btnBorrarSeleccionadas');
  let calls=0,modals=0;
  documentTarget.addEventListener('click',async event=>{if(!event.target.closest('#btnBorrarSeleccionadas'))return;event.preventDefault();calls++;modals++;});
  const event=await button.click();
  assert.ok(event.defaultPrevented);assert.strictEqual(calls,1);assert.strictEqual(modals,1);
  console.log('CRUD Órdenes: propietario delegado único, click DOM y apertura de confirmación verificados.');
})().catch(error=>{console.error(error);process.exit(1);});
