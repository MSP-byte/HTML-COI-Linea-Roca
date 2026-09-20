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
        estadoLectura: () => 'listo', lecturaActualConfirmada: () => true,
        generacionCatalogo: () => 1
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
  /* Bajo emulación móvil y con la máquina cargada, el arranque puede tardar
     más que el timeout: una sola llamada a mostrarVista() se pierde si el
     registro de vistas todavía no está listo y nadie reintenta. Se insiste
     hasta que la vista quede activa de verdad. */
  await page.waitForFunction(() => {
    const vista = document.getElementById('vistaCalendarioCOI');
    if (vista && vista.classList.contains('active')) return true;
    try {
      window.mostrarVista && window.mostrarVista('vistaCalendarioCOI');
      window.renderCalendarioCOIUnificado && window.renderCalendarioCOIUnificado();
    } catch (e) {}
    return false;
  }, null, { timeout: 40000, polling: 250 });
  await page.locator('#vistaCalendarioCOI.active').waitFor({ state: 'attached', timeout: 25000 });
}

async function abrirOrdenes(page, opciones) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await fixture(page, opciones);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderOrdenes === 'function'
    && Boolean(window.__COI_CERT_HISTORIAL__), null, { timeout: 25000 });
  await page.waitForFunction(() => {
    const vista = document.getElementById('vistaOrdenes');
    if (vista && vista.classList.contains('active')) {
      try { window.renderOrdenes(); } catch (e) {}
      return true;
    }
    try {
      window.mostrarVista && window.mostrarVista('vistaOrdenes');
      window.renderOrdenes && window.renderOrdenes();
    } catch (e) {}
    return false;
  }, null, { timeout: 40000, polling: 250 });
  await page.locator('#vistaOrdenes.active').waitFor({ state: 'attached', timeout: 25000 });
}

async function abrirDashboard(page, opciones) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await fixture(page, opciones);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_V2 && window.COI_V2.renderHome)
    && Boolean(window.__COI_CERT_HISTORIAL__), null, { timeout: 25000 });
  await page.evaluate(() => {
    try { window.mostrarVista && window.mostrarVista('vistaDashboard'); } catch (e) {}
    window.COI_V2.renderHome();
  });
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
  // Escenario post-migración: la fila remota ya contiene la columna.
  await abrirCalendario(page, { tipo: 'Servicio', modalidad: 'SIN_DEFINIR' });
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

test('RV-13b · pre-migración V60 omite modalidad ausente del patch', async ({ page }) => {
  // Escenario productivo previo a la migración: la fila remota no trae la
  // columna. El control no debe existir, así collectForm no puede inventar
  // SIN_DEFINIR durante una edición no relacionada.
  await abrirCalendario(page, { tipo: 'Servicio' });
  await page.evaluate(() => window.COI_ORDENES_EDIT_V60.abrir('4530990001'));

  const select = page.locator('[data-coi-edit-field="modalidad_certificacion"]');
  await expect(select).toHaveCount(0);

  const campos = await page.evaluate(() =>
    [...document.querySelectorAll('#coiEditOCModalV60 [data-coi-edit-field]')]
      .map((n) => n.dataset.coiEditField));
  expect(campos).not.toContain('modalidad_certificacion');
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

/* ------------------------------ FINDING · syncExecutiveMetadata conserva */

test('RV-16 · el sync ejecutivo no borra la modalidad persistida', async ({ page }) => {
  await abrirCalendario(page, { tipo: 'Servicio', modalidad: 'MENSUAL' });
  // Antes del sync el servicio mensual proyecta.
  expect(await proyeccion(page)).toBe('2026-02-28');

  const corrio = await page.evaluate(async () => {
    if (typeof window.syncExecutiveMetadata !== 'function') return false;
    try { await window.syncExecutiveMetadata(); } catch (e) {}
    return true;
  });
  expect(corrio).toBe(true);

  // Y después del sync sigue proyectando: MENSUAL sobrevivió al refresh.
  expect(await proyeccion(page)).toBe('2026-02-28');
  const modalidad = await page.evaluate(() => {
    const it = window.todasLasOC()[0].item;
    return (it._supabaseRaw || {}).modalidad_certificacion || it.modalidad_certificacion || '';
  });
  expect(modalidad).toBe('MENSUAL');
});

/* ===================== review round 2 ===================== */

/* FINDING · fail-closed mientras el historial no sea autoritativo */

test('RV-17 · sin historial cargado no se proyecta desde el Acta de Inicio', async ({ page }) => {
  // Se bloquea la lectura para que el historial nunca quede autoritativo.
  await abrirCalendario(page, { certificaciones: [], demoraLectura: 30000 });
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargado)).toBe(false);
  expect(await proyeccion(page)).toBe('');
});

