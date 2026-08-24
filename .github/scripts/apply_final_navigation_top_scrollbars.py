from pathlib import Path

INDEX = Path('index.html')
TEST = Path('tests/final_navigation_top_scrollbars.spec.js')
MARKER = 'coi-final-navigation-top-scrollbars'

STYLE_AND_SCRIPT = r'''
<style id="coi-final-navigation-top-scrollbars-style">
  .coi-top-horizontal-scroll {
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    height: 18px;
    margin: 0 0 7px;
    display: none;
    box-sizing: border-box;
  }
  .coi-top-horizontal-scroll-inner {
    height: 1px;
    min-height: 1px;
    pointer-events: none;
  }
  @media (min-width: 769px) {
    .coi-top-scroll-managed {
      scrollbar-width: none;
    }
    .coi-top-scroll-managed::-webkit-scrollbar {
      height: 0;
    }
  }
  @media (max-width: 768px) {
    .coi-top-horizontal-scroll {
      height: 14px;
      margin-bottom: 5px;
    }
  }
</style>
<script id="coi-final-navigation-top-scrollbars">
(function () {
  'use strict';

  if (window.__COI_FINAL_NAV_TOP_SCROLLBARS__) return;
  window.__COI_FINAL_NAV_TOP_SCROLLBARS__ = true;

  const BACK_SELECTOR = '#btnFichaVolverTop,#btnVolverFichaOC,#btnFichaVolverInterno';
  const instances = new Map();
  let mutationRaf = 0;

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }

  function markOrdersNavigationActive() {
    const explicit = document.querySelectorAll(
      '[data-view="vistaOrdenes"],[data-view="ordenes"],' +
      '[data-vista="vistaOrdenes"],[data-vista="ordenes"],' +
      '[data-target="vistaOrdenes"],[data-target-view="vistaOrdenes"],' +
      '[href="#vistaOrdenes"],#navOrdenes,#menuOrdenes,#btnOrdenes'
    );

    const textual = Array.from(document.querySelectorAll('aside a,aside button,nav a,nav button,.sidebar a,.sidebar button,#sidebar a,#sidebar button'))
      .filter((el) => normalizeText(el.textContent).includes('ORDENES DE COMPRA'));

    const candidates = Array.from(new Set([...explicit, ...textual]));
    if (!candidates.length) return;

    document.querySelectorAll(
      'aside .active,nav .active,.sidebar .active,#sidebar .active,' +
      '[data-view].active,[data-vista].active,[data-target].active,[data-target-view].active'
    ).forEach((el) => el.classList.remove('active'));

    candidates.forEach((el) => {
      el.classList.add('active');
      const owner = el.closest('li,.nav-item,.menu-item,.sidebar-item,.sidebar-link');
      if (owner) owner.classList.add('active');
    });
  }

  function fallbackShowOrders() {
    const orders = document.getElementById('vistaOrdenes');
    const ficha = document.getElementById('vistaFichaOC');
    if (!orders) return;
    if (ficha) {
      ficha.classList.remove('active');
      ficha.hidden = true;
      ficha.style.display = 'none';
    }
    orders.hidden = false;
    orders.style.display = '';
    orders.classList.add('active');
  }

  function goBackToOrders(event) {
    const target = event.target instanceof Element ? event.target.closest(BACK_SELECTOR) : null;
    if (!target || !target.closest('#vistaFichaOC')) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    try {
      if (typeof window.mostrarVista === 'function') {
        window.mostrarVista('vistaOrdenes');
      } else {
        fallbackShowOrders();
      }
    } catch (error) {
      console.error('[COI] No se pudo volver a Ordenes desde la Ficha OC', error);
      fallbackShowOrders();
    }

    if (window.APP_STATE && typeof window.APP_STATE === 'object') {
      window.APP_STATE.activeView = 'vistaOrdenes';
    }

    markOrdersNavigationActive();

    if (typeof window.renderOrdenes === 'function') {
      try {
        window.renderOrdenes();
      } catch (error) {
        console.error('[COI] No se pudo refrescar Ordenes al volver desde la Ficha OC', error);
      }
    }

    scheduleReconcile();
  }

  document.addEventListener('click', goBackToOrders, true);

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function destroyInstance(key) {
    const instance = instances.get(key);
    if (!instance) return;
    instance.top.removeEventListener('scroll', instance.onTopScroll);
    instance.container.removeEventListener('scroll', instance.onContainerScroll);
    if (instance.resizeObserver) instance.resizeObserver.disconnect();
    if (instance.top.isConnected) instance.top.remove();
    if (instance.container && instance.container.classList) {
      instance.container.classList.remove('coi-top-scroll-managed');
    }
    instances.delete(key);
  }

  function installTopHorizontalScrollbar(container, key) {
    if (!(container instanceof HTMLElement)) return null;

    const existing = instances.get(key);
    if (existing && existing.container === container && existing.top.isConnected) {
      existing.refresh();
      return existing;
    }
    if (existing) destroyInstance(key);

    const stale = document.querySelectorAll('.coi-top-horizontal-scroll[data-top-scroll-key="' + key + '"]');
    stale.forEach((node) => node.remove());

    const top = document.createElement('div');
    top.className = 'coi-top-horizontal-scroll';
    top.dataset.topScrollKey = key;
    top.setAttribute('aria-label', 'Desplazamiento horizontal superior');
    top.setAttribute('role', 'region');

    const inner = document.createElement('div');
    inner.className = 'coi-top-horizontal-scroll-inner';
    top.appendChild(inner);

    container.parentNode.insertBefore(top, container);
    container.classList.add('coi-top-scroll-managed');

    let syncing = false;
    let refreshRaf = 0;

    const refresh = () => {
      if (!container.isConnected || !top.isConnected) return;
      if (refreshRaf) cancelAnimationFrame(refreshRaf);
      refreshRaf = requestAnimationFrame(() => {
        refreshRaf = 0;
        const width = Math.max(container.scrollWidth, container.clientWidth);
        inner.style.width = width + 'px';
        const hasOverflow = container.scrollWidth > container.clientWidth + 1;
        top.style.display = hasOverflow ? 'block' : 'none';
        if (hasOverflow && Math.abs(top.scrollLeft - container.scrollLeft) > 1) {
          top.scrollLeft = container.scrollLeft;
        }
      });
    };

    const onTopScroll = () => {
      if (syncing) return;
      syncing = true;
      container.scrollLeft = top.scrollLeft;
      syncing = false;
    };

    const onContainerScroll = () => {
      if (syncing) return;
      syncing = true;
      top.scrollLeft = container.scrollLeft;
      syncing = false;
    };

    top.addEventListener('scroll', onTopScroll, { passive: true });
    container.addEventListener('scroll', onContainerScroll, { passive: true });

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(refresh);
      resizeObserver.observe(container);
      if (container.firstElementChild) resizeObserver.observe(container.firstElementChild);
    }

    const instance = {
      key,
      top,
      inner,
      container,
      refresh,
      onTopScroll,
      onContainerScroll,
      resizeObserver
    };
    instances.set(key, instance);
    refresh();
    return instance;
  }

  window.installTopHorizontalScrollbar = installTopHorizontalScrollbar;

  function findAlertsContainer() {
    const containers = Array.from(document.querySelectorAll('.coi-alertas-scroll'))
      .filter((container) => container.querySelector('table.coi-alertas-table'));
    return containers.find(isVisible) || containers[0] || null;
  }

  function findOrdersContainer() {
    const tables = Array.from(document.querySelectorAll('table.ordenes-table'));
    const table = tables.find(isVisible) || tables[0] || null;
    return table ? table.closest('.table-wrap') : null;
  }

  function reconcileTopScrollbars() {
    for (const [key, instance] of Array.from(instances.entries())) {
      if (!instance.container.isConnected || !instance.top.isConnected) destroyInstance(key);
    }

    const alerts = findAlertsContainer();
    if (alerts) installTopHorizontalScrollbar(alerts, 'alertas');

    const orders = findOrdersContainer();
    if (orders) installTopHorizontalScrollbar(orders, 'ordenes');
  }

  function scheduleReconcile() {
    if (mutationRaf) return;
    mutationRaf = requestAnimationFrame(() => {
      mutationRaf = 0;
      reconcileTopScrollbars();
    });
  }

  const start = () => {
    scheduleReconcile();
    if (document.body && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(scheduleReconcile);
      observer.observe(document.body, { childList: true, subtree: true });
      window.__COI_FINAL_NAV_TOP_SCROLLBARS_OBSERVER__ = observer;
    }
    window.addEventListener('resize', scheduleReconcile, { passive: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
</script>
'''

TEST_CONTENT = r'''const { test, expect } = require('@playwright/test');
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
    <!doctype html><html><body style="margin:0;width:420px;overflow-x:hidden">
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
  });

  await page.addScriptTag({ content: finalScript() });
  await page.waitForTimeout(100);
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
'''


def main():
    source = INDEX.read_text(encoding='utf-8')
    if MARKER not in source:
        pos = source.lower().rfind('</body>')
        if pos < 0:
            raise SystemExit('No se encontro </body> en index.html')
        source = source[:pos] + STYLE_AND_SCRIPT + '\n' + source[pos:]
        INDEX.write_text(source, encoding='utf-8', newline='')

    TEST.parent.mkdir(parents=True, exist_ok=True)
    TEST.write_text(TEST_CONTENT, encoding='utf-8', newline='')


if __name__ == '__main__':
    main()
