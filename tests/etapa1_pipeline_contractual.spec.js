const { test, expect } = require('@playwright/test');

/*
  1° ETAPA — pipeline contractual, en navegador.

  Los controles de tests/check_etapa1_pipeline_contractual.js fijan la forma del
  codigo y la semantica SQL. Estos casos fijan lo que el operador ve y lo que
  llega —o no llega— a Supabase.

  Supabase se intercepta con un cliente falso: ninguna prueba toca datos reales
  ni escribe en produccion.
*/

const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL = 'operador@coiroca.test';
const OC = '4530900100';
const ORDEN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTA = 'control_terceros_con_acta';

const EVENTO = (codigo, fecha, motivo) => ({
  id: 'ev-' + codigo, orden_id: ORDEN_ID, nro_oc: OC,
  tipo_evento: 'Circuito administrativo', campo_modificado: codigo,
  fecha_evento: fecha, usuario_email: EMAIL, motivo: motivo || null
});

async function preparar(page, opciones = {}) {
  const cfg = Object.assign({
    historial: [], fecha_acta_inicio: null, estado_coi: 'En ejecución',
    fallaRpc: false, demoraRpc: 0
  }, opciones);

  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());

  await page.addInitScript(({ c, uid, email, oc, ordenId }) => {
    window.__E1__ = { rpc: [], historial: c.historial.slice() };

    const orden = {
      id: ordenId, nro_oc: oc, id_obra: 'OBRA-' + oc, tipo: 'Servicio',
      descripcion: 'Servicio de prueba 1° Etapa', proveedor: 'PROVEEDOR E1',
      estacion: 'PLAZA CONSTITUCION', estado_coi: c.estado_coi,
      estado_documental: c.estado_coi, fecha_acta_inicio: c.fecha_acta_inicio,
      monto_total: 1000, moneda: 'ARS'
    };

    function consulta(tabla) {
      const st = { tabla, filtros: [] };
      const datos = () => {
        if (tabla === 'coi_ordenes') return [orden];
        if (tabla === 'coi_historial_oc') return window.__E1__.historial;
        return [];
      };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; },
        range() { return api; }, in() { return api; }, is() { return api; },
        ilike() { return api; }, gt() { return api; },
        eq(col, val) { st.filtros.push({ col, val }); return api; },
        single: async () => ({ data: datos()[0] || null, error: null }),
        async _run() { return { data: datos().map((x) => Object.assign({}, x)), error: null }; },
        then(res, rej) { return api._run().then(res, rej); }
      };
      return api;
    }

    const fake = {
      from: (t) => consulta(t),
      rpc: async (nombre, args) => {
        window.__E1__.rpc.push({ nombre, args: JSON.parse(JSON.stringify(args || {})) });
        if (nombre === 'coi_current_role') return { data: 'administrador', error: null };
        if (nombre !== 'coi_confirmar_etapa_circuito_v2') return { data: null, error: null };
        if (c.demoraRpc) await new Promise((r) => setTimeout(r, c.demoraRpc));
        if (c.fallaRpc) return { data: null, error: { code: '42501', message: 'fixture E1: escritura rechazada' } };
        const codigo = args.p_codigo;
        const ev = {
          id: 'ev-' + codigo + '-' + Date.now(), orden_id: ordenId, nro_oc: oc,
          tipo_evento: 'Circuito administrativo', campo_modificado: codigo,
          fecha_evento: new Date().toISOString(), usuario_email: email,
          motivo: args.p_observacion || null
        };
        window.__E1__.historial.push(ev);
        return { data: { orden: orden, historial: [ev], codigo: codigo, nombre: codigo, ya_confirmada: false }, error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: uid, email: email } } }, error: null }),
        getUser: async () => ({ data: { user: { id: uid, email: email } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };

    window.__COI_SUPABASE_CLIENT__ = fake;
    window.getSupabaseClient = () => fake;
    window.initSupabase = async () => fake;
    window.getUsuarioActual = async () => ({ id: uid, email: email });
    window.getUsuarioActualR12 = async () => ({ id: uid, email: email });
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
  }, { c: cfg, uid: UID, email: EMAIL, oc: OC, ordenId: ORDEN_ID });
}

async function abrir(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__COI_ETAPA1_RENDER__ === 'function', null, { timeout: 20000 });
  return errores;
}

