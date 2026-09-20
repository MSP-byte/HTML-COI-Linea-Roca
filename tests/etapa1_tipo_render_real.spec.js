const { test, expect } = require('@playwright/test');

/* VALIDACIÓN CAMBIO 1 — individualización por tipo en el RENDERER REAL.
   `etapa1_ficha_integracion.spec.js` cubre el pipeline, pero su fixture
   sustituye `resolverOrdenActual`, así que nunca ejercita la resolución real
   de la OC. En producción se vio una OC tipo Obra cuya 2° Etapa seguía
   diciendo «OBRA/SERVICIO EN EJECUCIÓN»: el objeto que llega a bloqueEtapa2
   no es necesariamente el que el fixture inyecta.

   Acá sólo se siembra la FUENTE DE DATOS (obtenerOC / buscarPorIdObra /
   todasLasOC) y se deja que la aplicación resuelva la OC por su camino
   canónico, como hace la Ficha real.

   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

test.describe.configure({ timeout: 60_000 });

const OC = '4530660001';
const ID_OBRA = 'OBRA-' + OC;
const ORDEN_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
const PANEL = '#fichaOCBody #panelFichaContractual';

/* `donde` decide desde qué lado llega el tipo, porque en producción el objeto
   que alcanza al pipeline no siempre es el que trae el catálogo:
     item  → tipo en el item (caso feliz)
     raw   → sólo en _supabaseRaw
     fila  → sólo en la fila del catálogo, con el item ya normalizado sin tipo */
async function abrirFicha(page, { tipo, donde = 'item' }) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.addInitScript(({ oc, idObra, ordenId, tipo, donde }) => {
    const item = {
      id: ordenId, nro_oc: oc, numeroOC: oc, oc,
      idObra, idOC: idObra, id_obra: idObra,
      tipo, proveedor: 'PROVEEDOR TIPO', estacion: 'Plaza Constitución',
      descripcion: tipo + ' de prueba', tipoTrabajo: tipo + ' de prueba',
      estado_coi: 'OBRA/SERVICIO EN EJECUCIÓN', estadoCOI: 'OBRA/SERVICIO EN EJECUCIÓN',
      estado_documental: 'OBRA/SERVICIO EN EJECUCIÓN', estadoDocumental: 'OBRA/SERVICIO EN EJECUCIÓN',
      fecha_acta_inicio: '2026-02-10', fechaActaInicio: '2026-02-10', actaInicio: '2026-02-10',
      plazoDias: 90, monto_total: 1000, moneda: 'ARS'
    };
    item._supabaseRaw = Object.assign({}, item);
    // Se recorta el tipo según el caso bajo prueba.
    if (donde === 'raw') { delete item.tipo; }
    if (donde === 'fila') { delete item.tipo; delete item._supabaseRaw.tipo; }
    const found = { estacion: { nombre: 'Plaza Constitución' }, item };
    const historial = [{
      id: 'ev-acta', orden_id: ordenId, nro_oc: oc,
      tipo_evento: 'Circuito administrativo', campo_modificado: 'control_terceros_con_acta',
      fecha_evento: '2026-02-10T10:00:00Z', usuario_email: 'admin@coiroca.com', motivo: null
    }];
    const api = (tabla) => {
      const datos = () => tabla === 'coi_ordenes' ? [item] : tabla === 'coi_historial_oc' ? historial : [];
      const q = {
        select: () => q, order: () => q, limit: () => q, range: () => q, in: () => q,
        is: () => q, ilike: () => q, gt: () => q, eq: () => q,
        single: async () => ({ data: datos()[0] || null, error: null }),
        then(res, rej) { return Promise.resolve({ data: datos().map(x => Object.assign({}, x)), error: null }).then(res, rej); }
      };
      return q;
    };
    const fake = {
      from: api,
      rpc: async (n) => n === 'coi_current_role' ? { data: 'administrador', error: null } : { data: null, error: null },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: ordenId, email: 'admin@coiroca.com' } } }, error: null }),
        getUser: async () => ({ data: { user: { id: ordenId, email: 'admin@coiroca.com' } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };
    const coincide = (r) => {
      const v = String(r == null ? '' : r).trim().toUpperCase();
      return v === oc || v === idObra.toUpperCase() || v === String(ordenId).toUpperCase();
    };
    /* SÓLO la fuente de datos. `resolverOrdenActual` es el camino real y no se
       sustituye: es justamente lo que se quiere ejercitar. */
    const instalar = () => {
      window.__COI_SUPABASE_CLIENT__ = fake;
      window.getSupabaseClient = () => fake;
      window.initSupabase = async () => fake;
      window.getUsuarioActual = async () => ({ id: ordenId, email: 'admin@coiroca.com' });
      window.getUsuarioActualR12 = async () => ({ id: ordenId, email: 'admin@coiroca.com' });
      window.esAutorizacionAdministrativaSupabaseV60 = () => true;
      window.usuarioTienePermisoEdicion = () => true;
      window.obtenerOC = (r) => coincide(r) ? found : null;
      window.buscarPorIdObra = (r) => coincide(r) ? found : null;
      window.todasLasOC = () => [{ estacion: 'Plaza Constitución', item, idObra, numeroOC: oc, tipo, proveedor: item.proveedor }];
      window.__COI_CIRCUITO_CACHE_GET__ = () => historial;
      window.cargarHistorialCircuitoOC = async () => historial;
      window.guardarBaseLocal = () => {};
      if (document.body) document.body.classList.add('modo-admin');
    };
    instalar();
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  }, { oc: OC, idObra: ID_OBRA, ordenId: ORDEN_ID, tipo, donde });

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderFichaOC === 'function' && typeof window.__COI_ETAPA1_RENDER__ === 'function', null, { timeout: 25000 });
  await page.evaluate(id => window.abrirFichaOC(id), ID_OBRA);
  await page.locator(PANEL).waitFor({ state: 'attached', timeout: 20000 });
  await page.evaluate(() => window.activarSubmoduloFichaOC('panelFichaContractual'));
  await page.locator(PANEL + ' #etapa1PipelineContractual').waitFor({ state: 'attached', timeout: 20000 });
}

