const { test, expect } = require('@playwright/test');

// Cobertura funcional (no solo estática) de tres problemas reales reportados:
//  1) Timeline: un mailing con varias OCs no debe concatenar los números.
//  2) Ficha OC: "Última certificación" debe caer a la última Acta de Medición
//     documental cuando no hay certificación estructurada en coi_certificaciones.
//  3) Documentos: registros duplicados del mismo objeto de Storage deben
//     colapsar a una sola fila al leer/renderizar, y "Abrir PDF" debe resolver
//     una signed URL real (o no ofrecerse si no hay storage_path).
//
// Se usa una OC ficticia (no 4530008964) para evitar cualquier caso especial
// hardcodeado: la corrección debe funcionar para cualquier OC con la misma forma.

const ORDER_ID = 'a0000000-1111-4111-8111-000000000001';
const ORDER_NUMBER = '4530012345';

async function openIsolated(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    Boolean(window.COI_FICHA_OBRA_UI) &&
    typeof window.recargarDatosDesdeSupabase === 'function' &&
    typeof window.renderFichaOC === 'function'
  );
}

async function installFixture(page, { documents = [], certifications = [] } = {}) {
  await page.evaluate(async ({ orderId, orderNumber, documents, certifications }) => {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const user = {
      id: 'a0000000-2222-4222-8222-000000000002',
      email: 'servicio.qa@example.com',
      app_metadata: { role: 'administrador' },
      user_metadata: { rol: 'administrador' }
    };
    const state = {
      order: {
        id: orderId,
        id_obra: '',
        nro_oc: orderNumber,
        tipo: 'Servicio',
        tipo_trabajo: 'Puertas automáticas',
        especialidad: 'Mantenimiento',
        descripcion: 'Mantenimiento de puertas automáticas',
        proveedor: 'Proveedor QA SRL',
        estacion: 'Estación QA',
        ramal: 'Línea Roca',
        sector: 'Andén',
        expediente: 'EX-QA-1',
        monto_total: 1000000,
        moneda: 'ARS',
        fecha_acta_inicio: '2026-01-01',
        plazo_dias: 365,
        fecha_vencimiento: '2026-12-31',
        proxima_certificacion: '2026-09-15',
        estado_coi: 'En ejecución',
        estado_documental: 'Revisado',
        estado_registro: 'Activo'
      },
      stations: [],
      certifications: clone(certifications),
      documents: clone(documents),
      history: [],
      signedUrlCalls: []
    };

    const rowsFor = table => {
      if (table === 'coi_ordenes') return [state.order];
      if (table === 'coi_ordenes_estaciones') return state.stations;
      if (table === 'coi_certificaciones') return state.certifications;
      if (table === 'coi_documentos_oc') return state.documents;
      if (table === 'coi_historial_oc') return state.history;
      if (table === 'profiles') return [{ id: user.id, rol: 'administrador', activo: true }];
      return [];
    };

    function queryFor(table) {
      let operation = 'select';
      let payload = null;
      const filters = [];
      const applyFilters = rows => rows.filter(row => filters.every(filter => {
        if (filter.type === 'eq') return String(row?.[filter.field] ?? '') === String(filter.value ?? '');
        return true;
      }));
      const execute = () => {
        if (operation === 'insert' || operation === 'upsert') {
          const inserted = (Array.isArray(payload) ? payload : [payload]).map(clone);
          if (table === 'coi_documentos_oc') state.documents.push(...inserted);
          if (table === 'coi_historial_oc') state.history.push(...inserted);
          return { data: clone(inserted), error: null };
        }
        return { data: clone(applyFilters(rowsFor(table))), error: null };
      };
      const query = {
        select() { return query; },
        eq(field, value) { filters.push({ type: 'eq', field, value }); return query; },
        is() { return query; },
        in() { return query; },
        order() { return query; },
        limit() { return Promise.resolve(execute()); },
        single() { const r = execute(); return Promise.resolve({ data: r.data?.[0] || null, error: r.error }); },
        maybeSingle() { const r = execute(); return Promise.resolve({ data: r.data?.[0] || null, error: r.error }); },
        insert(value) { operation = 'insert'; payload = value; return query; },
        upsert(value) { operation = 'upsert'; payload = value; return query; },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); }
      };
      return query;
    }

    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user } }, error: null }),
        getUser: async () => ({ data: { user }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      },
      from: table => queryFor(table),
      rpc: async name => ({ data: null, error: { code: '42883', message: `RPC no simulada: ${name}` } }),
      storage: {
        from: bucket => ({
          list: async () => ({ data: [], error: null }),
          createSignedUrl: async (path, ttl) => {
            state.signedUrlCalls.push({ bucket, path, ttl });
            return { data: { signedUrl: `https://signed.example/${bucket}/${encodeURIComponent(path)}` }, error: null };
          }
        })
      }
    };

    window.__COI_SUPABASE_CLIENT__ = client;
    window.getSupabaseClient = () => client;
    window.getUsuarioActual = async () => user;
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.usuarioTienePermisoEdicion = () => true;
    window.__MULTIOC_FIXTURE_STATE__ = state;

    await window.recargarDatosDesdeSupabase({ silencioso: true });
    if (typeof window.syncExecutiveMetadata === 'function') await window.syncExecutiveMetadata();
  }, { orderId: ORDER_ID, orderNumber: ORDER_NUMBER, documents, certifications });

  await expect.poll(() => page.evaluate(() =>
    typeof window.todasLasOC === 'function' ? window.todasLasOC().length : 0
  )).toBe(1);
}

