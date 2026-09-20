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

test('Inicio aplica foco real al shell V2 sin perder navegacion ni buscador', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Cobertura visual del shell V2 de escritorio');
  await openIsolated(page);

  const sidebar = page.locator('#coiV2Sidebar');
  const topbar = page.locator('#coiV2Topbar');
  const dashboard = page.locator('#vistaDashboard');

  await expect(sidebar).toBeVisible();
  await expect(topbar).toBeVisible();
  await expect(page.locator('#coiV2GlobalSearch')).toBeVisible();
  await expect(page.locator('#coiV2Menu')).toBeHidden();
  await expect(page.locator('#coiToggleMotion')).toHaveCount(0);
  await expect(page.locator('#coiFocusMode')).toHaveCount(0);

  const focusMetrics = await page.evaluate(() => {
    const sidebar = document.getElementById('coiV2Sidebar');
    const dashboard = document.getElementById('vistaDashboard');
    const label = sidebar?.querySelector('.v2-label');
    const topbar = document.getElementById('coiV2Topbar');
    const ordersButton = sidebar?.querySelector('[data-v2-view="vistaOrdenes"]');
    return {
      sidebarWidth: sidebar?.getBoundingClientRect().width || 0,
      dashboardLeft: dashboard?.getBoundingClientRect().left || 0,
      topbarLeft: topbar?.getBoundingClientRect().left || 0,
      labelWidth: label?.getBoundingClientRect().width || 0,
      navAria: ordersButton?.getAttribute('aria-label') || '',
      navTitle: ordersButton?.getAttribute('title') || ''
    };
  });

  expect(focusMetrics.sidebarWidth).toBeGreaterThan(40);
  expect(focusMetrics.sidebarWidth).toBeLessThan(110);
  expect(Math.abs(focusMetrics.dashboardLeft - focusMetrics.sidebarWidth)).toBeLessThan(3);
  expect(Math.abs(focusMetrics.topbarLeft - focusMetrics.sidebarWidth)).toBeLessThan(3);
  expect(focusMetrics.labelWidth).toBeLessThanOrEqual(1);
  expect(focusMetrics.navAria).toMatch(/Órdenes/i);
  expect(focusMetrics.navTitle).toMatch(/Órdenes/i);

  // En foco forzado, el control desktop no debe mutar silenciosamente la preferencia normal del sidebar.
  const focusMenuState = await page.evaluate(() => {
    const beforeClass = document.body.classList.contains('coi-v2-sidebar-collapsed');
    const beforeSaved = sessionStorage.getItem('coi_v2_sidebar_collapsed');
    document.getElementById('coiV2Menu')?.click();
    return {
      beforeClass,
      afterClass: document.body.classList.contains('coi-v2-sidebar-collapsed'),
      beforeSaved,
      afterSaved: sessionStorage.getItem('coi_v2_sidebar_collapsed')
    };
  });
  expect(focusMenuState.afterClass).toBe(focusMenuState.beforeClass);
  expect(focusMenuState.afterSaved).toBe(focusMenuState.beforeSaved);

  const ordersNav = page.locator('#coiV2Sidebar [data-v2-view="vistaOrdenes"]');
  await expect(ordersNav).toBeVisible();
  await ordersNav.click();

  await expect(page.locator('#vistaOrdenes')).toHaveClass(/\bactive\b/);
  await expect(page.locator('body')).not.toHaveClass(/\bdashboard-focus-mode\b/);
  await expect(topbar).toBeVisible();
  await expect(page.locator('#coiV2GlobalSearch')).toBeVisible();

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
  await expect(topbar).toBeVisible();
  await expect(page.locator('#coiV2GlobalSearch')).toBeVisible();
});

test('Shell V2 nace con nombres accesibles aun con sidebar colapsado en la sesion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Cobertura del shell V2 de escritorio');
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('coi_v2_sidebar_collapsed', '1');
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.body.classList.contains('coi-v2-ready') && document.getElementById('coiV2Sidebar')));
  await page.evaluate(() => document.body.classList.remove('auth-locked'));

  const result = await page.evaluate(() => [...document.querySelectorAll('#coiV2Sidebar .coi-v2-nav-btn')].map(btn => ({
    aria: btn.getAttribute('aria-label') || '',
    title: btn.getAttribute('title') || '',
    label: btn.querySelector('.v2-label')?.textContent?.trim() || ''
  })));
  expect(result.length).toBeGreaterThan(5);
  expect(result.every(item => item.label && item.aria === item.label && item.title === item.label)).toBe(true);
});
