const { test, expect } = require('@playwright/test');

/* 1° ETAPA — comportamiento real en navegador.
   El cliente Supabase es falso: estas pruebas no escriben datos remotos. */
const UID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL='admin@coiroca.com';
const OC='4530900100';
const ORDEN_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTA='control_terceros_con_acta';
const EVENTO=(codigo,fecha,motivo)=>({id:'ev-'+codigo+'-'+fecha,orden_id:ORDEN_ID,nro_oc:OC,tipo_evento:'Circuito administrativo',campo_modificado:codigo,fecha_evento:fecha,usuario_email:EMAIL,motivo:motivo||null});
const OBS=(codigo,fecha,motivo)=>({id:'obs-'+codigo+'-'+fecha,orden_id:ORDEN_ID,nro_oc:OC,tipo_evento:'Observación circuito administrativo',campo_modificado:codigo,fecha_evento:fecha,usuario_email:EMAIL,motivo});
const CONFLICTO=(fecha,actual,confirmacion,motivo='conflicto')=>({id:'acta-'+fecha,orden_id:ORDEN_ID,nro_oc:OC,tipo_evento:'Conciliación Acta de Inicio',campo_modificado:'fecha_acta_inicio',fecha_evento:fecha,usuario_email:EMAIL,valor_anterior:actual,valor_nuevo:confirmacion,motivo});

