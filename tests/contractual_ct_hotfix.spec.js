const { test, expect } = require('@playwright/test');

const ORDER_ID = '81111111-1111-4111-8111-111111111111';
const ORDER_NUMBER = '4530099888';
// RPC de solo lectura. coi_current_role() devuelve el rol del llamador
// (`language sql`, `stable`, un select sobre profiles): la capa H04/H05 la usa
// para decidir la autoridad de la UI. No persiste nada, de modo que no puede
// contar como escritura en las aserciones de «no muta ni persiste».
const RPC_DE_LECTURA = ['coi_current_role'];

const OLD_DATE = '2026-08-31';
const NEW_DATE = '2027-10-15';
const EXPECTED_STAGES = [
  'PLIEGOS EN PREPARACION',
  'PLIEGOS TERMINADO SIN SOLPED',
  'PLIEGO CON SOLPED SIN EXPTE',
  'PLIEGO CON OC',
  'PLIEGO CON EXPTE',
  'PLIEGO CON EXPTE Y CON OC EMITIDA, PERO SIN CONTROL DE 3',
  'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',
  'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO',
  'OBRA/SERVICIO EN EJECUCION',
  'OBRA/SERVICIO CANCELADA O SUSPENDIDA',
  'OBRA/SERVICIO FINALIZADA',
  'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA'
];

