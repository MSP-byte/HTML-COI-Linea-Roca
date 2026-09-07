const { test, expect } = require('@playwright/test');

/*
  H10 — Cerrar vs Archivar, y navegacion persistente por URL.

  A · CERRAR y ARCHIVAR eran, literalmente, la misma columna.

      El handler vivo de «Cerrar OC» (V59) escribia
      `estadoRegistro = 'Cerrado'` y persistia con v59GuardarBase() ->
      localStorage: el cierre no llegaba a Supabase y desaparecia en el
      siguiente F5. Y `estado_registro` es, desde H09, el campo del ARCHIVO:
      cerrar pisaba el archivado y archivar pisaba el cierre. El cierre de la
      fase ejecutiva llegaba a Supabase pero escribia la misma columna, ademas
      por UPDATE directo en vez de la RPC canonica.

      Ahora son dos ejes separados, sin columnas nuevas ni migracion:

        ESTADO OPERATIVO   estado_coi + fecha_cierre_operativo + observacion_cierre
        ESTADO DE REGISTRO estado_registro  (Activo / Archivado)

      Y una secuencia: EN EJECUCION -> Cerrar -> CERRADA -> Archivar.
      Desarchivar devuelve al registro activo SIN reabrir la contratacion.

  B · La aplicacion no tenia routing: ni una lectura de location.hash. Cada F5
      devolvia a la vista inicial y perdia la Ficha OC abierta. El hash pasa a
      describir vista, entidad y subpestaña; no es autoridad de datos, y la
      restauracion espera a que Supabase confirme identidad y datos antes de
      abrir nada.

  Supabase se intercepta con un cliente falso: ninguna prueba toca datos reales.
*/

const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const BASE = {
  tipo: 'Servicio', tipo_trabajo: 'Mantenimiento', especialidad: 'Ascensores',
  descripcion: 'Servicio H10', proveedor: 'PROVEEDOR H10',
  estacion: 'PLAZA CONSTITUCION', ramal: 'La Plata', sector: 'Hall',
  monto_total: 1000, moneda: 'ARS', plazo_dias: 30,
  fecha_acta_inicio: '2026-08-01', fecha_vencimiento: '2026-08-31',
  estado_documental: 'Pendiente',
  fecha_creacion: '2026-08-01T10:00:00.000Z', fecha_actualizacion: '2026-08-01T10:00:00.000Z'
};

// En ejecucion: todavia no se puede archivar.
const OC_ACTIVA = Object.assign({}, BASE, {
  id: '11111111-1111-4111-8111-111111111111', nro_oc: '4530000001',
  id_obra: 'OBRA-H10-ACTIVA', estado_coi: 'En ejecución', estado_registro: 'Activo'
});

// Cerrada operativamente y todavia activa en el registro.
const OC_CERRADA = Object.assign({}, BASE, {
  id: '22222222-2222-4222-8222-222222222222', nro_oc: '4530000002',
  id_obra: 'OBRA-H10-CERRADA', proveedor: 'PROVEEDOR CERRADO',
  estado_coi: 'Cerrada', estado_registro: 'Activo',
  fecha_cierre_operativo: '2026-08-25', observacion_cierre: 'Cierre previo'
});

// Cerrada Y archivada: el estado final de la secuencia.
const OC_ARCHIVADA = Object.assign({}, BASE, {
  id: '33333333-3333-4333-8333-333333333333', nro_oc: '4530000003',
  id_obra: 'OBRA-H10-ARCHIVADA', proveedor: 'PROVEEDOR ARCHIVADO',
  estado_coi: 'Cerrada', estado_registro: 'Archivado',
  fecha_cierre_operativo: '2026-08-20', observacion_cierre: 'Cierre previo'
});

const TODAS = [OC_ACTIVA, OC_CERRADA, OC_ARCHIVADA];

// Claves operativas que ninguna de estas acciones puede escribir.
const CLAVES_OPERATIVAS = [
  'roca_coi_intervenciones_v10', 'coi_linea_roca_master_v18',
  'coi_supabase_ordenes_cache_v2', 'coiOrdenes'
];

