const { test, expect } = require('@playwright/test');

const ORDER_ID = '91111111-1111-4111-8111-111111111111';
const ORDER_NUMBER = '4530099777';
const WORK_ID = 'OB-UI-SUPABASE';

async function openIsolated(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    Boolean(window.COI_FICHA_OBRA_UI) &&
    typeof window.recargarDatosDesdeSupabase === 'function' &&
    typeof window.renderFichaOC === 'function'
  );
}

async function installSupabaseFixture(page) {
  await page.evaluate(async ({ orderId, orderNumber, workId }) => {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const user = {
      id: '92222222-2222-4222-8222-222222222222',
      email: 'admin.ui@example.com',
      app_metadata: { role: 'administrador' },
      user_metadata: { rol: 'administrador' }
    };
    const state = {
      rejectCertifications: false,
      order: {
        id: orderId,
        id_obra: workId,
        nro_oc: orderNumber,
        tipo: 'Obra',
        tipo_trabajo: 'Renovación integral de andenes',
        especialidad: 'Obras civiles',
        descripcion: 'Renovación integral de andenes',
        proveedor: 'Constructora del Sur SA',
        estacion: 'Plaza Constitución',
        ramal: 'Línea Roca',
        sector: 'Andén legacy que no debe ocupar el resumen',
        expediente: 'EX-2026-UI',
        monto_total: 125000000,
        moneda: 'ARS',
        fecha_acta_inicio: '2026-01-01',
        plazo_dias: 364,
        fecha_vencimiento: '2026-12-31',
        proxima_certificacion: '2026-09-15',
        fecha_recepcion_documentacion: '2026-07-29',
        fecha_envio_planificacion: '2026-08-05',
        estado_coi: 'En ejecución',
        estado_documental: 'Revisado',
        estado_registro: 'Activo',
        observaciones: 'Registro remoto para QA',
        calidad_datos_estado: 'Verde',
        calidad_datos_score: 100,
        prioridad_operativa: 'Normal',
        estado_envio_pyc: 'Enviado'
      },
      stations: [{
        id: '93333333-3333-4333-8333-333333333333',
        orden_id: orderId,
        nro_oc: orderNumber,
        estacion: 'Plaza Constitución',
        ramal: 'Línea Roca',
        sector: 'Andén 1',
        es_principal: true,
        estado: 'Activa'
      }],
      certifications: [{
        id: '94444444-4444-4444-8444-444444444441',
        orden_id: orderId,
        nro_oc: orderNumber,
        acta_medicion_nro: 7,
        item_nro: '1',
        fecha_inicio: '2026-07-01',
        fecha_fin: '2026-07-31',
        cantidad: 8,
        unidad_medida: 'm',
        servicio_ejecutado_anterior: 4,
        servicio_ejecutado_periodo: 1
      }, {
        id: '94444444-4444-4444-8444-444444444442',
        orden_id: orderId,
        nro_oc: orderNumber,
        acta_medicion_nro: 7,
        item_nro: '2',
        fecha_inicio: '2026-07-01',
        fecha_fin: '2026-07-31',
        cantidad: 2,
        unidad_medida: 'u',
        servicio_ejecutado_anterior: 0.5,
        servicio_ejecutado_periodo: 0.5
      }, {
        id: '94444444-4444-4444-8444-444444444443',
        orden_id: orderId,
        nro_oc: orderNumber,
        acta_medicion_nro: 6,
        item_nro: '1',
        fecha_inicio: '2026-06-01',
        fecha_fin: '2026-06-30',
        cantidad: 10,
        servicio_ejecutado_anterior: 1,
        servicio_ejecutado_periodo: 1
      }],
      documents: [{
        id: '96666666-6666-4666-8666-666666666666',
        orden_id: orderId,
        nro_oc: orderNumber,
        tipo_documento: 'Acta de medición',
        nombre_documento: 'Acta 7.pdf',
        estado: 'Validado',
        storage_bucket: 'coi-documentos',
        storage_path: `${orderNumber}/acta-7.pdf`
      }],
      history: []
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
        if (filter.type === 'is') return row?.[filter.field] === filter.value;
        if (filter.type === 'in') return filter.value.map(String).includes(String(row?.[filter.field]));
        return true;
      }));
      const execute = () => {
        if (table === 'coi_certificaciones' && state.rejectCertifications && operation === 'select') {
          return { data: null, error: { code: '42501', message: 'permission denied for certification fixture' } };
        }
        if (operation === 'insert' || operation === 'upsert') {
          const inserted = (Array.isArray(payload) ? payload : [payload]).map(clone);
          if (table === 'coi_historial_oc') state.history.push(...inserted);
          return { data: clone(inserted), error: null };
        }
        if (operation === 'update') {
          const rows = applyFilters(rowsFor(table));
          rows.forEach(row => Object.assign(row, clone(payload)));
          return { data: clone(rows), error: null };
        }
        if (operation === 'delete') return { data: [], error: null };
        return { data: clone(applyFilters(rowsFor(table))), error: null };
      };
      const query = {
        select() { return query; },
        eq(field, value) { filters.push({ type: 'eq', field, value }); return query; },
        is(field, value) { filters.push({ type: 'is', field, value }); return query; },
        in(field, value) { filters.push({ type: 'in', field, value }); return query; },
        neq() { return query; },
        not() { return query; },
        or() { return query; },
        gte() { return query; },
        lte() { return query; },
        order() { return query; },
        range() { return query; },
        limit() { return Promise.resolve(execute()); },
        single() {
          const result = execute();
          return Promise.resolve({ data: result.data?.[0] || null, error: result.error });
        },
        maybeSingle() {
          const result = execute();
          return Promise.resolve({ data: result.data?.[0] || null, error: result.error });
        },
        insert(value) { operation = 'insert'; payload = value; return query; },
        upsert(value) { operation = 'upsert'; payload = value; return query; },
        update(value) { operation = 'update'; payload = value; return query; },
        delete() { operation = 'delete'; return query; },
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
        from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'Sin documento fixture' } }) })
      }
    };

    window.__COI_SUPABASE_CLIENT__ = client;
    window.getSupabaseClient = () => client;
    window.getUsuarioActual = async () => user;
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.usuarioTienePermisoEdicion = () => true;
    window.__FINAL_UI_SUPABASE_STATE__ = state;

    await window.recargarDatosDesdeSupabase({ silencioso: true });
    if (typeof window.syncExecutiveMetadata === 'function') await window.syncExecutiveMetadata();
  }, { orderId: ORDER_ID, orderNumber: ORDER_NUMBER, workId: WORK_ID });

  await expect.poll(() => page.evaluate(() =>
    typeof window.todasLasOC === 'function' ? window.todasLasOC().length : 0
  )).toBe(1);
}