const nombresEtapa2 = page => page.locator(PANEL + ' #etapa1Panel2 [data-etapa1-hito] .etapa1-nombre').allInnerTexts();

test('TR-1 · una OC tipo Obra individualiza la 2° Etapa en el renderer real', async ({ page }) => {
  await abrirFicha(page, { tipo: 'Obra' });
  const nombres = await nombresEtapa2(page);
  expect(nombres.join(' | ')).not.toContain('OBRA/SERVICIO');
  expect(nombres).toContain('OBRA EN EJECUCIÓN');
  expect(nombres).toEqual(['OBRA EN EJECUCIÓN', 'OBRA FINALIZADA', 'OBRA FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA']);
});

test('TR-2 · una OC tipo Obra no ofrece saldo remanente en el renderer real', async ({ page }) => {
  await abrirFicha(page, { tipo: 'Obra' });
  await expect(page.locator(PANEL + ' [data-etapa1-hito="finalizada_saldo_remanente"]')).toHaveCount(0);
  const texto = (await page.locator(PANEL + ' #etapa1Panel2').innerText()).toUpperCase();
  expect(texto).not.toContain('SALDO REMANENTE');
});

test('TR-3 · una OC tipo Servicio individualiza la 2° Etapa en el renderer real', async ({ page }) => {
  await abrirFicha(page, { tipo: 'Servicio' });
  const nombres = await nombresEtapa2(page);
  expect(nombres.join(' | ')).not.toContain('OBRA/SERVICIO');
  expect(nombres).toContain('SERVICIO EN EJECUCIÓN');
  expect(nombres).toContain('SERVICIO FINALIZADO PERO CON SALDO REMANENTE');
});

test('TR-4 · el estado transversal también se individualiza por tipo', async ({ page }) => {
  await abrirFicha(page, { tipo: 'Obra' });
  const transversal = await page.locator(PANEL + ' #etapa1Transversal .etapa1-nombre').innerText();
  expect(transversal).not.toContain('OBRA/SERVICIO');
  expect(transversal).toBe('OBRA CANCELADA O SUSPENDIDA');
});

test('TR-5 · el tipo sólo en _supabaseRaw también individualiza', async ({ page }) => {
  await abrirFicha(page, { tipo: 'Obra', donde: 'raw' });
  const nombres = await nombresEtapa2(page);
  expect(nombres.join(' | ')).not.toContain('OBRA/SERVICIO');
  expect(nombres).toContain('OBRA EN EJECUCIÓN');
});

test('TR-6 · el tipo sólo en la fila del catálogo también individualiza', async ({ page }) => {
  await abrirFicha(page, { tipo: 'Obra', donde: 'fila' });
  const nombres = await nombresEtapa2(page);
  expect(nombres.join(' | ')).not.toContain('OBRA/SERVICIO');
  expect(nombres).toContain('OBRA EN EJECUCIÓN');
});
