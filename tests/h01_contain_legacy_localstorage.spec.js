const { test, expect } = require('@playwright/test');

/*
  PR-H01 · COI-AUD-002
  El override V45 de loadImportedData() sustituye por completo a la funcion base y por eso
  nunca evaluaba su guard Supabase-first: una version legacy podia leer
  roca_coi_intervenciones_v10 y hacer estaciones.push() sobre el catalogo ferroviario,
  contaminando el catalogo maestro, los filtros y la Red Linea Roca.

  H11 elimina todo acceso runtime a localStorage. Estos tests conservan un escenario hostil:
  inyectan dos estaciones ficticias en una clave localStorage legacy ANTES del arranque y
  verifican que la aplicacion online-only no las consume, no las migra y no las altera.
*/

const LS_IMPORTACION = 'roca_coi_intervenciones_v10';
const FICTICIA_A = 'ESTACION FICTICIA H01 A';
const FICTICIA_B = 'ESTACION FICTICIA H01 B';
const CONTAMINACION = [
  { nombre: FICTICIA_A, ramal: 'Ramal inexistente H01', obras: [], servicios: [] },
  { nombre: FICTICIA_B, ramal: 'Ramal inexistente H01', obras: [], servicios: [] }
];

// Radiografia de todas las estructuras que la ruta legacy podia contaminar.
const SONDA = () => {
  const fold = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const base = (typeof estaciones !== 'undefined' && Array.isArray(estaciones)) ? estaciones : [];
  const maestro = window.CATALOGO_MAESTRO_ESTACIONES || [];
  const snapshot = (typeof catalogoEstaciones !== 'undefined' && Array.isArray(catalogoEstaciones)) ? catalogoEstaciones : [];
  const unicas = (arr) => new Set(arr.map((e) => fold(e && e.nombre)).filter(Boolean)).size;

  // Todas las opciones de todos los <select> de la pagina, ya renderizados.
  const opciones = [...document.querySelectorAll('select option')]
    .map((o) => `${o.value} ${o.textContent}`);

  // Hotspots dibujados sobre el plano de la Red.
  const hotspots = [...document.querySelectorAll('#hotspots .station-hotspot')];

  return {
    baseEntradas: base.length,
    baseNombres: base.map((e) => fold(e && e.nombre)),
    maestroTotal: maestro.length,
    maestroNombres: maestro.map((e) => fold(e && e.nombre)),
    snapshotUnicas: unicas(snapshot),
    canonicas: new Set(
      maestro.map((e) => fold(e && e.nombre)).filter((n) => n && n !== 'SIN DEFINIR')
    ).size,
    opcionesConFicticia: opciones.filter((t) => fold(t).includes('FICTICIA')),
    hotspotsTotal: hotspots.length,
    hotspotsConFicticia: hotspots
      .map((h) => fold(h.dataset.nombre))
      .filter((n) => n.includes('FICTICIA')),
    // Residuo de una instalacion vieja: H11 debe ignorarlo y dejarlo intacto.
    claveLegacy: (() => {
      try {
        const crudo = localStorage.getItem(LS_IMPORTACION);
        if (crudo === null) return 'AUSENTE';
        const raw = JSON.parse(crudo);
        return Array.isArray(raw) ? `ENTRADAS:${raw.length}` : 'NO_ARRAY';
      } catch (e) { return 'ILEGIBLE'; }
    })(),
    sourceOfTruth: window.__COI_SUPABASE_SOURCE_OF_TRUTH__
  };
};

