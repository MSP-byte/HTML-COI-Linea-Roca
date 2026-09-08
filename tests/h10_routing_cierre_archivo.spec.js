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

      Ahora son dos ejes separados, sin columnas nuevas. H10 agrega una
      migracion de hardening que protege las transiciones en PostgreSQL:

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

// Finalizada por el circuito tecnico, pero NUNCA cerrada: sin
// fecha_cierre_operativo y sin el 'Cerrado' historico en estado_registro.
// Es la OC que el finding 1 dejaba archivar sin que nadie hubiera cerrado nada.
const OC_FINALIZADA = Object.assign({}, BASE, {
  id: '44444444-4444-4444-8444-444444444444', nro_oc: '4530000004',
  id_obra: 'OBRA-H10-FINALIZADA', proveedor: 'PROVEEDOR FINALIZADO',
  estado_coi: 'Finalizada', estado_registro: 'Activo'
});

// Variante con el texto largo del circuito, que tambien contenia DEFINITIVA.
const OC_ACTA_DEFINITIVA = Object.assign({}, BASE, {
  id: '55555555-5555-4555-8555-555555555555', nro_oc: '4530000005',
  id_obra: 'OBRA-H10-DEFINITIVA', proveedor: 'PROVEEDOR DEFINITIVA',
  estado_coi: 'Finalizada con acta definitiva', estado_registro: 'Activo'
});

// Cierre HISTORICO: la unica evidencia es estado_registro='Cerrado', que es la
// columna que archivar sobrescribe. Sin canonicalizacion previa, archivarla
// borraba la prueba de su cierre.
const OC_LEGACY_CERRADA = Object.assign({}, BASE, {
  id: '77777777-7777-4777-8777-777777777777', nro_oc: '4530000007',
  id_obra: 'OBRA-H10-LEGACY', proveedor: 'PROVEEDOR LEGACY',
  estado_coi: 'En ejecución', estado_registro: 'Cerrado'
});

const TODAS = [OC_ACTIVA, OC_CERRADA, OC_ARCHIVADA, OC_FINALIZADA, OC_ACTA_DEFINITIVA,
  OC_LEGACY_CERRADA];

// Unidades de Mantenimiento para las rutas #ficha-um.
const UM_UNA = {
  id: '66666666-6666-4666-8666-666666666666',
  codigo_um: 'ASC-H10-01', tipo_um: 'Ascensor', estacion: 'PLAZA CONSTITUCION',
  ubicacion_tecnica: 'Hall central', estado: 'ACTIVA',
  fecha_creacion: '2026-08-01T10:00:00.000Z', fecha_actualizacion: '2026-08-01T10:00:00.000Z'
};

// Claves operativas que ninguna de estas acciones puede escribir.
const CLAVES_OPERATIVAS = [
  'roca_coi_intervenciones_v10', 'coi_linea_roca_master_v18',
  'coi_supabase_ordenes_cache_v2', 'coiOrdenes'
];

// ============================================================ fixture

