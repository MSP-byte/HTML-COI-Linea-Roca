const {test,expect}=require('@playwright/test');

// Regression: el menu V2 debe resaltar una sola vista, incluidas las carteras
// de Obras y Servicios, agregadas dinamicamente fuera del NAV original.
test('COI V2: solo el modulo actual permanece resaltado en el menu lateral',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const sidebar=page.locator('#coiV2Sidebar .coi-v2-nav');
 const obras=sidebar.locator('#coiV8V2Nav');
 const servicios=sidebar.locator('#coiV3ServicesNav');
 await expect(obras).toBeAttached();
 await expect(servicios).toBeAttached();
 await expect(obras).toHaveAttribute('data-v2-view','vistaCarteraObrasV8');
 await expect(servicios).toHaveAttribute('data-v2-view','vistaServiciosV3');

 async function open(selector,view){
  const button=sidebar.locator(selector);
  // Ejecuta el click real del elemento incluso si el menu esta plegado
  // en la variante mobile; no sustituye los eventos de navegacion.
  await button.evaluate(node=>node.click());
  await expect(page.locator('#'+view)).toHaveClass(/\bactive\b/);
  await expect(button).toHaveClass(/\bactive\b/);
  await expect(button).toHaveAttribute('aria-current','page');
  await expect(sidebar.locator('.coi-v2-nav-btn.active')).toHaveCount(1);
  await expect(sidebar.locator('.coi-v2-nav-btn[aria-current="page"]')).toHaveCount(1);
 }
 await open('#coiV8V2Nav','vistaCarteraObrasV8');
 await open('[data-v2-nav="btnCalendarioCOI"]','vistaCalendarioCOI');
 await expect(obras).not.toHaveClass(/\bactive\b/);
 await open('#coiV3ServicesNav','vistaServiciosV3');
 await expect(obras).not.toHaveClass(/\bactive\b/);
 await open('[data-v2-nav="btnOrdenes"]','vistaOrdenes');
 await expect(servicios).not.toHaveClass(/\bactive\b/);
 await open('#coiV8V2Nav','vistaCarteraObrasV8');
 await open('[data-v2-nav="btnDashboard"]','vistaDashboard');
 await expect(obras).not.toHaveClass(/\bactive\b/);
 await expect(servicios).not.toHaveClass(/\bactive\b/);
 // syncNav se vuelve a ejecutar cada segundo: el estado no debe regresar.
 await page.waitForTimeout(1200);
 await expect(sidebar.locator('.coi-v2-nav-btn.active')).toHaveCount(1);
 await expect(sidebar.locator('[data-v2-view="vistaDashboard"]')).toHaveClass(/\bactive\b/);
});