// ============================================================ fixture

async function prepararH10(page, opciones = {}) {
  const cfg = Object.assign({ ordenes: TODAS, fallaRpc: false, rol: 'administrador' }, opciones);

  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());

  await page.addInitScript(({ c, uid, claves }) => {
    // El «remoto» sobrevive a los F5 de la prueba: es lo unico autoritativo.
    const CLAVE = '__H10_REMOTO__';
    let filas = null;
    try { filas = JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); } catch (e) {}
    if (!Array.isArray(filas)) filas = c.ordenes.map((o) => Object.assign({}, o));
    const persistir = () => { try { sessionStorage.setItem(CLAVE, JSON.stringify(filas)); } catch (e) {} };
    persistir();

    window.__H10__ = {
      rpc: [], toasts: [], locales: 0, escriturasOperativas: [],
      remoto: () => filas.map((f) => Object.assign({}, f)),
      fila: (nro) => filas.find((f) => String(f.nro_oc) === String(nro)) || null
    };

    // Cualquier intento de persistir estado operativo queda registrado.
    const setItemNativo = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (claves.indexOf(k) >= 0) window.__H10__.escriturasOperativas.push(k);
      return setItemNativo.call(this, k, v);
    };

    function consulta(tabla) {
      const st = { tabla, filtros: [], conteo: false };
      const datos = () => (tabla === 'coi_ordenes' ? filas : []);
      const cumple = (f) => st.filtros.every((x) => String(f[x.col]) === String(x.val));
      const api = {
        select(cols, o) { st.conteo = Boolean(o && o.head); return api; },
        order() { return api; }, range() { return api; }, in() { return api; },
        is() { return api; }, ilike() { return api; }, limit() { return api; },
        eq(col, val) { st.filtros.push({ col, val }); return api; },
        gt() { return api; },
        insert() { return api; }, update() { return api; }, delete() { return api; },
        single: async () => {
          const f = datos().filter(cumple)[0];
          return f ? { data: Object.assign({}, f), error: null } : { data: null, error: { message: 'no rows' } };
        },
        async _run() {
          const todas = datos().filter(cumple).map((x) => Object.assign({}, x));
          if (st.conteo) return { data: null, count: todas.length, error: null };
          return { data: todas, error: null };
        },
        then(res, rej) { return api._run().then(res, rej); }
      };
      return api;
    }

    const fake = {
      from: (t) => consulta(t),
      rpc: async (nombre, args) => {
        window.__H10__.rpc.push({ nombre, args: JSON.parse(JSON.stringify(args || {})) });
        if (nombre === 'coi_current_role') return { data: c.rol, error: null };
        if (nombre === 'coi_actualizar_orden_integral') {
          if (c.fallaRpc) return { data: null, error: { code: '42501', message: 'permission denied fixture H10' } };
          const f = filas.find((x) => x.id === args.p_orden_id);
          if (!f) return { data: null, error: { message: 'la OC no existe' } };
          Object.assign(f, args.p_cambios || {});
          persistir();
          return { data: { orden: Object.assign({}, f) }, error: null };
        }
        return { data: null, error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: uid, email: 'admin@coiroca.test' } } }, error: null }),
        getUser: async () => ({ data: { user: { id: uid } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };

    window.__COI_SUPABASE_CLIENT__ = fake;
    window.getSupabaseClient = () => fake;
    window.initSupabase = async () => fake;
    window.getUsuarioActual = async () => ({ id: uid, email: 'admin@coiroca.test' });
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.confirm = () => true;
    window.prompt = () => 'Cierre operativo de prueba';
    window.alert = (m) => window.__H10__.toasts.push({ m: String(m), t: 'alert' });

    // Contadores de persistencia local, instalados una vez cargado el resto.
    window.addEventListener('DOMContentLoaded', () => {
      ['guardarBaseLocal', 'v59GuardarBase'].forEach((nombre) => {
        const base = window[nombre];
        if (typeof base !== 'function' || base.__h10) return;
        const envuelto = function () { window.__H10__.locales += 1; return base.apply(this, arguments); };
        envuelto.__h10 = true;
        window[nombre] = envuelto;
      });
      const toast = window.toast;
      window.toast = function (m, t) { window.__H10__.toasts.push({ m: String(m), t: String(t || '') }); return toast && toast.apply(this, arguments); };
      window.coiToast = window.toast;
    });
  }, { c: cfg, uid: UID, claves: CLAVES_OPERATIVAS });
}