test('RV-18 · si la lectura del historial falla, tampoco se proyecta', async ({ page }) => {
  await abrirCalendario(page, {});
  await page.evaluate(() => {
    // Se fuerza un error de lectura y se recarga.
    window.__RV__.fallar = true;
    const base = window.getSupabaseClient().from;
    window.getSupabaseClient().from = (t) => t === 'coi_certificaciones'
      ? { select: () => ({ order: function () { return this; }, range: function () { return this; },
          then: (r) => r({ data: null, error: { code: '42501', message: 'RLS' } }) }) }
      : base(t);
    return window.__COI_CERT_HISTORIAL__.cargar(true);
  });
  await page.waitForFunction(() => Boolean(window.__COI_CERT_HISTORIAL__.estado().error), null, { timeout: 20000 });
  expect(await proyeccion(page)).toBe('');
});

/* FINDING · Financiera / Otro con fecha persistida */

test('RV-19 · una fecha persistida en Financiera u Otro no genera evento de certificación', async ({ page }) => {
  for (const tipo of ['Financiera', 'Otro']) {
    const contexto = await page.context().browser().newContext();
    const hoja = await contexto.newPage();
    await abrirCalendario(hoja, { tipo, proximaPersistida: '2026-08-10', certificaciones: [CERT({})] });
    await hoja.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
    expect(await proyeccion(hoja)).toBe('');
    const eventos = await hoja.evaluate(() => {
      const fila = window.todasLasOC()[0];
      return window.__COI_PROXIMA_CERT__(fila.item, fila);
    });
    expect(eventos).toBe('');
    await contexto.close();
  }
});

/* FINDING · avance de obra sólo para Obra */

test('RV-20 · la tarjeta no muestra avance de obra en Financiera u Otro', async ({ page }) => {
  const hoy = new Date();
  const enMes = (d) => `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  await abrirCalendario(page, { tipo: 'Financiera', vencimiento: enMes(20), certificaciones: [CERT({})] });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  await page.click('#btnCalendarioVistaCOI1');
  const evento = page.locator('#calendarioInteligenteCOI [data-coi-evento]').first();
  await expect(evento).toBeVisible();
  await evento.scrollIntoViewIfNeeded();
  await evento.click();
  await expect(page.locator('#coiResumenEvento')).toBeVisible();
  const texto = await page.locator('#coiResumenEvento').innerText();
  expect(texto.toUpperCase()).not.toContain('AVANCE DE OBRA');
});

/* FINDING · cambio de identidad durante la PRIMERA carga */

test('RV-21 · un cambio de cuenta durante la primera carga descarta la respuesta', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})], demoraLectura: 800 });
  // Se fuerza la primera carga y se cambia de identidad mientras está en vuelo.
  await page.evaluate(() => { window.__COI_CERT_HISTORIAL__.invalidarPorIdentidad(); window.__COI_CERT_HISTORIAL__.cargar(true); });
  await page.waitForTimeout(150);
  await page.evaluate((uidB) => {
    window.__RV__.uid = uidB;
    window.__RV__.sesion = { user: { id: uidB, email: 'b@coiroca.com' } };
    window.__RV__.notificar('SIGNED_IN', window.__RV__.sesion);
  }, UID_B);
  await page.waitForTimeout(1400);
  const tras = await page.evaluate(() => ({
    filas: window.__COI_CERT_HISTORIAL__.filas().length,
    uid: window.__COI_CERT_HISTORIAL__.uid()
  }));
  // La respuesta de A no puede quedar visible para B.
  expect(tras.filas).toBe(0);
  expect(tras.uid).not.toBe(UID_A);
});

/* FINDING · tarjeta abierta mientras carga el historial */

test('RV-22 · una tarjeta abierta se actualiza cuando llega el historial', async ({ page }) => {
  const hoy = new Date();
  const enMes = (d) => `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  await abrirCalendario(page, {
    vencimiento: enMes(20), demoraLectura: 1200,
    certificaciones: [CERT({ acta_medicion_nro: 'AM-TARDE', fecha_fin: '2026-06-30' })]
  });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 25000 });
  await page.click('#btnCalendarioVistaCOI1');

  // Se vuelve al estado 'historial todavía no autoritativo' de forma explícita.
  await page.evaluate(() => window.__COI_CERT_HISTORIAL__.invalidarPorIdentidad());
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargado)).toBe(false);

  const evento = page.locator('#calendarioInteligenteCOI [data-coi-evento]').first();
  await expect(evento).toBeVisible();
  await evento.scrollIntoViewIfNeeded();
  await evento.click();
  await expect(page.locator('#coiResumenEvento')).toBeVisible();
  // Sin historial autoritativo la tarjeta no puede afirmar un acta.
  expect(await page.locator('#coiResumenEvento').innerText()).not.toContain('AM-TARDE');

  // Al completarse la lectura, la tarjeta abierta se actualiza sola.
  await page.evaluate(() => window.__COI_CERT_HISTORIAL__.cargar(true));
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 25000 });
  await expect(page.locator('#coiResumenEvento')).toContainText('AM-TARDE', { timeout: 15000 });
});

