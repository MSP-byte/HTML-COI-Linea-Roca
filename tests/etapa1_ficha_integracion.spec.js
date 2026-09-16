const { test, expect } = require('@playwright/test');

/* INTEGRACIÓN del pipeline contractual E1 DENTRO de la Ficha OC real.
   `etapa1_pipeline_contractual.spec.js` cubre el renderer aislado: pinta
   __COI_ETAPA1_RENDER__ en un host propio y verifica la lógica del pipeline.
   Eso NO prueba que la Ficha lo monte: la regresión que motivó este archivo
   pasaba todos esos tests con la pestaña Contractual vacía.

   Acá se abre la Ficha por el camino real (renderFichaOC completo, con sus
   envoltorios, organizarSubmodulosFichaOC e injectCT) y por deep-link del
   router, y se afirma sobre el DOM de #panelFichaContractual.

   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

const OC = '4530009514';
const ORDEN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EMAIL = 'admin@coiroca.com';
const ACTA = 'control_terceros_con_acta';

const EVENTO = (codigo, fecha) => ({
  id: 'ev-' + codigo + '-' + fecha,
  orden_id: ORDEN_ID, nro_oc: OC,
  tipo_evento: 'Circuito administrativo',
  campo_modificado: codigo, fecha_evento: fecha,
  usuario_email: EMAIL, motivo: null
});

const PANEL = '#fichaOCBody #panelFichaContractual';
const PIPELINE = PANEL + ' #etapa1PipelineContractual';
const LEGACY = PANEL + ' [data-coi-contractual-circuit-hotfix],' +
  PANEL + ' [data-v64-circuito-contractual],' + PANEL + ' #circuitoAdministrativoOCR18';

async function preparar(page, opciones = {}) {
  const c = Object.assign({
    tipo: 'Obra', historial: [], fecha_acta_inicio: null,
    estado_coi: 'PLIEGOS EN PREPARACIÓN'
  }, opciones);

  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.addInitScript(({ c, oc, ordenId, uid, email }) => {
    const orden = {
      id: ordenId, nro_oc: oc, numeroOC: oc, oc,
      idObra: 'OBRA-' + oc, id_obra: 'OBRA-' + oc,
      tipo: c.tipo, descripcion: c.tipo + ' E1', proveedor: 'PROVEEDOR E1',
      estacion: 'Plaza Constitución',
      estado_coi: c.estado_coi, estado_documental: c.estado_coi,
      estadoDocumental: c.estado_coi,
      fecha_acta_inicio: c.fecha_acta_inicio,
      monto_total: 1000, moneda: 'ARS'
    };
    orden._supabaseRaw = Object.assign({}, orden);
    window.__FIX__ = { orden, historial: c.historial.slice(), rpc: [] };

    const consulta = (tabla) => {
      const datos = () => tabla === 'coi_ordenes' ? [orden]
        : tabla === 'coi_historial_oc' ? window.__FIX__.historial : [];
      const api = {
        select: () => api, order: () => api, limit: () => api, range: () => api,
        in: () => api, is: () => api, ilike: () => api, gt: () => api, eq: () => api,
        single: async () => ({ data: datos()[0] || null, error: null }),
        then(res, rej) {
          return Promise.resolve({ data: datos().map(x => Object.assign({}, x)), error: null }).then(res, rej);
        }
      };
      return api;
    };
    const fake = {
      from: consulta,
      rpc: async (nombre, args) => {
        window.__FIX__.rpc.push({ nombre, args: JSON.parse(JSON.stringify(args || {})) });
        if (nombre === 'coi_current_role') return { data: 'administrador', error: null };
        if (nombre !== 'coi_confirmar_etapa_circuito_v2') return { data: null, error: null };
        const ev = {
          id: 'ev-' + args.p_codigo + '-' + Date.now(), orden_id: ordenId, nro_oc: oc,
          tipo_evento: 'Circuito administrativo', campo_modificado: args.p_codigo,
          fecha_evento: new Date().toISOString(), usuario_email: email,
          motivo: args.p_observacion || null
        };
        window.__FIX__.historial.push(ev);
        if (args.p_codigo === 'control_terceros_con_acta') {
          orden.fecha_acta_inicio = '2026-09-15';
          orden._supabaseRaw.fecha_acta_inicio = '2026-09-15';
        }
        return { data: { orden, historial: [ev], codigo: args.p_codigo, nombre: args.p_codigo, ya_confirmada: false }, error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: uid, email } } }, error: null }),
        getUser: async () => ({ data: { user: { id: uid, email } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };

    const coincide = (r) => {
      const v = String(r == null ? '' : r).trim().toUpperCase();
      return v === oc || v === ('OBRA-' + oc).toUpperCase() || v === String(ordenId).toUpperCase();
    };
    const found = { estacion: { nombre: 'Plaza Constitución' }, item: orden };

    /* Los resolvers de la aplicación son declaraciones de función de nivel
       superior: se crean al parsear el script y pisarían cualquier override
       instalado antes. Por eso se reinstalan cuando el DOM ya está listo,
       antes de que corran los init() de la aplicación y el router. */
    const instalar = () => {
      window.__COI_SUPABASE_CLIENT__ = fake;
      window.getSupabaseClient = () => fake;
      window.initSupabase = async () => fake;
      window.getUsuarioActual = async () => ({ id: uid, email });
      window.getUsuarioActualR12 = async () => ({ id: uid, email });
      window.esAutorizacionAdministrativaSupabaseV60 = () => true;
      window.usuarioTienePermisoEdicion = () => true;
      window.obtenerOC = r => coincide(r) ? found : null;
      window.buscarPorIdObra = r => coincide(r) ? found : null;
      window.resolverOrdenActual = r => coincide(r) ? orden : null;
      window.todasLasOC = () => [found];
      window.__COI_CIRCUITO_CACHE_GET__ = () => window.__FIX__.historial;
      window.cargarHistorialCircuitoOC = async () => window.__FIX__.historial;
      window.guardarBaseLocal = () => {};
      window.guardarOrdenesSupabaseCache = () => {};
      // El router sólo abre una OC puntual con catálogo confirmado.
      window.__COI_H06_ORDENES__ = {
        confirmadas: () => 1, uidConfirmado: () => uid,
        estadoLectura: () => 'listo', lecturaActualConfirmada: () => true
      };
      if (document.body) document.body.classList.add('modo-admin');
    };
    instalar();
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  }, { c, oc: OC, ordenId: ORDEN_ID, uid: UID, email: EMAIL });
}

