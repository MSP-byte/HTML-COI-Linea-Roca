const {test,expect}=require('@playwright/test');

test('Red Roca: selección canónica real y ficha ferroviaria de Quilmes',async({page})=>{
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.evaluate(()=>window.COI_REFERENCIAS_ESTACIONES?.registros)).toBe(50);
  const selected=await page.evaluate(()=>{
    const resolve=window.resolverEstacionCatalogo;
    const select=window.seleccionarEstacionPorId;
    if(typeof resolve!=='function'||typeof select!=='function')return {error:'API de navegación ausente'};
    const station=resolve('Quilmes');
    if(!station?.idEstacion)return {error:'Quilmes ausente del catálogo'};
    const outcome=select(station.idEstacion);
    return {id:station.idEstacion,returned:!!outcome};
  });
  expect(selected.error).toBeUndefined();
  await expect(page.locator('#pTitle')).toContainText(/Quilmes/i);
  const reference=await page.evaluate(()=>window.COI_REFERENCIAS_ESTACIONES.get('Quilmes'));
  expect(reference).toEqual(['Quilmes','QL',17.249,'Quilmes',2.671]);
  // La ficha se verifica por separado en cartera_ux_estaciones_v9.spec.js.
  // seleccionarEstacionPorId selecciona el destino, no necesariamente abre el panel.
});

test('Cartera: textos y superficies con contraste computado en ambos temas',async({page})=>{
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  await page.locator('#coiV8V2Nav').evaluate(el=>el.click());
  await expect(page.locator('#vistaCarteraObrasV8')).toHaveClass(/active/);
  for(const light of [false,true]){
    const data=await page.evaluate(light=>{
      document.body.classList.toggle('coi-v2-light',light);
      const host=document.querySelector('#vistaCarteraObrasV8');
      const rgb=v=>{const values=(v.match(/\\d*\\.\\d+|\\d+/g)||[]).map(Number);return v.startsWith('color(')?values.slice(0,3).map(x=>x*255):values.slice(0,3)};
      const lum=s=>{const z=rgb(s).map(x=>{x/=255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*z[0]+.7152*z[1]+.0722*z[2]};
      const kpi=host.querySelector('.cv2-kpi');
      const text=kpi.querySelector('strong');
      const bg=getComputedStyle(kpi).backgroundColor,fg=getComputedStyle(text).color;
      const ratio=(Math.max(lum(bg),lum(fg))+.05)/(Math.min(lum(bg),lum(fg))+.05);
      return {ratio,bg,fg,css:!!document.getElementById('cartera-v9-ux-css')};
    },light);
    expect(data.css).toBeTruthy();
    expect(Number.isFinite(data.ratio),JSON.stringify(data)).toBeTruthy();
    expect(data.ratio,JSON.stringify(data)).toBeGreaterThanOrEqual(4.5);
  }
});
