const {test,expect}=require('@playwright/test');

// Usa datos simulados: no requiere acceso ni credenciales de STAGING/PRODUCCIÓN.
async function injectPortfolio(page,{sessionReady=true,tableReady=true,rowsPresent=true}={}){
 await page.evaluate(({sessionReady,tableReady,rowsPresent})=>{
  const record={id:'f1111111-2222-4333-8444-555555555555',fuente:'obras',fila_excel:4,datos:{
   documento_origen:'BASE_OBRAS',excel:{
    'N° OBRA':'42','LUGAR':'Bernal','DENOMINACIÓN / PLIEGO':'Reparación de andén',
    'ESTADO':'En ejecución','OC':'4530009632','CONTRATISTA':'Contratista QA',
    'AVANCE ACUMULADO':'25%'
   }
  }};
  let authenticated=sessionReady,available=tableReady,hasSavedRows=rowsPresent;
  window.__COI_V3_TEST_STATE__={setSession:value=>{authenticated=value;},setTable:value=>{available=value;},setRows:value=>{hasSavedRows=value;}};
  window.__COI_SUPABASE_CLIENT__={
   auth:{getSession:async()=>({data:{session:authenticated?{access_token:'qa-fixture'}:null},error:null})},
   from(table){
    return {
     select(){return this;},eq(){return this;},order(){return this;},
     limit(){return Promise.resolve({data:table==='coi_v3_cartera'&&available&&hasSavedRows?[record]:[],error:available?null:{message:'Tabla ausente'}});}
    };
   }
  };
 },{sessionReady,tableReady,rowsPresent});
}

test('Obras V3: rehidrata UUID confirmado al entrar y tras recargar el HTML',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await injectPortfolio(page,{sessionReady:false});
 await page.locator('#coiV8V2Nav').evaluate(button=>button.click());
 await expect(page.locator('#cv2Info')).toContainText('Esperando sesión autenticada');
 await page.evaluate(()=>window.__COI_V3_TEST_STATE__.setSession(true));
 await expect(page.locator('#cv2Result')).toContainText('1 de 1 registros',{timeout:10000});
 await expect(page.locator('#cv2Info')).toContainText('Cartera recuperada desde Supabase: 1 registros confirmados.');
 const first=await page.evaluate(()=>window.__COI_CARTERA_V8_F1__.getRows().map(x=>x.id_interno));
 expect(first).toEqual(['f1111111-2222-4333-8444-555555555555']);
 await page.reload({waitUntil:'domcontentloaded'});
 await injectPortfolio(page);
 await page.locator('#cv2RemoteRefresh').evaluate(button=>button.click());
 await expect(page.locator('#cv2Result')).toContainText('1 de 1 registros',{timeout:10000});
 const again=await page.evaluate(()=>window.__COI_CARTERA_V8_F1__.getRows().map(x=>x.id_interno));
 expect(again).toEqual(first);
});

test('Obras V3: si falta el esquema remoto informa el motivo sin inventar filas',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await injectPortfolio(page,{tableReady:false});
 await page.locator('#coiV8V2Nav').evaluate(button=>button.click());
 await expect(page.locator('#cv2Info')).toContainText('La cartera V3 no está disponible',{timeout:10000});
 await expect(page.locator('#cv2Result')).toContainText('0 de 0 registros');
 await expect(page.locator('#vistaCarga')).toHaveCount(1);
 await expect(page.locator('#cv2RemoteRefresh')).toBeEnabled();
});

test('Obras V3: recuperación manual vuelve a consultar si la primera lectura estaba vacía',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await injectPortfolio(page,{rowsPresent:false});
 await page.locator('#coiV8V2Nav').evaluate(button=>button.click());
 await expect(page.locator('#cv2Info')).toContainText('No hay intervenciones de Obras confirmadas',{timeout:10000});
 await expect(page.locator('#cv2Result')).toContainText('0 de 0 registros');
 await page.evaluate(()=>window.__COI_V3_TEST_STATE__.setRows(true));
 await page.locator('#cv2RemoteRefresh').evaluate(button=>button.click());
 await expect(page.locator('#cv2Result')).toContainText('1 de 1 registros',{timeout:10000});
});
