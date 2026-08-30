const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/*
  H03 — Observaciones OC con Supabase como unica fuente de verdad.

  Se intercepta PostgREST con page.route(): ninguna prueba toca datos reales.
*/

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

const LEGACY_KEY = 'coi_observaciones_oc';
const MARKER_KEY = 'coi_observaciones_h03_imported_v1';
const TABLA = 'coi_observaciones_oc';

const LEGADO = [
  { idObservacion: 'OBS-LEGACY-1', ocNro: '4530008964', texto: 'LEGADO UNO', estadoObservacion: 'Pendiente', fechaCarga: '2026-01-01T10:00:00.000Z' },
  { idObservacion: 'OBS-LEGACY-2', ocNro: '4530008964', texto: 'LEGADO DOS', estadoObservacion: 'Pendiente', fechaCarga: '2026-01-02T10:00:00.000Z' }
];

const REMOTA = {
  id: '11111111-1111-4111-8111-111111111111',
  orden_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  nro_oc: '4530008964',
  observacion: 'OBSERVACION REMOTA DE SUPABASE',
  estado: 'Pendiente',
  prioridad: 'Normal',
  creado_por: null,
  resuelto_por: null,
  fecha_creacion: '2026-08-30T10:00:00.000Z',
  fecha_resolucion: null
};

// Instala un cliente Supabase falso con sesion activa y registra cada llamada.
async function prepararEntorno(page, opciones) {
  const cfg = Object.assign({ filas: [], legado: null, marker: false, fallaSelect: false, fallaMutacion: false }, opciones);

  await page.addInitScript((c) => {
    window.__H03_LLAMADAS__ = [];
    if (c.legado) localStorage.setItem('coi_observaciones_oc', JSON.stringify(c.legado));
    if (c.marker) localStorage.setItem('coi_observaciones_h03_imported_v1', '1');

    const registrar = (op, payload) => window.__H03_LLAMADAS__.push({ op, payload });
    let filas = c.filas.slice();

    function constructorConsulta(tabla) {
      const estado = { tabla, filtro: null, patch: null };
      const api = {
        select() { return api; },
        order() { return api; },
        eq(col, val) { estado.filtro = { col, val }; return api; },
        single() { return api._resolver(true); },
        insert(fila) {
          estado.op = 'insert';
          estado.payload = fila;
          return api;
        },
        update(patch) {
          estado.op = 'update';
          estado.patch = patch;
          return api;
        },
        delete() { estado.op = 'delete'; return api; },
        _resolver(unico) {
          if (estado.tabla !== 'coi_observaciones_oc') return Promise.resolve({ data: [], error: null });
          if (estado.op === 'insert') {
            registrar('insert', estado.payload);
            if (c.fallaMutacion) return Promise.resolve({ data: null, error: { message: 'RLS denegado' } });
            const creada = Object.assign({
              id: '99999999-9999-4999-8999-999999999999',
              fecha_creacion: new Date().toISOString(),
              fecha_resolucion: null, resuelto_por: null
            }, estado.payload);
            filas = [creada].concat(filas);
            return Promise.resolve({ data: unico ? creada : [creada], error: null });
          }
          if (estado.op === 'update') {
            registrar('update', { filtro: estado.filtro, patch: estado.patch });
            if (c.fallaMutacion) return Promise.resolve({ data: null, error: { message: 'RLS denegado' } });
            const i = filas.findIndex((f) => f.id === (estado.filtro && estado.filtro.val));
            if (i < 0) return Promise.resolve({ data: [], error: null });
            filas[i] = Object.assign({}, filas[i], estado.patch);
            return Promise.resolve({ data: [filas[i]], error: null });
          }
          if (estado.op === 'delete') {
            registrar('delete', estado.filtro);
            return Promise.resolve({ data: [], error: null });
          }
          registrar('select', null);
          if (c.fallaSelect) return Promise.resolve({ data: null, error: { message: 'fallo de red' } });
          return Promise.resolve({ data: filas.slice(), error: null });
        },
        then(res, rej) { return api._resolver(false).then(res, rej); }
      };
      return api;
    }

    const fake = {
      from: (t) => constructorConsulta(t),
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@coiroca.com' } } },
          error: null
        }),
        getUser: async () => ({ data: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };
    window.__COI_SUPABASE_CLIENT__ = fake;
    window.getSupabaseClient = () => fake;
  }, cfg);

  // Ninguna llamada real sale del navegador.
  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, body: '{}' }));
}