async function renderWork(page) {
  await page.evaluate(reference => {
    const view = document.getElementById('vistaFichaOC');
    if (view) {
      document.querySelectorAll('section.view.active').forEach(node => node.classList.remove('active'));
      view.classList.add('active');
    }
    window.renderFichaOC(reference);
  }, WORK_ID);
  await expect(page.locator('#fichaOCBody [data-coi-obra-avance]')).toBeVisible();
}

test('Obra: el Resumen General usa vencimiento y certificaciones reales de Supabase', async ({ page }) => {
  await openIsolated(page);
  await installSupabaseFixture(page);
  await renderWork(page);

  await expect(page.locator('#fichaOCBody [data-coi-obra-avance]')).toHaveText('Sin dato');
  await expect(page.locator('#fichaOCBody [data-coi-obra-ultima-certificacion]')).toHaveText('Acta N° 7 · 31/07/2026');

  const summary = await page.evaluate(() => {
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    const card = [...document.querySelectorAll('#fichaOCBody section')]
      .find(section => normalize(section.querySelector('h3')?.textContent).startsWith('1. RESUMEN'));
    return {
      labels: [...card.querySelectorAll('.grid > div > b')].map(node => normalize(node.textContent)),
      text: normalize(card.textContent),
      due: card.querySelector('[data-coi-obra-vencimiento]')?.textContent.trim(),
      days: card.querySelector('[data-coi-obra-dias-restantes]')?.textContent.trim()
    };
  });

  expect(summary.labels).toEqual([
    'ID OBRA', 'N° OC', 'TIPO', 'TIPO DE TRABAJO', 'ESTACION', 'PROVEEDOR',
    'ESTADO COI', 'ESTADO DOCUMENTAL', 'SEMAFORO', 'VENCIMIENTO',
    'DIAS RESTANTES', '% AVANCE', 'ULTIMA CERTIFICACION'
  ]);
  expect(summary.labels).not.toContain('SECTOR');
  expect(summary.text).not.toContain('ANDEN LEGACY');
  expect(summary.due).toBe('31/12/2026');
  expect(summary.days).not.toMatch(/Sin dato/i);
});

test('documentación Storage válida no genera alerta ni penalización por link legacy vacío', async ({ page }) => {
  await openIsolated(page);
  await installSupabaseFixture(page);

  const result = await page.evaluate(() => {
    const order = window.__FINAL_UI_SUPABASE_STATE__.order;
    order.link_documental_principal = '';
    order.estado_link_documental = 'Sin link';
    const quality = window.evaluarCalidadOrden(order);
    const alerts = window.generarAlertasCalidadYDocumentales();
    window.renderDashboardEjecutivo();
    return {
      quality,
      alerts,
      dashboard: document.getElementById('execDashboard')?.textContent || ''
    };
  });

  expect(result.quality.faltantes).not.toContain('link_documental');
  expect(result.quality.criticos.join(' ')).not.toMatch(/link documental/i);
  expect(result.quality.score).toBe(100);
  expect(result.alerts.map(alert => `${alert.tipo} ${alert.msg}`).join(' ')).not.toMatch(/sin link documental/i);
  expect(result.dashboard).not.toMatch(/sin link documental/i);
});

