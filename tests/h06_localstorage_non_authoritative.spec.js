const { test, expect } = require('@playwright/test');

/*
  H06 — localStorage deja de ser AUTORIDAD operacional.

  Supabase es la fuente unica de verdad. localStorage sobrevive solo como
  preferencia de interfaz, filtro, estado de UI y cache NO autoritativa. Estas
  pruebas fijan la frontera:

    - remoto vacio se muestra vacio (no se revive el legado ni la demo);
    - remoto con datos gana siempre sobre cualquier version local distinta;
    - remoto en error NO se representa con datos de localStorage: solo puede
      conservarse el ultimo snapshot que ESTA sesion confirmo contra Supabase,
      que vive en memoria y muere con la pestaña;
    - un cambio de identidad invalida todo lo operativo del operador anterior
      ANTES de adoptar el UID nuevo;
    - las claves legadas preexistentes ni se importan ni se borran.

  Ninguna prueba toca datos reales: Supabase se intercepta con un cliente falso.
*/

// ---------------------------------------------------------------- claves
const K = {
  maestroV10: 'roca_coi_intervenciones_v10',
  maestroV18: 'coi_linea_roca_master_v18',
  ordenesCache: 'coi_supabase_ordenes_cache_v2',
  timelineCache: 'coi_timeline_events_v1',
  umLegacy: 'coi_roca_unidades_mantenimiento',
  stLegacy: 'coi_servicios_tecnicos_um',
  obsLegacy: 'coi_observaciones_oc',
  finCache: 'coi_cache_posiciones_oc_supabase_v1',
  marcadorH03: 'coi_observaciones_h03_imported_v1',
  tema: 'coi_v2_theme',
  sidebar: 'coi_v2_sidebar_collapsed',
  filtros: 'coi_dashboard_filters_v33'
};

const UID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// OC que solo existe en localStorage: jamas puede llegar a una vista operativa.
const OC_LOCAL = {
  id: '11111111-1111-4111-8111-111111111111',
  nro_oc: '4530000001',
  id_obra: 'OBRA-LOCAL-H06',
  tipo: 'Servicio',
  estacion: 'PLAZA CONSTITUCION',
  proveedor: 'PROVEEDOR SOLO LOCAL',
  estado_coi: 'En ejecución'
};

// OC que existe en el remoto: es la unica que puede verse.
const OC_REMOTA = {
  id: '22222222-2222-4222-8222-222222222222',
  nro_oc: '4530000002',
  id_obra: 'OBRA-REMOTA-H06',
  tipo: 'Servicio',
  estacion: 'PLAZA CONSTITUCION',
  proveedor: 'PROVEEDOR REMOTO',
  estado_coi: 'En ejecución',
  monto_total: 1000,
  plazo_dias: 30
};

const UM_REMOTA = {
  id: '33333333-3333-4333-8333-333333333333',
  codigo_um: 'ASC-H06',
  tipo_um: 'Ascensor',
  estacion: 'PLAZA CONSTITUCION',
  ramal: 'La Plata',
  sector: 'Anden 1',
  descripcion: 'UM remota',
  marca: '', modelo: '', nro_serie: '', estado: 'ACTIVA',
  proveedor_mantenimiento: '', observaciones: '',
  fecha_creacion: '2026-08-01T10:00:00.000Z',
  fecha_actualizacion: '2026-08-01T10:00:00.000Z'
};

const OBS_REMOTA = {
  id: '44444444-4444-4444-8444-444444444444',
  orden_id: OC_REMOTA.id,
  nro_oc: OC_REMOTA.nro_oc,
  texto: 'Observación remota H06',
  estado: 'Abierta',
  creado_por: UID_A,
  fecha_creacion: '2026-08-02T10:00:00.000Z',
  fecha_actualizacion: '2026-08-02T10:00:00.000Z'
};

const EVENTO_REMOTO = {
  id: 'TL-REMOTO-H06',
  fecha: '2026-08-20',
  hora: '09:00:00',
  nro_oc: OC_REMOTA.nro_oc,
  titulo: 'Mailing remoto H06',
  tipo_evento: 'Mailing',
  origen: 'Mailing',
  estado: 'Informativo',
  riesgo: 'Bajo',
  creado_en: '2026-08-20T09:00:00.000Z',
  actualizado_en: '2026-08-20T09:00:00.000Z'
};