// Camino B del reporte: abrir la Ficha y luego hacer click en Contractual.
async function abrirPorNavegacion(page, opciones) {
  await preparar(page, opciones);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.renderFichaOC === 'function' && typeof window.__COI_ETAPA1_RENDER__ === 'function',
    null, { timeout: 20000 });
  await page.evaluate(oc => window.abrirFichaOC('OBRA-' + oc), OC);
  await page.locator(PANEL).waitFor({ state: 'attached', timeout: 15000 });
  await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaContractual'));
  await page.locator(PIPELINE).waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
}

// Camino A del reporte: deep-link directo a /ficha-oc/{OC}/contractual.
async function abrirPorDeepLink(page, opciones) {
  await preparar(page, opciones);
  await page.goto('/index.html#ficha-oc/' + OC + '/contractual', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.renderFichaOC === 'function' && typeof window.__COI_ETAPA1_RENDER__ === 'function',
    null, { timeout: 20000 });
  await page.locator(PANEL + '.active').waitFor({ state: 'attached', timeout: 20000 });
  await page.locator(PIPELINE).waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
}

const diagnostico = page => page.evaluate(() => {
  const panel = document.querySelector('#fichaOCBody #panelFichaContractual');
  const q = sel => panel ? panel.querySelectorAll(sel).length : 0;
  const panel2 = panel && panel.querySelector('#etapa1Panel2');
  return {
    panelActivo: !!(panel && panel.classList.contains('active')),
    pipelines: q('#etapa1PipelineContractual'),
    legacy: q('[data-coi-contractual-circuit-hotfix],[data-v64-circuito-contractual],#circuitoAdministrativoOCR18'),
    controlTerceros: q('[data-r28-ct-contractual]'),
    tab1: q('#etapa1Tab1'),
    tab2: q('#etapa1Tab2'),
    hitos: q('#etapa1Pipeline [data-etapa1-hito]'),
    hitosEtapa2: q('#etapa1Panel2 [data-etapa1-hito]'),
    etapa2Habilitada: panel2 ? panel2.getAttribute('data-etapa1-habilitada') : '',
    avance: panel && panel.querySelector('#etapa1Avance') ? panel.querySelector('#etapa1Avance').textContent : '',
    estadoActual: panel && panel.querySelector('#etapa1EstadoActual') ? panel.querySelector('#etapa1EstadoActual').textContent : '',
    transversal: q('#etapa1Transversal [data-etapa1-hito]'),
    bloqueoTexto: panel && panel.querySelector('#etapa1Etapa2Bloqueada')
      ? panel.querySelector('#etapa1Etapa2Bloqueada').textContent : '',
    rendererExiste: typeof window.__COI_ETAPA1_RENDER__ === 'function'
  };
});

