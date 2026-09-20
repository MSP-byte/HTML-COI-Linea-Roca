const { test, expect } = require('@playwright/test');

/* CAMBIO 2 — Tabla Certificaciones como historial central.
   Fuente única: public.coi_certificaciones + public.coi_ordenes.
   Una misma Acta de Medición con varias posiciones tiene que aparecer UNA
   sola vez, sin perder sus POS.

   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

test.describe.configure({ timeout: 60_000 });

const TBODY = '#certHistTbody';
const OC_A = '4530111111';
const OC_B = '4530222222';
const ID_A = 'aaaa1111-1111-4111-8111-111111111111';
const ID_B = 'bbbb2222-2222-4222-8222-222222222222';

// Una certificación por ítem: así la guarda Carga Certificación.
const FILA = (o) => Object.assign({
  id: 'cert-' + Math.random().toString(36).slice(2),
  orden_id: ID_A, nro_oc: OC_A, acta_medicion_nro: 'AM-001',
  fecha_inicio: '2026-05-01', fecha_fin: '2026-05-31',
  item_nro: '10', descripcion: 'Ítem', posicion: 'POS-10',
  nro_hes: 'HES-900', nro_if: 'IF-500', proveedor: 'CONTRATISTA UNO SA',
  aux_porcentaje: 40, anio: 2026, fecha_actualizacion: '2026-06-01T10:00:00Z'
}, o);

const CERTIFICACIONES = [
  // Acta AM-001 de la OC A: TRES posiciones → una sola fila visual.
  FILA({ posicion: 'POS-10', item_nro: '10', aux_porcentaje: 40 }),
  FILA({ posicion: 'POS-20', item_nro: '20', aux_porcentaje: 55 }),
  FILA({ posicion: 'POS-30', item_nro: '30', aux_porcentaje: 35 }),
  // Acta AM-002 de la misma OC, más reciente.
  FILA({ acta_medicion_nro: 'AM-002', fecha_inicio: '2026-06-01', fecha_fin: '2026-06-30', posicion: 'POS-10', nro_hes: 'HES-901', nro_if: 'IF-501' }),
  // OC B, otro contratista, servicio.
  FILA({
    orden_id: ID_B, nro_oc: OC_B, acta_medicion_nro: 'AM-500',
    fecha_inicio: '2026-04-01', fecha_fin: '2026-04-30',
    proveedor: 'CONTRATISTA DOS SRL', posicion: 'POS-01',
    nro_hes: 'HES-700', nro_if: 'IF-300', aux_porcentaje: 100
  }),
  // Registro histórico SIN acta: no puede perderse.
  FILA({
    id: 'cert-sin-acta', acta_medicion_nro: '', orden_id: ID_B, nro_oc: OC_B,
    fecha_inicio: '2026-03-01', fecha_fin: '2026-03-31', proveedor: 'CONTRATISTA DOS SRL',
    posicion: 'POS-99', nro_hes: '', nro_if: ''
  })
];

async function abrir(page, opciones = {}) {
  const c = Object.assign({ certificaciones: CERTIFICACIONES, fallaLectura: false }, opciones);
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.addInitScript(({ c, ocA, ocB, idA, idB }) => {
    const ordenes = [
      { id: idA, nro_oc: ocA, numeroOC: ocA, oc: ocA, idObra: 'OBRA-' + ocA, tipo: 'Obra', proveedor: 'CONTRATISTA UNO SA', estacion: 'Plaza Constitución' },
      { id: idB, nro_oc: ocB, numeroOC: ocB, oc: ocB, idObra: 'OBRA-' + ocB, tipo: 'Servicio', proveedor: 'CONTRATISTA DOS SRL', estacion: 'Lanús' }
    ];
    ordenes.forEach(o => { o._supabaseRaw = Object.assign({}, o); });
    window.__CERT__ = { ordenes, certificaciones: c.certificaciones.slice(), lecturas: 0 };

    const consulta = (tabla) => {
      const estado = { desde: 0, hasta: 999999 };
      const api = {
        select: () => api, order: () => api, eq: () => api, in: () => api, is: () => api,
        ilike: () => api, gt: () => api, limit: () => api,
        range(a, b) { estado.desde = a; estado.hasta = b; return api; },
        single: async () => ({ data: null, error: null }),
        then(res, rej) {
          if (tabla === 'coi_certificaciones') {
            window.__CERT__.lecturas += 1;
            if (c.fallaLectura) {
              return Promise.resolve({ data: null, error: { code: '42501', message: 'fixture: lectura rechazada' } }).then(res, rej);
            }
            const todas = window.__CERT__.certificaciones;
            return Promise.resolve({ data: todas.slice(estado.desde, estado.hasta + 1), error: null }).then(res, rej);
          }
          return Promise.resolve({ data: [], error: null }).then(res, rej);
        }
      };
      return api;
    };
    const fake = {
      from: consulta,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: { user: { id: idA, email: 'admin@coiroca.com' } } }, error: null }),
        getUser: async () => ({ data: { user: { id: idA, email: 'admin@coiroca.com' } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };
    const instalar = () => {
      window.__COI_SUPABASE_CLIENT__ = fake;
      window.getSupabaseClient = () => fake;
      window.initSupabase = async () => fake;
      // Copia fresca por llamada: los normalizadores de arranque mutan los
      // items que reciben, y el fixture no puede arrastrar esas mutaciones.
      window.todasLasOC = () => ordenes.map(o => ({
        estacion: o.estacion, item: JSON.parse(JSON.stringify(o)),
        idObra: o.idObra, numeroOC: o.nro_oc, tipo: o.tipo, proveedor: o.proveedor
      }));
    };
    instalar();
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  }, { c, ocA: OC_A, ocB: OC_B, idA: ID_A, idB: ID_B });

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__COI_CERT_HISTORIAL__) && typeof window.renderCalendarioCOIUnificado === 'function', null, { timeout: 25000 });
  await page.evaluate(() => {
    window.mostrarVista && window.mostrarVista('vistaCalendarioCOI');
    window.renderCalendarioCOIUnificado();
  });
  await page.locator('#vistaCalendarioCOI.active').waitFor({ state: 'attached', timeout: 25000 });
  await page.click('#btnCalendarioTablaCertificaciones');
  await page.locator('#coiTabCertificaciones.active').waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado || window.__COI_CERT_HISTORIAL__.estado().error, null, { timeout: 20000 });
}

const filasVisibles = page => page.locator(TBODY + ' tr');
const textoFila = (page, acta) => page.locator(TBODY + ' tr', { hasText: acta }).first().innerText();

test('CH-1 · el historial se carga desde Supabase, no desde una caché local', async ({ page }) => {
  await abrir(page);
  await expect(filasVisibles(page)).toHaveCount(4);   // AM-001, AM-002, AM-500 y la histórica sin acta
  const lecturas = await page.evaluate(() => window.__CERT__.lecturas);
  expect(lecturas).toBeGreaterThan(0);
  // No se persiste una segunda fuente de certificaciones.
  const claves = await page.evaluate(() => Object.keys(localStorage).filter(k => /cert/i.test(k)));
  expect(claves).toEqual([]);
});

test('CH-2 · una misma Acta con varias posiciones aparece UNA sola vez', async ({ page }) => {
  await abrir(page);
  await expect(page.locator(TBODY + ' tr', { hasText: 'AM-001' })).toHaveCount(1);
  const fila = await textoFila(page, 'AM-001');
  expect(fila).toContain('3 ítem(s)');
});

test('CH-3 · las POS quedan visibles dentro de la certificación consolidada', async ({ page }) => {
  await abrir(page);
  const fila = await textoFila(page, 'AM-001');
  for (const pos of ['POS-10', 'POS-20', 'POS-30']) expect(fila).toContain(pos);
});

test('CH-4 · la tabla muestra los datos mínimos de consulta', async ({ page }) => {
  await abrir(page);
  const fila = await textoFila(page, 'AM-002');
  expect(fila).toContain(OC_A);
  expect(fila).toContain('Obra');
  expect(fila).toContain('CONTRATISTA UNO SA');
  expect(fila).toContain('01/06/2026');
  expect(fila).toContain('30/06/2026');
  expect(fila).toContain('HES-901');
  expect(fila).toContain('IF-501');
  expect(fila.toUpperCase()).toContain('ABRIR EXPEDIENTE');
});

test('CH-5 · ninguna certificación histórica se pierde, ni siquiera sin acta', async ({ page }) => {
  await abrir(page);
  await expect(page.locator(TBODY + ' tr', { hasText: 'Sin acta' })).toHaveCount(1);
  const fila = await textoFila(page, 'Sin acta');
  expect(fila).toContain('POS-99');
});

test('CH-6 · el orden inicial es más reciente primero', async ({ page }) => {
  await abrir(page);
  const actas = await page.locator(TBODY + ' tr td:nth-child(4)').allInnerTexts();
  expect(actas).toEqual(['AM-002', 'AM-001', 'AM-500', 'Sin acta']);
});

test('CH-7 · el avance % se muestra para Obra y no para Servicio', async ({ page }) => {
  await abrir(page);
  const obra = await textoFila(page, 'AM-001');
  expect(obra).toContain('55%');            // máximo de las posiciones de esa acta
  const servicio = await textoFila(page, 'AM-500');
  expect(servicio).not.toContain('100%');
});

test('CH-8 · el filtro por N° OC funciona', async ({ page }) => {
  await abrir(page);
  await page.fill('#certHistOC', OC_B);
  await expect(filasVisibles(page)).toHaveCount(2);
  const textos = await page.locator(TBODY + ' tr').allInnerTexts();
  textos.forEach(t => expect(t).toContain(OC_B));
  await page.fill('#certHistOC', '');
  await expect(filasVisibles(page)).toHaveCount(4);
});

test('CH-9 · el filtro por contratista funciona', async ({ page }) => {
  await abrir(page);
  await page.selectOption('#certHistProveedor', 'CONTRATISTA DOS SRL');
  await expect(filasVisibles(page)).toHaveCount(2);
  const textos = await page.locator(TBODY + ' tr').allInnerTexts();
  textos.forEach(t => expect(t).toContain('CONTRATISTA DOS SRL'));
});

test('CH-10 · Limpiar restituye el historial completo', async ({ page }) => {
  await abrir(page);
  await page.fill('#certHistOC', OC_A);
  await page.selectOption('#certHistProveedor', 'CONTRATISTA UNO SA');
  await expect(filasVisibles(page)).toHaveCount(2);
  await page.click('#certHistLimpiar');
  await expect(filasVisibles(page)).toHaveCount(4);
});

test('CH-11 · el filtro de Tipo del Calendario también aplica al historial', async ({ page }) => {
  await abrir(page);
  await page.selectOption('#coiTipo', 'Servicio');
  await expect(filasVisibles(page)).toHaveCount(2);
  await page.selectOption('#coiTipo', 'Obra');
  await expect(filasVisibles(page)).toHaveCount(2);
});

test('CH-12 · ABRIR EXPEDIENTE navega a la Ficha de esa OC', async ({ page }) => {
  await abrir(page);
  const fila = page.locator(TBODY + ' tr', { hasText: 'AM-500' }).first();
  await fila.locator('[data-open-oc]').last().click();
  await expect(page.locator('#vistaFichaOC')).toHaveClass(/active/, { timeout: 20000 });
  await expect(page.locator('#fichaOCBody')).toContainText(OC_B, { timeout: 20000 });
});

test('CH-13 · el N° OC de la tabla también abre el expediente', async ({ page }) => {
  await abrir(page);
  const fila = page.locator(TBODY + ' tr', { hasText: 'AM-001' }).first();
  await fila.locator('[data-open-oc]').first().click();
  await expect(page.locator('#vistaFichaOC')).toHaveClass(/active/, { timeout: 20000 });
  await expect(page.locator('#fichaOCBody')).toContainText(OC_A, { timeout: 20000 });
});

test('CH-14 · si Supabase rechaza la lectura se informa y no se inventa historial', async ({ page }) => {
  await abrir(page, { fallaLectura: true });
  await expect(page.locator(TBODY)).toContainText('No se pudo leer el historial');
  const filas = await page.evaluate(() => window.__COI_CERT_HISTORIAL__.filas().length);
  expect(filas).toBe(0);
});
