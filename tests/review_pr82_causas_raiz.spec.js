const { test, expect } = require('@playwright/test');

/* Regresiones de las 5 causas raíz del triage del snapshot de PR #82.
   Una prueba por causa, no una por thread.

     CR-01  back-off tras error del historial
     CR-02  estados cerrados/archivados no proyectan
     CR-03  una lectura fallida no deja índices derivados vivos
     CR-04  la certificación se encuentra por N° de OC o por UUID
     CR-05  ningún camino legacy repone una fecha que el canónico suprimió

   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

test.describe.configure({ timeout: 60_000 });

const OC = '4530990001';
const ORDEN_ID = 'aaaa9999-9999-4999-8999-999999999999';

const CERT = (o) => Object.assign({
  id: 'c-' + Math.random().toString(36).slice(2), orden_id: ORDEN_ID, nro_oc: OC,
  acta_medicion_nro: 'AM-CR', fecha_inicio: '2026-06-01', fecha_fin: '2026-06-30',
  posicion: 'POS-1', item_nro: '1', nro_hes: '', nro_if: '',
  proveedor: 'CONTRATISTA CR', aux_porcentaje: 30, anio: 2026,
  fecha_actualizacion: '2026-07-01T10:00:00Z'
}, o);

function fixture(page, opciones = {}) {
  const c = Object.assign({
    tipo: 'Obra', estadoCOI: 'OBRA/SERVICIO EN EJECUCIÓN', estadoRegistro: 'Activo',
    certificaciones: [], fallarLectura: false, aliasLegacy: null
  }, opciones);

  return page.addInitScript((c) => {
    const OC = '4530990001', ORDEN_ID = 'aaaa9999-9999-4999-8999-999999999999';
    const item = {
      id: ORDEN_ID, nro_oc: OC, numeroOC: OC, oc: OC,
      idObra: 'OBRA-' + OC, idOC: 'OBRA-' + OC,
      tipo: c.tipo, proveedor: 'CONTRATISTA CR', estacion: 'Plaza Constitución',
      descripcion: 'Trabajo CR', tipoTrabajo: 'Trabajo CR',
      estadoCOI: c.estadoCOI, estado: c.estadoCOI, estadoDocumental: 'PLIEGO CON EXPTE',
      estadoRegistro: c.estadoRegistro,
      fechaActaInicio: '2026-01-31', actaInicio: '2026-01-31',
      plazoDias: 90, fechaVencimiento: '2027-12-31', vencimiento: '2027-12-31'
    };
    // Alias legacy derivado, tal como lo deja todasLasOC() en producción.
    if (c.aliasLegacy) item.proximaCertificacion = c.aliasLegacy;
    item._supabaseRaw = {
      id: ORDEN_ID, nro_oc: OC, tipo: c.tipo, proveedor: item.proveedor,
      fecha_acta_inicio: '2026-01-31', plazo_dias: 90, fecha_vencimiento: '2027-12-31',
      estado_coi: c.estadoCOI, estado_documental: 'PLIEGO CON EXPTE',
      estado_registro: c.estadoRegistro
    };

    const estado = { lecturas: 0, fallar: c.fallarLectura, sesion: { user: { id: 'u-cr', email: 'a@coiroca.com' } }, cbs: [] };
    estado.notificar = (ev, s) => estado.cbs.forEach(fn => { try { fn(ev, s); } catch (e) {} });
    window.__CR__ = estado;

    const consulta = (tabla) => {
      const api = {
        select: () => api, order: () => api, limit: () => api, eq: () => api, in: () => api,
        is: () => api, ilike: () => api, gt: () => api, range: () => api,
        single: async () => ({ data: null, error: null }),
        then(res, rej) {
          if (tabla === 'coi_certificaciones') {
            estado.lecturas += 1;
            if (estado.fallar) {
              return Promise.resolve({ data: null, error: { code: '42501', message: 'RLS denegado' } }).then(res, rej);
            }
            return Promise.resolve({ data: c.certificaciones.slice(), error: null }).then(res, rej);
          }
          return Promise.resolve({ data: [], error: null }).then(res, rej);
        }
      };
      return api;
    };
    const fake = {
      from: consulta, rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: estado.sesion }, error: null }),
        getUser: async () => ({ data: { user: estado.sesion ? estado.sesion.user : null }, error: null }),
        onAuthStateChange: (cb) => { estado.cbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; }
      }
    };
    const nuevo = () => JSON.parse(JSON.stringify(item));
    const instalar = () => {
      window.__COI_SUPABASE_CLIENT__ = fake;
      window.getSupabaseClient = () => fake;
      window.initSupabase = async () => fake;
      window.getUsuarioActual = async () => estado.sesion && estado.sesion.user;
      window.esAutorizacionAdministrativaSupabaseV60 = () => true;
      window.todasLasOC = () => [{
        estacion: 'Plaza Constitución', item: nuevo(),
        idObra: 'OBRA-' + OC, numeroOC: OC, tipo: c.tipo, proveedor: item.proveedor,
        proximaCertificacion: c.aliasLegacy || ''
      }];
      window.obtenerOC = () => ({ estacion: { nombre: 'Plaza Constitución' }, item: nuevo() });
      window.guardarBaseLocal = () => {};
      window.__COI_H06_ORDENES__ = {
        confirmadas: () => 1, uidConfirmado: () => 'u-cr',
        estadoLectura: () => 'listo', lecturaActualConfirmada: () => true,
        generacionCatalogo: () => 1
      };
    };
    instalar();
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  }, c);
}

async function abrir(page, opciones) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await fixture(page, opciones);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__COI_PROXIMA_CERT__ === 'function'
    && Boolean(window.__COI_CERT_HISTORIAL__), null, { timeout: 25000 });
}

const proyectar = page => page.evaluate(() => {
  const fila = window.todasLasOC()[0];
  return window.__COI_PROXIMA_CERT__(fila.item, fila);
});
const cargado = page => page.waitForFunction(
  () => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });

/* ---------------------------------------------------------------- CR-01 */