// Pinta el pipeline sobre un contenedor propio, usando el render canonico de la
// capa: es el mismo HTML que monta la Ficha OC.
async function pintar(page) {
  await page.evaluate(({ oc }) => {
    const orden = (typeof window.resolverOrdenActual === 'function' && window.resolverOrdenActual(oc)) || {
      numeroOC: oc, oc: oc, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nro_oc: oc
    };
    window.__E1_ORDEN__ = orden;
    const host = document.createElement('div');
    host.id = 'e1Host';
    document.body.appendChild(host);
    host.innerHTML = window.__COI_ETAPA1_RENDER__(orden);
  }, { oc: OC });
  await page.waitForTimeout(300);
}

const estado = (page) => page.evaluate(() => ({
  hitos: document.querySelectorAll('#etapa1Pipeline [data-etapa1-hito]').length,
  avance: (document.getElementById('etapa1Avance') || {}).textContent || '',
  estadoActual: (document.getElementById('etapa1EstadoActual') || {}).textContent || '',
  etapa2: (document.getElementById('etapa1Panel2') || {}).dataset
    ? document.getElementById('etapa1Panel2').getAttribute('data-etapa1-habilitada') : '',
  avisoActa: Boolean(document.getElementById('etapa1AvisoActa')),
  transversal: (document.getElementById('etapa1AvisoTransversal') || {}).textContent || '',
  visuales: Array.from(document.querySelectorAll('#etapa1Pipeline [data-etapa1-hito]'))
    .map((b) => ({ codigo: b.getAttribute('data-etapa1-hito'), clase: b.className }))
}));

const rpcConfirmaciones = (page) => page.evaluate(() =>
  window.__E1__.rpc.filter((r) => r.nombre === 'coi_confirmar_etapa_circuito_v2'));

// ------------------------------------------------------------------ F, G, J, K

test('E1-1 · F · la 1° Etapa renderiza exactamente 8 hitos', async ({ page }) => {
  await preparar(page);
  await abrir(page);
  await pintar(page);

  const e = await estado(page);
  expect(e.hitos).toBe(8);
  expect(e.avance).toBe('0 / 8');
  expect(e.estadoActual).toBe('Sin iniciar');
});

test('E1-2 · G · cancelada/suspendida no cuenta en X/8 y se muestra aparte', async ({ page }) => {
  await preparar(page, { historial: [EVENTO('cancelada_suspendida', '2026-09-01T10:00:00.000Z')] });
  await abrir(page);
  await pintar(page);

  const e = await estado(page);
  expect(e.avance).toBe('0 / 8');
  expect(e.hitos).toBe(8);
  // Se renderiza fuera del pipeline secuencial.
  expect(await page.locator('#etapa1Transversal [data-etapa1-hito]').count()).toBe(1);
  expect(await page.locator('#etapa1Pipeline [data-etapa1-hito="cancelada_suspendida"]').count()).toBe(0);
  expect(e.transversal).toContain('antes del inicio');
});

test('E1-3 · K · el último hito 1–7 se muestra EN CURSO', async ({ page }) => {
  await preparar(page, {
    historial: [
      EVENTO('pliegos_preparacion', '2026-09-01T10:00:00.000Z'),
      EVENTO('pliegos_terminado_sin_solped', '2026-09-04T10:00:00.000Z')
    ]
  });
  await abrir(page);
  await pintar(page);

  const e = await estado(page);
  const porCodigo = Object.fromEntries(e.visuales.map((v) => [v.codigo, v.clase]));
  expect(porCodigo.pliegos_preparacion).toContain('etapa1-completado');
  expect(porCodigo.pliegos_terminado_sin_solped).toContain('etapa1-actual');
  expect(e.avance).toBe('2 / 8');
  expect(e.etapa2).toBe('no');
});

test('E1-4 · J · el hito 8 confirmado se muestra COMPLETADO y cierra la 1° Etapa', async ({ page }) => {
  await preparar(page, { historial: [EVENTO(ACTA, '2026-09-05T10:00:00.000Z')], fecha_acta_inicio: '2026-09-05' });
  await abrir(page);
  await pintar(page);

  const e = await estado(page);
  const clase = e.visuales.find((v) => v.codigo === ACTA).clase;
  expect(clase).toContain('etapa1-completado');
  expect(clase).not.toContain('etapa1-actual');
  expect(e.estadoActual).toBe('1° Etapa finalizada');
  expect(e.etapa2).toBe('si');
  expect(e.avisoActa).toBe(false);
});