async function openFixture(page, {
  editable = true,
  session = true,
  remoteDate = OLD_DATE,
  remoteStatus = 'Vigente',
  localDate = OLD_DATE,
  localStatus = 'Vigente'
} = {}) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    typeof window.coiRestoreContractualCT === 'function' &&
    typeof window.renderCircuitoAdministrativoOC === 'function'
  );
  await page.evaluate(({ orderId, orderNumber, editable, session, remoteDate, remoteStatus, localDate, localStatus, rpcDeLectura }) => {
    // El Set se construye DENTRO del navegador: page.evaluate serializa el
    // argumento, no el closure de Node, de modo que una referencia lexica a la
    // constante del fixture explota con «RPC_DE_LECTURA is not defined».
    const rpcSoloLectura = new Set(rpcDeLectura);
    const user = { id: '82222222-2222-4222-8222-222222222222', email: 'admin@coiroca.com' };
    const order = {
      id: orderId,
      nro_oc: orderNumber,
      id_obra: 'OB-HOTFIX-CT',
      tipo: 'Obra',
      moneda: 'ARS',
      estado_documental: 'PLIEGOS EN PREPARACIÓN',
      estado_coi: 'PLIEGOS EN PREPARACIÓN',
      certificable_con_saldo: false,
      saldo_remanente: 125000,
      control_terceros_hasta: localDate,
      control_terceros_estado: localStatus,
      _supabaseRaw: {
        id: orderId,
        nro_oc: orderNumber,
        id_obra: 'OB-HOTFIX-CT',
        tipo: 'Obra',
        moneda: 'ARS',
        estado_documental: 'PLIEGOS EN PREPARACIÓN',
        estado_coi: 'PLIEGOS EN PREPARACIÓN',
        certificable_con_saldo: false,
        saldo_remanente: 125000,
        control_terceros_hasta: remoteDate,
        control_terceros_estado: remoteStatus
      }
    };
    const state = {
      editable,
      session,
      order,
      persisted: { ...order._supabaseRaw },
      rejectCT: false,
      rejectCircuit: false,
      writes: [],
      reads: [],
      localWrites: 0,
      alertRefreshes: 0,
      confirmations: 0,
      toasts: []
    };
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const rowsFor = table => table === 'coi_ordenes' ? [state.persisted] : [];
    function queryFor(table) {
      const filters = [];
      const execute = () => {
        const rows = rowsFor(table).filter(row => filters.every(({ field, value }) => String(row?.[field] ?? '') === String(value ?? '')));
        return { data: clone(rows), error: null };
      };
      const query = {
        select() { return query; },
        eq(field, value) { filters.push({ field, value }); return query; },
        order() { return query; },
        limit() { return Promise.resolve(execute()); },
        single() { const result = execute(); return Promise.resolve({ data: result.data[0] || null, error: result.error }); },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); }
      };
      return query;
    }
    const client = {
      auth: {
        getUser: async () => ({ data: { user: state.session ? user : null }, error: null }),
        getSession: async () => ({ data: { session: state.session ? { user } : null }, error: null })
      },
      from: table => queryFor(table),
      rpc: async (name, args) => {
        // Lecturas: no mutan nada y no pueden contarse como persistencia.
        if (rpcSoloLectura.has(name)) {
          state.reads.push({ name, args: clone(args) });
        } else {
          state.writes.push({ name, args: clone(args) });
        }
        if (name === 'coi_guardar_orden_integral') {
          if (state.rejectCT) return { data: null, error: { code: '42501', message: 'permission denied fixture CT' } };
          Object.assign(state.persisted, clone(args.p_datos));
          return { data: { ...clone(state.persisted), accion: 'updated' }, error: null };
        }
        if (name === 'coi_actualizar_orden_integral') {
          if (state.rejectCT) return { data: null, error: { code: '42501', message: 'permission denied fixture CT' } };
          Object.assign(state.persisted, clone(args.p_cambios));
          return { data: { orden: clone(state.persisted) }, error: null };
        }
        if (name === 'coi_confirmar_etapa_circuito_v2') {
          if (state.rejectCircuit) return { data: null, error: { code: '42501', message: 'permission denied fixture circuit' } };
          const nombre = args.p_codigo === 'ejecucion' ? 'OBRA/SERVICIO EN EJECUCIÓN' : state.persisted.estado_documental;
          state.persisted.estado_documental = nombre;
          state.persisted.estado_coi = nombre;
          return {
            data: {
              orden: clone(state.persisted),
              nombre,
              ya_confirmada: false,
              historial: [{
                id: '83333333-3333-4333-8333-333333333333',
                nro_oc: orderNumber,
                orden_id: orderId,
                tipo_evento: 'Circuito administrativo',
                campo_modificado: args.p_codigo,
                fecha_evento: new Date().toISOString(),
                usuario_email: user.email
              }]
            },
            error: null
          };
        }
        return { data: null, error: { code: '42883', message: `RPC no simulada: ${name}` } };
      }
    };
    window.__HOTFIX_STATE__ = state;
    window.__coiFichaOCActiva = orderNumber;
    window.ocActualId = orderNumber;
    window.getSupabaseClient = () => client;
    window.getUsuarioActual = async () => state.session ? user : null;
    window.usuarioTienePermisoEdicion = () => state.editable;
    window.esAutorizacionAdministrativaSupabaseV60 = () => state.editable;
    window.APP_STATE = { ...(window.APP_STATE || {}), role: state.editable ? 'administrador' : 'consulta', activeView: 'vistaFichaOC' };
    window.resolverOrdenActual = () => state.order;
    window.obtenerOC = () => ({ item: state.order });
    window.todasLasOC = () => [{ item: state.order }];
    window.guardarBaseLocal = () => { state.localWrites += 1; };
    window.guardarOrdenesSupabaseCache = () => {};
    window.renderCentroAlertas = () => { state.alertRefreshes += 1; };
    window.toast = (message, type = 'info') => { state.toasts.push({ message, type }); };
    window.confirm = () => { state.confirmations += 1; return true; };
    window.prompt = () => '';
    window.registrarHistorialOC = async () => {};
    window.recargarDatosDesdeSupabase = async () => {
      Object.assign(state.order, clone(state.persisted));
      state.order._supabaseRaw = clone(state.persisted);
    };
    window.renderFichaOC = () => { window.coiRestoreContractualCT(orderNumber); };
    document.body.classList.toggle('modo-admin', editable);
    const view = document.getElementById('vistaFichaOC');
    document.querySelectorAll('section.view.active').forEach(node => node.classList.remove('active'));
    view.classList.add('active');
    view.hidden = false;
    view.style.display = 'block';
    const body = document.getElementById('fichaOCBody');
    body.innerHTML = `<div class="oc-kpis"><div class="oc-kpi"><b>${state.order.estado_documental}</b><span>Estado documental</span></div></div>
      <section id="panelFichaContractual" class="expediente-card ficha-oc-panel active"><h3>2. CONTRACTUAL</h3></section>`;
    window.coiRestoreContractualCT(orderNumber);
  }, { orderId: ORDER_ID, orderNumber: ORDER_NUMBER, editable, session, remoteDate, remoteStatus, localDate, localStatus, rpcDeLectura: RPC_DE_LECTURA });
  await expect(page.locator('[data-coi-contractual-circuit-hotfix]')).toHaveCount(1);
}