test('CR01-1 · tras un error, los reintentos automáticos no martillan el endpoint', async ({ page }) => {
  await abrir(page, { fallarLectura: true, certificaciones: [CERT({})] });
  await page.evaluate(() => window.__COI_CERT_HISTORIAL__.cargar(true));
  await page.waitForFunction(() => Boolean(window.__COI_CERT_HISTORIAL__.estado().error), null, { timeout: 20000 });
  await page.waitForFunction(() => !window.__COI_CERT_HISTORIAL__.estado().cargando, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  // Se cuentan los intentos DEL MÓDULO: otros módulos consultan
  // coi_certificaciones por su cuenta y no son parte de este contrato.
  const tras = await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().intentos);

  // Muchos renders que proyectan, como hace el shell V2 una vez por segundo.
  await page.evaluate(async () => {
    const fila = window.todasLasOC()[0];
    for (let i = 0; i < 40; i++) window.__COI_PROXIMA_CERT__(fila.item, fila);
    await new Promise(r => setTimeout(r, 300));
  });
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().intentos)).toBe(tras);
});

test('CR01-2 · un pedido explícito sí vuelve a leer aunque haya error', async ({ page }) => {
  await abrir(page, { fallarLectura: true });
  await page.evaluate(() => window.__COI_CERT_HISTORIAL__.cargar(true));
  await page.waitForFunction(() => Boolean(window.__COI_CERT_HISTORIAL__.estado().error), null, { timeout: 20000 });
  const antes = await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().intentos);
  // El back-off frena los automáticos, no al operador.
  await page.evaluate(() => window.__COI_CERT_HISTORIAL__.cargar(true));
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().intentos)).toBeGreaterThan(antes);
});

/* ---------------------------------------------------------------- CR-02 */

test('CR02-1 · una OC cerrada o archivada no proyecta', async ({ page }) => {
  for (const estado of ['Cerrada', 'OBRA/SERVICIO CERRADA', 'Archivada']) {
    const contexto = await page.context().browser().newContext();
    const hoja = await contexto.newPage();
    await abrir(hoja, { estadoCOI: estado, certificaciones: [CERT({})] });
    await cargado(hoja);
    expect(await proyectar(hoja)).toBe('');
    await contexto.close();
  }
});

test('CR02-2 · el estado_registro archivado también suprime la proyección', async ({ page }) => {
  await abrir(page, { estadoRegistro: 'Archivada', certificaciones: [CERT({})] });
  await cargado(page);
  expect(await proyectar(page)).toBe('');
});

test('CR02-3 · una OC en ejecución sigue proyectando', async ({ page }) => {
  await abrir(page, { certificaciones: [CERT({ fecha_fin: '2026-06-30' })] });
  await cargado(page);
  // Control: la regla nueva no puede apagar el caso normal.
  expect(await proyectar(page)).toBe('2026-07-30');
});

/* ---------------------------------------------------------------- CR-03 */

test('CR03-1 · una lectura fallida no deja viva la certificación del snapshot anterior', async ({ page }) => {
  await abrir(page, { certificaciones: [CERT({ acta_medicion_nro: 'AM-VIEJA' })] });
  await cargado(page);
  expect(await page.evaluate(() => window.__COI_CERT_ULTIMA_DETALLE__('4530990001'))).not.toBeNull();

  // Ahora la relectura falla: el snapshot deja de ser autoritativo.
  await page.evaluate(() => { window.__CR__.fallar = true; return window.__COI_CERT_HISTORIAL__.cargar(true); });
  await page.waitForFunction(() => Boolean(window.__COI_CERT_HISTORIAL__.estado().error), null, { timeout: 20000 });

  const tras = await page.evaluate(() => ({
    detalle: window.__COI_CERT_ULTIMA_DETALLE__('4530990001'),
    ultima: window.__COI_CERT_ULTIMA__('4530990001'),
    filas: window.__COI_CERT_HISTORIAL__.filas().length
  }));
  expect(tras.detalle).toBeFalsy();
  expect(tras.ultima).toBe('');
  expect(tras.filas).toBe(0);
});

