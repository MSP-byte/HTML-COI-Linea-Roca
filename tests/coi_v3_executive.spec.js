const {test,expect}=require('@playwright/test');

test('V3 ejecutivo Obras: muestra faltantes administrativos sin inventar OC ni certificaciones',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>{
  const anchor=document.getElementById('cv2Kpis');
  if(!anchor)throw Error('Falta Cartera de Obras');
  window.COI_V3_EXECUTIVE.renderObras([
   {obra:'42',oc:'4530009806',estado:'En ejecución',avance:'25%'},
   {obra:'',oc:'',estado:'Enlace',avance:''},
   {obra:null,oc:null,estado:'Planificada',avance:0}
  ]);
 });
 const cards=page.locator('#coiV3ExecObras .ex-cell');
 await expect(cards).toHaveCount(4);
 await expect(cards.nth(0)).toContainText('3');
 await expect(cards.nth(1)).toContainText('2');
 await expect(cards.nth(2)).toContainText('2');
 await expect(cards.nth(3)).toContainText('2');
 await expect(page.locator('#coiV3ExecObras')).toContainText('no equivale a certificaciones SAP');
 await expect(page.locator('#coiV3ExecObras')).toContainText('En ejecución: 1');
});

test('V3 ejecutivo Servicios: separa cartera de contratos y filtra vínculos sin escrituras',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>window.mostrarVista('vistaServiciosV3'));
 await page.evaluate(()=>{
  const host=document.getElementById('coiV3Services');
  if(!host)throw Error('Falta contenedor de Servicios');
  host.innerHTML='<section id="coiV3SavedServices"><table><tbody>'+
   '<tr><td>vinculado</td></tr><tr><td>pendiente mensual</td></tr><tr><td>pendiente sin modalidad</td></tr>'+
   '</tbody></table></section>';
  const saved=[
   {orden_id:'33333333-3333-4333-8333-333333333333',datos:{modalidad_certificacion:'a demanda'}},
   {orden_id:null,datos:{modalidad_certificacion:'mensual'}},
   {orden_id:null,datos:{}}
  ];
  window.COI_V3_EXECUTIVE.renderServices([{tipo:'Servicio',nro_oc:'4530009805'}],saved,false);
 });
 const panel=page.locator('#coiV3ExecServicios'),cards=panel.locator('.ex-cell');
 await expect(cards).toHaveCount(4);
 await expect(cards.nth(0)).toContainText('3');
 await expect(cards.nth(1)).toContainText('1');
 await expect(cards.nth(2)).toContainText('2');
 await expect(cards.nth(3)).toContainText('1');
 await expect(panel).toContainText('Mensuales declaradas: 1');
 await expect(panel).toContainText('A demanda declaradas: 1');
 const select=page.locator('#coiV3ExecFilter');
 await select.selectOption('linked');
 await expect(page.locator('#coiV3SavedServices tbody tr:visible')).toHaveCount(1);
 await select.selectOption('pending');
 await expect(page.locator('#coiV3SavedServices tbody tr:visible')).toHaveCount(2);
 await select.selectOption('all');
 await expect(page.locator('#coiV3SavedServices tbody tr:visible')).toHaveCount(3);
});

test('V3 ejecutivo Ficha OC: distingue Obra y Servicio tras regenerar ficha',async({page})=>{
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>{
  document.getElementById('fichaOCBody').innerHTML=
    '<div class="oc-kpis"><div class="oc-kpi"><b>Obra</b><span>Tipo</span></div></div>';
 });
 await expect(page.locator('#coiV3ExecFicha')).toContainText('Obra: hitos, avance y actas');
 await page.evaluate(()=>{
  document.getElementById('fichaOCBody').innerHTML=
    '<div class="oc-kpis"><div class="oc-kpi"><b>Servicio</b><span>Tipo</span></div></div>';
 });
 await expect(page.locator('#coiV3ExecFicha')).toContainText('Servicio: prestaciones y certificación');
 await expect(page.locator('#coiV3ExecFicha')).toHaveCount(1);
 await expect(page.locator('#coiV3ExecFicha')).toContainText('no altera información');
});