async function stateSnapshot(page) {
  return page.evaluate(() => {
    const state = window.__HOTFIX_STATE__;
    return {
      orderDate: state.order.control_terceros_hasta,
      orderStatus: state.order.control_terceros_estado,
      persistedDate: state.persisted.control_terceros_hasta,
      persistedStatus: state.persisted.control_terceros_estado,
      documentState: state.order.estado_documental,
      persistedDocumentState: state.persisted.estado_documental,
      persistedCoiState: state.persisted.estado_coi,
      certificableWithBalance: state.persisted.certificable_con_saldo,
      remainingBalance: state.persisted.saldo_remanente,
      writes: state.writes,
      reads: state.reads,
      localWrites: state.localWrites,
      alertRefreshes: state.alertRefreshes,
      confirmations: state.confirmations,
      toasts: state.toasts
    };
  });
}

test('Ficha contractual monta exactamente 12 etapas y no duplica módulos al rerender', async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('[data-circuito-etapa]')).toHaveCount(12);
  expect(await page.locator('.circuito-etapa-titulo').allTextContents()).toEqual(EXPECTED_STAGES);
  await expect(page.locator('[data-r28-ct-card] [data-r28-ct-edit]')).toHaveCount(1);
  await expect(page.locator('[data-r28-ct-contractual] [data-r28-ct-edit]')).toHaveCount(1);

  await page.evaluate(orderNumber => {
    window.coiRestoreContractualCT(orderNumber);
    window.coiRestoreContractualCT(orderNumber);
  }, ORDER_NUMBER);

  await expect(page.locator('[data-coi-contractual-circuit-hotfix]')).toHaveCount(1);
  await expect(page.locator('#circuitoAdministrativoOCR18')).toHaveCount(1);
  await expect(page.locator('[data-r28-ct-card]')).toHaveCount(1);
  await expect(page.locator('[data-r28-ct-contractual]')).toHaveCount(1);
  const text = await page.locator('#fichaOCBody').innerText();
  expect(text).not.toMatch(/OneDrive|Agregar link documental|Marcar enviada a PyC/i);
  await expect(page.getByRole('button', { name: /Marcar enviada a PyC/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Agregar link documental/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Abrir.*OneDrive/i })).toHaveCount(0);
  await expect(page.locator('[data-circuito-etapa="enviada_pyc"]')).toHaveCount(0);
});

test('etapas 1–12 conservan su render actual sin historial', async ({ page }) => {
  await openFixture(page);
  const stages = page.locator('[data-circuito-etapa]');
  await expect(stages.nth(0)).toHaveClass(/\bactual\b/);
  await expect(stages.nth(0).locator('.circuito-etapa-estado')).toHaveText('Etapa actual');
  await expect(stages.nth(0).locator('.circuito-etapa-meta')).toHaveText('Pendiente de confirmación');
  for (let index = 1; index < 12; index += 1) {
    await expect(stages.nth(index)).toHaveClass(/\bpendiente\b/);
    await expect(stages.nth(index).locator('.circuito-etapa-estado')).toHaveText('Pendiente');
    await expect(stages.nth(index).locator('.circuito-etapa-meta')).toHaveText('Pendiente de confirmación');
  }
});

