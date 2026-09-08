# H10-80 generated diagnostic

## TEST
```js
test('H10-80 · P2 · Enter sobre acceso rápido durante startup cuenta como intención real del operador', async ({ page }) => {
  await prepararH10(page, { fallaOrdenes: true });
  await page.goto('/index.html#ficha-oc/' + OC_ACTIVA.nro_oc, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_ROUTING_H10), null, { timeout: 20000 });
  const acceso = page.locator('[data-v2-open-module="btnRed"]').first();
  await acceso.focus();
  await acceso.press('Enter');
  await page.waitForTimeout(7500);
  const e = await estadoRuta(page);
  expect(e.vista).toBe('vistaRed');
  expect(e.hash).toBe('#red');
});

```

## ROUTER / V2
```js
function rutaIntencionDesdeEvento(ev) {
    const t = ev && ev.target && ev.target.closest ? ev.target : null;
    if (!t) return '';
    const nav = t.closest('[data-v2-view]');
    if (nav) return rutaIntencionDesdeVista(nav.getAttribute('data-v2-view'));
    const acceso = t.closest('[data-v2-open-module]');
    if (acceso) {
      const id = texto(acceso.getAttribute('data-v2-open-module'));
      const botones = Array.from(document.querySelectorAll('[data-v2-nav]'));
      const espejo = botones.find((b) => texto(b.getAttribute('data-v2-nav')) === id);
      if (espejo) return rutaIntencionDesdeVista(espejo.getAttribute('data-v2-view'));
    }
    const oc = t.closest('[data-v2-open-oc]');
    if (oc) {
      const ref = texto(oc.getAttribute('data-v2-open-oc'));
      const nro = nroDe(ref);
      if (nro) return 'ficha-oc/' + encodeURIComponent(nro) + '/resumen';
    }
    return '';
  }

  function navegarVistaUsuario(vista) {
    const ruta = rutaIntencionDesdeVista(vista);
    if (!ruta) return false;
    navegacionUsuario++;
    publicar(ruta);
    Promise.resolve(aplicar(ruta)).catch(() => {});
    return true;
  }

  function observarNavegacionUsuario(ev) {
    if (!ev || ev.isTrusted !== true) return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;

    // Los controles V2 declaran destino. Un click del operador gana al
    // deep-link pendiente aunque la vista transitoria ya coincida.
    const intencion = rutaIntencionDesdeEvento(ev);
    const tecladoConIntencion = ev.type === 'keydown' && Boolean(intencion);
    // Enter/Espacio sobre un destino declarado es intención de usuario desde
    // el instante en que el router queda enlazado, incluso si restaurar() aún
    // no alcanzó a marcar restaurando=true. Click/change ordinarios siguen
    // limitados a una restauración/aplicación activa para evitar duplicados.
    if (!restaurando && !aplicando && !tecladoConIntencion) return;
    if (intencion) {
      const desdeTeclado = ev.type === 'keydown';
      if (desdeTeclado) ev.preventDefault();
      navegacionUsuario++;
      publicar(intencion);
      if (desdeTeclado || aplicando) Promise.resolve(aplicar(intencion)).catch(() => {});
      return;
    }

    const antes = rutaVigente();
    let resuelta = false;
    const verificar = () => {
      if (resuelta || (!restaurando && !aplicando)) return;
      const despues = rutaVigente();
      if (!despues || despues === antes) return;
      resuelta = true;
      navegacionUsuario++;
      publicar(despues);
      if (aplicando) Promise.resolve(aplicar(despues)).catch(() => {});
    };
    // Para controles sin destino declarado se conserva la deteccion por
    // resultado visible. Repintados automaticos no son eventos trusted.
    setTimeout(verificar, 0);
    setTimeout(verificar, 90);
    setTimeout(verificar, 220);
  }

  // ---------------------------------------------------------- datos listos
  function estadoCatalogoOrdenes() {
    try {
      const h06 = window.__COI_H06_ORDENES__;
      if (h06 && typeof h06.estadoLectura === 'function') {
        const estado = texto(h06.estadoLectura()).toLowerCase();
        if (estado === 'listo' || estado === 'error' || estado === 'cargando' || estado === 'pendiente') return estado;
      }
      if (h06 && typeof h06.lecturaActualConfirmada === 'function' && h06.lecturaActualConfirmada() === true) return 'listo';
      if (h06 && typeof h06.confirmadas === 'function') {
        const n 

---

function navegarVistaUsuario(vista) {
    const ruta = rutaIntencionDesdeVista(vista);
    if (!ruta) return false;
    navegacionUsuario++;
    publicar(ruta);
    Promise.resolve(aplicar(ruta)).catch(() => {});
    return true;
  }

  function observarNavegacionUsuario(ev) {
    if (!ev || ev.isTrusted !== true) return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;

    // Los controles V2 declaran destino. Un click del operador gana al
    // deep-link pendiente aunque la vista transitoria ya coincida.
    const intencion = rutaIntencionDesdeEvento(ev);
    const tecladoConIntencion = ev.type === 'keydown' && Boolean(intencion);
    // Enter/Espacio sobre un destino declarado es intención de usuario desde
    // el instante en que el router queda enlazado, incluso si restaurar() aún
    // no alcanzó a marcar restaurando=true. Click/change ordinarios siguen
    // limitados a una restauración/aplicación activa para evitar duplicados.
    if (!restaurando && !aplicando && !tecladoConIntencion) return;
    if (intencion) {
      const desdeTeclado = ev.type === 'keydown';
      if (desdeTeclado) ev.preventDefault();
      navegacionUsuario++;
      publicar(intencion);
      if (desdeTeclado || aplicando) Promise.resolve(aplicar(intencion)).catch(() => {});
      return;
    }

    const antes = rutaVigente();
    let resuelta = false;
    const verificar = () => {
      if (resuelta || (!restaurando && !aplicando)) return;
      const despues = rutaVigente();
      if (!despues || despues === antes) return;
      resuelta = true;
      navegacionUsuario++;
      publicar(despues);
      if (aplicando) Promise.resolve(aplicar(despues)).catch(() => {});
    };
    // Para controles sin destino declarado se conserva la deteccion por
    // resultado visible. Repintados automaticos no son eventos trusted.
    setTimeout(verificar, 0);
    setTimeout(verificar, 90);
    setTimeout(verificar, 220);
  }

  // ---------------------------------------------------------- datos listos
  function estadoCatalogoOrdenes() {
    try {
      const h06 = window.__COI_H06_ORDENES__;
      if (h06 && typeof h06.estadoLectura === 'function') {
        const estado = texto(h06.estadoLectura()).toLowerCase();
        if (estado === 'listo' || estado === 'error' || estado === 'cargando' || estado === 'pendiente') return estado;
      }
      if (h06 && typeof h06.lecturaActualConfirmada === 'function' && h06.lecturaActualConfirmada() === true) return 'listo';
      if (h06 && typeof h06.confirmadas === 'function') {
        const n = h06.confirmadas();
        if (n !== null && n !== undefined) return 'listo';
      }
    } catch (e) {}
    return 'cargando';
  }

  function datosListos() { return estadoCatalogoOrdenes() === 'listo'; }

  // No se abre la entidad antes de que el modelo pueda resolverla.
  async function esperarOC(referencia) {
    const fin = Date.now() + LIMITE_ESPERA_MS;
    let confirmadoDesde = 0;
    while (Date.now() < fin) {
      const item = itemDe(referencia);
      if (item) return item;
      const estadoCatalogo = estadoCatalogoOrdenes();
      if (estadoCatalogo === 'error') return null;
      if (estadoCatalogo === 'listo') {
        if (!confirmadoDesde) confirmadoDesde = Date.now();
        else if (Date.now() - confirmadoDesde > GRACIA_MS) return null;
      }
      await dormir(150);
    }
    return itemDe(referencia);
  }

  // ---------------------------------------------------------- de

---

function observarNavegacionUsuario(ev) {
    if (!ev || ev.isTrusted !== true) return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;

    // Los controles V2 declaran destino. Un click del operador gana al
    // deep-link pendiente aunque la vista transitoria ya coincida.
    const intencion = rutaIntencionDesdeEvento(ev);
    const tecladoConIntencion = ev.type === 'keydown' && Boolean(intencion);
    // Enter/Espacio sobre un destino declarado es intención de usuario desde
    // el instante en que el router queda enlazado, incluso si restaurar() aún
    // no alcanzó a marcar restaurando=true. Click/change ordinarios siguen
    // limitados a una restauración/aplicación activa para evitar duplicados.
    if (!restaurando && !aplicando && !tecladoConIntencion) return;
    if (intencion) {
      const desdeTeclado = ev.type === 'keydown';
      if (desdeTeclado) ev.preventDefault();
      navegacionUsuario++;
      publicar(intencion);
      if (desdeTeclado || aplicando) Promise.resolve(aplicar(intencion)).catch(() => {});
      return;
    }

    const antes = rutaVigente();
    let resuelta = false;
    const verificar = () => {
      if (resuelta || (!restaurando && !aplicando)) return;
      const despues = rutaVigente();
      if (!despues || despues === antes) return;
      resuelta = true;
      navegacionUsuario++;
      publicar(despues);
      if (aplicando) Promise.resolve(aplicar(despues)).catch(() => {});
    };
    // Para controles sin destino declarado se conserva la deteccion por
    // resultado visible. Repintados automaticos no son eventos trusted.
    setTimeout(verificar, 0);
    setTimeout(verificar, 90);
    setTimeout(verificar, 220);
  }

  // ---------------------------------------------------------- datos listos
  function estadoCatalogoOrdenes() {
    try {
      const h06 = window.__COI_H06_ORDENES__;
      if (h06 && typeof h06.estadoLectura === 'function') {
        const estado = texto(h06.estadoLectura()).toLowerCase();
        if (estado === 'listo' || estado === 'error' || estado === 'cargando' || estado === 'pendiente') return estado;
      }
      if (h06 && typeof h06.lecturaActualConfirmada === 'function' && h06.lecturaActualConfirmada() === true) return 'listo';
      if (h06 && typeof h06.confirmadas === 'function') {
        const n = h06.confirmadas();
        if (n !== null && n !== undefined) return 'listo';
      }
    } catch (e) {}
    return 'cargando';
  }

  function datosListos() { return estadoCatalogoOrdenes() === 'listo'; }

  // No se abre la entidad antes de que el modelo pueda resolverla.
  async function esperarOC(referencia) {
    const fin = Date.now() + LIMITE_ESPERA_MS;
    let confirmadoDesde = 0;
    while (Date.now() < fin) {
      const item = itemDe(referencia);
      if (item) return item;
      const estadoCatalogo = estadoCatalogoOrdenes();
      if (estadoCatalogo === 'error') return null;
      if (estadoCatalogo === 'listo') {
        if (!confirmadoDesde) confirmadoDesde = Date.now();
        else if (Date.now() - confirmadoDesde > GRACIA_MS) return null;
      }
      await dormir(150);
    }
    return itemDe(referencia);
  }

  // ---------------------------------------------------------- decodificacion segura
  //
  // decodeURIComponent lanza URIError con un porcentaje suelto: «#%»,
  // «#ficha-oc/ABC%». El error se tragaba y la UI se quedaba en la pantalla
  // anterior con el hash roto en la barra: el operador veia una

---

async function aplicar(ruta) {
    versionAplicacion++;
    solicitada = texto(ruta);
    if (aplicando) return;
    aplicando = true;
    try {
      while (solicitada !== null) {
        const r = solicitada;
        solicitada = null;
        const version = versionAplicacion;
        await aplicarInterno(r, version);
      }
    } finally {
      aplicando = false;
      clearTimeout(pendiente);   // se descartan los refrescos encolados al aplicar
    }
    // Normalizacion sin ensuciar el historial.
    publicar(rutaVigente(), { reemplazar: true });
  }

  // ---------------------------------------------------------- envoltorios
  function envolver(nombre) {
    const base = window[nombre];
    if (typeof base !== 'function' || base.__coiH10Router) return;
    const envuelto = function () {
      const salida = base.apply(this, arguments);
      programarRefresco();
      return salida;
    };
    envuelto.__coiH10Router = true;
    envuelto.__coiH10RouterBase = base;
    window[nombre] = envuelto;
  }

  function envolverEstacion() {
    const base = window.selectStation;
    if (typeof base !== 'function' || base.__coiH10Router) return;
    const envuelto = function (s) {
      estacionVigente = texto(s && s.nombre);
      const salida = base.apply(this, arguments);
      programarRefresco();
      return salida;
    };
    envuelto.__coiH10Router = true;
    envuelto.__coiH10RouterBase = base;
    window.selectStation = envuelto;
  }

  function instalarEnvoltorios() {
    ['mostrarVista', 'abrirFichaOC', 'renderFichaOC', 'activarSubmoduloFichaOC',
      'abrirFichaUM'].forEach(envolver);
    envolverEstacion();
  }

  // ---------------------------------------------------------- arranque
  let arrancado = false;

  // Identidad y datos autoritativos antes de abrir una OC puntual.
  async function esperarArranque() {
    const fin = Date.now() + 6000;
    while (Date.now() < fin) {
      const estado = estadoCatalogoOrdenes();
      if (estado === 'listo') return true;
      if (estado === 'error') return false;
      await dormir(150);
    }
    return false;
  }

  function rutaNecesitaCatalogoOrdenes(ruta) {
    const partes = texto(ruta).split('/').filter((x) => x !== '');
    const cabeza = safeDecode(partes[0] || '');
    return Boolean(cabeza.ok && cabeza.value === 'ficha-oc' && partes[1]);
  }

  // Se vuelve a imponer la ruta solo si sigue siendo la pedida y la pantalla
  // se movio a otra cosa. Si el operador navego, el hash ya cambio y no se
  // le pisa la navegacion.
  async function reafirmar(ruta) {
    if (hashActual() !== ruta) return;
    if (rutaVigente() === ruta) return;
    await aplicar(ruta);
  }

  async function restaurar() {
    if (arrancado) return;
    arrancado = true;
    restaurando = true;
    try {
      const inicial = hashActual();
      const versionUsuarioInicial = navegacionUsuario;
      if (!inicial) {
        // Sin hash se conserva la landing canonica vigente —Inicio operativo—.
        // Mientras restaurando=true los repintados intermedios no publican una
        // URL accidental; la normalizacion unica ocurre en finally.
        await dormir(900);
        return;
      }
      // Solo las rutas que resuelven una OC puntual esperan el catálogo de
      // Órdenes. Red, Timeline, UM y demás módulos independientes no pagan un
      // timeout por una tabla que no usan.
      const listo = rutaNecesitaCatalogoOrdenes(inicial) ? await esperarArranque() : true;
      // esperarArranque(

---

document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('modalHistorialEtapaCircuitoR18'))cerrarModalHistorialEtapa();});
}

window.CIRCUITO_ADMINISTRATIVO_ETAPAS=CIRCUITO_ADMINISTRATIVO_ETAPAS;
window.obtenerEtapasCircuitoOC=obtenerEtapasCircuitoOC;
window.cargarHistorialCircuitoOC=cargarHistorialCircuitoOC;
window.agruparHistorialCircuitoPorEtapa=agruparHistorialCircuitoPorEtapa;
window.renderCircuitoAdministrativoOC=renderCircuitoAdministrativoOC;
window.confirmarEtapaCircuitoOC=confirmarEtapaCircuitoOC;
window.actualizarEstadoDocumentalDesdePasoContractual=actualizarEstadoDocumentalDesdePasoContractual;
window.obtenerPasoContractualDesdeEstadoDocumental=obtenerPasoContractualDesdeEstadoDocumental;
window.abrirHistorialEtapaCircuitoOC=abrirHistorialEtapaCircuitoOC;
window.renderHistorialEtapaCircuitoOC=renderHistorialEtapaCircuitoOC;
window.agregarObservacionEtapaCircuitoOC=agregarObservacionEtapaCircuitoOC;
window.cerrarModalHistorialEtapa=cerrarModalHistorialEtapa;
window.obtenerEstadoVisualEtapa=obtenerEstadoVisualEtapa;
window.formatearFechaHoraCOI=formatearFechaHoraCOI;
window.refrescarCircuitoAdministrativoOC=refrescarCircuitoAdministrativoOC;


function inicializarEventosUIUnaVez(){
  instalarEventosEdicionIntegral();
  instalarPromesasCompartidas();
  wrapFichaRef();
  versionarR12();
  reordenarBotonEditar();
  try{if(typeof window.inicializarEventosCargaCertificacion==='function')window.inicializarEventosCargaCertificacion();}catch(error){console.warn('COI: Carga Certificación no inicializada.',error);}
  inicializarEventosCircuitoAdministrativo();
}

function inicializarNavegacionPrincipalUnaVez(){
  const nav=$('moduleNav'),alerts=$('btnCentroAlertas'),about=$('btnAcercaSistema');
  if(nav&&alerts&&about&&alerts.previousElementSibling!==about)nav.appendChild(alerts);
  actualizarVisibilidadCentroAlertas();
}

async function cargarEstacionesAsociadasPrincipal(){
  if(typeof window.cargarTodasEstacionesAsociadasSupabase==='function')return await window.cargarTodasEstacionesAsociadasSupabase({silencioso:true});
  return [];
}
async function cargarMetadataOperativaNecesaria(){
  if(typeof window.syncExecutiveMetadata==='function')return await window.syncExecutiveMetadata();
  return [];
}
async function mostrarVistaSegura(idVista){
  window.APP_STATE.activeView=idVista||window.APP_STATE.activeView||'vistaDashboard';
  try{if(typeof window.mostrarVista==='function')window.mostrarVista(window.APP_STATE.activeView);}catch(e){}
  try{await renderVistaActiva(window.APP_STATE.activeView);}catch(e){console.warn('Render vista activa R12:',e);}
}
async function renderVistaActiva(idVista){
  if(window.APP_STATE.renderingView)return;
  window.APP_STATE.renderingView=true;
  try{
    switch(idVista){
      case 'vistaDashboard': if(typeof window.renderDashboard==='function')return window.renderDashboard(); break;
      case 'vistaRed': if(typeof window.renderRedLineaRoca==='function')return window.renderRedLineaRoca(); break;
      case 'vistaOrdenes': if(typeof window.renderOrdenes==='function')return window.renderOrdenes(); break;
      case 'vistaCalendarioCOI': if(typeof window.renderCalendarioCOI==='function')return window.renderCalendarioCOI(); if(typeof window.renderCalendarioCOIUnificado==='function')return window.renderCalendarioCOIUnificado(); break;
      case 'vistaCentroAlertas': if(usuarioTienePermisoEdicion()&&typeof window.renderCentroAlertas==='function')return window.renderCentroAlertas(); break;
      ca
```

