'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function sliceFunction(name, next) {
  const start = html.indexOf('function '+name+'(');
  const end = html.indexOf('function '+next+'(',start);
  assert.ok(start>=0 && end>start,'Falta '+name+' o su delimitador '+next);
  return html.slice(start,end).trim();
}
const helperSource = sliceFunction('coiICSText','parseFecha');
const attack = 'FEMYP\\,;\\\\\\r\\nEND:VEVENT\\r\\nBEGIN:VEVENT\\r\\nSUMMARY:INYECCION';
const injected = 'FEMYP,;\\\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:INYECCION';
function makeContext(overrides={}) {
  const files = [];
  const context = vm.createContext({
    Date, encodeURIComponent,
    descargarArchivo:(name,text,type)=>files.push({name,text,type}),
    fechaICS:()=> '20261026T120000Z',
    ...overrides
  });
  vm.runInContext(helperSource,context,{timeout:2000});
  return {context,files};
}
function testContent(entry, fileCount=1) {
  assert.equal(entry.files.length,fileCount,'Debe emitirse un unico archivo');
  const ics = entry.files[0].text;
  assert.equal((ics.match(/^BEGIN:VEVENT$/gm)||[]).length,1,'No se admiten VEVENT inyectados');
  assert.equal((ics.match(/^END:VEVENT$/gm)||[]).length,1,'No se admiten cierres extra');
  assert.doesNotMatch(ics,/^SUMMARY:INYECCION$/m,'No debe aparecer una propiedad inyectada');
  assert.match(ics,/\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:INYECCION/,'El texto debe conservarse escapado');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'),'Estructura ICS inicial intacta');
  assert.ok(ics.endsWith('END:VCALENDAR'),'Estructura ICS final intacta');
  assert.equal(entry.files[0].type,'text/calendar;charset=utf-8');
}
const normal = makeContext();
assert.equal(vm.runInContext('coiICSText("Constitución")',normal.context),'Constitución');
assert.equal(vm.runInContext('coiICSText("a,b;c\\\\d")',normal.context),'a\\,b\\;c\\\\d');
assert.equal(vm.runInContext('coiICSText("línea 1\\r\\nlínea 2")',normal.context),'línea 1\\nlínea 2');
assert.equal(vm.runInContext('coiICSUID("4530009805")',normal.context),'4530009805');
assert.doesNotMatch(vm.runInContext('coiICSUID("test\\r\\nEND:VEVENT")',normal.context),/[\r\n]/);

const calendar = makeContext({todasLasOC:()=>[{oc:'4530009805',fin:'2026-10-26',tipo:'Obra',estacion:'Temperley',proveedor:injected}]});
vm.runInContext(sliceFunction('exportCalendarioICS','descargarArchivo')+'\nexportCalendarioICS();',calendar.context,{timeout:2000});
testContent(calendar);

const ficha = makeContext({
  ocActualId:'4530009805',
  obtenerOC:()=>({estacion:{nombre:'Temperley'},item:{oc:'4530009805',idObra:'4530009805',tipo:'Obra',proveedor:injected}}),
  calcularFichaOC:()=>({venc:'2026-10-26',prox:null})
});
vm.runInContext(sliceFunction('exportarFichaOCICS','irEstacionOC')+'\nexportarFichaOCICS();',ficha.context,{timeout:2000});
testContent(ficha);

const operativo = makeContext({
  filtrarEventosCalendarioCOI:()=>[{fecha:'2026-10-26',tipoEvento:'Vencimiento',oc:'4530009805',proveedor:injected,estacion:'Temperley',estado:'Activo',observaciones:''}],
  slugOC:x=>String(x)
});
vm.runInContext(sliceFunction('exportarEventosCalendarioOperativo','cargarFiltrosCalendarioCOIUnificado')+'\nexportarEventosCalendarioOperativo("ambos","ics");',operativo.context,{timeout:2000});
testContent(operativo);

const fijo = makeContext({
  eventosFiltradosCalendarioFix:()=>[
    {id:'4530009805',fecha:'2026-10-26',tipoEvento:'Vencimiento',oc:'4530009805',proveedor:injected,estacion:'Temperley'},
    {id:'malicioso',fecha:'2026-10-26\\r\\nBEGIN:VEVENT',tipoEvento:'Falso',oc:'999',proveedor:'Ataque',estacion:'X'}
  ],
  filtrosCalendarioFix:()=>({y:2026,m:9})
});
vm.runInContext(sliceFunction('exportCalendarioFix','esAdminFix')+'\nexportCalendarioFix("ics");',fijo.context,{timeout:2000});
testContent(fijo);
assert.doesNotMatch(fijo.files[0].text,/Falso/,'Fechas invalidas nunca deben exportarse');

for(const name of ['exportCalendarioICS','exportarFichaOCICS','exportarEventosCalendarioOperativo','exportCalendarioFix']){
  const next = {exportCalendarioICS:'descargarArchivo',exportarFichaOCICS:'irEstacionOC',exportarEventosCalendarioOperativo:'cargarFiltrosCalendarioCOIUnificado',exportCalendarioFix:'esAdminFix'}[name];
  const code = sliceFunction(name,next);
  assert.match(code,/coiICSText\(/,'Cada exportador debe escapar campos');
}
console.log('Security V3 ICS: 4 exportadores, CRLF/VEVENT injection, UID y fechas negativas PASS');
