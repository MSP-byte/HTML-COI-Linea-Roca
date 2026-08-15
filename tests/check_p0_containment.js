#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n?/g, '\n');
const contract = html.match(/<script id="coi-financial-rpc-contract">([\s\S]*?)<\/script>/)?.[1] || '';
const duplicateGuard = html.match(/async function consolidarDuplicadosSupabase\([\s\S]*?\n  }\n\n  async function upsertOrdenSupabase/)?.[0] || '';

assert.ok(contract, 'Debe existir la capa final coi-financial-rpc-contract');
assert.doesNotMatch(html, /id="coi-p0-containment"/, 'La contención P0 retirada no debe quedar como código muerto');
assert.match(contract, /await financeApi\(\)\.certificarPosiciones/);
assert.match(contract, /await financeApi\(\)\.actualizarCertificacion/);
assert.match(contract, /await financeApi\(\)\.anularCertificacion/);
assert.match(contract, /randomUUID\(\)/, 'Cada lote debe enviar una clave de idempotencia');
assert.match(contract, /financialMutations:'supabase-rpc-only'/);
assert.doesNotMatch(contract, /posicionesFinancieras\.push/);
assert.doesNotMatch(contract, /guardarPosicionesFinancieras\s*\(/);

assert.ok(duplicateGuard, 'Debe existir el control de duplicados Supabase');
assert.doesNotMatch(duplicateGuard, /\.delete\s*\(/, 'El diagnóstico de duplicados no puede ejecutar DELETE');
assert.match(duplicateGuard, /eliminación automática está bloqueada/);
assert.match(duplicateGuard, /eliminadas:\s*0/);

const positionId = '11111111-1111-4111-8111-111111111111';
const button = { disabled: false, textContent: '' };
const section = {
  querySelectorAll: selector => selector === '.chk-fin-pos-oc:checked' ? [{ dataset: { posId: positionId } }] : [],
  querySelector: selector => selector === '[data-fin-consumir]' ? button : null
};
const document = {
  readyState: 'complete',
  querySelector: () => section,
  querySelectorAll: () => [],
  getElementById: () => ({ value: '' }),
  addEventListener: () => {}
};
const notifications = [];
let rpcCalls = 0;
let shouldFail = true;
const idempotencyKeys = [];
const storage = new Map();
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
const window = {
  document,
  localStorage,
  crypto: { randomUUID: () => '22222222-2222-4222-8222-222222222222' },
  slugOC: value => String(value),
  posicionesFinancieras: [{
    id: positionId,
    idPosicionFinanciera: positionId,
    tipoBloqueFinanciero: 'POSICION_OC',
    precioTotal: 100,
    montoDisponible: 100,
    precioUnitario: 10
  }],
  COI_FINANZAS_SUPABASE: {
    certificarPosiciones: async (_movements, key) => {
      rpcCalls += 1;
      idempotencyKeys.push(key);
      if (shouldFail) throw new TypeError('Failed to fetch');
      return [{ id: '33333333-3333-4333-8333-333333333333' }];
    }
  },
  coiToast: (message, type) => notifications.push({ message, type }),
  renderFichaOC: () => {}
};
const context = vm.createContext({
  window,
  document,
  localStorage,
  console: { log: () => {}, warn: () => {}, error: () => {} },
  CSS: { escape: value => value },
  confirm: () => true,
  prompt: () => null,
  Intl,
  Uint8Array,
  setTimeout: () => {}
});
vm.runInContext(contract, context, { filename: 'coi-financial-rpc-contract.js' });

(async () => {
  assert.equal(window.COI_OPERATIONAL_GUARDS.financialMutations, 'supabase-rpc-only');
  assert.equal(window.COI_OPERATIONAL_GUARDS.automaticDuplicateDeletion, false);

  const rejected = await window.consumirPosicionesOC('4530008964');
  assert.equal(rejected, false);
  assert.equal(rpcCalls, 1);
  assert.equal(notifications.filter(item => item.type === 'ok').length, 0, 'Una RPC rechazada nunca puede mostrar éxito');

  shouldFail = false;
  const confirmed = await window.consumirPosicionesOC('4530008964');
  assert.equal(Array.isArray(confirmed), true);
  assert.equal(rpcCalls, 2);
  assert.equal(idempotencyKeys[0], idempotencyKeys[1], 'El reintento ambiguo debe reutilizar la clave de idempotencia');
  assert.equal(localStorage.getItem('coi_pending_financial_rpc_v1'), null, 'La clave pendiente se limpia sólo después de la confirmación');
  assert.equal(notifications.filter(item => item.type === 'ok').length, 1, 'El éxito se informa sólo después de confirmar la RPC');

  console.log('P0 resuelto: mutaciones financieras sólo por RPC y duplicados en modo diagnóstico.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
