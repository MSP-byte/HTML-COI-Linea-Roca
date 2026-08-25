const { test, expect } = require('@playwright/test');

async function openWithMotionPaused(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('coi.visual.motion.enabled', '0');
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('coi-motion-off'));
}

test('Inicio mantiene visibles donut y barras cuando Movimiento esta pausado', async ({ page }) => {
  await openWithMotionPaused(page);

  const styles = await page.evaluate(() => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');

    const segment = document.createElementNS(ns, 'circle');
    segment.classList.add('d33-segment');
    segment.setAttribute('cx', '40');
    segment.setAttribute('cy', '40');
    segment.setAttribute('r', '24');
    segment.setAttribute('fill', 'none');
    segment.setAttribute('stroke', '#2f80ed');
    segment.setAttribute('stroke-width', '12');
    segment.setAttribute('stroke-dasharray', '80 20');

    const bar = document.createElementNS(ns, 'rect');
    bar.classList.add('d33-bar');
    bar.setAttribute('x', '80');
    bar.setAttribute('y', '10');
    bar.setAttribute('width', '20');
    bar.setAttribute('height', '60');
    bar.setAttribute('fill', '#d64545');

    svg.append(segment, bar);
    document.body.appendChild(svg);

    const segmentStyle = getComputedStyle(segment);
    const barStyle = getComputedStyle(bar);
    const result = {
      segmentAnimation: segmentStyle.animationName,
      segmentOpacity: segmentStyle.opacity,
      barAnimation: barStyle.animationName,
      barOpacity: barStyle.opacity
    };
    svg.remove();
    return result;
  });

  expect(styles.segmentAnimation).toBe('none');
  expect(styles.segmentOpacity).toBe('1');
  expect(styles.barAnimation).toBe('none');
  expect(styles.barOpacity).toBe('1');
});
