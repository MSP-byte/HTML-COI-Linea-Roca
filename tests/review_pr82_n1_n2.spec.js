const { test, expect } = require('@playwright/test');

/* Últimos dos findings del review del PR #82.

   N2 · resumenAlertasCOI() clasificaba por el TEXTO mostrado
        ('Certificación próxima'), así que la variante tentativa —que es el
        camino habitual de la proyección canónica— quedaba visible en la lista
        de alertas pero fuera del conteo. Ahora la CLASE es la identidad
        semántica y la ETIQUETA sólo se muestra.

   N1 · reconstruirIndicesUltima() colapsaba por N° de OC. Dos órdenes
        distintas que comparten un nro_oc denormalizado se fusionaban y la
        perdedora quedaba sin índice propio, antes de que su UUID llegara
        siquiera a existir como alias.

   Las alertas se piden por window.generarAlertasCOI(), que es la cadena
   completa de wrappers: lo que se afirma es lo que consume la interfaz.

   El cliente Supabase no se usa: estas pruebas no escriben datos remotos. */

test.describe.configure({ timeout: 60_000 });

const OC = '4530777001';
const OC_LIBRE = '4530777009';
const UUID_A = 'aaaa7770-7777-4777-8777-777777777771';
const UUID_B = 'bbbb7770-7777-4777-8777-777777777772';
const UUID_C = 'cccc7770-7777-4777-8777-777777777773';

/* Se espera a que la proyección canónica esté instalada ANTES de sembrar: su
   IIFE la asigna una sola vez, y sembrar antes de eso hacía que el módulo real
   pisara el doble y la alerta no se generara. */
const LISTO_ALERTAS = () => typeof window.__COI_PROXIMA_CERT_INFO__ === 'function'
  && typeof window.generarAlertasCOI === 'function'
  && typeof window.resumenAlertasCOI === 'function';

const LISTO_HISTORIAL = () => Boolean(window.__COI_CERT_HISTORIAL__
  && window.__COI_CERT_HISTORIAL__.consolidar);

async function abrirApp(page, listo) {
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.goto('/index.html', { waitUntil: 'load' });
  await page.waitForFunction(listo, null, { timeout: 25000 });
}

/* ------------------------------------------------------------------ N2 */

/* Siembra UNA OC y fija la proyección canónica, que es el contrato real entre
   el módulo de certificaciones y el motor de alertas. */
function sembrarAlertas(page, cfg) {
  return page.evaluate((c) => {
    const isoDesdeHoy = (dias) => {
      const d = new Date();
      d.setDate(d.getDate() + dias);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0');
    };
    const venc = isoDesdeHoy(200);
    const item = {
      id: c.oc, nro_oc: c.oc, numeroOC: c.oc, oc: c.oc,
      idObra: 'OBRA-' + c.oc, idOC: 'OBRA-' + c.oc,
      tipo: c.tipoReg, proveedor: 'CONTRATISTA N2', estacion: 'Plaza Constitución',
      descripcion: 'Trabajo N2', tipoTrabajo: 'Trabajo N2',
      estadoCOI: 'OBRA/SERVICIO EN EJECUCIÓN', estado: 'OBRA/SERVICIO EN EJECUCIÓN',
      estadoDocumental: 'PLIEGO CON EXPTE',
      fechaActaInicio: c.conActa ? '2026-01-31' : '',
      actaInicio: c.conActa ? '2026-01-31' : '',
      plazoDias: 90, fechaVencimiento: venc, vencimiento: venc
    };
    /* Los normalizadores de arranque MUTAN los items que reciben —recalculan
       el vencimiento desde acta + plazo, por ejemplo—, y la cadena de wrappers
       llama a todasLasOC() varias veces. Reusar el mismo objeto hacía que la
       OC quedara vencida a mitad de camino y que un wrapper descartara la
       alerta de certificación. El catálogo real se reconstruye en cada lectura;
       acá también se entrega una copia fresca. */
    window.todasLasOC = () => [{
      estacion: 'Plaza Constitución', item: JSON.parse(JSON.stringify(item)),
      idObra: 'OBRA-' + c.oc,
      numeroOC: c.oc, tipo: c.tipoReg, proveedor: 'CONTRATISTA N2',
      proximaCertificacion: ''
    }];
    /* La proyección canónica resuelve SIEMPRE: devolver fecha null significa
       "resolvió que no hay próxima", no "no pudo resolver". */
    window.__COI_PROXIMA_CERT_INFO__ = () => (c.hayProx
      ? { fecha: isoDesdeHoy(c.diasProx), origen: c.tentativa ? 'calculada' : 'persistida', tentativa: c.tentativa }
      : { fecha: null, origen: '', tentativa: false });

    const alertas = window.generarAlertasCOI();
    const resumen = window.resumenAlertasCOI(alertas);
    return {
      etiquetas: alertas.map(a => a.tipoAlerta),
      clases: alertas.map(a => a.claseAlerta || null),
      ids: alertas.map(a => a.id),
      total: alertas.length,
      certProx: resumen.certProx,
      vencidas: resumen.vencidas,
      // Cuántas alertas llegan SIN clase: prueban el fallback a la etiqueta.
      sinClase: alertas.filter(a => !a.claseAlerta).length
    };
  }, cfg);
}

