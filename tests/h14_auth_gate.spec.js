const { test, expect } = require('@playwright/test');

test('H14 bloquea el sistema sin sesión y muestra el acceso institucional', async ({ page }) => {
  await page.route(/^https?:\/(?!\/127\.0\.0\.1)/, route => route.abort());
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/index.html?h14_force_auth=1', { waitUntil: 'domcontentloaded' });
  const gate = page.locator('#coiAuthGateH14');
  await expect(gate).toBeVisible();
  await expect(page.locator('#coiAuthTitleH14')).toHaveText('COI Línea Roca');
  await expect(page.locator('#coiAuthEmailH14')).toBeVisible();
  await expect(page.locator('#coiAuthPasswordH14')).toHaveAttribute('type','password');
  await expect(page.locator('html')).toHaveClass(/coi-h14-locked/);
  const background = await gate.evaluate(el => getComputedStyle(el).backgroundImage);
  expect(background).toContain('data:image/jpeg;base64');
});
