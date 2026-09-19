const { test, expect } = require('@playwright/test');

/* Regresiones del tercer round de review de PR #82.
   Cada caso cae con el código previo al arreglo correspondiente.

   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

test.describe.configure({ timeout: 60_000 });

const OC = '4530990001';
const ID_OBRA = 'OBRA-' + OC;
const ORDEN_ID = 'aaaa9999-9999-4999-8999-999999999999';
const UID_A = '11119999-9999-4999-8999-999999999991';

const CERT = (o) => Object.assign({
  id: 'c-' + Math.random().toString(36).slice(2), orden_id: ORDEN_ID, nro_oc: OC,
  acta_medicion_nro: 'AM-REV', fecha_inicio: '2026-06-01', fecha_fin: '2026-06-30',
  posicion: 'POS-1', item_nro: '1', nro_hes: '', nro_if: '',
  proveedor: 'CONTRATISTA REVIEW', aux_porcentaje: 30, anio: 2026,
  fecha_actualizacion: '2026-07-01T10:00:00Z'
}, o);

function fixture(page, opciones = {}) {
  const c = Object.assign({
    tipo: 'Obra', modalidad: null, proximaPersistida: null,
    vencimiento: '2026-12-31', certificaciones: [], demoraLectura: 0,
    catalogoDiferido: false
  }, opciones);

  return page.addInitScript((c) => {
    const OC = '4530990001', ID_OBRA = 'OBRA-' + OC, ORDEN_ID = 'aaaa9999-9999-4999-8999-999999999999';
    const UID_A = '11119999-9999-4999-8999-999999999991';
    const item = {
      id: ORDEN_ID, nro_oc: OC, numeroOC: OC, oc: OC, idObra: ID_OBRA, idOC: ID_OBRA,
      tipo: c.tipo, proveedor: 'CONTRATISTA REVIEW', estacion: 'Plaza Constitución',
      descripcion: 'Trabajo de review', tipoTrabajo: 'Trabajo de review',
      estadoCOI: 'OBRA/SERVICIO EN EJECUCIÓN', estado: 'OBRA/SERVICIO EN EJECUCIÓN',
      estadoDocumental: 'PLIEGO CON EXPTE',
      fechaActaInicio: '2026-01-31', actaInicio: '2026-01-31',
      plazoDias: 90, fechaVencimiento: c.vencimiento, vencimiento: c.vencimiento
    };
    item._supabaseRaw = {
      id: ORDEN_ID, nro_oc: OC, tipo: c.tipo, proveedor: item.proveedor,
      fecha_acta_inicio: '2026-01-31', plazo_dias: 90, fecha_vencimiento: c.vencimiento,
      estado_coi: item.estadoCOI, estado_documental: item.estadoDocumental
    };
    if (c.modalidad) item._supabaseRaw.modalidad_certificacion = c.modalidad;
    if (c.proximaPersistida) item._supabaseRaw.proxima_certificacion = c.proximaPersistida;

    const estado = { uid: UID_A, lecturas: 0, sesion: { user: { id: UID_A, email: 'a@coiroca.com' } }, cbs: [] };
    estado.notificar = (ev, ses) => estado.cbs.forEach(fn => { try { fn(ev, ses); } catch (e) {} });
    window.__RV__ = estado;
    window.__CATALOGO_LISTO__ = !c.catalogoDiferido;

    const consulta = (tabla) => {
      const api = {
        select: () => api, order: () => api, limit: () => api, eq: () => api, in: () => api,
        is: () => api, ilike: () => api, gt: () => api, range: () => api,
        single: async () => ({ data: null, error: null }),
        then(res, rej) {
          if (tabla === 'coi_certificaciones') {
            estado.lecturas += 1;
            const espera = c.demoraLectura ? new Promise(r => setTimeout(r, c.demoraLectura)) : Promise.resolve();
            return espera.then(() => ({
              data: estado.sesion ? c.certificaciones.slice() : [], error: null
            })).then(res, rej);
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
    const nuevoItem = () => JSON.parse(JSON.stringify(item));
    const instalar = () => {
      window.__COI_SUPABASE_CLIENT__ = fake;
      window.getSupabaseClient = () => fake;
      window.initSupabase = async () => fake;
      window.getUsuarioActual = async () => (estado.sesion ? estado.sesion.user : null);
      window.esAutorizacionAdministrativaSupabaseV60 = () => true;
      window.usuarioTienePermisoEdicion = () => true;
      // El catálogo puede llegar DESPUÉS del historial: eso es lo que se prueba.
      window.todasLasOC = () => (window.__CATALOGO_LISTO__ ? [{
        estacion: 'Plaza Constitución', item: nuevoItem(),
        idObra: ID_OBRA, numeroOC: OC, tipo: c.tipo, proveedor: item.proveedor
      }] : []);
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

async function abrirCalendario(page, opciones) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await fixture(page, opciones);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderCalendarioCOIUnificado === 'function'
    && Boolean(window.__COI_CERT_HISTORIAL__), null, { timeout: 25000 });
  await page.waitForFunction(() => {
    const v = document.getElementById('vistaCalendarioCOI');
    if (v && v.classList.contains('active')) return true;
    try {
      window.mostrarVista && window.mostrarVista('vistaCalendarioCOI');
      window.renderCalendarioCOIUnificado && window.renderCalendarioCOIUnificado();
    } catch (e) {}
    return false;
  }, null, { timeout: 40000, polling: 250 });
}

const cargado = page => page.waitForFunction(
  () => window.__COI_CERT_HISTORIAL__.estado().cargado, null, { timeout: 20000 });

/* ------------------ FINDING · escrituras compatibles pre-migración */

