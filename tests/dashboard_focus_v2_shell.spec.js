const { test, expect } = require('@playwright/test');

async function openIsolated(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(
    document.body.classList.contains('coi-v2-ready') &&
    document.getElementById('coiV2Sidebar') &&
    document.getElementById('coiV2Topbar') &&
    document.getElementById('vistaDashboard')?.classList.contains('active') &&
    document.body.classList.contains('dashboard-focus-mode')
  ));

  // El shell se construye incluso sin red. Para esta prueba visual aislada
  // retiramos solamente el bloqueo de autenticacion, sin simular escrituras.
  await page.evaluate(() => document.body.classList.remove('auth-locked'));
}

test('Inicio aplica foco real al shell V2 y conserva una navegacion compacta', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Cobertura visual del shell V2 de escritorio');
  await openIsolated(page);

  const sidebar = page.locator('#coiV2Sidebar');
  const topbar = page.locator('#coiV2Topbar');
  const dashboard = page.locator('#vistaDashboard');

  await expect(sidebar).toBeVisible();
  await expect(topbar).toBeHidden();
  await expect(page.locator('#coiToggleMotion')).toHaveCount(0);
  await expect(page.locator('#coiFocusMode')).toHaveCount(0);

  const focusMetrics = await page.evaluate(() => {
    const sidebar = document.getElementById('coiV2Sidebar');
    const dashboard = document.getElementById('vistaDashboard');
    const label = sidebar?.querySelector('.v2-label');
    return {
      sidebarWidth: sidebar?.getBoundingClientRect().width || 0,
      dashboardLeft: dashboard?.getBoundingClientRect().left || 0,
      labelDisplay: label ? getComputedStyle(label).display : 'missing'
    };
  });

  expect(focusMetrics.sidebarWidth).toBeGreaterThan(40);
  expect(focusMetrics.sidebarWidth).toBeLessThan(110);
  expect(Math.abs(focusMetrics.dashboardLeft - focusMetrics.sidebarWidth)).toBeLessThan(3);
  expect(focusMetrics.labelDisplay).toBe('none');

  const ordersNav = page.locator('#coiV2Sidebar [data-v2-view="vistaOrdenes"]');
  await expect(ordersNav).toBeVisible();
  await ordersNav.click();

  await expect(page.locator('#vistaOrdenes')).toHaveClass(/\bactive\b/);
  await expect(page.locator('body')).not.toHaveClass(/\bdashboard-focus-mode\b/);
  await expect(topbar).toBeVisible();

  const normalMetrics = await page.evaluate(() => ({
    sidebarWidth: document.getElementById('coiV2Sidebar')?.getBoundingClientRect().width || 0,
    labelDisplay: getComputedStyle(document.querySelector('#coiV2Sidebar .v2-label')).display
  }));
  expect(normalMetrics.sidebarWidth).toBeGreaterThan(110);
  expect(normalMetrics.labelDisplay).not.toBe('none');

  // Regresar a Inicio vuelve a aplicar foco sin un boton manual.
  await page.locator('#coiV2Sidebar [data-v2-view="vistaDashboard"]').click();
  await expect(dashboard).toHaveClass(/\bactive\b/);
  await expect(page.locator('body')).toHaveClass(/\bdashboard-focus-mode\b/);
  await expect(topbar).toBeHidden();
});