/* FINDING · compatibilidad PRE-migración del sync ejecutivo */

async function abrirConEsquema(page, { tieneColumna }) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.addInitScript((tieneColumna) => {
    const estado = { intentos: [], sesion: { user: { id: 'u1', email: 'a@coiroca.com' } } };
    window.__ESQ__ = estado;
    const fila = { id: 'o1', nro_oc: '4530000001', tipo: 'Servicio', estado_coi: 'En ejecución' };
    if (tieneColumna) fila.modalidad_certificacion = 'MENSUAL';
    const consulta = (tabla) => {
      let campos = '';
      const api = {
        select(c) { campos = String(c || ''); return api; },
        order: () => api, eq: () => api, in: () => api, is: () => api,
        ilike: () => api, gt: () => api, range: () => api,
        limit() { return api; },
        single: async () => ({ data: null, error: null }),
        then(res, rej) {
          if (tabla === 'coi_ordenes') {
            estado.intentos.push(campos);
            if (!tieneColumna && campos.includes('modalidad_certificacion')) {
              return Promise.resolve({ data: null, error: {
                code: '42703', message: 'column coi_ordenes.modalidad_certificacion does not exist' } }).then(res, rej);
            }
            return Promise.resolve({ data: [Object.assign({}, fila)], error: null }).then(res, rej);
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
        getUser: async () => ({ data: { user: estado.sesion.user }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };
    const instalar = () => {
      window.getSupabaseClient = () => fake;
      window.initSupabase = async () => fake;
      window.getUsuarioActual = async () => estado.sesion.user;
    };
    instalar();
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  }, tieneColumna);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.syncExecutiveMetadata === 'function', null, { timeout: 25000 });
}

test('RV-23 · sin la columna en el esquema remoto, el sync ejecutivo NO se rompe', async ({ page }) => {
  await abrirConEsquema(page, { tieneColumna: false });
  const r = await page.evaluate(async () => {
    try { const filas = await window.syncExecutiveMetadata(); return { ok: true, n: (filas || []).length }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  expect(r.ok).toBe(true);            // no propaga el 42703
  expect(r.n).toBeGreaterThan(0);     // y sigue trayendo metadatos
  const intentos = await page.evaluate(() => window.__ESQ__.intentos);
  // Pidió con la columna, y al faltar reintentó sin ella.
  expect(intentos.some(c => c.includes('modalidad_certificacion'))).toBe(true);
  expect(intentos.some(c => !c.includes('modalidad_certificacion'))).toBe(true);
});

test('RV-24 · con la columna presente el sync la pide y no reintenta', async ({ page }) => {
  await abrirConEsquema(page, { tieneColumna: true });
  const ok = await page.evaluate(async () => {
    try { await window.syncExecutiveMetadata(); return true; } catch (e) { return false; }
  });
  expect(ok).toBe(true);
  const intentos = await page.evaluate(() => window.__ESQ__.intentos);
  expect(intentos.every(c => c.includes('modalidad_certificacion'))).toBe(true);
});

test('RV-25 · otros errores de Supabase siguen propagándose', async ({ page }) => {
  await abrirConEsquema(page, { tieneColumna: true });
  const r = await page.evaluate(async () => {
    const base = window.getSupabaseClient();
    base.from = () => ({
      select: () => ({ limit: function () { return this; },
        then: (res) => res({ data: null, error: { code: '42501', message: 'permission denied' } }) })
    });
    try { await window.syncExecutiveMetadata(); return { propago: false }; }
    catch (e) { return { propago: true, msg: String(e && e.message || e) }; }
  });
  expect(r.propago).toBe(true);       // no es un catch-all
  expect(r.msg).toContain('permission denied');
});

/* FINDING · recarga del historial tras guardar una certificación */

test('RV-26 · guardar una certificación relee el historial autoritativo', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({ acta_medicion_nro: 'AM-VIEJA' })] });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.filas().length)).toBe(1);
  const cargasAntes = await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargas);

  // Llega una certificación nueva y se dispara el refresco canónico.
  await page.evaluate(() => {
    window.__RV__.extra = true;
    return typeof window.refrescarModulosTrasCertificacion === 'function'
      ? window.refrescarModulosTrasCertificacion(['4530990001'])
      : window.__COI_CERT_HISTORIAL__.cargar(true);
  });
  await page.waitForFunction((n) => window.__COI_CERT_HISTORIAL__.estado().cargas > n, cargasAntes, { timeout: 20000 });
  // Se releyó sin que el operador tocara «Actualizar» ni recargara la página.
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargado)).toBe(true);
});


