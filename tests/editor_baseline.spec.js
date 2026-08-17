const { test, expect } = require('@playwright/test');

const ORDER_ID = 'e71fb7e2-cf11-4718-8cc5-322517d29090';
const STATE = 'OBRA/SERVICIO EN EJECUCIÓN';

async function prepareEditor(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window.activarModoEdicionOC === 'function');
  await page.evaluate(({ ORDER_ID, STATE }) => {
    const remote = {
      id: ORDER_ID, nro_oc: '4530008964', id_obra: 'OC-4530008964', tipo: 'Servicio',
      tipo_trabajo: 'Puertas Automáticas', especialidad: 'Puertas Automáticas', descripcion: 'QA editor baseline',
      proveedor: 'FEMYP S.R.L.', estacion: 'Plaza Constitución', ramal: 'Roca', sector: '', expediente: '',
      monto_total: 1000, moneda: 'ARS', fecha_acta_inicio: '2026-01-01', plazo_dias: 365,
      fecha_vencimiento: '2027-01-01', proxima_certificacion: '2026-09-01', fecha_recepcion_documentacion: null,
      fecha_envio_planificacion: null, estado_coi: STATE, estado_documental: '', estado_registro: 'Activo',
      observaciones: 'Original', certificable_con_saldo: false, justificacion_administrativa: null,
      link_documental_principal: null, estado_link_documental: 'Sin link', calidad_datos_estado: 'Verde',
      calidad_datos_score: 100, prioridad_operativa: 'Normal', responsable_coi: null, fecha_ultimo_control: null,
      requiere_accion: false, motivo_requiere_accion: null, estado_envio_pyc: 'No enviado', fecha_cierre_operativo: null,
      observacion_cierre: null, control_terceros_hasta: null, control_terceros_estado: null, saldo_remanente: 0,
      fecha_creacion: '2026-08-01T00:00:00Z', fecha_actualizacion: '2026-08-16T20:00:00Z', creado_por: null, actualizado_por: null
    };
    const staleLocal = { ...remote, estado: STATE, estadoCOI: STATE, fechaUltimaModificacion: '2099-01-01T00:00:00Z', _supabaseRaw: undefined };
    window.resolverOrdenActual = () => staleLocal;
    window.obtenerOC = () => ({ item: staleLocal });
    window.getSupabaseClient = () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: 'qa-admin', email: 'admin@coiroca.com' } } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: remote, error: null }) }) }) })
    });
  }, { ORDER_ID, STATE });
  await page.evaluate(() => window.activarModoEdicionOC('4530008964'));
  await expect(page.locator('#coiEditOCModalV60')).toBeVisible();
  await page.waitForTimeout(100);
}

test('editor V60 abre con baseline remoto y sin cambios pendientes', async ({ page }) => {
  await prepareEditor(page);
  await expect(page.locator('#coiEditDirtyV60')).toHaveText('Sin cambios pendientes');
  await expect(page.locator('#coiEditSaveV60')).toBeDisabled();
  await expect(page.locator('[data-coi-edit-field="estado_coi"]')).toHaveValue(STATE);
  await expect(page.locator('[data-coi-protected="fecha_actualizacion"]')).toHaveValue('2026-08-16T20:00:00Z');
});

test('campo ausente del DOM no se convierte en cambio a undefined', async ({ page }) => {
  await prepareEditor(page);
  await page.evaluate(() => {
    document.querySelector('[data-coi-edit-field="estado_coi"]')?.remove();
    document.querySelector('[data-coi-edit-field="proveedor"]')?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#coiEditDirtyV60')).toHaveText('Sin cambios pendientes');
  await expect(page.locator('#coiEditSaveV60')).toBeDisabled();
  const diag = await page.evaluate(() => window.__COI_DIRTY_DIAG__);
  expect(diag?.current?.estado_coi).toBeUndefined();
  expect(diag?.differences?.some(item => item.field === 'estado_coi')).toBeFalsy();
});
