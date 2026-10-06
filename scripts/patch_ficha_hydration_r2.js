#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(file, 'utf8');

const oldResolve = `  function resolveItem(id){
    try{
      const found=typeof window.obtenerOC==='function'?window.obtenerOC(id):null;
      if(found?.item)return found.item;
      if(found&&typeof found==='object')return found;
    }catch(_error){}
    return null;
  }`;

const newResolve = `  function resolveItem(id){
    // Primero usa el resolver contractual canónico, que ya entiende tanto
    // "4530009622" como "OC-4530009622" y devuelve la OC real cargada desde
    // Supabase. Esto evita que el Expediente se monte con un objeto parcial.
    try{
      if(typeof window.resolverOrdenCircuito==='function'){
        const found=window.resolverOrdenCircuito(id);
        if(found?.item)return found.item;
        if(found&&typeof found==='object')return found;
      }
    }catch(_error){}

    try{
      const found=typeof window.obtenerOC==='function'?window.obtenerOC(id):null;
      if(found?.item)return found.item;
      if(found&&typeof found==='object')return found;
    }catch(_error){}

    // Fallback exacto por N° OC para deep-links que llegan sin prefijo OC-.
    try{
      const nro=orderNumber(null,id);
      const all=typeof window.todasLasOC==='function'?window.todasLasOC():[];
      if(nro&&Array.isArray(all)){
        const found=all.find(candidate=>orderNumber(candidate,'')===nro);
        if(found?.item)return found.item;
        if(found&&typeof found==='object')return found;
      }
    }catch(_error){}

    return null;
  }`;

if (!html.includes(oldResolve)) {
  throw new Error('No se encontró el bloque resolveItem esperado; aborta para no parchear a ciegas.');
}
html = html.replace(oldResolve, newResolve);

const oldWrapper = `  const baseRender=typeof window.renderFichaOC==='function'?window.renderFichaOC:null;
  if(baseRender&&!baseRender._coiExpedienteHydrationR1){
    const wrapped=function(id){
      const item=resolveItem(id);
      if(item)hydrateItem(item,item._supabaseRaw);
      const result=baseRender.apply(this,arguments);
      if(item)void refreshFromSupabase(id,item);
      return result;
    };
    Object.defineProperty(wrapped,'_coiExpedienteHydrationR1',{value:true});
    window.renderFichaOC=wrapped;
  }`;

const newWrapper = `  const baseRender=typeof window.renderFichaOC==='function'?window.renderFichaOC:null;
  if(baseRender&&!baseRender._coiExpedienteHydrationR1){
    const wrapped=function(id){
      const item=resolveItem(id);
      if(item)hydrateItem(item,item._supabaseRaw);

      // El renderer histórico de la Ficha sigue resolviendo mejor por idObra
      // ("OC-..."). Para un deep-link por N° OC, traducimos sólo la referencia
      // de entrada; el hash y la identidad persistida no se modifican.
      const args=Array.from(arguments);
      if(item){
        const canonicalRef=item.idObra||item.idOC||item.numeroOC||item.oc||id;
        if(canonicalRef)args[0]=canonicalRef;
      }

      const result=baseRender.apply(this,args);
      if(item)void refreshFromSupabase(id,item);
      return result;
    };
    Object.defineProperty(wrapped,'_coiExpedienteHydrationR1',{value:true});
    window.renderFichaOC=wrapped;
  }`;

if (!html.includes(oldWrapper)) {
  throw new Error('No se encontró el wrapper de hidratación esperado; aborta para no parchear a ciegas.');
}
html = html.replace(oldWrapper, newWrapper);

fs.writeFileSync(file, html, 'utf8');
console.log('OK: hidratación R2 aplicada a index.html');
