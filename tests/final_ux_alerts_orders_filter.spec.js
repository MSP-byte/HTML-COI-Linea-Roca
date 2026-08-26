const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 60_000 });

async function openIsolated(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    Boolean(window.COI_ORDERS_DASHBOARD_FILTERS) &&
    Boolean(window.COI?.dashboard?.openOrders) &&
    typeof window.renderCentroAlertas === 'function' &&
    typeof window.renderOrdenes === 'function'
  );
}

async function openV2Module(page, navId) {
  const nav = page.locator(`[data-v2-nav="${navId}"]`);
  const mobile = (page.viewportSize()?.width || 0) <= 760;
  if (mobile || !await nav.isVisible()) await page.locator('#coiV2Menu').click();
  await expect(nav).toBeVisible();
  if (mobile) await nav.evaluate(el => el.click());
  else await nav.click();
}

async function installOrdersFixture(page) {
  await page.evaluate(() => {
    const make = ({ id, oc, provider, days, state = 'En ejecución', type = 'Obra civil' }) => {
      const item = {
        idObra: id,
        numeroOC: oc,
        nro_oc: oc,
        tipo: type,
        tipoTrabajo: type,
        descripcion: type,
        proveedor: provider,
        estacion: 'Plaza Constitución',
        estado: state,
        estadoCOI: state,
        estadoDocumental: 'Revisado',
        monto: 1000000,
        moneda: 'ARS'
      };
      return {
        id,
        idObra: id,
        oc,
        numeroOC: oc,
        tipo: type,
        proveedor: provider,
        estacion: item.estacion,
        estado: state,
        estadoDocumental: item.estadoDocumental,
        diasRestantes: days,
        fin: '',
        item
      };
    };
    window.__finalUxOrdersFixture = [
      make({ id: 'UX-01', oc: '4530001001', provider: 'Proveedor A', days: 10 }),
      make({ id: 'UX-02', oc: '4530001002', provider: 'Proveedor A', days: 90 }),
      make({ id: 'UX-03', oc: '4530001003', provider: 'Proveedor B', days: -10 }),
      make({ id: 'UX-04', oc: '4530001004', provider: 'Proveedor C', days: 40, state: 'Finalizada' })
    ];
    window.todasLasOC = () => window.__finalUxOrdersFixture;
    window.filasOrdenesBase = () => window.__finalUxOrdersFixture;
    window.renderOrdenes();
    window.renderDashboardInteractivo();
  });
  await expect.poll(() => page.locator('#ordenesTbody tr').count()).toBeGreaterThan(0);
}

test('Centro de Alertas queda simple, conserva acciones y ordena las columnas críticas', async ({ page, isMobile }) => {
  await openIsolated(page);
  await installOrdersFixture(page);
  await page.evaluate(() => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.generarAlertasCOI = () => [{
      id: 'ALERTA-UX-1',
      oc: '4530001001',
      ocNro: '4530001001',
      idRegistro: 'UX-01',
      tipoAlerta: 'OC próxima a vencer',
      categoria: 'operativa',
      severidad: 'alta',
      estacion: 'Plaza Constitución',
      proveedor: 'Proveedor A',
      descripcion: 'Renovación integral de infraestructura ferroviaria',
      fechaRelacionada: '2026-08-26',
      dias: 4,
      mensaje: 'La orden requiere seguimiento operativo antes de su vencimiento contractual.',
      accionSugerida: 'Revisar la vigencia contractual, coordinar la documentación pendiente y registrar la decisión administrativa.'
    }];
    window.__finalUxOpenedOrder = '';
    window.abrirFichaOC = key => { window.__finalUxOpenedOrder = key; };
    const view = document.getElementById('vistaCentroAlertas');
    document.querySelectorAll('section.view.active').forEach(node => node.classList.remove('active'));
    view.classList.add('active');
    view.hidden = false;
    view.style.display = 'block';
    window.renderCentroAlertas();
  });

  const view = page.locator('#vistaCentroAlertas');
  const obsolete = ['Operativas', 'Documentales', 'Financieras', 'Calidad de Datos', 'Todas'];
  for (const name of obsolete) await expect(view.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(view.locator('h2', { hasText: 'Centro de Alertas' })).toHaveCount(1);
  await expect(view.getByText('Detección automática de vencimientos, certificaciones, documentación pendiente y datos críticos.', { exact: true })).toHaveCount(1);
  await expect(view.locator('table.coi-alertas-table tbody tr')).toHaveCount(1);

  await view.getByRole('button', { name: 'Ver ficha OC', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__finalUxOpenedOrder)).toBe('UX-01');
  await view.getByRole('button', { name: 'Enviar a Observaciones', exact: true }).click();
  await expect.poll(async () =>
    (await page.locator('#toastR15,#coiToastV581').allTextContents()).some(text => /observaciones/i.test(text))
  ).toBe(true);

  const metrics = await view.locator('table.coi-alertas-table').evaluate(table => {
    const wrap = table.closest('.coi-alertas-scroll');
    const row = table.tBodies[0].rows[0];
    const suggested = row.cells[8];
    const actions = row.cells[9];
    const suggestedRect = suggested.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const buttonsContained = [...actions.querySelectorAll('button')].every(button => {
      const rect = button.getBoundingClientRect();
      return rect.left >= actionsRect.left - 1 && rect.right <= actionsRect.right + 1;
    });
    return {
      overflowX: getComputedStyle(wrap).overflowX,
      scrollable: wrap.scrollWidth > wrap.clientWidth,
      suggestedWhiteSpace: getComputedStyle(suggested).whiteSpace,
      actionsVerticalAlign: getComputedStyle(actions).verticalAlign,
      noOverlap: suggestedRect.right <= actionsRect.left + 1,
      buttonsContained,
      actionWidth: actionsRect.width,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(metrics.overflowX).toBe('auto');
  expect(metrics.suggestedWhiteSpace).toBe('normal');
  expect(metrics.actionsVerticalAlign).toBe('top');
  expect(metrics.noOverlap).toBe(true);
  expect(metrics.buttonsContained).toBe(true);
  expect(metrics.actionWidth).toBeGreaterThanOrEqual(230);
  if (isMobile) expect(metrics.scrollable).toBe(true);

  await page.evaluate(() => document.querySelector('[data-v581-alert-revisada]')?.click());
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('coi_alertas_revisadas_v581') || '[]').includes('ALERTA-UX-1')
  )).toBe(true);
  await expect(view.locator('table.coi-alertas-table tbody tr')).toHaveCount(1);
  await expect(view.locator('table.coi-alertas-table tbody')).toContainText('Sin alertas visibles');
});