async function prepararH10(page, opciones = {}) {
  const cfg = Object.assign({
    ordenes: TODAS, fallaRpc: false, rol: 'administrador',
    // Unidades de Mantenimiento que publica el remoto, y cuanto tarda en
    // publicarlas. El retraso es real —la promesa queda pendiente—, no un
    // flag: asi __COI_UM_H05__.sincronizado pasa por false de verdad.
    ums: [], umDelayMs: 0,
    // Fallos de carga, para separar «error remoto» de «entidad inexistente».
    // Con `soloPrimeraLectura` el fallo se cura solo tras la primera lectura,
    // que es lo que permite demostrar que Reintentar LEE DE NUEVO.
    fallaOrdenes: false, fallaSesion: false,
    fallaUms: false, soloPrimeraLectura: false
  }, opciones);

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
      // Lecturas remotas por tabla: la evidencia de que Reintentar volvio a
      // consultar Supabase y no solo repinto la pantalla.
      lecturas: { coi_ordenes: 0, coi_unidades_mantenimiento: 0 },
      sanar: () => { window.__H10_SANO__ = true; },
      remoto: () => filas.map((f) => Object.assign({}, f)),
      fila: (nro) => filas.find((f) => String(f.nro_oc) === String(nro)) || null
    };

    // Cualquier intento de persistir estado operativo queda registrado.
    const setItemNativo = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (claves.indexOf(k) >= 0) window.__H10__.escriturasOperativas.push(k);
      return setItemNativo.call(this, k, v);
    };

    const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
    let umsPublicadas = c.umDelayMs > 0 ? null : c.ums.slice();
    if (c.umDelayMs > 0) {
      setTimeout(() => { umsPublicadas = c.ums.slice(); }, c.umDelayMs);
    }

    function consulta(tabla) {
      const st = { tabla, filtros: [], conteo: false };
      const datos = () => {
        if (tabla === 'coi_ordenes') return filas;
        if (tabla === 'coi_unidades_mantenimiento') return umsPublicadas || [];
        return [];
      };
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
          if (Object.prototype.hasOwnProperty.call(window.__H10__.lecturas, tabla)) {
            window.__H10__.lecturas[tabla] += 1;
          }
          // `soloPrimeraLectura` hace que el fallo se cure tras la primera
          // consulta: si el boton no relee, el error nunca desaparece.
          const sano = c.soloPrimeraLectura && window.__H10_SANO__ === true;
          if (tabla === 'coi_ordenes' && c.fallaOrdenes && !sano) {
            return { data: null, count: null, error: { message: 'fixture H10: lectura de órdenes rechazada' } };
          }
          if (tabla === 'coi_unidades_mantenimiento' && c.fallaUms && !sano) {
            return { data: null, count: null, error: { message: 'fixture H10: lectura de UM rechazada' } };
          }
          // Mientras el remoto de UM no publico nada, la consulta NO resuelve:
          // es exactamente el estado que el router tiene que esperar.
          if (tabla === 'coi_unidades_mantenimiento' && umsPublicadas === null) {
            while (umsPublicadas === null) await dormir(60);
          }
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
          const cambios = args.p_cambios || {};
          const n = (v) => String(v ?? '').trim().toUpperCase();
          const estadoCerrado = (r) => ['CERRADA','CERRADO'].includes(n(r.estado_coi));
          const cerrado = (r) => estadoCerrado(r) || Boolean(r.fecha_cierre_operativo) || n(r.estado_registro) === 'CERRADO';
          const antes = Object.assign({}, f), despues = Object.assign({}, f, cambios);
          const oldClosed = cerrado(antes), newClosed = cerrado(despues);
          const has = (k) => Object.prototype.hasOwnProperty.call(cambios, k);

          if (n(despues.estado_registro) === 'ARCHIVADO' && n(antes.estado_registro) !== 'ARCHIVADO' && !oldClosed)
            return { data: null, error: { code: 'P0001', message: 'COI_ARCHIVE_REQUIRES_CLOSED_ORDER' } };
          if (oldClosed && has('estado_coi') && estadoCerrado(antes) && !estadoCerrado(despues))
            return { data: null, error: { code: 'P0001', message: 'COI_CLOSURE_IMMUTABLE' } };
          if (oldClosed && ((has('fecha_cierre_operativo')) || (has('observacion_cierre'))))
            return { data: null, error: { code: 'P0001', message: 'COI_CLOSURE_IMMUTABLE' } };
          if (oldClosed && !newClosed)
            return { data: null, error: { code: 'P0001', message: 'COI_CLOSURE_IMMUTABLE' } };
          if (!oldClosed && n(despues.estado_registro) === 'CERRADO')
            return { data: null, error: { code: 'P0001', message: 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT' } };
          if (!oldClosed && (estadoCerrado(despues) || has('fecha_cierre_operativo') || has('observacion_cierre'))) {
            if (!estadoCerrado(despues) || !despues.fecha_cierre_operativo || !String(despues.observacion_cierre || '').trim())
              return { data: null, error: { code: 'P0001', message: 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT' } };
          }
          Object.assign(f, cambios);
          persistir();
          return { data: { orden: Object.assign({}, f) }, error: null };
        }
        return { data: null, error: null };
      },
      auth: {
        getSession: async () => (c.fallaSesion
          ? { data: { session: null }, error: { message: 'fixture H10: sesión no disponible' } }
          : { data: { session: { user: { id: uid, email: 'admin@coiroca.test' } } }, error: null }),
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

// Abre la aplicacion SIN exigir catalogo: para los casos en que el remoto
// falla o esta legitimamente vacio, donde esperar filas colgaria la prueba.
async function abrirCrudo(page, hash) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html' + (hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_ROUTING_H10), null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  return errores;
}

const lecturas = (page, tabla) => page.evaluate((t) => window.__H10__.lecturas[t], tabla);

const estadoRuta = (page) => page.evaluate(() => ({
  hash: location.hash,
  noEncontrada: Boolean(document.getElementById('h10OCNoEncontrada')),
  ocNoEncontrada: (document.getElementById('h10OCNoEncontrada') || {}).dataset
    ? document.getElementById('h10OCNoEncontrada').getAttribute('data-h10-oc') : '',
  errorCatalogo: Boolean(document.getElementById('h10CatalogoNoDisponible')),
  errorUM: Boolean(document.getElementById('h10UMNoDisponible')),
  umNoEncontrada: Boolean(document.getElementById('h10UMNoEncontrada')),
  rutaInvalida: Boolean(document.getElementById('h10RutaInvalida')),
  vista: (document.querySelector('.view.active') || {}).id || '',
  texto: (document.getElementById('fichaOCBody') || {}).textContent || ''
}));

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

// ============================================================ C · revisión Codex del PR #64
//
// Comportamiento en navegador de los 7 findings. Los controles estáticos de
// tests/check_h10_routing_cierre_archivo.js fijan la FORMA del código; estos
// fijan lo que el operador ve y lo que llega al remoto.

// ---------------------------------------------------------------- F1 · cierre explícito

test('H10-29 · F1 · una OC Finalizada sin cierre explícito no se puede archivar', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_FINALIZADA.nro_oc);

  // Finalizada describe el fin del circuito técnico, no el acto de cerrar.
  const antes = await pantalla(page);
  expect(antes.archivarDeshabilitado).toBe(true);
  expect(antes.tituloArchivar).toContain('cerrar la OC');
  // Y «Cerrar OC» sigue disponible, porque justamente falta cerrarla.
  expect(antes.textoCerrar).toContain('Cerrar');

  // La llamada directa tampoco archiva: 0 escritura remota.
  const ok = await page.evaluate((n) => window.archivarOC(n), OC_FINALIZADA.nro_oc);
  await page.waitForTimeout(1200);
  expect(ok).toBe(false);
  expect(await cambiosRPC(page)).toHaveLength(0);
  expect((await remoto(page, OC_FINALIZADA.nro_oc)).estado_registro).toBe('Activo');
});

test('H10-30 · F1 · «Finalizada con acta definitiva» tampoco habilita archivar', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTA_DEFINITIVA.nro_oc);

  expect((await pantalla(page)).archivarDeshabilitado).toBe(true);
  await page.evaluate((n) => window.archivarOC(n), OC_ACTA_DEFINITIVA.nro_oc);
  await page.waitForTimeout(1200);
  expect(await cambiosRPC(page)).toHaveLength(0);
  expect((await remoto(page, OC_ACTA_DEFINITIVA.nro_oc)).estado_registro).toBe('Activo');
});

