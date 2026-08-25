const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '..', 'index.html');
const SOURCE = fs.readFileSync(INDEX_PATH, 'utf8');

function extractFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`No se pudo extraer ${startMarker}`);
  return source.slice(start, end);
}

function buildExpirySorter() {
  const code = extractFunction(
    SOURCE,
    'function ordenarOrdenesPorVencimiento',
    'function asegurarSelectorOrdenVencimiento'
  );
  return new Function(
    'diasHastaVencimientoOrden',
    `${code}; return ordenarOrdenesPorVencimiento;`
  )(row => row.days);
}

async function openApp(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(document.getElementById('dashboardInteractivoMount')));
  await page.waitForTimeout(250);
}

test('Inicio operativo elimina Periodo y Ramal sin dejar filtros invisibles', async ({ page }) => {
  await openApp(page);

  await expect(page.locator('#d33Period')).toHaveCount(0);
  await expect(page.locator('#d33Branch')).toHaveCount(0);
  await expect(page.locator('#d33Type')).toHaveCount(1);
  await expect(page.locator('#d33Provider')).toHaveCount(1);
  await expect(page.locator('#d33Station')).toHaveCount(1);
  await expect(page.locator('#d33Status')).toHaveCount(1);
  await expect(page.locator('#d33Clear')).toHaveCount(1);

  const filters = await page.evaluate(() => ({
    period: window.dashboardFilters?.period,
    branch: window.dashboardFilters?.branch
  }));
  expect(filters.period).toBe('30');
  expect(filters.branch).toBe('');
});

test('Ordenes elimina Estado COI y Estado documental y conserva selector semantico de vencimiento', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => document.getElementById('btnOrdenes')?.click());
  await expect(page.locator('#vistaOrdenes')).toBeVisible();

  await expect(page.locator('#ordenesFiltroEstado')).toHaveCount(0);
  await expect(page.locator('#ordenesFiltroDoc')).toHaveCount(0);

  const select = page.locator('#ordenesFiltroMesVenc');
  await expect(select).toHaveCount(1);
  await expect(select.locator('option')).toHaveCount(5);
  expect(await select.locator('option').evaluateAll(options => options.map(o => o.value))).toEqual([
    '', 'proximas', 'lejanas', 'vencidas', 'sin_fecha_final'
  ]);

  await page.evaluate(() => {
    if (typeof window.cargarFiltrosOrdenes === 'function') window.cargarFiltrosOrdenes();
    if (typeof window.renderOrdenes === 'function') window.renderOrdenes();
  });
  await page.waitForTimeout(100);

  expect(await select.locator('option').evaluateAll(options => options.map(o => o.value))).toEqual([
    '', 'proximas', 'lejanas', 'vencidas', 'sin_fecha_final'
  ]);
});

test('Orden de vencimiento ordena proximas, lejanas, vencidas y deja sin fecha al final', async () => {
  const sort = buildExpirySorter();
  const rows = [
    { id: 'far', days: 30 },
    { id: 'expired', days: -2 },
    { id: 'no-date', days: null },
    { id: 'near', days: 5 }
  ];
  const ids = criterion => sort(rows, criterion).map(row => row.id);

  expect(ids('proximas')).toEqual(['near', 'far', 'expired', 'no-date']);
  expect(ids('lejanas')).toEqual(['far', 'near', 'expired', 'no-date']);
  expect(ids('vencidas')).toEqual(['expired', 'near', 'far', 'no-date']);
  expect(ids('sin_fecha_final')).toEqual(['far', 'expired', 'near', 'no-date']);
});

test('fuente no vuelve a convertir Orden de vencimiento en filtro mensual', async () => {
  expect(SOURCE).not.toContain("setOptions('ordenesFiltroMesVenc',rows.map(r=>valorMesOrdenes(r.calc.venc)).filter(Boolean),'Todos los meses')");
  expect(SOURCE).toContain("if(typeof asegurarSelectorOrdenVencimiento==='function') asegurarSelectorOrdenVencimiento();");
  expect(SOURCE).not.toContain('for="d33Period"');
  expect(SOURCE).not.toContain('for="d33Branch"');
});
