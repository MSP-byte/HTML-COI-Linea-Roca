const {test,expect}=require('@playwright/test');
test('COI V3: importador y cartera de servicios accesibles sin alterar Carga histórica',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await expect(page.locator('#vistaImportacionV3')).toHaveCount(1);
 await expect(page.locator('#vistaCarteraServiciosV3')).toHaveCount(1);
 await expect(page.locator('#vistaCarga')).toHaveCount(1);
 await expect(page.locator('#v3Confirm')).toBeDisabled();
 await expect(page.locator('#v3Origin option')).toHaveCount(2);
 await expect(page.locator('#v3SvcBody')).toContainText('Cargá el Excel');
});
test('COI V3: normalización de Servicios vs Obra respeta OC única',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const values=await page.evaluate(()=>{
  const header=new Array(40).fill('');header[2]='OC N°';
  const a=new Array(40).fill('');a[2]='4530009805';a[10]='Servicio Preventivo';a[11]='Temperley';a[12]='FEMYP S.R.L';a[3]='26561474.20';
  const sh={'BUSCADOR SVICIOS OC':[{row:6,values:header},{row:7,values:a}]};
  const rows=window.COI_V3.parseSheets(sh,'servicios');
  const h2=new Array(40).fill('');h2[17]='OC';
  const b=new Array(40).fill('');b[0]='42';b[2]='TRE';b[3]='Canaletas';b[17]='4530009408';
  const works=window.COI_V3.parseSheets({'BASE_OBRAS':[{row:3,values:h2},{row:4,values:b}]},'obras');
  return {service:rows[0],obra:works[0],lengths:[rows.length,works.length]};
 });
 expect(values.lengths).toEqual([1,1]);
 expect(values.service.clave_fuente).toBe('oc:4530009805');
 expect(values.service.datos.proveedor).toBe('FEMYP S.R.L');
 expect(values.obra.nro_oc).toBe('4530009408');
 expect(values.obra.clave_fuente).toContain('obra:42:');
});