test('E1-5 · D · hito 8 sin fecha canónica: gate habilitado y conciliación pendiente', async ({ page }) => {
  await preparar(page, { historial: [EVENTO(ACTA, '2026-09-05T10:00:00.000Z')], fecha_acta_inicio: null });
  await abrir(page);
  await pintar(page);

  const e = await estado(page);
  expect(e.etapa2).toBe('si');
  expect(e.avisoActa).toBe(true);
  expect(e.estadoActual).toBe('1° Etapa finalizada');
});

test('E1-6 · OC histórica con fecha de acta mantiene la 2° Etapa habilitada', async ({ page }) => {
  // Sin ningun evento del pipeline: solo el dato canonico legacy.
  await preparar(page, { historial: [], fecha_acta_inicio: '2025-06-30' });
  await abrir(page);
  await pintar(page);

  const e = await estado(page);
  expect(e.etapa2).toBe('si');
  expect(e.avance).toBe('0 / 8');
  expect(await page.locator('#etapa1Etapa2Bloqueada').count()).toBe(0);
});

// ------------------------------------------------------------------ L, M, N, I

test('E1-7 · L · el click abre el modal y cancelar no escribe nada', async ({ page }) => {
  await preparar(page);
  await abrir(page);
  await pintar(page);

  await page.click('[data-etapa1-hito="pliegos_preparacion"]');
  await expect(page.locator('#etapa1ModalConfirmar')).toBeVisible({ timeout: 8000 });
  expect(await page.locator('#etapa1ModalOC').textContent()).toContain(OC);
  expect(await page.locator('#etapa1ModalUsuario').textContent()).toContain(EMAIL);
  // Abrir el modal no puede haber escrito.
  expect(await rpcConfirmaciones(page)).toHaveLength(0);

  await page.click('#etapa1ModalCancelar');
  await expect(page.locator('#etapa1ModalConfirmar')).toHaveCount(0);
  expect(await rpcConfirmaciones(page)).toHaveLength(0);
  expect((await estado(page)).avance).toBe('0 / 8');
});

test('E1-8 · N · saltar un hito avisa y no autocompleta los anteriores', async ({ page }) => {
  await preparar(page);
  await abrir(page);
  await pintar(page);

  await page.click('[data-etapa1-hito="pliego_con_expediente"]');
  await expect(page.locator('#etapa1ModalAvisoSalto')).toBeVisible({ timeout: 8000 });
  await page.click('#etapa1ModalConfirmarBtn');
  await page.waitForTimeout(1500);

  // Se registro uno solo: el que el usuario confirmo.
  const rpc = await rpcConfirmaciones(page);
  expect(rpc).toHaveLength(1);
  expect(rpc[0].args.p_codigo).toBe('pliego_con_expediente');
  const e = await estado(page);
  expect(e.avance).toBe('1 / 8');
  const pendientes = e.visuales.filter((v) => v.clase.indexOf('etapa1-pendiente') >= 0);
  expect(pendientes.length).toBe(7);
});

test('E1-9 · confirmar persiste hito, usuario y observación', async ({ page }) => {
  await preparar(page);
  await abrir(page);
  await pintar(page);

  await page.click('[data-etapa1-hito="pliegos_preparacion"]');
  await page.fill('#etapa1ModalObs', 'Pliego enviado a revisión');
  await page.click('#etapa1ModalConfirmarBtn');
  await page.waitForTimeout(1500);

  const rpc = await rpcConfirmaciones(page);
  expect(rpc).toHaveLength(1);
  expect(rpc[0].args.p_observacion).toBe('Pliego enviado a revisión');
  const historial = await page.evaluate(() => window.__E1__.historial);
  expect(historial[0].usuario_email).toBe(EMAIL);
  expect(historial[0].fecha_evento).toBeTruthy();
});

