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

async function installFixture(page, { documents = [], certifications = [], signedUrlConfig = null } = {}) {
  await page.evaluate(async ({ orderId, orderNumber, documents, certifications, signedUrlConfig }) => {
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
            if (signedUrlConfig) {
              if (signedUrlConfig.delayMs) await new Promise(resolve => setTimeout(resolve, signedUrlConfig.delayMs));
              if ((signedUrlConfig.failFor || []).includes(path)) {
                return { data: null, error: { message: 'Object not found', statusCode: '404' } };
              }
              return { data: { signedUrl: `${signedUrlConfig.okBase}?signed=${encodeURIComponent(path)}` }, error: null };
            }
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
  }, { orderId: ORDER_ID, orderNumber: ORDER_NUMBER, documents, certifications, signedUrlConfig });

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

// "Abrir PDF" abre una pestaña en blanco de forma sincrónica (para no ser
// bloqueada como popup) y recién después navega esa misma pestaña a la
// signed URL vía `popup.location.href = ...`. El mock reproduce ambos pasos:
// registra la llamada inicial (si viniera con URL directa) y la navegación
// posterior sobre el objeto ya devuelto.
async function installPopupMock(page) {
  await page.evaluate(() => {
    window.__opened = [];
    window.open = url => {
      const popup = { closed: false, close() { this.closed = true; } };
      Object.defineProperty(popup, 'location', {
        value: Object.defineProperty({}, 'href', { set(value) { window.__opened.push(value); } })
      });
      if (url) window.__opened.push(url);
      return popup;
    };
  });
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

  test('CASO A — histórico con event.oc concatenado se recupera desde texto legible (descripción/documentos), sin mostrar el bloque pegado', async ({ page }) => {
    const HOC_A = '4530009805', HOC_B = '4530009304', HOC_C = '4530009014';
    const CONCAT = HOC_A + HOC_B + HOC_C;
    const HIST_EVENT = [{
      id: 'TL-HIST-CONCAT',
      fecha: '2026-04-15',
      hora: '10:00',
      oc: CONCAT,
      titulo: 'Resumen pendiente escaleras FEMYP abril-mayo-junio',
      tipo_evento: 'Mailing',
      origen: 'Mailing',
      estado: 'Informativo',
      riesgo: 'Bajo',
      proveedor: 'FEMYP S.R.L.',
      descripcion: `Seguimiento de escaleras mecánicas de las OC ${HOC_A}, ${HOC_B} y ${HOC_C} para el trimestre abril-mayo-junio.`,
      documentos_mencionados: `Actas de medición OC ${HOC_A}, OC ${HOC_B} y OC ${HOC_C}.`
    }];
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
    await page.addInitScript(seed => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('coi_timeline_events_v1', JSON.stringify(seed));
    }, HIST_EVENT);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    // Las tres OC deben existir como órdenes reales cargadas: la recuperación
    // textual solo prevalece si valida contra findOrder (nunca inventa OCs).
    await page.evaluate(ocs => {
      window.todasLasOC = () => ocs.map(oc => ({ item: { oc }, oc }));
    }, [HOC_A, HOC_B, HOC_C]);

    const timelineButton = page.locator('[data-v2-nav="btnTimelineCOI"]');
    await timelineButton.waitFor({ state: 'attached' });
    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 760) await page.locator('#coiV2Menu').click();
    await timelineButton.click();

    const card = page.locator('[data-timeline-event-id="TL-HIST-CONCAT"]');
    await expect(card).toBeVisible();

    const chips = card.locator('.timeline-oc-chip');
    await expect(chips).toHaveCount(3);
    const chipTexts = (await chips.allTextContents()).map(t => t.trim());
    expect(chipTexts.sort()).toEqual([`OC ${HOC_A}`, `OC ${HOC_B}`, `OC ${HOC_C}`].sort());

    const cardText = (await card.textContent()) || '';
    expect(cardText).not.toContain(CONCAT);
  });

  test('CASO A (fallback #5) — bloque de dígitos sin texto legible se parte en OC solo si TODOS los bloques son órdenes reales', async ({ page }) => {
    const HOC_A = '4530009805', HOC_B = '4530009304', HOC_C = '4530009014';
    const CONCAT = HOC_A + HOC_B + HOC_C;
    const EVENT_OK = [{
      id: 'TL-HIST-BLOCKS-OK', fecha: '2026-04-16', hora: '11:00', oc: CONCAT,
      titulo: 'Aviso sin detalle legible de OC', tipo_evento: 'Mailing', origen: 'Mailing',
      estado: 'Informativo', riesgo: 'Bajo', proveedor: 'FEMYP S.R.L.'
    }];
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
    await page.addInitScript(seed => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('coi_timeline_events_v1', JSON.stringify(seed));
    }, EVENT_OK);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(ocs => {
      window.todasLasOC = () => ocs.map(oc => ({ item: { oc }, oc }));
    }, [HOC_A, HOC_B, HOC_C]);

    const timelineButton = page.locator('[data-v2-nav="btnTimelineCOI"]');
    await timelineButton.waitFor({ state: 'attached' });
    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 760) await page.locator('#coiV2Menu').click();
    await timelineButton.click();

    const card = page.locator('[data-timeline-event-id="TL-HIST-BLOCKS-OK"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.timeline-oc-chip')).toHaveCount(3);
  });

  test('CASO A (fallback #5, negativo) — si algún bloque de 10 dígitos no es una OC real, NO se parte (no se inventan OCs)', async ({ page }) => {
    const HOC_A = '4530009805', HOC_B = '4530009304', HOC_C = '4530009014';
    const CONCAT = HOC_A + HOC_B + HOC_C;
    const EVENT_BAD = [{
      id: 'TL-HIST-BLOCKS-BAD', fecha: '2026-04-17', hora: '12:00', oc: CONCAT,
      titulo: 'Aviso sin detalle legible de OC', tipo_evento: 'Mailing', origen: 'Mailing',
      estado: 'Informativo', riesgo: 'Bajo', proveedor: 'FEMYP S.R.L.'
    }];
    await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
    await page.addInitScript(seed => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('coi_timeline_events_v1', JSON.stringify(seed));
    }, EVENT_BAD);
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    // Solo A y B existen como órdenes reales; C no. No debe partirse el bloque.
    await page.evaluate(ocs => {
      window.todasLasOC = () => ocs.map(oc => ({ item: { oc }, oc }));
    }, [HOC_A, HOC_B]);

    const timelineButton = page.locator('[data-v2-nav="btnTimelineCOI"]');
    await timelineButton.waitFor({ state: 'attached' });
    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 760) await page.locator('#coiV2Menu').click();
    await timelineButton.click();

    const card = page.locator('[data-timeline-event-id="TL-HIST-BLOCKS-BAD"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.timeline-oc-chip')).toHaveCount(0);
    const cardText = (await card.textContent()) || '';
    expect(cardText).toContain(CONCAT);
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

  test('CASO B — duplicado importación piloto + auto-registro (paths distintos) se muestra una sola vez', async ({ page }) => {
    await openIsolated(page);
    const nombreFisico = `FEMYP ME Nro11 Mant. Puertas Automaticas PC OC ${ORDER_NUMBER}.pdf`;
    await installFixture(page, {
      documents: [
        {
          id: 'row-piloto-11', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: 'Acta de Medición N° 11 - Mantenimiento Puertas Automáticas',
          storage_path: `legacy/oc/${ORDER_NUMBER}/acta11.pdf`,
          observaciones: `Importación piloto desde Supabase Storage. Archivo: ${nombreFisico}`
        },
        {
          id: 'row-auto-11', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: nombreFisico,
          storage_path: `oc/${ORDER_NUMBER}/${nombreFisico}`,
          observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 11.'
        }
      ]
    });

    const result = await page.evaluate(async orderNumber => {
      const documentos = await window.cargarDocumentosStorageOC(orderNumber);
      const actas = window.obtenerActasMedicionDocumentalesOC(orderNumber, documentos);
      return { count: actas.length, numeros: actas.map(a => window.obtenerNumeroActaDocumento(a)) };
    }, ORDER_NUMBER);

    expect(result.count).toBe(1);
    expect(result.numeros).toEqual(['11']);
  });

  test('CASO C — dos archivos reales distintos de la misma Acta NO se colapsan (no se deduplica solo por N° de Acta)', async ({ page }) => {
    await openIsolated(page);
    await installFixture(page, {
      documents: [
        {
          id: 'row-11-original', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos', nombre_documento: 'ACTA11_original.pdf',
          storage_path: `oc/${ORDER_NUMBER}/ACTA11_original.pdf`
        },
        {
          id: 'row-11-firmada', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos', nombre_documento: 'ACTA11_firmada.pdf',
          storage_path: `oc/${ORDER_NUMBER}/ACTA11_firmada.pdf`
        }
      ]
    });

    const result = await page.evaluate(async orderNumber => {
      const documentos = await window.cargarDocumentosStorageOC(orderNumber);
      const actas = window.obtenerActasMedicionDocumentalesOC(orderNumber, documentos);
      return { count: actas.length, nombres: actas.map(a => a.nombre_documento || a.nombreArchivo) };
    }, ORDER_NUMBER);

    expect(result.count).toBe(2);
    expect(result.nombres.sort()).toEqual(['ACTA11_firmada.pdf', 'ACTA11_original.pdf']);
  });

  test('CASO D — "Acta detectada: NN" en observaciones recupera el número aunque el nombre de archivo no diga "Acta"', async ({ page }) => {
    await openIsolated(page);
    const numero = await page.evaluate(() => window.obtenerNumeroActaDocumento({
      nombre_documento: 'FEMYP ME Nro11 Mant. Puertas Automaticas PC OC 4530099999.pdf',
      observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 11.'
    }));
    expect(numero).toBe('11');

    const numeroConCeros = await page.evaluate(() => window.obtenerNumeroActaDocumento({
      nombre_documento: 'archivo_sin_pista.pdf',
      observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 06.'
    }));
    expect(numeroConCeros).toBe('06');

    const sinNumero = await page.evaluate(() => window.obtenerNumeroActaDocumento({
      nombre_documento: 'archivo_sin_pista.pdf',
      observaciones: 'Sin datos adicionales.'
    }));
    expect(sinNumero).toBe('');
  });

  test('CASO E — última Acta documental con series 05..11 y sin coi_certificaciones da Acta N° 11', async ({ page }) => {
    await openIsolated(page);
    const numeros = ['05', '06', '07', '08', '09', '10', '11'];
    await installFixture(page, {
      certifications: [],
      documents: numeros.map(nn => ({
        id: `row-serie-${nn}`, orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
        estado: 'Cargado', storage_bucket: 'coi-documentos', nombre_documento: `ACTA ${nn}.pdf`,
        storage_path: `oc/${ORDER_NUMBER}/ACTA${nn}.pdf`
      }))
    });
    await renderOrder(page);
    await expect(page.locator('[data-coi-ficha-main-last-cert]')).toHaveText('Acta N° 11 (documental)');
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

    await installPopupMock(page);

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

  test('CASO F — el documento canónico deduplicado conserva el storage_path del duplicado y Abrir PDF lo usa', async ({ page }) => {
    await openIsolated(page);
    const nombreFisico = `FEMYP ME Nro11 Mant. Puertas Automaticas PC OC ${ORDER_NUMBER}.pdf`;
    const rutaReal = `oc/${ORDER_NUMBER}/${nombreFisico}`;
    await installFixture(page, {
      documents: [
        {
          // Metadata más rica (acta, período, fecha, nombre descriptivo) pero SIN storage_path.
          id: 'row-rich-11', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: 'Acta de Medición N° 11 - Mantenimiento Puertas Automáticas',
          fecha_documento: '2026-08-10', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-31',
          observaciones: `Importación piloto desde Supabase Storage. Archivo: ${nombreFisico}`
        },
        {
          // Duplicado auto-registrado: sin la riqueza de metadata, pero con el path real.
          id: 'row-auto-11', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: nombreFisico, storage_path: rutaReal,
          observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 11.'
        }
      ]
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));

    const rows = page.locator('#panelFichaCertificaciones .actas-documentales-table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('11');

    await installPopupMock(page);
    const openButton = page.locator('#panelFichaCertificaciones [data-storage-documento-id]').first();
    await expect(openButton).toBeEnabled();
    await openButton.click();

    await expect.poll(() => page.evaluate(() => window.__MULTIOC_FIXTURE_STATE__.signedUrlCalls.length)).toBeGreaterThan(0);
    const calls = await page.evaluate(() => window.__MULTIOC_FIXTURE_STATE__.signedUrlCalls);
    expect(calls[0].path).toBe(rutaReal);
    const opened = await page.evaluate(() => window.__opened);
    expect(opened[0]).toContain('signed.example');
  });
});

// ===================== Identidad documental central: casos 1-6 (helper real) =====================
// window.agruparDocumentosActaEquivalentes ES la misma función que usan tanto
// "3. Certificaciones" (obtenerActasMedicionDocumentalesOC) como la carga de
// "5. Documentos" (cargarDocumentosStorageOC): no son tres sistemas de dedup
// distintos, es una sola identidad reutilizada en ambos módulos.

test.describe('Identidad documental central — casos 1 a 6', () => {
  test('CASO 1 — la misma fila llega dos veces por composición: 1 documento operativo', async ({ page }) => {
    await openIsolated(page);
    const count = await page.evaluate(orderNumber => {
      const fila = { id: 'row-x', nro_oc: orderNumber, tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 09.pdf', storage_path: `oc/${orderNumber}/ACTA09.pdf`, estado: 'Cargado' };
      const duplicado = [fila, { ...fila }];
      return window.agruparDocumentosActaEquivalentes(duplicado, orderNumber).length;
    }, ORDER_NUMBER);
    expect(count).toBe(1);
  });

  test('CASO 2 — mismo id/path/nombre dos veces: 1 documento, contador = 1', async ({ page }) => {
    await openIsolated(page);
    const result = await page.evaluate(orderNumber => {
      const docs = [
        { id: 'row-y1', nro_oc: orderNumber, tipo_documento: 'acta_inicio', nombre_documento: 'Acta de Inicio_OC_Firmada.pdf', storage_path: `oc/${orderNumber}/Acta_Inicio_Firmada.pdf`, estado: 'Cargado' },
        { id: 'row-y2', nro_oc: orderNumber, tipo_documento: 'acta_inicio', nombre_documento: 'Acta de Inicio_OC_Firmada.pdf', storage_path: `oc/${orderNumber}/Acta_Inicio_Firmada.pdf`, estado: 'Cargado' }
      ];
      const agrupado = window.agruparDocumentosActaEquivalentes(docs, orderNumber);
      return { count: agrupado.length };
    }, ORDER_NUMBER);
    expect(result.count).toBe(1);
  });

  test('CASO 3 — misma Acta, archivos realmente distintos: 2 documentos', async ({ page }) => {
    await openIsolated(page);
    const count = await page.evaluate(orderNumber => {
      const docs = [
        { id: 'row-z1', nro_oc: orderNumber, tipo_documento: 'acta_medicion', nombre_documento: 'ACTA11_original.pdf', storage_path: `oc/${orderNumber}/ACTA11_original.pdf`, estado: 'Cargado' },
        { id: 'row-z2', nro_oc: orderNumber, tipo_documento: 'acta_medicion', nombre_documento: 'ACTA11_firmada.pdf', storage_path: `oc/${orderNumber}/ACTA11_firmada.pdf`, estado: 'Cargado' }
      ];
      return window.agruparDocumentosActaEquivalentes(docs, orderNumber).length;
    }, ORDER_NUMBER);
    expect(count).toBe(2);
  });

  test('CASO 4 — importación piloto + auto-registro con sufijo de colisión de Storage "(N)": 1 documento operativo', async ({ page }) => {
    await openIsolated(page);
    const result = await page.evaluate(orderNumber => {
      const nombreFisico = `FEMYP ME Nro11 Mant. Puertas Automaticas PC OC ${orderNumber}.pdf`;
      const nombreConSufijo = `FEMYP ME Nro11 Mant. Puertas Automaticas PC OC ${orderNumber} (7).pdf`;
      const docs = [
        {
          id: 'row-piloto', nro_oc: orderNumber, tipo_documento: 'acta_medicion',
          nombre_documento: 'Acta de Medición N° 11 - Mantenimiento Puertas Automáticas',
          observaciones: `Importación piloto desde Supabase Storage. Archivo: ${nombreConSufijo}`,
          estado: 'Cargado'
        },
        {
          id: 'row-auto', nro_oc: orderNumber, tipo_documento: 'acta_medicion',
          nombre_documento: nombreFisico, storage_path: `oc/${orderNumber}/${nombreFisico}`,
          observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 11.',
          estado: 'Cargado'
        }
      ];
      const agrupado = window.agruparDocumentosActaEquivalentes(docs, orderNumber);
      return { count: agrupado.length, numero: window.obtenerNumeroActaDocumento(agrupado[0]) };
    }, ORDER_NUMBER);
    expect(result.count).toBe(1);
    expect(result.numero).toBe('11');
  });

  test('CASO 5 — sin evidencia suficiente de equivalencia, NO se fusiona', async ({ page }) => {
    await openIsolated(page);
    const count = await page.evaluate(orderNumber => {
      const docs = [
        { id: 'row-w1', nro_oc: orderNumber, tipo_documento: 'remito_factura', nombre_documento: 'Remito 001.pdf', storage_path: `oc/${orderNumber}/remito001.pdf`, estado: 'Cargado' },
        { id: 'row-w2', nro_oc: orderNumber, tipo_documento: 'remito_factura', nombre_documento: 'Factura A-002.pdf', storage_path: `oc/${orderNumber}/facturaA002.pdf`, estado: 'Cargado' }
      ];
      return window.agruparDocumentosActaEquivalentes(docs, orderNumber).length;
    }, ORDER_NUMBER);
    expect(count).toBe(2);
  });

  test('CASO 6 — submódulo 3: Actas 05..11 con Acta 11 duplicada por sufijo de colisión, sin duplicados inequívocos', async ({ page }) => {
    await openIsolated(page);
    const nombreFisico = `FEMYP ME Nro11 Mant. Puertas Automaticas PC OC ${ORDER_NUMBER}.pdf`;
    await installFixture(page, {
      certifications: [],
      documents: [
        ...['05', '06', '07', '08', '09', '10'].map(nn => ({
          id: `row-serie-${nn}`, orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos', nombre_documento: `ACTA ${nn}.pdf`,
          storage_path: `oc/${ORDER_NUMBER}/ACTA${nn}.pdf`
        })),
        {
          id: 'row-11-piloto', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: 'Acta de Medición N° 11 - Mantenimiento Puertas Automáticas',
          observaciones: `Importación piloto desde Supabase Storage. Archivo: ${nombreFisico.replace('.pdf', ' (7).pdf')}`
        },
        {
          id: 'row-11-auto', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos', nombre_documento: nombreFisico,
          storage_path: `oc/${ORDER_NUMBER}/${nombreFisico}`,
          observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 11.'
        }
      ]
    });
    await renderOrder(page);
    await expect(page.locator('[data-coi-ficha-main-last-cert]')).toHaveText('Acta N° 11 (documental)');
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));
    const rows = page.locator('#panelFichaCertificaciones .actas-documentales-table tbody tr');
    await expect(rows).toHaveCount(7);
  });
});

