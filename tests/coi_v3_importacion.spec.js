const {test,expect}=require('@playwright/test');
test('COI V3: importer and Services module preserve manual Carga',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await expect(page.locator('#coiV3Import')).toHaveCount(1);
 await expect(page.locator('#vistaServiciosV3')).toHaveCount(1);
 await expect(page.locator('#vistaCarga')).toHaveCount(1);
 await expect(page.locator('#coiV3Kind option')).toHaveCount(2);
 await expect(page.locator('#coiV3Export')).toBeDisabled();
 await expect(page.locator('#coiV3Message')).toContainText('Seleccioná un Excel');
});
test('COI V3: comparison logic rejects same OC repeated across measurement rows',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const x=await page.evaluate(()=>{
   const input=[{oc:'4530009805',row:2,proveedor:'FEMYP',descripcion:'preventivo'},
                {oc:'4530009805',row:3,proveedor:'FEMYP',descripcion:'mismo contrato'}];
   return window.COI_V3.prepare(input).map(r=>r.outcome);
 });
 expect(x).toEqual(['Multifila','Multifila']);
});
