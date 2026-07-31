const { test, expect } = require('@playwright/test');

test('selección → click real → una sola confirmación; cancelar conserva la fila', async ({ page }) => {
  const clickLogs=[];
  page.on('console',message=>{if(message.text().includes('[COI DELETE] CLICK RECIBIDO'))clickLogs.push(message.text());});
  await page.goto('/index.html');
  await page.locator('#btnOrdenes').click();
  const checkbox=page.locator('.chk-orden-row').first();
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await expect(page.locator('#ordenesSeleccionadasCount')).toContainText('1 seleccionada');
  await expect(page.locator('#btnBorrarSeleccionadas')).toHaveText('Borrar seleccionadas (1)');
  const rowsBefore=await page.locator('#ordenesTbody tr').count();

  await page.locator('#btnBorrarSeleccionadas').click();
  await expect(page.locator('#crudOcDeleteModal')).toBeVisible();
  expect(clickLogs).toHaveLength(1);
  await page.locator('[data-crud-cancel]').click();
  await expect(page.locator('#crudOcDeleteModal')).toBeHidden();
  await expect(page.locator('#ordenesTbody tr')).toHaveCount(rowsBefore);
});

test('error Supabase posterior a confirmar mantiene la fila y es visible', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#btnOrdenes').click();
  const checkbox=page.locator('.chk-orden-row').first();
  await checkbox.check();
  const rowsBefore=await page.locator('#ordenesTbody tr').count();
  await page.locator('#btnBorrarSeleccionadas').click();
  await expect(page.locator('#crudOcDeleteModal')).toBeVisible();
  await page.locator('#crudOcPin').fill('1234');
  await page.locator('#crudOcPhrase').fill('ELIMINAR');
  await page.locator('[data-crud-confirm]').click();
  await expect(page.locator('.coi-toast')).toContainText('No se pudo eliminar la OC en Supabase:');
  await expect(page.locator('#ordenesTbody tr')).toHaveCount(rowsBefore);
  await expect(page.locator('#btnBorrarSeleccionadas')).toBeEnabled();
});

test('el binding idempotente sobrevive re-render y no duplica el handler', async ({ page }) => {
  const logs=[];
  page.on('console',message=>{if(message.text().includes('[COI DELETE] CLICK RECIBIDO'))logs.push(message.text());});
  await page.goto('/index.html');
  await page.locator('#btnOrdenes').click();
  await page.evaluate(()=>{ window.bindCrudOrdenesUI(); window.renderOrdenes(); });
  await page.locator('.chk-orden-row').first().check();
  await page.locator('#btnBorrarSeleccionadas').click();
  await expect(page.locator('#crudOcDeleteModal')).toBeVisible();
  expect(logs).toHaveLength(1);
});