async function preparar(page,opciones={}){
 const c=Object.assign({historial:[],fecha_acta_inicio:null,estado_coi:'En ejecución',fallaRpc:false,demoraRpc:0,ordenExtra:{}},opciones);
 await page.route(url=>url.hostname!=='127.0.0.1',r=>r.abort());
 await page.addInitScript(({c,uid,email,oc,ordenId})=>{
  const orden=Object.assign({id:ordenId,nro_oc:oc,numeroOC:oc,oc,id_obra:'OBRA-'+oc,tipo:'Servicio',descripcion:'Servicio E1',proveedor:'PROVEEDOR E1',estacion:'PLAZA CONSTITUCION',estado_coi:c.estado_coi,estado_documental:c.estado_coi,fecha_acta_inicio:c.fecha_acta_inicio,monto_total:1000,moneda:'ARS'},c.ordenExtra||{});
  window.__E1__={rpc:[],historial:c.historial.slice(),orden};
  function consulta(tabla){const datos=()=>tabla==='coi_ordenes'?[orden]:tabla==='coi_historial_oc'?window.__E1__.historial:[];const api={select(){return api},order(){return api},limit(){return api},range(){return api},in(){return api},is(){return api},ilike(){return api},gt(){return api},eq(){return api},single:async()=>({data:datos()[0]||null,error:null}),then(res,rej){return Promise.resolve({data:datos().map(x=>Object.assign({},x)),error:null}).then(res,rej)}};return api}
  const fake={from:t=>consulta(t),rpc:async(nombre,args)=>{window.__E1__.rpc.push({nombre,args:JSON.parse(JSON.stringify(args||{}))});if(nombre==='coi_current_role')return{data:'administrador',error:null};if(!['coi_confirmar_etapa_circuito_v2','coi_confirmar_etapa_circuito_v3'].includes(nombre))return{data:null,error:null};if(c.demoraRpc)await new Promise(r=>setTimeout(r,c.demoraRpc));if(c.fallaRpc)return{data:null,error:{code:'42501',message:'fixture E1: escritura rechazada'}};const codigo=args.p_codigo;const ev={id:'ev-'+codigo+'-'+Date.now(),orden_id:ordenId,nro_oc:oc,tipo_evento:'Circuito administrativo',campo_modificado:codigo,fecha_evento:new Date().toISOString(),fecha_efectiva:args.p_fecha_efectiva||null,usuario_email:email,motivo:args.p_observacion||null};window.__E1__.historial.push(ev);return{data:{orden,historial:[ev],codigo,nombre:codigo,ya_confirmada:false},error:null}},auth:{getSession:async()=>({data:{session:{user:{id:uid,email}}},error:null}),getUser:async()=>({data:{user:{id:uid,email}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
  window.__COI_SUPABASE_CLIENT__=fake;window.getSupabaseClient=()=>fake;window.initSupabase=async()=>fake;window.getUsuarioActual=async()=>({id:uid,email});window.getUsuarioActualR12=async()=>({id:uid,email});window.esAutorizacionAdministrativaSupabaseV60=()=>true;
 },{c,uid:UID,email:EMAIL,oc:OC,ordenId:ORDEN_ID});
}
async function abrir(page){await page.goto('/index.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.__COI_ETAPA1_RENDER__==='function',null,{timeout:20000});await page.evaluate(()=>{window.actualizarEstadoDocumentalDesdePasoContractual=async(_nro,paso,options={})=>{const codigo=typeof paso==='string'?paso:paso.codigo;const r=await window.__COI_SUPABASE_CLIENT__.rpc('coi_confirmar_etapa_circuito_v2',{p_orden_id:window.__E1__.orden.id,p_codigo:codigo,p_observacion:(options&&options.observacion)||null});if(r.error)throw r.error;return{nro_oc:window.__E1__.orden.nro_oc,estado:codigo,synced:true,...r.data};};});}
async function pintar(page){await page.evaluate(({oc})=>{
 // El renderer aislado usa exactamente las dos dependencias que en la Ficha
 // real proveen el circuito: resolver de OC y cache canonica de historial.
 const baseResolver=window.resolverOrdenActual;
 window.resolverOrdenActual=(x)=>{const v=typeof x==='string'?x:(x&&(x.nro_oc||x.numeroOC||x.oc));if(String(v||'')===oc)return window.__E1__.orden;return typeof baseResolver==='function'?baseResolver(x):null};
 window.__COI_CIRCUITO_CACHE_GET__=()=>window.__E1__.historial;
 let host=document.getElementById('e1Host');if(!host){host=document.createElement('div');host.id='e1Host';document.body.appendChild(host)}
 host.innerHTML=window.__COI_ETAPA1_RENDER__(window.__E1__.orden);
},{oc:OC});await page.waitForTimeout(100)}
const estado=page=>page.evaluate(()=>({hitos:document.querySelectorAll('#etapa1Pipeline [data-etapa1-hito]').length,avance:(document.getElementById('etapa1Avance')||{}).textContent||'',estadoActual:(document.getElementById('etapa1EstadoActual')||{}).textContent||'',etapa2:(document.getElementById('etapa1Panel2')||{}).getAttribute?.('data-etapa1-habilitada')||'',avisoActa:!!document.getElementById('etapa1AvisoActa'),transversal:(document.getElementById('etapa1AvisoTransversal')||{}).textContent||'',visuales:Array.from(document.querySelectorAll('#etapa1Pipeline [data-etapa1-hito]')).map(b=>({codigo:b.dataset.etapa1Hito,clase:b.className}))}));
const rpcConfirmaciones=page=>page.evaluate(()=>window.__E1__.rpc.filter(r=>r.nombre==='coi_confirmar_etapa_circuito_v2'));
async function setup(page,opt){await preparar(page,opt);await abrir(page);await pintar(page)}

// F/G/J/K — render y gate
test('E1-1 · F · la 1° Etapa renderiza exactamente 8 hitos',async({page})=>{await setup(page);const e=await estado(page);expect(e.hitos).toBe(8);expect(e.avance).toBe('0 / 10');expect(e.estadoActual).toBe('Sin iniciar')});
test('E1-2 · G · cancelada/suspendida no cuenta en X/10 y se muestra aparte',async({page})=>{await setup(page,{estado_coi:'OBRA/SERVICIO CANCELADA O SUSPENDIDA',historial:[EVENTO('cancelada_suspendida','2026-09-01T10:00:00Z')]});const e=await estado(page);expect(e.avance).toBe('0 / 10');expect(await page.locator('#etapa1Transversal [data-etapa1-hito]').count()).toBe(1);expect(e.transversal).toContain('antes del inicio')});
test('E1-3 · K · el último hito 1–7 se muestra EN CURSO',async({page})=>{await setup(page,{historial:[EVENTO('pliegos_preparacion','2026-09-01T10:00:00Z'),EVENTO('pliegos_terminado_sin_solped','2026-09-04T10:00:00Z')]});const e=await estado(page),m=Object.fromEntries(e.visuales.map(v=>[v.codigo,v.clase]));expect(m.pliegos_preparacion).toContain('etapa1-completado');expect(m.pliegos_terminado_sin_solped).toContain('etapa1-actual');expect(e.avance).toBe('2 / 10')});
test('E1-4 · J · el hito 8 confirmado se muestra COMPLETADO y cierra la 1° Etapa',async({page})=>{await setup(page,{historial:[EVENTO(ACTA,'2026-09-05T10:00:00Z')],fecha_acta_inicio:'2026-09-05'});const e=await estado(page);expect(e.visuales.find(v=>v.codigo===ACTA).clase).toContain('etapa1-completado');expect(e.estadoActual).toBe('1° Etapa finalizada');expect(e.etapa2).toBe('si')});
test('E1-5 · D · hito 8 sin fecha canónica: gate habilitado y conciliación pendiente',async({page})=>{await setup(page,{historial:[EVENTO(ACTA,'2026-09-05T10:00:00Z')]});const e=await estado(page);expect(e.etapa2).toBe('si');expect(e.avisoActa).toBe(true)});
test('E1-6 · OC histórica con fecha de acta mantiene la 2° Etapa habilitada',async({page})=>{await setup(page,{fecha_acta_inicio:'2025-06-30'});const e=await estado(page);expect(e.etapa2).toBe('si');expect(e.avance).toBe('0 / 10')});

// L/M/N/I — modal y persistencia
test('E1-7 · L · el click abre el modal y cancelar no escribe nada',async({page})=>{await setup(page);await page.click('[data-etapa1-hito="pliegos_preparacion"]');await expect(page.locator('#etapa1ModalConfirmar')).toBeVisible();expect(await page.locator('#etapa1ModalOC').textContent()).toContain(OC);expect(await page.locator('#etapa1ModalUsuario').textContent()).toContain(EMAIL);await page.click('#etapa1ModalCancelar');expect(await rpcConfirmaciones(page)).toHaveLength(0)});
test('E1-8 · N · saltar un hito avisa y no autocompleta los anteriores',async({page})=>{await setup(page);await page.click('[data-etapa1-hito="pliego_con_expediente"]');await expect(page.locator('#etapa1ModalAvisoSalto')).toBeVisible();await page.click('#etapa1ModalConfirmarBtn');await page.waitForTimeout(500);const r=await rpcConfirmaciones(page);expect(r).toHaveLength(1);expect(r[0].args.p_codigo).toBe('pliego_con_expediente');expect((await estado(page)).avance).toBe('1 / 10')});
test('E1-9 · confirmar persiste hito, usuario y observación',async({page})=>{await setup(page);await page.click('[data-etapa1-hito="pliegos_preparacion"]');await page.fill('#etapa1ModalObs','Pliego enviado a revisión');await page.click('#etapa1ModalConfirmarBtn');await page.waitForTimeout(500);const r=await rpcConfirmaciones(page);expect(r).toHaveLength(1);expect(r[0].args.p_observacion).toBe('Pliego enviado a revisión')});
test('E1-10 · M · el doble click no duplica el registro',async({page})=>{await setup(page,{demoraRpc:500});await page.click('[data-etapa1-hito="pliegos_preparacion"]');await page.evaluate(()=>{const b=document.getElementById('etapa1ModalConfirmarBtn');b.click();b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))});await page.waitForTimeout(900);expect(await rpcConfirmaciones(page)).toHaveLength(1)});
test('E1-11 · I · si Supabase falla, la interfaz no simula éxito',async({page})=>{await setup(page,{fallaRpc:true});await page.click('[data-etapa1-hito="pliegos_preparacion"]');await page.click('#etapa1ModalConfirmarBtn');await expect(page.locator('#etapa1ModalError')).toBeVisible();expect((await estado(page)).avance).toBe('0 / 10')});

// H/O y hardening
test('E1-12 · H · tras recargar, el pipeline se reconstruye desde el historial remoto',async({page})=>{await setup(page,{historial:[EVENTO('pliegos_preparacion','2026-09-01T10:00:00Z'),EVENTO('pliegos_terminado_sin_solped','2026-09-03T10:00:00Z')]});expect((await estado(page)).avance).toBe('2 / 10');await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.__COI_ETAPA1_RENDER__==='function');await pintar(page);expect((await estado(page)).avance).toBe('2 / 10')});
test('E1-13 · O · la Ficha OC no muestra dos pipelines contractuales',async({page})=>{await preparar(page);await abrir(page);const s=await page.evaluate(oc=>window.renderChecksDocumentales({numeroOC:oc,oc,nro_oc:oc,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),OC);expect(s).toContain('etapa1PipelineContractual');expect(s).not.toContain('circuitoAdministrativoOCR18')});
test('E1-14 · E · cancelada/suspendida se puede registrar con la 2° Etapa bloqueada',async({page})=>{await setup(page);await page.click('#etapa1Transversal [data-etapa1-hito]');await page.click('#etapa1ModalConfirmarBtn');await page.waitForTimeout(500);const r=await rpcConfirmaciones(page);expect(r).toHaveLength(1);expect(r[0].args.p_codigo).toBe('cancelada_suspendida');expect((await estado(page)).avance).toBe('0 / 10')});
test('E1-15 · F1 · el hito 7 «SIN ACTA DE INICIO» no habilita la 2° Etapa',async({page})=>{await setup(page,{estado_coi:'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',historial:[EVENTO('control_terceros_sin_acta','2026-09-02T10:00:00Z')]});const e=await estado(page);expect(e.etapa2).toBe('no');expect(e.avance).toBe('1 / 10')});
test('E1-16 · F1 · el mismo estado SÍ habilita la 2° Etapa si hay fecha de acta',async({page})=>{await setup(page,{estado_coi:'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',historial:[EVENTO('control_terceros_sin_acta','2026-09-02T10:00:00Z')],fecha_acta_inicio:'2026-09-03'});expect((await estado(page)).etapa2).toBe('si')});
test('E1-17 · F3 · un backfill retrospectivo no retrocede el estado actual',async({page})=>{await setup(page,{historial:[EVENTO('pliego_con_expediente','2026-09-10T12:00:00Z'),EVENTO('solped_sin_expediente','2026-09-15T09:00:00Z')]});const e=await estado(page);expect(e.estadoActual).toContain('EXPTE');expect(e.visuales.find(v=>v.codigo==='pliego_con_expediente').clase).toContain('etapa1-actual')});
/* MODIFICADO (modelo de 10 hitos lógicos, T18).
   ANTES: H3 (01/09) → H5 (11/09) mostraba «—» en H3: la duración solo se
   medía contra el hito contractual N+1 y un salto se trataba como hueco.
   AHORA: la duración de un estado queda CONGELADA al pasar al estado
   siguiente REAL, aunque se hayan saltado hitos: H3 duró 10 días. Lo que no
   se inventa es la duración de los hitos salteados (H4 sigue en «—»). */
test('E1-18 · F3 · un salto congela la duración del estado anterior y no inventa la de los salteados',async({page})=>{await setup(page,{historial:[EVENTO('solped_sin_expediente','2026-09-01T10:00:00Z'),EVENTO('pliego_con_expediente','2026-09-11T10:00:00Z')]});expect(await page.locator('[data-etapa1-hito="solped_sin_expediente"] .etapa1-dias').textContent()).toContain('Días en etapa: 10');expect(await page.locator('[data-etapa1-hito="pliego_con_oc"] .etapa1-dias').textContent()).toContain('—')});
test('E1-19 · F3 · un siguiente con fecha anterior tampoco produce duración',async({page})=>{await setup(page,{historial:[EVENTO('solped_sin_expediente','2026-09-10T10:00:00Z'),EVENTO('pliego_con_oc','2026-09-01T10:00:00Z')]});expect(await page.locator('[data-etapa1-hito="solped_sin_expediente"] .etapa1-dias').textContent()).toContain('—')});
test('E1-20 · F4 · una suspensión superada conserva historial pero no muestra banner',async({page})=>{await setup(page,{estado_coi:'PLIEGO CON EXPTE',historial:[EVENTO('cancelada_suspendida','2026-09-02T10:00:00Z'),EVENTO('pliego_con_expediente','2026-09-20T10:00:00Z')]});const e=await estado(page);expect(e.transversal).toBe('');expect(await page.locator('#etapa1Transversal [data-etapa1-hito]').getAttribute('class')).toContain('etapa1-completado')});
test('E1-21 · F4 · con la suspensión vigente el banner sí aparece',async({page})=>{await setup(page,{estado_coi:'OBRA/SERVICIO CANCELADA O SUSPENDIDA',historial:[EVENTO('cancelada_suspendida','2026-09-02T10:00:00Z')]});expect((await estado(page)).transversal).toContain('antes del inicio')});
test('E1-22 · F5 · tras confirmar el hito 8 no aparece el aviso de conciliación',async({page})=>{await preparar(page);await abrir(page);await page.evaluate(()=>{const base=window.__COI_SUPABASE_CLIENT__.rpc;window.__COI_SUPABASE_CLIENT__.rpc=async(n,a)=>{const r=await base(n,a);if(n==='coi_confirmar_etapa_circuito_v2'&&r.data){r.data.orden=Object.assign({},r.data.orden,{fecha_acta_inicio:'2026-09-15'});r.data.acta_inicio={estado:'registrada',valor:'2026-09-15',valor_confirmacion:'2026-09-15'}}return r}});await pintar(page);await page.click('[data-etapa1-hito="control_terceros_con_acta"]');await page.click('#etapa1ModalConfirmarBtn');await page.waitForTimeout(600);const e=await estado(page);expect(e.etapa2).toBe('si');expect(e.avisoActa).toBe(false)});
test('E1-23 · F1 · la tarjeta de saldo remanente resuelve y abre el modal',async({page})=>{await setup(page,{fecha_acta_inicio:'2026-09-01'});expect(await page.locator('#etapa1Panel2 [data-etapa1-hito="finalizada_saldo_remanente"]').count()).toBe(1);await page.evaluate(()=>{document.getElementById('etapa1Panel1').classList.remove('active');document.getElementById('etapa1Panel2').classList.add('active')});await page.click('#etapa1Panel2 [data-etapa1-hito="finalizada_saldo_remanente"]');await expect(page.locator('#etapa1ModalConfirmar')).toBeVisible()});
test('E1-24 · F2a · fecha de acta sin evento: 1° Etapa finalizada por evidencia histórica',async({page})=>{await setup(page,{fecha_acta_inicio:'2025-06-30'});const e=await estado(page);expect(e.estadoActual).toContain('evidencia histórica');expect(e.avance).toBe('0 / 10');expect(e.visuales.find(v=>v.codigo===ACTA).clase).toContain('etapa1-pendiente')});
test('E1-25 · F2b · estado legacy de ejecución sin evento: muestra el estado vigente canónico',async({page})=>{await setup(page,{estado_coi:'OBRA/SERVICIO EN EJECUCIÓN'});const e=await estado(page);expect(e.estadoActual).toContain('SERVICIO EN EJECUCIÓN');expect(e.etapa2).toBe('si')});
test('E1-26 · F2 · con evento real el hito 8 sí figura COMPLETADO y sin etiqueta legacy',async({page})=>{await setup(page,{historial:[EVENTO(ACTA,'2026-09-05T10:00:00Z')],fecha_acta_inicio:'2026-09-05'});const e=await estado(page);expect(e.estadoActual).toBe('1° Etapa finalizada');expect(e.visuales.find(v=>v.codigo===ACTA).clase).toContain('etapa1-completado')});

async function instalarActaRpc(page,estadoActa){await page.evaluate(({estadoActa})=>{window.__E1_ESTADO_ACTA__=estadoActa;const base=window.__COI_SUPABASE_CLIENT__.rpc;window.__COI_SUPABASE_CLIENT__.rpc=async(n,a)=>{const r=await base(n,a);if(n==='coi_confirmar_etapa_circuito_v2'&&r.data)r.data.acta_inicio={estado:window.__E1_ESTADO_ACTA__,valor:'2026-03-10',valor_confirmacion:'2026-09-15'};return r}},{estadoActa})}
test('E1-27 · F3 · el conflicto de fecha de acta queda visible sin window.toast',async({page})=>{await preparar(page,{fecha_acta_inicio:'2026-03-10'});await abrir(page);await instalarActaRpc(page,'conflicto');await pintar(page);await page.click('[data-etapa1-hito="control_terceros_con_acta"]');await page.click('#etapa1ModalConfirmarBtn');await page.waitForTimeout(600);await expect(page.locator('#etapa1AvisoConflictoActa')).toBeVisible();expect(await page.locator('#etapa1AvisoConflictoActa').textContent()).toContain('Se preservó el dato contractual existente')});
test('E1-28 · F3 · una conciliación exitosa posterior limpia la advertencia',async({page})=>{await preparar(page,{fecha_acta_inicio:'2026-03-10'});await abrir(page);await instalarActaRpc(page,'conflicto');await pintar(page);await page.click('[data-etapa1-hito="control_terceros_con_acta"]');await page.click('#etapa1ModalConfirmarBtn');await page.waitForTimeout(600);await expect(page.locator('#etapa1AvisoConflictoActa')).toBeVisible();await page.evaluate(()=>window.__E1_ESTADO_ACTA__='coincide');await page.click('[data-etapa1-hito="control_terceros_con_acta"]');await page.click('#etapa1ModalConfirmarBtn');await page.waitForTimeout(600);expect(await page.locator('#etapa1AvisoConflictoActa').count()).toBe(0)});


// Review hardening — aliases, normalización, observaciones y carreras
 test('E1-29 · alias actaInicio habilita gate histórico',async({page})=>{await setup(page,{fecha_acta_inicio:null,ordenExtra:{actaInicio:'2026-06-01'}});expect((await estado(page)).etapa2).toBe('si')});
 test('E1-30 · alias fechaInicio habilita gate histórico',async({page})=>{await setup(page,{fecha_acta_inicio:null,ordenExtra:{fechaInicio:'2026-06-01'}});expect((await estado(page)).etapa2).toBe('si')});
 test('E1-31 · variante 3° legacy resuelve igual que 3º',async({page})=>{await setup(page,{estado_coi:'PLIEGO CON OC Y CONTROL DE 3° CON ACTA DE INICIO'});expect((await estado(page)).etapa2).toBe('si')});
 test('E1-32 · transversal muestra la suspensión más reciente',async({page})=>{await setup(page,{estado_coi:'OBRA/SERVICIO CANCELADA O SUSPENDIDA',historial:[EVENTO('cancelada_suspendida','2026-09-01T10:00:00Z','primera'),EVENTO('cancelada_suspendida','2026-09-12T10:00:00Z','segunda')]});const meta=await page.locator('#etapa1Transversal .etapa1-meta').textContent();expect(meta).toContain('12/09/2026')});
 test('E1-33 · observación posterior permanece visible',async({page})=>{await setup(page,{historial:[EVENTO('pliegos_preparacion','2026-09-01T10:00:00Z'),OBS('pliegos_preparacion','2026-09-03T10:00:00Z','Seguimiento posterior')]});await expect(page.locator('[data-etapa1-hito="pliegos_preparacion"] .etapa1-obs')).toContainText('Observaciones: 1')});
 test('E1-34 · conflicto persistido se reconstruye desde historial remoto',async({page})=>{await setup(page,{fecha_acta_inicio:'2026-03-10',historial:[EVENTO(ACTA,'2026-09-15T10:00:00Z'),CONFLICTO('2026-09-15T10:00:01Z','2026-03-10','2026-09-15')]});await expect(page.locator('#etapa1AvisoConflictoActa')).toBeVisible();await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.__COI_ETAPA1_RENDER__==='function');await page.evaluate(()=>{window.actualizarEstadoDocumentalDesdePasoContractual=async()=>({});});await pintar(page);await expect(page.locator('#etapa1AvisoConflictoActa')).toBeVisible()});
 test('E1-35 · Escape durante await no aplica respuesta a otro modal',async({page})=>{await setup(page,{demoraRpc:400});await page.click('[data-etapa1-hito="pliegos_preparacion"]');await page.click('#etapa1ModalConfirmarBtn');await page.keyboard.press('Escape');await page.waitForTimeout(650);expect(await page.locator('#etapa1ModalConfirmar').count()).toBe(0);expect(await rpcConfirmaciones(page)).toHaveLength(1)});
 test('E1-36 · repintado asíncrono rechaza host de UUID distinto',async({page})=>{await setup(page);const r=await page.evaluate(()=>{const h=document.getElementById('etapa1PipelineContractual');h.setAttribute('data-etapa1-orden-id','cccccccc-cccc-4ccc-8ccc-cccccccccccc');const antes=h.outerHTML;const ok=window.__COI_ETAPA1_REPINTAR__(window.__E1__.orden,window.__E1__.orden.id);return{ok,igual:document.getElementById('etapa1PipelineContractual').outerHTML===antes};});expect(r.ok).toBe(false);expect(r.igual).toBe(true)});


test('E1-37 · producción · hito v3 queda remoto, muestra fecha y suma X/10 sin guardar local',async({page})=>{
  await preparar(page);
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.actualizarEstadoDocumentalDesdePasoContractual==='function'&&typeof window.__COI_CIRCUITO_CACHE_MERGE__==='function'&&typeof window.__COI_ETAPA1_RENDER__==='function',null,{timeout:20000});
  const r=await page.evaluate(async({oc})=>{
    window.APP_STATE=window.APP_STATE||{};
    window.APP_STATE.role='coi';
    window.APP_STATE.user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'admin@coiroca.com'};
    window.__COI_H14_PROFILE__={activo:true};
    let localWrites=0;
    window.guardarBaseLocal=()=>{localWrites++;return true;};
    const baseResolver=window.resolverOrdenActual;
    window.resolverOrdenActual=(x)=>{
      const v=typeof x==='string'?x:(x&&(x.nro_oc||x.numeroOC||x.oc));
      if(String(v||'').replace(/^OC[-_ ]*/i,'')===oc)return window.__E1__.orden;
      return typeof baseResolver==='function'?baseResolver(x):null;
    };
    const etapa=(window.CIRCUITO_ADMINISTRATIVO_ETAPAS||[]).find(e=>e.codigo==='pliegos_preparacion');
    await window.actualizarEstadoDocumentalDesdePasoContractual(oc,etapa,{fechaEfectiva:'2026-09-05',observacion:'Registro real v3',allowLocalFallback:false});
    const hist=window.__COI_CIRCUITO_CACHE_GET__(oc)||[];
    const wrap=document.createElement('div');
    wrap.innerHTML=window.__COI_ETAPA1_RENDER__(window.__E1__.orden);
    const hito=wrap.querySelector('[data-etapa1-hito="pliegos_preparacion"]');
    return{
      localWrites,
      historial:hist.length,
      fecha:hist[0]?.fecha_efectiva||'',
      avance:wrap.querySelector('#etapa1Avance')?.textContent||'',
      meta:hito?.querySelector('.etapa1-meta')?.textContent||'',
      rpcV3:window.__E1__.rpc.filter(x=>x.nombre==='coi_confirmar_etapa_circuito_v3').length
    };
  },{oc:OC});
  expect(r.rpcV3).toBe(1);
  expect(r.localWrites).toBe(0);
  expect(r.historial).toBeGreaterThanOrEqual(1);
  expect(r.fecha).toBe('2026-09-05');
  expect(r.avance).toBe('1 / 10');
  expect(r.meta).toContain('05/09/2026');
});


test('E1-38 · producción · avanzar de hito conserva cada fecha y deja como actual el más reciente',async({page})=>{
  await preparar(page);
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.actualizarEstadoDocumentalDesdePasoContractual==='function'&&typeof window.__COI_CIRCUITO_CACHE_MERGE__==='function'&&typeof window.__COI_ETAPA1_RENDER__==='function',null,{timeout:20000});
  const r=await page.evaluate(async({oc})=>{
    window.APP_STATE=window.APP_STATE||{};
    window.APP_STATE.role='coi';
    window.APP_STATE.user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'admin@coiroca.com'};
    window.__COI_H14_PROFILE__={activo:true};
    let localWrites=0;
    window.guardarBaseLocal=()=>{localWrites++;return true;};
    const baseResolver=window.resolverOrdenActual;
    window.resolverOrdenActual=(x)=>{
      const v=typeof x==='string'?x:(x&&(x.nro_oc||x.numeroOC||x.oc));
      if(String(v||'').replace(/^OC[-_ ]*/i,'')===oc)return window.__E1__.orden;
      return typeof baseResolver==='function'?baseResolver(x):null;
    };
    const etapas=window.CIRCUITO_ADMINISTRATIVO_ETAPAS||[];
    const primera=etapas.find(e=>e.codigo==='pliegos_preparacion');
    const segunda=etapas.find(e=>e.codigo==='pliegos_terminado_sin_solped');
    await window.actualizarEstadoDocumentalDesdePasoContractual(oc,primera,{fechaEfectiva:'2026-09-05',observacion:'Primera etapa histórica',allowLocalFallback:false});
    await new Promise(resolve=>setTimeout(resolve,8));
    await window.actualizarEstadoDocumentalDesdePasoContractual(oc,segunda,{fechaEfectiva:'2026-09-08',observacion:'Segundo estado vigente',allowLocalFallback:false});
    const hist=(window.__COI_CIRCUITO_CACHE_GET__(oc)||[]).filter(x=>x&&x.tipo_evento==='Circuito administrativo');
    const fechas=Object.fromEntries(hist.map(x=>[x.campo_modificado,x.fecha_efectiva||'']));
    const wrap=document.createElement('div');
    wrap.innerHTML=window.__COI_ETAPA1_RENDER__(window.__E1__.orden);
    const meta=codigo=>wrap.querySelector(`[data-etapa1-hito="${codigo}"] .etapa1-meta`)?.textContent||'';
    return{
      localWrites,
      rpcV3:window.__E1__.rpc.filter(x=>x.nombre==='coi_confirmar_etapa_circuito_v3').length,
      historial:hist.length,
      fechas,
      avance:wrap.querySelector('#etapa1Avance')?.textContent||'',
      estadoActual:wrap.querySelector('#etapa1EstadoActual')?.textContent||'',
      metaPrimera:meta('pliegos_preparacion'),
      metaSegunda:meta('pliegos_terminado_sin_solped')
    };
  },{oc:OC});
  expect(r.localWrites).toBe(0);
  expect(r.rpcV3).toBe(2);
  expect(r.historial).toBeGreaterThanOrEqual(2);
  expect(r.fechas.pliegos_preparacion).toBe('2026-09-05');
  expect(r.fechas.pliegos_terminado_sin_solped).toBe('2026-09-08');
  expect(r.avance).toBe('2 / 10');
  expect(r.metaPrimera).toContain('05/09/2026');
  expect(r.metaSegunda).toContain('08/09/2026');
  expect(r.estadoActual).toContain('PLIEGOS TERMINADO SIN SOLPED');
});