test('Control de Terceros lee _supabaseRaw y deriva estado si Supabase devuelve estado null', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'UTC' });
  const page = await context.newPage();
  // Reloj fijo en UTC: "hoy" queda pinneado en 2026-08-26 sin depender del
  // dia real de ejecucion ni de la zona horaria del runner (evita el time-bomb
  // que rompio en CI cuando el runner ya estaba en 2026-08-27 UTC).
  await page.clock.setFixedTime(new Date('2026-08-26T12:00:00Z'));
  await openFixture(page, {
    remoteDate: '2026-08-26',
    remoteStatus: null,
    localDate: '',
    localStatus: ''
  });
  await expect(page.locator('[data-r28-ct-card] .ct-date')).toHaveText('2026-08-26');
  await expect(page.locator('[data-r28-ct-contractual] .ct-date')).toHaveText('2026-08-26');
  await expect(page.locator('[data-r28-ct-card] .ct-status')).toContainText('Próximo a vencer');
  await expect(page.locator('[data-r28-ct-contractual] .ct-status')).toContainText('Próximo a vencer');
  const state = await stateSnapshot(page);
  expect(state.writes).toHaveLength(0);
  await context.close();
});

test('Control de Terceros usa "hoy" local y no UTC durante el cruce de medianoche en America/Argentina/Buenos_Aires', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/Argentina/Buenos_Aires' });
  const page = await context.newPage();
  // 23:30 hora local (UTC-3) == 02:30 UTC del día siguiente: el bug tomaba "hoy" desde toISOString() (UTC).
  await page.clock.setFixedTime(new Date('2026-08-26T23:30:00-03:00'));
  await openFixture(page, { remoteDate: '2026-08-26', remoteStatus: null, localDate: '', localStatus: '' });
  await expect(page.locator('[data-r28-ct-card] .ct-status')).toContainText('Próximo a vencer');
  await expect(page.locator('[data-r28-ct-contractual] .ct-status')).toContainText('Próximo a vencer');
  await context.close();
});

test('Control de Terceros sobrevive navegación, rerender y recarga simulada desde Supabase', async ({ page }) => {
  await openFixture(page, { remoteDate: '2026-08-26', remoteStatus: null, localDate: '', localStatus: '' });
  await page.evaluate(orderNumber => {
    const contractual = document.getElementById('panelFichaContractual');
    const other = document.createElement('section');
    other.id = 'panelFichaResumenFixture';
    contractual.after(other);
    contractual.classList.remove('active');
    other.classList.add('active');
    other.classList.remove('active');
    contractual.classList.add('active');
    window.coiRestoreContractualCT(orderNumber);
    window.coiRestoreContractualCT(orderNumber);
  }, ORDER_NUMBER);
  await page.evaluate(async orderNumber => {
    window.__HOTFIX_STATE__.order.control_terceros_hasta = '';
    await window.recargarDatosDesdeSupabase({ silencioso: true });
    window.coiRestoreContractualCT(orderNumber);
  }, ORDER_NUMBER);
  await expect(page.locator('[data-r28-ct-card] .ct-date')).toHaveText('2026-08-26');
  await expect(page.locator('[data-r28-ct-contractual] .ct-date')).toHaveText('2026-08-26');
  await expect(page.locator('[data-r28-ct-card]')).toHaveCount(1);
  await expect(page.locator('[data-r28-ct-contractual]')).toHaveCount(1);
});

test('resolver el rol administrador reinserta Editar CT de forma idempotente', async ({ page }) => {
  await openFixture(page, { editable: false });
  await expect(page.locator('[data-r28-ct-edit]')).toHaveCount(0);
  await page.evaluate(() => {
    window.__HOTFIX_STATE__.editable = true;
    window.APP_STATE.role = 'administrador';
    window.actualizarPermisosEdicion();
    window.actualizarPermisosEdicion();
  });
  await expect(page.locator('[data-r28-ct-card] [data-r28-ct-edit]')).toHaveCount(1);
  await expect(page.locator('[data-r28-ct-contractual] [data-r28-ct-edit]')).toHaveCount(1);
  await expect(page.locator('[data-r28-ct-card]')).toHaveCount(1);
  await expect(page.locator('[data-r28-ct-contractual]')).toHaveCount(1);
});

