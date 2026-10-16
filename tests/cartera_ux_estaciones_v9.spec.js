const { test, expect } = require('@playwright/test');

test('Cartera y Red Roca: referencias ferroviarias, contraste y mapa conservados', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.COI_REFERENCIAS_ESTACIONES?.registros)).toBe(50);
  const reference = await page.evaluate(() => ({
    quilmes: window.COI_REFERENCIAS_ESTACIONES.get('Quilmes'),
    plaza: window.COI_REFERENCIAS_ESTACIONES.get('Plaza Constitución'),
    ambiguous: window.COI_REFERENCIAS_ESTACIONES.get('Bosques'),
    incomplete: window.COI_REFERENCIAS_ESTACIONES.get('Cañuelas')
  }));
  expect(reference.quilmes).toEqual(['Quilmes','QL',17.249,'Quilmes',2.671]);
  expect(reference.plaza[1]).toBe('PC');
  expect(reference.ambiguous).toBeNull();
  expect(reference.incomplete).toBeNull();

  await page.evaluate(() => document.getElementById('coiV8V2Nav').click());
  await expect(page.locator('#vistaCarteraObrasV8')).toHaveClass(/active/);
  await expect(page.locator('#cartera-v9-ux-css')).toHaveCount(1);
  await expect(page.locator('#cv2ChartEstado')).toHaveCount(1);
  await page.evaluate(() => {
    document.getElementById('pTitle').textContent = 'Quilmes';
    document.getElementById('panel').replaceChildren(document.createElement('div'));
  });
  await expect(page.locator('#panel .cv9-rail-info')).toContainText('Km 17,249');
  await expect(page.locator('#panel .cv9-rail-info')).toContainText('QL');
  await page.evaluate(() => {
    document.getElementById('pTitle').textContent = 'Bosques';
    document.getElementById('panel').replaceChildren(document.createElement('div'));
  });
  await expect(page.locator('#panel .cv9-rail-info')).toHaveCount(0);
});

test('Red Roca: nombres canónicos abreviados abren fichas con referencias ferroviarias', async ({ page }) => {
  await page.goto('/index.html', {waitUntil: 'domcontentloaded'});
  await page.locator('#btnRed').evaluate(el => el.click());
  const cases = [
    ['H. Yrigoyen', 'Yrigoyen', 2.84],
    ['R. de Escalada', 'R.Escalada', 11.212],
    ['Ardigó', 'D. Ardigo', 26.701],
    ['Luis Gullón', 'L.Guillon', 23540]
  ];
  for (const [station, sourceName, kilometer] of cases) {
    // SVG hotspots tienen el nombre exacto en data-nombre, no texto propio.
    const hotspot = page.locator('#hotspots .station-hotspot[data-nombre="' + station + '"]');
    await expect(hotspot).toHaveCount(1);
    await hotspot.dispatchEvent('click');
    await expect(page.locator('#pTitle')).toContainText(station);
    await expect(page.locator('#panel .cv9-rail-info')).toContainText('Datos ferroviarios de referencia');
    const row = await page.evaluate(name => window.COI_REFERENCIAS_ESTACIONES.get(name), station);
    expect(row?.[0]).toBe(sourceName);
    expect(row?.[2]).toBe(kilometer);
  }
});