test('E1-10 · M · el doble click no duplica el registro', async ({ page }) => {
  // La RPC demora: el segundo click cae mientras la primera sigue en vuelo.
  await preparar(page, { demoraRpc: 1200 });
  await abrir(page);
  await pintar(page);

  await page.click('[data-etapa1-hito="pliegos_preparacion"]');
  await page.click('#etapa1ModalConfirmarBtn');
  await page.click('#etapa1ModalConfirmarBtn', { force: true }).catch(() => {});
  await page.waitForTimeout(3000);

  expect(await rpcConfirmaciones(page)).toHaveLength(1);
  expect((await page.evaluate(() => window.__E1__.historial)).length).toBe(1);
});

test('E1-11 · I · si Supabase falla, la interfaz no simula éxito', async ({ page }) => {
  await preparar(page, { fallaRpc: true });
  await abrir(page);
  await pintar(page);

  await page.click('[data-etapa1-hito="pliegos_preparacion"]');
  await page.click('#etapa1ModalConfirmarBtn');
  await page.waitForTimeout(2000);

  // El modal sigue abierto con el error, el hito no se pinto como guardado.
  await expect(page.locator('#etapa1ModalError')).toBeVisible();
  await expect(page.locator('#etapa1ModalConfirmarBtn')).toBeEnabled();
  await page.click('#etapa1ModalCancelar');
  const e = await estado(page);
  expect(e.avance).toBe('0 / 8');
  expect(e.visuales.find((v) => v.codigo === 'pliegos_preparacion').clase)
    .toContain('etapa1-pendiente');
});

// ------------------------------------------------------------------ H, O

test('E1-12 · H · tras recargar, el pipeline se reconstruye desde el historial remoto', async ({ page }) => {
  await preparar(page, {
    historial: [
      EVENTO('pliegos_preparacion', '2026-09-01T10:00:00.000Z', 'Observación previa'),
      EVENTO('pliegos_terminado_sin_solped', '2026-09-03T10:00:00.000Z')
    ]
  });
  await abrir(page);
  await pintar(page);
  expect((await estado(page)).avance).toBe('2 / 8');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__COI_ETAPA1_RENDER__ === 'function', null, { timeout: 20000 });
  await pintar(page);

  const e = await estado(page);
  expect(e.avance).toBe('2 / 8');
  expect(e.visuales.find((v) => v.codigo === 'pliegos_terminado_sin_solped').clase)
    .toContain('etapa1-actual');
  // La observación del historial se muestra como indicador.
  expect(await page.locator('[data-etapa1-hito="pliegos_preparacion"] .etapa1-obs').count()).toBe(1);
});

test('E1-13 · O · la Ficha OC no muestra dos pipelines contractuales', async ({ page }) => {
  await preparar(page, { historial: [EVENTO('pliegos_preparacion', '2026-09-01T10:00:00.000Z')] });
  await abrir(page);

  const salida = await page.evaluate(({ oc }) => {
    const orden = { numeroOC: oc, oc: oc, nro_oc: oc, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    return window.renderChecksDocumentales(orden);
  }, { oc: OC });

  // El punto canónico devuelve el pipeline nuevo, y solo ese.
  expect(salida).toContain('etapa1PipelineContractual');
  expect(salida).not.toContain('circuitoAdministrativoOCR18');
  // La función legacy sigue existiendo para el resto del sistema.
  expect(await page.evaluate(() => typeof window.renderCircuitoAdministrativoOC)).toBe('function');
});

test('E1-14 · E · cancelada/suspendida se puede registrar con la 2° Etapa bloqueada', async ({ page }) => {
  await preparar(page);
  await abrir(page);
  await pintar(page);

  expect((await estado(page)).etapa2).toBe('no');
  // La transversal no queda deshabilitada por el gate.
  const deshabilitada = await page.evaluate(() =>
    document.querySelector('#etapa1Transversal [data-etapa1-hito]').disabled);
  expect(deshabilitada).toBe(false);

  await page.click('#etapa1Transversal [data-etapa1-hito]');
  await expect(page.locator('#etapa1ModalConfirmar')).toBeVisible({ timeout: 8000 });
  await page.click('#etapa1ModalConfirmarBtn');
  await page.waitForTimeout(1500);

  const rpc = await rpcConfirmaciones(page);
  expect(rpc).toHaveLength(1);
  expect(rpc[0].args.p_codigo).toBe('cancelada_suspendida');
  expect((await estado(page)).avance).toBe('0 / 8');
});