test('H10-31 · F1 · tras cerrar de verdad, archivar queda habilitado', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_FINALIZADA.nro_oc);

  await page.evaluate(() => window.cerrarOC());
  await page.waitForTimeout(2500);

  const r = await remoto(page, OC_FINALIZADA.nro_oc);
  expect(r.estado_coi).toBe('Cerrada');
  expect(r.cierre).toBeTruthy();

  await abrirFicha(page, OC_FINALIZADA.nro_oc);
  expect((await pantalla(page)).archivarDeshabilitado).toBe(false);

  await page.evaluate((n) => window.archivarOC(n), OC_FINALIZADA.nro_oc);
  await page.waitForTimeout(2000);
  expect((await remoto(page, OC_FINALIZADA.nro_oc)).estado_registro).toBe('Archivado');
});

// ---------------------------------------------------------------- F2 · entry point exportado

test('H10-32 · F2 · el export de H09 no puede archivar una OC abierta', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  // Entrada pública que saltaba el guard y entraba directo al ejecutor.
  const ok = await page.evaluate((n) => window.COI_ARCHIVO_OC_H09.archivar(n), OC_ACTIVA.nro_oc);
  await page.waitForTimeout(1500);

  expect(ok).toBe(false);
  const archivados = (await cambiosRPC(page)).filter((c) => c && c.estado_registro === 'Archivado');
  expect(archivados).toHaveLength(0);
  expect((await remoto(page, OC_ACTIVA.nro_oc)).estado_registro).toBe('Activo');
});

test('H10-33 · F2 · el export de H09 sí archiva una OC cerrada, y desarchivar sigue libre', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);

  const ok = await page.evaluate((n) => window.COI_ARCHIVO_OC_H09.archivar(n), OC_CERRADA.nro_oc);
  await page.waitForTimeout(2000);
  expect(ok).not.toBe(false);
  expect((await remoto(page, OC_CERRADA.nro_oc)).estado_registro).toBe('Archivado');

  // Sacar del historial no reabre nada y no pasa por la regla de cierre.
  await page.evaluate((n) => window.COI_ARCHIVO_OC_H09.desarchivar(n), OC_CERRADA.nro_oc);
  await page.waitForTimeout(2000);
  const r = await remoto(page, OC_CERRADA.nro_oc);
  expect(r.estado_registro).toBe('Activo');
  expect(r.estado_coi).toBe('Cerrada');
});

test('H10-34 · F2 · el guard sigue puesto después de que H09 se reinstala', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  // H09 se reinstala hasta los 6 s: si el guard no se reaplica, la puerta se
  // reabre sola pasado ese tiempo.
  await page.waitForTimeout(7000);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  const ok = await page.evaluate((n) => window.COI_ARCHIVO_OC_H09.archivar(n), OC_ACTIVA.nro_oc);
  await page.waitForTimeout(1500);
  expect(ok).toBe(false);
  expect((await remoto(page, OC_ACTIVA.nro_oc)).estado_registro).toBe('Activo');
});

// ---------------------------------------------------------------- F3 · fecha local

test.describe('F3 · fecha de cierre en calendario local', () => {
  // Zona real del operador. Con el reloj congelado a las 22:30 del 7, en UTC
  // ya es el 8: es la ventana en que toISOString corría la fecha un día.
  test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

  test('H10-35 · F3 · un cierre nocturno guarda la fecha del día local, no la de UTC', async ({ page }) => {
    await prepararH10(page);
    // 2026-09-08T01:30:00Z === 2026-09-07 22:30 en Argentina (UTC-3).
    await page.addInitScript(() => {
      const FIJO = Date.parse('2026-09-08T01:30:00.000Z');
      const Real = Date;
      function Falso(...args) {
        if (args.length === 0) return new Real(FIJO);
        return new Real(...args);
      }
      Falso.prototype = Real.prototype;
      Falso.now = () => FIJO;
      Falso.parse = Real.parse;
      Falso.UTC = Real.UTC;
      window.Date = Falso;
    });
    await abrir(page);
    await abrirFicha(page, OC_ACTIVA.nro_oc);

    await page.evaluate(() => window.cerrarOC());
    await page.waitForTimeout(2500);

    // Se mira el payload REAL que recibió el remoto del fixture.
    const cambios = await cambiosRPC(page);
    expect(cambios).toHaveLength(1);
    expect(cambios[0].fecha_cierre_operativo).toBe('2026-09-07');
    expect(cambios[0].fecha_cierre_operativo).not.toBe('2026-09-08');
    expect((await remoto(page, OC_ACTIVA.nro_oc)).cierre).toBe('2026-09-07');
  });
});

// ---------------------------------------------------------------- F4 · snapshot UM

test('H10-36 · F4 · #ficha-um espera el snapshot de UM y no pierde la ruta', async ({ page }) => {
  // El remoto de UM tarda: durante ese rato __COI_UM_H05__.sincronizado es
  // false de verdad y la UM todavía no está publicada.
  await prepararH10(page, { ums: [UM_UNA], umDelayMs: 4000 });
  const errores = await abrirCrudo(page, '#ficha-um/' + UM_UNA.codigo_um);

  // Mientras carga, la ruta pedida NO se pierde ni se normaliza a otra vista.
  expect((await estadoRuta(page)).hash).toContain('ficha-um/' + UM_UNA.codigo_um);

  await page.waitForFunction(
    () => Boolean(window.__COI_UM_H05__ && window.__COI_UM_H05__.sincronizado === true),
    null, { timeout: 20000 });
  await page.waitForTimeout(2500);

  const fin = await estadoRuta(page);
  expect(fin.hash).toContain('ficha-um/' + UM_UNA.codigo_um);
  expect(fin.vista).toBe('vistaFichaUM');
  expect(fin.errorUM).toBe(false);
  expect(fin.umNoEncontrada).toBe(false);
  expect(errores).toEqual([]);
});

