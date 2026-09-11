const { test, expect } = require('@playwright/test');

test.describe('Expediente Digital OC · hidratacion Supabase', () => {
  test('mapea campos snake_case persistidos a los alias que renderiza la Ficha OC', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.COI_EXPEDIENTE_HYDRATION?.hydrateItem === 'function');

    const item = await page.evaluate(() => {
      const target = {};
      window.COI_EXPEDIENTE_HYDRATION.hydrateItem(target, {
        id: 'e71fb7e2-cf11-4718-8cc5-322517d29090',
        nro_oc: '4530008964',
        id_obra: 'OC-4530008964',
        tipo: 'Servicio',
        tipo_trabajo: 'Puertas Automáticas',
        especialidad: 'Puertas Automáticas',
        descripcion: 'PLAN DE MANTENIMIENTO INTEGRAL PREVENTIVO Y MENSUAL DE PUERTAS AUTOMATICAS SOFSE',
        proveedor: 'FEMYP S.R.L',
        sector: 'Plaza Constitución',
        fecha_acta_inicio: '2025-06-30',
        plazo_dias: 400,
        fecha_vencimiento: '2026-08-04',
        proxima_certificacion: '2026-07-05',
        estado_coi: 'En ejecución',
        estado_documental: 'Pendiente',
        saldo_remanente: 16199745.32
      });
      return {
        idObra: target.idObra,
        numeroOC: target.numeroOC,
        oc: target.oc,
        tipo: target.tipo,
        tipoTrabajo: target.tipoTrabajo,
        proveedor: target.proveedor,
        fechaInicio: target.fechaInicio,
        plazoDias: target.plazoDias,
        vencimiento: target.vencimiento,
        proximaCertificacion: target.proximaCertificacion,
        estado: target.estado,
        estadoDocumental: target.estadoDocumental,
        saldoRemanente: target.saldoRemanente,
        supabaseId: target.supabaseId
      };
    });

    expect(item).toEqual({
      idObra: 'OC-4530008964',
      numeroOC: '4530008964',
      oc: '4530008964',
      tipo: 'Servicio',
      tipoTrabajo: 'Puertas Automáticas',
      proveedor: 'FEMYP S.R.L',
      fechaInicio: '2025-06-30',
      plazoDias: 400,
      vencimiento: '2026-08-04',
      proximaCertificacion: '2026-07-05',
      estado: 'En ejecución',
      estadoDocumental: 'Pendiente',
      saldoRemanente: 16199745.32,
      supabaseId: 'e71fb7e2-cf11-4718-8cc5-322517d29090'
    });
  });

  test('no borra un dato derivado existente cuando Supabase no trae valor util', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.COI_EXPEDIENTE_HYDRATION?.hydrateItem === 'function');
    const value = await page.evaluate(() => {
      const target = { estacion: 'Plaza Constitución', proveedor: 'FEMYP S.R.L' };
      window.COI_EXPEDIENTE_HYDRATION.hydrateItem(target, { estacion: null, proveedor: '' });
      return target;
    });
    expect(value.estacion).toBe('Plaza Constitución');
    expect(value.proveedor).toBe('FEMYP S.R.L');
  });
});