/* ---------------------------------------------------------------- render */

test('E1F-1 · OC tipo OBRA: Contractual monta el pipeline dentro de la Ficha', async ({ page }) => {
  await abrirPorNavegacion(page, { tipo: 'Obra' });
  const d = await diagnostico(page);
  expect(d.panelActivo).toBe(true);
  expect(d.pipelines).toBe(1);
  expect(d.hitos).toBe(8);
  expect(d.controlTerceros).toBe(1);
});

test('E1F-2 · OC tipo SERVICIO: Contractual monta el pipeline dentro de la Ficha', async ({ page }) => {
  await abrirPorNavegacion(page, { tipo: 'Servicio' });
  const d = await diagnostico(page);
  expect(d.pipelines).toBe(1);
  expect(d.hitos).toBe(8);
  expect(d.controlTerceros).toBe(1);
});

/* Falla si desaparecen ambas etapas: es la regresión exacta del reporte,
   donde Contractual quedaba con Datos contractuales y Control de Terceros
   pero sin ninguna representación del circuito. */
test('E1F-3 · Contractual nunca queda sin las dos etapas', async ({ page }) => {
  await abrirPorNavegacion(page);
  const d = await diagnostico(page);
  expect(d.tab1).toBe(1);
  expect(d.tab2).toBe(1);
  expect(d.hitos).toBeGreaterThan(0);
  expect(d.hitosEtapa2).toBeGreaterThan(0);
  await expect(page.locator(PANEL + ' #etapa1Titulo')).toHaveText('SEGUIMIENTO CONTRACTUAL Y EJECUCIÓN');
});

/* Falla si existe __COI_ETAPA1_RENDER__ pero el componente no está montado.
   La causa raíz era exactamente esa: la integración retiraba el circuito
   legacy por la sola existencia de la función. */
test('E1F-4 · si existe el renderer, el componente tiene que estar montado', async ({ page }) => {
  await abrirPorNavegacion(page);
  const d = await diagnostico(page);
  expect(d.rendererExiste).toBe(true);
  expect(d.pipelines).toBe(1);
  // Una sola representación: el legacy se retira sólo tras montar el nuevo.
  expect(d.legacy).toBe(0);
});

/* Si el renderer nuevo falla, Contractual conserva el circuito legacy.
   Nunca puede quedarse sin representación del circuito. */
test('E1F-5 · si el renderer nuevo falla, queda el circuito legacy', async ({ page }) => {
  await preparar(page);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.renderFichaOC === 'function' && typeof window.__COI_ETAPA1_RENDER__ === 'function',
    null, { timeout: 20000 });
  await page.evaluate(() => {
    window.__COI_ETAPA1_RENDER__ = () => { throw new Error('fixture: renderer E1 roto'); };
  });
  await page.evaluate(oc => window.abrirFichaOC('OBRA-' + oc), OC);
  await page.locator(PANEL).waitFor({ state: 'attached', timeout: 15000 });
  await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaContractual'));
  await page.locator(LEGACY).first().waitFor({ state: 'attached', timeout: 15000 });
  const d = await diagnostico(page);
  expect(d.rendererExiste).toBe(true);
  expect(d.pipelines).toBe(0);
  expect(d.legacy).toBeGreaterThan(0);
  expect(d.controlTerceros).toBe(1);
});

