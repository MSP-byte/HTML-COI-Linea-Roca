const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html','utf8');

assert(html.includes('id="coi-h15-executive-auth-style"'), 'falta estilo ejecutivo H15');
assert(html.includes('SISTEMA INSTITUCIONAL'), 'falta identidad institucional del login H15');
assert(html.includes('linear-gradient(135deg,#061925 0%,#0a2d43 48%,#0f5f91 100%)'), 'falta fondo ejecutivo sin foto');

assert(html.includes('function progressValue(r)'), 'falta normalizador de avance visual');
assert(html.includes('function progressMarkup(r)'), 'falta renderer de barra en Órdenes');
assert(html.includes('class="coi-progress-inline"'), 'falta barra visual de avance en Órdenes');
assert(html.includes('class="coi-progress-inline-fill"'), 'falta relleno de barra en Órdenes');
assert(html.includes('innerHTML=progressMarkup(r)'), 'Órdenes debe renderizar la barra desde avance_obra_pct');
assert(html.includes("if(fold(typeOf(r))!=='OBRA')return '<span class=\"coi-progress-na\">—</span>';"), 'Servicios no deben mostrar barra de avance');

assert(html.includes('data-coi-manual-progress-bar'), 'falta barra de avance en Expediente Digital/Ficha OC');
assert(html.includes('data-coi-manual-progress-fill'), 'falta relleno de barra en Expediente Digital/Ficha OC');
assert(html.includes("c.rpc('coi_actualizar_avance_obra'"), 'el guardado debe seguir usando el RPC canónico Supabase');
assert(html.includes('bar.dataset.complete=pct>=100'), 'la barra de ficha debe actualizarse al guardar');
assert(html.includes('fill.style.width=`${pct}%`'), 'el relleno de ficha debe actualizarse al guardar');

console.log('H15 executive login + progress visual: OK');