async function abrir(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(window.COI_ROUTING_H10 && window.COI_CIERRE_OC_H10 && window.COI_ARCHIVO_OC_H09),
    null, { timeout: 20000 });
  await page.waitForFunction(() => {
    try { return ((window.todasLasOC && window.todasLasOC()) || []).length > 0; } catch (e) { return false; }
  }, null, { timeout: 20000 });
  await page.waitForTimeout(900);
  return errores;
}

// Recarga real, esperando que el router termine de restaurar.
async function recargar(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_ROUTING_H10), null, { timeout: 20000 });
  await page.waitForFunction(() => {
    try { return ((window.todasLasOC && window.todasLasOC()) || []).length > 0; } catch (e) { return false; }
  }, null, { timeout: 20000 });
  await page.waitForTimeout(2500);
}

const abrirFicha = async (page, nro) => {
  await page.evaluate((n) => window.abrirFichaOC(n), nro);
  await page.waitForTimeout(1200);
};

const remoto = (page, nro) => page.evaluate((n) => {
  const f = window.__H10__.fila(n) || {};
  return { estado_coi: f.estado_coi, estado_registro: f.estado_registro, cierre: f.fecha_cierre_operativo || '' };
}, nro);

const cambiosRPC = (page) => page.evaluate(() =>
  window.__H10__.rpc.filter((r) => r.nombre === 'coi_actualizar_orden_integral').map((r) => r.args.p_cambios));

const pantalla = (page) => page.evaluate(() => ({
  hash: location.hash,
  vista: (document.querySelector('.view.active') || {}).id || '',
  panel: (document.querySelector('#fichaOCBody .ficha-oc-panel.active') || {}).id || '',
  archivar: (document.getElementById('btnArchivarOCFicha') || {}),
  textoArchivar: (document.getElementById('btnArchivarOCFicha') || {}).textContent || '',
  archivarDeshabilitado: Boolean((document.getElementById('btnArchivarOCFicha') || {}).disabled),
  tituloArchivar: (document.getElementById('btnArchivarOCFicha') || {}).title || '',
  textoCerrar: (document.getElementById('btnCerrarOCFicha') || {}).textContent || '',
  tituloCerrar: (document.getElementById('btnCerrarOCFicha') || {}).title || '',
  avisoArchivada: Boolean(document.getElementById('h09AvisoArchivada')),
  toastDeshacer: Boolean(document.getElementById('h09DeshacerArchivo') &&
    !document.getElementById('h09DeshacerArchivo').hidden)
}));

// ============================================================ A · cierre y archivo

test('H10-1 · cerrar OC viaja por la RPC canónica de Supabase', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  await page.evaluate(() => window.cerrarOC());
  await page.waitForTimeout(2200);

  const cambios = await cambiosRPC(page);
  expect(cambios.length).toBe(1);
  expect(cambios[0]).toHaveProperty('estado_coi', 'Cerrada');
  expect(cambios[0]).toHaveProperty('fecha_cierre_operativo');
  expect(cambios[0]).toHaveProperty('observacion_cierre', 'Cierre operativo de prueba');

  const r = await remoto(page, OC_ACTIVA.nro_oc);
  expect(r.estado_coi).toBe('Cerrada');
  expect(r.cierre).toBeTruthy();
});