async function abrir(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.__COI_OBS_H03__), null, { timeout: 20000 });
  await page.waitForFunction(
    () => window.__COI_OBS_H03__ && window.__COI_OBS_H03__.origen !== 'inicial',
    null,
    { timeout: 20000 }
  );
  return errores;
}

const estado = (page) => page.evaluate(() => ({
  origen: window.__COI_OBS_H03__.origen,
  observaciones: (window.observacionesOC || []).map((o) => ({
    id: o.idObservacion, texto: o.texto, estado: o.estadoObservacion,
    origenFila: o._origen, soloLectura: Boolean(o._soloLectura)
  })),
  legacyKey: localStorage.getItem('coi_observaciones_oc'),
  marker: localStorage.getItem('coi_observaciones_h03_imported_v1'),
  llamadas: window.__H03_LLAMADAS__
}));

// ---------------------------------------------------------------- 1
test('Supabase con filas manda sobre el legado local', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA], legado: LEGADO });
  const errores = await abrir(page);
  const e = await estado(page);

  expect(e.origen).toBe('supabase');
  expect(e.observaciones).toHaveLength(1);
  expect(e.observaciones[0].texto).toBe('OBSERVACION REMOTA DE SUPABASE');
  expect(e.observaciones.map((o) => o.texto)).not.toContain('LEGADO UNO');
  // La clave legacy no se borra: queda intacta para la importacion controlada.
  expect(e.legacyKey).not.toBeNull();
  expect(errores).toEqual([]);
});

// ---------------------------------------------------------------- 2
test('Supabase vacio sin marker muestra el legado en solo lectura', async ({ page }) => {
  await prepararEntorno(page, { filas: [], legado: LEGADO });
  await abrir(page);
  const e = await estado(page);

  expect(e.origen).toBe('legacy-readonly');
  expect(e.observaciones).toHaveLength(2);
  expect(e.observaciones.every((o) => o.soloLectura)).toBe(true);
  expect(e.marker).toBeNull();
});

// ---------------------------------------------------------------- 3
test('Supabase vacio con marker no resucita el legado', async ({ page }) => {
  await prepararEntorno(page, { filas: [], legado: LEGADO, marker: true });
  await abrir(page);
  const e = await estado(page);

  expect(e.origen).toBe('supabase');
  expect(e.observaciones).toHaveLength(0);
  expect(e.legacyKey).not.toBeNull(); // sigue ahi, simplemente no se usa
});

// ---------------------------------------------------------------- 4
test('crear una observacion genera INSERT en coi_observaciones_oc', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);

  await page.evaluate(() => {
    window.todasLasOC = () => ([{ oc: '4530008964', item: { numeroOC: '4530008964', supabaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }]);
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'NUEVA OBSERVACION DE PRUEBA';
    document.body.appendChild(ta);
    window.guardarObservacionOC('4530008964');
  });
  await page.waitForTimeout(600);
  const e = await estado(page);

  const inserts = e.llamadas.filter((l) => l.op === 'insert');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.observacion).toBe('NUEVA OBSERVACION DE PRUEBA');
  expect(inserts[0].payload.nro_oc).toBe('4530008964');
  expect(inserts[0].payload.orden_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  expect(inserts[0].payload.creado_por).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(inserts[0].payload.estado).toBe('Pendiente');
});

