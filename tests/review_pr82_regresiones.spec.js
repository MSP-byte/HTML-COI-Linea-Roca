const { test, expect } = require('@playwright/test');

/* Regresiones de los findings del review de PR #82.
   Cada caso cae con el código previo al arreglo correspondiente.

   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

test.describe.configure({ timeout: 60_000 });

const OC = '4530990001';
const ID_OBRA = 'OBRA-' + OC;
const ORDEN_ID = 'aaaa9999-9999-4999-8999-999999999999';
const UID_A = '11119999-9999-4999-8999-999999999991';
const UID_B = '22229999-9999-4999-8999-999999999992';

function fixture(page, opciones = {}) {
  const c = Object.assign({
    tipo: 'Obra',
    modalidad: null,
    proximaPersistida: null,      // coi_ordenes.proxima_certificacion real
    proximaAlias: null,           // alias derivado por todasLasOC(), NO persistido
    vencimiento: '2026-12-31',
    certificaciones: [],
    uid: UID_A,
    demoraLectura: 0
  }, opciones);

  return page.addInitScript((c) => {
    const OC = '4530990001', ID_OBRA = 'OBRA-' + OC, ORDEN_ID = 'aaaa9999-9999-4999-8999-999999999999';
    const item = {
      id: ORDEN_ID, nro_oc: OC, numeroOC: OC, oc: OC,
      idObra: ID_OBRA, idOC: ID_OBRA,
      tipo: c.tipo, proveedor: 'CONTRATISTA REVIEW', estacion: 'Plaza Constitución',
      descripcion: 'Trabajo de review', tipoTrabajo: 'Trabajo de review',
      estadoCOI: 'OBRA/SERVICIO EN EJECUCIÓN', estado: 'OBRA/SERVICIO EN EJECUCIÓN',
      estadoDocumental: 'PLIEGO CON EXPTE',
      fechaActaInicio: '2026-01-31', actaInicio: '2026-01-31',
      plazoDias: 90, fechaVencimiento: c.vencimiento, vencimiento: c.vencimiento
    };
    // _supabaseRaw es lo que Supabase devolvió de verdad.
    item._supabaseRaw = {
      id: ORDEN_ID, nro_oc: OC, tipo: c.tipo, proveedor: item.proveedor,
      fecha_acta_inicio: '2026-01-31', plazo_dias: 90, fecha_vencimiento: c.vencimiento,
      estado_coi: item.estadoCOI, estado_documental: item.estadoDocumental
    };
    if (c.modalidad) item._supabaseRaw.modalidad_certificacion = c.modalidad;
    if (c.proximaPersistida) item._supabaseRaw.proxima_certificacion = c.proximaPersistida;
    // El alias derivado vive SÓLO en el item/fila, no en la columna.
    if (c.proximaAlias) item.proximaCertificacion = c.proximaAlias;

    const estado = { uid: c.uid, lecturas: 0, sesion: { user: { id: c.uid, email: 'a@coiroca.com' } }, cbs: [] };
    estado.notificar = (ev, ses) => estado.cbs.forEach(fn => { try { fn(ev, ses); } catch (e) {} });
    window.__RV__ = estado;

    const consulta = (tabla) => {
      const api = {
        select: () => api, order: () => api, limit: () => api, eq: () => api, in: () => api,
        is: () => api, ilike: () => api, gt: () => api, range: () => api,
        single: async () => ({ data: null, error: null }),
        then(res, rej) {
          if (tabla === 'coi_certificaciones') {
            estado.lecturas += 1;
            const uidPedido = estado.uid;
            const espera = c.demoraLectura
              ? new Promise(r => setTimeout(r, c.demoraLectura))
              : Promise.resolve();
            return espera.then(() => ({
              /* Modela RLS: sin sesión no se devuelve nada, y sólo el UID
                 original ve sus filas. */
              data: (estado.sesion && uidPedido === UID_A) ? c.certificaciones.slice() : [],
              error: null
            })).then(res, rej);
          }
          return Promise.resolve({ data: [], error: null }).then(res, rej);
        }
      };
      return api;
    };
    const UID_A = '11119999-9999-4999-8999-999999999991';
    const fake = {
      from: consulta,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: estado.sesion }, error: null }),
        getUser: async () => ({ data: { user: estado.sesion ? estado.sesion.user : null }, error: null }),
        onAuthStateChange: (cb) => { estado.cbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; }
      }
    };
    const instalar = () => {
      window.__COI_SUPABASE_CLIENT__ = fake;
      window.getSupabaseClient = () => fake;
      window.initSupabase = async () => fake;
      window.getUsuarioActual = async () => (estado.sesion ? estado.sesion.user : null);
      window.esAutorizacionAdministrativaSupabaseV60 = () => true;
      window.usuarioTienePermisoEdicion = () => true;
      /* Los normalizadores de arranque MUTAN los items que reciben: si el
         fixture entregara siempre el mismo objeto, terminaría sin tipo, sin
         plazo y sin _supabaseRaw. El catálogo real se reconstruye en cada
         lectura, así que acá también se entrega una copia fresca. */
      const nuevoItem = () => JSON.parse(JSON.stringify(item));
      window.todasLasOC = () => [{
        estacion: 'Plaza Constitución', item: nuevoItem(),
        idObra: ID_OBRA, numeroOC: OC, tipo: c.tipo, proveedor: item.proveedor,
        proximaCertificacion: c.proximaAlias || ''
      }];
      window.obtenerOC = () => ({ estacion: { nombre: 'Plaza Constitución' }, item: nuevoItem() });
      window.guardarBaseLocal = () => {};
      window.__COI_H06_ORDENES__ = {
        confirmadas: () => 1, uidConfirmado: () => estado.uid,
        estadoLectura: () => 'listo', lecturaActualConfirmada: () => true
      };
    };
    instalar();
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  }, c);
}