test('H10-2 · cerrar NO modifica el estado de registro', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  await page.evaluate(() => window.cerrarOC());
  await page.waitForTimeout(2200);

  const cambios = await cambiosRPC(page);
  // El campo del archivo no aparece en el payload del cierre.
  expect(cambios[0]).not.toHaveProperty('estado_registro');
  const r = await remoto(page, OC_ACTIVA.nro_oc);
  expect(r.estado_registro).toBe('Activo');
});

test('H10-3 · archivar NO modifica el estado operativo', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);

  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(2200);

  const cambios = await cambiosRPC(page);
  expect(cambios.length).toBe(1);
  expect(cambios[0]).toEqual({ estado_registro: 'Archivado' });
  expect(cambios[0]).not.toHaveProperty('estado_coi');

  const r = await remoto(page, OC_CERRADA.nro_oc);
  expect(r.estado_registro).toBe('Archivado');
  // El estado operativo quedó exactamente como estaba.
  expect(r.estado_coi).toBe('Cerrada');
});

test('H10-4 · una OC no cerrada no se puede archivar', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  const p = await pantalla(page);
  expect(p.archivarDeshabilitado).toBe(true);
  expect(p.tituloArchivar).toBe('Primero debe cerrar la OC para enviarla al historial.');

  // Y aunque se invoque directamente, no llega ninguna escritura remota.
  const ok = await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(900);
  expect(ok).toBe(false);
  expect(await cambiosRPC(page)).toEqual([]);
  expect((await remoto(page, OC_ACTIVA.nro_oc)).estado_registro).toBe('Activo');
});

test('H10-5 · una OC cerrada sí puede archivarse', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);

  const antes = await pantalla(page);
  expect(antes.archivarDeshabilitado).toBe(false);

  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(2200);
  expect((await remoto(page, OC_CERRADA.nro_oc)).estado_registro).toBe('Archivado');
});

test('H10-6 · cerrada + archivada, al desarchivar queda cerrada + activa', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ARCHIVADA.nro_oc);

  await page.evaluate(() => window.desarchivarOC());
  await page.waitForTimeout(2200);

  const r = await remoto(page, OC_ARCHIVADA.nro_oc);
  expect(r.estado_registro).toBe('Activo');
  expect(r.estado_coi).toBe('Cerrada');
});

test('H10-7 · desarchivar no reabre: el estado operativo no vuelve a En ejecución', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ARCHIVADA.nro_oc);

  await page.evaluate(() => window.desarchivarOC());
  await page.waitForTimeout(2200);

  const cambios = await cambiosRPC(page);
  expect(cambios).toEqual([{ estado_registro: 'Activo' }]);
  const r = await remoto(page, OC_ARCHIVADA.nro_oc);
  expect(r.estado_coi).not.toBe('En ejecución');
  expect(r.estado_coi).toBe('Cerrada');
  // Y la fecha de cierre operativo sigue en su lugar.
  expect(r.cierre).toBe('2026-08-20');
});

test('H10-8 · si Supabase rechaza el archivado, la interfaz conserva el estado anterior', async ({ page }) => {
  await prepararH10(page, { fallaRpc: true });
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);

  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(2200);

  // El remoto no cambió...
  const r = await remoto(page, OC_CERRADA.nro_oc);
  expect(r.estado_registro).toBe('Activo');
  // ...y la interfaz tampoco miente.
  const p = await pantalla(page);
  expect(p.textoArchivar).toBe('Archivar OC');
  expect(p.avisoArchivada).toBe(false);
  const errores = await page.evaluate(() => window.__H10__.toasts.filter((t) => t.t === 'error').map((t) => t.m));
  expect(errores.join(' ')).toContain('No se pudo archivar');
});

test('H10-9 · Deshacer revierte de verdad, y solo el estado de registro', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);

  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(2200);
  expect((await pantalla(page)).toastDeshacer).toBe(true);

  await page.click('#h09BtnDeshacerArchivo');
  await page.waitForTimeout(2500);

  const cambios = await cambiosRPC(page);
  expect(cambios).toEqual([{ estado_registro: 'Archivado' }, { estado_registro: 'Activo' }]);
  const r = await remoto(page, OC_CERRADA.nro_oc);
  expect(r.estado_registro).toBe('Activo');
  expect(r.estado_coi).toBe('Cerrada');
});

