const { test, expect } = require('@playwright/test');

async function openIsolated(page) {
  await page.route(/^https?:\/(?!\/127\.0\.0\.1)/, route => route.abort());
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() =>
    typeof window.renderFichaOC === 'function' &&
    Boolean(document.getElementById('coi-obra-resumen-supabase-v1'))
  );
}

async function instrumentProductHotfix(page) {
  return page.evaluate(() => {
    if (window.COI_OBRA_RESUMEN_SUPABASE_V1?.decorateForQA) {
      window.__COI_OBRA_QA__ = window.COI_OBRA_RESUMEN_SUPABASE_V1;
      return { ok:true, reused:true };
    }
    if (window.__COI_OBRA_QA__?.decorateForQA) return { ok:true, reused:true };
    const script = document.getElementById('coi-obra-resumen-supabase-v1');
    if (!script) return { ok:false, reason:'No existe el hotfix productivo de Obras' };

    const anchor = "  installAlertStyles();\n  const previous=window.renderFichaOC;";
    if (!script.textContent.includes(anchor)) {
      return { ok:false, reason:'No se encontró el ancla interna del hotfix productivo' };
    }
    const exposure = `  window.__COI_OBRA_QA__=Object.freeze({\n    async decorateForQA(reference,item){\n      const seq=++renderSeq;\n      const ui=item?patchResumenObra(item):null;\n      const repoSpan=patchRepositorioBase();\n      if(ui||repoSpan) await enrichFromSupabase(reference,item,ui,repoSpan,seq);\n      return {obra:Boolean(ui),repositorio:Boolean(repoSpan)};\n    },\n    latestCertification\n  });\n\n`;

    window.__COI_OBRA_RESUMEN_SUPABASE_V1__ = false;
    try {
      // Se reevalúa exactamente el script productivo, agregando sólo una exposición temporal
      // de sus funciones privadas dentro del navegador de Playwright. index.html no se modifica.
      (0, eval)(script.textContent.replace(anchor, exposure + anchor));
    } catch (error) {
      return { ok:false, reason:`No se pudo instrumentar el hotfix: ${error?.message || error}` };
    }
    return { ok:Boolean(window.__COI_OBRA_QA__?.decorateForQA) };
  });
}

async function decorateFixture(page, tipo) {
  const instrumented = await instrumentProductHotfix(page);
  if (!instrumented.ok) return instrumented;

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
      estacion: 'Plaza Constitución',
      proveedor: 'PROVEEDOR QA S.R.L.',
      estado: 'En ejecución',
      estadoCOI: 'En ejecución',
      estadoDocumental: 'Pendiente',
      vencimiento: '2026-12-31',
      fechaFin: '2026-12-31',
      monto: 1000000,
      _supabaseRaw: { fecha_vencimiento: '2026-12-31' }
    };
    const body = document.getElementById('fichaOCBody');
    if (!body) return { ok:false, reason:'No existe fichaOCBody' };

    body.innerHTML = `
      <section class="expediente-card" id="qaResumen">
        <h3>1. Resumen General</h3>
        <div class="grid">
          <div><b>ID_OBRA</b><span>${item.idObra}</span></div>
          <div><b>N° OC</b><span>${item.numeroOC}</span></div>
          <div><b>Tipo</b><span>${item.tipo}</span></div>
          <div><b>Tipo de trabajo</b><span>${item.tipoTrabajo}</span></div>
          <div><b>Estación</b><span>${item.estacion}</span></div>
          <div><b>Sector</b><span>${item.sector}</span></div>
          <div><b>Proveedor</b><span>${item.proveedor}</span></div>
          <div><b>Estado COI</b><span>${item.estadoCOI}</span></div>
          <div><b>Estado documental</b><span>${item.estadoDocumental}</span></div>
          <div><b>Semáforo</b><span>En plazo</span></div>
        </div>
      </section>
      <section class="expediente-card" id="qaContractual">
        <h3>2. Contractual</h3>
        <div class="grid"><div><b>Repositorio documental</b><a href="#onedrive-legacy">Abrir OneDrive</a></div></div>
      </section>
      <section class="expediente-card" id="qaFinanzas">
        <h3>4. ESTADO FINANCIERO</h3>
        <div data-finance-sentinel>FINANZAS-SIN-CAMBIOS</div>
      </section>`;

    const financeBefore = document.getElementById('qaFinanzas').innerHTML;
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

    const result = await window.__COI_OBRA_QA__.decorateForQA(item.idObra, item);
    const financeAfter = document.getElementById('qaFinanzas').innerHTML;
    return { ok:true, result, financeUnchanged: financeBefore === financeAfter };
  }, tipo);
}

