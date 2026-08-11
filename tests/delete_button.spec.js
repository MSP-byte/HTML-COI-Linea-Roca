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

test('la contención P0 impide confirmar una mutación financiera legacy', async ({ page }) => {
  await openIsolated(page);
  const dialogs = [];
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  const result = await page.evaluate(() => window.consumirPosicionesOC('4530008964'));
  expect(result).toBe(false);
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('Movimiento financiero temporalmente bloqueado');
  const guards = await page.evaluate(() => window.COI_OPERATIONAL_GUARDS);
  expect(guards.financialMutations).toBe(false);
  expect(guards.automaticDuplicateDeletion).toBe(false);
});

test('sin sesión Supabase el borrado no elimina filas locales', async ({ page }) => {
  await openIsolated(page);
  await page.locator('#btnOrdenes').click();
  const rows = page.locator('#ordenesTbody tr');
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  const checkbox = page.locator('.chk-orden-row').first();
  await checkbox.check();
  const button = page.locator('#btnBorrarSeleccionadas');
  if (await button.isEnabled()) {
    page.on('dialog', dialog => dialog.dismiss());
    await button.click();
  }
  await expect(rows).toHaveCount(before);
});
