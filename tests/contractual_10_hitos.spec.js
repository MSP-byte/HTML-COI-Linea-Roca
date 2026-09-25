const { test, expect } = require('@playwright/test');
const F = require('./fixtures/contractual_remote_fixture');

/* SEGUIMIENTO CONTRACTUAL Y EJECUCIÓN — máquina de estados de 10 hitos.

   Todas estas pruebas corren el camino REAL de la aplicación: autenticación
   H14, carga del catálogo desde coi_ordenes, deep-link del router, Ficha OC,
   resolver canónico de la OC, lectura de coi_historial_oc, modal, writer R28
   y RPC coi_confirmar_etapa_circuito_v3 (port 1:1 en el fixture). No se
   reemplaza ningún resolver ni la caché: fue exactamente ese mock el que
   ocultó que window.resolverOrdenActual no existe en producción.

   Modelo:
     H1..H8  1° Etapa · H9 ejecución · H10 cierre (3 variantes, 1 hito)
     cancelada_suspendida: transversal, no suma.
     X/10 = hitos lógicos distintos con transición real en coi_historial_oc.

   Reloj fijo: 25/09/2026 15:00 (Buenos Aires). */

const AHORA = '2026-09-25T15:00:00-03:00';
const OC = '4530009514';
const H = ['pliegos_preparacion', 'pliegos_terminado_sin_solped', 'solped_sin_expediente', 'pliego_con_oc',
  'pliego_con_expediente', 'oc_sin_control_terceros', 'control_terceros_sin_acta', 'control_terceros_con_acta', 'ejecucion'];
const NOMBRE = {
  ejecucion: 'OBRA/SERVICIO EN EJECUCIÓN', finalizada: 'OBRA/SERVICIO FINALIZADA',
  finalizada_actas: 'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA',
  pliego_con_oc: 'PLIEGO CON OC', cancelada_suspendida: 'OBRA/SERVICIO CANCELADA O SUSPENDIDA'
};

const sinIniciar = (extra = {}) => F.ordenBase(Object.assign({ estado_coi: 'Pendiente de completar', estado_documental: 'Pendiente' }, extra));
const conActa = (extra = {}) => sinIniciar(Object.assign({ fecha_acta_inicio: '2026-02-23' }, extra));
const tarjeta = (obs, codigo) => obs.tarjetas.find((t) => t.codigo === codigo);
const canonicas = (page, codigo) => page.evaluate(({ oc, codigo }) =>
  window.__CT10__.historial(oc).filter((h) => h.tipo_evento === 'Circuito administrativo' && (!codigo || h.campo_modificado === codigo)).length,
{ oc: OC, codigo });

async function abrir(page, opciones) {
  await F.prepararRemotoContractual(page, Object.assign({ ahora: AHORA }, opciones));
  const errores = await F.abrirFichaContractual(page, OC);
  return errores;
}
async function recargar(page) {
  const antes = await page.evaluate(() => window.__CT10__.lecturas.coi_historial_oc.length);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fichaOCBody #etapa1PipelineContractual', { timeout: 25000 });
  await F.esperarHistorialLeido(page);
  return antes;
}

test('T01 · vacío: sin historial → 0 / 10', async ({ page }) => {
  await abrir(page, { ordenes: [sinIniciar()] });
  const o = await F.observable(page);
  expect(o.oc).toBe(OC);
  expect(o.avance).toBe('0 / 10');
  expect(o.estadoActual).toBe('Sin iniciar');
  expect(o.ultimaAct).toBe('—');
  expect(o.diasEstado).toBe('—');
  expect(o.tarjetas.filter((t) => t.clase !== 'pendiente')).toHaveLength(0);
});