/* ------------------------------------------------------------------ gate */

test('E1F-6 · sin Acta de Inicio la 2° Etapa se ve pero está bloqueada', async ({ page }) => {
  await abrirPorNavegacion(page);
  const d = await diagnostico(page);
  expect(d.tab2).toBe(1);                 // SIEMPRE visible
  expect(d.etapa2Habilitada).toBe('no');
  expect(d.bloqueoTexto).toContain('se habilita al registrar el Acta de Inicio');
  await expect(page.locator(PANEL + ' #etapa1Tab2')).toHaveAttribute('data-etapa1-bloqueada', 'si');
  const deshabilitados = await page.locator(PANEL + ' #etapa1Panel2 [data-etapa1-hito][disabled]').count();
  expect(deshabilitados).toBe(d.hitosEtapa2);
});

test('E1F-7 · con el hito 8 registrado la 2° Etapa queda habilitada', async ({ page }) => {
  await abrirPorNavegacion(page, {
    historial: [EVENTO(ACTA, '2026-09-05T10:00:00Z')], fecha_acta_inicio: '2026-09-05'
  });
  const d = await diagnostico(page);
  expect(d.etapa2Habilitada).toBe('si');
  expect(d.bloqueoTexto).toBe('');
  const deshabilitados = await page.locator(PANEL + ' #etapa1Panel2 [data-etapa1-hito][disabled]').count();
  expect(deshabilitados).toBe(0);
});

/* Falla si la Etapa 2 se habilita sin hito 8 real. El hito 7 es
   «control de terceros SIN acta»: parecido, pero no es el acta. */
test('E1F-8 · la 2° Etapa no se habilita sin hito 8 real', async ({ page }) => {
  await abrirPorNavegacion(page, {
    estado_coi: 'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',
    historial: [EVENTO('control_terceros_sin_acta', '2026-09-02T10:00:00Z')]
  });
  const d = await diagnostico(page);
  expect(d.pipelines).toBe(1);
  expect(d.etapa2Habilitada).toBe('no');
  expect(d.avance).toBe('1 / 8');
});

test('E1F-9 · OC histórica con fecha de acta abre la 2° Etapa sin inventar hitos', async ({ page }) => {
  await abrirPorNavegacion(page, { fecha_acta_inicio: '2025-06-30', estado_coi: 'OBRA/SERVICIO EN EJECUCIÓN' });
  const d = await diagnostico(page);
  expect(d.pipelines).toBe(1);
  expect(d.etapa2Habilitada).toBe('si');
  expect(d.avance).toBe('0 / 8');
});

test('E1F-10 · el estado transversal no cuenta en X/8', async ({ page }) => {
  await abrirPorNavegacion(page, {
    estado_coi: 'OBRA/SERVICIO CANCELADA O SUSPENDIDA',
    historial: [EVENTO('cancelada_suspendida', '2026-09-01T10:00:00Z')]
  });
  const d = await diagnostico(page);
  expect(d.transversal).toBe(1);
  expect(d.avance).toBe('0 / 8');
  expect(d.hitos).toBe(8);
});

/* ------------------------------------------------------------ navegación */

/* Falla si la navegación directa no renderiza el pipeline. */
test('E1F-11 · deep-link /ficha-oc/{OC}/contractual renderiza el pipeline', async ({ page }) => {
  await abrirPorDeepLink(page);
  const d = await diagnostico(page);
  expect(d.panelActivo).toBe(true);
  expect(d.pipelines).toBe(1);
  expect(d.hitos).toBe(8);
  expect(page.url()).toContain('ficha-oc/' + OC + '/contractual');
});

