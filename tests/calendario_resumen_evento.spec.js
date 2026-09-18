const { test, expect } = require('@playwright/test');

/* El arranque en frío de index.html (un solo archivo grande) puede consumir
   buena parte del timeout global antes de que el Calendario quede montado.
   Se amplía el presupuesto del archivo; las aserciones no cambian. */
test.describe.configure({ timeout: 60_000 });

/* CAMBIO 4 — tarjeta de resumen del evento en Calendario COI.
   Un click sobre un evento asociado a una OC NO navega: abre una tarjeta de
   resumen, y recién ABRIR EXPEDIENTE usa la navegación canónica hacia la
   Ficha OC (data-open-oc → abrirFichaOC).

   Vista COI I y Vista COI II comparten el modelo de evento, así que comparten
   la tarjeta; ambas se verifican por separado igual.

   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */

const OC = '4530778899';
const ID_OBRA = 'OBRA-' + OC;
const RESUMEN = '#coiResumenEvento';

// Fechas del mes visible: el calendario filtra por año/mes en curso, así que
// se derivan del reloj del runner en vez de fijar un mes que quedaría fuera.
function fechasDelMes() {
  const hoy = new Date();
  const en = (dia) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return { inicio: en(3), prox: en(12), fin: en(24) };
}

async function abrirCalendario(page, opciones = {}) {
  const f = fechasDelMes();
  const c = Object.assign({ tipo: 'Obra' }, opciones);
  await page.route(url => url.hostname !== '127.0.0.1', r => r.abort());
  await page.addInitScript(({ oc, idObra, f, c }) => {
    const item = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      idObra, idOC: idObra, numeroOC: oc, oc, nro_oc: oc,
      tipo: c.tipo, proveedor: 'CONTRATISTA CALENDARIO SA',
      estacion: 'Plaza Constitución', sector: 'Andén 3',
      tipoTrabajo: 'Reacondicionamiento de andén',
      descripcion: 'Reacondicionamiento de andén',
      estadoCOI: 'OBRA/SERVICIO EN EJECUCIÓN',
      estado: 'OBRA/SERVICIO EN EJECUCIÓN',
      estadoDocumental: 'PLIEGO CON EXPTE',
      fechaActaInicio: f.inicio, actaInicio: f.inicio,
      proximaCertificacion: f.prox,
      fechaVencimiento: f.fin, vencimiento: f.fin,
      plazoDias: 90,
      avanceObraPct: 45,
      ultimaCertificacion: 'Acta Medición N°2'
    };
    const fila = { estacion: item.estacion, item, idObra, numeroOC: oc, tipo: c.tipo, proveedor: item.proveedor };
    const instalar = () => {
      window.todasLasOC = () => [fila];
      window.__CAL_FIX__ = { item };
    };
    instalar();
    document.addEventListener('DOMContentLoaded', instalar);
    window.addEventListener('load', instalar);
  }, { oc: OC, idObra: ID_OBRA, f, c });

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.renderCalendarioCOIUnificado === 'function', null, { timeout: 20000 });
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
  // La vista tiene que quedar realmente activa antes de tocar sus subpestañas.
  await page.locator('#vistaCalendarioCOI.active').waitFor({ state: 'attached', timeout: 25000 });
  await page.locator('#btnCalendarioVistaCOI1').waitFor({ state: 'visible', timeout: 25000 });
}

/* Abre la tarjeta desde un evento asegurando que esté a la vista: en viewport
   móvil las celdas del calendario pueden quedar fuera de pantalla. */
async function clickEvento(page, selector) {
  const evento = page.locator(selector).first();
  await expect(evento).toBeVisible();
  await evento.scrollIntoViewIfNeeded();
  await evento.click();
  return evento;
}

// Se usa el botón real de la subpestaña: es el camino que el módulo maneja.
async function activarTab(page, tab) {
  const boton = { inteligente: '#btnCalendarioVistaCOI1', calendario: '#btnCalendarioVistaCOI2' }[tab];
  await page.click(boton);
  await page.locator({ inteligente: '#coiTabInteligente', calendario: '#coiTabCalendario' }[tab] + '.active')
    .waitFor({ state: 'attached', timeout: 15000 });
}

test('CAL-1 · Vista COI I: el click sobre un evento abre la tarjeta resumen y no navega', async ({ page }) => {
  await abrirCalendario(page);
  await activarTab(page, 'inteligente');
  await clickEvento(page, '#calendarioInteligenteCOI [data-coi-evento]');

  await expect(page.locator(RESUMEN)).toBeVisible();
  // No navegó: la vista del Calendario sigue activa y la Ficha no se abrió.
  await expect(page.locator('#vistaCalendarioCOI')).toHaveClass(/active/);
  await expect(page.locator('#vistaFichaOC')).not.toHaveClass(/active/);
});

test('CAL-2 · Vista COI II: el click sobre un evento abre la tarjeta resumen y no navega', async ({ page }) => {
  await abrirCalendario(page);
  await activarTab(page, 'calendario');
  await clickEvento(page, '#opCoiCalendario .op-event[data-coi-evento]');

  await expect(page.locator(RESUMEN)).toBeVisible();
  await expect(page.locator('#vistaCalendarioCOI')).toHaveClass(/active/);
  await expect(page.locator('#vistaFichaOC')).not.toHaveClass(/active/);
});