test('T02 · solo H1 confirmado → 1 / 10', async ({ page }) => {
  await abrir(page, { ordenes: [sinIniciar()] });
  await F.confirmarHito(page, 'pliegos_preparacion', '2026-09-20');
  const o = await F.observable(page);
  expect(o.avance).toBe('1 / 10');
  expect(o.estadoActual).toContain('PLIEGOS EN PREPARACI');
  expect(o.diasEstado).toBe('5');
  expect(o.ultimaAct).not.toBe('—');
  const h1 = tarjeta(o, 'pliegos_preparacion');
  expect(h1.hito).toBe('H1');
  expect(h1.meta).toBe('Fecha efectiva: 20/09/2026');
  expect(h1.clase).toBe('actual');
});

test('T03 · solo H10: FINALIZADA directa → 1 / 10, nunca 10 / 10', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'finalizada', '2026-09-25');
  const o = await F.observable(page);
  expect(o.avance).toBe('1 / 10');
  expect(o.estadoActual).toBe('SERVICIO FINALIZADO');
  expect(tarjeta(o, 'finalizada').meta).toBe('Fecha efectiva: 25/09/2026');
  // No se inventan H1–H9.
  for (const codigo of H) {
    expect(tarjeta(o, codigo).meta).toBe('Sin confirmación registrada');
    expect(tarjeta(o, codigo).clase).toBe('pendiente');
  }
  expect(o.aviso).toBeNull();
});

test('T04 · H9 + H10: EJECUCIÓN → FINALIZADA → 2 / 10 con duración congelada', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'ejecucion', '2026-09-01');
  await F.confirmarHito(page, 'finalizada', '2026-09-10');
  const o = await F.observable(page);
  expect(o.avance).toBe('2 / 10');
  expect(tarjeta(o, 'ejecucion').dias).toBe('Días en estado: 9');
  expect(tarjeta(o, 'ejecucion').clase).toBe('completado');
  expect(tarjeta(o, 'finalizada').dias).toBe('Días en estado: 15');
  expect(o.diasEstado).toBe('15');
});

test('T05 · circuito completo H1…H10 → 10 / 10', async ({ page }) => {
  const orden = conActa({ estado_coi: NOMBRE.ejecucion, estado_documental: NOMBRE.ejecucion });
  const historial = [];
  H.forEach((codigo, i) => {
    const dia = String(i + 1).padStart(2, '0');
    historial.push(...F.evento(orden, codigo, '2026-09-' + dia + 'T13:00:00.000Z', '2026-09-' + dia));
  });
  await abrir(page, { ordenes: [orden], historial });
  expect((await F.observable(page)).avance).toBe('9 / 10');
  await F.confirmarHito(page, 'finalizada', '2026-09-20');
  const o = await F.observable(page);
  expect(o.avance).toBe('10 / 10');
  expect(o.aviso).toBeNull();
  expect(o.tarjetas.filter((t) => t.hito && t.clase === 'pendiente').map((t) => t.codigo).sort())
    .toEqual(['finalizada_actas', 'finalizada_saldo_remanente']);
});

test('T06 · salto H2 → H5 → H9 → H10 → 4 / 10, sin completar los salteados', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'pliegos_terminado_sin_solped', '2026-09-02');
  await F.confirmarHito(page, 'pliego_con_expediente', '2026-09-05');
  await F.confirmarHito(page, 'ejecucion', '2026-09-09');
  await F.confirmarHito(page, 'finalizada', '2026-09-20');
  const o = await F.observable(page);
  expect(o.avance).toBe('4 / 10');
  expect(o.aviso).toBe('Existen hitos intermedios sin registrar.');
  for (const codigo of ['pliegos_preparacion', 'solped_sin_expediente', 'pliego_con_oc', 'oc_sin_control_terceros', 'control_terceros_sin_acta', 'control_terceros_con_acta']) {
    expect(tarjeta(o, codigo).meta).toBe('Sin confirmación registrada');
    expect(tarjeta(o, codigo).dias).toContain('—');
  }
  // Solo 4 confirmaciones canónicas: nada autocompletado en Supabase.
  expect(await canonicas(page)).toBe(4);
});