test('certificación con unidades heterogéneas conserva acta y fecha pero no inventa avance global', async ({ page }) => {
  await openIsolated(page);
  await installSupabaseFixture(page);
  await renderWork(page);

  await expect(page.locator('[data-coi-obra-avance]')).toHaveText('Sin dato');
  await expect(page.locator('[data-coi-obra-ultima-certificacion]')).toHaveText('Acta N° 7 · 31/07/2026');
});

test('vencimiento y días restantes usan juntos la fecha persistida o muestran Sin dato', async ({ page }) => {
  await openIsolated(page);
  await installSupabaseFixture(page);
  await renderWork(page);

  const withDue = await page.evaluate(() => ({
    due: document.querySelector('[data-coi-obra-vencimiento]')?.textContent.trim(),
    days: document.querySelector('[data-coi-obra-dias-restantes]')?.textContent.trim()
  }));
  expect(withDue.due).toBe('31/12/2026');
  expect(withDue.days).not.toBe('Sin dato');

  await page.evaluate(async workId => {
    const state = window.__FINAL_UI_SUPABASE_STATE__;
    state.order.fecha_vencimiento = null;
    await window.recargarDatosDesdeSupabase({ silencioso: true });
    window.renderFichaOC(workId);
  }, WORK_ID);

  await expect(page.locator('[data-coi-obra-vencimiento]')).toHaveText('Sin dato');
  await expect(page.locator('[data-coi-obra-dias-restantes]')).toHaveText('Sin dato');
});

test('recarga: Supabase prevalece sobre localStorage y un rechazo no deja éxito visual falso', async ({ page }) => {
  await openIsolated(page);
  await installSupabaseFixture(page);
  await renderWork(page);
  await expect(page.locator('[data-coi-obra-avance]')).toHaveText('Sin dato');

  await page.evaluate(async ({ orderNumber, workId }) => {
    const state = window.__FINAL_UI_SUPABASE_STATE__;
    state.certifications = [{
      id: '95555555-5555-4555-8555-555555555555',
      orden_id: state.order.id,
      nro_oc: orderNumber,
      acta_medicion_nro: 8,
      item_nro: '1',
      fecha_inicio: '2026-08-01',
      fecha_fin: '2026-08-31',
      cantidad: 4,
      servicio_ejecutado_anterior: 2,
      servicio_ejecutado_periodo: 1
    }];
    localStorage.setItem('coi_supabase_ordenes_cache_v2', JSON.stringify({
      savedAt: new Date().toISOString(),
      orders: [{ id_obra: workId, nro_oc: orderNumber, avanceFisico: 99, ultimaCertificacion: 'Acta local falsa' }]
    }));
    localStorage.setItem('coi_certificaciones_oc', JSON.stringify([{
      nro_oc: orderNumber,
      acta_medicion_nro: 99,
      fecha_fin: '2027-12-31',
      cantidad: 1,
      servicio_ejecutado_acumulado: 1,
      aux_porcentaje: 100
    }]));
    await window.recargarDatosDesdeSupabase({ silencioso: true });
    window.renderFichaOC(workId);
  }, { orderNumber: ORDER_NUMBER, workId: WORK_ID });

  await expect(page.locator('[data-coi-obra-avance]')).toHaveText('Sin dato');
  await expect(page.locator('[data-coi-obra-ultima-certificacion]')).toHaveText('Acta N° 8 · 31/08/2026');

  const rejected = await page.evaluate(async workId => {
    const state = window.__FINAL_UI_SUPABASE_STATE__;
    state.rejectCertifications = true;
    window.renderFichaOC(workId);
    const item = window.todasLasOC()[0]?.item;
    const result = await window.COI_FICHA_OBRA_UI.refreshSummary(workId, item);
    return {
      result,
      progress: document.querySelector('[data-coi-obra-avance]')?.textContent.trim(),
      latest: document.querySelector('[data-coi-obra-ultima-certificacion]')?.textContent.trim(),
      persistedRows: state.certifications.length
    };
  }, WORK_ID);

  expect(rejected.result.error).toMatch(/permission denied/i);
  expect(rejected.progress).toBe('Sin dato');
  expect(rejected.latest).toBe('Sin certificación');
  expect(rejected.persistedRows).toBe(1);
});

