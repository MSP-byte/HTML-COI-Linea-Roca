const { test, expect } = require('@playwright/test');

test.describe('Seguridad de cuenta · regresión de interacción', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  });

  test('el acceso de cambio de contraseña nunca flota sobre controles operativos', async ({ page }) => {
    const button = page.locator('#coiPwdBtn');
    await expect(button).toHaveCount(1);
    const position = await button.evaluate(el => getComputedStyle(el).position);
    expect(position).toBe('static');
  });

  test('el modal cerrado no intercepta interacción y abre/cierra explícitamente', async ({ page }) => {
    const modal = page.locator('#coiPwdModal');
    await expect(modal).toHaveCSS('display', 'none');
    await page.locator('#coiPwdBtn').click();
    await expect(modal).toHaveCSS('display', 'flex');
    await page.locator('#coiPwdCancel').click();
    await expect(modal).toHaveCSS('display', 'none');
  });
});