const CERT = (o) => Object.assign({
  id: 'c-' + Math.random().toString(36).slice(2), orden_id: ORDEN_ID, nro_oc: OC,
  acta_medicion_nro: 'AM-REV', fecha_inicio: '2026-06-01', fecha_fin: '2026-06-30',
  posicion: 'POS-1', item_nro: '1', nro_hes: '', nro_if: '',
  proveedor: 'CONTRATISTA REVIEW', aux_porcentaje: 30, anio: 2026,
  fecha_actualizacion: '2026-07-01T10:00:00Z'
}, o);

async function abrirCalendario(page, opciones) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await fixture(page, opciones);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderCalendarioCOIUnificado === 'function'
    && Boolean(window.__COI_CERT_HISTORIAL__), null, { timeout: 25000 });
  await page.evaluate(() => {
    window.mostrarVista && window.mostrarVista('vistaCalendarioCOI');
    window.renderCalendarioCOIUnificado();
  });
  await page.locator('#vistaCalendarioCOI.active').waitFor({ state: 'attached', timeout: 25000 });
}

const proyeccion = page => page.evaluate(() => {
  const fila = window.todasLasOC()[0];
  return window.__COI_PROXIMA_CERT__(fila.item, fila);
});

/* ---------------------------------- FINDING · cargar certificaciones antes */

test('RV-1 · entrar al Calendario carga el historial real sin pasar por Tabla Certificaciones', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})] });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  expect(await page.evaluate(() => window.__RV__.lecturas)).toBeGreaterThan(0);
  // Nunca se activó la subpestaña Certificaciones.
  expect(await page.locator('#coiTabCertificaciones.active').count()).toBe(0);
});

test('RV-2 · la proyección usa la última certificación real, no el Acta de Inicio', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({ fecha_fin: '2026-06-30' })] });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  // Acta 31/01 daría 28/02; la certificación real de junio manda.
  expect(await proyeccion(page)).toBe('2026-07-30');
});

