const { test, expect } = require('@playwright/test');

// Regresión funcional del bug del PR #47: eventCard() rompía renderTimelineCOI()
// con un ReferenceError (autorreferencia de riskBadge) y dejaba el módulo vacío,
// mostrando solo la cabecera "Timeline COI / Trazabilidad por OC".
// Este test navega realmente al módulo (no solo inspecciona el código fuente)
// para garantizar que el render completo ocurre sin errores en runtime.

const SEED_EVENTS = [
  {
    id: 'TEST-EVT-MAIL',
    fecha: '2026-08-27',
    hora: '09:00',
    titulo: 'Aviso de mailing de prueba',
    tipo_evento: 'Mailing',
    origen: 'Mailing',
    estado: 'Informativo',
    riesgo: 'Alto',
    proveedor: 'Proveedor Mailing Test'
  },
  {
    id: 'TEST-EVT-NONMAIL',
    fecha: '2026-08-27',
    hora: '10:00',
    titulo: 'Certificado de prueba',
    tipo_evento: 'Certificado',
    origen: 'SAP',
    estado: 'Certificación',
    riesgo: 'Alto',
    proveedor: 'Proveedor Certificado Test'
  }
];

test('Timeline COI renderiza completo sin ReferenceError y respeta el badge de riesgo por tipo de evento', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error));

  await page.route(/^https?:\/(?!\/127\.0\.0\.1)/, route => route.abort());
  await page.addInitScript(seed => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('coi_timeline_events_v1', JSON.stringify(seed));
  }, SEED_EVENTS);

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  const timelineButton = page.locator('[data-v2-nav="btnTimelineCOI"]');
  await timelineButton.waitFor({ state: 'attached' });
  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 760) {
    // Sidebar off-canvas (mobile): abrir el menú antes de navegar.
    await page.locator('#coiV2Menu').click();
    await expect(page.locator('body')).toHaveClass(/coi-v2-mobile-open/);
  }
  await timelineButton.click();

  const body = page.locator('#timelineCOIBody');
  await expect(body).not.toBeEmpty();

  // Pestañas de vista.
  await expect(page.locator('[data-timeline-view="diaria"]')).toBeVisible();
  await expect(page.locator('[data-timeline-view="oc"]')).toBeVisible();

  // Filtros.
  await expect(page.locator('.timeline-filters[aria-label="Filtros del Timeline COI"]')).toBeVisible();
  await expect(page.locator('#timelineFilter_oc')).toBeVisible();

  // Sección de resultados con los eventos sembrados.
  const results = page.locator('#timelineResultsAnchor');
  await expect(results).toBeVisible();
  const mailCard = page.locator('[data-timeline-event-id="TEST-EVT-MAIL"]');
  const nonMailCard = page.locator('[data-timeline-event-id="TEST-EVT-NONMAIL"]');
  await expect(mailCard).toBeVisible();
  await expect(nonMailCard).toBeVisible();

  // El evento Mailing NO debe mostrar ponderación visual de riesgo.
  await expect(mailCard.locator('.timeline-badges')).not.toContainText('Riesgo');

  // El evento no-Mailing sí debe conservar su badge de riesgo.
  await expect(nonMailCard.locator('.timeline-badges')).toContainText('Riesgo Alto');

  expect(pageErrors, `pageerror inesperado: ${pageErrors.map(e => e.message).join(' | ')}`).toEqual([]);
});
