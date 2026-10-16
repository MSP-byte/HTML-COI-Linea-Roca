'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cssTree = require('css-tree');

const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const js = fs.readFileSync(path.join(root,'assets/coi-v2-mantenimiento.js'),'utf8');
const css = fs.readFileSync(path.join(root,'assets/coi-v2-mantenimiento.css'),'utf8');

assert.equal((html.match(/src="assets\/coi-v2-mantenimiento\.js"/g)||[]).length,1,'Script V2 debe cargarse una sola vez');
assert.equal((html.match(/href="assets\/coi-v2-mantenimiento\.css"/g)||[]).length,1,'Estilos V2 deben cargarse una sola vez');
assert.ok(html.includes('id="coi-v581r28-contractual-ct-script"'),'No alterar Control de Terceros existente');
assert.ok(html.includes('id="cartera-v8-p2-script"'),'No eliminar Cartera V8/V9');
assert.ok(html.includes('id="red-roca-referencias-v9"'),'No eliminar referencias de Red Roca');
assert.doesNotThrow(()=>new Function(js),'Nuevo script V2 debe ser JS sintácticamente válido');

const errors=[];
cssTree.parse(css,{onParseError:err=>errors.push(err.message)});
assert.deepEqual(errors,[],'El CSS nuevo debe parsear');
assert.match(js,/window\.todasLasOC/,'La nueva pantalla lee el catálogo existente');
assert.match(js,/sessionReady\(\)/,'La lectura debe exigir sesión');
assert.match(js,/modalidad_certificacion/,'Debe utilizar la modalidad contractual');
assert.match(js,/Mantenimiento/,'La sección debe identificar servicios');
assert.match(js,/window\.COI_V2\.openOC/,'Debe conservar Ficha OC original');
assert.match(js,/new Set\(\)/,'No duplicar OC multiestación');
assert.doesNotMatch(js,/\b(?:localStorage|sessionStorage)\b/,'No crear cachés de datos alternativos');
assert.doesNotMatch(js,/\.from\(['"]coi_ordenes['"]\)/,'No acceder a Supabase por una ruta paralela');
assert.doesNotMatch(js,/\.(?:insert|update|upsert|delete)\s*\(/,'Nueva vista debe ser solo lectura');

console.log('OK: COI V2 Mantenimiento aditivo, sintaxis, CSS, rutas, sesión y no-escritura');
