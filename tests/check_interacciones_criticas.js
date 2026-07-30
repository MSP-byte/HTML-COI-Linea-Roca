'use strict';
const assert=require('assert');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const crud=html.match(/<script id="coi-crud-ordenes-v601">([\s\S]*?)<\/script>/)?.[1]||'';
assert.ok(crud,'Falta el módulo CRUD de Órdenes');
assert.match(crud,/function bindCrudOrdenesUI\s*\(/);
assert.match(crud,/__coiCrudOrdenesUIController\?\.abort\(\)/);
assert.match(crud,/document\.addEventListener\('click',[\s\S]*?closest\?\.\('#btnBorrarSeleccionadas'\)/);
assert.match(crud,/COI_CRUD_ORDENES\.eliminarSeleccionadasDesdeUI\(\)/);
assert.doesNotMatch(crud,/stopImmediatePropagation/);
const legacy=html.match(/function bindOrdenesR4\(\)\{([\s\S]*?)\n  \}\n\n  \/\/ Deja una función pública/)?.[1]||'';
assert.ok(legacy,'Falta compatibilidad de selección R4');
assert.doesNotMatch(legacy,/#btnBorrarSeleccionadas/);
assert.doesNotMatch(legacy,/addEventListener\('click'/);
assert.doesNotMatch(legacy,/stopImmediatePropagation/);
for(const text of [
  'Debe iniciar sesión con el usuario administrador para eliminar OCs.',
  'Solo el usuario administrador puede eliminar Órdenes de Compra.',
  'Active el Modo Administrador desde Administración para eliminar OCs.',
  'admin@coiroca.com'
])assert.ok(crud.includes(text),`Falta regla/mensaje: ${text}`);
assert.match(html,/modoAccesoActual="consulta"/);
assert.match(html,/function inicializarModoAccesoSeguro\(\)[\s\S]*?modoAccesoActual="consulta"/);
assert.doesNotMatch(crud,/localStorage[^\n]*(?:admin|rol|modo)/i);
for(const id of ['btnDashboard','btnRed','btnCalendarioCOI','btnOrdenes','btnCarga','btnAdministracionSistema','btnAcercaSistema','btnCentroAlertas','btnAccesoBusquedaOrdenes','btnSupabaseSync','btnSupabaseLogout','btnExportOrdenesCSVV581R']){
  assert.ok(html.includes(`id="${id}"`)||html.includes(`'${id}'`)||html.includes(`\"${id}\"`),`Control crítico ausente: ${id}`);
}
assert.ok(!/<(?:button|a)[^>]+onclick\s*=/i.test(html),'No se permiten handlers onclick inline');
console.log('Interacciones críticas: binding delegado, permisos y controles estáticos OK.');
