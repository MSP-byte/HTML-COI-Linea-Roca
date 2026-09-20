const { test, expect } = require('@playwright/test');

async function openWithLegacyMotionPaused(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Simula la preferencia que podia dejar versiones anteriores.
    localStorage.setItem('coi.visual.motion.enabled', '0');
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.body.classList.contains('coi-motion-off'));
}

test('Inicio fuerza Movimiento activo aunque exista una preferencia legacy pausada', async ({ page }) => {
  await openWithLegacyMotionPaused(page);

  await expect(page.locator('body')).not.toHaveClass(/\bcoi-motion-off\b/);
  await expect(page.locator('#coiToggleMotion')).toHaveCount(0);
  await expect(page.locator('#coiFocusMode')).toHaveCount(0);

  const state = await page.evaluate(() => ({
    storedMotion: localStorage.getItem('coi.visual.motion.enabled'),
    motionOff: document.body.classList.contains('coi-motion-off'),
    dashboardActive: document.getElementById('vistaDashboard')?.classList.contains('active') === true
  }));

  expect(state.storedMotion).toBe('0');
  expect(state.motionOff).toBe(false);
  expect(state.dashboardActive).toBe(true);
});