test('H10-10 · ni cerrar ni archivar escriben estos estados en localStorage', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);
  await page.evaluate(() => { window.__H10__.locales = 0; window.__H10__.escriturasOperativas = []; });

  await page.evaluate(() => window.cerrarOC());
  await page.waitForTimeout(2200);
  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(2200);

  const r = await page.evaluate(() => ({
    locales: window.__H10__.locales,
    operativas: window.__H10__.escriturasOperativas,
    // Nada de esto puede quedar cacheado como estado.
    rastro: Object.keys(localStorage).filter((k) => {
      const v = String(localStorage.getItem(k) || '');
      return v.indexOf('4530000001') >= 0 && (v.indexOf('Archivado') >= 0 || v.indexOf('Cerrada') >= 0);
    })
  }));
  expect(r.locales).toBe(0);
  expect(r.operativas).toEqual([]);
  expect(r.rastro).toEqual([]);
});

test('H10-11 · archivar una OC no la convierte en cerrada operativamente', async ({ page }) => {
  // El predicado historico contaba 'ARCHIVAD' como cierre: archivar cambiaba
  // en silencio KPIs, calendario y alertas. Archivar es gestion del historial.
  await prepararH10(page);
  await abrir(page);

  const r = await page.evaluate(() => ({
    archivadaSinCierre: window.estaOCCerrada({ estadoRegistro: 'Archivado', estadoCOI: 'En ejecución' }),
    archivadaYCerrada: window.estaOCCerrada({ estadoRegistro: 'Archivado', estadoCOI: 'Cerrada' }),
    cerradaPorEstadoCoi: window.estaOCCerrada({ estadoRegistro: 'Activo', estadoCOI: 'Cerrada' }),
    // Compatibilidad: el cierre legado vivia en estado_registro.
    legadoCerrado: window.estaOCCerrada({ estadoRegistro: 'Cerrado' }),
    activa: window.estaOCCerrada({ estadoRegistro: 'Activo', estadoCOI: 'En ejecución' })
  }));
  expect(r.archivadaSinCierre).toBe(false);
  expect(r.archivadaYCerrada).toBe(true);
  expect(r.cerradaPorEstadoCoi).toBe(true);
  expect(r.legadoCerrado).toBe(true);
  expect(r.activa).toBe(false);
});

test('H10-12 · los textos de las acciones son operativos, sin jerga técnica', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);

  const p = await pantalla(page);
  expect(p.tituloArchivar).toBe('Mueve la OC al historial de archivadas. No se elimina y puede restaurarse.');
  expect(p.tituloArchivar).not.toContain('Supabase');

  // La ayuda de «Cerrar OC» se lee en una OC todavía abierta: sobre una ya
  // cerrada el botón dice, correctamente, que no hay nada que cerrar.
  await abrirFicha(page, OC_ACTIVA.nro_oc);
  const abierta = await pantalla(page);
  expect(abierta.textoCerrar).toBe('Cerrar OC');
  expect(abierta.tituloCerrar).toContain('Finaliza operativamente la OC');
  expect(abierta.tituloCerrar).not.toContain('Supabase');
  await abrirFicha(page, OC_CERRADA.nro_oc);

  // Y jerarquia visual: las dos acciones no se leen como equivalentes.
  expect(await page.locator('.h10-sep-historial').count()).toBeGreaterThan(0);

  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(2200);
  const q = await pantalla(page);
  expect(q.textoArchivar).toBe('Desarchivar OC');
  expect(q.tituloArchivar).toBe('Devuelve la OC al registro consultable sin modificar su estado operativo.');
});