async function abrirApp(page) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.normalizarOrdenParaSupabase === 'function', null, { timeout: 25000 });
}
const normalizar = (page, orden) => page.evaluate((o) => {
  const r = window.normalizarOrdenParaSupabase(o);
  return { tiene: Object.prototype.hasOwnProperty.call(r, 'modalidad_certificacion'), valor: r.modalidad_certificacion };
}, orden);

test('R3-1 · una OC sin modalidad NO lleva la clave al payload', async ({ page }) => {
  await abrirApp(page);
  const r = await normalizar(page, { nro_oc: '4530000001', tipo: 'Servicio', estacion: 'X' });
  // Es lo que evita que alta, carga rápida y upsert masivo se rechacen enteros
  // mientras la columna y la allowlist no estén aplicadas en el remoto.
  expect(r.tiene).toBe(false);
});

test('R3-2 · si la fuente informa la modalidad, viaja normalizada', async ({ page }) => {
  await abrirApp(page);
  expect(await normalizar(page, { nro_oc: '1', modalidad_certificacion: 'MENSUAL' }))
    .toEqual({ tiene: true, valor: 'MENSUAL' });
  expect(await normalizar(page, { nro_oc: '1', modalidadCertificacion: 'a demanda' }))
    .toEqual({ tiene: true, valor: 'A_DEMANDA' });
  // Un valor explícito inválido cae en el estado seguro.
  expect(await normalizar(page, { nro_oc: '1', modalidad_certificacion: 'QUINCENAL' }))
    .toEqual({ tiene: true, valor: 'SIN_DEFINIR' });
});

/* ------------------ FINDING · upsert parcial no pisa la modalidad */

test('R3-3 · una fila de importación sin el campo no sobrescribe el MENSUAL remoto', async ({ page }) => {
  await abrirApp(page);
  const r = await normalizar(page, { nro_oc: '4530000002', proveedor: 'X', monto_total: 100 });
  // Callar no es decir SIN_DEFINIR.
  expect(r.tiene).toBe(false);
});

/* ------------------ FINDING · historial para todos los consumidores */

test('R3-4 · proyectar desde cualquier módulo dispara la carga del historial', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})] });
  await cargado(page);
  // Se vuelve al estado de una sesión que nunca abrió el Calendario.
  await page.evaluate(() => window.__COI_CERT_HISTORIAL__.invalidarPorIdentidad());
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargado)).toBe(false);

  await page.evaluate(() => {
    const fila = window.todasLasOC()[0];
    return window.__COI_PROXIMA_CERT__(fila.item, fila);
  });
  await cargado(page);
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargado)).toBe(true);
});

test('R3-5 · pedir la proyección muchas veces no duplica lecturas', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})] });
  await cargado(page);
  const antes = await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargas);
  await page.evaluate(() => {
    const fila = window.todasLasOC()[0];
    for (let i = 0; i < 50; i++) window.__COI_PROXIMA_CERT__(fila.item, fila);
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargas)).toBe(antes);
});

/* ------------------ FINDING · relectura forzada durante una lectura activa */

test('R3-6 · un cargar(true) durante una lectura en curso no se descarta', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})], demoraLectura: 500 });
  await cargado(page);
  const antes = await page.evaluate(() => window.__COI_CERT_HISTORIAL__.estado().cargas);

  const estado = await page.evaluate(async () => {
    window.__COI_CERT_HISTORIAL__.cargar(true);            // queda en vuelo
    await new Promise(x => setTimeout(x, 80));
    await window.__COI_CERT_HISTORIAL__.cargar(true);      // llega durante la anterior
    return window.__COI_CERT_HISTORIAL__.estado();
  });
  // Las dos se atendieron: la segunda no quedó descartada.
  expect(estado.cargas).toBeGreaterThan(antes + 1);
  expect(estado.cargado).toBe(true);
  expect(estado.cargando).toBe(false);
});

/* ------------------ FINDING · el período entra en la clave */