/* Base en Servicio: el guard V62 de certificaciones aplica a Obras y tiene su
   propio caso (N2-7). */
const BASE = { oc: OC, diasProx: 5, hayProx: true, tentativa: false, conActa: true, tipoReg: 'Servicio' };

test('N2-1 · la alerta tentativa queda visible con su propia etiqueta', async ({ page }) => {
  await abrirApp(page, LISTO_ALERTAS);
  const r = await sembrarAlertas(page, Object.assign({}, BASE, { tentativa: true }));
  // El texto que la interfaz imprime para el operador se conserva.
  expect(r.etiquetas).toContain('Certificación tentativa próxima');
  expect(r.etiquetas).not.toContain('Certificación próxima');
});

test('N2-2 · el KPI cuenta la certificación tentativa', async ({ page }) => {
  await abrirApp(page, LISTO_ALERTAS);
  const r = await sembrarAlertas(page, Object.assign({}, BASE, { tentativa: true }));
  expect(r.certProx).toBe(1);

  // Y la que se cuenta es exactamente la que se ve, no otra.
  const i = r.etiquetas.indexOf('Certificación tentativa próxima');
  expect(i).toBeGreaterThanOrEqual(0);
  expect(r.clases[i]).toBe('Certificación próxima');
});

test('N2-3 · la certificación próxima firme sigue contando igual', async ({ page }) => {
  await abrirApp(page, LISTO_ALERTAS);
  const r = await sembrarAlertas(page, Object.assign({}, BASE, { tentativa: false }));
  expect(r.etiquetas).toContain('Certificación próxima');
  expect(r.etiquetas).not.toContain('Certificación tentativa próxima');
  expect(r.certProx).toBe(1);
});

test('N2-4 · otros tipos de alerta no incrementan certProx', async ({ page }) => {
  await abrirApp(page, LISTO_ALERTAS);
  // Sin próxima certificación y sin Acta de Inicio: hay alertas, ninguna de certificación.
  const r = await sembrarAlertas(page, Object.assign({}, BASE, { hayProx: false, conActa: false }));
  expect(r.total).toBeGreaterThan(0);
  expect(r.certProx).toBe(0);
  expect(r.etiquetas.join(' | ')).not.toContain('Certificación');
});

