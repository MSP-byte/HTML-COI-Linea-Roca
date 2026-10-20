const {test,expect}=require('@playwright/test');

test('V3 Obras: KPIs distinguen identificadores administrativos faltantes de ausencia de OC',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.evaluate(async()=>{
  const records=[
   {id:'11111111-1111-4111-8111-111111111111',fuente:'obras',fila_excel:4,datos:{documento_origen:'BASE_OBRAS',excel:{'DENOMINACIÓN / PLIEGO':'Obra sin numero','LUGAR':'Bernal','ESTADO':'Enlace'}}},
   {id:'22222222-2222-4222-8222-222222222222',fuente:'obras',fila_excel:5,datos:{documento_origen:'BASE_OBRAS',excel:{'N° OBRA':'42','DENOMINACIÓN / PLIEGO':'Obra con OC','LUGAR':'Temperley','OC':'4530009805','ESTADO':'En ejecución'}}}
  ];
  await window.__COI_CARTERA_V8_F1__.hydratePortfolio(records);
  window.COI_V2?.syncNav?.();
 });
 // El menú lateral está fuera del viewport en mobile. Disparamos el mismo click
 // del botón, igual que la prueba de navegación V2, sin desplazar el menú.
 await page.locator('#coiV8V2Nav').evaluate(button=>button.click());
 const text=await page.locator('#cv2Kpis').innerText();
 expect(text).toContain('Intervenciones');
 expect(text).toContain('Sin N.º obra');
 expect(text).toContain('Sin OC');
 expect(await page.locator('#cv2Kpis .cv2-kpi').count()).toBe(8);
 const kpis=await page.locator('#cv2Kpis .cv2-kpi').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.querySelector('small').textContent.trim(),Number(n.querySelector('strong').textContent.trim())])));
 expect(kpis['Intervenciones']).toBe(2);
 expect(kpis['Sin N.º obra']).toBe(1);
 expect(kpis['Sin OC']).toBe(1);
 expect(kpis['Con OC']).toBe(1);
});

test('V3 Servicios: pendientes documentales son métricas de cartera sin crear OC',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 const metrics=await page.evaluate(async()=>{
  const saved=[
   {id:'33333333-3333-4333-8333-333333333333',nro_oc:'4530009805',orden_id:null,datos:{descripcion:'Mantenimiento escaleras',proveedor:'FEMYP',estacion:'Constitución',acta_inicio:'2026-06-25',plazo_dias:120}},
   {id:'44444444-4444-4444-8444-444444444444',nro_oc:'4550000227',orden_id:null,datos:{descripcion:'Mantenimiento generador',proveedor:'PROVEEDOR',estacion:'Temperley',acta_inicio:'2026-06-01',plazo_dias:null}}
  ];
  window.__COI_SUPABASE_CLIENT__={
   auth:{getSession:async()=>({data:{session:{access_token:'qa'}},error:null})},
   from(table){return {select(){return this},eq(){return this},order(){return this},range(){return Promise.resolve({data:table==='coi_v3_cartera'?saved:[],error:null})}}}
  };
  await window.COI_V3.refreshServices();
  return {labels:Array.from(document.querySelectorAll('#coiV3SavedServices .coi-v3-stat')).map(e=>[e.querySelector('span')?.textContent?.trim(),e.querySelector('strong')?.textContent?.trim()]),rows:document.querySelectorAll('#coiV3SavedServices tbody tr').length,note:document.querySelector('#coiV3SavedServices p')?.textContent||''};
 });
 const labels=Object.fromEntries(metrics.labels);
 expect(metrics.rows).toBe(2);
 expect(labels['Intervenciones importadas']).toBe('2');
 expect(labels['Referencias sin OC vinculada']).toBe('2');
 expect(labels['Sin fecha de acta']).toBe('0');
 expect(labels['Sin plazo informado']).toBe('1');
 expect(metrics.note).toContain('sin inferir fechas ni plazos');
});
