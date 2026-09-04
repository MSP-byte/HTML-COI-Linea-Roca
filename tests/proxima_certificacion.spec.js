const { test, expect } = require('@playwright/test');

const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER_NUMBER = '4530008964';
const OLD_DATE = '2026-08-15';
const NEW_DATE = '2026-09-15';

async function openIsolated(page) {
  await page.route(/^https?:\/(?!\/127\.0\.0\.1)/, route => route.abort());
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(() =>
    typeof window.actualizarProximaCertificacionOrden === 'function' &&
    typeof window.recargarDatosDesdeSupabase === 'function'
  );
}

async function installSupabaseMock(page, { rejectNextDate = false, withCertification = true } = {}) {
  await page.evaluate(({ rejectNextDate, withCertification, orderId, orderNumber, oldDate, newDate }) => {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const state = {
      rejectNextDate,
      rpcCalls: [],
      serial: 1,
      order: {
        id: orderId,
        nro_oc: orderNumber,
        id_obra: 'OB-RC2-E2E',
        tipo: 'Servicio',
        tipo_trabajo: 'Mantenimiento mensual',
        proveedor: 'Proveedor RC2',
        estacion: 'Banfield',
        ramal: 'Roca',
        sector: 'Andén',
        monto_total: 1000,
        moneda: 'ARS',
        fecha_acta_inicio: '2026-06-15',
        plazo_dias: 365,
        fecha_vencimiento: '2027-06-15',
        proxima_certificacion: oldDate,
        estado_coi: 'En ejecución',
        estado_registro: 'Activo'
      },
      stations: [{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        orden_id: orderId,
        nro_oc: orderNumber,
        estacion: 'Banfield',
        ramal: 'Roca',
        sector: 'Andén',
        es_principal: true,
        estado: 'Activa'
      }],
      certifications: withCertification ? [{
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        orden_id: orderId,
        nro_oc: orderNumber,
        tipo_servicio: 'Servicio',
        acta_medicion_nro: 1,
        proxima_acta_medicion_fecha: newDate,
        fecha_inicio: '2026-08-01',
        fecha_fin: '2026-08-31',
        cantidad: 1,
        servicio_ejecutado_anterior: 0,
        servicio_ejecutado_periodo: 1,
        anio: 2026
      }] : []
    };

    const rowsFor = table => {
      if (table === 'coi_ordenes') return [state.order];
      if (table === 'coi_ordenes_estaciones') return state.stations;
      if (table === 'coi_certificaciones') return state.certifications;
      if (table === 'profiles') return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rol: 'administrador', activo: true }];
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
        if (operation === 'insert' || operation === 'upsert') {
          const incoming = Array.isArray(payload) ? payload : [payload];
          const inserted = incoming.map(item => ({
            ...clone(item),
            id: item?.id || `eeeeeeee-eeee-4eee-8eee-${String(state.serial++).padStart(12, '0')}`
          }));
          if (table === 'coi_certificaciones') state.certifications.push(...inserted);
          return { data: clone(inserted), error: null };
        }
        if (operation === 'update') {
          const rows = applyFilters(rowsFor(table));
          rows.forEach(row => Object.assign(row, clone(payload)));
          return { data: clone(rows), error: null };
        }
        return { data: clone(applyFilters(rowsFor(table))), error: null };
      };
      const query = {
        select() { return query; },
        eq(field, value) { filters.push({ type: 'eq', field, value }); return query; },
        is(field, value) { filters.push({ type: 'is', field, value }); return query; },
        in(field, value) { filters.push({ type: 'in', field, value }); return query; },
        order() { return query; },
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
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); }
      };
      return query;
    }

    const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      },
      from: table => queryFor(table),
      rpc: async (name, args) => {
        state.rpcCalls.push({ name, args: clone(args) });
        if (name !== 'coi_actualizar_orden_integral') {
          return { data: null, error: { code: '42883', message: `RPC no simulada: ${name}` } };
        }
        if (state.rejectNextDate) {
          return { data: null, error: { code: '42501', message: 'permission denied for simulated update' } };
        }
        const keys = Object.keys(args?.p_cambios || {});
        if (keys.length !== 1 || keys[0] !== 'proxima_certificacion') {
          return { data: null, error: { code: '22023', message: 'payload fuera de alcance' } };
        }
        state.order = { ...state.order, proxima_certificacion: args.p_cambios.proxima_certificacion };
        return {
          data: { orden: clone(state.order), campos: ['proxima_certificacion'], sin_cambios: false },
          error: null
        };
      }
    };

    window.__COI_SUPABASE_CLIENT__ = client;
    window.usuarioTienePermisoEdicion = () => true;
    window.confirm = () => true;
    window.__nextCertMock = state;
  }, { rejectNextDate, withCertification, orderId: ORDER_ID, orderNumber: ORDER_NUMBER, oldDate: OLD_DATE, newDate: NEW_DATE });

  await page.evaluate(() => window.recargarDatosDesdeSupabase({ silencioso: true }));
  await expect.poll(() => page.evaluate(() => typeof window.todasLasOC === 'function' ? window.todasLasOC().length : 0)).toBe(1);
  await page.evaluate(async () => {
    if (typeof window.syncExecutiveMetadata === 'function') await window.syncExecutiveMetadata();
  });
  await page.waitForTimeout(25);
}