test('RV-3 · cuando la lectura remota termina tarde, el Calendario se repinta una sola vez', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({ fecha_fin: '2026-06-30' })], demoraLectura: 400 });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  expect(await proyeccion(page)).toBe('2026-07-30');
  /* Sin bucle render → query → render. Se cuentan las lecturas DEL MÓDULO:
     otros módulos consultan coi_certificaciones por su cuenta y no son
     parte de este contrato. */
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargas)).toBe(1);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargas)).toBe(1);
});

/* ------------------------------------ FINDING · fecha manual vs calculada */

test('RV-4 · un alias calculado no cuenta como carga manual (A_DEMANDA no proyecta)', async ({ page }) => {
  await abrirCalendario(page, { tipo: 'Servicio', modalidad: 'A_DEMANDA', proximaAlias: '2026-02-28' });
  expect(await proyeccion(page)).toBe('');
});

test('RV-5 · un alias calculado tampoco activa a un servicio SIN_DEFINIR', async ({ page }) => {
  await abrirCalendario(page, { tipo: 'Servicio', modalidad: 'SIN_DEFINIR', proximaAlias: '2026-02-28' });
  expect(await proyeccion(page)).toBe('');
});

test('RV-6 · una Obra aplica la regla nueva aunque exista un alias derivado', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({ fecha_fin: '2026-06-30' })], proximaAlias: '2026-02-28' });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  expect(await proyeccion(page)).toBe('2026-07-30');   // no se queda con el alias
});

test('RV-7 · la fecha realmente persistida en coi_ordenes sí conserva el override', async ({ page }) => {
  await abrirCalendario(page, { tipo: 'Servicio', modalidad: 'A_DEMANDA', proximaPersistida: '2026-08-10' });
  expect(await proyeccion(page)).toBe('2026-08-10');
});

/* -------------------------------------------- FINDING · tipo de OC real */

test('RV-8 · una OC Financiera u Otro no proyecta certificación', async ({ page }) => {
  for (const tipo of ['Financiera', 'Otro']) {
    const contexto = await page.context().browser().newContext();
    const hoja = await contexto.newPage();
    await abrirCalendario(hoja, { tipo });
    expect(await proyeccion(hoja)).toBe('');
    await contexto.close();
  }
});

/* ------------------------------------- FINDING · tarjeta resumen real */

