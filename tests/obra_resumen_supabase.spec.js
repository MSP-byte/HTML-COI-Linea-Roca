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
    const esObra = String(tipoBuscado).toLowerCase() === 'obra';
    const item = {
      idObra: esObra ? 'OC-QA-OBRA-001' : 'OC-QA-SERVICIO-001',
      idOC: esObra ? 'OC-QA-OBRA-001' : 'OC-QA-SERVICIO-001',
      numeroOC: esObra ? '4530099001' : '4530099002',
      oc: esObra ? '4530099001' : '4530099002',
      tipo: esObra ? 'Obra' : 'Servicio',
      tipoTrabajo: esObra ? 'Obras Civiles' : 'Ascensores',
      sector: esObra ? 'Andén 1' : 'Hall principal',
      proveedor: 'PROVEEDOR QA S.R.L.',
      estado: 'En ejecución',
      estadoCOI: 'En ejecución',
      estadoDocumental: 'Pendiente',
      fechaInicio: '2026-01-01',
      actaInicio: '2026-01-01',
      plazoDias: 365,
      plazo: 365,
      vencimiento: '2026-12-31',
      fechaFin: '2026-12-31',
      monto: 1000000,
      _supabaseRaw: { fecha_vencimiento: '2026-12-31' }
    };
    const ref = item.idObra;

    // El renderer productivo resuelve las OCs desde la colección léxica `estaciones`.
    // Inyectamos una OC sólo en memoria del navegador de Playwright, sin localStorage
    // y sin escribir en Supabase. Se detecta dinámicamente qué array consume allItems().
    let stations;
    let allItemsFn;
    try {
      stations = eval('estaciones');
      allItemsFn = eval('allItems');
    } catch (error) {
      return { ok:false, reason:`No se pudo acceder al dataset interno: ${error?.message || error}` };
    }
    const estacion = Array.isArray(stations) ? stations[0] : null;
    if (!estacion || typeof allItemsFn !== 'function') {
      return { ok:false, reason:'Dataset interno de estaciones no disponible' };
    }
    let inserted = false;
    for (const value of Object.values(estacion)) {
      if (!Array.isArray(value)) continue;
      value.push(item);
      let consumed = false;
      try { consumed = allItemsFn(estacion).includes(item); } catch (_) {}
      if (consumed) { inserted = true; break; }
      value.pop();
    }
    if (!inserted) {
      for (const key of ['obras','servicios','ordenes','items','ocs']) {
        const previous = estacion[key];
        if (!Array.isArray(previous)) estacion[key] = [];
        estacion[key].push(item);
        let consumed = false;
        try { consumed = allItemsFn(estacion).includes(item); } catch (_) {}
        if (consumed) { inserted = true; break; }
        estacion[key].pop();
        if (!Array.isArray(previous)) delete estacion[key];
      }
    }
    if (!inserted) return { ok:false, reason:'allItems() no reconoció la OC QA' };

    Object.defineProperty(navigator, 'onLine', { configurable:true, get:() => true });
    window.getSupabaseClient = () => ({ from:()=>({}) });
    window.getUsuarioActual = async () => ({ id:'qa-user' });
    window.cargarCertificacionesPorOC = async () => [
      { nro_oc:item.numeroOC, acta_medicion_nro:'7', fecha_inicio:'2026-07-01', fecha_fin:'2026-07-31', aux_porcentaje:62.5 },
      { nro_oc:item.numeroOC, acta_medicion_nro:'6', fecha_inicio:'2026-06-01', fecha_fin:'2026-06-30', aux_porcentaje:50 }
    ];
    window.cargarDocumentosStorageOC = async () => [
      { id:'doc-1', nro_oc:item.numeroOC, storage_path:'qa/a.pdf' },
      { id:'doc-2', nro_oc:item.numeroOC, storage_path:'qa/b.pdf' }
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
  await expect(card.locator('[data-coi-obra-vencimiento]')).toHaveText('31/12/2026');
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
