const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test.describe.configure({ timeout: 60_000 });

async function forceAdminAccess(page) {
  await page.evaluate(() => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    const btn = document.getElementById('btnCentroAlertas');
    if (btn) {
      btn.hidden = false;
      btn.style.display = '';
    }
  });
}

async function openIsolated(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    typeof window.renderCentroAlertas === 'function' &&
    Boolean(document.getElementById('btnCentroAlertas')) &&
    Boolean(document.getElementById('vistaCentroAlertas'))
  );
  await forceAdminAccess(page);
}

async function openAlertsFromRealNav(page) {
  await forceAdminAccess(page);
  await page.evaluate(() => {
    const btn = document.getElementById('btnCentroAlertas');
    if (!btn) throw new Error('btnCentroAlertas no disponible');
    btn.click();
  });
  const view = page.locator('#vistaCentroAlertas');
  await expect(view).toBeVisible();
  await expect.poll(() => view.locator('#alertasTbody').count()).toBe(1);
  await expect.poll(() => view.locator('#execAlertsCard').count()).toBe(1);
  return view;
}

test('navegacion real monta un unico panel plegado y conserva expansion tras rerender', async ({ page }) => {
  await openIsolated(page);
  const view = await openAlertsFromRealNav(page);

  let panel = view.locator('#execAlertsCard');
  await expect(panel.locator('summary')).toContainText('Alertas de calidad y documentación');
  expect(await panel.evaluate(el => el.open)).toBe(false);

  await panel.locator('summary').evaluate(el => el.click());
  await expect.poll(() => panel.evaluate(el => el.open)).toBe(true);

  await page.evaluate(() => window.renderCentroAlertas());
  await expect.poll(() => view.locator('#execAlertsCard').count()).toBe(1);
  panel = view.locator('#execAlertsCard');
  await expect.poll(() => panel.evaluate(el => el.open)).toBe(true);

  await forceAdminAccess(page);
  await page.evaluate(() => document.getElementById('btnCentroAlertas').click());
  await expect.poll(() => view.locator('#execAlertsCard').count()).toBe(1);
  panel = view.locator('#execAlertsCard');
  await expect.poll(() => panel.evaluate(el => el.open)).toBe(true);
});

test('panel usa la superficie real de Alertas y no altera tabla general ni scrollbar superior', async ({ page }) => {
  await openIsolated(page);
  const view = await openAlertsFromRealNav(page);

  await page.evaluate(() => {
    window.renderCentroAlertas();
    window.renderCentroAlertas();
  });
  await expect.poll(() => view.locator('#execAlertsCard').count()).toBe(1);
  await expect(view.locator('#alertasTbody')).toHaveCount(1);

  expect(SOURCE).toContain("const legacyBody=host.querySelector('#alertasTbody')");
  expect(SOURCE).toContain("installTopHorizontalScrollbar(alerts, 'alertas')");
  expect(SOURCE).toContain('id="coi-final-navigation-top-scrollbars"');
});