test('E1F-12 · ir y volver entre subpestañas conserva el pipeline', async ({ page }) => {
  await abrirPorNavegacion(page);
  expect((await diagnostico(page)).pipelines).toBe(1);
  await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaResumen'));
  await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaContractual'));
  await page.locator(PIPELINE).waitFor({ state: 'attached', timeout: 15000 });
  const d = await diagnostico(page);
  expect(d.panelActivo).toBe(true);
  expect(d.pipelines).toBe(1);   // uno solo: no se duplica al volver
  expect(d.hitos).toBe(8);
});

test('E1F-13 · el cambio 1° Etapa → 2° Etapa muestra el panel de ejecución', async ({ page }) => {
  await abrirPorNavegacion(page, {
    historial: [EVENTO(ACTA, '2026-09-05T10:00:00Z')], fecha_acta_inicio: '2026-09-05'
  });
  await expect(page.locator(PANEL + ' #etapa1Panel1')).toHaveClass(/active/);
  await page.click(PANEL + ' #etapa1Tab2');
  await expect(page.locator(PANEL + ' #etapa1Panel2')).toHaveClass(/active/);
  await expect(page.locator(PANEL + ' #etapa1Panel1')).not.toHaveClass(/active/);
  await expect(page.locator(PANEL + ' #etapa1Panel2 [data-etapa1-hito]').first()).toBeVisible();
  await page.click(PANEL + ' #etapa1Tab1');
  await expect(page.locator(PANEL + ' #etapa1Panel1')).toHaveClass(/active/);
});

/* ---------------------------------------------------- persistencia y F5 */

test('E1F-14 · confirmar un hito persiste por la RPC canónica y repinta en la Ficha', async ({ page }) => {
  await abrirPorNavegacion(page);
  expect((await diagnostico(page)).avance).toBe('0 / 8');
  await page.click(PANEL + ' [data-etapa1-hito="pliegos_preparacion"]');
  await expect(page.locator('#etapa1ModalConfirmar')).toBeVisible();
  await page.fill('#etapa1ModalObs', 'Pliego enviado a revisión');
  await page.click('#etapa1ModalConfirmarBtn');
  await expect(page.locator('#etapa1ModalConfirmar')).toHaveCount(0);
  await expect(page.locator(PANEL + ' #etapa1Avance')).toHaveText('1 / 8');
  const rpc = await page.evaluate(() => window.__FIX__.rpc.filter(r => r.nombre === 'coi_confirmar_etapa_circuito_v2'));
  expect(rpc).toHaveLength(1);
  expect(rpc[0].args.p_codigo).toBe('pliegos_preparacion');
  expect(rpc[0].args.p_observacion).toBe('Pliego enviado a revisión');
  // El pipeline sigue siendo único después del repintado.
  expect((await diagnostico(page)).pipelines).toBe(1);
});

test('E1F-15 · tras recargar, el deep-link reconstruye el estado desde el historial remoto', async ({ page }) => {
  await abrirPorNavegacion(page, {
    historial: [EVENTO('pliegos_preparacion', '2026-09-01T10:00:00Z'),
      EVENTO('pliegos_terminado_sin_solped', '2026-09-03T10:00:00Z')]
  });
  expect((await diagnostico(page)).avance).toBe('2 / 8');
  await page.goto('/index.html#ficha-oc/' + OC + '/contractual', { waitUntil: 'domcontentloaded' });
  await page.locator(PANEL + '.active').waitFor({ state: 'attached', timeout: 20000 });
  await page.locator(PIPELINE).waitFor({ state: 'attached', timeout: 15000 });
  const d = await diagnostico(page);
  expect(d.pipelines).toBe(1);
  expect(d.avance).toBe('2 / 8');
});

/* ------------------------------------------- casos de verificación pedidos */

const H1 = 'pliegos_preparacion';
const H2 = 'pliegos_terminado_sin_solped';
const H3 = 'solped_sin_expediente';
const H4 = 'pliego_con_oc';
const H5 = 'pliego_con_expediente';
const H6 = 'oc_sin_control_terceros';
const H7 = 'control_terceros_sin_acta';
const ETAPA2 = ['ejecucion', 'finalizada', 'finalizada_actas', 'finalizada_saldo_remanente'];