async function renderOrder(page) {
  await page.evaluate(reference => {
    const view = document.getElementById('vistaFichaOC');
    document.querySelectorAll('section.view.active').forEach(node => node.classList.remove('active'));
    view.classList.add('active');
    window.renderFichaOC(reference);
  }, ORDER_NUMBER);
  await expect(page.locator('#fichaOCBody [data-coi-ficha-main-last-cert]')).toBeVisible();
}

// ===================== CASO 1: Timeline con varias OC =====================

test.describe('CASO 1 — Timeline con mailing de varias OC', () => {
  const OC_A = '4530009805', OC_B = '4530009304', OC_C = '4530009014';
  const SEED_EVENTS = [{
    id: 'TL-MULTIOC-1',
    fecha: '2026-08-20',
    hora: '09:00',
    oc: 'VARIAS',
    titulo: 'Mailing con varias OC mencionadas',
    tipo_evento: 'Mailing',
    origen: 'Mailing',
    estado: 'Informativo',
    riesgo: 'Bajo',
    proveedor: 'Proveedor Multi OC',
    observaciones: `OCs mencionadas: ${OC_A}, ${OC_B}, ${OC_C}`
  }];

  test('se muestran 3 OC independientes, sin concatenación, sin duplicados y con wrap', async ({ page }) => {
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
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
      await page.locator('#coiV2Menu').click();
    }
    await timelineButton.click();

    const card = page.locator('[data-timeline-event-id="TL-MULTIOC-1"]');
    await expect(card).toBeVisible();

    const chips = card.locator('.timeline-oc-chip');
    await expect(chips).toHaveCount(3);
    const chipTexts = (await chips.allTextContents()).map(t => t.trim());
    expect(new Set(chipTexts).size).toBe(3);
    expect(chipTexts.sort()).toEqual([`OC ${OC_A}`, `OC ${OC_B}`, `OC ${OC_C}`].sort());

    // Ninguna cadena concatenada debe aparecer en ningún lado de la tarjeta.
    const cardText = (await card.textContent()) || '';
    expect(cardText).not.toMatch(new RegExp(OC_A + OC_B));
    expect(cardText).not.toMatch(new RegExp(OC_A + OC_C));

    // Debe existir un botón "Abrir OC" por cada una, cada uno con su propio data attribute.
    const buttons = card.locator('[data-timeline-open-oc]');
    await expect(buttons).toHaveCount(3);
    const targets = await buttons.evaluateAll(nodes => nodes.map(n => n.dataset.timelineOpenOc));
    expect(targets.sort()).toEqual([OC_A, OC_B, OC_C].sort());

    // El wrapper de chips debe permitir wrap (no forzar una sola línea).
    const flexWrap = await card.locator('.timeline-oc-chips').evaluate(el => getComputedStyle(el).flexWrap);
    expect(flexWrap).toBe('wrap');

    // Cada acción abre la OC correcta (findOrder debe resolver cada una de las 3 OC).
    const opened = [];
    await page.exposeFunction('__capturaAbrirFichaOC', oc => opened.push(oc));
    await page.evaluate((ocs) => {
      window.todasLasOC = () => ocs.map(oc => ({ item: { oc }, oc }));
      window.abrirFichaOC = oc => window.__capturaAbrirFichaOC(oc);
    }, [OC_A, OC_B, OC_C]);
    for (let i = 0; i < 3; i++) await buttons.nth(i).click();
    expect(opened.sort()).toEqual([OC_A, OC_B, OC_C].sort());
  });

  test('el filtro por OC encuentra el mail aunque tenga varias OC asociadas, y no lo muestra para una OC ajena', async ({ page }) => {
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
    await page.addInitScript(seed => {
      localStorage.clear();
      localStorage.setItem('coi_timeline_events_v1', JSON.stringify(seed));
    }, SEED_EVENTS);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    const timelineButton = page.locator('[data-v2-nav="btnTimelineCOI"]');
    await timelineButton.waitFor({ state: 'attached' });
    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 760) await page.locator('#coiV2Menu').click();
    await timelineButton.click();

    await page.locator('#timelineFilter_oc').fill(OC_B);
    await page.locator('#btnTimelineAplicarFiltros').click();
    await expect(page.locator('[data-timeline-event-id="TL-MULTIOC-1"]')).toBeVisible();

    await page.locator('#timelineFilter_oc').fill('4530099999');
    await page.locator('#btnTimelineAplicarFiltros').click();
    await expect(page.locator('[data-timeline-event-id="TL-MULTIOC-1"]')).toHaveCount(0);
  });
});