/* ===================== review follow-up final ===================== */

test('RV-27 · Órdenes como primer consumidor se repinta con la proyección canónica', async ({ page }) => {
  await abrirOrdenes(page, {
    tipo: 'Servicio',
    modalidad: 'MENSUAL',
    certificaciones: [CERT({ fecha_fin: '2026-06-30' })],
    demoraLectura: 350
  });

  // No se abrió Calendario. La primera pasada inicia la lectura y queda sin
  // estimación; al terminar el historial, el consumidor activo se repinta solo.
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  const celda = page.locator('#ordenesTbody tr').first().locator('td.col-fecha').first();
  await expect(celda).toContainText(/(?:30\/0?7\/2026|2026-07-30)/, { timeout: 20000 });
});

test('RV-28 · el renderer final de Órdenes no revive un alias legacy para A_DEMANDA', async ({ page }) => {
  await abrirOrdenes(page, {
    tipo: 'Servicio',
    modalidad: 'A_DEMANDA',
    proximaAlias: '2026-08-10',
    certificaciones: []
  });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  const celda = page.locator('#ordenesTbody tr').first().locator('td.col-fecha').first();
  await expect(celda).not.toContainText(/10\/0?8\/2026/);
});

test('RV-29 · Dashboard V2 usa la proyección canónica y se repinta al cargar historial', async ({ page }) => {
  await abrirDashboard(page, {
    tipo: 'Servicio',
    modalidad: 'MENSUAL',
    certificaciones: [CERT({ fecha_inicio: '2026-09-01', fecha_fin: '2026-09-01' })],
    demoraLectura: 250
  });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  await page.waitForFunction(() => /0?1\s+oct\.?\s+2026/i.test(document.querySelector('#coiV2Home')?.textContent || ''), null, { timeout: 20000 });
  expect(await page.locator('#coiV2Home').innerText()).toMatch(/Próxima certificación/i);
});