test('H10-37 · F4 · UM confirmada vacía muestra «no encontrada», no un error de carga', async ({ page }) => {
  await prepararH10(page, { ums: [] });
  await abrirCrudo(page, '#ficha-um/ASC-INEXISTENTE');
  await page.waitForFunction(
    () => Boolean(window.__COI_UM_H05__ && window.__COI_UM_H05__.sincronizado === true),
    null, { timeout: 20000 });
  await page.waitForTimeout(2000);

  const e = await estadoRuta(page);
  expect(e.umNoEncontrada).toBe(true);
  expect(e.errorUM).toBe(false);
  expect(e.texto).toContain('No se encontró la Unidad de Mantenimiento');
  // La dirección pedida sobrevive: no se cae a Inicio ni a Red.
  expect(e.hash).toContain('ficha-um/ASC-INEXISTENTE');
});

// ---------------------------------------------------------------- F5 · error ≠ inexistente

test('H10-38 · F5 · si la lectura de Órdenes falla, no se afirma que la OC no existe', async ({ page }) => {
  await prepararH10(page, { fallaOrdenes: true });
  await abrirCrudo(page, '#ficha-oc/' + OC_ACTIVA.nro_oc);

  // El router da hasta 6 s para dar por no confirmado el catálogo. Se espera el
  // estado TERMINAL, no un sleep fijo: con 3 s el Gate inspeccionaba antes de
  // tiempo y veía errorCatalogo=false. Bajar el límite productivo para que el
  // test pase sería falsear la prueba.
  await expect(page.locator('#h10CatalogoNoDisponible')).toBeVisible({ timeout: 12000 });

  const e = await estadoRuta(page);
  expect(e.errorCatalogo).toBe(true);
  expect(e.noEncontrada).toBe(false);
  expect(e.texto).toContain('No se pudo cargar el catálogo');
  expect(e.texto).not.toContain('No se encontró la Orden de Compra solicitada');
});

test('H10-39 · F5 · si la sesión falla tampoco se afirma que la OC no existe', async ({ page }) => {
  await prepararH10(page, { fallaSesion: true });
  await abrirCrudo(page, '#ficha-oc/' + OC_ACTIVA.nro_oc);

  // Mismo criterio determinista que H10-38.
  await page.waitForFunction(
    () => Boolean(document.getElementById('h10CatalogoNoDisponible')) ||
          Boolean(document.getElementById('h10OCNoEncontrada')),
    null, { timeout: 12000 });

  const e = await estadoRuta(page);
  expect(e.noEncontrada).toBe(false);
  expect(e.texto).not.toContain('No se encontró la Orden de Compra solicitada');
});

test('H10-40 · F5 · con catálogo remoto confirmado vacío sí se afirma que no existe', async ({ page }) => {
  // Lectura remota confirmada, y devolvió []. Ahí la afirmación es verificada.
  await prepararH10(page, { ordenes: [] });
  await abrirCrudo(page, '#ficha-oc/4530999999');

  const e = await estadoRuta(page);
  expect(e.noEncontrada).toBe(true);
  expect(e.errorCatalogo).toBe(false);
  expect(e.texto).toContain('No se encontró la Orden de Compra solicitada');
});

// ---------------------------------------------------------------- F6 · identidad stale

test('H10-41 · F6 · el not-found conserva la OC pedida y no vuelve a la anterior', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);
  expect((await pantalla(page)).hash).toContain(OC_ACTIVA.nro_oc);

  // Cambio manual del hash a una OC que no existe.
  await page.evaluate(() => { location.hash = '#ficha-oc/4530999999'; });
  await page.waitForTimeout(3000);

  const e = await estadoRuta(page);
  expect(e.noEncontrada).toBe(true);
  expect(e.ocNoEncontrada).toBe('4530999999');
  // La URL sigue siendo la pedida: no la reemplaza la OC anterior.
  expect(e.hash).toContain('4530999999');
  expect(e.hash).not.toContain(OC_ACTIVA.nro_oc);

  // Y F5 sobre esa ruta sigue mostrando B, no A.
  await recargar(page);
  const tras = await estadoRuta(page);
  expect(tras.hash).toContain('4530999999');
  expect(tras.hash).not.toContain(OC_ACTIVA.nro_oc);
  expect(tras.noEncontrada).toBe(true);
});

// ---------------------------------------------------------------- F7 · hash malformado

for (const hash of ['#%', '#ficha-oc/ABC%', '#estacion/%ZZ']) {
  test(`H10-42 · F7 · el hash malformado ${hash} muestra ruta inválida sin romper`, async ({ page }) => {
    await prepararH10(page);
    const errores = await abrirCrudo(page, hash);

    // decodeURIComponent lanzaba URIError y la excepción se tragaba.
    expect(errores.filter((e) => /URIError/.test(e))).toEqual([]);

    const e = await estadoRuta(page);
    expect(e.rutaInvalida).toBe(true);
    expect(e.texto).toContain('No se pudo interpretar la dirección solicitada');
    // Hay salida: el operador no queda encerrado en el error.
    expect(await page.evaluate(() => Boolean(document.getElementById('h10VolverAOrdenes')))).toBe(true);
  });
}

test('H10-43 · F7 · desde la ruta inválida se vuelve a Órdenes y la URL se corrige', async ({ page }) => {
  await prepararH10(page);
  await abrirCrudo(page, '#ficha-oc/ABC%');
  expect((await estadoRuta(page)).rutaInvalida).toBe(true);

  await page.click('#h10VolverAOrdenes');
  await page.waitForTimeout(1500);

  const e = await estadoRuta(page);
  expect(e.vista).toBe('vistaOrdenes');
  expect(e.hash).toContain('ordenes');
  // El nodo del error tiene que quedar RETIRADO del DOM, no solo tapado: si
  // sigue montado, la pantalla siguiente arrastra el error bajo una URL ya
  // corregida.
  expect(e.rutaInvalida).toBe(false);
  expect(await page.locator('#h10RutaInvalida').count()).toBe(0);
  expect(await page.evaluate(() => window.COI_ROUTING_H10.rutaVigente())).not.toContain('ABC');
});

// ============================================================ D · segunda revisión Codex del PR #64