// Contenido legado sembrado en localStorage antes del arranque. Nada de esto
// puede aparecer en una vista operativa.
const LEGADO = {
  [K.maestroV10]: JSON.stringify([{
    nombre: 'PLAZA CONSTITUCIÓN',
    obras: [],
    servicios: [{ idObra: 'OBRA-LOCAL-H06', numeroOC: OC_LOCAL.nro_oc, proveedor: 'PROVEEDOR SOLO LOCAL', estacion: 'PLAZA CONSTITUCIÓN' }]
  }]),
  [K.ordenesCache]: JSON.stringify({ savedAt: '2026-08-01T00:00:00.000Z', orders: [{
    idObra: 'OBRA-LOCAL-H06', numeroOC: OC_LOCAL.nro_oc, proveedor: 'PROVEEDOR SOLO LOCAL',
    estacion: 'PLAZA CONSTITUCION', tipo: 'Servicio', estado: 'En ejecución'
  }] }),
  [K.timelineCache]: JSON.stringify([{
    id: 'TL-LOCAL-H06', fecha: '2026-08-19', hora: '08:00',
    titulo: 'Mailing SOLO LOCAL H06', tipo_evento: 'Mailing', origen: 'Mailing',
    estado: 'Informativo', riesgo: 'Bajo'
  }]),
  [K.umLegacy]: JSON.stringify([{ idUM: 'UM-LOCAL-H06', tipoUM: 'Ascensor', estacion: 'QUILMES' }]),
  [K.stLegacy]: JSON.stringify([{ idST: 'ST-LOCAL-H06', idUM: 'UM-LOCAL-H06', descripcion: 'ST solo local' }]),
  [K.obsLegacy]: JSON.stringify([{ idObservacion: 'OBS-LOCAL-H06', texto: 'Observación SOLO LOCAL', ocNro: OC_LOCAL.nro_oc }]),
  [K.finCache]: JSON.stringify({ version: 2, savedAt: '2026-08-01T00:00:00.000Z', source: 'Supabase', positions: [{
    id: 'POS-LOCAL-H06', nro_oc: OC_LOCAL.nro_oc, posicion: '10', descripcion: 'Posición SOLO LOCAL',
    cantidad_total: 1, monto_total: 100, estado: 'LIBRE'
  }], consumptions: [] })
};

// Preferencias de interfaz: H06 NO las toca.
const PREFERENCIAS = {
  [K.tema]: 'dark',
  [K.sidebar]: '1',
  [K.filtros]: JSON.stringify({ estado: 'En ejecución' })
};