test('H10-26 · el cierre de la cabecera ejecutiva pasa por el camino canónico', async ({ page }) => {
  // closeOrder() llegaba a Supabase, pero escribia estado_registro por UPDATE
  // directo sobre la tabla: la misma colisión, por otro camino.
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  const marcado = await page.evaluate(async () => {
    const marcas = [];
    const base = window.cerrarOC;
    window.cerrarOC = function () { marcas.push('canonico'); return base.apply(this, arguments); };
    const b = document.createElement('button');
    b.id = 'execBtnClose';
    document.body.appendChild(b);
    b.click();
    await new Promise((r) => setTimeout(r, 400));
    b.remove();
    return marcas;
  });
  expect(marcado).toEqual(['canonico']);

  await page.waitForTimeout(2200);
  const cambios = await cambiosRPC(page);
  expect(cambios.length).toBe(1);
  expect(cambios[0]).toHaveProperty('estado_coi', 'Cerrada');
  expect(cambios[0]).not.toHaveProperty('estado_registro');
});

test('H10-27 · el botón real de la ficha cierra por el camino canónico', async ({ page }) => {
  // Los botones de acción de la ficha solo se pintan en modo administrador: es
  // la barra que ve un operador con permisos, y la que hay que clickear de
  // verdad. El handler resuelve el binding global de `cerrarOC`.
  await prepararH10(page);
  await abrir(page);
  await page.evaluate(() => { window.adminIsEnabled = () => true; });
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  const boton = page.locator('#btnCerrarOCFichaTop');
  await expect(boton).toBeVisible();
  await expect(boton).toHaveText('Cerrar OC');
  await boton.click();
  await page.waitForTimeout(2500);

  const cambios = await cambiosRPC(page);
  expect(cambios.length).toBe(1);
  expect(cambios[0]).toHaveProperty('estado_coi', 'Cerrada');
  expect(cambios[0]).not.toHaveProperty('estado_registro');

  const r = await remoto(page, OC_ACTIVA.nro_oc);
  expect(r.estado_coi).toBe('Cerrada');
  expect(r.estado_registro).toBe('Activo');
  // Y nada quedó guardado localmente.
  expect(await page.evaluate(() => window.__H10__.locales)).toBe(0);

  // Cerrada la OC, el botón lo dice y ahora sí se puede archivar.
  const p = await pantalla(page);
  expect(p.textoCerrar).toBe('OC cerrada');
  expect(p.archivarDeshabilitado).toBe(false);
});

// ============================================================ B · routing

test('H10-13 · abrir una Ficha OC publica su ruta en la URL', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  const p = await pantalla(page);
  expect(p.vista).toBe('vistaFichaOC');
  expect(p.hash).toBe('#ficha-oc/' + OC_ACTIVA.nro_oc + '/resumen');
});

test('H10-14 · F5 sobre una Ficha OC vuelve a la misma Ficha OC', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  await recargar(page);

  const p = await pantalla(page);
  expect(p.vista).toBe('vistaFichaOC');
  expect(p.hash).toContain('ficha-oc/' + OC_ACTIVA.nro_oc);
  await expect(page.locator('#fichaOCBody')).toContainText(OC_ACTIVA.nro_oc);
});

test('H10-15 · F5 conserva la subpestaña de la Ficha OC', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  await page.click('[data-ficha-submodulo="panelFichaCertificaciones"]');
  await page.waitForTimeout(700);
  expect((await pantalla(page)).hash).toBe('#ficha-oc/' + OC_ACTIVA.nro_oc + '/certificaciones');

  await recargar(page);

  const p = await pantalla(page);
  expect(p.vista).toBe('vistaFichaOC');
  expect(p.panel).toBe('panelFichaCertificaciones');
  expect(p.hash).toBe('#ficha-oc/' + OC_ACTIVA.nro_oc + '/certificaciones');
});

test('H10-16 · F5 sobre una OC archivada mantiene ficha, estado y «Desarchivar OC»', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ARCHIVADA.nro_oc);

  await recargar(page);

  const p = await pantalla(page);
  expect(p.vista).toBe('vistaFichaOC');
  expect(p.hash).toContain('ficha-oc/' + OC_ARCHIVADA.nro_oc);
  expect(p.textoArchivar).toBe('Desarchivar OC');
  expect(p.avisoArchivada).toBe(true);
  // Y sigue archivada en Supabase: nada la reactivó.
  expect((await remoto(page, OC_ARCHIVADA.nro_oc)).estado_registro).toBe('Archivado');
});