test('T07 · variante H10: FINALIZADA → FINALIZADA CON ACTAS sigue 1 / 10 y registra la transición', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'finalizada', '2026-09-10');
  expect((await F.observable(page)).avance).toBe('1 / 10');
  await F.confirmarHito(page, 'finalizada_actas', '2026-09-20');
  const o = await F.observable(page);
  expect(o.avance).toBe('1 / 10');
  expect(o.estadoActual).toContain('FINALIZADO CON ACTA PROVISORIA Y DEFINITIVA');
  expect(tarjeta(o, 'finalizada').clase).toBe('completado');
  expect(tarjeta(o, 'finalizada').dias).toBe('Días en estado: 10');
  expect(tarjeta(o, 'finalizada_actas').clase).toBe('actual');
  expect(tarjeta(o, 'finalizada_actas').meta).toBe('Fecha efectiva: 20/09/2026');
  expect(await canonicas(page, 'finalizada')).toBe(1);
  expect(await canonicas(page, 'finalizada_actas')).toBe(1);
});

test('T08 · FINALIZADA CON SALDO REMANENTE (Servicio) cuenta como H10', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'finalizada_saldo_remanente', '2026-09-18');
  const o = await F.observable(page);
  expect(o.avance).toBe('1 / 10');
  expect(tarjeta(o, 'finalizada_saldo_remanente').hito).toBe('H10');
  expect(tarjeta(o, 'finalizada_saldo_remanente').meta).toBe('Fecha efectiva: 18/09/2026');
  // Y cambiar después a FINALIZADA no suma: mismo hito lógico.
  await F.confirmarHito(page, 'finalizada', '2026-09-22');
  expect((await F.observable(page)).avance).toBe('1 / 10');
});

test('T09 · CANCELADA/SUSPENDIDA es transversal: no suma a X / 10 y conserva su traza', async ({ page }) => {
  await abrir(page, { ordenes: [sinIniciar()] });
  await F.confirmarHito(page, 'cancelada_suspendida', '2026-09-05');
  let o = await F.observable(page);
  expect(o.avance).toBe('0 / 10');
  expect(o.transversal).toContain('antes del inicio');
  await F.confirmarHito(page, 'pliegos_preparacion', '2026-09-15');
  o = await F.observable(page);
  expect(o.avance).toBe('1 / 10');
  // La cancelación histórica se preserva aunque ya no esté vigente.
  expect(o.transversal).toBeNull();
  expect(tarjeta(o, 'cancelada_suspendida').meta).toBe('Fecha efectiva: 05/09/2026');
  expect(tarjeta(o, 'cancelada_suspendida').dias).toBe('Días en estado: 10');
});

test('T10 · IDEMPOTENCIA: reconfirmar FINALIZADA deja el estado observable idéntico', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'finalizada', '2026-09-20');
  const antes = await F.observable(page);
  const filasAntes = await page.evaluate((oc) => window.__CT10__.historial(oc), OC);
  const ordenAntes = await page.evaluate((oc) => window.__CT10__.orden(oc), OC);
  // Sin tocar la fecha: el modal tiene que proponer la fecha efectiva
  // PERSISTIDA, no «hoy».
  await page.locator('#fichaOCBody [data-etapa1-tab="etapa1Panel2"]').click();
  await page.locator('#fichaOCBody [data-etapa1-hito="finalizada"]').click();
  await expect(page.locator('#etapa1ModalFecha')).toHaveValue('2026-09-20');
  await expect(page.locator('#etapa1ModalReconfirmacion')).toBeVisible();
  await page.click('#etapa1ModalCancelar');
  await F.confirmarHito(page, 'finalizada');
  const despues = await F.observable(page);
  expect(despues).toEqual(antes);
  expect(despues.avance).toBe('1 / 10');
  expect(despues.ultimaAct).not.toBe('—');
  expect(tarjeta(despues, 'finalizada').meta).toBe('Fecha efectiva: 20/09/2026');
  // Supabase: ninguna fila nueva, ninguna fecha cambiada, fecha_ultimo_control intacta.
  expect(await page.evaluate((oc) => window.__CT10__.historial(oc), OC)).toEqual(filasAntes);
  expect((await page.evaluate((oc) => window.__CT10__.orden(oc), OC)).fecha_ultimo_control).toBe(ordenAntes.fecha_ultimo_control);
  const rpc = await page.evaluate(() => window.__CT10__.rpc.filter((r) => r.nombre === 'coi_confirmar_etapa_circuito_v3'));
  expect(rpc.at(-1).args.p_fecha_efectiva).toBe('2026-09-20');
});

