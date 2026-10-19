const {test,expect}=require('@playwright/test');

async function setup(page,{items,existing=[]}){
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.evaluate(({items,existing})=>{
  const columns=['N° OBRA','DENOMINACIÓN / PLIEGO','LUGAR','CONTRATISTA','OC'];
  const rawRows=items.map((r,i)=>({sourceRow:i+4,cells:[r.id||'',r.desc,r.station||'Temperley',r.provider||'FEMYP',r.oc||'']}));
  const snapshot={
   kind:'Obra',file:'OBRAS_LGR_PANEL_V8.xlsx',sheet:'BASE_OBRAS',headers:columns,rawRows,
   items:items.map((r,i)=>({row:i+4,oc:r.oc||'',outcome:r.outcome||'Sin número OC',descripcion:r.desc,
      estacion:r.station||'Temperley',proveedor:r.provider||'FEMYP',expediente:'',fecha_acta_inicio:'',plazo_dias:''}))
  };
  window.__v3TestSnapshot=snapshot;window.__v3Saved=[];
  window.COI_V3={...window.COI_V3,portfolioSnapshot:()=>window.__v3TestSnapshot};
  window.__COI_SUPABASE_CLIENT__={
   auth:{getSession:async()=>({data:{session:{user:{id:'00000000-0000-4000-8000-000000000001'}}},error:null})},
   from(name){if(name!=='coi_v3_cartera')throw Error('Escritura o lectura fuera de cartera: '+name);
    return {select(){return {eq(){return {order(){return {range:async()=>({data:existing,error:null})}}}}}}};
   },
   rpc:async(name,args)=>{if(name!=='coi_v3_confirmar_importacion')throw Error('RPC inesperada '+name);
    window.__v3Saved.push(structuredClone(args));return {data:{lote_id:'demo',nuevos:args.p_registros.length,actualizados:0,sin_cambios:0},error:null};
   }
  };
  window.dispatchEvent(new CustomEvent('coi:v3-preview-updated'));
 },{items,existing});
 await page.evaluate(()=>window.mostrarVista('vistaCarga'));
 await expect(page.locator('#vistaCarga')).toHaveClass(/\bactive\b/);
}
async function confirmSave(page){
 page.once('dialog',dlg=>dlg.accept());
 await page.locator('#coiV3PortfolioSave').click();
 await expect(page.locator('#coiV3PortfolioStatus')).toContainText('Importación confirmada');
 return page.evaluate(()=>window.__v3Saved);
}
test('V3 identidad: filas indistinguibles requieren homologacion incluso con cartera vacia',async({page})=>{
 await setup(page,{items:[{desc:'Anden norte'},{desc:'Anden norte'}]});
 await expect(page.locator('#coiV3PortfolioSave')).toBeDisabled();
 await expect(page.locator('#coiV3IdentityPanel select')).toHaveCount(2);
 await page.locator('select[data-v3-identity="4"]').selectOption('nuevo');
 await expect(page.locator('#coiV3PortfolioSave')).toBeDisabled();
 await page.locator('select[data-v3-identity="5"]').selectOption('nuevo');
 await expect(page.locator('#coiV3PortfolioSave')).toBeEnabled();
 const [saved]=await confirmSave(page);
 expect(saved.p_registros[0].clave_fuente).not.toBe(saved.p_registros[1].clave_fuente);
});
test('V3 identidad: obras sin numero administrativo reciben UUID interno independiente, sin OC ficticia',async({page})=>{
 await setup(page,{items:[
  {desc:'Vereda accesible',station:'Bernal'},
  {desc:'Obra de iluminacion',station:'Temperley'}
 ]});
 await expect(page.locator('#coiV3PortfolioSave')).toBeEnabled();
 const saved=await confirmSave(page);
 expect(saved).toHaveLength(1);
 const rows=saved[0].p_registros;
 expect(rows).toHaveLength(2);
 expect(rows[0].clave_fuente).toMatch(/^obra:uuid:[0-9a-f-]{36}$/);
 expect(rows[1].clave_fuente).toMatch(/^obra:uuid:[0-9a-f-]{36}$/);
 expect(rows[0].clave_fuente).not.toBe(rows[1].clave_fuente);
 expect(rows.every(r=>r.nro_oc===null&&r.datos.identificacion.id_obra_excel===null)).toBe(true);
 expect(rows.every(r=>r.datos.identificacion.estado_identidad==='PENDIENTE_IDENTIFICADOR_ADMIN')).toBe(true);
});
test('V3 identidad: cambio de denominacion necesita homologacion manual, preserva codigo previo y CAS',async({page})=>{
 const uuid='44444444-4444-4444-8444-444444444444',key='obra:uuid:'+uuid;
 const existing=[{id:uuid,clave_fuente:key,huella:'huella-servidor',datos:{descripcion:'Vereda antigua',estacion:'Bernal',
   identificacion:{perfil_conciliacion:JSON.stringify(['','VEREDAANTIGUA','BERNAL','FEMYP','',''])}}}];
 await setup(page,{items:[{desc:'Vereda nueva',station:'Bernal'}],existing});
 await expect(page.locator('#coiV3PortfolioSave')).toBeDisabled();
 await expect(page.locator('#coiV3IdentityPanel select')).toHaveCount(1);
 await page.locator('#coiV3IdentityPanel select').selectOption(key);
 await expect(page.locator('#coiV3PortfolioSave')).toBeEnabled();
 const [saved]=await confirmSave(page);
 const row=saved.p_registros[0];
 expect(row.clave_fuente).toBe(key);
 expect(row.huella_esperada).toBe('huella-servidor');
 expect(row.datos.descripcion).toBe('Vereda nueva');
});
test('V3 identidad: una OC repetida admite dos intervenciones de Obra sin duplicar contrato',async({page})=>{
 await setup(page,{items:[
  {id:'42',desc:'Anden norte',station:'Quilmes',oc:'4530009805',outcome:'Multifila'},
  {id:'42',desc:'Anden sur',station:'Quilmes',oc:'4530009805',outcome:'Multifila'}
 ]});
 await expect(page.locator('#coiV3PortfolioSave')).toBeEnabled();
 const [saved]=await confirmSave(page);
 expect(saved.p_registros).toHaveLength(2);
 expect(saved.p_registros[0].nro_oc).toBe('4530009805');
 expect(saved.p_registros[1].nro_oc).toBe('4530009805');
 expect(saved.p_registros[0].clave_fuente).not.toBe(saved.p_registros[1].clave_fuente);
});
test('V3 identidad: correspondencia ambigua exige seleccion explicita antes de guardar',async({page})=>{
 const sig=JSON.stringify(['','ANDEN','TEMPERLEY','FEMYP','','']);
 const existing=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'].map(id=>({
  id,clave_fuente:'obra:uuid:'+id,huella:'hash-'+id,datos:{identificacion:{perfil_conciliacion:sig},descripcion:'Anden'}
 }));
 await setup(page,{items:[{desc:'Anden'}],existing});
 await expect(page.locator('#coiV3PortfolioSave')).toBeDisabled();
 await expect(page.locator('#coiV3PortfolioStatus')).toContainText('Homologación requerida');
 await page.locator('#coiV3IdentityPanel select').selectOption('nuevo');
 await expect(page.locator('#coiV3PortfolioSave')).toBeEnabled();
 const [saved]=await confirmSave(page);
 expect(saved.p_registros[0].clave_fuente).not.toBe(existing[0].clave_fuente);
 expect(saved.p_registros[0].clave_fuente).not.toBe(existing[1].clave_fuente);
});
