const {test,expect}=require('@playwright/test');
const path=require('path');

test.describe('Interaction Smoke V60.1.3 (datos 100% simulados)',()=>{
  test.beforeEach(async({page})=>{
    const browserErrors=[];
    page.on('pageerror',error=>browserErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text());});
    await page.addInitScript(()=>{
      let original;
      Object.defineProperty(window,'COI_CRUD_ORDENES',{configurable:true,set(value){
        original=value;
        window.__crudOriginal=value;
        window.__canonicalClicks=0;
        window.__modalOpens=0;
        Object.defineProperty(window,'COI_CRUD_ORDENES',{configurable:true,value:new Proxy(value,{get(target,key){
          if(key==='eliminarSeleccionadasDesdeUI')return async()=>{window.__canonicalClicks++;window.__modalOpens++;return {status:'mock'};};
          return target[key];
        }})});
      },get(){return original;}});
    });
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:4173'}/index.html`);
    await expect(page.locator('#appVersionHeader')).toContainText('V60.1.3');
    page.__browserErrors=browserErrors;
  });
  test.afterEach(async({page})=>{expect(page.__browserErrors||[],'Errores de consola/navegador').toEqual([]);});

  test('binding único sobrevive al render y doble inicialización',async({page})=>{
    await page.evaluate(()=>{
      document.querySelector('#btnBorrarSeleccionadas')?.remove();
      const host=document.createElement('div');host.id='e2eDeleteHost';host.innerHTML='<button id="btnBorrarSeleccionadas">Borrar seleccionadas (1)</button>';document.body.append(host);
      window.bindCrudOrdenesUI();window.bindCrudOrdenesUI();
    });
    await page.locator('#btnBorrarSeleccionadas').click();
    await page.evaluate(()=>{document.querySelector('#e2eDeleteHost').innerHTML='<button id="btnBorrarSeleccionadas">Borrar seleccionadas (1)</button>';});
    await page.locator('#btnBorrarSeleccionadas').click();
    await expect.poll(()=>page.evaluate(()=>window.__canonicalClicks)).toBe(2);
    await expect.poll(()=>page.evaluate(()=>window.__modalOpens)).toBe(2);
  });

  test('sesión real controla permisos antes del modal',async({page})=>{
    const messages=await page.evaluate(async()=>{
      const original=window.__crudOriginal;const out=[];
      window.getSupabaseClient=()=>({auth:{getUser:async()=>({data:{user:null}})}});
      window.getUsuarioActual=async()=>null;
      try{await original.eliminarOrdenesPersistentes([{nro_oc:'00004'}],{skipDialog:true});}catch(e){out.push(e.message);}
      window.getUsuarioActual=async()=>({email:'usuario@coiroca.com'});
      try{await original.eliminarOrdenesPersistentes([{nro_oc:'00004'}],{skipDialog:true});}catch(e){out.push(e.message);}
      window.getUsuarioActual=async()=>({email:' ADMIN@COIROCA.COM '});window.adminIsEnabled=()=>false;
      try{await original.eliminarOrdenesPersistentes([{nro_oc:'00004'}],{skipDialog:true});}catch(e){out.push(e.message);}
      return out;
    });
    expect(messages).toEqual([
      'Debe iniciar sesión con el usuario administrador para eliminar OCs.',
      'Solo el usuario administrador puede eliminar Órdenes de Compra.',
      'Active el Modo Administrador desde Administración para eliminar OCs.'
    ]);
  });

  test('navegación crítica responde sin duplicar vista',async({page})=>{
    for(const [button,view] of [['btnDashboard','vistaDashboard'],['btnRed','vistaRed'],['btnCalendarioCOI','vistaCalendarioCOI'],['btnOrdenes','vistaOrdenes'],['btnCarga','vistaCarga'],['btnAdministracionSistema','vistaAdministracionSistema'],['btnAcercaSistema','vistaAcercaSistema'],['btnCentroAlertas','vistaCentroAlertas']]){
      const locator=page.locator('#'+button);await expect(locator).toBeAttached();await locator.click();await expect(page.locator('#'+view)).toHaveClass(/active/);
    }
  });
});