// ---------------------------------------------------------------- P1 · cierre legacy preservado

test('H10-44 · P1 · archivar una OC con cierre legacy canonicaliza antes y no destruye la evidencia', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_LEGACY_CERRADA.nro_oc);

  // Se puede archivar: el cierre histórico vale como cierre.
  expect((await pantalla(page)).archivarDeshabilitado).toBe(false);

  await page.evaluate((n) => window.archivarOC(n), OC_LEGACY_CERRADA.nro_oc);
  await page.waitForTimeout(3000);

  // Dos escrituras, en este orden: primero se preserva el cierre en su eje
  // propio, después se archiva.
  const cambios = await cambiosRPC(page);
  expect(cambios).toHaveLength(2);
  expect(cambios[0]).toEqual({ estado_coi: 'Cerrada' });
  expect(cambios[1]).toHaveProperty('estado_registro', 'Archivado');
  // No se inventa historia que nadie registró.
  expect(cambios[0]).not.toHaveProperty('fecha_cierre_operativo');
  expect(cambios[0]).not.toHaveProperty('observacion_cierre');

  const r = await remoto(page, OC_LEGACY_CERRADA.nro_oc);
  expect(r.estado_coi).toBe('Cerrada');
  expect(r.estado_registro).toBe('Archivado');
  expect(r.cierre || '').toBe('');

  // Y tras releer Supabase sigue leyéndose como cerrada.
  await recargar(page);
  await abrirFicha(page, OC_LEGACY_CERRADA.nro_oc);
  const tras = await remoto(page, OC_LEGACY_CERRADA.nro_oc);
  expect(tras.estado_coi).toBe('Cerrada');
  expect(tras.estado_registro).toBe('Archivado');
  const p = await pantalla(page);
  expect(p.textoArchivar).toContain('Desarchivar');
});

test('H10-45 · P1 · una OC ya cerrada canónicamente no paga una escritura extra', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);

  await page.evaluate((n) => window.archivarOC(n), OC_CERRADA.nro_oc);
  await page.waitForTimeout(2500);

  const cambios = await cambiosRPC(page);
  expect(cambios).toHaveLength(1);
  expect(cambios[0]).toHaveProperty('estado_registro', 'Archivado');
});

test('H10-46 · P1 · si la canonicalización falla no se archiva nada', async ({ page }) => {
  await prepararH10(page, { fallaRpc: true });
  await abrir(page);
  await abrirFicha(page, OC_LEGACY_CERRADA.nro_oc);

  const ok = await page.evaluate((n) => window.archivarOC(n), OC_LEGACY_CERRADA.nro_oc);
  await page.waitForTimeout(2500);

  expect(ok).toBe(false);
  // Fail closed: el estado de registro no se movió, así que el cierre
  // histórico sigue siendo legible.
  expect((await remoto(page, OC_LEGACY_CERRADA.nro_oc)).estado_registro).toBe('Cerrado');
});

// ---------------------------------------------------------------- P2 · ficha UM independiente de Órdenes

test('H10-47 · P2 · #ficha-um abre aunque el catálogo de Órdenes falle', async ({ page }) => {
  // Órdenes caído, UM sano: la ficha UM no depende de coi_ordenes.
  await prepararH10(page, { fallaOrdenes: true, ums: [UM_UNA] });
  await abrirCrudo(page, '#ficha-um/' + UM_UNA.codigo_um);

  await page.waitForFunction(
    () => (document.querySelector('.view.active') || {}).id === 'vistaFichaUM',
    null, { timeout: 15000 });

  const e = await estadoRuta(page);
  expect(e.vista).toBe('vistaFichaUM');
  expect(e.errorUM).toBe(false);
  expect(e.errorCatalogo).toBe(false);
  expect(e.hash).toContain('ficha-um/' + UM_UNA.codigo_um);
});

// ---------------------------------------------------------------- P2 · Reintentar relee Supabase

test('H10-48 · P2 · Reintentar catálogo dispara una lectura nueva de coi_ordenes', async ({ page }) => {
  await prepararH10(page, { fallaOrdenes: true, soloPrimeraLectura: true, ordenes: TODAS });
  await abrirCrudo(page, '#ficha-oc/' + OC_ACTIVA.nro_oc);
  await expect(page.locator('#h10CatalogoNoDisponible')).toBeVisible({ timeout: 12000 });

  const antes = await lecturas(page, 'coi_ordenes');
  // A partir de acá el remoto responde bien: si el botón no relee, el error
  // no puede desaparecer.
  await page.evaluate(() => window.__H10__.sanar());
  await page.click('#h10ReintentarCatalogo');

  await page.waitForFunction(
    () => !document.getElementById('h10CatalogoNoDisponible'), null, { timeout: 15000 });

  expect(await lecturas(page, 'coi_ordenes')).toBeGreaterThan(antes);
  const e = await estadoRuta(page);
  expect(e.errorCatalogo).toBe(false);
  expect(e.noEncontrada).toBe(false);
  expect(e.hash).toContain(OC_ACTIVA.nro_oc);
});

test('H10-49 · P2 · Reintentar UM dispara una lectura nueva de coi_unidades_mantenimiento', async ({ page }) => {
  await prepararH10(page, { fallaUms: true, soloPrimeraLectura: true, ums: [UM_UNA] });
  await abrirCrudo(page, '#ficha-um/' + UM_UNA.codigo_um);
  await expect(page.locator('#h10UMNoDisponible')).toBeVisible({ timeout: 15000 });

  const antes = await lecturas(page, 'coi_unidades_mantenimiento');
  await page.evaluate(() => window.__H10__.sanar());
  await page.click('#h10ReintentarUM');

  await page.waitForFunction(
    () => !document.getElementById('h10UMNoDisponible'), null, { timeout: 15000 });

  expect(await lecturas(page, 'coi_unidades_mantenimiento')).toBeGreaterThan(antes);
  expect((await estadoRuta(page)).hash).toContain('ficha-um/' + UM_UNA.codigo_um);
});

