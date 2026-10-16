const {test,expect}=require('@playwright/test');
test('COI V3: Centro Excel, mapeo y cartera Servicios montan sin depender de Supabase',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await expect(page.locator('#coiV3Import')).toHaveCount(1);
 await expect(page.locator('#vistaServiciosV3')).toHaveCount(1);
 await expect(page.locator('#coiV3Kind')).toHaveValue('Servicio');
 const r=await page.evaluate(()=>({readOnly:window.COI_V3.readOnly,reader:typeof window.__COI_CARTERA_V8_F1__.readSheet,rate:window.COI_V3.parseAmount('12.345,67'),date:window.COI_V3.parseDate('05/06/2026')}));
 expect(r).toEqual({readOnly:true,reader:'function',rate:12345.67,date:'2026-06-05'});
 await page.locator('#coiV3Reconcile').click();
 await expect(page.locator('#coiV3Message')).toContainText('Primero seleccioná un Excel');
});
test('COI V3: Tooltip ferroviario expone abreviatura conocida y pendiente',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(()=>{
  const s={nombre:'Temperley',obras:[],servicios:[]};
  const unknown={nombre:'Bosques',obras:[],servicios:[]};
  window.showTip({clientX:20,clientY:20},s);
  const a=document.querySelector('#tip').textContent;
  window.showTip({clientX:20,clientY:20},unknown);
  const b=document.querySelector('#tip').textContent;
  return {a,b};
 });
 expect(result.a).toContain('Abreviatura: TY');
 expect(result.b).toContain('Pendiente de validación');
});
