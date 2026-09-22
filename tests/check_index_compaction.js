#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const bytes=Buffer.byteLength(html,'utf8');
assert.ok(bytes<3000000,'index.html debe quedar por debajo de 3.000.000 bytes tras compactación segura');
assert.ok(html.includes('id="coiRocaMapImage" data-coi-src="data:image/png;base64,'),'el plano debe seguir embebido pero diferido');
assert.ok(!html.includes('<image href="data:image/png;base64,'),'el PNG del plano no debe decodificarse durante el arranque');
assert.ok(html.includes("function cargarPlanoRocaDiferido()"),'debe existir el cargador diferido del plano');
assert.ok(html.includes("if(idVista==='vistaRed') cargarPlanoRocaDiferido();"),'abrir Red Roca debe hidratar el plano');
assert.ok(html.includes('const unidadesMantenimientoDemo=[];'),'el inventario UM demo bloqueado por H05 no debe ocupar runtime');
assert.ok(html.includes('const serviciosTecnicosDemo=[];'),'los ST demo bloqueados por H05 no deben ocupar runtime');
assert.ok(html.includes('let serviciosTecnicos=[];'),'ST debe arrancar vacío hasta Supabase');
for(const marker of ['OC-0001/2026','OC-0025/2026','ST-2026-001','ASC-001'])assert.ok(!html.includes(marker),'no debe persistir dato demo operativo: '+marker);
for(const id of ['coi-supabase-principal-v2','coi-h03-observaciones-supabase-first','coi-h05-um-st-supabase-first','coi-h10-cierre-operativo','coi-h10-routing-hash','coi-auth-h14-script','coi-etapa1-pipeline-contractual'])assert.ok(html.includes('id="'+id+'"'),'debe preservarse modulo critico '+id);
const core=html.match(/<script\b[^>]*>([\s\S]*?const estaciones = [\s\S]*?)<\/script>/)?.[1]||'';
assert.ok(core,'debe existir core principal');
const duplicated=["fotoEstacion","selectStation","importRows","handleImport","renderCalendarioVencimientos","renderCalendarioCertificaciones","renderOrdenes","renderBuscador","obtenerOC","abrirFichaOC","renderFichaOC","botonFichaOC","cerrarOC","eliminarFotoOC","opcionesDocOC","renderChecksDocumentales","ordenarVencimientos","renderEstadoFinancieroOC","agregarFilasCargaFinanciera","renderCargaFinanciera","leerFilaFinanciera","filaFinancieraVacia","actualizarFilaFinanciera","finClaveRegistro","guardarCargaFinanciera","limpiarGrillaCargaFinanciera","obtenerPosicionesPorOC","calcularTotalesFinancieros","exportarPosicionesFinancierasCSV","normalizarRegistroFinanciero","obtenerPosicionesFinancierasPorOC","calcularResumenFinancieroOC","guardarObservacionOC"];
for(const name of duplicated){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name.replace(/[$]/g,'\\$&')+'\\s*\\(','g');
  const count=(core.match(re)||[]).length;
  assert.equal(count,1,'la declaración global duplicada '+name+' debe quedar una sola vez');
}
console.log('Compactación segura index.html: OK');
console.log('  bytes:',bytes);
console.log('  mapa: embebido y diferido');
console.log('  demo: retirado del runtime');
console.log('  funciones globales duplicadas: retiradas');