// ===================== CASO 2 y parte de CASO 3: Ficha OC =====================

test.describe('CASO 2 — Última certificación cae a Acta de Medición documental', () => {
  test('sin coi_certificaciones pero con Actas documentales, el resumen muestra la última Acta con su período real', async ({ page }) => {
    await openIsolated(page);
    await installFixture(page, {
      certifications: [],
      documents: [
        {
          id: 'doc-acta-07', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER,
          tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 07.pdf',
          estado: 'Cargado', storage_bucket: 'coi-documentos', storage_path: `oc/${ORDER_NUMBER}/ACTA07.pdf`,
          fecha_documento: '2026-05-10'
        },
        {
          id: 'doc-acta-11', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER,
          tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 11.pdf',
          estado: 'Cargado', storage_bucket: 'coi-documentos', storage_path: `oc/${ORDER_NUMBER}/ACTA11.pdf`,
          fecha_documento: '2026-08-10', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-31'
        }
      ]
    });

    // Caché local conflictiva: no debe prevalecer sobre la fuente Supabase-first.
    await page.evaluate(() => {
      localStorage.setItem('coi_supabase_ordenes_cache_v2', JSON.stringify({
        savedAt: new Date().toISOString(),
        orders: [{ nro_oc: '4530012345', ultimaCertificacion: 'Acta local vieja falsa' }]
      }));
    });

    await renderOrder(page);

    await expect(page.locator('[data-coi-ficha-main-last-cert]')).toHaveText('Acta N° 11 (documental)');
    await expect(page.locator('[data-coi-ficha-main-last-cert-period]')).toHaveText('1/7/2026 al 31/7/2026');

    // No debe haber quedado seleccionada un acta anterior (07).
    const text = await page.locator('[data-coi-ficha-main-last-cert]').textContent();
    expect(text).not.toContain('07');
  });

  test('submódulo Certificaciones no dice "0" sin contexto cuando hay Actas documentales', async ({ page }) => {
    await openIsolated(page);
    await installFixture(page, {
      certifications: [],
      documents: [{
        id: 'doc-acta-11b', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER,
        tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 11.pdf',
        estado: 'Cargado', storage_bucket: 'coi-documentos', storage_path: `oc/${ORDER_NUMBER}/ACTA11.pdf`
      }]
    });
    await renderOrder(page);
    await page.evaluate(reference => window.renderCertificacionesSupabaseEnFicha(reference), ORDER_NUMBER);

    const note = page.locator('#certificacionesSupabaseFichaR18');
    await expect(note).toContainText('0 movimiento(s)');
    await expect(note).toContainText('Medición documental');
    await expect(note).toContainText('Actas de medición documentales');
  });
});

// ===================== CASO 3: duplicados documentales =====================

