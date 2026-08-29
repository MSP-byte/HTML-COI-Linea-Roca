const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function bloque(desde, hasta) {
  const a = SOURCE.indexOf(desde);
  if (a < 0) throw new Error(`Bloque no encontrado: ${desde}`);
  const b = SOURCE.indexOf(hasta, a);
  if (b < 0) throw new Error(`Fin de bloque no encontrado: ${hasta}`);
  return SOURCE.slice(a, b);
}
const contar = (texto, aguja) => texto.split(aguja).length - 1;

// ============ KPI ESTACIONES DEL INICIO OPERATIVO ============

// Catálogo ferroviario aprobado: 105 entradas brutas en el array base `estaciones`,
// 104 estaciones únicas tras normalizar (único duplicado: Villa España).
const ESTACIONES_RED_ROCA = 104;

// Nombres que no pertenecen al catálogo ferroviario, inyectados por la ruta de
// importación de loadImportedData() (override V45), que hace estaciones.push()
// con lo que encuentre en localStorage y corre antes de reconstruir el catálogo maestro.
const LS_IMPORTACION = 'roca_coi_intervenciones_v10';
const CONTAMINACION = [
  { nombre: 'ESTACION FICTICIA TEST A', ramal: 'Ramal inexistente', obras: [], servicios: [] },
  { nombre: 'ESTACION FICTICIA TEST B', ramal: 'Ramal inexistente', obras: [], servicios: [] }
];

// Lee el resumen operativo secundario completo, para comprobar también que el
// resto de los KPI no se mueve.
const LEER_RESUMEN = () => {
  const fold = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const chips = [...document.querySelectorAll('#d33Secondary .d33-chip')].map(c => ({
    label: c.querySelector('span')?.textContent || '',
    valor: c.querySelector('b')?.textContent || ''
  }));
  const estaciones = chips.find(c => fold(c.label) === 'ESTACIONES');
  return {
    chips,
    estaciones: Number(estaciones?.valor),
    // Snapshot canónico construido en parseo: fuente primaria del KPI.
    snapshotCanonico: (typeof catalogoEstaciones !== 'undefined' && Array.isArray(catalogoEstaciones))
      ? new Set(catalogoEstaciones.map(e => fold(e && e.nombre)).filter(Boolean)).size
      : null,
    // El catálogo maestro sí se contamina: se comprueba que el KPI no lo sigue.
    maestroTotal: (window.CATALOGO_MAESTRO_ESTACIONES || []).length,
    maestroConHotspot: (window.CATALOGO_MAESTRO_ESTACIONES || []).filter(e => e.tieneHotspot).length,
    rankingTexto: document.getElementById('d33Ranking')?.textContent || '',
    rankingFilas: document.querySelectorAll('#d33Ranking .d33-rank-row').length
  };
};

async function abrirInicioOperativo(page, contaminar) {
  const errores = [];
  page.on('pageerror', e => errores.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });
  if (contaminar) {
    await page.addInitScript(
      ([clave, datos]) => localStorage.setItem(clave, JSON.stringify(datos)),
      [LS_IMPORTACION, CONTAMINACION]
    );
  }
  await page.goto('/index.html');
  await page.waitForFunction(
    () => document.querySelectorAll('#d33Secondary .d33-chip').length > 0,
    null,
    { timeout: 20000 }
  );
  await page.waitForTimeout(1200);
  return { resumen: await page.evaluate(LEER_RESUMEN), errores };
}

test('el KPI Estaciones se calcula desde el catálogo canónico de parseo, no desde las OC', () => {
  const helper = bloque('function totalEstacionesRedRoca()', 'function renderSecondary(');
  // Fuente primaria: snapshot inmutable construido en parseo.
  expect(helper).toContain('typeof catalogoEstaciones');
  expect(helper).toContain('if(snapshot.length)return contar(snapshot)');
  // Fallback defensivo: catálogo maestro, solo estaciones del plano.
  expect(helper).toContain('window.CATALOGO_MAESTRO_ESTACIONES');
  expect(helper).toContain('maestro.filter(e=>e&&e.tieneHotspot)');
  // Se reutiliza el helper de conteo ya existente.
  expect(helper).toContain('window.contarEstacionesUnicas');
  // Fuentes prohibidas: OC, estaciones mutables de runtime y cantidades fijas.
  expect(helper).not.toContain('records');
  expect(helper).not.toContain('r.stations');
  expect(helper).not.toContain('localStorage');
  expect(helper).not.toMatch(/104/);

  const secundario = bloque('function renderSecondary(', 'function renderRanking(');
  expect(secundario).toContain('const stationCount=totalEstacionesRedRoca()');
  expect(secundario).not.toContain('unique(records.flatMap(r=>[...r.stations])).length');
});