test('H10-50 · P2 · si la relectura vuelve a fallar se conserva el error, no se afirma inexistencia', async ({ page }) => {
  await prepararH10(page, { fallaOrdenes: true });
  await abrirCrudo(page, '#ficha-oc/' + OC_ACTIVA.nro_oc);
  await expect(page.locator('#h10CatalogoNoDisponible')).toBeVisible({ timeout: 12000 });

  const antes = await lecturas(page, 'coi_ordenes');
  await page.click('#h10ReintentarCatalogo');
  await page.waitForTimeout(9000);

  expect(await lecturas(page, 'coi_ordenes')).toBeGreaterThan(antes);
  const e = await estadoRuta(page);
  expect(e.noEncontrada).toBe(false);
  expect(e.texto).not.toContain('No se encontró la Orden de Compra solicitada');
});

// ---------------------------------------------------------------- P2 · #red limpia la estación

test('H10-51 · P2 · volver a #red deja la Red general, sin estación seleccionada', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await page.evaluate(() => { location.hash = '#estacion/Temperley'; });
  await page.waitForTimeout(2500);
  let e = await page.evaluate(() => ({
    hash: location.hash,
    panel: Boolean(document.querySelector('#panelEstacion.active'))
  }));
  expect(e.hash).toContain('estacion/Temperley');
  expect(e.panel).toBe(true);

  await page.evaluate(() => { location.hash = '#red'; });
  await page.waitForTimeout(3000);

  e = await page.evaluate(() => ({
    hash: location.hash,
    vista: (document.querySelector('.view.active') || {}).id || '',
    panel: Boolean(document.querySelector('#panelEstacion.active')),
    ruta: window.COI_ROUTING_H10.rutaVigente()
  }));
  expect(e.hash).toBe('#red');
  expect(e.vista).toBe('vistaRed');
  expect(e.panel).toBe(false);
  expect(e.ruta).toBe('red');
  expect(e.hash).not.toContain('Temperley');
});

test('H10-52 · P2 · Atrás desde una estación no vuelve sola a la estación', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await page.evaluate(() => { location.hash = '#red'; });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { location.hash = '#estacion/Temperley'; });
  await page.waitForTimeout(2500);

  await page.goBack();
  await page.waitForTimeout(3000);

  const e = await page.evaluate(() => ({
    hash: location.hash,
    panel: Boolean(document.querySelector('#panelEstacion.active'))
  }));
  expect(e.hash).toBe('#red');
  expect(e.panel).toBe(false);
});

// ---------------------------------------------------------------- P2 · filtro de registro real

const filasVisibles = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('#ordenesTbody tr')).map((tr) => tr.textContent || '').join(' | '));

test('H10-53 · P2 · #ordenes/archivadas muestra solo archivadas', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await page.evaluate(() => { location.hash = '#ordenes/archivadas'; });
  await page.waitForTimeout(3000);

  const sel = await page.evaluate(() => (document.getElementById('ordenesFiltroRegistro') || {}).value);
  expect(sel).toBe('archivadas');
  const filas = await filasVisibles(page);
  expect(filas).toContain(OC_ARCHIVADA.id_obra);
  expect(filas).not.toContain(OC_ACTIVA.id_obra);
});

test('H10-54 · P2 · #ordenes/activas excluye las archivadas', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await page.evaluate(() => { location.hash = '#ordenes/activas'; });
  await page.waitForTimeout(3000);

  const filas = await filasVisibles(page);
  expect(filas).toContain(OC_ACTIVA.id_obra);
  expect(filas).not.toContain(OC_ARCHIVADA.id_obra);
});

test('H10-55 · P2 · #ordenes/todas muestra ambas', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await page.evaluate(() => { location.hash = '#ordenes/todas'; });
  await page.waitForTimeout(3000);

  const filas = await filasVisibles(page);
  expect(filas).toContain(OC_ACTIVA.id_obra);
  expect(filas).toContain(OC_ARCHIVADA.id_obra);
});

// ============================================================ E · tercera revisión Codex del PR #64

// ---------------------------------------------------------------- P2 · cancelar archivo legacy no escribe

test('H10-56 · P2 · cancelar Archivar en una OC legacy no escribe ni canonicaliza', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_LEGACY_CERRADA.nro_oc);

  await page.evaluate(() => { window.confirm = () => false; });
  const ok = await page.evaluate((n) => window.archivarOC(n), OC_LEGACY_CERRADA.nro_oc);
  await page.waitForTimeout(500);

  expect(ok).toBe(false);
  expect(await cambiosRPC(page)).toEqual([]);
  const r = await page.evaluate((n) => {
    const f = window.__H10__.fila(n) || {};
    return { estado_coi: f.estado_coi, estado_registro: f.estado_registro };
  }, OC_LEGACY_CERRADA.nro_oc);
  expect(r.estado_coi).toBe('En ejecución');
  expect(r.estado_registro).toBe('Cerrado');
});

// ---------------------------------------------------------------- P1 · no pisar el primer cierre remoto