test.describe('CASO 3 — Documentos duplicados', () => {
  function docsFixture() {
    const base = { orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion', estado: 'Cargado', storage_bucket: 'coi-documentos' };
    return [
      // ACTA 05: 3 filas en DB para el MISMO objeto físico (casing distinto + duplicado exacto).
      { ...base, id: 'row-05-a', nombre_documento: 'ACTA 05.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA05.pdf`, observaciones: 'Importación piloto desde Supabase Storage.' },
      { ...base, id: 'row-05-b', nombre_documento: 'ACTA 05.pdf', storage_path: `OC/${ORDER_NUMBER}/ACTA05.pdf`, observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 05.' },
      { ...base, id: 'row-05-c', nombre_documento: 'ACTA 05.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA05.pdf`, observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 05.' },
      // ACTA 06: mismo patrón.
      { ...base, id: 'row-06-a', nombre_documento: 'ACTA 06.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA06.pdf`, observaciones: 'Importación piloto desde Supabase Storage.' },
      { ...base, id: 'row-06-b', nombre_documento: 'ACTA 06.pdf', storage_path: `OC/${ORDER_NUMBER}/ACTA06.pdf`, observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 06.' },
      // ACTA 11: única, debe seguir visible.
      { ...base, id: 'row-11', nombre_documento: 'ACTA 11.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA11.pdf`, observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 11.' },
      // Dos archivos DISTINTOS que coinciden en número de acta (07): NO deben perderse.
      { ...base, id: 'row-07-scan', nombre_documento: 'ACTA 07 escaneada.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA07_scan.pdf`, observaciones: 'Escaneo original.' },
      { ...base, id: 'row-07-firmada', nombre_documento: 'ACTA 07 firmada.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA07_firmada.pdf`, observaciones: 'Versión firmada digitalmente.' }
    ];
  }

  test('duplicado real (mismo storage_path salvo formato) se muestra una sola vez; documentos distintos no se pierden', async ({ page }) => {
    await openIsolated(page);
    await installFixture(page, { documents: docsFixture() });

    const result = await page.evaluate(async orderNumber => {
      const documentos = await window.cargarDocumentosStorageOC(orderNumber);
      const actas = window.obtenerActasMedicionDocumentalesOC(orderNumber, documentos);
      return {
        totalCrudo: window.__MULTIOC_FIXTURE_STATE__.documents.length,
        documentosUnicos: documentos.length,
        actas: actas.map(a => ({
          numero: window.obtenerNumeroActaDocumento(a),
          path: a.storage_path || a.objectPath
        }))
      };
    }, ORDER_NUMBER);

    expect(result.totalCrudo).toBe(8);
    // 5 objetos de Storage únicos: ACTA05, ACTA06, ACTA11, ACTA07_scan, ACTA07_firmada.
    expect(result.documentosUnicos).toBe(5);

    const numeros = result.actas.map(a => a.numero).sort();
    expect(numeros.filter(n => n === '05')).toHaveLength(1);
    expect(numeros.filter(n => n === '06')).toHaveLength(1);
    expect(numeros).toContain('11');
    // Los dos archivos distintos de ACTA 07 se conservan ambos (no se pierden por compartir número).
    expect(result.actas.filter(a => a.numero === '07')).toHaveLength(2);
  });
});

// ===================== CASO 4: Abrir PDF =====================

test.describe('CASO 4 — Abrir PDF resuelve Storage o no se ofrece', () => {
  test('con storage_path válido, Abrir PDF invoca la signed URL de Supabase Storage', async ({ page }) => {
    await openIsolated(page);
    await installFixture(page, {
      documents: [{
        id: 'doc-pdf-ok', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER,
        tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 11.pdf',
        estado: 'Cargado', storage_bucket: 'coi-documentos', storage_path: `oc/${ORDER_NUMBER}/ACTA11.pdf`
      }]
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));

    await page.evaluate(() => { window.__opened = []; window.open = url => { window.__opened.push(url); return { closed: false }; }; });

    const openButton = page.locator('#panelFichaCertificaciones [data-storage-documento-id]').first();
    await expect(openButton).toBeVisible();
    await expect(openButton).toBeEnabled();
    await openButton.click();

    await expect.poll(() => page.evaluate(() => window.__MULTIOC_FIXTURE_STATE__.signedUrlCalls.length)).toBeGreaterThan(0);
    const calls = await page.evaluate(() => window.__MULTIOC_FIXTURE_STATE__.signedUrlCalls);
    expect(calls[0].path).toBe(`oc/${ORDER_NUMBER}/ACTA11.pdf`);

    const opened = await page.evaluate(() => window.__opened);
    expect(opened.length).toBeGreaterThan(0);
    expect(opened[0]).toContain('signed.example');
  });

  test('sin storage_path válido, no se ofrece un botón Abrir PDF roto', async ({ page }) => {
    await openIsolated(page);
    await installFixture(page, {
      documents: [{
        id: 'doc-pdf-sin-ruta', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER,
        tipo_documento: 'acta_medicion', nombre_documento: 'ACTA sin archivo.pdf',
        estado: 'Pendiente', storage_bucket: 'coi-documentos', storage_path: ''
      }]
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));

    const openButton = page.locator('#panelFichaCertificaciones [data-storage-documento-id]').first();
    await expect(openButton).toBeVisible();
    await expect(openButton).toBeDisabled();
  });
});