test('Obra muestra VTO, última certificación y avance desde Supabase sin tocar Finanzas', async ({ page }) => {
  await openIsolated(page);
  const result = await decorateFixture(page, 'Obra');
  expect(result.ok, result.reason || '').toBe(true);
  expect(result.result.obra).toBe(true);
  expect(result.financeUnchanged).toBe(true);

  const card = page.locator('#qaResumen[data-coi-obra-resumen-source="supabase"]');
  await expect(card).toHaveCount(1);
  const labels = (await card.locator('.grid > div > b').allTextContents()).map(x=>x.trim().toLowerCase());
  expect(labels).toEqual(expect.arrayContaining([
    'id obra','n° oc','tipo','tipo de trabajo','estación','vencimiento',
    'proveedor','estado coi','estado documental','semáforo','última certificación','% de avance'
  ]));
  expect(labels).not.toContain('sector');
  await expect(card.locator('[data-coi-obra-vencimiento]')).not.toHaveText('—');
  await expect(card.locator('[data-coi-obra-vencimiento]')).toContainText('2026');
  await expect(card.locator('[data-coi-obra-ultima-cert]')).toContainText('Acta N° 7');
  await expect(card.locator('[data-coi-obra-ultima-cert]')).toContainText('2026');
  await expect(card.locator('[data-coi-obra-avance]')).toHaveText('62,5%');
  await expect(page.locator('[data-finance-sentinel]')).toHaveText('FINANZAS-SIN-CAMBIOS');
});

test('Contractual elimina repositorio OneDrive y controles documentales/PyC legacy', async ({ page }) => {
  await openIsolated(page);
  const result = await decorateFixture(page, 'Obra');
  expect(result.ok, result.reason || '').toBe(true);
  await page.evaluate(() => {
    const contractual=document.getElementById('qaContractual');
    contractual.insertAdjacentHTML('beforeend','<button>Marcar enviada a PyC</button><button>Agregar link documental</button><button>Abrir OneDrive</button>');
  });
  await page.waitForTimeout(100);
  await expect(page.locator('#qaContractual')).not.toContainText(/OneDrive/i);
  await expect(page.locator('#qaContractual')).not.toContainText(/Repositorio documental/i);
  await expect(page.locator('#fichaOCBody')).not.toContainText(/Marcar enviad[oa] a PyC/i);
  await expect(page.locator('#fichaOCBody')).not.toContainText(/Agregar link documental/i);
});

test('Servicios conservan Sector y no reciben campos exclusivos de Obra', async ({ page }) => {
  await openIsolated(page);
  const result = await decorateFixture(page, 'Servicio');
  expect(result.ok, result.reason || '').toBe(true);
  expect(result.result.obra).toBe(false);
  expect(result.financeUnchanged).toBe(true);

  const summary = page.locator('#qaResumen');
  const labels = (await summary.locator('.grid > div > b').allTextContents()).map(x=>x.trim().toLowerCase());
  expect(labels).toContain('sector');
  expect(labels).not.toContain('última certificación');
  expect(labels).not.toContain('% de avance');
  await expect(summary.locator('[data-coi-obra-ultima-cert]')).toHaveCount(0);
});

test('Centro de Alertas evita el quiebre vertical de OC y fechas', async ({ page }) => {
  await openIsolated(page);
  await expect(page.locator('#coi-alertas-table-fix-v1')).toHaveCount(1);
  const rules = await page.locator('#coi-alertas-table-fix-v1').textContent();
  expect(rules).toContain('white-space:nowrap');
  expect(rules).toContain('min-width:1500px');
  expect(rules).toContain('overflow-x:auto');
  expect(rules).not.toContain('break-all');
  expect(rules).toContain('word-break:keep-all');
});
