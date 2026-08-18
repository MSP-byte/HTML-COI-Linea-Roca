const { test, expect } = require('@playwright/test');

async function openIsolated(page) {
  await page.route(/^https?:\/(?!\/127\.0\.0\.1)/, route => route.abort());
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() => typeof window.renderFichaOC === 'function' && typeof window.todasLasOC === 'function');
}

async function renderTypeWithSupabaseStubs(page, tipo) {
  return page.evaluate(async tipoBuscado => {
    const rows = window.todasLasOC();
    const row = rows.find(r => String((r.item || r).tipo || '').toLowerCase() === tipoBuscado.toLowerCase());
    if (!row) return { ok:false, reason:`No hay ${tipoBuscado} demo` };
    const item = row.item || row;
    const ref = item.idObra || item.idOC || item.numeroOC || item.oc;
    Object.defineProperty(navigator, 'onLine', { configurable:true, get:() => true });
    window.getSupabaseClient = () => ({ from:()=>({}) });
    window.getUsuarioActual = async () => ({ id:'qa-user' });
    window.cargarCertificacionesPorOC = async () => [
      { nro_oc:item.numeroOC||item.oc, acta_medicion_nro:'7', fecha_inicio:'2026-07-01', fecha_fin:'2026-07-31', aux_porcentaje:62.5 },
      { nro_oc:item.numeroOC||item.oc, acta_medicion_nro:'6', fecha_inicio:'2026-06-01', fecha_fin:'2026-06-30', aux_porcentaje:50 }
    ];
    window.cargarDocumentosStorageOC = async () => [
      { id:'doc-1', nro_oc:item.numeroOC||item.oc, storage_path:'qa/a.pdf' },
      { id:'doc-2', nro_oc:item.numeroOC||item.oc, storage_path:'qa/b.pdf' }
    ];
    window.renderFichaOC(ref);
    return { ok:true, ref };
  }, tipo);
}

test('Obra muestra VTO, última certificación y avance desde Supabase sin tocar Finanzas', async ({ page }) => {
  await openIsolated(page);
  const result = await renderTypeWithSupabaseStubs(page, 'Obra');
  expect(result.ok, result.reason || '').toBe(true);
  await expect(page.locator('[data-coi-obra-resumen-source="supabase"]')).toBeVisible();
  const card = page.locator('[data-coi-obra-resumen-source="supabase"]');
  await expect(card).toContainText('Vencimiento');
  await expect(card).toContainText('Última certificación');
  await expect(card).toContainText('% de avance');
  const labels = await card.locator('.grid > div > b').allTextContents();
  expect(labels.map(x=>x.trim().toLowerCase())).not.toContain('sector');
  await expect(card.locator('[data-coi-obra-ultima-cert]')).toContainText('Acta N° 7');
  await expect(card.locator('[data-coi-obra-ultima-cert]')).toContainText('31/07/2026');
  await expect(card.locator('[data-coi-obra-avance]')).toHaveText('62,5%');
  await expect(page.getByText('4. ESTADO FINANCIERO', { exact:false })).toBeVisible();
});

test('Repositorio contractual usa Supabase Storage y no ofrece OneDrive', async ({ page }) => {
  await openIsolated(page);
  const result = await renderTypeWithSupabaseStubs(page, 'Obra');
  expect(result.ok, result.reason || '').toBe(true);
  const repo = page.locator('[data-coi-repo-supabase]').first();
  await expect(repo).toHaveText(/Supabase Storage · 2 documentos/);
  const repoParent = repo.locator('..');
  await expect(repoParent).not.toContainText(/OneDrive/i);
  await expect(repoParent.locator('a')).toHaveCount(0);
});

test('Servicios conservan Sector en su Resumen General', async ({ page }) => {
  await openIsolated(page);
  const result = await renderTypeWithSupabaseStubs(page, 'Servicio');
  expect(result.ok, result.reason || '').toBe(true);
  await page.waitForTimeout(50);
  const summary = page.locator('.expediente-card').filter({ has: page.getByRole('heading', { name:/1\. Resumen general/i }) }).first();
  await expect(summary).toBeVisible();
  const labels = await summary.locator('.grid > div > b').allTextContents();
  expect(labels.map(x=>x.trim().toLowerCase())).toContain('sector');
  await expect(summary.locator('[data-coi-obra-ultima-cert]')).toHaveCount(0);
});

test('Centro de Alertas evita el quiebre vertical de OC y fechas', async ({ page }) => {
  await openIsolated(page);
  await expect(page.locator('#coi-alertas-table-fix-v1')).toHaveCount(1);
  const rules = await page.locator('#coi-alertas-table-fix-v1').textContent();
  expect(rules).toContain('white-space:nowrap');
  expect(rules).toContain('min-width:1500px');
});