test('H10-57 · P1 · un cierre remoto concurrente conserva fecha y observación originales', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  // Simula otro operador cerrando después del snapshot local de esta pestaña.
  await page.evaluate((n) => {
    const f = window.__H10__.fila(n);
    f.estado_coi = 'Cerrada';
    f.fecha_cierre_operativo = '2026-08-29';
    f.observacion_cierre = 'Cierre confirmado por otro operador';
  }, OC_ACTIVA.nro_oc);

  const ok = await page.evaluate(() => window.cerrarOC());
  await page.waitForTimeout(1200);

  expect(ok).toBe(false);
  // Con H10 la atomicidad vive en PostgreSQL, no en un SELECT preventivo del
  // navegador. Una pestaña con snapshot obsoleto puede intentar el cierre por
  // la RPC canónica; el FOR UPDATE + guard server-side rechazan ese segundo
  // cierre y preservan la auditoría ya confirmada.
  const intentos = await cambiosRPC(page);
  expect(intentos).toHaveLength(1);
  // El repositorio normaliza el patch contra la fila remota que acaba de leer.
  // Si otro operador ya puso estado_coi='Cerrada', ese campo redundante puede
  // desaparecer antes de llamar al RPC. Lo que importa es que el intento de
  // cambiar la auditoria llegue al guard server-side y sea rechazado.
  expect(intentos[0]).toHaveProperty('fecha_cierre_operativo');
  expect(intentos[0]).toHaveProperty('observacion_cierre', 'Cierre operativo de prueba');
  expect(intentos[0]).not.toHaveProperty('estado_registro');
  if (Object.prototype.hasOwnProperty.call(intentos[0], 'estado_coi')) {
    expect(intentos[0].estado_coi).toBe('Cerrada');
  }
  const r = await page.evaluate((n) => {
    const f = window.__H10__.fila(n) || {};
    return {
      estado: f.estado_coi,
      fecha: f.fecha_cierre_operativo,
      observacion: f.observacion_cierre
    };
  }, OC_ACTIVA.nro_oc);
  expect(r.estado).toBe('Cerrada');
  expect(r.fecha).toBe('2026-08-29');
  expect(r.observacion).toBe('Cierre confirmado por otro operador');
});

// ---------------------------------------------------------------- P2 · Timeline también es ruta persistente

test('H10-58 · P2 · #timeline abre Timeline y sobrevive a F5', async ({ page }) => {
  await prepararH10(page);
  await abrirCrudo(page, '#timeline');
  await page.waitForFunction(
    () => (document.querySelector('.view.active') || {}).id === 'vistaTimelineCOI',
    null, { timeout: 12000 });

  let e = await page.evaluate(() => ({
    hash: location.hash,
    vista: (document.querySelector('.view.active') || {}).id || '',
    ruta: window.COI_ROUTING_H10.rutaVigente()
  }));
  expect(e.hash).toBe('#timeline');
  expect(e.vista).toBe('vistaTimelineCOI');
  expect(e.ruta).toBe('timeline');

  await recargar(page);
  e = await page.evaluate(() => ({
    hash: location.hash,
    vista: (document.querySelector('.view.active') || {}).id || ''
  }));
  expect(e.hash).toBe('#timeline');
  expect(e.vista).toBe('vistaTimelineCOI');
});

// ---------------------------------------------------------------- P2 · identidad de rutas de error

test('H10-59 · P2 · una ruta malformada conserva su hash aunque antes hubiera otra OC abierta', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);

  await page.evaluate(() => { location.hash = '#ficha-oc/ABC%'; });
  await page.waitForTimeout(2500);

  const e = await estadoRuta(page);
  expect(e.rutaInvalida).toBe(true);
  expect(e.hash).toContain('ABC%');
  expect(e.hash).not.toContain(OC_ACTIVA.nro_oc);
  expect(await page.evaluate(() => window.COI_ROUTING_H10.rutaVigente())).toContain('ABC%');
});

test('H10-60 · P2 · navegación ordinaria limpia la identidad de un error de ruta', async ({ page }) => {
  await prepararH10(page);
  await abrirCrudo(page, '#ficha-oc/9999999999');
  await page.waitForFunction(() => Boolean(document.getElementById('h10OCNoEncontrada')),
    null, { timeout: 12000 });

  // El shell V2 oculta los botones legacy de #moduleNav; navegar por el
  // entry point ordinario evita que el test dependa de un control de respaldo
  // deliberadamente no visible y sigue cubriendo la limpieza de rutaError.
  await page.evaluate(() => window.mostrarVista('vistaOrdenes'));
  await page.waitForTimeout(1800);

  const e = await estadoRuta(page);
  expect(e.vista).toBe('vistaOrdenes');
  expect(e.hash).toContain('ordenes');
  expect(e.hash).not.toContain('9999999999');
  expect(e.noEncontrada).toBe(false);
});

// ---------------------------------------------------------------- P2 · una ruta inicial vieja no pisa navegación nueva

test('H10-61 · P2 · el arranque lento no reabre la ruta inicial después de que el operador navegó', async ({ page }) => {
  await prepararH10(page, { fallaOrdenes: true });
  await page.goto('/index.html#ficha-oc/' + OC_ACTIVA.nro_oc, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_ROUTING_H10), null, { timeout: 20000 });

  // Mientras restaurar() espera el snapshot de Órdenes, el operador sale a Red.
  await page.evaluate(() => { location.hash = '#red'; });
  await page.waitForTimeout(7500);

  const e = await estadoRuta(page);
  expect(e.hash).toBe('#red');
  expect(e.vista).toBe('vistaRed');
  expect(e.errorCatalogo).toBe(false);
});

// ---------------------------------------------------------------- P2 · navegación real durante restauración

test('H10-70 · P2 · un click real del sidebar durante startup gana al deep-link inicial', async ({ page }) => {
  await prepararH10(page, { fallaOrdenes: true });
  await page.goto('/index.html#ficha-oc/' + OC_ACTIVA.nro_oc, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_ROUTING_H10), null, { timeout: 20000 });
  await page.waitForSelector('[data-v2-nav="btnRed"]', { state: 'visible', timeout: 12000 });

  // Este es el caso que no cubría H10-61: el operador NO toca location.hash;
  // usa la navegación real. El guard de restauración no debe tragarse su click.
  await page.click('[data-v2-nav="btnRed"]');
  await page.waitForTimeout(7500);

  const e = await estadoRuta(page);
  expect(e.hash).toBe('#red');
  expect(e.vista).toBe('vistaRed');
  expect(e.errorCatalogo).toBe(false);
});

// ---------------------------------------------------------------- P2 · identidad exacta de OC