async function prepararH06(page, opciones = {}) {
  const cfg = Object.assign({
    ordenes: [], observaciones: [], ums: [], sts: [], eventos: [],
    fallaSelect: false, sinSesion: false, rol: 'administrador',
    sembrarLegado: true, sembrarPreferencias: true,
    // Estado de PRODUCCION: la importacion de observaciones ya se hizo y el
    // marcador de corte quedo establecido (KI-007). Con marcador, H03 no
    // vuelve a mirar la clave legada nunca mas.
    marcadorH03: true
  }, opciones);

  // Ninguna peticion sale de la maquina.
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());

  await page.addInitScript(({ c, legado, preferencias, uidInicial }) => {
    window.__H06_CFG__ = c;
    window.__H06_LLAMADAS__ = [];
    if (c.sembrarLegado) Object.entries(legado).forEach(([k, v]) => localStorage.setItem(k, v));
    if (c.marcadorH03) localStorage.setItem('coi_observaciones_h03_imported_v1', '1');
    if (c.sembrarPreferencias) Object.entries(preferencias).forEach(([k, v]) => localStorage.setItem(k, v));

    let uid = c.sinSesion ? null : uidInicial;
    let sesionActiva = !c.sinSesion;
    const oyentes = [];

    // Cambia la identidad y emite el evento igual que lo hace la aplicacion.
    window.__H06_CAMBIAR_SESION__ = (nuevoUid) => {
      uid = nuevoUid;
      sesionActiva = Boolean(nuevoUid);
      const session = nuevoUid ? { user: { id: nuevoUid, email: `${nuevoUid}@coiroca.test` } } : null;
      const evento = nuevoUid ? 'SIGNED_IN' : 'SIGNED_OUT';
      oyentes.forEach((fn) => { try { fn(evento, session); } catch (e) {} });
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: evento, session } }));
    };

    const registrar = (op) => window.__H06_LLAMADAS__.push(op);
    const filas = (tabla) => {
      if (tabla === 'coi_ordenes') return c.ordenes;
      if (tabla === 'coi_observaciones_oc') return c.observaciones;
      if (tabla === 'coi_unidades_mantenimiento') return c.ums;
      if (tabla === 'coi_servicios_tecnicos_um') return c.sts;
      return [];
    };

    function consulta(tabla) {
      const estado = { tabla, filtros: [], conteo: false, limite: 0 };
      const cumple = (fila) => estado.filtros.every((f) => {
        if (f.op === 'gt') return String(fila[f.col]) > String(f.val);
        if (f.op === 'is') return fila[f.col] === null || fila[f.col] === undefined;
        return fila[f.col] === f.val;
      });
      const api = {
        select(cols, o) { estado.conteo = Boolean(o && o.head); return api; },
        order() { return api; }, range() { return api; }, in() { return api; },
        limit(n) { estado.limite = n; return api; },
        eq(col, val) { estado.filtros.push({ op: 'eq', col, val }); return api; },
        gt(col, val) { estado.filtros.push({ op: 'gt', col, val }); return api; },
        is(col, val) { estado.filtros.push({ op: val === null ? 'is' : 'eq', col, val }); return api; },
        ilike() { return api; },
        insert() { estado.op = 'insert'; return api; },
        update() { estado.op = 'update'; return api; },
        delete() { estado.op = 'delete'; return api; },
        single() { return api._run(true); },
        async _run() {
          registrar((estado.conteo ? 'count:' : 'select:') + tabla);
          if (!sesionActiva) return { data: null, count: null, error: { message: 'JWT ausente' } };
          if (window.__H06_CFG__.fallaSelect) {
            return { data: null, count: null, error: { message: 'fallo de red simulado' } };
          }
          const todas = filas(tabla).filter(cumple);
          if (estado.conteo) return { data: null, count: todas.length, error: null };
          return { data: todas, error: null };
        },
        then(res, rej) { return api._run(false).then(res, rej); }
      };
      return api;
    }

    const fake = {
      from: (t) => consulta(t),
      rpc: async (nombre) => {
        registrar('rpc:' + nombre);
        if (!sesionActiva) return { data: null, error: null };
        if (nombre === 'coi_current_role') return { data: c.rol, error: null };
        if (nombre === 'coi_timeline_list_page') {
          if (window.__H06_CFG__.fallaSelect) return { data: null, error: { message: 'fallo de red simulado' } };
          return { data: c.eventos, error: null };
        }
        return { data: null, error: null };
      },
      auth: {
        getSession: async () => ({
          data: { session: sesionActiva ? { user: { id: uid, email: `${uid}@coiroca.test` } } : null },
          error: null
        }),
        getUser: async () => ({ data: { user: sesionActiva ? { id: uid } : null }, error: null }),
        onAuthStateChange: (fn) => {
          oyentes.push(fn);
          return { data: { subscription: { unsubscribe() {} } } };
        }
      }
    };
    window.__COI_SUPABASE_CLIENT__ = fake;
    window.getSupabaseClient = () => fake;
    window.initSupabase = async () => fake;
    window.getUsuarioActual = async () => (sesionActiva ? { id: uid, email: `${uid}@coiroca.test` } : null);
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.mostrarMensajeCOI = () => {};
    window.confirm = () => true;
  }, { c: cfg, legado: LEGADO, preferencias: PREFERENCIAS, uidInicial: UID_A });
}