test('E1-39 · producción · 2° Etapa conserva fecha propia al avanzar ejecución → finalizada → cierre con actas',async({page})=>{
  await preparar(page,{fecha_acta_inicio:'2026-09-01'});
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.actualizarEstadoDocumentalDesdePasoContractual==='function'&&typeof window.__COI_ETAPA1_RENDER__==='function',null,{timeout:20000});
  const r=await page.evaluate(async({oc})=>{
    window.APP_STATE=window.APP_STATE||{};
    window.APP_STATE.role='coi';
    window.APP_STATE.user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'admin@coiroca.com'};
    window.__COI_H14_PROFILE__={activo:true};
    let localWrites=0;
    window.guardarBaseLocal=()=>{localWrites++;return true;};
    const baseResolver=window.resolverOrdenActual;
    window.resolverOrdenActual=(x)=>{
      const v=typeof x==='string'?x:(x&&(x.nro_oc||x.numeroOC||x.oc));
      if(String(v||'').replace(/^OC[-_ ]*/i,'')===oc)return window.__E1__.orden;
      return typeof baseResolver==='function'?baseResolver(x):null;
    };
    const etapas=window.CIRCUITO_ADMINISTRATIVO_ETAPAS||[];
    const ejecucion=etapas.find(e=>e.codigo==='ejecucion');
    const finalizada=etapas.find(e=>e.codigo==='finalizada');
    const cierre=etapas.find(e=>e.codigo==='finalizada_actas');
    await window.actualizarEstadoDocumentalDesdePasoContractual(oc,ejecucion,{fechaEfectiva:'2026-09-10',observacion:'Inicio ejecución',allowLocalFallback:false});
    await window.actualizarEstadoDocumentalDesdePasoContractual(oc,finalizada,{fechaEfectiva:'2026-09-20',observacion:'Finalización',allowLocalFallback:false});
    await window.actualizarEstadoDocumentalDesdePasoContractual(oc,cierre,{fechaEfectiva:'2026-09-24',observacion:'Cierre con actas',allowLocalFallback:false});
    const hist=(window.__COI_CIRCUITO_CACHE_GET__(oc)||[]).filter(x=>x&&x.tipo_evento==='Circuito administrativo');
    const wrap=document.createElement('div');
    wrap.innerHTML=window.__COI_ETAPA1_RENDER__(window.__E1__.orden);
    const meta=codigo=>wrap.querySelector(`#etapa1Panel2 [data-etapa1-hito="${codigo}"] .etapa1-meta`)?.textContent||'';
    const fechas=Object.fromEntries(hist.map(x=>[x.campo_modificado,x.fecha_efectiva||'']));
    const tarjeta=codigo=>wrap.querySelector(`#etapa1Panel2 [data-etapa1-hito="${codigo}"]`);
    return{
      localWrites,
      rpcV3:window.__E1__.rpc.filter(x=>x.nombre==='coi_confirmar_etapa_circuito_v3').length,
      fechas,
      ejecucion:meta('ejecucion'),
      finalizada:meta('finalizada'),
      cierre:meta('finalizada_actas'),
      claseEjecucion:tarjeta('ejecucion')?.className||'',
      claseFinalizada:tarjeta('finalizada')?.className||'',
      claseCierre:tarjeta('finalizada_actas')?.className||'',
      estadoCierre:tarjeta('finalizada_actas')?.querySelector('.etapa1-estado')?.textContent||'',
      estadoActual:wrap.querySelector('#etapa1EstadoActual')?.textContent||''
    };
  },{oc:OC});
  expect(r.localWrites).toBe(0);
  expect(r.rpcV3).toBe(3);
  expect(r.fechas.ejecucion).toBe('2026-09-10');
  expect(r.fechas.finalizada).toBe('2026-09-20');
  expect(r.fechas.finalizada_actas).toBe('2026-09-24');
  expect(r.ejecucion).toContain('Fecha efectiva: 10/09/2026');
  expect(r.finalizada).toContain('Fecha efectiva: 20/09/2026');
  expect(r.cierre).toContain('Fecha efectiva: 24/09/2026');
  expect(r.claseEjecucion).toContain('etapa1-completado');
  expect(r.claseFinalizada).toContain('etapa1-completado');
  expect(r.claseCierre).toContain('etapa1-actual');
  expect(r.estadoCierre).toContain('EN CURSO');
  expect(r.estadoActual).toContain('FINALIZADO CON ACTA PROVISORIA Y DEFINITIVA');
});