test('H10-17 · el toast «Deshacer» no reaparece después de F5', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);

  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(2200);
  expect((await pantalla(page)).toastDeshacer).toBe(true);

  await recargar(page);

  const p = await pantalla(page);
  // El aviso transitorio se fue; el estado persistente se ve.
  expect(p.toastDeshacer).toBe(false);
  expect(p.textoArchivar).toBe('Desarchivar OC');
  expect(p.avisoArchivada).toBe(true);
});

test('H10-18 · F5 conserva el filtro de estado de registro en Órdenes', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await page.evaluate(() => window.mostrarVista('vistaOrdenes'));
  await page.waitForTimeout(700);
  await page.selectOption('#ordenesFiltroRegistro', 'archivadas');
  await page.waitForTimeout(700);
  expect((await pantalla(page)).hash).toBe('#ordenes/archivadas');

  await recargar(page);

  const p = await pantalla(page);
  expect(p.vista).toBe('vistaOrdenes');
  expect(p.hash).toBe('#ordenes/archivadas');
  await expect(page.locator('#ordenesFiltroRegistro')).toHaveValue('archivadas');
});

test('H10-19 · F5 conserva UM / Servicios Técnicos', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await page.evaluate(() => window.mostrarVista('vistaUnidadesMantenimiento'));
  await page.waitForTimeout(900);
  await page.click('#h09Tabs [data-h09-tab="servicios"]');
  await page.waitForTimeout(700);
  expect((await pantalla(page)).hash).toBe('#um/servicios');

  await recargar(page);

  const p = await pantalla(page);
  expect(p.vista).toBe('vistaUnidadesMantenimiento');
  expect(p.hash).toBe('#um/servicios');
  await expect(page.locator('#h09PanelST')).toBeVisible();
});

test('H10-20 · Atrás y Adelante del navegador restauran las vistas', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await abrirFicha(page, OC_ACTIVA.nro_oc);
  await page.evaluate(() => window.mostrarVista('vistaOrdenes'));
  await page.waitForTimeout(800);
  await abrirFicha(page, OC_CERRADA.nro_oc);
  expect((await pantalla(page)).hash).toContain(OC_CERRADA.nro_oc);

  await page.goBack();
  await page.waitForTimeout(1500);
  expect((await pantalla(page)).vista).toBe('vistaOrdenes');

  await page.goBack();
  await page.waitForTimeout(2000);
  const atras = await pantalla(page);
  expect(atras.vista).toBe('vistaFichaOC');
  expect(atras.hash).toContain(OC_ACTIVA.nro_oc);

  await page.goForward();
  await page.waitForTimeout(1500);
  expect((await pantalla(page)).vista).toBe('vistaOrdenes');
});

test('H10-21 · una URL directa abre una OC archivada aunque el filtro sea Activas', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  // El listado arranca filtrado en Activas: la OC archivada no figura ahi.
  await page.evaluate(() => window.mostrarVista('vistaOrdenes'));
  await page.waitForTimeout(700);
  await expect(page.locator('#ordenesFiltroRegistro')).toHaveValue('activas');

  await page.evaluate((n) => { location.hash = '#ficha-oc/' + n; }, OC_ARCHIVADA.nro_oc);
  await page.waitForTimeout(2500);

  const p = await pantalla(page);
  expect(p.vista).toBe('vistaFichaOC');
  expect(p.textoArchivar).toBe('Desarchivar OC');
  await expect(page.locator('#fichaOCBody')).toContainText(OC_ARCHIVADA.nro_oc);
  // Y no quedó atrapada en la pantalla de «no encontrada».
  await expect(page.locator('#h10OCNoEncontrada')).toHaveCount(0);
});

