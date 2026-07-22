#!/usr/bin/env node
const fs=require('fs'),html=fs.readFileSync('index.html','utf8');
const tokens=['V58.1R38.3-IMPUTACION-POSICIONES-CANTIDADES','function normalizarPOS(value)','data-fin-cantidad-imputar','data-position-id','data-nro-oc','data-pos-key','source_position_id','cantidad_imputada','monto_imputado','cantidad_remanente','monto_remanente','Renglones seleccionados: ','Unidades a imputar: ','window.coiParseMontoAR'];
for(const token of tokens)if(!html.includes(token))throw new Error(`Falta: ${token}`);
if(/data-fin-consumir[^>]*onclick=/i.test(html))throw new Error('onclick inline no permitido');
if(/function normalizarPOS\([^)]*\)\s*\{[\s\S]{0,500}(?:parseFloat|Number\(m\[0\]\))/m.test(html))throw new Error('La normalización activa convierte POS a número');
console.log(JSON.stringify({status:'pass',checks:tokens.length+2},null,2));
