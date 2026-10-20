const {test,expect}=require('@playwright/test');

test('Sidebar V2: Obras, Servicios y módulos normales tienen un único activo',async({page})=>{
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  const activeButtons=page.locator('#coiV2Sidebar .coi-v2-nav-btn.active');
  const open=async(buttonId,viewId)=>{
    // El mismo click DOM cubre el menú plegado de Chromium mobile.
    await page.evaluate(id=>{
      const btn=document.getElementById(id);
      if(!btn)throw new Error('Falta botón '+id);
      btn.click();
    },buttonId);
    await expect(page.locator('#'+viewId)).toHaveClass(/\\bactive\\b/);
    await expect(page.locator('#'+buttonId)).toHaveClass(/\\bactive\\b/);
    await expect(page.locator('#'+buttonId)).toHaveAttribute('aria-current','page');
    await expect(activeButtons).toHaveCount(1);
  };
  await expect(page.locator('#coiV8V2Nav')).toHaveCount(1);
  await expect(page.locator('#coiV3ServicesNav')).toHaveCount(1);
  const normal={btnCalendarioCOI:'vistaCalendarioCOI',btnOrdenes:'vistaOrdenes',btnDashboard:'vistaDashboard'};
  await open('coiV8V2Nav','vistaCarteraObrasV8');
  await open('btnCalendarioCOI',normal.btnCalendarioCOI);
  await expect(page.locator('#coiV8V2Nav')).not.toHaveClass(/\\bactive\\b/);
  await expect(page.locator('#coiV8V2Nav')).not.toHaveAttribute('aria-current','page');
  await open('coiV3ServicesNav','vistaServiciosV3');
  await expect(page.locator('#coiV8V2Nav')).not.toHaveClass(/\\bactive\\b/);
  await open('btnOrdenes',normal.btnOrdenes);
  await expect(page.locator('#coiV3ServicesNav')).not.toHaveClass(/\\bactive\\b/);
  await open('coiV8V2Nav','vistaCarteraObrasV8');
  await open('btnDashboard',normal.btnDashboard);
  await expect(page.locator('#coiV8V2Nav')).not.toHaveClass(/\\bactive\\b/);
});
