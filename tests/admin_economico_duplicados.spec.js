const { test, expect } = require('@playwright/test');

test('resumen económico manual calcula ejecutado y disponible sin mezclar saldo real', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.COI_ADMIN_ECONOMICO_DUPLICADOS?.version === '20261006');
  const r = await page.evaluate(() => ({
    money: window.COI_ADMIN_ECONOMICO_DUPLICADOS.parseMoney('$ 91.700.000,00'),
    pct: window.COI_ADMIN_ECONOMICO_DUPLICADOS.parsePct('72,5'),
    calc: window.COI_ADMIN_ECONOMICO_DUPLICADOS.computeEconomic({
      monto_total: 100000,
      avance_obra_pct: 25,
      saldo_remanente: 12345
    })
  }));
  expect(r.money).toBe(91700000);
  expect(r.pct).toBe(72.5);
  expect(r.calc).toEqual({ amount: 100000, pct: 25, executed: 25000, available: 75000 });
});

test('administrador mantiene acciones visibles con selección lejos del encabezado', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.COI_ADMIN_ECONOMICO_DUPLICADOS?.version === '20261006');
  await page.evaluate(() => {
    window.APP_STATE = Object.assign({}, window.APP_STATE || {}, { role: 'administrador' });
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'chk-orden-row';
    chk.dataset.ordenKey = '4530009623';
    chk.checked = true;
    document.body.appendChild(chk);
    window.COI_ADMIN_ECONOMICO_DUPLICADOS.updateActionBar();
  });
  const bar = page.locator('#coiSelectionActionBar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('1 OC seleccionada');
  await expect(bar.getByRole('button', { name: 'Editar monto/avance' })).toBeEnabled();
  await expect(bar.getByRole('button', { name: 'Resolver duplicado' })).toBeEnabled();
  await expect(bar.getByRole('button', { name: 'Borrar OC' })).toBeEnabled();
});
