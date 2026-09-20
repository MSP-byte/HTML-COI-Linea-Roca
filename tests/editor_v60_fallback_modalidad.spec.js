const { test, expect } = require('@playwright/test');

/* Fallback de interfaz contra dato persistido, en el editor V60.

   El selector de modalidad sintetiza SIN_DEFINIR cuando la fila remota no trae
   el campo. Como collectForm() envía todos los controles, ese valor llegaba a
   normalizeChanges() y entraba al delta aunque el operador nunca lo tocara: en
   producción pre-migración el RPC desplegado lo rechaza como clave desconocida
   y se cae cualquier edición de una OC histórica.

   Principio: un fallback de interfaz NO es un dato persistido.

   Se verifica sobre normalizarCambios(), que es donde se decide el delta y
   donde `current` es la fila remota real leída con select('*').
   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

test.describe.configure({ timeout: 60_000 });

async function abrirApp(page) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(window.COI_ORDENES_EDIT_V60 && window.COI_ORDENES_EDIT_V60.normalizarCambios),
    null, { timeout: 25000 });
}

/* Fila remota de una OC histórica: la columna todavía no existe, así que la
   clave NO está presente. Es exactamente el entorno documentado en KI-034. */
const REMOTA_HISTORICA = {
  id: 'oc-1', nro_oc: '4530111222', id_obra: 'OB-1', tipo: 'Servicio',
  proveedor: 'CONTRATISTA UNO', estacion: 'Plaza Constitución',
  descripcion: 'Servicio histórico', observaciones: 'original',
  fecha_acta_inicio: '2026-01-10', plazo_dias: 90, fecha_vencimiento: '2026-12-31',
  monto_total: 1000, moneda: 'ARS', estado_coi: 'En ejecución'
};

// Lo que collectForm() manda: TODOS los controles, con el selector ya resuelto.
const FORMULARIO = (extra) => Object.assign({
  descripcion: 'Servicio histórico',
  observaciones: 'original',
  fecha_acta_inicio: '2026-01-10',
  fecha_vencimiento: '2026-12-31',
  proveedor: 'CONTRATISTA UNO',
  modalidad_certificacion: 'SIN_DEFINIR'   // ← lo pone el control, no la persona
}, extra || {});

const delta = (page, cambios, remota) => page.evaluate(
  ({ cambios, remota }) => {
    const r = window.COI_ORDENES_EDIT_V60.normalizarCambios(cambios, remota);
    return { campos: Object.keys(r.patch || r).sort(), patch: r.patch || r, errores: r.errors || {} };
  }, { cambios, remota });

/* ---------------------------------------------------- casos A, B y C */

test('EV-A · editar sólo observaciones no arrastra la modalidad al delta', async ({ page }) => {
  await abrirApp(page);
  const r = await delta(page, FORMULARIO({ observaciones: 'texto nuevo' }), REMOTA_HISTORICA);
  expect(r.campos).toEqual(['observaciones']);
  expect(r.patch).not.toHaveProperty('modalidad_certificacion');
});

test('EV-B · editar sólo una fecha no arrastra la modalidad al delta', async ({ page }) => {
  await abrirApp(page);
  const r = await delta(page, FORMULARIO({ fecha_vencimiento: '2027-03-31' }), REMOTA_HISTORICA);
  expect(r.campos).toEqual(['fecha_vencimiento']);
  expect(r.patch).not.toHaveProperty('modalidad_certificacion');
});

test('EV-C · recolectar el formulario sin tocar nada no produce delta alguno', async ({ page }) => {
  await abrirApp(page);
  const r = await delta(page, FORMULARIO(), REMOTA_HISTORICA);
  // undefined/null → SIN_DEFINIR visual no es un cambio.
  expect(r.campos).toEqual([]);
  expect(r.patch).not.toHaveProperty('modalidad_certificacion');
});

/* ------------------------------------- casos D y E: no romper lo que anda */