test('Ficha: contractual no monta OneDrive ni acciones legacy y conserva Storage y Financiero', async ({ page }) => {
  await openIsolated(page);
  await installSupabaseFixture(page);
  await renderWork(page);

  const body = page.locator('#fichaOCBody');
  await expect(body).not.toContainText('Abrir en OneDrive');
  await expect(body).not.toContainText('Repositorio documental');
  await expect(body.getByRole('button', { name: 'Marcar enviado a PyC', exact: true })).toHaveCount(0);
  await expect(body.getByRole('button', { name: 'Agregar link documental', exact: true })).toHaveCount(0);
  await expect(body).not.toContainText(/No enviado|Enviado a PyC|Enviadas a PyC|Estado envío PyC|Envío PyC|No enviada a PyC|Planificación y Control/i);
  await expect(body).not.toContainText('Se guarda automáticamente en localStorage');
  await expect(body).toContainText('Documentación almacenada en Supabase');

  for (const text of ['4. Estado Financiero', 'Posiciones OC', 'Posiciones Certificadas', 'Posiciones Libres', 'Consumir seleccionadas']) {
    await expect(body).toContainText(text);
  }

  await page.evaluate(reference => window.activarModoEdicionOC(reference), WORK_ID);
  const editor = page.locator('#coiEditOCModalV60');
  await expect(editor).toBeVisible();
  await expect(editor).not.toContainText('OneDrive');
  await expect(editor).not.toContainText('Link documental principal');
  await expect(editor).toContainText('Estado documental');
});

test('Centro de Alertas mantiene OC, fecha y días enteros y scroll controlado', async ({ page }) => {
  await openIsolated(page);
  const metrics = await page.evaluate(() => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    const view = document.getElementById('vistaCentroAlertas');
    document.querySelectorAll('section.view.active').forEach(node => node.classList.remove('active'));
    view.classList.add('active');
    view.hidden = false;
    view.style.display = 'block';
    window.renderCentroAlertas();
    const table = view.querySelector('table.coi-alertas-table');
    const tbody = table.tBodies[0];
    tbody.innerHTML = '<tr><td>4520003305</td><td>OC vencida</td><td>PLAZA CONSTITUCIÓN</td><td>FEMYP</td><td>Detalle operativo de la alerta</td><td>2025-02-21</td><td>-543</td><td>Mensaje de seguimiento</td><td>Revisar vigencia contractual</td><td><button>Ver ficha OC</button></td></tr>';
    const wrap = table.closest('.coi-alertas-scroll');
    const cells = tbody.rows[0].cells;
    const css = index => getComputedStyle(cells[index]);
    return {
      tableMinWidth: parseFloat(getComputedStyle(table).minWidth),
      wrapperOverflowX: getComputedStyle(wrap).overflowX,
      wrapperWidth: wrap.clientWidth,
      scrollWidth: wrap.scrollWidth,
      oc: { whiteSpace: css(0).whiteSpace, wordBreak: css(0).wordBreak },
      station: { whiteSpace: css(2).whiteSpace, wordBreak: css(2).wordBreak, overflowWrap: css(2).overflowWrap },
      date: { whiteSpace: css(5).whiteSpace, wordBreak: css(5).wordBreak },
      days: { whiteSpace: css(6).whiteSpace, wordBreak: css(6).wordBreak }
    };
  });

  expect(metrics.tableMinWidth).toBeGreaterThanOrEqual(1600);
  expect(metrics.wrapperOverflowX).toBe('auto');
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.wrapperWidth);
  expect(metrics.oc).toEqual({ whiteSpace: 'nowrap', wordBreak: 'normal' });
  expect(metrics.date).toEqual({ whiteSpace: 'nowrap', wordBreak: 'normal' });
  expect(metrics.days).toEqual({ whiteSpace: 'nowrap', wordBreak: 'normal' });
  expect(metrics.station).toEqual({ whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' });
});

test('la fuente efectiva no vuelve a renderizar los controles contractuales retirados', async ({ page }) => {
  await openIsolated(page);
  const source = await page.locator('html').evaluate(() => document.documentElement.outerHTML);
  expect(source).toContain('table class="coi-table coi-alertas-table"');
  expect(source).toContain('coi-ficha-obra-supabase-summary');
  expect(source).not.toMatch(/<button[^>]*>\s*Agregar\s+link\s+documental\s*<\/button>/i);
  expect(source).not.toMatch(/<button[^>]*>\s*Marcar\s+enviad[oa]\s+a\s+PyC\s*<\/button>/i);
  expect(source).not.toMatch(/Abrir\s+(?:en\s+)?OneDrive/i);
  expect(source).not.toMatch(/data-exec-link-add|execBtnPyc|function\s+markPyC/i);
});