async function abrirH06(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(window.__COI_UM_H05__) && Boolean(window.__COI_OBS_H03__) && Boolean(window.__COI_H06_ORDENES__),
    null, { timeout: 20000 }
  );
  // Se deja correr el arranque completo: las capas legadas repueblan globales
  // en timers propios y es justamente ahi donde el legado reaparecia.
  await page.waitForTimeout(1500);
  return errores;
}

// Radiografia de todo lo operativo publicado en memoria.
const radiografia = (page) => page.evaluate(() => {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const ocs = typeof window.todasLasOC === 'function' ? window.todasLasOC() : [];
  const deEstaciones = [];
  try {
    (typeof estaciones !== 'undefined' ? estaciones : []).forEach((e) => {
      arr(e.obras).forEach((o) => deEstaciones.push(o));
      arr(e.servicios).forEach((s) => deEstaciones.push(s));
    });
  } catch (e) {}
  return {
    ocs: ocs.map((r) => String(r.oc || r.item?.numeroOC || '')),
    ocProveedores: deEstaciones.map((o) => String(o.proveedor || '')),
    ocIds: deEstaciones.map((o) => String(o.idObra || '')),
    confirmadasOrdenes: window.__COI_H06_ORDENES__?.confirmadas?.() ?? null,
    uidOrdenes: window.__COI_H06_ORDENES__?.uidConfirmado?.() ?? null,
    ums: arr(window.unidadesMantenimiento).map((u) => String(u.codigoUM || u.idUM || '')),
    sts: arr(window.serviciosTecnicos).map((s) => String(s.nroST || s.idST || '')),
    umSincronizado: window.__COI_UM_H05__?.sincronizado ?? null,
    obs: arr(window.observacionesOC).map((o) => String(o.texto || o.observacion || '')),
    obsOrigen: window.__COI_OBS_H03__?.origen ?? null,
    eventos: arr(window.coiTimelineEvents).map((e) => String(e.titulo || '')),
    timelineConfirmados: window.COI_TIMELINE_COI?.confirmados?.() ?? null,
    finanzas: arr(window.posicionesFinancieras).map((p) => String(p.descripcion || p.descripcionPosicion || '')),
    // Las claves legadas siguen existiendo fisicamente.
    legadoPresente: {
      maestro: Boolean(localStorage.getItem('roca_coi_intervenciones_v10')),
      um: Boolean(localStorage.getItem('coi_roca_unidades_mantenimiento')),
      obs: Boolean(localStorage.getItem('coi_observaciones_oc'))
    },
    preferencias: {
      tema: localStorage.getItem('coi_v2_theme'),
      sidebar: localStorage.getItem('coi_v2_sidebar_collapsed'),
      filtros: localStorage.getItem('coi_dashboard_filters_v33')
    }
  };
});

// Nada de lo sembrado solo en localStorage puede aparecer en una vista operativa.
function sinRastroLocal(r) {
  expect(r.ocs).not.toContain(OC_LOCAL.nro_oc);
  expect(r.ocProveedores).not.toContain('PROVEEDOR SOLO LOCAL');
  expect(r.ocIds).not.toContain('OBRA-LOCAL-H06');
  expect(r.ums).not.toContain('UM-LOCAL-H06');
  expect(r.sts).not.toContain('ST-LOCAL-H06');
  // Observaciones se afirman por separado (H06-10, 10b y 10c): con el marcador
  // de corte puesto —el estado de produccion— la clave legada nunca se publica.
  expect(r.eventos).not.toContain('Mailing SOLO LOCAL H06');
  expect(r.finanzas).not.toContain('Posición SOLO LOCAL');
}

// ============================================================ 1 · remoto vacio

test('H06-1 · el remoto vacío no revive el legado ni la demo local', async ({ page }) => {
  await prepararH06(page, { ordenes: [], observaciones: [], ums: [], sts: [], eventos: [] });
  const errores = await abrirH06(page);

  const r = await radiografia(page);
  // Remoto vacio es un estado valido: se muestra vacio.
  expect(r.ocs).toEqual([]);
  expect(r.ums).toEqual([]);
  expect(r.sts).toEqual([]);
  sinRastroLocal(r);
  // Y el legado no se borro: sigue fisicamente en localStorage.
  expect(r.legadoPresente.maestro).toBe(true);
  expect(r.legadoPresente.um).toBe(true);
  expect(r.legadoPresente.obs).toBe(true);
  expect(errores).toEqual([]);
});