test('E1-40 · 2° Etapa reconstruye fecha desde traza histórica Cambio de estado contractual',async({page})=>{
  const legacy={
    id:'legacy-finalizada',
    orden_id:ORDEN_ID,
    nro_oc:OC,
    tipo_evento:'Cambio de estado contractual',
    campo_modificado:'estado_documental',
    valor_nuevo:'OBRA/SERVICIO FINALIZADA',
    fecha_evento:'2026-09-20T13:15:00Z',
    fecha_efectiva:'2026-09-20',
    usuario_email:EMAIL
  };
  await setup(page,{fecha_acta_inicio:'2026-09-01',estado_coi:'OBRA/SERVICIO FINALIZADA',historial:[legacy]});
  const meta=await page.locator('#etapa1Panel2 [data-etapa1-hito="finalizada"] .etapa1-meta').textContent();
  expect(meta).toContain('Fecha efectiva: 20/09/2026');
  expect(meta).not.toContain(EMAIL);
});


test('E1-41 · nro_oc puro conserva la clave canónica y muestra fecha de 2° Etapa',async({page})=>{
  const ev=EVENTO('finalizada','2026-09-25T12:00:00-03:00');
  ev.fecha_efectiva='2026-09-25';
  await preparar(page,{fecha_acta_inicio:'2026-02-23',estado_coi:'OBRA/SERVICIO FINALIZADA',historial:[ev]});
  await abrir(page);
  const r=await page.evaluate(({oc})=>{
    delete window.__E1__.orden.numeroOC;
    delete window.__E1__.orden.oc;
    window.nroOCCircuito=undefined;
    window.__COI_CIRCUITO_CACHE_GET__=(nro)=>String(nro||'')===oc?window.__E1__.historial:[];
    const wrap=document.createElement('div');
    wrap.innerHTML=window.__COI_ETAPA1_RENDER__(window.__E1__.orden);
    const card=wrap.querySelector('#etapa1Panel2 [data-etapa1-hito="finalizada"]');
    return{
      meta:card?.querySelector('.etapa1-meta')?.textContent||'',
      estado:card?.querySelector('.etapa1-estado')?.textContent||'',
      dias:card?.querySelector('.etapa1-dias')?.textContent||'',
      avance:wrap.querySelector('#etapa1Avance')?.textContent||'',
      ultima:wrap.querySelector('#etapa1UltimaAct')?.textContent||''
    };
  },{oc:OC});
  expect(r.meta).toContain('Fecha efectiva: 25/09/2026');
  expect(r.estado).toContain('EN CURSO');
  expect(r.dias).not.toContain('—');
  expect(r.avance).toBe('1 / 10');
  expect(r.ultima).not.toBe('—');
});
