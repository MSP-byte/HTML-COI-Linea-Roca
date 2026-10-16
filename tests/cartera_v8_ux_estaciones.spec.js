const {test,expect}=require('@playwright/test');
test('Cartera V8: tipografía legible y temas claro/oscuro',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await expect(page.locator('#vistaCarteraObrasV8')).toHaveCount(1);
 await page.evaluate(()=>window.COI_CARTERA_V8_P2.open());
 const body=page.locator('body');
 await body.evaluate(el=>el.classList.remove('coi-v2-light'));
 const dark=await page.locator('#vistaCarteraObrasV8 .cv2-kpi').first().evaluate(el=>({bg:getComputedStyle(el).backgroundColor,font:getComputedStyle(el.querySelector('strong')).fontSize}));
 await body.evaluate(el=>el.classList.add('coi-v2-light'));
 const light=await page.locator('#vistaCarteraObrasV8 .cv2-kpi').first().evaluate(el=>getComputedStyle(el).backgroundColor);
 expect(dark.bg).not.toBe(light);
 expect(parseFloat(dark.font)).toBeGreaterThanOrEqual(24);
 await expect(page.locator('#cv2ChartEstado')).toContainText(/sin datos/i);
});
test('Red Roca: referencia Quilmes, alias Constitución y estación pendiente',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const ref=await page.evaluate(()=>({num:window.COI_REFDATA_ESTACIONES.records.length,quilmes:window.COI_REFDATA_ESTACIONES.findByStation('Quilmes').codigo,bosques:window.COI_REFDATA_ESTACIONES.findByStation('Bosques')}));
 expect(ref.num).toBe(50);expect(ref.quilmes).toBe('QL');expect(ref.bosques).toBeNull();
 await page.evaluate(()=>window.COI_REFDATA_ESTACIONES.render({nombre:'Quilmes'}));
 await expect(page.locator('#panel .coi-ref-card')).toContainText('17,249');
 await expect(page.locator('#panel .coi-ref-card')).toContainText('QL');
 await page.evaluate(()=>window.COI_REFDATA_ESTACIONES.render({nombre:'Plaza Constitución'}));
 await expect(page.locator('#panel .coi-ref-card')).toContainText('PC');
 await page.evaluate(()=>window.COI_REFDATA_ESTACIONES.render({nombre:'Bosques'}));
 await expect(page.locator('#panel .coi-ref-card')).toContainText(/no se encontró/i);
 await expect(page.locator('#panel .coi-ref-card')).toHaveCount(1);
});