test('N2-5 · la clase es semántica y la etiqueta es de presentación', async ({ page }) => {
  await abrirApp(page, LISTO_ALERTAS);
  const tent = await sembrarAlertas(page, Object.assign({}, BASE, { tentativa: true }));
  const firme = await sembrarAlertas(page, Object.assign({}, BASE, { tentativa: false }));

  const iT = tent.etiquetas.indexOf('Certificación tentativa próxima');
  const iF = firme.etiquetas.indexOf('Certificación próxima');
  expect(iT).toBeGreaterThanOrEqual(0);
  expect(iF).toBeGreaterThanOrEqual(0);

  // Dos etiquetas distintas, una sola clase.
  expect(tent.clases[iT]).toBe('Certificación próxima');
  expect(firme.clases[iF]).toBe('Certificación próxima');
  // Por eso el id es estable: lo marcado como revisado no se pierde al firmarse.
  expect(tent.ids[iT]).toBe(firme.ids[iF]);
});

test('N2-6 · las alertas sin clase siguen contando por su etiqueta', async ({ page }) => {
  await abrirApp(page, LISTO_ALERTAS);
  const r = await sembrarAlertas(page, Object.assign({}, BASE, { tentativa: true }));
  /* Los wrappers arman alertas propias sin pasar por crearAlerta(): no traen
     clase y el conteo tiene que seguir funcionando igual que antes. */
  expect(r.sinClase).toBeGreaterThan(0);
  expect(r.vencidas).toBe(0);
  expect(r.certProx).toBe(1);
});

test('N2-7 · la etiqueta tentativa no elude el guard de Obras sin fuente real', async ({ page }) => {
  await abrirApp(page, LISTO_ALERTAS);
  /* V62 suprime las alertas de certificación de una Obra que no tiene fuente
     real ni próxima manual, para no empujar al operador con un número
     inventado. Ese guard se evalúa por CLASE: cambiar el texto mostrado no
     puede alcanzar para esquivarlo. */
  const tent = await sembrarAlertas(page, Object.assign({}, BASE, { tipoReg: 'Obra', tentativa: true }));
  const firme = await sembrarAlertas(page, Object.assign({}, BASE, { tipoReg: 'Obra', tentativa: false }));

  expect(tent.etiquetas).not.toContain('Certificación tentativa próxima');
  expect(firme.etiquetas).not.toContain('Certificación próxima');
  // Las dos variantes se comportan igual, que es lo que el guard supone.
  expect(tent.certProx).toBe(0);
  expect(firme.certProx).toBe(0);
});

/* ------------------------------------------------------------------ N1 */

const FILA = (o) => Object.assign({
  id: 'r-' + Math.random().toString(36).slice(2),
  orden_id: null, nro_oc: OC, acta_medicion_nro: 'AM-X',
  fecha_inicio: '2026-01-01', fecha_fin: '2026-01-31',
  posicion: 'POS-1', item_nro: '1', nro_hes: '', nro_if: '',
  proveedor: 'CONTRATISTA N1', aux_porcentaje: 10, anio: 2026,
  fecha_actualizacion: '2026-02-01T10:00:00Z'
}, o);

function consolidarYBuscar(page, filas, claves) {
  return page.evaluate(({ filas, claves }) => {
    window.todasLasOC = () => [];
    const h = window.__COI_CERT_HISTORIAL__;
    const grupos = h.consolidar(filas);
    const out = { grupos: grupos.length, fechas: {}, actas: {} };
    claves.forEach((k) => {
      out.fechas[k] = h.ultimaPorOC(k);
      const d = h.ultimaDetallePorOC(k);
      out.actas[k] = d ? d.acta : null;
    });
    return out;
  }, { filas, claves });
}

/* Dos órdenes reales distintas que comparten el número denormalizado: la
   certificación vieja de A conservó el nro_oc que después se reasignó a B. */
const DOS_ORDENES = [
  FILA({ orden_id: UUID_A, nro_oc: OC, acta_medicion_nro: 'AM-A', fecha_inicio: '2026-03-01', fecha_fin: '2026-03-31', fecha_actualizacion: '2026-04-01T10:00:00Z' }),
  FILA({ orden_id: UUID_B, nro_oc: OC, acta_medicion_nro: 'AM-B', fecha_inicio: '2026-08-01', fecha_fin: '2026-08-31', fecha_actualizacion: '2026-09-01T10:00:00Z' })
];