// ==================================================== 2 · el remoto siempre gana

test('H06-2 · el remoto con datos gana sobre la versión local distinta', async ({ page }) => {
  await prepararH06(page, {
    ordenes: [OC_REMOTA], ums: [UM_REMOTA], sts: [], observaciones: [OBS_REMOTA], eventos: [EVENTO_REMOTO]
  });
  await abrirH06(page);

  const r = await radiografia(page);
  // Lo remoto esta.
  expect(r.ocProveedores).toContain('PROVEEDOR REMOTO');
  expect(r.ums).toContain('ASC-H06');
  // Lo local no.
  sinRastroLocal(r);
  expect(r.confirmadasOrdenes).toBe(1);
  expect(r.uidOrdenes).toBe(UID_A);
});

// ============================== 3 · fallo remoto no promueve localStorage

test('H06-3 · un fallo remoto no publica localStorage como autoridad', async ({ page }) => {
  // Falla desde el primer momento: nunca hubo lectura confirmada.
  await prepararH06(page, { ordenes: [OC_REMOTA], ums: [UM_REMOTA], fallaSelect: true });
  await abrirH06(page);

  const r = await radiografia(page);
  // Sin lectura confirmada no se muestra nada operativo, y menos lo local.
  expect(r.confirmadasOrdenes).toBeNull();
  expect(r.ocs).toEqual([]);
  expect(r.umSincronizado).toBe(false);
  sinRastroLocal(r);
});

test('H06-3b · tras una lectura confirmada, el fallo conserva el remoto y no la caché local', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA], ums: [UM_REMOTA] });
  await abrirH06(page);
  expect((await radiografia(page)).confirmadasOrdenes).toBe(1);

  // Ahora el remoto se cae y se fuerza una relectura.
  await page.evaluate(async () => {
    window.__H06_CFG__.fallaSelect = true;
    await window.cargarOrdenesPrincipal?.();
  });
  await page.waitForTimeout(600);

  const r = await radiografia(page);
  // Se conserva EXACTAMENTE lo que Supabase confirmo, no lo que hubiera en
  // coi_supabase_ordenes_cache_v2.
  expect(r.ocProveedores).toContain('PROVEEDOR REMOTO');
  sinRastroLocal(r);
});

// ================================================== 4 · cambio de identidad

test('H06-4 · un cambio de UID invalida los snapshots operativos anteriores', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA], ums: [UM_REMOTA], eventos: [EVENTO_REMOTO] });
  await abrirH06(page);
  const inicial = await radiografia(page);
  expect(inicial.confirmadasOrdenes).toBe(1);
  expect(inicial.uidOrdenes).toBe(UID_A);

  // Entra otro operador y su lectura falla: nada del anterior puede quedar.
  await page.evaluate((uidB) => {
    window.__H06_CFG__.fallaSelect = true;
    window.__H06_CAMBIAR_SESION__(uidB);
  }, UID_B);
  await page.waitForTimeout(1500);

  const r = await radiografia(page);
  expect(r.confirmadasOrdenes).toBeNull();
  expect(r.ocProveedores).not.toContain('PROVEEDOR REMOTO');
  expect(r.ums).not.toContain('ASC-H06');
  expect(r.umSincronizado).toBe(false);
  expect(r.eventos).not.toContain('Mailing remoto H06');
  sinRastroLocal(r);
});

test('H06-4b · el cierre de sesión tampoco deja datos operativos del operador anterior', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA], ums: [UM_REMOTA] });
  await abrirH06(page);
  expect((await radiografia(page)).confirmadasOrdenes).toBe(1);

  await page.evaluate(() => window.__H06_CAMBIAR_SESION__(null));
  await page.waitForTimeout(1500);

  const r = await radiografia(page);
  expect(r.confirmadasOrdenes).toBeNull();
  expect(r.ocProveedores).not.toContain('PROVEEDOR REMOTO');
  expect(r.ums).not.toContain('ASC-H06');
  sinRastroLocal(r);
});

