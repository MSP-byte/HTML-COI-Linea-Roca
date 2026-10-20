const {test,expect}=require('@playwright/test');
test('COI V3: Cartera Obras puede rehidratarse desde registros confirmados en Supabase',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const info=await page.evaluate(async()=>{
  const records=[{id:'55555555-5555-4555-8555-555555555555',fuente:'obras',fila_excel:4,datos:{documento_origen:'BASE_OBRAS',excel:{
    'N° OBRA':'42','DENOMINACIÓN / PLIEGO':'Canaletas bloques sur','LUGAR':'TRE',
    'ESTADO':'En ejecución','OC':'4530009408','CONTRATISTA':'COREL'
  }}}];
  const ok=await window.__COI_CARTERA_V8_F1__.hydratePortfolio(records);
  const rows=window.__COI_CARTERA_V8_F1__.getRows();
  return {ok,count:rows.length,obra:rows[0]?.obra,oc:rows[0]?.oc,lugar:rows[0]?.lugar,id:rows[0]?.id_interno};
 });
 await page.evaluate(()=>document.getElementById('coiV8V2Nav').click());
 await expect(page.locator('#cv2Info')).toHaveText('Cartera recuperada desde Supabase: 1 registros confirmados.');
 expect(info).toEqual({ok:true,count:1,obra:'42',oc:'4530009408',lugar:'TRE',id:'55555555-5555-4555-8555-555555555555'});
});