test('CAL-3 · la tarjeta muestra el resumen mínimo de la OC', async ({ page }) => {
  await abrirCalendario(page);
  await activarTab(page, 'inteligente');
  await clickEvento(page, '#calendarioInteligenteCOI [data-coi-evento]');
  await expect(page.locator(RESUMEN)).toBeVisible();

  const texto = await page.locator(RESUMEN).innerText();
  for (const rotulo of ['N° OC', 'TIPO', 'PROVEEDOR', 'TIPO DE TRABAJO', 'ESTACIÓN / SECTOR',
    'ESTADO ACTUAL', 'FECHA ACTA DE INICIO', 'ÚLTIMA CERTIFICACIÓN',
    'PRÓXIMA CERTIFICACIÓN', 'VENCIMIENTO CONTRACTUAL', 'ESTADO DOCUMENTAL']) {
    expect(texto.toUpperCase()).toContain(rotulo);
  }
  expect(texto).toContain(OC);
  expect(texto).toContain('CONTRATISTA CALENDARIO SA');
  expect(texto).toContain('Plaza Constitución');
  // Obra: el avance se muestra.
  expect(texto.toUpperCase()).toContain('AVANCE DE OBRA');
  expect(texto).toContain('45%');
});

test('CAL-4 · un evento de Servicio no muestra avance de obra', async ({ page }) => {
  await abrirCalendario(page, { tipo: 'Servicio' });
  await activarTab(page, 'inteligente');
  await clickEvento(page, '#calendarioInteligenteCOI [data-coi-evento]');
  await expect(page.locator(RESUMEN)).toBeVisible();
  const texto = await page.locator(RESUMEN).innerText();
  expect(texto.toUpperCase()).not.toContain('AVANCE DE OBRA');
});

test('CAL-5 · ABRIR EXPEDIENTE navega a la Ficha de esa OC por el camino canónico', async ({ page }) => {
  await abrirCalendario(page);
  await activarTab(page, 'inteligente');
  await clickEvento(page, '#calendarioInteligenteCOI [data-coi-evento]');
  const boton = page.locator(RESUMEN + ' [data-open-oc]');
  await expect(boton).toHaveText('ABRIR EXPEDIENTE');
  // La identidad que viaja es la que el propio calendario resolvió para el
  // evento; el helper canónico es quien decide cómo abrirla.
  const identidadEvento = await page.locator('#calendarioInteligenteCOI [data-coi-evento]').first()
    .evaluate(el => el.getAttribute('data-coi-evento'));
  const identidadBoton = await boton.getAttribute('data-open-oc');
  expect(identidadBoton).toBeTruthy();
  expect(identidadEvento).toContain(identidadBoton);
  await boton.click();

  await expect(page.locator('#vistaFichaOC')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator(RESUMEN)).toHaveCount(0);   // la tarjeta se cierra al navegar
  // `ocActualId` es un binding léxico, no una propiedad de window (KI-031):
  // la identidad se verifica sobre lo que la Ficha realmente pintó.
  await expect(page.locator('#fichaOCBody')).toContainText(OC, { timeout: 15000 });
});

test('CAL-6 · la tarjeta se cierra con el botón, con Escape y con click fuera', async ({ page }) => {
  await abrirCalendario(page);
  await activarTab(page, 'inteligente');
  const evento = page.locator('#calendarioInteligenteCOI [data-coi-evento]').first();
  // En viewport móvil la tarjeta puede quedar fuera de vista: se abre siempre
  // desde el mismo punto conocido en vez de depender del scroll del momento.
  const abrirTarjeta = async () => {
    await evento.scrollIntoViewIfNeeded();
    await evento.click();
    await expect(page.locator(RESUMEN)).toBeVisible();
  };

  await abrirTarjeta();
  await page.click(RESUMEN + ' [data-coi-resumen-cerrar]');
  await expect(page.locator(RESUMEN)).toHaveCount(0);

  await abrirTarjeta();
  await page.keyboard.press('Escape');
  await expect(page.locator(RESUMEN)).toHaveCount(0);

  await abrirTarjeta();
  // Click sobre el overlay, fuera de la tarjeta.
  await page.evaluate(() => document.getElementById('coiResumenEvento')
    .dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await expect(page.locator(RESUMEN)).toHaveCount(0);
});

test('CAL-7 · los filtros del calendario siguen funcionando con la tarjeta instalada', async ({ page }) => {
  await abrirCalendario(page);
  await activarTab(page, 'inteligente');
  await expect(page.locator('#calendarioInteligenteCOI [data-coi-evento]').first()).toBeVisible();
  // La OC del fixture es Obra: filtrar por Servicio deja la vista sin eventos.
  await page.selectOption('#coiTipo', 'Servicio');
  await expect(page.locator('#calendarioInteligenteCOI [data-coi-evento]')).toHaveCount(0);
  // Y al volver a Obra los eventos reaparecen: el filtro sigue vivo.
  await page.selectOption('#coiTipo', 'Obra');
  await expect(page.locator('#calendarioInteligenteCOI [data-coi-evento]').first()).toBeVisible();
});
