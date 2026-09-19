const { test, expect } = require('@playwright/test');

/* CAMBIO 3 — próxima certificación TENTATIVA.
   Las certificaciones reales viven en public.coi_certificaciones; esto es una
   proyección y sólo se emite cuando el modelo alcanza para afirmarla:

     base  = última certificación REAL (fecha administrativa) o Acta de Inicio
     paso  = un mes CALENDARIO, no 30 días
     techo = nunca después del vencimiento contractual

   Obra proyecta con Acta de Inicio y plazo de 30 a 120 días.
   Servicio proyecta sólo con modalidad_certificacion = MENSUAL.

   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

test.describe.configure({ timeout: 60_000 });

const OBRA = {
  tipo: 'Obra', estadoCOI: 'OBRA/SERVICIO EN EJECUCIÓN',
  fechaActaInicio: '2026-01-31', plazoDias: 90,
  fechaVencimiento: '2026-12-31', numeroOC: '4530500001', nro_oc: '4530500001'
};

async function abrir(page, ultimasPorOC = {}) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.addInitScript((mapa) => {
    const instalar = () => {
      // Sustituye al historial real: devuelve la última certificación
      // administrativa conocida por OC.
      window.__COI_CERT_ULTIMA__ = (nro) => mapa[String(nro || '')] || '';
      /* La proyección falla cerrada mientras el historial no sea autoritativo
         (review finding 3). Estas pruebas verifican la REGLA de proyección, no
         la carga, así que declaran esa precondición de forma explícita. */
      window.__COI_CERT_HISTORIAL__ = Object.assign({}, window.__COI_CERT_HISTORIAL__, {
        estado: () => ({ cargando: false, cargado: true, error: '', cargas: 1 }),
        ultimaPorOC: (nro) => mapa[String(nro || '')] || '',
        filas: () => []
      });
    };
    instalar();
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  }, ultimasPorOC);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__COI_PROXIMA_CERT__ === 'function', null, { timeout: 25000 });
}

const proyectar = (page, item) => page.evaluate(i => window.__COI_PROXIMA_CERT__(i, {}), item);
const soloProyeccion = (page, item) => page.evaluate(i => window.__COI_PROYECCION_MENSUAL__(i, {}), item);

/* ------------------------------------------------------------------ Obras */

test('PC-1 · Obra de 30–120 días sin certificaciones proyecta Acta de Inicio + 1 mes calendario', async ({ page }) => {
  await abrir(page);
  // 31/01 + 1 mes calendario NO es 30 días: cae en febrero, no en el 02/03.
  expect(await proyectar(page, OBRA)).toBe('2026-02-28');
});

test('PC-2 · el paso es un mes calendario, no 30 días', async ({ page }) => {
  await abrir(page);
  const item = Object.assign({}, OBRA, { fechaActaInicio: '2026-03-15' });
  expect(await proyectar(page, item)).toBe('2026-04-15');   // +30 días daría 14/04
});

test('PC-3 · Obra con certificación real proyecta desde la última certificación válida', async ({ page }) => {
  await abrir(page, { '4530500001': '2026-06-30' });
  // Ya no parte del Acta de Inicio: parte del hecho registrado.
  expect(await proyectar(page, OBRA)).toBe('2026-07-30');
});

test('PC-4 · nunca se proyecta después del vencimiento contractual', async ({ page }) => {
  await abrir(page, { '4530500001': '2026-12-15' });
  const item = Object.assign({}, OBRA, { fechaVencimiento: '2026-12-31' });
  // 15/12 + 1 mes = 15/01/2027, más allá del vencimiento: no se proyecta.
  expect(await proyectar(page, item)).toBe('');
});

test('PC-5 · una Obra con plazo fuera de 30–120 días no proyecta', async ({ page }) => {
  await abrir(page);
  expect(await soloProyeccion(page, Object.assign({}, OBRA, { plazoDias: 15 }))).toBe('');
  expect(await soloProyeccion(page, Object.assign({}, OBRA, { plazoDias: 365 }))).toBe('');
  expect(await soloProyeccion(page, Object.assign({}, OBRA, { plazoDias: 30 }))).toBe('2026-02-28');
  expect(await soloProyeccion(page, Object.assign({}, OBRA, { plazoDias: 120 }))).toBe('2026-02-28');
});

test('PC-6 · una Obra sin Acta de Inicio no proyecta', async ({ page }) => {
  await abrir(page);
  expect(await soloProyeccion(page, Object.assign({}, OBRA, { fechaActaInicio: '', actaInicio: '' }))).toBe('');
});

test('PC-7 · una Obra finalizada, cancelada o suspendida no proyecta', async ({ page }) => {
  await abrir(page);
  for (const estado of ['OBRA/SERVICIO FINALIZADA', 'OBRA/SERVICIO CANCELADA O SUSPENDIDA']) {
    expect(await soloProyeccion(page, Object.assign({}, OBRA, { estadoCOI: estado }))).toBe('');
  }
});

