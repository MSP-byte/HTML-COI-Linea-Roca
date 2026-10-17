const {test,expect}=require('@playwright/test');
test('COI V3: Cartera Obras puede rehidratarse desde registros confirmados en Supabase',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const info=await page.evaluate(async()=>{
  const records=[{fuente:'obras',fila_excel:4,datos:{documento_origen:'BASE_OBRAS',excel:{
    'N° OBRA':'42','DENOMINACIÓN / PLIEGO':'Canaletas bloques sur','LUGAR':'TRE',
    'ESTADO':'En ejecución','OC':'4530009408','CONTRATISTA':'COREL'
  }}}];
  const ok=await window.__COI_CARTERA_V8_F1__.hydratePortfolio(records);
  const rows=window.__COI_CARTERA_V8_F1__.getRows();
  return {ok,count:rows.length,obra:rows[0]?.obra,oc:rows[0]?.oc,lugar:rows[0]?.lugar};
 });
 expect(info).toEqual({ok:true,count:1,obra:'42',oc:'4530009408',lugar:'TRE'});
});