test('T11 · F5: tras confirmar FINALIZADA la recarga reconstruye exactamente lo mismo', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'ejecucion', '2026-09-01');
  await F.confirmarHito(page, 'finalizada', '2026-09-20');
  const antes = await F.observable(page);
  await recargar(page);
  const despues = await F.observable(page);
  expect(despues).toEqual(antes);
  expect(despues.avance).toBe('2 / 10');
});

test('T12 · deep-link #ficha-oc/4530009514/contractual reconstruye el mismo estado que la navegación', async ({ page, browser }) => {
  const orden = conActa({ estado_coi: NOMBRE.finalizada, estado_documental: NOMBRE.finalizada });
  const historial = [...F.evento(orden, 'ejecucion', '2026-09-01T13:00:00.000Z', '2026-09-01'),
    ...F.evento(orden, 'finalizada', '2026-09-20T13:00:00.000Z', '2026-09-20')];
  await abrir(page, { ordenes: [orden], historial });
  expect(page.url()).toContain('#ficha-oc/' + OC + '/contractual');
  const porDeepLink = await F.observable(page);
  // Mismos datos, otra sesión, abriendo la Ficha por navegación interna.
  const ctx = await browser.newContext();
  const otra = await ctx.newPage();
  await F.prepararRemotoContractual(otra, { ahora: AHORA, ordenes: [orden], historial });
  await otra.goto('/index.html?h14_force_auth=1', { waitUntil: 'domcontentloaded' });
  await otra.waitForFunction(() => { try { return (window.todasLasOC() || []).length > 0; } catch (e) { return false; } }, null, { timeout: 25000 });
  await otra.evaluate((oc) => window.abrirFichaOC('OC-' + oc), OC);
  await otra.locator('#fichaOCBody #panelFichaContractual').waitFor({ state: 'attached', timeout: 15000 });
  await otra.evaluate(() => window.activarSubmoduloFichaOC('panelFichaContractual'));
  await otra.waitForSelector('#fichaOCBody #etapa1PipelineContractual', { timeout: 15000 });
  await F.esperarHistorialLeido(otra);
  const porNavegacion = await F.observable(otra);
  await ctx.close();
  expect(porNavegacion).toEqual(porDeepLink);
  expect(porDeepLink.avance).toBe('2 / 10');
  expect(tarjeta(porDeepLink, 'finalizada').meta).toBe('Fecha efectiva: 20/09/2026');
});

test('T13 · pestañas 1° → 2° → 1° → 2°: no se pierde estado ni historial', async ({ page }) => {
  const orden = conActa({ estado_coi: NOMBRE.finalizada, estado_documental: NOMBRE.finalizada });
  const historial = [...F.evento(orden, 'pliego_con_oc', '2026-08-20T13:00:00.000Z', '2026-08-20'),
    ...F.evento(orden, 'finalizada', '2026-09-20T13:00:00.000Z', '2026-09-20')];
  await abrir(page, { ordenes: [orden], historial });
  const base = await F.observable(page);
  for (const panel of ['etapa1Panel2', 'etapa1Panel1', 'etapa1Panel2']) {
    await page.locator('#fichaOCBody [data-etapa1-tab="' + panel + '"]').click();
    await expect(page.locator('#fichaOCBody #' + panel)).toHaveClass(/active/);
    expect(await F.observable(page)).toEqual(base);
  }
  // Una confirmación hecha desde la 2° Etapa repinta sin devolver a la 1°.
  await F.confirmarHito(page, 'finalizada');
  await expect(page.locator('#fichaOCBody #etapa1Panel2')).toHaveClass(/active/);
  expect(await F.observable(page)).toEqual(base);
});