/* -------------------------------------------------------------- Servicios */

const SERVICIO = {
  tipo: 'Servicio', estadoCOI: 'OBRA/SERVICIO EN EJECUCIÓN',
  fechaActaInicio: '2026-01-31', plazoDias: 365,
  fechaVencimiento: '2026-12-31', numeroOC: '4530500002', nro_oc: '4530500002'
};

test('PC-8 · un Servicio MENSUAL genera próxima certificación', async ({ page }) => {
  await abrir(page);
  const item = Object.assign({}, SERVICIO, { modalidad_certificacion: 'MENSUAL' });
  expect(await proyectar(page, item)).toBe('2026-02-28');
});

test('PC-9 · un Servicio A DEMANDA no genera una fecha mensual falsa', async ({ page }) => {
  await abrir(page);
  const item = Object.assign({}, SERVICIO, { modalidad_certificacion: 'A_DEMANDA' });
  expect(await proyectar(page, item)).toBe('');
});

test('PC-10 · un Servicio SIN_DEFINIR tampoco proyecta', async ({ page }) => {
  await abrir(page);
  expect(await proyectar(page, Object.assign({}, SERVICIO, { modalidad_certificacion: 'SIN_DEFINIR' }))).toBe('');
  // Un histórico sin el campo se comporta igual: no se infiere periodicidad.
  expect(await proyectar(page, SERVICIO)).toBe('');
});

test('PC-11 · la modalidad se lee también de _supabaseRaw', async ({ page }) => {
  await abrir(page);
  const item = Object.assign({}, SERVICIO, { _supabaseRaw: { modalidad_certificacion: 'MENSUAL' } });
  expect(await proyectar(page, item)).toBe('2026-02-28');
});

test('PC-12 · un Servicio MENSUAL proyecta desde su última certificación real', async ({ page }) => {
  await abrir(page, { '4530500002': '2026-05-31' });
  const item = Object.assign({}, SERVICIO, { modalidad_certificacion: 'MENSUAL' });
  expect(await proyectar(page, item)).toBe('2026-06-30');
});

/* ------------------------------------------------------- dato vs inferencia */

/* Tras el review, «cargada a mano» significa exactamente la columna
   coi_ordenes.proxima_certificacion. Los alias que derivan todasLasOC() y sus
   envoltorios son CÁLCULOS, no evidencia de carga manual. */

test('PC-13 · la columna persistida sí se respeta y no se recalcula', async ({ page }) => {
  await abrir(page);
  const item = Object.assign({}, SERVICIO, {
    modalidad_certificacion: 'A_DEMANDA',
    _supabaseRaw: { proxima_certificacion: '2026-08-10', modalidad_certificacion: 'A_DEMANDA' }
  });
  expect(await proyectar(page, item)).toBe('2026-08-10');
});

test('PC-13b · un alias derivado NO se toma por carga manual', async ({ page }) => {
  await abrir(page);
  // Mismo caso, pero la fecha sólo vive en el alias del item: no hay override.
  const item = Object.assign({}, SERVICIO, {
    modalidad_certificacion: 'A_DEMANDA', proximaCertificacion: '2026-08-10'
  });
  expect(await proyectar(page, item)).toBe('');
});

test('PC-14 · la proyección no usa fecha_creacion técnica como base', async ({ page }) => {
  await abrir(page, { '4530500001': '2026-06-30' });
  // fecha_creacion muy posterior no puede desplazar la proyección.
  const item = Object.assign({}, OBRA, { fecha_creacion: '2026-11-20T10:00:00Z' });
  expect(await proyectar(page, item)).toBe('2026-07-30');
});

/* ------------------------------------------------- fail-closed (review) */

test('PC-15 · sin historial autoritativo no se proyecta, aunque el resto habilite', async ({ page }) => {
  await abrir(page);
  // Se retira la precondición: el historial deja de estar cargado.
  await page.evaluate(() => {
    window.__COI_CERT_HISTORIAL__ = Object.assign({}, window.__COI_CERT_HISTORIAL__, {
      estado: () => ({ cargando: true, cargado: false, error: '', cargas: 0 })
    });
  });
  expect(await proyectar(page, OBRA)).toBe('');
});

test('PC-16 · un error de lectura tampoco habilita la proyección', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => {
    window.__COI_CERT_HISTORIAL__ = Object.assign({}, window.__COI_CERT_HISTORIAL__, {
      estado: () => ({ cargando: false, cargado: true, error: 'RLS', cargas: 1 })
    });
  });
  expect(await proyectar(page, OBRA)).toBe('');
});
