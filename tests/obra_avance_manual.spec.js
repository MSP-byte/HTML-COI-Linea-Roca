const { test, expect } = require('@playwright/test');

test.describe('H12 · avance manual de Obra', () => {
  test('expone parseo y formato de porcentaje 0-100 con coma decimal', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.COI_OBRA_PROGRESS_MANUAL?.version === 'H12');
    const values = await page.evaluate(() => ({
      comma: window.COI_OBRA_PROGRESS_MANUAL.parsePercent('72,5'),
      hundred: window.COI_OBRA_PROGRESS_MANUAL.parsePercent('100'),
      empty: window.COI_OBRA_PROGRESS_MANUAL.parsePercent(''),
      invalid: Number.isNaN(window.COI_OBRA_PROGRESS_MANUAL.parsePercent('101')),
      formatted: window.COI_OBRA_PROGRESS_MANUAL.formatPercent(72.5)
    }));
    expect(values).toEqual({ comma: 72.5, hundred: 100, empty: null, invalid: true, formatted: '72,5%' });
  });

  test('el HTML separa Acta de Medición y porcentaje manual', async ({ page }) => {
    await page.goto('/index.html');
    const source = await page.locator('html').evaluate(() => document.documentElement.innerHTML);
    expect(source).toContain('data-coi-obra-latest-acta');
    expect(source).toContain('data-coi-obra-progress-manual');
    expect(source).toContain('coi_actualizar_avance_obra');
  });
});