test('EV-D · un cambio real de modalidad SÍ entra al delta', async ({ page }) => {
  await abrirApp(page);
  // El operador elige MENSUAL sobre una fila que no tenía valor: es una edición.
  const r = await delta(page, FORMULARIO({ modalidad_certificacion: 'MENSUAL' }), REMOTA_HISTORICA);
  expect(r.campos).toContain('modalidad_certificacion');
  expect(r.patch.modalidad_certificacion).toBe('MENSUAL');
});

test('EV-D2 · con modalidad ya persistida, volver a SIN_DEFINIR es un cambio real', async ({ page }) => {
  await abrirApp(page);
  const remota = Object.assign({}, REMOTA_HISTORICA, { modalidad_certificacion: 'MENSUAL' });
  const r = await delta(page, FORMULARIO({ modalidad_certificacion: 'SIN_DEFINIR' }), remota);
  // El original existía: la regla de fallback no aplica y el cambio viaja.
  expect(r.campos).toContain('modalidad_certificacion');
  expect(r.patch.modalidad_certificacion).toBe('SIN_DEFINIR');
});

test('EV-D3 · con modalidad persistida igual a la enviada, no hay cambio', async ({ page }) => {
  await abrirApp(page);
  const remota = Object.assign({}, REMOTA_HISTORICA, { modalidad_certificacion: 'MENSUAL' });
  const r = await delta(page, FORMULARIO({ modalidad_certificacion: 'MENSUAL' }), remota);
  expect(r.campos).toEqual([]);
});

test('EV-E · la detección de cambios del resto de los campos no se altera', async ({ page }) => {
  await abrirApp(page);
  const r = await delta(page, FORMULARIO({
    observaciones: 'otro texto',
    proveedor: 'CONTRATISTA DOS',
    fecha_vencimiento: '2027-06-30'
  }), REMOTA_HISTORICA);
  expect(r.campos).toEqual(['fecha_vencimiento', 'observaciones', 'proveedor'].sort());
  expect(r.patch.proveedor).toBe('CONTRATISTA DOS');
  expect(r.patch.observaciones).toBe('otro texto');
});

test('EV-E2 · un campo sin cambios reales sigue sin entrar al delta', async ({ page }) => {
  await abrirApp(page);
  // Mismos valores que la fila remota: nada que enviar.
  const r = await delta(page, FORMULARIO({ proveedor: 'CONTRATISTA UNO' }), REMOTA_HISTORICA);
  expect(r.campos).toEqual([]);
});

/* ------------------------------------------------ caso F: regresión del finding */

test('EV-F · el camino completo del editor no manda la clave a una fila sin la columna', async ({ page }) => {
  await abrirApp(page);
  /* Se reproduce el camino del finding: fila remota SIN la columna —como en
     producción pre-migración—, el operador toca un campo cualquiera y el
     formulario entero se recolecta con el selector ya resuelto. */
  const enviado = await page.evaluate((remota) => {
    const form = {
      descripcion: 'Servicio histórico',
      observaciones: 'corrijo una observación',
      fecha_acta_inicio: '2026-01-10',
      fecha_vencimiento: '2026-12-31',
      proveedor: 'CONTRATISTA UNO',
      modalidad_certificacion: 'SIN_DEFINIR'
    };
    const r = window.COI_ORDENES_EDIT_V60.normalizarCambios(form, remota);
    const patch = r.patch || r;
    return { claves: Object.keys(patch), tieneModalidad: Object.prototype.hasOwnProperty.call(patch, 'modalidad_certificacion') };
  }, REMOTA_HISTORICA);

  // La clave desconocida no llega al RPC desplegado: la edición no se rompe.
  expect(enviado.tieneModalidad).toBe(false);
  expect(enviado.claves).toEqual(['observaciones']);
});

test('EV-F2 · la regla no se extiende a otros campos ausentes', async ({ page }) => {
  await abrirApp(page);
  // `sector` está ausente en la fila remota y NO tiene default de interfaz:
  // si el formulario lo trae con valor, es un cambio y tiene que viajar.
  const r = await delta(page, FORMULARIO({ sector: 'Andén 3' }), REMOTA_HISTORICA);
  expect(r.campos).toContain('sector');
  expect(r.patch.sector).toBe('Andén 3');
});
