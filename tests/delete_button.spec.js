const { test, expect } = require('@playwright/test');

test('selección → click real → confirmación nativa muestra la OC visual; cancelar conserva la fila', async ({ page }) => {
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

  let message='';
  page.once('dialog',async dialog=>{message=dialog.message();await dialog.dismiss();});
  await page.locator('#btnBorrarSeleccionadas').click();
  await expect.poll(()=>message).toContain(await checkbox.getAttribute('aria-label').then(label=>label.replace(/^Seleccionar OC\s+/i,'')));
  expect(clickLogs).toHaveLength(1);
  await expect(page.locator('#ordenesTbody tr')).toHaveCount(rowsBefore);
});

test('error Supabase posterior a confirmar mantiene la fila y es visible', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#btnOrdenes').click();
  const checkbox=page.locator('.chk-orden-row').first();
  await checkbox.check();
  const rowsBefore=await page.locator('#ordenesTbody tr').count();
  page.on('dialog',async dialog=>{if(dialog.type()==='confirm')await dialog.accept();else if(dialog.message().includes('ELIMINAR'))await dialog.accept('ELIMINAR');else await dialog.accept('1234');});
  await page.locator('#btnBorrarSeleccionadas').click();
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
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#btnBorrarSeleccionadas').click();
  expect(logs).toHaveLength(1);
});
