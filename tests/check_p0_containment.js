#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const containment = html.match(/<script id="coi-p0-containment">([\s\S]*?)<\/script>/)?.[1] || '';
const duplicateGuard = html.match(/async function consolidarDuplicadosSupabase\([\s\S]*?\n  }\n\n  async function upsertOrdenSupabase/)?.[0] || '';

assert.ok(containment, 'Debe existir la capa final coi-p0-containment');
assert.match(containment, /window\.consumirPosicionesOC=blockedFinancialMutation/);
assert.match(containment, /window\.finV56GuardarCertificacion=blockedFinancialMutation/);
assert.match(containment, /window\.finV56EliminarCertificacion=blockedFinancialMutation/);
assert.match(containment, /event\.stopImmediatePropagation\(\)/);
assert.match(containment, /financialMutations:false/);

assert.ok(duplicateGuard, 'Debe existir el control de duplicados Supabase');
assert.doesNotMatch(duplicateGuard, /\.delete\s*\(/, 'El diagnóstico de duplicados no puede ejecutar DELETE');
assert.match(duplicateGuard, /eliminación automática está bloqueada/);
assert.match(duplicateGuard, /eliminadas:\s*0/);

let notifications = 0;
const document = {
  readyState: 'complete',
  querySelectorAll: () => [],
  addEventListener: () => {}
};
const window = {
  document,
  alert: () => { notifications += 1; },
  setTimeout: () => {}
};
const context = vm.createContext({
  window,
  document,
  console,
  setTimeout: window.setTimeout
});
vm.runInContext(containment, context, { filename: 'coi-p0-containment.js' });

assert.equal(window.COI_OPERATIONAL_GUARDS.financialMutations, false);
assert.equal(window.COI_OPERATIONAL_GUARDS.automaticDuplicateDeletion, false);
assert.equal(window.consumirPosicionesOC('4530008964'), false);
assert.equal(notifications, 1, 'La operación bloqueada debe informar el motivo al usuario');

console.log('P0 contenido: sin confirmación financiera falsa y sin borrado automático de duplicados.');