test('T14 · REINGRESO: EJECUCIÓN → FINALIZADA → EJECUCIÓN sigue 2 / 10 con dos períodos', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'ejecucion', '2026-09-01');
  await F.confirmarHito(page, 'finalizada', '2026-09-10');
  await F.confirmarHito(page, 'ejecucion', '2026-09-20');
  const o = await F.observable(page);
  expect(o.avance).toBe('2 / 10');
  expect(o.estadoActual).toBe('SERVICIO EN EJECUCIÓN');
  // Días en estado desde el ÚLTIMO ingreso real (20/09), no desde el primero.
  expect(o.diasEstado).toBe('5');
  expect(tarjeta(o, 'ejecucion').meta).toBe('Fecha efectiva: 20/09/2026');
  expect(tarjeta(o, 'finalizada').dias).toBe('Días en estado: 10');
  expect(tarjeta(o, 'finalizada').clase).toBe('completado');
  const ingresos = await page.locator('#fichaOCBody [data-etapa1-hito="ejecucion"] .etapa1-ingresos').textContent();
  expect(ingresos).toContain('2');
  // Los dos períodos de ejecución quedan persistidos: no se sobrescribió el primero.
  const filas = await page.evaluate((oc) => window.__CT10__.historial(oc)
    .filter((h) => h.tipo_evento === 'Circuito administrativo' && h.campo_modificado === 'ejecucion')
    .map((h) => h.fecha_efectiva).sort(), OC);
  expect(filas).toEqual(['2026-09-01', '2026-09-20']);
});

test('T15 · OC con SOLO nro_oc (sin numeroOC ni oc) recupera todo el historial', async ({ page }) => {
  const orden = conActa({ estado_coi: NOMBRE.finalizada, estado_documental: NOMBRE.finalizada });
  const historial = [...F.evento(orden, 'ejecucion', '2026-09-01T13:00:00.000Z', '2026-09-01'),
    ...F.evento(orden, 'finalizada', '2026-09-20T13:00:00.000Z', '2026-09-20')];
  await abrir(page, { ordenes: [orden], historial });
  const r = await page.evaluate(async (oc) => {
    const soloNro = { nro_oc: oc, tipo: 'Servicio', estado_documental: 'OBRA/SERVICIO FINALIZADA', fecha_acta_inicio: '2026-02-23' };
    const claves = {
      nroOC: window.nroOCCircuito(soloNro),
      raw: window.nroOCCircuito({ _supabaseRaw: { nro_oc: oc } }),
      item: window.nroOCCircuito({ item: { nro_oc: oc } })
    };
    window.__COI_INVALIDAR_HISTORIAL_CIRCUITO__();
    const lecturasAntes = window.__CT10__.lecturas.coi_historial_oc.length;
    const filas = await window.cargarHistorialCircuitoOC(soloNro);
    const lecturas = window.__CT10__.lecturas.coi_historial_oc.slice(lecturasAntes);
    const wrap = document.createElement('div');
    wrap.innerHTML = window.__COI_ETAPA1_RENDER__(soloNro);
    return {
      claves, filas: filas.length, lecturas,
      avance: wrap.querySelector('#etapa1Avance').textContent,
      oc: wrap.querySelector('#etapa1PipelineContractual').getAttribute('data-etapa1-oc'),
      meta: wrap.querySelector('[data-etapa1-hito="finalizada"] .etapa1-meta').textContent,
      todasLasLecturas: window.__CT10__.lecturas.coi_historial_oc
    };
  }, OC);
  expect(r.claves).toEqual({ nroOC: OC, raw: OC, item: OC });
  expect(r.filas).toBe(4);
  expect(r.lecturas).toEqual([[{ col: 'nro_oc', val: OC }]]);
  expect(r.oc).toBe(OC);
  expect(r.avance).toBe('2 / 10');
  expect(r.meta).toBe('Fecha efectiva: 20/09/2026');
  // Ninguna lectura del historial se hizo jamás con una clave vacía u otra OC.
  expect(r.todasLasLecturas.every((f) => f.length === 1 && f[0].col === 'nro_oc' && f[0].val === OC)).toBe(true);
});