test('coi_current_role queda registrada como lectura y no como escritura', async ({ page }) => {
  await openFixture(page);
  // El fixture clasifica los RPC con un Set construido dentro del navegador.
  // Si esa lista volviera a leerse por closure de Node, esta llamada explotaria
  // con «RPC_DE_LECTURA is not defined» antes de poder clasificarse.
  await page.evaluate(async () => {
    const c = window.getSupabaseClient();
    await c.rpc('coi_current_role');
    await c.rpc('coi_guardar_orden_integral', { p_datos: {} });
  });
  const state = await stateSnapshot(page);
  expect(state.reads.map(r => r.name)).toContain('coi_current_role');
  expect(state.writes.map(w => w.name)).not.toContain('coi_current_role');
  expect(state.writes.map(w => w.name)).toContain('coi_guardar_orden_integral');
});

test('Control de Terceros permite cancelar sin mutar ni persistir', async ({ page }) => {
  await openFixture(page);
  const card = page.locator('[data-r28-ct-card]');
  await card.locator('[data-r28-ct-edit]').click();
  await card.locator('[data-r28-ct-input]').fill(NEW_DATE);
  await card.locator('[data-r28-ct-cancel]').click();

  await expect(card.locator('.ct-date')).toHaveText(OLD_DATE);
  const state = await stateSnapshot(page);
  expect(state.orderDate).toBe(OLD_DATE);
  expect(state.persistedDate).toBe(OLD_DATE);
  expect(state.writes).toHaveLength(0);
  expect(state.localWrites).toBe(0);
});

test('rechazo Supabase de CT conserva el valor anterior y no informa éxito local', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => { window.__HOTFIX_STATE__.rejectCT = true; });
  const card = page.locator('[data-r28-ct-card]');
  await card.locator('[data-r28-ct-edit]').click();
  await card.locator('[data-r28-ct-input]').fill(NEW_DATE);
  await card.locator('[data-r28-ct-save]').click();
  await expect.poll(() => page.evaluate(() => window.__HOTFIX_STATE__.toasts.at(-1)?.message || '')).toMatch(/No se guardó Control de Terceros/i);

  await expect(card.locator('.ct-date')).toHaveText(OLD_DATE);
  await expect(card.locator('[data-r28-ct-input]')).toHaveValue(NEW_DATE);
  const state = await stateSnapshot(page);
  expect(state.orderDate).toBe(OLD_DATE);
  expect(state.persistedDate).toBe(OLD_DATE);
  expect(state.localWrites).toBe(0);
  expect(state.writes.map(write => write.name)).toEqual(['coi_guardar_orden_integral']);
  expect(state.toasts.map(item => item.message).join(' ')).not.toMatch(/guardado localmente/i);
});

test('éxito Supabase de CT actualiza fecha, estado, KPI, contractual y alertas', async ({ page }) => {
  await openFixture(page);
  const card = page.locator('[data-r28-ct-card]');
  await card.locator('[data-r28-ct-edit]').click();
  await card.locator('[data-r28-ct-input]').fill(NEW_DATE);
  await card.locator('[data-r28-ct-save]').click();

  await expect(card.locator('.ct-date')).toHaveText(NEW_DATE);
  await expect(page.locator('[data-r28-ct-contractual]')).toContainText(NEW_DATE);
  const state = await stateSnapshot(page);
  expect(state.orderDate).toBe(NEW_DATE);
  expect(state.persistedDate).toBe(NEW_DATE);
  expect(state.orderStatus).toBe(state.persistedStatus);
  expect(state.localWrites).toBeGreaterThan(0);
  expect(state.alertRefreshes).toBeGreaterThan(0);
  expect(state.toasts.at(-1)).toMatchObject({ type: 'ok' });
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ name: 'coi_guardar_orden_integral' });
});