test('R3-7 · un mismo N° de acta en dos períodos son dos certificaciones', async ({ page }) => {
  await abrirCalendario(page, {
    certificaciones: [
      CERT({ id: 'p1a', acta_medicion_nro: 'AM-REPE', fecha_inicio: '2026-05-01', fecha_fin: '2026-05-31', posicion: 'POS-1', item_nro: '1' }),
      CERT({ id: 'p1b', acta_medicion_nro: 'AM-REPE', fecha_inicio: '2026-05-01', fecha_fin: '2026-05-31', posicion: 'POS-2', item_nro: '2' }),
      CERT({ id: 'p2a', acta_medicion_nro: 'AM-REPE', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30', posicion: 'POS-9', item_nro: '9' })
    ]
  });
  await cargado(page);
  const filas = await page.evaluate(() => window.__COI_CERT_HISTORIAL__.filas().map(g => ({
    acta: g.acta, inicio: g.inicio, fin: g.fin, items: g.items, pos: [...g.pos]
  })));
  // Ninguna certificación real desaparece del historial.
  expect(filas).toHaveLength(2);
  const mayo = filas.find(f => f.inicio === '2026-05-01');
  const septiembre = filas.find(f => f.inicio === '2026-09-01');
  expect(mayo.items).toBe(2);
  expect(septiembre.items).toBe(1);
  // Las POS quedan dentro de su certificación, no mezcladas entre períodos.
  expect(mayo.pos).toContain('POS-1');
  expect(mayo.pos).toContain('POS-2');
  expect(mayo.pos).not.toContain('POS-9');
  expect(septiembre.pos).toContain('POS-9');
  expect(septiembre.pos).not.toContain('POS-1');
});

/* ------------------ FINDING · rejoin de metadata */

test('R3-8 · si el historial llega antes que el catálogo, la metadata se rejunta', async ({ page }) => {
  await abrirCalendario(page, { certificaciones: [CERT({})], catalogoDiferido: true });
  await page.evaluate(() => window.__COI_CERT_HISTORIAL__.cargar(true));
  await cargado(page);
  // Sin catálogo, el tipo quedó vacío.
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.filas()[0].tipo)).toBe('');

  const lecturasAntes = await page.evaluate(() => window.__RV__.lecturas);
  await page.evaluate(() => { window.__CATALOGO_LISTO__ = true; return window.__COI_CERT_REJOIN__(); });
  expect(await page.evaluate(() => window.__COI_CERT_HISTORIAL__.filas()[0].tipo)).toBe('Obra');
  // El rejoin es en memoria: no hubo otra lectura remota.
  expect(await page.evaluate(() => window.__RV__.lecturas)).toBe(lecturasAntes);
});

/* ------------------ FINDING · real contra tentativa */

const abrirTarjeta = async (page) => {
  await page.click('#btnCalendarioVistaCOI1');
  const evento = page.locator('#calendarioInteligenteCOI [data-coi-evento]').first();
  await expect(evento).toBeVisible();
  await evento.scrollIntoViewIfNeeded();
  await evento.click();
  await expect(page.locator('#coiResumenEvento')).toBeVisible();
  return page.locator('#coiResumenEvento').innerText();
};
const enMesActual = (dia) => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
};

test('R3-9 · el evento calculado se identifica como tentativo en la Vista COI I', async ({ page }) => {
  /* La última certificación real cae el mes pasado, así que la proyección
     —un mes calendario— aterriza en el mes que el Calendario está mostrando y
     el evento resulta visible. El vencimiento se corre bien adelante para que
     el techo contractual no la suprima. */
  const hoy = new Date();
  const mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 10);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  await abrirCalendario(page, {
    vencimiento: `${hoy.getFullYear() + 1}-12-31`,
    certificaciones: [CERT({ fecha_inicio: iso(mesPasado), fecha_fin: iso(mesPasado) })]
  });
  await cargado(page);

  const proyecta = await page.evaluate(() => {
    const fila = window.todasLasOC()[0];
    return Boolean(window.__COI_PROXIMA_CERT__(fila.item, fila));
  });
  expect(proyecta).toBe(true);

  await page.click('#btnCalendarioVistaCOI1');
  const texto = await page.evaluate(() => {
    const c = document.getElementById('calendarioInteligenteCOI');
    return c ? c.innerText : '';
  });
  expect(texto).toMatch(/Certificaci/i);
  // Una estimación no puede leerse como una fecha acordada.
  expect(texto.toLowerCase()).toContain('tentativa');
});

test('R3-10 · la tarjeta rotula la proyección como tentativa', async ({ page }) => {
  await abrirCalendario(page, {
    vencimiento: enMesActual(20),
    certificaciones: [CERT({ fecha_fin: '2026-06-30' })]
  });
  await cargado(page);
  const texto = await abrirTarjeta(page);
  expect(texto.toUpperCase()).toContain('PRÓXIMA CERTIFICACIÓN TENTATIVA');
});

test('R3-11 · con fecha persistida la tarjeta NO dice tentativa', async ({ page }) => {
  await abrirCalendario(page, {
    vencimiento: enMesActual(20), proximaPersistida: enMesActual(15),
    certificaciones: [CERT({})]
  });
  await cargado(page);
  const texto = await abrirTarjeta(page);
  expect(texto.toUpperCase()).toContain('PRÓXIMA CERTIFICACIÓN');
  expect(texto.toUpperCase()).not.toContain('TENTATIVA');
});
