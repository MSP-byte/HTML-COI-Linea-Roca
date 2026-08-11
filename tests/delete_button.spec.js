const { test, expect } = require('@playwright/test');

async function openIsolated(page) {
  await page.route(/^https?:\/(?!\/127\.0\.0\.1)/, route => route.abort());
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
}

test('los módulos principales mantienen una única vista activa', async ({ page }) => {
  await openIsolated(page);
  const routes = [
    ['#btnDashboard', '#vistaDashboard'],
    ['#btnRed', '#vistaRed'],
    ['#btnCalendarioCOI', '#vistaCalendarioCOI'],
    ['#btnOrdenes', '#vistaOrdenes'],
    ['#btnCarga', '#vistaCarga'],
    ['#btnAcercaSistema', '#vistaAcercaSistema'],
  ];
  for (const [button, view] of routes) {
    await page.locator(button).click();
    await expect(page.locator(view)).toHaveClass(/\bactive\b/);
    await expect(page.locator('section.view.active')).toHaveCount(1);
  }
});

test('sin sesión la RPC financiera rechaza la mutación sin éxito falso', async ({ page }) => {
  await openIsolated(page);
  await page.waitForFunction(() => Boolean(window.COI_FINANZAS_SUPABASE?.certificarPosiciones));
  const result = await page.evaluate(async () => {
    try {
      await window.COI_FINANZAS_SUPABASE.certificarPosiciones([{
        posicion_id: '11111111-1111-4111-8111-111111111111',
        cantidad: 1,
        monto: 100
      }], '22222222-2222-4222-8222-222222222222', { origen: 'e2e' });
      return { ok: true, message: '' };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  });
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/sesión|Supabase|cliente/i);
  const guards = await page.evaluate(() => window.COI_OPERATIONAL_GUARDS);
  expect(guards.financialMutations).toBe('supabase-rpc-only');
  expect(guards.automaticDuplicateDeletion).toBe(false);
});

test('sin sesión Supabase el borrado no elimina filas locales', async ({ page }) => {
  await openIsolated(page);
  await page.waitForFunction(() => typeof window.eliminarOrdenesPersistentesV60 === 'function');
  const result = await page.evaluate(async () => {
    const before = typeof window.todasLasOC === 'function' ? window.todasLasOC().length : -1;
    try {
      await window.eliminarOrdenesPersistentesV60([{
        id: '11111111-1111-4111-8111-111111111111',
        nro_oc: '4530008000',
        numeroOC: '4530008000'
      }]);
      return { ok: true, before, after: typeof window.todasLasOC === 'function' ? window.todasLasOC().length : -1, message: '' };
    } catch (error) {
      return { ok: false, before, after: typeof window.todasLasOC === 'function' ? window.todasLasOC().length : -1, message: error?.message || String(error) };
    }
  });
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/sesión|Supabase|cliente/i);
  expect(result.after).toBe(result.before);
});

test('sin sesión no se exponen órdenes ni posiciones sembradas en caché', async ({ page }) => {
  await page.route(/^https?:\/(?!\/127\.0\.0\.1)/, route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('coi_supabase_ordenes_cache_v2', JSON.stringify({
      savedAt: new Date().toISOString(),
      orders: [{ id: '11111111-1111-4111-8111-111111111111', nro_oc: 'CACHE-OC-1', id_obra: 'CACHE-1', tipo: 'Obra', estacion: 'Temperley', proveedor: 'Dato sensible' }]
    }));
    localStorage.setItem('coi_cache_posiciones_oc_supabase_v1', JSON.stringify({
      version: 2,
      source: 'Supabase',
      positions: [{ id: '22222222-2222-4222-8222-222222222222', nro_oc: 'CACHE-OC-1', posicion: '10.00', cantidad_total: 1, monto_total: 100 }],
      consumptions: [],
      rows: [{ id: '22222222-2222-4222-8222-222222222222', nro_oc: 'CACHE-OC-1', posicion: '10.00', cantidad_total: 1, monto_total: 100 }]
    }));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.verificarSesionSupabase === 'function');
  await page.evaluate(() => window.verificarSesionSupabase());
  await expect.poll(() => page.evaluate(() => (typeof window.todasLasOC === 'function' ? window.todasLasOC().length : -1))).toBe(0);
  await expect.poll(() => page.evaluate(() => (window.posicionesFinancieras || []).length)).toBe(0);
  await page.evaluate(() => window.logoutSupabase());
  expect(await page.evaluate(() => localStorage.getItem('coi_supabase_ordenes_cache_v2'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('coi_cache_posiciones_oc_supabase_v1'))).toBeNull();
});