// ---------------------------------------------------------------- 5
test('editar genera UPDATE por UUID', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);

  await page.evaluate(() => { window.prompt = () => 'TEXTO EDITADO'; });
  await page.evaluate((id) => window.editarObservacionR13(id), REMOTA.id);
  await page.waitForTimeout(600);
  const e = await estado(page);

  const updates = e.llamadas.filter((l) => l.op === 'update');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.filtro).toEqual({ col: 'id', val: REMOTA.id });
  expect(updates[0].payload.patch.observacion).toBe('TEXTO EDITADO');
});

// ---------------------------------------------------------------- 6
test('resolver actualiza estado, resuelto_por y fecha_resolucion', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);

  await page.evaluate(() => { window.prompt = () => ''; });
  await page.evaluate((id) => window.resolverObservacionOC(id), REMOTA.id);
  await page.waitForTimeout(600);
  const e = await estado(page);

  const updates = e.llamadas.filter((l) => l.op === 'update');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.filtro.val).toBe(REMOTA.id);
  expect(updates[0].payload.patch.estado).toBe('Resuelta');
  expect(updates[0].payload.patch.resuelto_por).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(updates[0].payload.patch.fecha_resolucion).toBeTruthy();
});

// ---------------------------------------------------------------- 7
test('Centro de Alertas genera exactamente un INSERT remoto y ninguna copia local', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);

  await page.evaluate(() => {
    window.todasLasOC = () => ([{ oc: '4530008964', item: { numeroOC: '4530008964', supabaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }]);
    window.agregarObservacionDesdeAlertaR13('4530008964', 'ACCION SUGERIDA DESDE ALERTA');
  });
  await page.waitForTimeout(600);
  const e = await estado(page);

  const inserts = e.llamadas.filter((l) => l.op === 'insert');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.observacion).toBe('ACCION SUGERIDA DESDE ALERTA');
  // El legado no recibe la copia: la clave sigue sin existir.
  expect(e.legacyKey).toBeNull();
});

// ---------------------------------------------------------------- 8
test('si la mutacion remota falla no queda una observacion falsa', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true, fallaMutacion: true });
  await abrir(page);

  await page.evaluate(() => {
    window.todasLasOC = () => ([{ oc: '4530008964', item: { numeroOC: '4530008964', supabaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }]);
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'OBSERVACION QUE DEBE FALLAR';
    document.body.appendChild(ta);
    window.guardarObservacionOC('4530008964');
  });
  await page.waitForTimeout(800);
  const e = await estado(page);

  expect(e.observaciones).toHaveLength(0);
  expect(e.legacyKey).toBeNull(); // no se escribio fallback local
});

// ---------------------------------------------------------------- 9
test('ningun writer activo persiste observaciones en localStorage', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);

  const resultado = await page.evaluate(() => {
    const escrituras = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      escrituras.push(k);
      return original.call(this, k, v);
    };
    try {
      window.v65GuardarObservacionesOC();
      if (typeof window.v65MigrarObservacionesLegacy === 'function') window.v65MigrarObservacionesLegacy({});
    } finally {
      Storage.prototype.setItem = original;
    }
    return escrituras.filter((k) => k === 'coi_observaciones_oc');
  });

  expect(resultado).toEqual([]);

  // El choke point historico existe pero no persiste: las capas que hacen
  // «else localStorage.setItem(...)» nunca entran a esa rama.
  expect(SOURCE).toContain('window.v65GuardarObservacionesOC = function ()');
});

// ---------------------------------------------------------------- 10
test('un segundo contexto ve la observacion que vino de Supabase', async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);
  const primero = await estado(page);
  await ctx.close();

  // Contexto nuevo: localStorage vacio, sin legado, misma respuesta remota.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await prepararEntorno(page2, { filas: [REMOTA] });
  await abrir(page2);
  const segundo = await estado(page2);
  await ctx2.close();

  expect(primero.observaciones[0].texto).toBe('OBSERVACION REMOTA DE SUPABASE');
  expect(segundo.origen).toBe('supabase');
  expect(segundo.observaciones).toHaveLength(1);
  expect(segundo.observaciones[0].texto).toBe('OBSERVACION REMOTA DE SUPABASE');
  expect(segundo.legacyKey).toBeNull(); // no hizo falta ningun dato local
});