test('circuito contractual conserva estado local si Supabase rechaza y muta sólo tras confirmar', async ({ page }) => {
  await openFixture(page);
  const rejected = await page.evaluate(async orderNumber => {
    const state = window.__HOTFIX_STATE__;
    state.rejectCircuit = true;
    try {
      await window.actualizarEstadoDocumentalDesdePasoContractual(orderNumber, 'ejecucion', { allowLocalFallback: false });
      return null;
    } catch (error) {
      return error.message;
    }
  }, ORDER_NUMBER);
  expect(rejected).toMatch(/permission denied/i);
  let state = await stateSnapshot(page);
  expect(state.documentState).toBe('PLIEGOS EN PREPARACIÓN');
  expect(state.persistedDocumentState).toBe('PLIEGOS EN PREPARACIÓN');
  expect(state.localWrites).toBe(0);

  await page.evaluate(async orderNumber => {
    const state = window.__HOTFIX_STATE__;
    state.rejectCircuit = false;
    await window.actualizarEstadoDocumentalDesdePasoContractual(orderNumber, 'ejecucion', { allowLocalFallback: false });
  }, ORDER_NUMBER);
  state = await stateSnapshot(page);
  expect(state.persistedDocumentState).toBe('OBRA/SERVICIO EN EJECUCIÓN');
  expect(state.documentState).toBe('OBRA/SERVICIO EN EJECUCIÓN');
  expect(state.localWrites).toBeGreaterThan(0);
});

test('Editar OC deriva y persiste fecha y estado de Control de Terceros', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(orderNumber => window.COI_ORDENES_EDIT_V60.abrir(orderNumber), ORDER_NUMBER);
  const modal = page.locator('#coiEditOCModalV60');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-coi-edit-field="control_terceros_hasta"]')).toHaveCount(1);
  await expect(modal.locator('[data-coi-edit-field="control_terceros_estado"]')).toHaveCount(0);
  await expect(modal).not.toContainText(/Estado envío PyC|Envío PyC|Enviado a PyC/i);
  await expect(modal.locator('#coiEditDirtyV60')).toHaveText('Sin cambios pendientes');
  await modal.locator('[data-coi-edit-field="control_terceros_hasta"]').fill(NEW_DATE);
  await expect(modal.locator('#coiEditDirtyV60')).toContainText('Cambios pendientes');
  await modal.locator('#coiEditSaveV60').click();
  await expect(modal).toBeHidden();
  const state = await stateSnapshot(page);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    name: 'coi_actualizar_orden_integral',
    args: {
      p_orden_id: ORDER_ID,
      p_cambios: {
        control_terceros_hasta: NEW_DATE,
        control_terceros_estado: 'Vigente'
      }
    }
  });
  expect(state.persistedDate).toBe(NEW_DATE);
  expect(state.persistedStatus).toBe('Vigente');
  await expect(page.locator('[data-r28-ct-card] .ct-date')).toHaveText(NEW_DATE);
});

test('usuario autorizado puede reingresar a una etapa confirmada y vuelve a auditar en Supabase', async ({ page }) => {
  await openFixture(page);
  const stage = page.locator('[data-circuito-etapa="ejecucion"]');
  await stage.evaluate(node => { node.dataset.circuitoConfirmada = 'true'; });
  await stage.click();
  await expect.poll(() => page.evaluate(() => window.__HOTFIX_STATE__.writes.length)).toBe(1);
  const state = await stateSnapshot(page);
  expect(state.confirmations).toBe(1);
  expect(state.writes[0]).toMatchObject({
    name: 'coi_confirmar_etapa_circuito_v2',
    args: { p_codigo: 'ejecucion' }
  });
  expect(state.persistedDocumentState).toBe('OBRA/SERVICIO EN EJECUCIÓN');
});

test('sin sesión ni permiso, circuito y Control de Terceros quedan en lectura', async ({ page }) => {
  await openFixture(page, { editable: false, session: false });
  await expect(page.locator('[data-circuito-etapa]')).toHaveCount(12);
  await expect(page.locator('.circuito-lectura-aviso')).toContainText('Modo lectura');
  await expect(page.locator('[data-r28-ct-edit],[data-r28-ct-save],[data-r28-ct-cancel]')).toHaveCount(0);
  const state = await stateSnapshot(page);
  expect(state.writes).toHaveLength(0);
  expect(state.localWrites).toBe(0);
});