## PLAYWRIGHT OUTPUT
```text
[WebServer] 127.0.0.1 - - [08/Sep/2026 19:48:15] "GET /index.html HTTP/1.1" 200 -


Running 2 tests using 1 worker

[1/2] [chromium-desktop] › tests/h10_routing_cierre_archivo.spec.js:1858:1 › H10-80 · P2 · Enter sobre acceso rápido durante startup cuenta como intención real del operador
[WebServer] 127.0.0.1 - - [08/Sep/2026 19:48:17] "GET /index.html HTTP/1.1" 200 -

  1) [chromium-desktop] › tests/h10_routing_cierre_archivo.spec.js:1858:1 › H10-80 · P2 · Enter sobre acceso rápido durante startup cuenta como intención real del operador 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "vistaRed"
    Received: "vistaFichaOC"

      1865 |   await page.waitForTimeout(7500);
      1866 |   const e = await estadoRuta(page);
    > 1867 |   expect(e.vista).toBe('vistaRed');
           |                   ^
      1868 |   expect(e.hash).toBe('#red');
      1869 | });
      1870 |
        at /home/runner/work/HTML-COI-Linea-Roca/HTML-COI-Linea-Roca/tests/h10_routing_cierre_archivo.spec.js:1867:19

    attachment #1: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/h10_routing_cierre_archivo-b3637-intención-real-del-operador-chromium-desktop/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/h10_routing_cierre_archivo-b3637-intención-real-del-operador-chromium-desktop/error-context.md

    attachment #3: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/h10_routing_cierre_archivo-b3637-intención-real-del-operador-chromium-desktop/trace.zip
    Usage:

        npx playwright show-trace test-results/h10_routing_cierre_archivo-b3637-intención-real-del-operador-chromium-desktop/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


[2/2] [chromium-mobile] › tests/h10_routing_cierre_archivo.spec.js:1858:1 › H10-80 · P2 · Enter sobre acceso rápido durante startup cuenta como intención real del operador
[WebServer] 127.0.0.1 - - [08/Sep/2026 19:48:28] "GET /index.html HTTP/1.1" 200 -

  2) [chromium-mobile] › tests/h10_routing_cierre_archivo.spec.js:1858:1 › H10-80 · P2 · Enter sobre acceso rápido durante startup cuenta como intención real del operador 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "vistaRed"
    Received: "vistaFichaOC"

      1865 |   await page.waitForTimeout(7500);
      1866 |   const e = await estadoRuta(page);
    > 1867 |   expect(e.vista).toBe('vistaRed');
           |                   ^
      1868 |   expect(e.hash).toBe('#red');
      1869 | });
      1870 |
        at /home/runner/work/HTML-COI-Linea-Roca/HTML-COI-Linea-Roca/tests/h10_routing_cierre_archivo.spec.js:1867:19

    attachment #1: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results/h10_routing_cierre_archivo-b3637-intención-real-del-operador-chromium-mobile/test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results/h10_routing_cierre_archivo-b3637-intención-real-del-operador-chromium-mobile/error-context.md

    attachment #3: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/h10_routing_cierre_archivo-b3637-intención-real-del-operador-chromium-mobile/trace.zip
    Usage:

        npx playwright show-trace test-results/h10_routing_cierre_archivo-b3637-intención-real-del-operador-chromium-mobile/trace.zip

    ────────────────────────────────────────────────────────────────────────────────────────────────


  2 failed
    [chromium-desktop] › tests/h10_routing_cierre_archivo.spec.js:1858:1 › H10-80 · P2 · Enter sobre acceso rápido durante startup cuenta como intención real del operador 
    [chromium-mobile] › tests/h10_routing_cierre_archivo.spec.js:1858:1 › H10-80 · P2 · Enter sobre acceso rápido durante startup cuenta como intención real del operador 
```

exit_status=1
