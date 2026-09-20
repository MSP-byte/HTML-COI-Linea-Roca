const { test, expect } = require('@playwright/test');

test('H11 no lee ni modifica localStorage durante arranque y navegación básica', async ({ page }) => {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());

  await page.addInitScript(() => {
    // Simula residuos de versiones anteriores. H11 no debe consumirlos ni
    // modificarlos: toda persistencia operativa vigente sale de Supabase.
    localStorage.setItem('h11_probe', 'sentinel');
    localStorage.setItem('coi.visual.motion.enabled', '0');
    localStorage.setItem('coi_v2_sidebar_collapsed', '1');

    window.__h11LocalStorageCalls = { get: 0, set: 0, remove: 0, clear: 0, key: 0 };
    const proto = Storage.prototype;
    const originals = {
      getItem: proto.getItem,
      setItem: proto.setItem,
      removeItem: proto.removeItem,
      clear: proto.clear,
      key: proto.key,
    };

    proto.getItem = function (...args) {
      if (this === window.localStorage) window.__h11LocalStorageCalls.get++;
      return originals.getItem.apply(this, args);
    };
    proto.setItem = function (...args) {
      if (this === window.localStorage) window.__h11LocalStorageCalls.set++;
      return originals.setItem.apply(this, args);
    };
    proto.removeItem = function (...args) {
      if (this === window.localStorage) window.__h11LocalStorageCalls.remove++;
      return originals.removeItem.apply(this, args);
    };
    proto.clear = function (...args) {
      if (this === window.localStorage) window.__h11LocalStorageCalls.clear++;
      return originals.clear.apply(this, args);
    };
    proto.key = function (...args) {
      if (this === window.localStorage) window.__h11LocalStorageCalls.key++;
      return originals.key.apply(this, args);
    };
  });

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(
    document.body.classList.contains('coi-v2-ready') &&
    document.getElementById('coiV2Sidebar') &&
    document.getElementById('vistaDashboard')?.classList.contains('active')
  ));

  // La prueba es de persistencia/navegación; no simula autenticación remota.
  await page.evaluate(() => document.body.classList.remove('auth-locked'));
  await page.evaluate(() => document.querySelector('#coiV2Sidebar [data-v2-view="vistaOrdenes"]')?.click());
  await page.waitForFunction(() => document.getElementById('vistaOrdenes')?.classList.contains('active'));
  await page.evaluate(() => document.querySelector('#coiV2Sidebar [data-v2-view="vistaDashboard"]')?.click());
  await page.waitForFunction(() => document.getElementById('vistaDashboard')?.classList.contains('active'));

  const result = await page.evaluate(() => {
    // Copiar contadores ANTES de leer la sonda desde este propio test.
    const calls = { ...window.__h11LocalStorageCalls };
    return {
      calls,
      probe: localStorage.getItem('h11_probe'),
      staleMotion: localStorage.getItem('coi.visual.motion.enabled'),
      staleSidebar: localStorage.getItem('coi_v2_sidebar_collapsed'),
      sessionStorageAvailable: typeof sessionStorage !== 'undefined'
    };
  });

  expect(result.calls).toEqual({ get: 0, set: 0, remove: 0, clear: 0, key: 0 });
  expect(result.probe).toBe('sentinel');
  expect(result.staleMotion).toBe('0');
  expect(result.staleSidebar).toBe('1');
  expect(result.sessionStorageAvailable).toBe(true);
});