test('H10-62 · P2 · un prefijo de OC inexistente no abre una coincidencia parcial', async ({ page }) => {
  await prepararH10(page);
  await abrirCrudo(page, '#ficha-oc/4530');
  await page.waitForFunction(() => Boolean(document.getElementById('h10OCNoEncontrada')),
    null, { timeout: 12000 });

  const e = await estadoRuta(page);
  expect(e.noEncontrada).toBe(true);
  expect(e.ocNoEncontrada).toBe('4530');
  expect(e.hash).toContain('4530');
  expect(e.hash).not.toContain(OC_ACTIVA.nro_oc);
});

// ---------------------------------------------------------------- P2 · estación inexistente no hereda la anterior

test('H10-63 · P2 · una estación inexistente limpia la selección anterior y cae a Red', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);

  await page.evaluate(() => { location.hash = '#estacion/Temperley'; });
  await page.waitForTimeout(2200);
  expect(await page.evaluate(() => Boolean(document.querySelector('#panelEstacion.active')))).toBe(true);

  await page.evaluate(() => { location.hash = '#estacion/ESTACION-H10-INEXISTENTE'; });
  await page.waitForTimeout(2500);

  const e = await page.evaluate(() => ({
    hash: location.hash,
    vista: (document.querySelector('.view.active') || {}).id || '',
    panel: Boolean(document.querySelector('#panelEstacion.active')),
    ruta: window.COI_ROUTING_H10.rutaVigente()
  }));
  expect(e.vista).toBe('vistaRed');
  expect(e.panel).toBe(false);
  expect(e.hash).toBe('#red');
  expect(e.ruta).toBe('red');
});

// ============================================================ F · revisión final Codex del PR #64

test('H10-64 · P2 · #ficha-um sin identificador vuelve al inventario y no hereda una UM previa', async ({ page }) => {
  await prepararH10(page, { ums: [UM_UNA] });
  await abrir(page);
  await page.evaluate((id) => { location.hash = '#ficha-um/' + id; }, UM_UNA.codigo_um);
  await page.waitForFunction(() => (document.querySelector('.view.active') || {}).id === 'vistaFichaUM', null, { timeout: 12000 });

  await page.evaluate(() => { location.hash = '#ficha-um'; });
  await page.waitForTimeout(2200);
  const e = await page.evaluate(() => ({
    hash: location.hash,
    vista: (document.querySelector('.view.active') || {}).id || '',
    umActual: String(window.umActualId || '')
  }));
  expect(e.vista).toBe('vistaUnidadesMantenimiento');
  expect(e.hash).toBe('#um');
  expect(e.umActual).toBe('');
});

test('H10-65 · P1 · el servidor rechaza archivar una OC abierta aunque se saltee la UI', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => window.getSupabaseClient().rpc('coi_actualizar_orden_integral', {
    p_orden_id: id, p_cambios: { estado_registro: 'Archivado' }
  }), OC_ACTIVA.id);
  expect(r.error && r.error.message).toBe('COI_ARCHIVE_REQUIRES_CLOSED_ORDER');
  expect((await remoto(page, OC_ACTIVA.nro_oc)).estado_registro).toBe('Activo');
});

test('H10-66 · P1 · la auditoría del primer cierre no puede sobrescribirse por el RPC genérico', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => window.getSupabaseClient().rpc('coi_actualizar_orden_integral', {
    p_orden_id: id, p_cambios: { observacion_cierre: 'Intento de pisado' }
  }), OC_CERRADA.id);
  expect(r.error && r.error.message).toBe('COI_CLOSURE_IMMUTABLE');
  const f = await page.evaluate((n) => window.__H10__.fila(n), OC_CERRADA.nro_oc);
  expect(f.observacion_cierre).toBe('Cierre previo');
  expect(f.fecha_cierre_operativo).toBe('2026-08-25');
});

test('H10-67 · P1 · no se puede crear un cierre incompleto desde estado_coi', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => window.getSupabaseClient().rpc('coi_actualizar_orden_integral', {
    p_orden_id: id, p_cambios: { estado_coi: 'Cerrada' }
  }), OC_ACTIVA.id);
  expect(r.error && r.error.message).toBe('COI_CLOSE_REQUIRES_ATOMIC_AUDIT');
  expect((await remoto(page, OC_ACTIVA.nro_oc)).estado_coi).toBe('En ejecución');
});

test('H10-68 · P1 · dos cierres competidores conservan los datos del primero', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => {
    const c = window.getSupabaseClient();
    const primero = await c.rpc('coi_actualizar_orden_integral', { p_orden_id: id, p_cambios: {
      estado_coi: 'Cerrada', fecha_cierre_operativo: '2026-09-07', observacion_cierre: 'Primer cierre'
    }});
    const segundo = await c.rpc('coi_actualizar_orden_integral', { p_orden_id: id, p_cambios: {
      estado_coi: 'Cerrada', fecha_cierre_operativo: '2026-09-07', observacion_cierre: 'Segundo cierre'
    }});
    return { primero, segundo, fila: window.__H10__.fila('4530000001') };
  }, OC_ACTIVA.id);
  expect(r.primero.error).toBeNull();
  expect(r.segundo.error && r.segundo.error.message).toBe('COI_CLOSURE_IMMUTABLE');
  expect(r.fila.observacion_cierre).toBe('Primer cierre');
});

test('H10-69 · P1 · el editor genérico no renderiza archivo ni campos de auditoría de cierre', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);
  await page.evaluate((n) => window.abrirEdicionFichaOC(n), OC_ACTIVA.nro_oc);
  await page.waitForFunction(() => {
    const m = document.getElementById('coiEditOCModalV60');
    return Boolean(m && !m.hidden);
  }, null, { timeout: 12000 });
  for (const campo of ['estado_registro','fecha_cierre_operativo','observacion_cierre']) {
    await expect(page.locator(`[data-coi-edit-field="${campo}"]`)).toHaveCount(0);
  }
});