test('el ranking por actividad sigue basándose en las OC y no en el catálogo', () => {
  const ranking = bloque('function renderRanking(', 'function showView(');
  expect(ranking).toContain('records.forEach(r=>r.stations.forEach(s=>counts.set(s,(counts.get(s)||0)+1)))');
  expect(ranking).not.toContain('totalEstacionesRedRoca');
});

test('ESCENARIO A — sin localStorage el KPI muestra el total real de la Red Línea Roca', async ({ page }) => {
  const { resumen, errores } = await abrirInicioOperativo(page, false);

  expect(resumen.snapshotCanonico).toBe(ESTACIONES_RED_ROCA);
  expect(resumen.estaciones).toBe(ESTACIONES_RED_ROCA);
  expect(errores).toEqual([]);
});

test('ESCENARIO B — la contaminación de localStorage no altera el KPI Estaciones', async ({ page }) => {
  const { resumen, errores } = await abrirInicioOperativo(page, true);

  // Desde PR-H01 (COI-AUD-002) la ruta legacy ya no consume la clave, así que la
  // contaminación tampoco llega al catálogo maestro. El KPI conserva además su propia
  // defensa: se alimenta del snapshot de parseo, no del maestro.
  expect(resumen.maestroTotal).toBe(ESTACIONES_RED_ROCA + 1); // + el bucket técnico "Sin definir"
  // El snapshot de parseo y el criterio del plano se mantienen intactos.
  expect(resumen.snapshotCanonico).toBe(ESTACIONES_RED_ROCA);
  expect(resumen.maestroConHotspot).toBe(ESTACIONES_RED_ROCA);
  // Y el KPI también.
  expect(resumen.estaciones).toBe(ESTACIONES_RED_ROCA);
  expect(errores).toEqual([]);
});

test('la contaminación de localStorage no mueve ningún KPI del resumen operativo secundario', async ({ browser }) => {
  test.slow(); // compara dos arranques completos de la aplicación en un mismo test
  const limpio = await browser.newPage();
  const a = await abrirInicioOperativo(limpio, false);
  await limpio.close();

  const contaminado = await browser.newPage();
  const b = await abrirInicioOperativo(contaminado, true);
  await contaminado.close();

  expect(a.resumen.chips.length).toBeGreaterThan(0);
  // Ni el de Estaciones ni ninguno de los demás indicadores cambia.
  expect(b.resumen.chips).toEqual(a.resumen.chips);
  // El ranking sigue alimentado por las OC (no por el catálogo ferroviario).
  expect(b.resumen.rankingFilas).toBe(a.resumen.rankingFilas);
  expect(b.resumen.rankingFilas).toBeLessThan(ESTACIONES_RED_ROCA);
  expect(b.resumen.rankingTexto).toBe(a.resumen.rankingTexto);
  expect(a.errores).toEqual([]);
  expect(b.errores).toEqual([]);
});

// ============ TABLA DE ÓRDENES DE COMPRA ============

const THEAD_UM = '<th class="col-um">UM vinculada</th>';

test('ningún encabezado de la tabla de OC declara UM vinculada', () => {
  expect(SOURCE).not.toContain(THEAD_UM);
  expect(SOURCE).not.toContain('<th>UM vinculada</th>');
});

