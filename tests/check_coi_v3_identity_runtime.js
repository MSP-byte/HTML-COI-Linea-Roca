'use strict';
// Execute the actual inline functions without a network or database session.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
function load(id,expose){
 const marker='<script id="'+id+'">',start=html.indexOf(marker)+marker.length;
 const code=html.slice(start,html.indexOf('</script>',start));
 const ctx={window:{},document:{readyState:'loading',addEventListener(){}},crypto:require('node:crypto').webcrypto};
 vm.createContext(ctx);
 vm.runInContext(code.replace(/\}\)\(\);\s*$/,expose+'\n})();'),ctx);
 return ctx.window;
}
const core=load('coi-v3-core','window.testState=state;');
const oc='4530009805';
core.testState.orders=[{nro_oc:oc,tipo:'Servicio'}];
let result=core.COI_V3.prepare([1,2].map(row=>({row,oc,tipo:'Obra'})));
assert.ok(result.every(r=>r.outcome==='Conflicto'),'Repeated OC must not hide a contractual type conflict');
core.testState.orders=[{nro_oc:oc,tipo:'Obra'},{nro_oc:oc,tipo:'Obra'}];
result=core.COI_V3.prepare([1,2].map(row=>({row,oc,tipo:'Obra'})));
assert.ok(result.every(r=>r.outcome==='Conflicto'),'Repeated OC must not hide multiple remote contracts');
core.testState.orders=[{nro_oc:oc,tipo:'Obra'}];
result=core.COI_V3.prepare([1,2].map(row=>({row,oc,tipo:'Obra'})));
assert.ok(result.every(r=>r.outcome==='Multifila'),'Several works may share a valid OC');
const saver=load('coi-v3-safe-save',`window.resolveTest=(rows,remote=[],selected=[])=>{
 source='obras';proposals=rows;remoteRows=remote;choices=new Map(selected);return resolve();
};`);
const row=(n,sig)=>({fila_excel:n,clave_fuente:null,datos:{identificacion:{perfil_conciliacion:sig}}});
let resolution=saver.resolveTest([row(4,'same'),row(5,'same')]);
assert.equal(resolution.pending.length,2,'Indistinguishable incoming rows require explicit homologation even in an empty portfolio');
const old={clave_fuente:'obra:uuid:11111111-1111-4111-8111-111111111111',huella:'previous',datos:{identificacion:{perfil_conciliacion:'same'}}};
resolution=saver.resolveTest([row(4,'same'),row(5,'same')],[old]);
assert.equal(resolution.pending.length,2,'The first duplicate must not automatically claim an existing identity');
resolution=saver.resolveTest([row(4,'same'),row(5,'same')],[old],[[4,old.clave_fuente],[5,'nuevo']]);
assert.equal(resolution.pending.length,0);
assert.equal(resolution.result[0].clave_fuente,old.clave_fuente);
assert.equal(resolution.result[0].huella_esperada,'previous');
assert.notEqual(resolution.result[1].clave_fuente,old.clave_fuente);
resolution=saver.resolveTest([row(4,'one'),row(5,'two')]);
assert.equal(resolution.pending.length,0,'Distinct interventions may be created without administrative numbers');
assert.notEqual(resolution.result[0].clave_fuente,resolution.result[1].clave_fuente);
assert.throws(()=>saver.resolveTest([row(4,'same'),row(5,'same')],[old],[[4,old.clave_fuente],[5,old.clave_fuente]]),/misma identidad/);
console.log('PASS V3 identity runtime: 12 assertions (contract conflicts, ambiguity, UUID and CAS)');
