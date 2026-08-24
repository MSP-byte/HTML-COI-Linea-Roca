const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '..', 'index.html');
const SOURCE = fs.readFileSync(INDEX_PATH, 'utf8');

function finalScript() {
  const match = SOURCE.match(/<script id="coi-final-navigation-top-scrollbars">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No se encontro el script final de navegacion/scroll superior');
  return match[1];
}

async function mountHarness(page) {
  await page.setContent(`
    <!doctype html><html><head><style>
      .coi-top-horizontal-scroll { width:320px; overflow-x:auto; overflow-y:hidden; height:18px; display:none; }
      .coi-top-horizontal-scroll-inner { height:1px; min-height:1px; }
    </style></head><body style="margin:0;width:420px;overflow-x:hidden">
      <aside><button id="ordersNav">Órdenes de compra</button></aside>
      <section id="vistaFichaOC"><button id="btnFichaVolverTop">Volver</button></section>
      <section id="vistaOrdenes" style="display:none">
        <input id="manualFilter" value="FEMYP">
        <div id="ordersParent" style="width:320px">
          <div class="table-wrap" style="width:320px;overflow-x:auto">
            <table class="ordenes-table" style="width:1000px"><tbody><tr><td>Orden</td><td style="width:900px">Contenido</td></tr></tbody></table>
          </div>
        </div>
      </section>
      <section id="alertsParent" style="width:320px">
        <div class="coi-alertas-scroll" style="width:320px;overflow-x:auto">
          <table class="coi-alertas-table" style="width:1000px"><tbody><tr><td>Alerta</td><td style="width:900px">Contenido</td></tr></tbody></table>
        </div>
      </section>
    </body></html>
  `);

  await page.evaluate(() => {
    window.APP_STATE = { activeView: 'vistaFichaOC' };
    window.__renders = 0;
    window.__shown = null;
    window.mostrarVista = (id) => {
      window.__shown = id;
      document.getElementById('vistaFichaOC').style.display = 'none';
      document.getElementById(id).style.display = 'block';
    };
    window.renderOrdenes = () => { window.__renders += 1; };

    for (const selector of ['.coi-alertas-scroll', '#ordersParent .table-wrap']) {
      const el = document.querySelector(selector);
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: 320 });
      Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 1000 });
    }
  });

  await page.addScriptTag({ content: finalScript() });
  await page.waitForTimeout(100);
}

async function enableUnsavedEdit(page, confirmResult) {
  await page.evaluate((result) => {
    window.APP_STATE.editingOC = true;
    window.APP_STATE.editingOCKey = 'OC-4530008964';
    window.APP_STATE.editingOCSnapshot = { proveedor: 'FEMYP S.R.L.' };
    window.__confirmCalls = 0;
    window.confirm = () => {
      window.__confirmCalls += 1;
      return result;
    };
    const panel = document.createElement('div');
    panel.id = 'coiEditIntegralOC';
    panel.textContent = 'Edicion activa';
    document.body.appendChild(panel);
  }, confirmResult);
}

test('fuente contiene los contratos finales sin reintroducir legacy', async () => {
  expect(SOURCE).toContain('id="coi-final-navigation-top-scrollbars"');
  expect(SOURCE).toContain("window.mostrarVista('vistaOrdenes')");
  expect(SOURCE).toContain("installTopHorizontalScrollbar(alerts, 'alertas')");
  expect(SOURCE).toContain("installTopHorizontalScrollbar(orders, 'ordenes')");
});

test('Volver abre Ordenes y conserva filtros existentes', async ({ page }) => {
  await mountHarness(page);
  await page.locator('#btnFichaVolverTop').click();
  await expect.poll(() => page.evaluate(() => window.__shown)).toBe('vistaOrdenes');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.activeView)).toBe('vistaOrdenes');
  await expect(page.locator('#vistaOrdenes')).toBeVisible();
  await expect(page.locator('#vistaFichaOC')).toBeHidden();
  await expect(page.locator('#manualFilter')).toHaveValue('FEMYP');
  expect(await page.evaluate(() => window.__renders)).toBeGreaterThan(0);
});