test('la próxima certificación se confirma por RPC y la recarga conserva Supabase sobre localStorage', async ({ page }) => {
  await openIsolated(page);
  await installSupabaseMock(page);

  const result = await page.evaluate(async ({ orderNumber, oldDate }) => {
    const updated = await window.actualizarProximaCertificacionOrden(orderNumber);
    localStorage.setItem('coi_supabase_ordenes_cache_v2', JSON.stringify({
      savedAt: new Date().toISOString(),
      orders: [{ id: 'LOCAL-FORJADO', nro_oc: orderNumber, proximaCertificacion: oldDate }]
    }));
    await window.recargarDatosDesdeSupabase({ silencioso: true });
    const row = window.todasLasOC().find(item => String(item.oc) === orderNumber);
    const cached = JSON.parse(localStorage.getItem('coi_supabase_ordenes_cache_v2') || '{}').orders?.[0] || {};
    const dateOnly = value => value instanceof Date
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
      : String(value || '').slice(0, 10);
    return {
      updated,
      remoteDate: window.__nextCertMock.order.proxima_certificacion,
      renderedDate: dateOnly(row?.proximaCertificacion),
      cachedDate: cached.proximaCertificacion || cached.proxima_certificacion || cached._supabaseRaw?.proxima_certificacion,
      rpcCalls: window.__nextCertMock.rpcCalls.filter((c) => c.name !== 'coi_current_role')
    };
  }, { orderNumber: ORDER_NUMBER, oldDate: OLD_DATE });

  expect(result.updated.updated).toBe(true);
  expect(result.updated.proxima_certificacion).toBe(NEW_DATE);
  expect(result.remoteDate).toBe(NEW_DATE);
  expect(result.renderedDate).toBe(NEW_DATE);
  expect(result.cachedDate).toBe(NEW_DATE);
  expect(result.rpcCalls).toHaveLength(1);
  expect(result.rpcCalls[0]).toEqual({
    name: 'coi_actualizar_orden_integral',
    args: { p_orden_id: ORDER_ID, p_cambios: { proxima_certificacion: NEW_DATE } }
  });
});

test('si la RPC rechaza la fecha, la certificación queda informada como parcial y no hay éxito visual falso', async ({ page }) => {
  await openIsolated(page);
  await installSupabaseMock(page, { rejectNextDate: true, withCertification: false });

  const result = await page.evaluate(async ({ orderNumber, newDate }) => {
    const row = document.querySelector('#cargaCertificacionBodyR18 tr');
    const set = (field, value) => { row.querySelector(`[data-cert-field="${field}"]`).value = value; };
    set('tipo_servicio', 'Servicio');
    set('acta_medicion_nro', '1');
    set('proxima_acta_medicion_fecha', newDate);
    set('nro_oc', orderNumber);
    set('fecha_inicio', '2026-08-01');
    set('fecha_fin', '2026-08-31');
    set('cantidad', '1');
    set('servicio_ejecutado_periodo', '1');
    await window.guardarCargaCertificaciones();
    const badge = row.querySelector('[data-cert-status]');
    const status = document.getElementById('cargaCertificacionStatusR18');
    const rendered = window.todasLasOC().find(item => String(item.oc) === orderNumber);
    const renderedDate = rendered?.proximaCertificacion instanceof Date
      ? `${rendered.proximaCertificacion.getFullYear()}-${String(rendered.proximaCertificacion.getMonth() + 1).padStart(2, '0')}-${String(rendered.proximaCertificacion.getDate()).padStart(2, '0')}`
      : String(rendered?.proximaCertificacion || '').slice(0, 10);
    return {
      badgeText: badge?.textContent || '',
      badgeClass: badge?.className || '',
      rowClass: row.className,
      statusText: status?.textContent || '',
      statusClass: status?.className || '',
      remoteDate: window.__nextCertMock.order.proxima_certificacion,
      renderedDate,
      certifications: window.__nextCertMock.certifications.length,
      rpcCalls: window.__nextCertMock.rpcCalls.filter((c) => c.name !== 'coi_current_role').length
    };
  }, { orderNumber: ORDER_NUMBER, newDate: NEW_DATE });

  expect(result.certifications).toBe(1);
  expect(result.rpcCalls).toBe(1);
  expect(result.remoteDate).toBe(OLD_DATE);
  expect(result.renderedDate).toBe(OLD_DATE);
  expect(result.badgeText).toMatch(/guardada.*NO actualizada/i);
  expect(result.badgeClass).toMatch(/duplicado/);
  expect(result.badgeClass).not.toMatch(/valida/);
  expect(result.rowClass).toMatch(/certificacion-omitida/);
  expect(result.statusClass).toMatch(/warning/);
  expect(result.statusText).toMatch(/OCs sin fecha sincronizada:\s*1/i);
});