// ============================================ 5 · preferencias de interfaz

test('H06-5 · las preferencias de interfaz en localStorage siguen funcionando', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA] });
  await abrirH06(page);

  const r = await radiografia(page);
  // H06 no toca preferencias: tema, sidebar y filtros siguen intactos.
  expect(r.preferencias.tema).toBe('dark');
  expect(r.preferencias.sidebar).toBe('1');
  expect(JSON.parse(r.preferencias.filtros)).toEqual({ estado: 'En ejecución' });

  // Y se pueden seguir escribiendo.
  await page.evaluate(() => localStorage.setItem('coi_v2_theme', 'light'));
  expect(await page.evaluate(() => localStorage.getItem('coi_v2_theme'))).toBe('light');
});

// ========================================= 6 · el legado no se importa solo

test('H06-6 · el legado preexistente no se importa automáticamente ni se borra', async ({ page }) => {
  await prepararH06(page, { ordenes: [], ums: [], sts: [], observaciones: [], eventos: [] });
  await abrirH06(page);

  const r = await radiografia(page);
  sinRastroLocal(r);
  // Ni una sola fila legada llego a una estructura operativa…
  expect(r.ocs).toEqual([]);
  // …y ninguna clave legada fue destruida.
  // El material legado UNICO se conserva intacto. La cache del Timeline no
  // entra en esta lista: no era legado sino una copia de datos remotos, y H07
  // la retiro (KI-021).
  const claves = await page.evaluate((ks) => ks.map((k) => [k, localStorage.getItem(k) !== null]), [
    K.maestroV10, K.umLegacy, K.stLegacy, K.obsLegacy
  ]);
  for (const [clave, existe] of claves) expect([clave, existe]).toEqual([clave, true]);
  // Y la cache retirada no vuelve a escribirse.
  expect(await page.evaluate((k) => localStorage.getItem(k), K.timelineCache)).toBeNull();
});

// ================================================= 7 y 8 · UM y ST vacios

test('H06-7 · UM remoto vacío sigue vacío', async ({ page }) => {
  await prepararH06(page, { ums: [], sts: [] });
  await abrirH06(page);

  const r = await radiografia(page);
  expect(r.ums).toEqual([]);
  expect(r.umSincronizado).toBe(true);
  expect(r.ums).not.toContain('UM-LOCAL-H06');
});

test('H06-8 · ST remoto vacío sigue vacío', async ({ page }) => {
  await prepararH06(page, { ums: [UM_REMOTA], sts: [] });
  await abrirH06(page);

  const r = await radiografia(page);
  expect(r.sts).toEqual([]);
  expect(r.ums).toEqual(['ASC-H06']);
  expect(r.sts).not.toContain('ST-LOCAL-H06');
});

// ============================================= 9 · ordenes remotas mandan

test('H06-9 · las órdenes remotas no son sustituidas por la versión local', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA] });
  await abrirH06(page);

  const r = await radiografia(page);
  expect(r.ocProveedores).toContain('PROVEEDOR REMOTO');
  expect(r.ocProveedores).not.toContain('PROVEEDOR SOLO LOCAL');
  expect(r.ocIds).not.toContain('OBRA-LOCAL-H06');
  // H07 · La cache local de ordenes se retiro: ademas de no aportar filas, ya
  // no se escribe y la copia vieja se descarta cuando Supabase confirma.
  expect(await page.evaluate((k) => localStorage.getItem(k), K.ordenesCache)).toBeNull();
});

// ======================================== 10 · observaciones remotas mandan

test('H06-10 · las observaciones remotas no son sustituidas por la versión local', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA], observaciones: [OBS_REMOTA] });
  await abrirH06(page);

  const r = await radiografia(page);
  expect(r.obs).not.toContain('Observación SOLO LOCAL');
  expect(r.obsOrigen).not.toBe('legacy-readonly');
});

