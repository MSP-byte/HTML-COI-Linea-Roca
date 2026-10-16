const { test, expect } = require('@playwright/test');

test('Red Roca: clic sobre hotspot Quilmes abre ficha y referencia ferroviaria', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.COI_REFERENCIAS_ESTACIONES?.registros)).toBe(50);
  // Navegar con el mecanismo real de la aplicación: render del plano y evento de su hotspot.
  await page.evaluate(() => document.getElementById('btnRed').click());
  const hotspot = page.locator('#hotspots .station-hotspot[data-nombre="Quilmes"]');
  await expect(hotspot).toHaveCount(1);
  await hotspot.dispatchEvent('click');
  await expect(page.locator('#pTitle')).toHaveText(/(?:Ficha de la Estación\s*[—–:-]\s*)?Quilmes/);
  await expect(page.locator('#panelEstacion')).toHaveClass(/active/);
  await expect(page.locator('#panel .station-summary')).toHaveCount(1);
  const reference = page.locator('#panel .cv9-rail-info');
  await expect(reference).toContainText('QL');
  await expect(reference).toContainText('Km 17,249');
  await expect(reference).toContainText('2,671 km');

  // Una estación sin referencia inequívoca nunca debe heredar la anterior.
  const bosques = page.locator('#hotspots .station-hotspot[data-nombre="Bosques"]');
  await expect(bosques).toHaveCount(1);
  await bosques.dispatchEvent('click');
  await expect(page.locator('#pTitle')).toHaveText(/(?:Ficha de la Estación\s*[—–:-]\s*)?Bosques/);
  await expect(page.locator('#panel .cv9-rail-info')).toHaveCount(0);
});

test('Cartera: contraste calculado de KPI en modo oscuro y claro', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#coiV8V2Nav').evaluate(el => el.click());
  await expect(page.locator('#vistaCarteraObrasV8')).toHaveClass(/active/);

  for (const light of [false, true]) {
    const measured = await page.evaluate(lightMode => {
      document.body.classList.toggle('coi-v2-light', lightMode);
      const host = document.getElementById('vistaCarteraObrasV8');
      const card = host.querySelector('.cv2-kpi');
      const value = card.querySelector('strong');

      // Chromium retorna rgb(r, g, b): usar el formato efectivo, sin regex escapadas.
      const rgb = color => {
        const start = color.indexOf('('), end = color.lastIndexOf(')');
        if (!color.startsWith('rgb') || start < 0 || end < 0) throw new Error('Color no RGB: ' + color);
        const channels = color.slice(start + 1, end).split(',').map(item => Number.parseFloat(item.trim()));
        if (channels.length < 3 || channels.slice(0, 3).some(x => !Number.isFinite(x))) {
          throw new Error('Canales RGB invalidos: ' + color);
        }
        return channels.slice(0, 3);
      };
      const luminance = color => {
        const channels = rgb(color).map(channel => {
          const x = channel / 255;
          return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };

      const background = getComputedStyle(card).backgroundColor;
      const foreground = getComputedStyle(value).color;
      const a = luminance(background), b = luminance(foreground);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return { ratio, background, foreground, lightMode, cssPresent: !!document.getElementById('cartera-v9-ux-css') };
    }, light);
    expect(measured.cssPresent).toBe(true);
    expect(Number.isFinite(measured.ratio), JSON.stringify(measured)).toBe(true);
    expect(measured.ratio, JSON.stringify(measured)).toBeGreaterThanOrEqual(4.5);
  }
});