test('Dashboard permite quitar su filtro, conservar manuales y limpiar toda la cartera sin estado fantasma', async ({ page }) => {
  await openIsolated(page);
  await installOrdersFixture(page);

  const fullCount = await page.evaluate(() => window.__finalUxOrdersFixture.length);
  await page.locator('.d33-kpi[data-action="upcoming"]').click();
  const banner = page.locator('#uxOrderContext');
  await expect(banner).toContainText('Filtro Dashboard: Próximas a vencer');
  await expect(banner.getByRole('button', { name: 'Quitar filtro', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.COI_ORDERS_DASHBOARD_FILTERS.getStatus())).toBe('upcoming');

  await page.locator('#ordenesFiltroProveedor').selectOption({ label: 'Proveedor A' });
  await expect.poll(() => page.locator('#ordenesFiltroProveedor').inputValue()).toBe('Proveedor A');
  await banner.getByRole('button', { name: 'Quitar filtro', exact: true }).click();
  await expect(banner).toBeHidden();
  await expect(page.locator('#ordenesFiltroProveedor')).toHaveValue('Proveedor A');
  await expect.poll(() => page.locator('#ordKTotal').textContent()).toBe(String(await page.evaluate(() => window.__finalUxOrdersFixture.filter(row => row.proveedor === 'Proveedor A').length)));
  await expect.poll(() => page.locator('#ordAnaliticaTotalR36').textContent()).toBe(String(await page.evaluate(() => window.__finalUxOrdersFixture.filter(row => row.proveedor === 'Proveedor A').length)));

  await page.evaluate(() => window.COI.dashboard.openOrders({ status: 'expired' }));
  await expect(banner).toContainText('Filtro Dashboard: Vencidas sin saldo');
  await page.locator('#ordenesBusqueda').fill('4530001003');
  await page.locator('#btnOrdenesLimpiar').click();
  await expect(banner).toBeHidden();
  await expect(page.locator('#ordenesBusqueda')).toHaveValue('');
  await expect(page.locator('#ordenesFiltroProveedor')).toHaveValue('');
  await expect.poll(() => page.locator('#ordKTotal').textContent()).toBe(String(fullCount));
  await expect.poll(() => page.locator('#ordAnaliticaTotalR36').textContent()).toBe(String(fullCount));
  await expect.poll(() => page.evaluate(() => window.COI_ORDERS_DASHBOARD_FILTERS.getStatus())).toBe('');

  await openV2Module(page, 'btnDashboard');
  await openV2Module(page, 'btnOrdenes');
  await expect(banner).toBeHidden();
  await expect.poll(() => page.locator('#ordKTotal').textContent()).toBe(String(fullCount));

  await openV2Module(page, 'btnDashboard');
  await page.evaluate(() => window.COI.dashboard.openOrders({ status: 'closed' }));
  await expect(banner).toContainText('Filtro Dashboard: Finalizadas / cerradas');
  await expect.poll(() => page.evaluate(() => window.COI_ORDERS_DASHBOARD_FILTERS.getStatus())).toBe('closed');
});