test('T16 · caso real 4530009514: FINALIZADA sin H1–H8 muestra 1 / 10 y la fecha efectiva en H10', async ({ page }) => {
  const orden = F.ordenBase({ estado_coi: NOMBRE.finalizada, estado_documental: NOMBRE.finalizada, fecha_ultimo_control: '2026-09-25T12:00:00.000Z' });
  const historial = F.evento(orden, 'finalizada', '2026-09-25T12:00:00.000Z', '2026-09-25', { anterior: 'PLIEGOS EN PREPARACIÓN' });
  await abrir(page, { ordenes: [orden], historial });
  const inicial = await F.observable(page);
  expect(inicial.avance).toBe('1 / 10');
  expect(inicial.estadoActual).toBe('SERVICIO FINALIZADO');
  expect(inicial.ultimaAct).not.toBe('—');
  expect(inicial.diasEstado).toBe('0');
  expect(tarjeta(inicial, 'finalizada').meta).toBe('Fecha efectiva: 25/09/2026');
  for (const codigo of H.slice(0, 8)) expect(tarjeta(inicial, codigo).meta).toBe('Sin confirmación registrada');
  await expect(page.locator('#fichaOCBody #etapa1EstadoEtapa1')).toContainText('evidencia histórica');
  // La secuencia del reporte: reconfirmar el mismo hito.
  await F.confirmarHito(page, 'finalizada');
  expect(await F.observable(page)).toEqual(inicial);
  await recargar(page);
  expect(await F.observable(page)).toEqual(inicial);
});

test('T17 · confirmar H10 tres veces sin cambios sigue 1 / 10', async ({ page }) => {
  await abrir(page, { ordenes: [conActa()] });
  await F.confirmarHito(page, 'finalizada', '2026-09-21');
  const primera = await F.observable(page);
  await F.confirmarHito(page, 'finalizada');
  await F.confirmarHito(page, 'finalizada');
  const o = await F.observable(page);
  expect(o).toEqual(primera);
  expect(o.avance).toBe('1 / 10');
  expect(await canonicas(page, 'finalizada')).toBe(1);
});

test('T18 · duraciones con saltos: H4 9 días, H9 10 días, H5–H8 sin duración', async ({ page }) => {
  const orden = conActa({ estado_coi: NOMBRE.finalizada, estado_documental: NOMBRE.finalizada });
  const historial = [...F.evento(orden, 'pliego_con_oc', '2026-09-01T13:00:00.000Z', '2026-09-01'),
    ...F.evento(orden, 'ejecucion', '2026-09-10T13:00:00.000Z', '2026-09-10'),
    ...F.evento(orden, 'finalizada', '2026-09-20T13:00:00.000Z', '2026-09-20')];
  await abrir(page, { ordenes: [orden], historial });
  const o = await F.observable(page);
  expect(o.avance).toBe('3 / 10');
  expect(tarjeta(o, 'pliego_con_oc').dias).toBe('Días en etapa: 9');
  expect(tarjeta(o, 'ejecucion').dias).toBe('Días en estado: 10');
  expect(tarjeta(o, 'finalizada').dias).toBe('Días en estado: 5');
  expect(o.diasEstado).toBe('5');
  for (const codigo of ['pliego_con_expediente', 'oc_sin_control_terceros', 'control_terceros_sin_acta', 'control_terceros_con_acta']) {
    expect(tarjeta(o, codigo).dias).toBe('Días en etapa: —');
  }
  expect(o.aviso).toBe('Existen hitos intermedios sin registrar.');
});