test('Volver con cambios sin guardar y CANCELAR mantiene la Ficha y la edicion intacta', async ({ page }) => {
  await mountHarness(page);
  await enableUnsavedEdit(page, false);

  await page.locator('#btnFichaVolverTop').click();
  await page.waitForTimeout(50);

  expect(await page.evaluate(() => window.__confirmCalls)).toBe(1);
  expect(await page.evaluate(() => window.__shown)).toBeNull();
  expect(await page.evaluate(() => window.APP_STATE.activeView)).toBe('vistaFichaOC');
  expect(await page.evaluate(() => window.APP_STATE.editingOC)).toBe(true);
  expect(await page.evaluate(() => window.APP_STATE.editingOCKey)).toBe('OC-4530008964');
  expect(await page.evaluate(() => window.APP_STATE.editingOCSnapshot?.proveedor)).toBe('FEMYP S.R.L.');
  await expect(page.locator('#coiEditIntegralOC')).toHaveCount(1);
  await expect(page.locator('#vistaFichaOC')).toBeVisible();
  await expect(page.locator('#vistaOrdenes')).toBeHidden();
});

test('Volver con cambios sin guardar y CONFIRMAR limpia la edicion y vuelve a Ordenes una sola vez', async ({ page }) => {
  await mountHarness(page);
  await enableUnsavedEdit(page, true);

  await page.locator('#btnFichaVolverTop').click();

  await expect.poll(() => page.evaluate(() => window.__shown)).toBe('vistaOrdenes');
  expect(await page.evaluate(() => window.__confirmCalls)).toBe(1);
  expect(await page.evaluate(() => window.APP_STATE.editingOC)).toBe(false);
  expect(await page.evaluate(() => window.APP_STATE.editingOCKey)).toBeNull();
  expect(await page.evaluate(() => window.APP_STATE.editingOCSnapshot)).toBeNull();
  await expect(page.locator('#coiEditIntegralOC')).toHaveCount(0);
  await expect(page.locator('#manualFilter')).toHaveValue('FEMYP');
  await expect(page.locator('#vistaOrdenes')).toBeVisible();
  await expect(page.locator('#vistaFichaOC')).toBeHidden();
});

test('scroll superior de Alertas sincroniza en ambos sentidos y no duplica', async ({ page }) => {
  await mountHarness(page);
  const top = page.locator('[data-top-scroll-key="alertas"]');
  const body = page.locator('.coi-alertas-scroll');
  await expect(top).toBeVisible();

  await top.evaluate((el) => { el.scrollLeft = 140; el.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => body.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);

  await body.evaluate((el) => { el.scrollLeft = 70; el.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => top.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);

  await page.evaluate(() => {
    const current = document.querySelector('.coi-alertas-scroll');
    current.outerHTML = current.outerHTML;
  });
  await page.waitForTimeout(100);
  await expect(page.locator('[data-top-scroll-key="alertas"]')).toHaveCount(1);
});

test('scroll superior de Ordenes sobrevive rerender y sincroniza', async ({ page }) => {
  await mountHarness(page);
  await page.locator('#btnFichaVolverTop').click();
  const top = page.locator('[data-top-scroll-key="ordenes"]');
  const body = page.locator('#ordersParent .table-wrap');
  await expect(top).toBeVisible();

  await top.evaluate((el) => { el.scrollLeft = 160; el.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => body.evaluate((el) => el.scrollLeft)).toBeGreaterThan(120);

  await body.evaluate((el) => { el.scrollLeft = 80; el.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => top.evaluate((el) => el.scrollLeft)).toBeGreaterThan(60);

  await page.evaluate(() => {
    const current = document.querySelector('#ordersParent .table-wrap');
    current.outerHTML = current.outerHTML;
  });
  await page.waitForTimeout(100);
  await expect(page.locator('[data-top-scroll-key="ordenes"]')).toHaveCount(1);
});

test('layout no genera overflow horizontal global', async ({ page }) => {
  await mountHarness(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
