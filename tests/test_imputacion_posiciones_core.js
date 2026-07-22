#!/usr/bin/env node
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('index.html','utf8');
function functionSource(name){
  const start=html.indexOf(`function ${name}(`);assert(start>=0,`No existe ${name}`);
  const brace=html.indexOf('{',start);let depth=0,quote='',escaped=false;
  for(let i=brace;i<html.length;i++){
    const c=html[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')depth++;else if(c==='}'&&--depth===0)return html.slice(start,i+1);
  }
  throw new Error(`Función incompleta: ${name}`);
}
const context={Number,Math,String,isFinite};vm.createContext(context);
for(const name of ['normalizarCantidadFinanciera','normalizarPOS','finR31RedondearMonto'])vm.runInContext(functionSource(name),context);
assert.strictEqual(context.normalizarPOS('160,10'),'160.10');
assert.strictEqual(context.normalizarPOS('160.10'),'160.10');
assert.strictEqual(context.normalizarPOS('160,1'),'160.1');
assert.notStrictEqual(context.normalizarPOS('160,10'),context.normalizarPOS('160,1'));
assert.notStrictEqual(context.normalizarPOS('160,10'),context.normalizarPOS('16010'));
assert.strictEqual(context.normalizarCantidadFinanciera('4,5'),4.5);
assert.strictEqual(context.normalizarCantidadFinanciera('4.5'),4.5);
const unit=356126.40,used=context.finR31RedondearMonto(4*unit),remaining=context.finR31RedondearMonto((5-4)*unit);
assert.strictEqual(used,1424505.60);assert.strictEqual(remaining,356126.40);
console.log(JSON.stringify({status:'pass',pos_key:'160.10',cantidad_imputada:4,monto_imputado:used,cantidad_remanente:1,monto_remanente:remaining},null,2));
