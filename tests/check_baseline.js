#!/usr/bin/env node
'use strict';

// Control estatico: deliberadamente no evalua la aplicacion ni abre conexiones.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const failures = [];
const passes = [];

function check(condition, message) {
  (condition ? passes : failures).push(message);
}

check(fs.existsSync(indexPath), 'index.html existe');
if (!fs.existsSync(indexPath)) {
  console.error('❌ index.html existe');
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');
const count = (regex, input = html) => (input.match(regex) || []).length;
const balanced = (tag) => count(new RegExp(`<${tag}\\b`, 'gi')) === count(new RegExp(`</${tag}\\s*>`, 'gi'));

check(count(/<!doctype\s+html\s*>/gi) === 1, 'existe un unico DOCTYPE HTML');
check(!/^\s*(?:<<<<<<<|=======|>>>>>>>)(?:\s|$)/m.test(html), 'no hay marcadores de conflicto Git');
check(balanced('script'), 'las etiquetas script estan balanceadas');
check(balanced('style'), 'las etiquetas style estan balanceadas');
for (const tag of ['html', 'head', 'body']) check(balanced(tag), `las etiquetas ${tag} estan balanceadas`);

const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const scripts = [...html.matchAll(scriptPattern)];
const openingScripts = count(/<script\b/gi);
const inlineScripts = scripts.filter((match) => !/\bsrc\s*=/i.test(match[1]));
check(scripts.length === openingScripts, 'todos los scripts inline pueden extraerse');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coi-baseline-'));
try {
  inlineScripts.forEach((match, index) => {
    const filename = path.join(tempDir, `inline-${String(index + 1).padStart(2, '0')}.js`);
    fs.writeFileSync(filename, match[2], 'utf8');
    const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    check(result.status === 0, `script inline ${index + 1} pasa node --check${result.status === 0 ? '' : `: ${(result.stderr || '').trim()}`}`);
  });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// Los ID declarados dentro de strings/template strings JavaScript son dinamicos,
// por lo que el inventario de ID estaticos se realiza solo sobre el marcado HTML.
const staticMarkup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
const ids = [...staticMarkup.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `no existen IDs HTML estaticos duplicados${duplicateIds.length ? `: ${duplicateIds.join(', ')}` : ''}`);

check(/\b(?:const\s+VERSION\s*=|COI_CONFIG\s*=|version\s*:)/.test(html), 'existe un indicador de version del sistema');
for (const moduleName of [
  'Dashboard', 'Red Línea Roca', 'Órdenes', 'Carga', 'Calendario',
  'Administración', 'Timeline', 'Centro de Alertas'
]) {
  check(html.normalize('NFC').includes(moduleName.normalize('NFC')), `existe el modulo principal ${moduleName}`);
}

// Main no contiene onclick inline: cualquier aparicion futura es una regresion.
check(count(/\bonclick\s*=/gi) === 0, 'no se introducen manejadores onclick inline nuevos');
check(!/\bservice_role\b/i.test(html), 'no aparecen credenciales service_role');
check(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(html), 'no aparecen claves privadas');

for (const message of passes) console.log(`✅ ${message}`);
for (const message of failures) console.error(`❌ ${message}`);
console.log(`\n${passes.length} controles aprobados; ${failures.length} fallidos; ${inlineScripts.length} scripts inline verificados.`);
process.exitCode = failures.length ? 1 : 0;