async function arrancar(page, { contaminar }) {
  const errores = [];
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });

  if (contaminar) {
    await page.addInitScript(
      ([clave, datos]) => localStorage.setItem(clave, JSON.stringify(datos)),
      [LS_IMPORTACION, CONTAMINACION]
    );
  }

  await page.goto('/index.html');
  // El catalogo maestro se reconstruye dentro de init(), justo despues de loadImportedData().
  await page.waitForFunction(
    () => Array.isArray(window.CATALOGO_MAESTRO_ESTACIONES) && window.CATALOGO_MAESTRO_ESTACIONES.length > 0,
    null,
    { timeout: 20000 }
  );
  // Se recorren Red y Ordenes para que sus selectores y hotspots queden renderizados.
  await page.evaluate(() => window.mostrarVista && window.mostrarVista('vistaRed'));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.mostrarVista && window.mostrarVista('vistaOrdenes'));
  await page.waitForTimeout(1200);

  return { sonda: await page.evaluate(SONDA), errores };
}

test('la clave localStorage legacy no inyecta estaciones en modo online-only', async ({ page }) => {
  const { sonda, errores } = await arrancar(page, { contaminar: true });

  expect(sonda.sourceOfTruth).toBe(true);

  expect(sonda.baseNombres).not.toContain(FICTICIA_A);
  expect(sonda.baseNombres).not.toContain(FICTICIA_B);
  expect(sonda.maestroNombres).not.toContain(FICTICIA_A);
  expect(sonda.maestroNombres).not.toContain(FICTICIA_B);
  expect(sonda.opcionesConFicticia).toEqual([]);
  expect(sonda.hotspotsConFicticia).toEqual([]);

  // H11 no lee, migra ni borra residuos persistentes de versiones anteriores.
  expect(sonda.claveLegacy).toBe('ENTRADAS:2');
  expect(errores).toEqual([]);
});

test('el total canonico de estaciones no cambia ante contaminacion localStorage legacy', async ({ browser }) => {
  test.slow();

  const limpioPage = await browser.newPage();
  const { sonda: limpio, errores: erroresLimpio } = await arrancar(limpioPage, { contaminar: false });
  await limpioPage.close();

  const sucioPage = await browser.newPage();
  const { sonda: sucio, errores: erroresSucio } = await arrancar(sucioPage, { contaminar: true });
  await sucioPage.close();

  expect(limpio.canonicas).toBeGreaterThan(80);
  expect(sucio.canonicas).toBe(limpio.canonicas);
  expect(sucio.maestroTotal).toBe(limpio.maestroTotal);
  expect(sucio.baseEntradas).toBe(limpio.baseEntradas);
  expect(sucio.snapshotUnicas).toBe(limpio.snapshotUnicas);
  expect(sucio.hotspotsTotal).toBe(limpio.hotspotsTotal);
  expect(limpio.claveLegacy).toBe('AUSENTE');
  expect(sucio.claveLegacy).toBe('ENTRADAS:2');
  expect(erroresLimpio).toEqual([]);
  expect(erroresSucio).toEqual([]);
});

test('el override H11 solo consulta sessionStorage y mantiene el guard Supabase-first', () => {
  const fs = require('fs');
  const path = require('path');
  const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

  const inicio = SOURCE.indexOf('loadImportedData = function()');
  expect(inicio).toBeGreaterThan(-1);
  const override = SOURCE.slice(inicio, SOURCE.indexOf('const _filasOrdenesBaseV45', inicio));

  expect(override).toContain('window.__COI_SUPABASE_SOURCE_OF_TRUTH__===true&&!demoExplicita');
  expect(override).toContain("sessionStorage.getItem('coi.demo.explicit.once')==='1'");

  const posGuard = override.indexOf('__COI_SUPABASE_SOURCE_OF_TRUTH__');
  const posLecturaSesion = override.indexOf('sessionStorage.getItem(STORAGE_KEY)');
  const posPush = override.indexOf('estaciones.push');
  expect(posLecturaSesion).toBeGreaterThan(-1);
  expect(posGuard).toBeLessThan(posLecturaSesion);
  expect(posGuard).toBeLessThan(posPush);

  // El runtime completo queda libre de localStorage; la prueba hostil de arriba es externa a la app.
  expect(SOURCE).not.toContain('localStorage');
  expect(override).not.toContain('removeItem');
  expect(override).not.toContain('setItem');
});
