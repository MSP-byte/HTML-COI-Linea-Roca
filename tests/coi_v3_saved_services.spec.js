const {test,expect}=require('@playwright/test');

test('COI V3: cartera de Servicios persistida se muestra separada de las OC contractuales',async({page})=>{
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const saved=Array.from({length:16},(_,i)=>({
      id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),
      nro_oc:String(4530009800+i),
      orden_id:null,
      datos:{descripcion:'SERVICIO DE PRUEBA '+(i+1),proveedor:'PROVEEDOR DE ENSAYO',estacion:'Temperley'}
    }));
    const orders=[{nro_oc:'4530001234',tipo:'Servicio',proveedor:'COI QA',monto_total:1000,moneda:'ARS',estado_registro:'En ejecucion'}];
    window.__COI_SUPABASE_CLIENT__={
      auth:{getSession:async()=>({data:{session:{access_token:'fake-test'}},error:null})},
      from(table){
        const query={
          select(){return this;},eq(){return this;},order(){return this;},
          range(){return Promise.resolve({data:table==='coi_v3_cartera'?saved:orders,error:null});}
        };
        return query;
      }
    };
    await window.COI_V3.refreshServices();
    const host=document.getElementById('coiV3Services');
    const imported=document.getElementById('coiV3SavedServices');
    return {
      importedRows:imported?.querySelectorAll('tbody tr').length,
      contractRows:host?.querySelectorAll('[data-v3-oc]').length,
      content:imported?.textContent||''
    };
  });
  expect(result.importedRows).toBe(16);
  expect(result.contractRows).toBe(1);
  expect(result.content).toContain('16');
  expect(result.content).toContain('Referencia pendiente de alta contractual');
  expect(result.content).toContain('no nuevas órdenes de compra ni certificaciones generadas');
});

test('COI V3: un esquema sin cartera V3 no rompe la vista contractual',async({page})=>{
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    window.__COI_SUPABASE_CLIENT__={
      auth:{getSession:async()=>({data:{session:{}},error:null})},
      from(table){
        return {
          select(){return this;},eq(){return this;},order(){return this;},
          range(){return Promise.resolve(table==='coi_v3_cartera'
            ?{data:null,error:{message:'relation does not exist'}}
            :{data:[{nro_oc:'4530001234',tipo:'Servicio',monto_total:100,moneda:'ARS'}],error:null});}
        };
      }
    };
    await window.COI_V3.refreshServices();
    return {
      contracts:document.querySelectorAll('#coiV3Services [data-v3-oc]').length,
      persisted:document.querySelectorAll('#coiV3SavedServices tbody tr').length,
      text:document.getElementById('coiV3SavedServices')?.textContent||''
    };
  });
  expect(result.contracts).toBe(1);
  expect(result.persisted).toBe(0);
  expect(result.text).toContain('La cartera importada no esta disponible');
});