// ===================== CASO 7 y 8: módulo 5.Documentos real =====================

test.describe('Módulo 5.Documentos — casos 7 y 8', () => {
  test('CASO 7 — cantidad de cards == documentos únicos y los KPI coinciden con el listado', async ({ page }) => {
    await openIsolated(page);
    const nombreFisico11 = `FEMYP ME Nro11 Mant. Puertas Automaticas PC OC ${ORDER_NUMBER}.pdf`;
    await installFixture(page, {
      documents: [
        // Duplicado exacto de Acta de Inicio (mismo storage_path).
        { id: 'row-inicio-a', nro_oc: ORDER_NUMBER, orden_id: ORDER_ID, tipo_documento: 'acta_inicio', nombre_documento: 'Acta de Inicio_OC_Firmada.pdf', storage_path: `oc/${ORDER_NUMBER}/ActaInicioFirmada.pdf`, estado: 'Cargado', storage_bucket: 'coi-documentos' },
        { id: 'row-inicio-b', nro_oc: ORDER_NUMBER, orden_id: ORDER_ID, tipo_documento: 'acta_inicio', nombre_documento: 'Acta de Inicio_OC_Firmada.pdf', storage_path: `oc/${ORDER_NUMBER}/ActaInicioFirmada.pdf`, estado: 'Cargado', storage_bucket: 'coi-documentos' },
        // Acta 05 duplicada (mismo path, dos filas DB).
        { id: 'row-05-a', nro_oc: ORDER_NUMBER, orden_id: ORDER_ID, tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 05.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA05_v1.pdf`, estado: 'Cargado', storage_bucket: 'coi-documentos' },
        { id: 'row-05-b', nro_oc: ORDER_NUMBER, orden_id: ORDER_ID, tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 05.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA05_v1.pdf`, estado: 'Cargado', storage_bucket: 'coi-documentos' },
        // Acta 11 única.
        { id: 'row-11', nro_oc: ORDER_NUMBER, orden_id: ORDER_ID, tipo_documento: 'acta_medicion', nombre_documento: nombreFisico11, storage_path: `oc/${ORDER_NUMBER}/${nombreFisico11}`, estado: 'Cargado', storage_bucket: 'coi-documentos' }
      ]
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaDocumentos'));

    const cards = page.locator('#panelFichaDocumentos .documentos-storage-card');
    await expect(cards).toHaveCount(3);

    const total = await page.locator('#panelFichaDocumentos .documentos-storage-summary > div').first().locator('b').textContent();
    expect(Number(total)).toBe(3);
  });

  test('CASO 8 — el documento canónico en 5.Documentos conserva storage_path y Abrir PDF genera signed URL', async ({ page }) => {
    await openIsolated(page);
    await installFixture(page, {
      documents: [
        { id: 'row-a', nro_oc: ORDER_NUMBER, orden_id: ORDER_ID, tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 05.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA05.pdf`, estado: 'Cargado', storage_bucket: 'coi-documentos' },
        { id: 'row-b', nro_oc: ORDER_NUMBER, orden_id: ORDER_ID, tipo_documento: 'acta_medicion', nombre_documento: 'ACTA 05.pdf', storage_path: `oc/${ORDER_NUMBER}/ACTA05.pdf`, estado: 'Cargado', storage_bucket: 'coi-documentos' }
      ]
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaDocumentos'));
    await installPopupMock(page);

    const openButton = page.locator('#panelFichaDocumentos [data-storage-documento-id]');
    await expect(openButton).toHaveCount(1);
    await expect(openButton).toBeEnabled();
    await openButton.click();

    await expect.poll(() => page.evaluate(() => window.__MULTIOC_FIXTURE_STATE__.signedUrlCalls.length)).toBeGreaterThan(0);
    const calls = await page.evaluate(() => window.__MULTIOC_FIXTURE_STATE__.signedUrlCalls);
    expect(calls[0].path).toBe(`oc/${ORDER_NUMBER}/ACTA05.pdf`);
  });
});

// ===================== Abrir PDF: comportamiento REAL de popup =====================
// Estos tests NO reemplazan window.open por un mock: usan page.waitForEvent
// ('popup') para verificar que el navegador realmente crea una pestaña nueva
// (no bloqueada) y que esa misma pestaña termina navegando a la signed URL
// resuelta. La signed URL se sirve desde el propio servidor local de test
// (misma pestaña http://127.0.0.1) para poder observar la navegación real sin
// depender de un endpoint externo.

test.describe('Abrir PDF — comportamiento real de popup (sin mockear window.open)', () => {
  test('CASO 1 — el click abre una pestaña real del navegador que navega a la signed URL', async ({ page }) => {
    await openIsolated(page);
    const origin = new URL(page.url()).origin;
    const rutaReal = `oc/${ORDER_NUMBER}/ACTA11.pdf`;
    await installFixture(page, {
      documents: [{
        id: 'doc-popup-1', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
        nombre_documento: 'ACTA 11.pdf', estado: 'Cargado', storage_bucket: 'coi-documentos',
        storage_path: rutaReal
      }],
      signedUrlConfig: { okBase: `${origin}/index.html` }
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));

    const openButton = page.locator('#panelFichaCertificaciones [data-storage-documento-id]').first();
    await expect(openButton).toBeEnabled();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      openButton.click()
    ]);
    await expect.poll(() => popup.url(), { timeout: 15000 }).toContain('signed=');
    expect(popup.url()).toContain(encodeURIComponent(rutaReal));
    await popup.close();
  });

  test('CASO 2 — con demora real en createSignedUrl, la pestaña se abre de inmediato y navega después', async ({ page }) => {
    await openIsolated(page);
    const origin = new URL(page.url()).origin;
    const rutaReal = `oc/${ORDER_NUMBER}/ACTA06.pdf`;
    await installFixture(page, {
      documents: [{
        id: 'doc-popup-2', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
        nombre_documento: 'ACTA 06.pdf', estado: 'Cargado', storage_bucket: 'coi-documentos',
        storage_path: rutaReal
      }],
      signedUrlConfig: { okBase: `${origin}/index.html`, delayMs: 900 }
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));

    const openButton = page.locator('#panelFichaCertificaciones [data-storage-documento-id]').first();
    await expect(openButton).toBeEnabled();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      openButton.click()
    ]);
    // La pestaña ya existe (creada de forma sincrónica en el click) antes de
    // que resuelva la signed URL, que se demora artificialmente 900ms.
    expect(popup.url()).toBe('about:blank');
    await expect.poll(() => popup.url(), { timeout: 15000 }).toContain('signed=');
    expect(popup.url()).toContain(encodeURIComponent(rutaReal));
    await popup.close();
  });

  test('CASO 3 — si Storage devuelve error, la pestaña temporal se cierra y aparece un mensaje visible (no solo en consola)', async ({ page }) => {
    await openIsolated(page);
    const origin = new URL(page.url()).origin;
    const rutaInvalida = `oc/${ORDER_NUMBER}/ACTA_NOEXISTE.pdf`;
    await installFixture(page, {
      documents: [{
        id: 'doc-popup-3', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
        nombre_documento: 'ACTA sin storage.pdf', estado: 'Cargado', storage_bucket: 'coi-documentos',
        storage_path: rutaInvalida
      }],
      signedUrlConfig: { okBase: `${origin}/index.html`, failFor: [rutaInvalida] }
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));

    const openButton = page.locator('#panelFichaCertificaciones [data-storage-documento-id]').first();
    await expect(openButton).toBeEnabled();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      openButton.click()
    ]);
    await expect.poll(() => popup.isClosed()).toBe(true);
    await expect(page.locator('.coi-toast.error')).toBeVisible();
    await expect(page.locator('.coi-toast.error')).toContainText('Object not found');
  });

  test('CASO 4 — documento fusionado: la navegación real usa el storage_path del duplicado que sí es válido', async ({ page }) => {
    await openIsolated(page);
    const origin = new URL(page.url()).origin;
    const nombreFisico = `FEMYP ME Nro11 Mant. Puertas Automaticas PC OC ${ORDER_NUMBER}.pdf`;
    const rutaReal = `oc/${ORDER_NUMBER}/${nombreFisico}`;
    await installFixture(page, {
      documents: [
        {
          id: 'row-rich-popup', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: 'Acta de Medición N° 11 - Mantenimiento Puertas Automáticas',
          fecha_documento: '2026-08-10', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-31',
          observaciones: `Importación piloto desde Supabase Storage. Archivo: ${nombreFisico}`
        },
        {
          id: 'row-auto-popup', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: nombreFisico, storage_path: rutaReal,
          observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 11.'
        }
      ],
      signedUrlConfig: { okBase: `${origin}/index.html` }
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));
    const rows = page.locator('#panelFichaCertificaciones .actas-documentales-table tbody tr');
    await expect(rows).toHaveCount(1);

    const openButton = page.locator('#panelFichaCertificaciones [data-storage-documento-id]').first();
    await expect(openButton).toBeEnabled();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      openButton.click()
    ]);
    await expect.poll(() => popup.url(), { timeout: 15000 }).toContain('signed=');
    expect(popup.url()).toContain(encodeURIComponent(rutaReal));
    await popup.close();
  });

  test('CASO 5 — si el path principal no existe en Storage, prueba el candidato del duplicado y navega ahí realmente', async ({ page }) => {
    await openIsolated(page);
    const origin = new URL(page.url()).origin;
    const nombreFisico = `FEMYP ME Nro11 Mant. Puertas Automaticas PC OC ${ORDER_NUMBER}.pdf`;
    const rutaVieja = `oc/${ORDER_NUMBER}/ACTA11_ruta_vieja.pdf`;
    const rutaReal = `oc/${ORDER_NUMBER}/${nombreFisico}`;
    await installFixture(page, {
      documents: [
        {
          // Metadata más rica (gana el puntaje) pero con un storage_path que
          // ya no existe realmente en Storage.
          id: 'row-rich-invalid-path', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: 'Acta de Medición N° 11 - Mantenimiento Puertas Automáticas',
          fecha_documento: '2026-08-10', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-31',
          storage_path: rutaVieja,
          observaciones: `Importación piloto desde Supabase Storage. Archivo: ${nombreFisico}`
        },
        {
          // Duplicado con menos metadata, pero con el path real y vigente.
          id: 'row-auto-valid-path', orden_id: ORDER_ID, nro_oc: ORDER_NUMBER, tipo_documento: 'acta_medicion',
          estado: 'Cargado', storage_bucket: 'coi-documentos',
          nombre_documento: nombreFisico, storage_path: rutaReal,
          observaciones: 'Registro creado automáticamente desde Supabase Storage. Acta detectada: 11.'
        }
      ],
      signedUrlConfig: { okBase: `${origin}/index.html`, failFor: [rutaVieja] }
    });
    await renderOrder(page);
    await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaCertificaciones'));
    const rows = page.locator('#panelFichaCertificaciones .actas-documentales-table tbody tr');
    await expect(rows).toHaveCount(1);

    const openButton = page.locator('#panelFichaCertificaciones [data-storage-documento-id]').first();
    await expect(openButton).toBeEnabled();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      openButton.click()
    ]);
    await expect.poll(() => popup.url(), { timeout: 15000 }).toContain('signed=');
    expect(popup.url()).toContain(encodeURIComponent(rutaReal));
    await popup.close();

    const intentos = await page.evaluate(() => window.__MULTIOC_FIXTURE_STATE__.signedUrlCalls.map(c => c.path));
    expect(intentos).toContain(rutaVieja);
    expect(intentos).toContain(rutaReal);
  });

  // CASO 6: el producto se usa mayormente abriendo index.html por doble click
  // (file://), no servido por un puerto local. Playwright con la config
  // actual navega por http://127.0.0.1 (ver playwright.config.js), así que no
  // podemos abrir file:// directamente en estos tests. Lo que sí podemos
  // verificar de forma determinística es la propiedad estructural de la que
  // depende que esto funcione bajo file:// exactamente igual que bajo http:
  // que la pestaña se abre de forma SÍNCRONA, dentro del gesto de click, antes
  // de cualquier `await` (la activación de usuario no depende del origen).
  // La validación funcional bajo file:// real queda como requisito de
  // aceptación manual (doble click sobre index.html, sesión Supabase
  // autenticada, click en "Abrir PDF").
  test('CASO 6 — la pestaña se abre sincrónicamente antes de cualquier await (no depende de estar servido por localhost)', async () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
    const start = source.indexOf('  async function handleWindowCapture(event){');
    const end = source.indexOf('\n  function initR27(){', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    const popupOpenIndex = block.indexOf("popup = window.open('', '_blank')");
    const firstAwaitIndex = block.indexOf('await abrirDocumentoStorageOC_R27');
    expect(popupOpenIndex).toBeGreaterThan(-1);
    expect(firstAwaitIndex).toBeGreaterThan(-1);
    expect(popupOpenIndex).toBeLessThan(firstAwaitIndex);
  });
});