/* ---------------------------------------------------------------- CR-04 */

test('CR04-1 · se encuentra la certificación aunque su nro_oc esté desactualizado', async ({ page }) => {
  // La fila trae un nro_oc viejo, pero su orden_id coincide con la OC.
  await abrir(page, { certificaciones: [CERT({ nro_oc: '4530000000-VIEJO', fecha_fin: '2026-06-30' })] });
  await cargado(page);
  // Sin indexar por UUID, esto proyectaría desde el Acta (2026-02-28).
  expect(await proyectar(page)).toBe('2026-07-30');
  expect(await page.evaluate(() => window.__COI_CERT_ULTIMA__('aaaa9999-9999-4999-8999-999999999999')))
    .toBe('2026-06-30');
});

test('CR04-2 · la búsqueda por N° de OC sigue funcionando', async ({ page }) => {
  await abrir(page, { certificaciones: [CERT({ fecha_fin: '2026-06-30' })] });
  await cargado(page);
  expect(await page.evaluate(() => window.__COI_CERT_ULTIMA__('4530990001'))).toBe('2026-06-30');
});

/* ---------------------------------------------------------------- CR-05 */

test('CR05-1 · las alertas no reponen una fecha que el canónico suprimió', async ({ page }) => {
  const futuro = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await abrir(page, { tipo: 'Servicio', aliasLegacy: futuro, certificaciones: [CERT({})] });
  await cargado(page);
  const r = await page.evaluate((futuro) => {
    // Servicio sin modalidad: el canónico decide que NO hay próxima certificación.
    const fila = window.todasLasOC()[0];
    const canonico = window.__COI_PROXIMA_CERT__(fila.item, fila);
    const alertas = typeof window.generarAlertasCOI === 'function' ? window.generarAlertasCOI() : [];
    /* Lo que no puede existir es una alerta que AFIRME una certificación
       próxima con la fecha legacy. Una alerta documental que avisa que NO hay
       próxima certificación calculada es correcta y tiene que seguir saliendo. */
    const afirmanFecha = alertas.filter(a => String(a.fechaRelacionada || '').includes(futuro));
    const proximaCert = alertas.filter(a => /certificaci/i.test(String(a.tipoAlerta || ''))
      && !/sin\s+pr[oó]xima/i.test(String(a.tipoAlerta || '')));
    return { canonico, afirmanFecha: afirmanFecha.length, proximaCert: proximaCert.length };
  }, futuro);
  expect(r.canonico).toBe('');
  // Ninguna alerta resucita la fecha legacy que el canónico suprimió.
  expect(r.afirmanFecha).toBe(0);
  expect(r.proximaCert).toBe(0);
});

test('CR05-2 · el detalle del día no duplica la certificación ni repone las suprimidas', async ({ page }) => {
  await abrir(page, { certificaciones: [CERT({ fecha_fin: '2026-06-30' })] });
  await cargado(page);
  const r = await page.evaluate(() => {
    const api = window.COI_CALENDARIO_V2_FIX;
    if (!api || typeof api.eventsForDay !== 'function') return { omitido: true };
    // Un día con una certificación tentativa ya pintada por el canónico.
    const day = document.createElement('div');
    day.setAttribute('data-fecha', '2026-07-30');
    day.innerHTML = '<button class="op-event" data-coi-evento="cert-x">'
      + '<b>Certificación obra (tentativa)</b><br>4530990001 · CONTRATISTA CR</button>';
    const base = window.generarEventosCalendarioCOI;
    // El generador legacy devuelve la MISMA certificación, sin el sufijo.
    window.generarEventosCalendarioCOI = () => ([{
      tipoEvento: 'Certificación obra', fecha: '2026-07-30',
      oc: '4530990001', ocId: 'OBRA-4530990001', proveedor: 'CONTRATISTA CR'
    }]);
    const eventos = api.eventsForDay(day, '2026-07-30');
    window.generarEventosCalendarioCOI = base;
    const certs = eventos.filter(e => String(e.tipoEvento || '').toLowerCase().includes('certificaci'));
    return { total: certs.length, rotulos: certs.map(e => e.tipoEvento) };
  });
  if (r.omitido) test.skip(true, 'COI_CALENDARIO_V2_FIX no disponible');
  // Una sola certificación, y la que conserva la marca de tentativa.
  expect(r.total).toBe(1);
  expect(r.rotulos[0]).toContain('tentativa');
});