const clases = page => page.evaluate(() => {
  const panel = document.querySelector('#fichaOCBody #panelFichaContractual');
  const map = {};
  (panel ? panel.querySelectorAll('[data-etapa1-hito]') : []).forEach(b => {
    map[b.getAttribute('data-etapa1-hito')] = b.className + (b.disabled ? ' [disabled]' : '');
  });
  return map;
});

/* CASO 1 — OC histórica con datos de Etapa 1: el pipeline reconstruye el
   historial existente y NO lo reinicia visualmente. */
test('E1F-16 · caso 1 · OC histórica reconstruye su historial de Etapa 1 sin reiniciarlo', async ({ page }) => {
  await abrirPorNavegacion(page, {
    estado_coi: 'PLIEGO CON EXPTE',
    historial: [
      EVENTO(H1, '2025-03-03T10:00:00Z'), EVENTO(H2, '2025-03-20T10:00:00Z'),
      EVENTO(H3, '2025-04-11T10:00:00Z'), EVENTO(H4, '2025-05-02T10:00:00Z'),
      EVENTO(H5, '2025-05-28T10:00:00Z')
    ]
  });
  const d = await diagnostico(page);
  expect(d.pipelines).toBe(1);
  expect(d.avance).toBe('5 / 8');                 // no se reinicia a 0 / 8
  expect(d.estadoActual).not.toBe('Sin iniciar');

  const c = await clases(page);
  [H1, H2, H3, H4].forEach(h => expect(c[h]).toContain('etapa1-completado'));
  expect(c[H5]).toContain('etapa1-actual');
  [H6, H7, ACTA].forEach(h => expect(c[h]).toContain('etapa1-pendiente'));

  // El historial trae fecha y usuario reales, no placeholders.
  await expect(page.locator(PANEL + ' #etapa1UltimaAct')).not.toHaveText('—');
  await expect(page.locator(PANEL + ' #etapa1UltimoUsuario')).toHaveText(EMAIL);
  await expect(page.locator(PANEL + ' [data-etapa1-hito="' + H1 + '"] .etapa1-meta')).toContainText('03/03/2025');

  // Reabrir por deep-link tampoco reinicia el avance acumulado.
  await page.goto('/index.html#ficha-oc/' + OC + '/contractual', { waitUntil: 'domcontentloaded' });
  await page.locator(PIPELINE).waitFor({ state: 'attached', timeout: 20000 });
  expect((await diagnostico(page)).avance).toBe('5 / 8');
});

/* CASO 2 — sin hito 8 real: la 2° Etapa se ve, pero bloqueada. */
test('E1F-17 · caso 2 · sin hito 8 real la 2° Etapa está visible y bloqueada', async ({ page }) => {
  await abrirPorNavegacion(page, {
    estado_coi: 'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',
    fecha_acta_inicio: null,
    historial: [
      EVENTO(H1, '2026-01-05T10:00:00Z'), EVENTO(H2, '2026-01-20T10:00:00Z'),
      EVENTO(H3, '2026-02-02T10:00:00Z'), EVENTO(H4, '2026-02-18T10:00:00Z'),
      EVENTO(H5, '2026-03-01T10:00:00Z'), EVENTO(H6, '2026-03-15T10:00:00Z'),
      EVENTO(H7, '2026-04-02T10:00:00Z')
    ]
  });
  const d = await diagnostico(page);
  expect(d.avance).toBe('7 / 8');
  expect((await clases(page))[ACTA]).toContain('etapa1-pendiente');

  // Visible: el selector existe y se puede abrir el panel.
  await expect(page.locator(PANEL + ' #etapa1Tab2')).toBeVisible();
  await expect(page.locator(PANEL + ' #etapa1Tab2')).toHaveAttribute('data-etapa1-bloqueada', 'si');
  // Bloqueada: motivo a la vista y ningún estado de ejecución accionable.
  expect(d.etapa2Habilitada).toBe('no');
  expect(d.bloqueoTexto).toContain('se habilita al registrar el Acta de Inicio');
  await page.click(PANEL + ' #etapa1Tab2');
  await expect(page.locator(PANEL + ' #etapa1Panel2')).toHaveClass(/active/);
  await expect(page.locator(PANEL + ' #etapa1Etapa2Bloqueada')).toBeVisible();
  const total = await page.locator(PANEL + ' #etapa1Panel2 [data-etapa1-hito]').count();
  const off = await page.locator(PANEL + ' #etapa1Panel2 [data-etapa1-hito][disabled]').count();
  expect(total).toBeGreaterThan(0);
  expect(off).toBe(total);
});