test('RV-9 · la tarjeta muestra la última certificación del historial autoritativo', async ({ page }) => {
  // El calendario filtra por el mes en curso: el vencimiento se ubica ahí para
  // que exista un evento clickeable.
  const hoy = new Date();
  const enMes = (d) => `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  await abrirCalendario(page, {
    vencimiento: enMes(20),
    certificaciones: [CERT({ acta_medicion_nro: 'AM-778', fecha_fin: '2026-06-30' })]
  });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  await page.click('#btnCalendarioVistaCOI1');
  const evento = page.locator('#calendarioInteligenteCOI [data-coi-evento]').first();
  await expect(evento).toBeVisible();
  await evento.scrollIntoViewIfNeeded();
  await evento.click();
  await expect(page.locator('#coiResumenEvento')).toBeVisible();
  const texto = await page.locator('#coiResumenEvento').innerText();
  expect(texto).toContain('AM-778');
  expect(texto).not.toMatch(/ÚLTIMA CERTIFICACIÓN\s*\n\s*—/i);
});

/* --------------------------------------- FINDING · aislamiento por UID */

test('RV-10 · cerrar sesión borra el historial en memoria', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})] });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.filas().length)).toBe(1);

  await page.evaluate(() => {
    window.__RV__.sesion = null;
    window.__RV__.notificar('SIGNED_OUT', null);
  });
  const tras = await page.evaluate(() => ({
    filas: window.__COI_CERT_HISTORIAL__.filas().length,
    estado: window.__COI_CERT_HISTORIAL__.estado()
  }));
  expect(tras.filas).toBe(0);
  expect(tras.estado.cargado).toBe(false);
  expect(tras.estado.error).toBe('');
});

test('RV-11 · un cambio real de identidad no reutiliza el historial anterior', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})] });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });

  await page.evaluate((uidB) => {
    window.__RV__.uid = uidB;
    window.__RV__.sesion = { user: { id: uidB, email: 'b@coiroca.com' } };
    window.__RV__.notificar('SIGNED_IN', window.__RV__.sesion);
  }, UID_B);
  await page.evaluate(() => window.__COI_CERT_HISTORIAL__.cargar(false));
  await page.waitForFunction(() => !window.__COI_CERT_HISTORIAL__.estado().cargando, null, { timeout: 20000 });
  // El fixture sólo entrega filas al UID original: el nuevo usuario no ve nada.
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.filas().length)).toBe(0);
});

test('RV-12 · una lectura en vuelo no repuebla el cache después del logout', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})], demoraLectura: 700 });
  // Se fuerza una lectura y se cierra sesión mientras está en vuelo.
  await page.evaluate(() => { window.__COI_CERT_HISTORIAL__.cargar(true); });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    window.__RV__.sesion = null;
    window.__RV__.notificar('SIGNED_OUT', null);
  });
  await page.waitForTimeout(1200);
  const tras = await page.evaluate(() => ({
    filas: window.__COI_CERT_HISTORIAL__.filas().length,
    estado: window.__COI_CERT_HISTORIAL__.estado()
  }));
  expect(tras.filas).toBe(0);
  expect(tras.estado.cargado).toBe(false);
});

/* ------------------------------------- FINDING · editor activo V60 */

test('RV-13 · el editor V60 ofrece la modalidad con su dominio cerrado', async ({ page }) => {
  await abrirCalendario(page, {});
  await page.evaluate(() => window.COI_ORDENES_EDIT_V60.abrir('4530990001'));
  const select = page.locator('[data-coi-edit-field="modalidad_certificacion"]');
  await expect(select).toBeVisible({ timeout: 20000 });

  const opciones = await select.locator('option').evaluateAll(
    os => os.map(o => [o.value, o.textContent.trim()]));
  expect(opciones).toEqual([
    ['SIN_DEFINIR', 'Sin definir'],
    ['MENSUAL', 'Mantenimiento mensual'],
    ['A_DEMANDA', 'Servicio a demanda']
  ]);
});

test('RV-14 · el editor V60 declara la modalidad como campo editable', async ({ page }) => {
  await abrirCalendario(page, {});
  const contrato = await page.evaluate(() => {
    const api = window.COI_ORDENES_EDIT_V60;
    return { campos: (api.camposEditables || api.campos || []).slice() };
  });
  expect(contrato.campos).toContain('modalidad_certificacion');
});

test('RV-15 · el editor V60 arrastra la modalidad elegida al cambio a persistir', async ({ page }) => {
  await abrirCalendario(page, { tipo: 'Servicio', modalidad: 'SIN_DEFINIR' });
  await page.evaluate(() => window.COI_ORDENES_EDIT_V60.abrir('4530990001'));
  const select = page.locator('[data-coi-edit-field="modalidad_certificacion"]');
  await expect(select).toBeVisible({ timeout: 20000 });
  await select.selectOption('MENSUAL');

  // El recolector del editor tiene que ver el valor elegido.
  const recolectado = await page.evaluate(() => {
    const modal = document.querySelector('[data-coi-edit-field="modalidad_certificacion"]').closest('.coi-edit-v60-card, [role="dialog"]') || document;
    const salida = {};
    modal.querySelectorAll('[data-coi-edit-field]').forEach(i => {
      salida[i.dataset.coiEditField] = i.type === 'checkbox' ? i.checked : i.value;
    });
    return salida.modalidad_certificacion;
  });
  expect(recolectado).toBe('MENSUAL');
});