test('N1-1 · dos órdenes con el mismo nro_oc conservan cada una su certificación', async ({ page }) => {
  await abrirApp(page, LISTO_HISTORIAL);
  const r = await consolidarYBuscar(page, DOS_ORDENES, [UUID_A, UUID_B]);
  expect(r.grupos).toBe(2);
  // La orden "perdedora" ya no queda sin índice propio.
  expect(r.fechas[UUID_A]).toBe('2026-03-31');
  expect(r.fechas[UUID_B]).toBe('2026-08-31');
});

test('N1-2 · el lookup por UUID devuelve el acta de su propia orden', async ({ page }) => {
  await abrirApp(page, LISTO_HISTORIAL);
  const r = await consolidarYBuscar(page, DOS_ORDENES, [UUID_A, UUID_B]);
  expect(r.actas[UUID_A]).toBe('AM-A');
  expect(r.actas[UUID_B]).toBe('AM-B');
});

test('N1-3 · el nro_oc compartido resuelve a la certificación más reciente', async ({ page }) => {
  await abrirApp(page, LISTO_HISTORIAL);
  const r = await consolidarYBuscar(page, DOS_ORDENES, [OC]);
  // Determinista y sin cambio de criterio: gana la más reciente.
  expect(r.fechas[OC]).toBe('2026-08-31');
  expect(r.actas[OC]).toBe('AM-B');
});

test('N1-4 · sin conflicto, el lookup por nro_oc sigue funcionando', async ({ page }) => {
  await abrirApp(page, LISTO_HISTORIAL);
  const filas = [
    FILA({ orden_id: UUID_C, nro_oc: OC_LIBRE, acta_medicion_nro: 'AM-C', fecha_inicio: '2026-05-01', fecha_fin: '2026-05-31' })
  ];
  const r = await consolidarYBuscar(page, filas, [OC_LIBRE, UUID_C]);
  expect(r.fechas[OC_LIBRE]).toBe('2026-05-31');
  expect(r.actas[OC_LIBRE]).toBe('AM-C');
  // Y el alias por UUID sigue disponible.
  expect(r.fechas[UUID_C]).toBe('2026-05-31');
});

test('N1-5 · una certificación sin nro_oc queda indexada por su UUID', async ({ page }) => {
  await abrirApp(page, LISTO_HISTORIAL);
  const filas = [
    FILA({ orden_id: UUID_C, nro_oc: '', acta_medicion_nro: 'AM-D', fecha_inicio: '2026-06-01', fecha_fin: '2026-06-30' })
  ];
  const r = await consolidarYBuscar(page, filas, [UUID_C]);
  // Antes se descartaba por no tener número y la OC se proyectaba desde el acta.
  expect(r.fechas[UUID_C]).toBe('2026-06-30');
  expect(r.actas[UUID_C]).toBe('AM-D');
});

test('N1-6 · varias actas de la MISMA orden siguen colapsando en la más reciente', async ({ page }) => {
  await abrirApp(page, LISTO_HISTORIAL);
  const filas = [
    FILA({ orden_id: UUID_A, nro_oc: OC, acta_medicion_nro: 'AM-1', fecha_inicio: '2026-02-01', fecha_fin: '2026-02-28' }),
    FILA({ orden_id: UUID_A, nro_oc: OC, acta_medicion_nro: 'AM-2', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-31' })
  ];
  const r = await consolidarYBuscar(page, filas, [UUID_A, OC]);
  expect(r.fechas[UUID_A]).toBe('2026-07-31');
  expect(r.fechas[OC]).toBe('2026-07-31');
  expect(r.actas[UUID_A]).toBe('AM-2');
});