test('los renderizadores activos de la tabla de OC mantienen encabezados y celdas alineados', () => {
  const renderizadores = [
    bloque('function renderOrdenesV581R()', 'function exportarOrdenesCSVV581R()'),
    bloque('function renderOrdersFinal()', 'function scheduleOrders()')
  ];
  for (const render of renderizadores) {
    const thead = render.slice(render.indexOf('<tr><th class="col-sel">'), render.indexOf('</tr>'));
    const inicioFila = render.indexOf('<tr class="ordenes-row-clickable');
    const fila = render.slice(inicioFila, render.indexOf('</tr>', inicioFila));
    expect(contar(thead, '<th')).toBe(14);
    expect(contar(fila, '<td')).toBe(14);
    expect(render).not.toContain('col-um');
    // La fila de "sin resultados" cubre exactamente las columnas visibles.
    expect(render).toContain('<td colspan="14">Sin resultados para los filtros seleccionados.</td>');
    expect(render).not.toContain('<td colspan="15">');
  }
});

test('el dato UM se conserva en el modelo, el filtro y la exportación CSV', () => {
  expect(SOURCE).toContain('<label for="ordenesFiltroUM">UM vinculada</label>');
  expect(SOURCE).toContain("opt('ordenesFiltroUM',base.map(r=>r.um),'UM vinculada')");
  // La exportación CSV sigue publicando la columna aunque la tabla no la muestre.
  const csv = bloque('function exportarOrdenesCSVV581R()', 'function ensureAdminUM()');
  expect(csv).toContain("'UM vinculada'");
  expect(csv).toContain('r.umVinculada||i.umVinculada||i.unidadMantenimiento');
  // El filtro por UM sigue aplicándose sobre los datos.
  expect(SOURCE).toContain('(!um||fold(umv)===um)');
});

test('la tabla de OC se renderiza sin la columna UM vinculada y sin errores', async ({ page }) => {
  const errores = [];
  page.on('pageerror', e => errores.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });

  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.renderOrdenes === 'function', null, { timeout: 20000 });
  await page.evaluate(() => window.mostrarVista && window.mostrarVista('vistaOrdenes'));

  // Enriquecedores posteriores reescriben el encabezado en timers (1300 ms y 4200 ms),
  // agregando columnas analíticas transitorias. Se espera a que el encabezado quede
  // estable en lugar de dormir un tiempo fijo, que produce lecturas intermedias.
  await page.waitForFunction(() => {
    const t = document.querySelector('#vistaOrdenes table.ordenes-table');
    if (!t || !t.tHead) return false;
    const firma = [...t.tHead.querySelectorAll('th')].map(th => th.textContent.trim()).join('|');
    const estado = window.__coiTestThead || { firma: null, estables: 0 };
    estado.estables = estado.firma === firma ? estado.estables + 1 : 0;
    estado.firma = firma;
    window.__coiTestThead = estado;
    return performance.now() > 6000 && estado.estables >= 3;
  }, null, { timeout: 30000, polling: 500 });

  const tabla = await page.evaluate(() => {
    const t = document.querySelector('#vistaOrdenes table.ordenes-table');
    const headers = [...t.tHead.querySelectorAll('th')].map(th => th.textContent.trim());
    const fila = [...(t.tBodies[0]?.rows || [])].find(r => r.cells.length > 1);
    return {
      headers,
      celdas: fila ? fila.cells.length : null,
      hayColUm: !!t.querySelector('.col-um'),
      filtroUM: !!document.getElementById('ordenesFiltroUM'),
      tbody: !!document.getElementById('ordenesTbody')
    };
  });

  // Invariantes reales del cambio. El conteo exacto de columnas del renderizador
  // se verifica de forma estable en el test estático; acá no se fija porque los
  // enriquecedores pueden sumar columnas analíticas propias.
  expect(tabla.headers).not.toContain('UM vinculada');
  expect(tabla.headers).toContain('Tipo de trabajo');
  expect(tabla.headers).toContain('Sector');
  expect(tabla.hayColUm).toBe(false);
  expect(tabla.headers.length).toBeGreaterThanOrEqual(14);
  // El filtro por UM sigue disponible: se quitó la columna, no la funcionalidad.
  expect(tabla.filtroUM).toBe(true);
  expect(tabla.tbody).toBe(true);
  // Encabezados y celdas alineados.
  if (tabla.celdas !== null) expect(tabla.celdas).toBe(tabla.headers.length);
  expect(errores).toEqual([]);
});
