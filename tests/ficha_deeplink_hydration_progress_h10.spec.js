const { test, expect } = require('@playwright/test');
const F = require('./fixtures/contractual_remote_fixture');

const OC = '4530009622';

test.describe('Ficha OC · deep-link canónico + avance Obra + H10', () => {
  test('N° OC sin prefijo hidrata la Obra, muestra % avance y permite FINALIZADA directa', async ({ page }) => {
    const orden = F.ordenBase({
      nro_oc: OC,
      id_obra: 'OC-' + OC,
      tipo: 'Obra',
      tipo_trabajo: 'Obras Civiles',
      descripcion: 'Obra COREL',
      proveedor: 'COREL S.R.L',
      expediente: 'EX-2025-141369717-APN-GCO#SOFSE',
      monto_total: 91700000,
      fecha_acta_inicio: '2026-03-05',
      plazo_dias: 90,
      fecha_vencimiento: '2026-06-03',
      avance_obra_pct: null,
      estado_coi: 'PLIEGOS EN PREPARACIÓN',
      estado_documental: 'PLIEGOS EN PREPARACIÓN'
    });

    await F.prepararRemotoContractual(page, { ordenes: [orden], historial: [] });
    const errores = await F.abrirFichaContractual(page, OC);
    expect(errores).toEqual([]);

    await page.waitForFunction((oc) => {
      const h = window.COI_EXPEDIENTE_HYDRATION;
      if (!h || typeof h.resolveItem !== 'function') return false;
      const item = h.resolveItem(oc);
      return item && item.tipo === 'Obra' && item.fechaInicio === '2026-03-05';
    }, OC, { timeout: 15000 });

    const resolved = await page.evaluate((oc) => {
      const item = window.COI_EXPEDIENTE_HYDRATION.resolveItem(oc);
      return {
        idObra: item?.idObra || null,
        numeroOC: item?.numeroOC || null,
        tipo: item?.tipo || null,
        fechaInicio: item?.fechaInicio || null,
        avance: item?._supabaseRaw?.avance_obra_pct ?? item?.avance_obra_pct ?? null
      };
    }, OC);

    expect(resolved).toEqual({
      idObra: 'OC-' + OC,
      numeroOC: OC,
      tipo: 'Obra',
      fechaInicio: '2026-03-05',
      avance: null
    });

    await page.waitForSelector('#fichaOCBody [data-coi-obra-progress-manual]', { timeout: 15000 });
    await expect(page.locator('#fichaOCBody [data-coi-obra-progress-manual]')).toContainText('% de avance');
    await expect(page.locator('#fichaOCBody [data-coi-obra-progress-manual]')).toContainText('Actualizar %');

    // Regla contractual vigente: el salto a H10 se permite si existe Acta de Inicio.
    // Los hitos intermedios no se autocompletan.
    await F.confirmarHito(page, 'finalizada', '2026-06-03');
    const estado = await F.observable(page);
    expect(estado.estadoActual).toContain('FINALIZAD');
    expect(estado.avance).toBe('1 / 10');
    expect(await page.evaluate((oc) => window.__CT10__.historial(oc)
      .filter((h) => h.tipo_evento === 'Circuito administrativo' && h.campo_modificado === 'finalizada').length, OC)).toBe(1);
  });
});