test('H06-10b · con el marcador de corte puesto, ni el remoto vacío ni el fallo publican observaciones legadas', async ({ page }) => {
  // Estado de produccion: importacion hecha, marcador puesto, remoto vacio.
  await prepararH06(page, { ordenes: [OC_REMOTA], observaciones: [] });
  await abrirH06(page);
  let r = await radiografia(page);
  expect(r.obs).not.toContain('Observación SOLO LOCAL');
  expect(r.obsOrigen).toBe('supabase');

  // Y con el remoto caido tampoco se promueve la clave legada.
  await page.evaluate(() => { window.__H06_CFG__.fallaSelect = true; });
  await page.evaluate(() => window.recargarObservacionesOC?.());
  await page.waitForTimeout(800);
  r = await radiografia(page);
  expect(r.obs).not.toContain('Observación SOLO LOCAL');
  expect(r.obsOrigen).not.toBe('legacy-readonly');
});

test('H06-10c · KI-020 cerrado por H07: sin marcador, el legado queda en cuarentena y no en el modelo', async ({ page }) => {
  // Este era el GAP KI-020: en un puesto que nunca corrio la importacion, H03
  // publicaba la clave legada como observaciones operativas. H07 lo cierra sin
  // perder nada: el material se conserva, se puede ver y exportar, la escritura
  // sigue bloqueada —la proteccion de KI-007 intacta— pero ya no entra al
  // modelo operativo ni alimenta KPIs.
  await prepararH06(page, { ordenes: [OC_REMOTA], observaciones: [], marcadorH03: false });
  await abrirH06(page);

  const r = await radiografia(page);
  expect(r.obs).not.toContain('Observación SOLO LOCAL');
  expect(r.obsOrigen).toBe('supabase');

  const cuarentena = await page.evaluate(() => ({
    pendientes: window.__COI_OBS_H03__?.legadoEnCuarentena ?? null,
    filas: (window.__COI_OBS_H07_CUARENTENA__?.filas?.() || []).length,
    autoritativo: window.__COI_OBS_H07_CUARENTENA__?.autoritativo,
    claveIntacta: localStorage.getItem('coi_observaciones_oc') !== null
  }));
  expect(cuarentena.pendientes).toBe(1);
  expect(cuarentena.filas).toBe(1);
  expect(cuarentena.autoritativo).toBe(false);
  // El material NO se borro.
  expect(cuarentena.claveIntacta).toBe(true);
});

// ============================================== 11 · mailing remoto manda

test('H06-11 · el Mailing remoto no es sustituido por el estado local', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA], eventos: [EVENTO_REMOTO] });
  await abrirH06(page);

  const r = await radiografia(page);
  expect(r.eventos).toContain('Mailing remoto H06');
  expect(r.eventos).not.toContain('Mailing SOLO LOCAL H06');
});

test('H06-11b · con el Timeline remoto caído no se publica la caché local de mailings', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA], eventos: [EVENTO_REMOTO], fallaSelect: true });
  await abrirH06(page);

  const r = await radiografia(page);
  // La caché local tiene un mailing, pero no es autoridad: no se publica.
  expect(await page.evaluate((k) => Boolean(localStorage.getItem(k)), K.timelineCache)).toBe(true);
  expect(r.eventos).not.toContain('Mailing SOLO LOCAL H06');
  expect(r.timelineConfirmados).toBeNull();
});

// ================================================ 12 · refresh reconstruye

test('H06-12 · un refresh reconstruye el estado operacional desde Supabase', async ({ page }) => {
  await prepararH06(page, { ordenes: [OC_REMOTA], ums: [UM_REMOTA], eventos: [EVENTO_REMOTO] });
  await abrirH06(page);
  expect((await radiografia(page)).ocProveedores).toContain('PROVEEDOR REMOTO');

  // El remoto cambia y se recarga la página completa.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(window.__COI_UM_H05__) && Boolean(window.__COI_H06_ORDENES__),
    null, { timeout: 20000 }
  );
  await page.waitForTimeout(1500);

  const r = await radiografia(page);
  // Todo vuelve a salir de Supabase, no de la caché que quedo escrita.
  expect(r.confirmadasOrdenes).toBe(1);
  expect(r.ocProveedores).toContain('PROVEEDOR REMOTO');
  expect(r.ums).toEqual(['ASC-H06']);
  sinRastroLocal(r);
});