/* CASO 3 — OC que ya está en un estado de la 2° Etapa: abre reflejando ese
   estado y con la 2° Etapa accesible. */
for (const codigo of ETAPA2) {
  test('E1F-18 · caso 3 · estado de 2° Etapa «' + codigo + '» se refleja y habilita la etapa', async ({ page }) => {
    await abrirPorNavegacion(page, {
      estado_coi: 'OBRA/SERVICIO EN EJECUCIÓN',
      fecha_acta_inicio: '2026-02-10',
      historial: [
        EVENTO(H1, '2026-01-05T10:00:00Z'),
        EVENTO(ACTA, '2026-02-10T10:00:00Z'),
        EVENTO(codigo, '2026-06-01T10:00:00Z')
      ]
    });
    const d = await diagnostico(page);
    expect(d.pipelines).toBe(1);
    expect(d.etapa2Habilitada).toBe('si');
    expect(d.bloqueoTexto).toBe('');

    const c = await clases(page);
    expect(c[codigo]).toContain('etapa1-completado');   // refleja el estado real
    expect(c[codigo]).not.toContain('[disabled]');

    await page.click(PANEL + ' #etapa1Tab2');
    await expect(page.locator(PANEL + ' #etapa1Panel2')).toHaveClass(/active/);
    await expect(page.locator(PANEL + ' #etapa1Panel2 [data-etapa1-hito="' + codigo + '"]')).toBeVisible();
    // Accesible: el hito de la 2° Etapa abre su modal por el camino canónico.
    await page.click(PANEL + ' #etapa1Panel2 [data-etapa1-hito="' + codigo + '"]');
    await expect(page.locator('#etapa1ModalConfirmar')).toBeVisible();
    await page.click('#etapa1ModalCancelar');
  });
}

/* CASO 4 — cancelada_suspendida es transversal y no integra el X/8. */
test('E1F-19 · caso 4 · cancelada_suspendida queda transversal y fuera del X/8', async ({ page }) => {
  await abrirPorNavegacion(page, {
    estado_coi: 'OBRA/SERVICIO CANCELADA O SUSPENDIDA',
    historial: [
      EVENTO(H1, '2026-01-05T10:00:00Z'), EVENTO(H2, '2026-01-20T10:00:00Z'),
      EVENTO(H3, '2026-02-02T10:00:00Z'),
      EVENTO('cancelada_suspendida', '2026-03-10T10:00:00Z')
    ]
  });
  const d = await diagnostico(page);
  // Tres hitos secuenciales registrados; la transversal NO suma.
  expect(d.avance).toBe('3 / 8');
  expect(d.hitos).toBe(8);

  const secuencia = await page.evaluate(() => Array.from(
    document.querySelectorAll('#fichaOCBody #panelFichaContractual #etapa1Pipeline [data-etapa1-hito]')
  ).map(b => b.getAttribute('data-etapa1-hito')));
  expect(secuencia).toHaveLength(8);
  expect(secuencia).not.toContain('cancelada_suspendida');

  // Vive en su propio bloque, no en la secuencia ni en la 2° Etapa.
  expect(d.transversal).toBe(1);
  await expect(page.locator(PANEL + ' #etapa1Transversal [data-etapa1-hito="cancelada_suspendida"]')).toHaveCount(1);
  await expect(page.locator(PANEL + ' #etapa1Panel2 [data-etapa1-hito="cancelada_suspendida"]')).toHaveCount(0);
  await expect(page.locator(PANEL + ' #etapa1AvisoTransversal')).toBeVisible();

  // Sigue siendo registrable aunque la 2° Etapa esté bloqueada.
  expect(d.etapa2Habilitada).toBe('no');
  await expect(page.locator(PANEL + ' #etapa1Transversal [data-etapa1-hito]')).not.toBeDisabled();
});
