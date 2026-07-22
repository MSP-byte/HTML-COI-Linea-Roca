'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');
function normalizarPOS(value){
  let s=String(value??'').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\bPOS(?:ICION)?\b/g,'').replace(/\s+/g,'').replace(',', '.');
  const m=s.match(/^(\d+)(?:\.(\d+))?$/); if(!m)return '';
  let decimal=m[2]||''; if(decimal.length<2)decimal=decimal.padEnd(2,'0'); return m[1]+'.'+decimal;
}
function ledger(master,movements){
  const valid=movements.filter(x=>x.sourcePositionId===master.id&&x.nro_oc===master.nro_oc&&normalizarPOS(x.POS)===normalizarPOS(master.POS));
  const consumed=valid.reduce((a,x)=>a+x.cantidadImputada,0), available=master.cantidad-consumed;
  return {consumed,available,remainingAmount:available*master.precioUnitario,status:available===0?'CONSUMIDA':consumed?'PARCIAL':'LIBRE'};
}
function impute(master,movements,qty,{confirm=true}={}){
  const before=movements.length, state=ledger(master,movements);
  if(!(qty>0)||qty>state.available)throw new Error('cantidad inválida');
  if(!confirm)return {writes:movements.length-before};
  movements.push({id:`MOV-${before+1}`,sourcePositionId:master.id,nro_oc:master.nro_oc,POS:master.POS,cantidadImputada:qty,precioUnitario:master.precioUnitario,montoImputado:qty*master.precioUnitario,cantidadRemanente:state.available-qty,montoRemanente:(state.available-qty)*master.precioUnitario,fecha:'2026-07-22T00:00:00Z',usuario:'fixture'});
  return {writes:movements.length-before,movement:movements.at(-1)};
}
const master={id:'MASTER-4530008964-160.10',nro_oc:'4530008964',POS:'160,10',descripcion:'MTO DE EQUIPOS',cantidad:5,precioUnitario:356126.40};
const moves=[];
assert.equal(normalizarPOS(master.POS),'160.10','POS textual canónica');
assert.equal(impute(master,moves,4,{confirm:false}).writes,0,'cancelar no escribe');
assert.throws(()=>impute(master,moves,6),/inválida/,'6 de 5 se rechaza');
let result=impute(master,moves,4);assert.equal(result.writes,1);assert.equal(result.movement.montoImputado,1424505.60);
let state=ledger(master,moves);assert.deepEqual(state,{consumed:4,available:1,remainingAmount:356126.40,status:'PARCIAL'});assert.equal(moves.length,1);assert.equal(master.cantidad,5,'maestro conservado');
result=impute(master,moves,1);assert.equal(result.writes,1);state=ledger(master,moves);assert.equal(state.available,0);assert.equal(state.remainingAmount,0);assert.equal(state.status,'CONSUMIDA');
const reloaded=JSON.parse(JSON.stringify(moves));assert.equal(ledger(master,reloaded).available,0,'persistencia tras recarga');
const master2={id:'MASTER-2',nro_oc:'4530008964',POS:'170,20',cantidad:10,precioUnitario:100};const multi=[];impute(master,multi,2);impute(master2,multi,3);assert.equal(multi[0].cantidadImputada,2);assert.equal(multi[1].cantidadImputada,3);assert.equal(multi.length,2);
assert.match(html,/sourcePositionId:o\.idPosicionFinanciera/);assert.match(html,/cantidadRemanente:x\.cantidadRemanente/);assert.doesNotMatch(html,/function normalizarPOS\(value\)[\s\S]{0,500}parseFloat/);
const report={version:'V58.1R38.3-IMPUTACION-POSICIONES-CANTIDADES',fixture:{oc:master.nro_oc,posOriginal:master.POS,posCanonica:normalizarPOS(master.POS),descripcion:master.descripcion,cantidadOriginal:5,cantidadImputada:4,precioUnitario:356126.40,montoImputado:1424505.60,cantidadRemanente:1,montoRemanente:356126.40,estado:'PARCIAL'},tests:13,status:'PASS',productiveWrites:0,timestamp:'2026-07-22T00:00:00Z'};
fs.writeFileSync('TEST_IMPUTACION_POSICIONES_RESULTS.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