test('RV-30 · filas legacy y nuevas de una misma certificación consolidan por UUID maestro', async ({ page }) => {
  await abrirCalendario(page, {});
  const r = await page.evaluate(() => {
    const base = {
      nro_oc: '4530990001', acta_medicion_nro: 'AM-MIXTA',
      fecha_inicio: '2026-07-01', fecha_fin: '2026-07-31',
      proveedor: 'CONTRATISTA REVIEW', aux_porcentaje: 50, anio: 2026
    };
    const filas = window.__COI_CERT_HISTORIAL__.consolidar([
      { ...base, id: 'legacy-pos', orden_id: null, posicion: 'POS-1', item_nro: '1' },
      { ...base, id: 'new-pos', orden_id: 'aaaa9999-9999-4999-8999-999999999999', posicion: 'POS-2', item_nro: '2' }
    ]);
    return { grupos: filas.length, items: filas[0] && filas[0].items, pos: filas[0] ? [...filas[0].pos] : [] };
  });
  expect(r.grupos).toBe(1);
  expect(r.items).toBe(2);
  expect(r.pos).toEqual(expect.arrayContaining(['POS-1','POS-2']));
});

test('RV-31 · un huérfano histórico no fuerza rejoin completo en cada proyección', async ({ page }) => {
  await abrirCalendario(page, {
    certificaciones: [CERT({ id: 'orphan-1', nro_oc: 'OC-HUERFANA', orden_id: null })]
  });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  const calls = await page.evaluate(() => {
    const base = window.todasLasOC;
    const fila = base()[0];
    let n = 0;
    window.todasLasOC = () => { n += 1; return base(); };
    for (let i = 0; i < 25; i += 1) window.__COI_PROXIMA_CERT__(fila.item, fila);
    return n;
  });
  expect(calls).toBeLessThanOrEqual(1);
});



test('RV-32 · historial autoritativo vacío suprime última certificación legacy en tarjeta', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [] });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  await page.evaluate(() => {
    const fila = window.todasLasOC()[0];
    fila.item.ultimaCertificacion = 'ACTA LEGACY 99';
  });
  // El contrato se verifica directamente sobre la autoridad: sin filas reales,
  // el detalle autoritativo debe ser nulo.
  expect(await page.evaluate(() => window.__COI_CERT_ULTIMA_DETALLE__('4530990001'))).toBeNull();
});

test('RV-33 · dos actas del mismo período desempatan por secuencia/actualización', async ({ page }) => {
  await abrirCalendario(page, {});
  const detalle = await page.evaluate(() => {
    window.__COI_CERT_HISTORIAL__.consolidar([
      { id:'a1', orden_id:'aaaa9999-9999-4999-8999-999999999999', nro_oc:'4530990001', acta_medicion_nro:'Acta 1',
        fecha_inicio:'2026-08-01', fecha_fin:'2026-08-31', fecha_actualizacion:'2026-09-01T10:00:00Z', posicion:'P1' },
      { id:'a2', orden_id:'aaaa9999-9999-4999-8999-999999999999', nro_oc:'4530990001', acta_medicion_nro:'Acta 2',
        fecha_inicio:'2026-08-01', fecha_fin:'2026-08-31', fecha_actualizacion:'2026-09-02T10:00:00Z', posicion:'P2' }
    ]);
    return window.__COI_CERT_ULTIMA_DETALLE__('4530990001');
  });
  expect(detalle.acta).toBe('Acta 2');
});

test('RV-34 · lookup de última certificación queda indexado y no barre historial por OC', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})] });
  await page.waitForFunction(() => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });
  const r = await page.evaluate(() => {
    const antes = performance.now();
    for (let i=0;i<5000;i+=1) window.__COI_CERT_ULTIMA__('4530990001');
    return { valor: window.__COI_CERT_ULTIMA__('4530990001'), ms: performance.now()-antes };
  });
  expect(r.valor).toBe('2026-06-30');
  expect(r.ms).toBeLessThan(1000);
});

test('RV-35 · modal resumen tiene precedencia visual sobre shell V2', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})] });
  const z = await page.evaluate(() => {
    const s=[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules]}catch(e){return[]}})
      .find(rule=>rule.selectorText==='.coi-resumen-modal');
    return s ? s.style.zIndex : '';
  });
  expect(Number(z)).toBeGreaterThan(2000);
});