test('H10-22 · una ruta a una OC inexistente informa, no deja pantalla en blanco', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await page.evaluate(() => { location.hash = '#ficha-oc/9999999999'; });
  await page.waitForTimeout(4000);

  await expect(page.locator('#h10OCNoEncontrada')).toBeVisible();
  await expect(page.locator('#h10OCNoEncontrada')).toContainText('No se encontró la Orden de Compra solicitada.');
  // Y no se redirige en silencio a la Red.
  expect((await pantalla(page)).vista).toBe('vistaFichaOC');

  await page.click('#h10VolverAOrdenes');
  await page.waitForTimeout(900);
  const p = await pantalla(page);
  expect(p.vista).toBe('vistaOrdenes');
  expect(p.hash).toContain('ordenes');
});

test('H10-23 · el buscador global abre una OC archivada y actualiza la URL', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await page.fill('#coiV2GlobalSearch', OC_ARCHIVADA.proveedor);
  await page.waitForTimeout(900);
  const resultado = page.locator('#coiV2SearchPanel [data-v2-open-oc]').first();
  await expect(resultado).toBeVisible();
  await resultado.click();
  await page.waitForTimeout(1600);

  const p = await pantalla(page);
  expect(p.vista).toBe('vistaFichaOC');
  expect(p.hash).toContain('ficha-oc/' + OC_ARCHIVADA.nro_oc);
  expect(p.textoArchivar).toBe('Desarchivar OC');
});

test('H10-24 · la navegación no entra en bucle de hashchange', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await page.evaluate(() => {
    window.__H10_HASH__ = 0;
    window.addEventListener('hashchange', () => { window.__H10_HASH__ += 1; });
  });

  await abrirFicha(page, OC_ACTIVA.nro_oc);
  await page.evaluate(() => window.mostrarVista('vistaOrdenes'));
  await page.waitForTimeout(3000);

  const r = await page.evaluate(() => ({ eventos: window.__H10_HASH__, hash: location.hash }));
  // Dos navegaciones reales: como mucho un puñado de eventos, nunca una cascada.
  expect(r.eventos).toBeLessThanOrEqual(4);

  await page.waitForTimeout(2500);
  const estable = await page.evaluate(() => ({ eventos: window.__H10_HASH__, hash: location.hash }));
  // Y en reposo el hash deja de moverse.
  expect(estable.eventos).toBe(r.eventos);
  expect(estable.hash).toBe(r.hash);
});

test('H10-28 · la estación abierta viaja en la URL, en las dos direcciones', async ({ page }) => {
  // `estaciones` es un `const` de nivel superior: binding léxico global, no
  // propiedad de window. Leerlo mal dejaba la ruta muda. Ver KI-031.
  await prepararH10(page);
  await abrir(page);

  const publicado = await page.evaluate(async () => {
    const lista = (typeof estaciones !== 'undefined' && Array.isArray(estaciones))
      ? estaciones : (window.estaciones || []);
    const est = lista.find((e) => e && e.nombre === 'Temperley');
    if (!est || typeof window.selectStation !== 'function') return { error: 'sin estación' };
    window.selectStation(est);
    await new Promise((r) => setTimeout(r, 900));
    return { hash: location.hash, vista: (document.querySelector('.view.active') || {}).id };
  });
  expect(publicado.vista).toBe('vistaRed');
  expect(publicado.hash).toBe('#estacion/Temperley');

  // Y a la inversa: la URL pegada a mano abre la estación.
  await page.evaluate(() => { location.hash = '#inicio'; });
  await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = '#estacion/Lan%C3%BAs'; });
  await page.waitForTimeout(2000);

  expect((await pantalla(page)).vista).toBe('vistaRed');
  await expect(page.locator('#pTitle')).toContainText('Lanús');
});

test('H10-25 · sin hash se conserva la landing canónica vigente', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await page.waitForTimeout(1200);

  const p = await pantalla(page);
  // Inicio operativo sigue siendo la vista de arranque; el router solo la rotula.
  expect(p.vista).toBe('vistaDashboard');
  expect(p.hash).toBe('#inicio');
});
