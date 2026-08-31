const { test, expect } = require('@playwright/test');

/*
  H05 / H04 — Unidades de Mantenimiento y Servicios Tecnicos con Supabase como
  unica fuente de verdad.

  PRODUCCION y STAGING tienen ambas tablas VACIAS y la decision tomada es NO
  migrar las 28 UM / 3 ST de demostracion que quedaron en localStorage. Por eso
  estas pruebas verifican, sobre todo, que el remoto vacio se respeta: la capa no
  siembra la demo, no usa el legado como fallback y no escribe datos operativos
  en localStorage.

  Los handlers reales de la UI viven dentro de IIFEs que llaman a
  stopImmediatePropagation, de modo que reasignar window.funcion no alcanza: los
  casos hacen click DOM real sobre lo que renderiza la aplicacion.

  Supabase se intercepta con un cliente falso y page.route(): ninguna prueba toca
  datos reales.
*/

const UM_A = {
  id: '11111111-1111-4111-8111-111111111111',
  codigo_um: 'ASC-001',
  tipo_um: 'Ascensor',
  estacion: 'PLAZA CONSTITUCION',
  ramal: 'La Plata',
  sector: 'Anden 1',
  descripcion: 'Ascensor lado norte',
  marca: 'Otis',
  modelo: 'Gen2',
  nro_serie: 'SN-0001',
  estado: 'ACTIVA',
  proveedor_mantenimiento: 'ASCENSORES SA',
  observaciones: '',
  fecha_creacion: '2026-08-01T10:00:00.000Z',
  fecha_actualizacion: '2026-08-01T10:00:00.000Z'
};

const UM_B = Object.assign({}, UM_A, {
  id: '22222222-2222-4222-8222-222222222222',
  codigo_um: 'ESC-010',
  tipo_um: 'Escalera mecánica',
  estacion: 'TEMPERLEY',
  nro_serie: 'SN-0002',
  estado: 'FUERA DE SERVICIO'
});

const ST_A = {
  id: '33333333-3333-4333-8333-333333333333',
  unidad_id: UM_A.id,
  nro_st: 'ST-0001',
  nro_oc: '4530008964',
  fecha: '2026-08-10',
  descripcion: 'Cambio de rodamientos',
  tecnico: 'J. Perez',
  proveedor: 'ASCENSORES SA',
  estado: 'Pendiente',
  observaciones: '',
  fecha_creacion: '2026-08-10T10:00:00.000Z',
  fecha_actualizacion: '2026-08-10T10:00:00.000Z'
};

// Las 28 UM / 3 ST del legado se representan con una muestra fiel: los ST legados
// referencian UM-001 / UM-010, que no coinciden con ningun codigo de UM legado.
const UM_LEGACY = [
  { idUM: 'ASC-LEGACY-1', tipoUM: 'Ascensor', estacion: 'BERAZATEGUI', estadoOperativo: 'Activo', ubicacionTecnica: 'Anden 2' },
  { idUM: 'ESC-LEGACY-2', tipoUM: 'Escalera mecánica', estacion: 'QUILMES', estadoOperativo: 'Activo', ubicacionTecnica: 'Hall' },
  { idUM: 'BOM-LEGACY-3', tipoUM: 'Otro', estacion: 'BERNAL', estadoOperativo: 'Fuera de servicio', ubicacionTecnica: 'Sala' }
];
const ST_LEGACY = [
  { idST: 'ST-LEGACY-1', idUM: 'UM-001', um: 'UM-001', umsAsociadas: ['UM-001'], fecha: '2025-01-01', obra: 'OC-2025-101', descripcion: 'DEMO UNO', tecnico: 'Demo' },
  { idST: 'ST-LEGACY-2', idUM: 'UM-010', um: 'UM-010', umsAsociadas: ['UM-010'], fecha: '2025-01-02', obra: 'OC-2025-102', descripcion: 'DEMO DOS', tecnico: 'Demo' }
];

// Cliente Supabase falso: soporta paginado por range, order encadenado, retardos
// programables y fallos por operacion.
async function prepararEntorno(page, opciones) {
  const cfg = Object.assign({
    ums: [], sts: [], legadoUM: null, legadoST: null,
    fallaSelect: false, fallaMutacion: false, errorMutacion: 'RLS denegado',
    retardoSelectMs: 0, pageSize: 1000, admin: true, sinSesion: false, rol: 'administrador',
    ordenes: [], fallaSelectOC: false, fallaRol: false
  }, opciones);

  await page.addInitScript((c) => {
    window.__H05_LLAMADAS__ = [];
    window.__H05_ESCRITURAS_LEGACY__ = [];
    window.__H05_CFG__ = c;

    const CLAVES_LEGACY = [
      'coi_roca_unidades_mantenimiento', 'coi_unidades_mantenimiento', 'coi_ums',
      'coi_um_catalogo', 'coiUM', 'coi_um', 'coiUMs', 'unidadesMantenimiento',
      'coi_servicios_tecnicos_um', 'coi_servicios_tecnicos'
    ];
    if (c.legadoUM) localStorage.setItem('coi_roca_unidades_mantenimiento', JSON.stringify(c.legadoUM));
    if (c.legadoST) localStorage.setItem('coi_servicios_tecnicos_um', JSON.stringify(c.legadoST));

    // Cualquier intento de persistir UM/ST operativos en localStorage queda
    // registrado, sin impedirlo: la prueba afirma que no ocurre.
    const setItemNativo = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (CLAVES_LEGACY.indexOf(k) >= 0) {
        window.__H05_ESCRITURAS_LEGACY__.push({ clave: k, valor: String(v).slice(0, 200) });
      }
      return setItemNativo.call(this, k, v);
    };

    let sesionActiva = !c.sinSesion;
    let uidSesion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    window.__H05_SET_UID__ = (v) => { uidSesion = v; };
    window.__H05_SIGN_OUT__ = () => {
      sesionActiva = false;
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'SIGNED_OUT' } }));
    };
    window.__H05_CAMBIAR_SESION__ = (uid) => {
      uidSesion = uid;
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'SIGNED_IN' } }));
    };

    const registrar = (op, payload) => window.__H05_LLAMADAS__.push({ op, payload });
    let ums = c.ums.slice();
    let sts = c.sts.slice();
    // Catalogo REMOTO de Ordenes: deliberadamente distinto de todasLasOC(),
    // que es la cache local del modulo.
    let ordenes = (c.ordenes || []).slice();
    window.__H05_SET_ORDENES__ = (v) => { ordenes = v.slice(); };
    window.__H05_SET_UMS__ = (v) => { ums = v.slice(); };
    window.__H05_SET_STS__ = (v) => { sts = v.slice(); };
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    const uuid = (n) => '99999999-9999-4999-8999-' + String(n).padStart(12, '0');

    function consulta(tabla) {
      // filtros acumula TODAS las condiciones; `filtro` se conserva como la
      // primera igualdad para no romper las aserciones que ya lo usan.
      const st = { tabla, filtro: null, filtros: [], patch: null, op: null, rango: null, limite: 0 };
      const anotar = (op, col, val) => {
        st.filtros.push({ op, col, val });
        if (op === 'eq' && !st.filtro) st.filtro = { col, val };
      };
      const cumple = (fila) => st.filtros.every((f) => {
        if (f.op === 'is') return fila[f.col] === null || fila[f.col] === undefined;
        if (f.op === 'ilike') {
          return String(fila[f.col] == null ? '' : fila[f.col]).toUpperCase() ===
            String(f.val == null ? '' : f.val).toUpperCase();
        }
        return fila[f.col] === f.val;
      });
      const api = {
        select() { return api; },
        order() { return api; },
        range(a, b) { st.rango = [a, b]; return api; },
        in() { return api; },
        limit(n) { st.limite = n; return api; },
        eq(col, val) { anotar('eq', col, val); return api; },
        ilike(col, val) { anotar('ilike', col, val); return api; },
        is(col, val) { anotar(val === null ? 'is' : 'eq', col, val); return api; },
        single() { return api._run(true); },
        insert(f) { st.op = 'insert'; st.payload = f; return api; },
        update(p) { st.op = 'update'; st.patch = p; return api; },
        delete() { st.op = 'delete'; return api; },
        async _run(unico) {
          const esUM = st.tabla === 'coi_unidades_mantenimiento';
          const esST = st.tabla === 'coi_servicios_tecnicos_um';
          if (st.tabla === 'coi_ordenes') {
            registrar('select:coi_ordenes', st.filtros);
            if (window.__H05_CFG__.fallaSelectOC) {
              return { data: null, error: { message: 'fallo de red al leer Ordenes' } };
            }
            const halladas = ordenes.filter((o) => cumple(o));
            return { data: st.limite ? halladas.slice(0, st.limite) : halladas, error: null };
          }
          if (!esUM && !esST) return { data: [], error: null };
          const leer = () => (esUM ? ums : sts);
          const escribir = (v) => { if (esUM) ums = v; else sts = v; };

          if (st.op === 'insert') {
            registrar('insert:' + st.tabla, st.payload);
            if (c.fallaMutacion) return { data: null, error: { message: c.errorMutacion } };
            const previas = leer();
            // El UNIQUE real de codigo_um se refleja en el fake.
            if (esUM && previas.some((f) => f.codigo_um === st.payload.codigo_um)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
            const creada = Object.assign({
              id: uuid(previas.length + 1),
              fecha_creacion: new Date().toISOString(),
              fecha_actualizacion: new Date().toISOString()
            }, st.payload);
            escribir(previas.concat([creada]));
            return { data: unico ? creada : [creada], error: null };
          }
          if (st.op === 'update') {
            registrar('update:' + st.tabla, { filtro: st.filtro, filtros: st.filtros, patch: st.patch });
            if (c.fallaMutacion) return { data: null, error: { message: c.errorMutacion } };
            const actuales = leer().slice();
            // Un UPDATE condicionado que no matchea afecta 0 filas: es
            // exactamente lo que hace el CAS cuando otro puesto ya escribio.
            const i = actuales.findIndex((f) => cumple(f));
            if (i < 0) return { data: [], error: null };
            actuales[i] = Object.assign({}, actuales[i], st.patch);
            escribir(actuales);
            return { data: [actuales[i]], error: null };
          }
          if (st.op === 'delete') {
            // Ninguna prueba deberia llegar aca: se registra para poder afirmarlo.
            registrar('delete:' + st.tabla, st.filtro);
            return { data: [], error: null };
          }

          registrar('select:' + st.tabla, st.rango);
          if (window.__H05_CFG__.retardoSelectMs) await espera(window.__H05_CFG__.retardoSelectMs);
          if (window.__H05_CFG__.fallaSelect) return { data: null, error: { message: 'fallo de red' } };
          if (!sesionActiva) return { data: null, error: { message: 'JWT ausente' } };
          let base = leer();
          if (st.filtros.length) base = base.filter((f) => cumple(f));
          if (st.limite) return { data: base.slice(0, st.limite), error: null };
          const [a, b] = st.rango || [0, 999999];
          const tope = Math.min(b, a + window.__H05_CFG__.pageSize - 1);
          return { data: base.slice(a, tope + 1), error: null };
        },
        then(res, rej) { return api._run(false).then(res, rej); }
      };
      return api;
    }

    const fake = {
      from: (t) => consulta(t),
      // Misma funcion que usan las policies RESTRICTIVE. rol null representa un
      // usuario autenticado SIN perfil activo.
      rpc: async (nombre) => {
        registrar('rpc:' + nombre, null);
        if (nombre !== 'coi_current_role') return { data: null, error: null };
        if (!sesionActiva) return { data: null, error: null };
        if (c.fallaRol) return { data: null, error: { message: 'fallo de red al leer el perfil' } };
        return { data: c.rol === null ? null : c.rol, error: null };
      },
      auth: {
        getSession: async () => ({
          data: { session: sesionActiva ? { user: { id: uidSesion, email: 'admin@coiroca.com' } } : null },
          error: null
        }),
        getUser: async () => ({ data: { user: { id: uidSesion } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };
    window.__COI_SUPABASE_CLIENT__ = fake;
    window.getSupabaseClient = () => fake;
    window.esAutorizacionAdministrativaSupabaseV60 = () => c.admin === true;
  }, cfg);

  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, body: '{}' }));
}

async function abrir(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.__COI_UM_H05__), null, { timeout: 20000 });
  await page.waitForFunction(
    () => window.__COI_UM_H05__ && window.__COI_UM_H05__.origen !== 'inicial',
    null, { timeout: 20000 }
  );
  return errores;
}

async function abrirSinEsperarCarga(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.__COI_UM_H05__), null, { timeout: 20000 });
}

// El arranque de la aplicacion reasigna esAutorizacionAdministrativaSupabaseV60,
// de modo que fijarlo en addInitScript no alcanza.
async function fijarAdmin(page, valor) {
  await page.evaluate((v) => { window.esAutorizacionAdministrativaSupabaseV60 = () => v; }, valor);
}

// Catalogo de OC en memoria: un ST solo puede citar una OC que exista aca.
// Siembra el catalogo de OC. Por defecto lo hace en LAS DOS puntas —la cache en
// memoria y coi_ordenes en Supabase— porque una OC del sistema normalmente existe
// en ambas. Con { soloCache: true } se reproduce el caso del finding: una OC que
// sobrevive en la cache local del modulo de Ordenes pero ya no esta en el remoto.
async function sembrarOC(page, numeros, opciones) {
  const soloCache = Boolean(opciones && opciones.soloCache);
  await page.evaluate(({ ns, soloCache }) => {
    window.todasLasOC = () => ns.map((n) => ({
      oc: n, item: { numeroOC: n, supabaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', idObra: 'OB-' + n }
    }));
    if (!soloCache && typeof window.__H05_SET_ORDENES__ === 'function') {
      window.__H05_SET_ORDENES__(ns.map((n) => ({ nro_oc: n })));
    }
  }, { ns: numeros, soloCache: soloCache });
}

// Abre la ficha de la primera UM con un click DOM real sobre lo que renderiza
// la aplicacion. Las capas legadas repintan #umTbody y pueden cambiar la vista
// activa desde sus propias closures, de modo que la fila queda detached o fuera
// de pantalla entre el resolve y el click. Se reafirma la vista y se reintenta
// de forma acotada; si nunca se logra, la prueba falla de manera explicita en
// vez de disimularlo con un click forzado.
async function abrirFichaPrimeraUM(page) {
  let ultimo = null;
  for (let intento = 0; intento < 5; intento++) {
    await page.evaluate(() => {
      if (typeof window.mostrarVista === 'function') window.mostrarVista('vistaUnidadesMantenimiento');
      if (typeof window.renderUnidadesMantenimiento === 'function') window.renderUnidadesMantenimiento();
    });
    try {
      const boton = page.locator('#umTbody tr button[data-h05-open-um]').first();
      await boton.waitFor({ state: 'visible', timeout: 3000 });
      await boton.click({ timeout: 3000 });
      await page.waitForFunction(
        () => {
          const b = document.getElementById('fichaUMBody');
          return Boolean(b && b.childElementCount > 0);
        },
        null, { timeout: 5000 }
      );
      await page.waitForTimeout(200);
      return;
    } catch (error) {
      ultimo = error;
    }
  }
  throw new Error('No se pudo abrir la ficha de la primera UM: ' + (ultimo && ultimo.message));
}

async function irAUM(page) {
  await page.evaluate(() => {
    if (typeof window.mostrarVista === 'function') window.mostrarVista('vistaUnidadesMantenimiento');
    if (typeof window.renderUnidadesMantenimiento === 'function') window.renderUnidadesMantenimiento();
  });
  await page.waitForTimeout(250);
}

const estado = (page) => page.evaluate(() => ({
  origen: window.__COI_UM_H05__.origen,
  sincronizado: window.__COI_UM_H05__.sincronizado,
  ultimoError: window.__COI_UM_H05__.ultimoError,
  ums: (window.unidadesMantenimiento || []).map((u) => ({
    codigo: u.codigoUM, uuid: u._supabaseId, estado: u.estado, tipo: u.tipoUM, estacion: u.estacion
  })),
  sts: (window.serviciosTecnicos || []).map((s) => ({
    uuid: s._supabaseId, nroST: s.nroST, unidadId: s._unidadId, estado: s.estado, oc: s.nroOC, um: s.idUM
  })),
  legacyUM: localStorage.getItem('coi_roca_unidades_mantenimiento'),
  legacyUMReal: window.__COI_UM_H05_LEGACY_RAW__('coi_roca_unidades_mantenimiento'),
  legacyST: localStorage.getItem('coi_servicios_tecnicos_um'),
  llamadas: window.__H05_LLAMADAS__,
  escriturasLegacy: window.__H05_ESCRITURAS_LEGACY__
}));

const soloOp = (e, op) => e.llamadas.filter((l) => String(l.op).indexOf(op) === 0);

// =========================================================== UM · lectura

test('1 · Supabase con UM manda y el legado local no aporta filas', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [ST_A], legadoUM: UM_LEGACY, legadoST: ST_LEGACY });
  const errores = await abrir(page);
  const e = await estado(page);

  expect(e.origen).toBe('supabase');
  expect(e.sincronizado).toBe(true);
  expect(e.ums.map((u) => u.codigo).sort()).toEqual(['ASC-001', 'ESC-010']);
  expect(e.ums.map((u) => u.codigo)).not.toContain('ASC-LEGACY-1');
  expect(e.ums.every((u) => /^[0-9a-f-]{36}$/i.test(u.uuid))).toBe(true);
  // El legado se conserva fisicamente: no se borra, solo deja de ser autoridad.
  expect(e.legacyUMReal).not.toBeNull();
  expect(JSON.parse(e.legacyUMReal)).toHaveLength(UM_LEGACY.length);
  expect(errores).toEqual([]);
});

test('2 · remoto vacio permanece vacio: no se siembran las UM ni los ST de demo', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [], legadoUM: UM_LEGACY, legadoST: ST_LEGACY });
  await abrir(page);
  await irAUM(page);
  const e = await estado(page);

  expect(e.origen).toBe('supabase');
  expect(e.sincronizado).toBe(true);
  expect(e.ums).toHaveLength(0);
  expect(e.sts).toHaveLength(0);
  // Ni una sola fila legada entra al runtime.
  expect(JSON.stringify(e.ums) + JSON.stringify(e.sts)).not.toContain('LEGACY');
  expect(await page.locator('#umKTotal').textContent()).toBe('0');
  await expect(page.locator('#umTbody')).toContainText('No hay Unidades de Mantenimiento cargadas en Supabase');
  // Y el legado sigue existiendo en disco.
  expect(e.legacyUMReal).not.toBeNull();
});

test('3 · leer y renderizar no escribe UM ni ST operativos en localStorage', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], legadoUM: UM_LEGACY });
  const antes = JSON.stringify(UM_LEGACY);
  await abrir(page);
  await irAUM(page);
  await page.waitForTimeout(2000); // cubre los timers legados de 900 y 1500 ms
  const e = await estado(page);

  // Ninguna escritura llega al almacenamiento: el contenido legado sigue siendo
  // byte a byte el que estaba antes de arrancar.
  expect(e.escriturasLegacy).toEqual([]);
  expect(e.legacyUMReal).toBe(antes);
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
});

test('3b · los intentos de escritura del legado quedan bloqueados y contabilizados', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY });
  const antes = JSON.stringify(UM_LEGACY);
  await abrir(page);

  const r = await page.evaluate((original) => {
    // Un escritor legado cualquiera intenta pisar la clave historica.
    localStorage.setItem('coi_roca_unidades_mantenimiento', JSON.stringify([{ idUM: 'PISOTON' }]));
    return {
      bloqueadas: window.__COI_UM_H05_ESCRITURAS_BLOQUEADAS__.slice(),
      intacto: window.__COI_UM_H05_LEGACY_RAW__('coi_roca_unidades_mantenimiento') === original,
      // La via deliberada para H06 si funciona.
      deliberada: (() => {
        window.__COI_UM_H05_LEGACY_WRITE__('coi_h05_prueba_deliberada', 'ok');
        return localStorage.getItem('coi_h05_prueba_deliberada');
      })()
    };
  }, antes);

  expect(r.bloqueadas).toContain('coi_roca_unidades_mantenimiento');
  expect(r.intacto).toBe(true);
  expect(r.deliberada).toBe('ok');
});

test('4 · el escudo impide que un lector legado elija localStorage como fuente', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY, legadoST: ST_LEGACY });
  await abrir(page);
  const e = await estado(page);

  // Lectura operativa: vacia. Lectura deliberada (H06): intacta.
  expect(JSON.parse(e.legacyUM)).toEqual([]);
  expect(JSON.parse(e.legacyST)).toEqual([]);
  expect(JSON.parse(e.legacyUMReal)).toHaveLength(UM_LEGACY.length);
});

test('5 · la UM usa el UUID como identidad canonica en la tabla y en la ficha', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await irAUM(page);

  // La fila la identifica el UUID canonico, no el codigo de negocio.
  await expect(page.locator('#umTbody tr[data-h05-open-um]').first())
    .toHaveAttribute('data-h05-open-um', UM_A.id);
  await abrirFichaPrimeraUM(page);
  await expect(page.locator('#fichaUMBody')).toContainText(UM_A.id);
  await expect(page.locator('#fichaUMBody')).toContainText('ST-0001');
});

// =========================================================== UM · mutaciones

test('6 · crear UM escribe en Supabase y nunca en localStorage', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.fill('#umh5_codigo', 'ASC-999');
  await page.selectOption('#umh5_tipo', 'Ascensor');
  await page.selectOption('#umh5_estacion', { index: 1 });
  await page.selectOption('#umh5_estado', 'ACTIVA');
  await page.fill('#umh5_serie', 'SN-999');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(700);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_unidades_mantenimiento');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.codigo_um).toBe('ASC-999');
  expect(inserts[0].payload.estado).toBe('ACTIVA');
  expect(inserts[0].payload.nro_serie).toBe('SN-999');
  expect(e.ums.map((u) => u.codigo)).toContain('ASC-999');
  expect(e.escriturasLegacy).toEqual([]);
});

test('7 · actualizar UM va por UPDATE contra el UUID, no por insert', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  await page.fill('#umh5_proveedor', 'NUEVO PROVEEDOR SA');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(700);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.filtro).toEqual({ col: 'id', val: UM_A.id });
  expect(updates[0].payload.patch.proveedor_mantenimiento).toBe('NUEVO PROVEEDOR SA');
  expect(soloOp(e, 'insert:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(e.escriturasLegacy).toEqual([]);
});

test('8 · la UM se da de BAJA: no existe DELETE fisico y el ST sobrevive', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  page.on('dialog', (d) => d.accept(''));
  await irAUM(page);

  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);
  await page.click('#btnBajaUMH05');
  await page.waitForTimeout(900);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.estado).toBe('BAJA');
  // La fecha de baja queda registrada: el esquema canonico no tiene fecha_baja.
  expect(updates[0].payload.patch.observaciones).toMatch(/\[BAJA \d{4}-\d{2}-\d{2}\]/);
  expect(e.llamadas.filter((l) => String(l.op).indexOf('delete') === 0)).toHaveLength(0);
  expect(e.ums[0].estado).toBe('BAJA');
  // El historial tecnico sigue completo.
  expect(e.sts).toHaveLength(1);
  expect(e.sts[0].nroST).toBe('ST-0001');
});

test('9 · el codigo_um duplicado se informa y no se reintenta a ciegas', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.fill('#umh5_codigo', 'ASC-001');
  await page.selectOption('#umh5_tipo', 'Ascensor');
  await page.selectOption('#umh5_estacion', { index: 1 });
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(500);

  await expect(page.locator('#umFormMsgH05')).toContainText('Ya existe una Unidad de Mantenimiento con el código ASC-001');
  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(e.ums).toHaveLength(1);
});

test('10 · sin rol administrador el formulario de UM queda deshabilitado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], admin: false });
  await abrir(page);
  await fijarAdmin(page, false);
  await irAUM(page);

  await expect(page.locator('#btnGuardarUMH05')).toBeDisabled();
  await expect(page.locator('#umh5_codigo')).toBeDisabled();
  await expect(page.locator('#umFormMsgH05')).toContainText('Ingrese como Administrador');
});

test('11 · doble click sobre Guardar UM produce un unico insert', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [], retardoSelectMs: 250 });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.fill('#umh5_codigo', 'ASC-777');
  await page.selectOption('#umh5_tipo', 'Ascensor');
  await page.selectOption('#umh5_estacion', { index: 1 });
  const boton = page.locator('#btnGuardarUMH05');
  await boton.click();
  await boton.click({ force: true });
  await page.waitForTimeout(1600);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_unidades_mantenimiento')).toHaveLength(1);
  expect(e.ums.filter((u) => u.codigo === 'ASC-777')).toHaveLength(1);
});

// =========================================================== ST

test('12 · el ST solo acepta el UUID de una UM remota', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  const valores = await page.locator('#sth5_um option').evaluateAll((os) => os.map((o) => o.value));
  expect(valores).toEqual(['', UM_A.id]);
  expect(valores).not.toContain('UM-001');
  expect(valores).not.toContain('ASC-001');
});

test('13 · crear ST escribe unidad_id UUID en Supabase y no en localStorage', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-0042');
  await page.fill('#sth5_fecha', '2026-08-20');
  await page.fill('#sth5_oc', '4530008964');
  await page.selectOption('#sth5_estado', 'Pendiente');
  await page.fill('#sth5_descripcion', 'Mantenimiento preventivo');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(800);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.unidad_id).toBe(UM_A.id);
  expect(inserts[0].payload.nro_st).toBe('ST-0042');
  expect(inserts[0].payload.nro_oc).toBe('4530008964');
  expect(inserts[0].payload.estado).toBe('Pendiente');
  expect(e.escriturasLegacy).toEqual([]);
});

test('14 · una OC inexistente se rechaza y no se crea ninguna OC', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-0043');
  await page.fill('#sth5_oc', 'OC-2025-101'); // OC de demo legada: no existe
  await page.fill('#sth5_descripcion', 'Intento con OC legada');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(500);

  await expect(page.locator('#stFormMsgH05')).toContainText('no existe en Órdenes');
  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
});

test('15 · un ST sin OC se guarda con nro_oc NULL', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-0044');
  await page.fill('#sth5_descripcion', 'Sin OC asociada');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(800);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.nro_oc).toBeNull();
});

test('16 · (unidad_id, nro_st) duplicado se bloquea antes de salir a la red', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-0001');
  await page.fill('#sth5_descripcion', 'Duplicado');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(500);

  await expect(page.locator('#stFormMsgH05')).toContainText('ya tiene un Servicio Técnico ST-0001');
  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
});

test('17 · el ST se cancela: no hay DELETE y la fila se conserva', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  page.on('dialog', (d) => d.accept());
  await irAUM(page);

  await abrirFichaPrimeraUM(page);
  await page.click('[data-h05-cancelar-st]');
  await page.waitForTimeout(900);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.estado).toBe('Cancelado');
  expect(e.llamadas.filter((l) => String(l.op).indexOf('delete') === 0)).toHaveLength(0);
  expect(e.sts).toHaveLength(1);
  expect(e.sts[0].estado).toBe('Cancelado');
});

test('18 · el ST se carga tambien desde la ficha, con la UM ya fijada', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await abrirFichaPrimeraUM(page);
  await page.fill('#stfh5_nro', 'ST-0100');
  await page.fill('#stfh5_descripcion', 'Cargado desde la ficha');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(800);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.unidad_id).toBe(UM_A.id);
  expect(inserts[0].payload.nro_st).toBe('ST-0100');
});

test('19 · el boton Eliminar ST del legado ya no borra', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  const eliminados = await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-r16-del-st', 'ST-LEGACY');
    document.body.appendChild(b);
    b.click();
    b.remove();
    return window.__H05_LLAMADAS__.filter((l) => String(l.op).indexOf('delete') === 0).length;
  });
  expect(eliminados).toBe(0);
  const e = await estado(page);
  expect(e.sts).toHaveLength(1);
});

// =========================================================== robustez

test('20 · una respuesta vieja no reemplaza una lectura nueva', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], retardoSelectMs: 900 });
  await abrirSinEsperarCarga(page);

  // Mientras la primera lectura sigue en vuelo se dispara otra con otro conjunto.
  await page.evaluate(() => {
    window.__H05_SET_UMS__([{
      id: '44444444-4444-4444-8444-444444444444', codigo_um: 'NUEVA-001', tipo_um: 'Ascensor',
      estacion: 'AVELLANEDA', ramal: null, sector: null, descripcion: null, marca: null, modelo: null,
      nro_serie: null, estado: 'ACTIVA', proveedor_mantenimiento: null, observaciones: null,
      fecha_creacion: null, fecha_actualizacion: null
    }]);
    window.__H05_CFG__.retardoSelectMs = 0;
    window.recargarUnidadesMantenimiento();
  });
  await page.waitForTimeout(2500);

  const e = await estado(page);
  // Gana la lectura mas reciente, aunque la vieja termine despues.
  expect(e.ums.map((u) => u.codigo)).toEqual(['NUEVA-001']);
  expect(e.sincronizado).toBe(true);
});

test('21 · un fallo de lectura conserva el ultimo remoto confirmado y no revive el legado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], legadoUM: UM_LEGACY, legadoST: ST_LEGACY });
  await abrir(page);
  expect((await estado(page)).ums.map((u) => u.codigo)).toEqual(['ASC-001']);

  await page.evaluate(() => { window.__H05_CFG__.fallaSelect = true; });
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(700);

  const e = await estado(page);
  expect(e.origen).toBe('error-sin-sincronizar');
  expect(e.sincronizado).toBe(false);
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']); // ultimo confirmado
  expect(JSON.stringify(e.ums) + JSON.stringify(e.sts)).not.toContain('LEGACY');
});

test('22 · sin lectura confirmada previa, un fallo no inventa datos locales', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY, fallaSelect: true });
  await abrir(page);
  await irAUM(page);

  const e = await estado(page);
  expect(e.origen).toBe('error-sin-sincronizar');
  expect(e.ums).toHaveLength(0);
  expect(JSON.stringify(e.ums)).not.toContain('LEGACY');
  await expect(page.locator('#umTbody')).toContainText('No se pudo sincronizar con Supabase');
  await expect(page.locator('#umEstadoSyncH05')).toContainText('Reintentar');
});

test('23 · el reintento visible vuelve a consultar Supabase de verdad', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], fallaSelect: true });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).ums).toHaveLength(0);

  await page.evaluate(() => { window.__H05_CFG__.fallaSelect = false; });
  const antes = (await estado(page)).llamadas.length;
  await page.click('#btnRefrescarUMH05');
  await page.waitForTimeout(900);

  const e = await estado(page);
  expect(e.llamadas.length).toBeGreaterThan(antes);
  expect(e.sincronizado).toBe(true);
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
});

test('24 · un cambio real de sesion no filtra el estado confirmado del usuario anterior', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  expect((await estado(page)).ums).toHaveLength(1);

  // Otro operador entra y el servidor ya no le devuelve nada.
  await page.evaluate(() => {
    window.__H05_SET_UMS__([]);
    window.__H05_SET_STS__([]);
    window.__H05_CAMBIAR_SESION__('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });
  // Se espera a que la relectura de la sesion nueva quede confirmada, en lugar de
  // dormir un plazo fijo.
  await page.waitForFunction(
    () => window.__COI_UM_H05__ &&
      window.__COI_UM_H05__.authUserId === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' &&
      window.__COI_UM_H05__.sincronizado === true,
    null, { timeout: 15000 }
  );
  // Y despues se deja correr la ventana en la que las capas legadas repintan,
  // porque el riesgo real es que republiquen el inventario del operador anterior.
  await page.waitForTimeout(1200);

  const e = await estado(page);
  expect(e.ums).toHaveLength(0);
  expect(e.sts).toHaveLength(0);
});

test('24b · el inventario de la sesion anterior no reaparece por las capas legadas', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [ST_A] });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).ums).toHaveLength(2);

  await page.evaluate(() => {
    window.__H05_SET_UMS__([]);
    window.__H05_SET_STS__([]);
    window.__H05_CAMBIAR_SESION__('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });
  await page.waitForFunction(
    () => window.__COI_UM_H05__ && window.__COI_UM_H05__.sincronizado === true &&
      window.__COI_UM_H05__.authUserId === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    null, { timeout: 15000 }
  );

  // Se fuerza el camino exacto que resucitaba el inventario: recoverUMs() de
  // V58.1R8 conserva su propio umMaster y vuelve a publicarlo sobre las globales.
  const republicado = await page.evaluate(() => {
    const antes = (window.unidadesMantenimiento || []).length;
    window.unidadesMantenimiento = [{ idUM: 'ASC-001', tipoUM: 'Ascensor', estacion: 'PLAZA CONSTITUCION' }];
    return {
      antes: antes,
      despues: (window.unidadesMantenimiento || []).length,
      lexico: (typeof unidadesMantenimiento !== 'undefined' ? unidadesMantenimiento : []).length
    };
  });

  expect(republicado.antes).toBe(0);
  expect(republicado.despues).toBe(0);
  expect(republicado.lexico).toBe(0);
});

test('25 · un TOKEN_REFRESHED del mismo operador no descarta el modelo', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'TOKEN_REFRESHED' } }));
  });
  await page.waitForTimeout(700);

  const e = await estado(page);
  expect(e.sincronizado).toBe(true);
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
});

test('26 · el cierre de sesion no deja UM de la sesion anterior a la vista', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).ums).toHaveLength(1);

  await page.evaluate(() => window.__H05_SIGN_OUT__());
  await page.waitForTimeout(900);

  const e = await estado(page);
  expect(e.sincronizado).toBe(false);
  expect(e.ums).toHaveLength(0);
});

test('27 · un fallo de mutacion no deja la UI mostrando un cambio que el servidor rechazo', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], fallaMutacion: true });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);
  await page.fill('#umh5_proveedor', 'NO DEBE PERSISTIR');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(900);

  const e = await estado(page);
  expect(soloOp(e, 'update:coi_unidades_mantenimiento')).toHaveLength(1);
  // El modelo vuelve a lo que el servidor realmente tiene.
  const remoto = await page.evaluate(() => (window.unidadesMantenimiento || [])[0].proveedorMantenimiento);
  expect(remoto).toBe(UM_A.proveedor_mantenimiento);
  expect(e.escriturasLegacy).toEqual([]);
});

test('28 · el paginado recorre mas de una pagina sin perder ni duplicar filas', async ({ page }) => {
  const muchas = Array.from({ length: 7 }, (_, i) => Object.assign({}, UM_A, {
    id: '5555555' + i + '-5555-4555-8555-555555555555',
    codigo_um: 'PAG-' + String(i).padStart(3, '0')
  }));
  await prepararEntorno(page, { ums: muchas, sts: [], pageSize: 3 });
  await abrir(page);

  const e = await estado(page);
  expect(e.ums).toHaveLength(7);
  expect(new Set(e.ums.map((u) => u.uuid)).size).toBe(7);
  expect(soloOp(e, 'select:coi_unidades_mantenimiento').length).toBeGreaterThan(2);
});

test('29 · las capas legadas no repueblan el modelo despues del arranque', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [], legadoUM: UM_LEGACY, legadoST: ST_LEGACY
  });
  await abrir(page);
  await irAUM(page);
  // Los timers legados de V58.1R8 corren a 900, 2400 y 5200 ms.
  await page.waitForTimeout(6000);

  const e = await estado(page);
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
  expect(JSON.stringify(e.ums)).not.toContain('LEGACY');
  expect(e.escriturasLegacy).toEqual([]);
  expect(await page.locator('#umKTotal').textContent()).toBe('1');
});

test('30 · no se rompen los modulos vecinos ni el arranque general', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  const errores = await abrir(page);

  for (const vista of ['vistaDashboard', 'vistaOrdenes', 'vistaRed', 'vistaCalendario', 'vistaCentroAlertas', 'vistaTimeline']) {
    await page.evaluate((v) => {
      if (typeof window.mostrarVista === 'function') window.mostrarVista(v);
    }, vista);
    await page.waitForTimeout(120);
  }
  await irAUM(page);

  expect(errores).toEqual([]);
  expect((await estado(page)).ums).toHaveLength(1);
});

// =========================================================== ST · edicion (H04)

const ST_B = {
  id: '55555555-5555-4555-8555-555555555555',
  unidad_id: UM_A.id,
  nro_st: 'ST-0002',
  nro_oc: null,
  fecha: '2026-08-12',
  descripcion: 'Ajuste de puertas',
  tecnico: 'M. Gomez',
  proveedor: 'ASCENSORES SA',
  estado: 'Pendiente',
  observaciones: '',
  fecha_creacion: '2026-08-12T10:00:00.000Z',
  fecha_actualizacion: '2026-08-12T10:00:00.000Z'
};

// Abre la ficha de la UM y entra en modo edicion del ST indicado.
async function editarSTEnFicha(page, uuidST) {
  await abrirFichaPrimeraUM(page);
  await page.click('[data-h05-editar-st="' + uuidST + '"]');
  await page.waitForTimeout(400);
}

test('31 · Editar un ST precarga sus datos reales en el formulario de la ficha', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await expect(page.locator('#stfh5_nro')).toHaveValue(ST_A.nro_st);
  await expect(page.locator('#stfh5_fecha')).toHaveValue(ST_A.fecha);
  await expect(page.locator('#stfh5_oc')).toHaveValue(ST_A.nro_oc);
  await expect(page.locator('#stfh5_descripcion')).toHaveValue(ST_A.descripcion);
  await expect(page.locator('#stfh5_tecnico')).toHaveValue(ST_A.tecnico);
  await expect(page.locator('#stfh5_proveedor')).toHaveValue(ST_A.proveedor);
  await expect(page.locator('#stfh5_estado')).toHaveValue(ST_A.estado);
  // La UM no se ofrece: editar no reasigna historial tecnico a otro activo.
  await expect(page.locator('#stfh5_um')).toHaveCount(0);
});

test('32 · guardar la edicion es UN update contra el UUID, sin insert ni delete ni localStorage', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_descripcion', 'Cambio de rodamientos y engrase');
  await page.fill('#stfh5_tecnico', 'R. Lopez');
  await page.fill('#stfh5_proveedor', 'NUEVO PROVEEDOR SA');
  await page.selectOption('#stfh5_estado', 'En curso');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(900);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.filtro).toEqual({ col: 'id', val: ST_A.id });
  expect(updates[0].payload.patch.descripcion).toBe('Cambio de rodamientos y engrase');
  expect(updates[0].payload.patch.tecnico).toBe('R. Lopez');
  expect(updates[0].payload.patch.proveedor).toBe('NUEVO PROVEEDOR SA');
  expect(updates[0].payload.patch.estado).toBe('En curso');
  // La edicion no reasigna la UM.
  expect(updates[0].payload.patch.unidad_id).toBeUndefined();

  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(e.llamadas.filter((l) => String(l.op).indexOf('delete') === 0)).toHaveLength(0);
  expect(e.escriturasLegacy).toEqual([]);

  // Estado confirmado desde Supabase, sin filas de mas.
  expect(e.sts).toHaveLength(1);
  expect(e.sts[0].uuid).toBe(ST_A.id);
  expect(e.sts[0].estado).toBe('En curso');
});

test('33 · tras guardar, la ficha sale del modo edicion y muestra el ST actualizado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);
  await expect(page.locator('#fichaUMBody')).toContainText('Editar el Servicio Técnico ST-0001');

  await page.fill('#stfh5_descripcion', 'Descripción confirmada');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1000);

  await expect(page.locator('#fichaUMBody')).toContainText('Cargar ST para esta UM');
  await expect(page.locator('#fichaUMBody')).not.toContainText('Editar el Servicio Técnico');
  await expect(page.locator('#fichaUMBody')).toContainText('Descripción confirmada');
});

test('34 · Cancelar edición vuelve al alta sin tocar Supabase', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  const antes = (await estado(page)).llamadas.length;
  await page.click('[data-h05-salir-edicion-st]');
  await page.waitForTimeout(400);

  await expect(page.locator('#fichaUMBody')).toContainText('Cargar ST para esta UM');
  const e = await estado(page);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(e.llamadas.filter((l) => String(l.op).indexOf('delete') === 0)).toHaveLength(0);
  // No se comprueba la cantidad total de llamadas: otra capa puede releer en
  // segundo plano. Lo que Cancelar edicion no puede hacer es mutar.
  expect(e.llamadas.length).toBeGreaterThanOrEqual(antes);
});

test('35 · renombrar un ST al numero de otro de la misma UM queda bloqueado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A, ST_B] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await editarSTEnFicha(page, ST_B.id);

  await page.fill('#stfh5_nro', ST_A.nro_st);
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(600);

  await expect(page.locator('#stFichaMsgH05')).toContainText('ya tiene un Servicio Técnico ST-0001');
  const e = await estado(page);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  // Ninguno de los dos cambio de numero.
  expect(e.sts.map((s) => s.nroST).sort()).toEqual(['ST-0001', 'ST-0002']);
});

test('36 · conservar su propio nro_st al editar NO se considera duplicado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A, ST_B] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  // Se deja el mismo numero y se cambia solo la descripcion.
  await page.fill('#stfh5_descripcion', 'Mismo numero, otra descripción');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(900);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.filtro).toEqual({ col: 'id', val: ST_A.id });
  expect(updates[0].payload.patch.nro_st).toBe('ST-0001');
});

test('37 · la edicion valida la OC igual que el alta', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_oc', 'OC-2025-101'); // OC de demo legada: no existe
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(600);

  await expect(page.locator('#stFichaMsgH05')).toContainText('no existe en Órdenes');
  expect(soloOp(await estado(page), 'update:coi_servicios_tecnicos_um')).toHaveLength(0);

  // Vaciarla es valido: nro_oc es nullable.
  await page.fill('#stfh5_oc', '');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(900);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.nro_oc).toBeNull();
});

test('38 · doble click sobre Guardar cambios produce un unico update', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], retardoSelectMs: 250 });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_descripcion', 'Un solo update');
  const boton = page.locator('[data-h05-guardar-st-ficha]');
  await boton.click();
  await boton.click({ force: true });
  await page.waitForTimeout(1800);

  const e = await estado(page);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(1);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
});

test('39 · un UNIQUE violado en el servidor se traduce a un mensaje operativo', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A, ST_B],
    fallaMutacion: true,
    errorMutacion: 'duplicate key value violates unique constraint "coi_servicios_tecnicos_um_unidad_nro_st_key"'
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await editarSTEnFicha(page, ST_B.id);

  await page.fill('#stfh5_nro', 'ST-0099');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1000);

  // El servidor rechaza y la UI lo explica en terminos operativos, no con el
  // texto crudo de Postgres.
  await expect(page.locator('#coiToastV581')).toContainText('ya usa el número ST-0099');
  const e = await estado(page);
  expect(e.sts.map((s) => s.nroST).sort()).toEqual(['ST-0001', 'ST-0002']);
});

test('40 · sin rol administrador no se ofrece Editar ni Cancelar', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], admin: false });
  await abrir(page);
  await fijarAdmin(page, false);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);

  await expect(page.locator('[data-h05-editar-st]')).toHaveCount(0);
  await expect(page.locator('[data-h05-cancelar-st]')).toHaveCount(0);
  await expect(page.locator('#fichaUMBody')).toContainText('Ingrese como Administrador');
});

test('41 · un ST cancelado se conserva y ya no ofrece edicion', async ({ page }) => {
  const cancelado = Object.assign({}, ST_A, { estado: 'Cancelado' });
  await prepararEntorno(page, { ums: [UM_A], sts: [cancelado] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);

  await expect(page.locator('#fichaUMBody')).toContainText('ST-0001');
  await expect(page.locator('#fichaUMBody')).toContainText('Cancelado');
  await expect(page.locator('[data-h05-editar-st]')).toHaveCount(0);
});

test('42 · editar sin tocar la OC no exige que el catalogo de Ordenes este cargado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  // A proposito NO se siembra el catalogo de OC: es el caso del operador que
  // edita la descripcion mientras Ordenes todavia esta cargando.
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_descripcion', 'Editada sin catálogo de OC');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(900);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  // La OC sin tocar ya no viaja en el patch: asi un formulario abierto antes de
  // una renumeracion no puede reenviar el numero viejo.
  expect(Object.prototype.hasOwnProperty.call(updates[0].payload.patch, 'nro_oc')).toBe(false);
  expect(updates[0].payload.patch.descripcion).toBe('Editada sin catálogo de OC');
  // Y la asociacion persistida sigue intacta.
  expect(e.sts[0].oc).toBe(ST_A.nro_oc);
});

test('43 · cambiar la OC si exige el catalogo: nunca se acepta una OC sin validar', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_oc', '4530009999');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(700);

  // Sin catalogo en memoria la decision la toma Supabase, que tampoco tiene esa
  // OC: se rechaza igual y no se persiste nada.
  await expect(page.locator('#coiToastV581')).toContainText('no existe en Órdenes');
  expect(soloOp(await estado(page), 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
});

// ============================================ hallazgos de la revision del PR

// --- Finding 6: sin sesion no es «remoto vacio».

test('44 · sin sesion no se consulta UM/ST ni se declara sincronizado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], legadoUM: UM_LEGACY, sinSesion: true });
  await abrir(page);
  await irAUM(page);
  const e = await estado(page);

  // Ni un solo SELECT: la RLS habria devuelto [] y eso se veria igual que un
  // inventario remoto vacio, que es un estado valido.
  expect(soloOp(e, 'select:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(soloOp(e, 'select:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(e.sincronizado).toBe(false);
  expect(e.origen).toBe('error-sin-sincronizar');
  expect(e.ultimoError).toContain('no autenticada');
  expect(e.ums).toHaveLength(0);
  expect(JSON.stringify(e.ums)).not.toContain('LEGACY');
  await expect(page.locator('#umEstadoSyncH05')).toContainText('Sin sincronizar');
  await expect(page.locator('#umTbody')).toContainText('No se pudo sincronizar');
});

// --- Finding 4: el legado tampoco se puede borrar.

test('45 · removeItem sobre una clave legada no borra nada y queda registrado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY });
  const original = JSON.stringify(UM_LEGACY);
  await abrir(page);

  const r = await page.evaluate((esperado) => {
    // Un camino administrativo legado borra la clave antes de restaurar.
    localStorage.removeItem('coi_roca_unidades_mantenimiento');
    localStorage.removeItem('coi_servicios_tecnicos_um');
    return {
      raw: window.__COI_UM_H05_LEGACY_RAW__('coi_roca_unidades_mantenimiento'),
      intacto: window.__COI_UM_H05_LEGACY_RAW__('coi_roca_unidades_mantenimiento') === esperado,
      operativo: localStorage.getItem('coi_roca_unidades_mantenimiento'),
      bloqueadas: window.__COI_UM_H05_ESCRITURAS_BLOQUEADAS__.slice()
    };
  }, original);

  // El contenido historico sigue byte a byte donde estaba.
  expect(r.intacto).toBe(true);
  expect(r.raw).toBe(original);
  // Y los lectores operativos lo siguen viendo vacio.
  expect(JSON.parse(r.operativo)).toEqual([]);
  expect(r.bloqueadas).toContain('coi_roca_unidades_mantenimiento');
  expect(r.bloqueadas).toContain('coi_servicios_tecnicos_um');
});

test('46 · removeItem sigue funcionando para las claves que no son del legado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);

  const r = await page.evaluate(() => {
    localStorage.setItem('coi_clave_ajena_h05', 'valor');
    const antes = localStorage.getItem('coi_clave_ajena_h05');
    localStorage.removeItem('coi_clave_ajena_h05');
    return { antes: antes, despues: localStorage.getItem('coi_clave_ajena_h05') };
  });

  expect(r.antes).toBe('valor');
  expect(r.despues).toBeNull();
});

// --- Finding 5: concurrencia optimista en UM.

test('47 · un UPDATE de UM con version vieja no pisa el cambio de otro usuario', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  // El editor abre la UM en su version V1.
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  // Mientras tanto, otro administrador la da de baja: la fila pasa a V2.
  await page.evaluate((id) => {
    window.__H05_SET_UMS__([Object.assign({}, window.__H05_CFG__.ums[0], {
      id: id, estado: 'BAJA', observaciones: '[BAJA 2026-08-31] otro puesto',
      fecha_actualizacion: '2026-08-31T23:59:59.000Z'
    })]);
  }, UM_A.id);

  await page.fill('#umh5_proveedor', 'PISOTON SA');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  // La version viaja DENTRO de la condicion del UPDATE.
  const condiciones = updates[0].payload.filtros.map((f) => f.col).sort();
  expect(condiciones).toEqual(['fecha_actualizacion', 'id']);
  expect(updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion').val)
    .toBe(UM_A.fecha_actualizacion);

  // La baja del otro operador sigue en pie y el proveedor NO se piso.
  expect(e.ums).toHaveLength(1);
  expect(e.ums[0].estado).toBe('BAJA');
  const proveedor = await page.evaluate(() => (window.unidadesMantenimiento || [])[0].proveedorMantenimiento);
  expect(proveedor).toBe(UM_A.proveedor_mantenimiento);

  // Y el operador se entera.
  await expect(page.locator('#coiToastV581')).toContainText('modificada por otro usuario');
});

test('48 · sin conflicto, el UPDATE de UM se aplica normalmente', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  await page.fill('#umh5_proveedor', 'PROVEEDOR NUEVO SA');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(1000);

  const e = await estado(page);
  expect(soloOp(e, 'update:coi_unidades_mantenimiento')).toHaveLength(1);
  const proveedor = await page.evaluate(() => (window.unidadesMantenimiento || [])[0].proveedorMantenimiento);
  expect(proveedor).toBe('PROVEEDOR NUEVO SA');
});

test('49 · el UPDATE de ST tambien viaja condicionado por version', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_descripcion', 'Editada con CAS');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1000);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  const condiciones = updates[0].payload.filtros.map((f) => f.col).sort();
  expect(condiciones).toEqual(['fecha_actualizacion', 'id']);
  expect(updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion').val)
    .toBe(ST_A.fecha_actualizacion);
});

test('50 · un ST modificado en otro puesto no se pisa al guardar', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.evaluate((id) => {
    window.__H05_SET_STS__([Object.assign({}, window.__H05_CFG__.sts[0], {
      id: id, tecnico: 'OTRO PUESTO', fecha_actualizacion: '2026-08-31T23:59:59.000Z'
    })]);
  }, ST_A.id);

  await page.fill('#stfh5_descripcion', 'No debe persistir');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(1);
  // Gana el otro puesto: el ST conserva su cambio.
  const tecnico = await page.evaluate(() => (window.serviciosTecnicos || [])[0].tecnico);
  expect(tecnico).toBe('OTRO PUESTO');
  await expect(page.locator('#coiToastV581')).toContainText('modificado por otro usuario');
});

// --- Finding 7: BAJA solo por accion guardada.

test('51 · el formulario ordinario no ofrece BAJA', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  const opciones = await page.locator('#umh5_estado option').evaluateAll((os) => os.map((o) => o.value));
  expect(opciones).toEqual(['ACTIVA', 'FUERA DE SERVICIO']);
  expect(opciones).not.toContain('BAJA');
});

test('52 · no se puede crear una UM directamente en BAJA', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.fill('#umh5_codigo', 'ASC-BAJA');
  await page.selectOption('#umh5_tipo', 'Ascensor');
  await page.selectOption('#umh5_estacion', { index: 1 });
  // Se fuerza el estado como lo haria una manipulacion del DOM.
  await page.evaluate(() => {
    const sel = document.getElementById('umh5_estado');
    const op = document.createElement('option');
    op.value = 'BAJA';
    op.textContent = 'BAJA';
    sel.appendChild(op);
    sel.value = 'BAJA';
  });
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(600);

  await expect(page.locator('#umFormMsgH05')).toContainText('Dar de baja');
  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(e.ums).toHaveLength(0);
});

test('53 · guardar no puede llevar una UM ACTIVA a BAJA', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const sel = document.getElementById('umh5_estado');
    const op = document.createElement('option');
    op.value = 'BAJA';
    op.textContent = 'BAJA';
    sel.appendChild(op);
    sel.value = 'BAJA';
  });
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(700);

  await expect(page.locator('#umFormMsgH05')).toContainText('Dar de baja');
  const e = await estado(page);
  expect(soloOp(e, 'update:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(e.ums[0].estado).toBe('ACTIVA');
});

test('54 · una UM dada de baja conserva BAJA al editar otro campo', async ({ page }) => {
  const enBaja = Object.assign({}, UM_A, { estado: 'BAJA' });
  await prepararEntorno(page, { ums: [enBaja], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  // El select conserva el estado remoto aunque no sea ordinario.
  await expect(page.locator('#umh5_estado')).toHaveValue('BAJA');

  await page.fill('#umh5_proveedor', 'PROVEEDOR REVISADO SA');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(900);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.estado).toBe('BAJA');
  expect(updates[0].payload.patch.proveedor_mantenimiento).toBe('PROVEEDOR REVISADO SA');
  expect(e.ums[0].estado).toBe('BAJA');
});

test('55 · no se reactiva una UM en BAJA desde el formulario ordinario', async ({ page }) => {
  const enBaja = Object.assign({}, UM_A, { estado: 'BAJA' });
  await prepararEntorno(page, { ums: [enBaja], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  await page.selectOption('#umh5_estado', 'ACTIVA');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(700);

  await expect(page.locator('#umFormMsgH05')).toContainText('dada de baja');
  const e = await estado(page);
  expect(soloOp(e, 'update:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(e.ums[0].estado).toBe('BAJA');
});

test('56 · dar de baja sigue dejando la marca fechada y conserva el historial', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  page.on('dialog', (d) => d.accept('motivo operativo'));
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);
  await page.click('#btnBajaUMH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.estado).toBe('BAJA');
  expect(updates[0].payload.patch.observaciones).toMatch(/\[BAJA \d{4}-\d{2}-\d{2}\] motivo operativo/);
  // La baja tambien viaja condicionada por version.
  expect(updates[0].payload.filtros.map((f) => f.col).sort()).toEqual(['fecha_actualizacion', 'id']);
  expect(e.ums[0].estado).toBe('BAJA');
  expect(e.sts).toHaveLength(1);
});

// --- Finding 3: la ficha se repinta ante cualquier cambio remoto del ST.

test('57 · un cambio remoto solo en la descripcion del ST se refleja al actualizar', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await expect(page.locator('#fichaUMBody')).toContainText('Cambio de rodamientos');

  await page.evaluate((id) => {
    window.__H05_SET_STS__([Object.assign({}, window.__H05_CFG__.sts[0], {
      id: id, descripcion: 'DESCRIPCION CAMBIADA EN OTRO PUESTO'
    })]);
  }, ST_A.id);
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(900);

  await expect(page.locator('#fichaUMBody')).toContainText('DESCRIPCION CAMBIADA EN OTRO PUESTO');
  await expect(page.locator('#fichaUMBody')).not.toContainText('Cambio de rodamientos');
});

test('58 · un cambio remoto solo en el tecnico u observaciones tambien repinta', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await expect(page.locator('#fichaUMBody')).toContainText('J. Perez');

  await page.evaluate((id) => {
    window.__H05_SET_STS__([Object.assign({}, window.__H05_CFG__.sts[0], {
      id: id, tecnico: 'TECNICO NUEVO', proveedor: 'PROVEEDOR NUEVO'
    })]);
  }, ST_A.id);
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(900);

  await expect(page.locator('#fichaUMBody')).toContainText('TECNICO NUEVO');
  await expect(page.locator('#fichaUMBody')).toContainText('PROVEEDOR NUEVO');
  await expect(page.locator('#fichaUMBody')).not.toContainText('J. Perez');
});

// --- Finding 2: el numero de ST se compara canonicamente tambien en la UI.

test('59 · una variante del mismo numero de ST se bloquea antes de salir a la red', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  for (const variante of ['st0001', 'ST / 0001', 'st.0001']) {
    await page.selectOption('#sth5_um', UM_A.id);
    await page.fill('#sth5_nro', variante);
    await page.fill('#sth5_descripcion', 'Intento con variante');
    await page.click('#btnGuardarSTH05');
    await page.waitForTimeout(450);
    await expect(page.locator('#stFormMsgH05')).toContainText('el mismo número una vez normalizado');
  }

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
});

// --- Falso positivo ya cerrado: se deja la regresion que lo demuestra.

test('60 · un estado remoto desconocido se conserva al editar otro campo', async ({ page }) => {
  const desconocido = Object.assign({}, UM_A, { estado: 'MANTENIMIENTO' });
  await prepararEntorno(page, { ums: [desconocido], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  // opcionesSelect() agrega el valor remoto aunque no pertenezca al catalogo.
  await expect(page.locator('#umh5_estado')).toHaveValue('MANTENIMIENTO');

  await page.fill('#umh5_proveedor', 'PROVEEDOR SIN TOCAR ESTADO');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(900);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  // El estado del servidor no se reescribe a ACTIVA por no figurar en la lista.
  expect(updates[0].payload.patch.estado).toBe('MANTENIMIENTO');
  expect(updates[0].payload.patch.proveedor_mantenimiento).toBe('PROVEEDOR SIN TOCAR ESTADO');
});

// ================================= segunda ronda de review del PR #59

// --- F6 (P1): el snapshot remoto confirmado es privado e inmutable.

test('61 · un push del legado sobre la global no altera el snapshot confirmado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [] });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).ums).toHaveLength(2);

  const r = await page.evaluate(() => {
    const arr = window.unidadesMantenimiento;
    arr.push({ idUM: 'LOCAL-FAKE', codigoUM: 'LOCAL-FAKE', _supabaseId: 'no-uuid' });
    // Tambien por el binding lexico, que es el que prefieren varios lectores.
    try { unidadesMantenimiento.push({ idUM: 'LOCAL-FAKE-2' }); } catch (e) {}
    return {
      confirmado: window.__COI_UM_H05__.confirmadoUM.length,
      modelo: window.__COI_UM_H05_MODELO__.ums.length
    };
  });

  expect(r.confirmado).toBe(2);
  expect(r.modelo).toBe(2);
  // Y el render sigue mostrando exactamente lo remoto.
  await page.evaluate(() => window.renderUnidadesMantenimiento());
  await page.waitForTimeout(200);
  expect(await page.locator('#umKTotal').textContent()).toBe('2');
  await expect(page.locator('#umTbody')).not.toContainText('LOCAL-FAKE');
});

test('62 · mutar una fila publicada no contamina el snapshot remoto', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await irAUM(page);

  const r = await page.evaluate(() => {
    const antes = window.__COI_UM_H05__.confirmadoUM[0].proveedorMantenimiento;
    window.unidadesMantenimiento[0].proveedorMantenimiento = 'CONTAMINADO';
    window.unidadesMantenimiento[0].codigoUM = 'CONTAMINADO';
    return {
      antes: antes,
      confirmado: window.__COI_UM_H05__.confirmadoUM[0].proveedorMantenimiento,
      codigo: window.__COI_UM_H05__.confirmadoUM[0].codigoUM
    };
  });

  expect(r.antes).toBe(UM_A.proveedor_mantenimiento);
  expect(r.confirmado).toBe(UM_A.proveedor_mantenimiento);
  expect(r.codigo).toBe(UM_A.codigo_um);
});

test('63 · un splice del legado sobre los ST no toca el snapshot confirmado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A, ST_B] });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).sts).toHaveLength(2);

  const r = await page.evaluate(() => {
    const arr = window.serviciosTecnicos;
    arr.splice(0, arr.length);
    try { serviciosTecnicos.splice(0, serviciosTecnicos.length); } catch (e) {}
    const otro = window.serviciosTecnicosUM;
    otro.splice(0, otro.length);
    return {
      confirmado: window.__COI_UM_H05__.confirmadoST.length,
      modelo: window.__COI_UM_H05_MODELO__.sts.length
    };
  });

  expect(r.confirmado).toBe(2);
  expect(r.modelo).toBe(2);
});

test('64 · las globales legadas no comparten referencias entre si ni con el snapshot', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await irAUM(page);

  const r = await page.evaluate(() => ({
    mismoArrayQueSnapshot: window.unidadesMantenimiento === window.__COI_UM_H05__.confirmadoUM,
    mismoArrayQueHolder: window.unidadesMantenimiento === window.__COI_UM_H05_MODELO__.ums,
    dosLecturasMismoArray: window.unidadesMantenimiento === window.unidadesMantenimiento,
    stCompartidoConSTUM: window.serviciosTecnicos === window.serviciosTecnicosUM,
    filaCompartida: window.unidadesMantenimiento[0] === window.__COI_UM_H05__.confirmadoUM[0],
    snapshotCongelado: Object.isFrozen(window.__COI_UM_H05__.confirmadoUM),
    filaCongelada: Object.isFrozen(window.__COI_UM_H05__.confirmadoUM[0])
  }));

  expect(r.mismoArrayQueSnapshot).toBe(false);
  expect(r.mismoArrayQueHolder).toBe(false);
  expect(r.dosLecturasMismoArray).toBe(false);
  expect(r.stCompartidoConSTUM).toBe(false);
  expect(r.filaCompartida).toBe(false);
  expect(r.snapshotCongelado).toBe(true);
  expect(r.filaCongelada).toBe(true);
});

test('65 · reafirmarEspejo devuelve las globales al modelo remoto confirmado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [ST_A] });
  await abrir(page);
  await irAUM(page);

  const r = await page.evaluate(() => {
    window.unidadesMantenimiento.push({ idUM: 'BASURA' });
    window.serviciosTecnicos.splice(0, 1);
    // Cualquier render de la capa reafirma el espejo desde el snapshot.
    window.renderUnidadesMantenimiento();
    return {
      ums: window.unidadesMantenimiento.length,
      sts: window.serviciosTecnicos.length,
      codigos: window.unidadesMantenimiento.map((u) => u.codigoUM),
      sincronizado: window.__COI_UM_H05__.sincronizado
    };
  });

  expect(r.ums).toBe(2);
  expect(r.sts).toBe(1);
  expect(r.codigos.sort()).toEqual(['ASC-001', 'ESC-010']);
  // sincronizado sigue significando «confirmado por Supabase», nunca una mezcla.
  expect(r.sincronizado).toBe(true);
});

// --- F1 (P2): perfil activo antes de aceptar una lectura como autoritativa.

test('66 · con Auth UID pero sin perfil activo no se acepta el vacio como remoto', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], legadoUM: UM_LEGACY, rol: null });
  await abrir(page);
  await irAUM(page);
  const e = await estado(page);

  expect(e.sincronizado).toBe(false);
  expect(e.origen).toBe('error-sin-sincronizar');
  expect(e.ultimoError).toContain('perfil activo');
  expect(e.ums).toHaveLength(0);
  expect(JSON.stringify(e.ums)).not.toContain('LEGACY');
  // Ni siquiera se consulta: no hay razon para pedir filas que la RLS ocultara.
  expect(soloOp(e, 'select:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(soloOp(e, 'select:coi_servicios_tecnicos_um')).toHaveLength(0);
  await expect(page.locator('#umEstadoSyncH05')).toContainText('Sin sincronizar');
});

test('67 · con rol consulta la lectura es valida', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], rol: 'consulta' });
  await abrir(page);
  const e = await estado(page);

  expect(e.sincronizado).toBe(true);
  expect(e.origen).toBe('supabase');
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
});

test('68 · con rol administrador la lectura es valida', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], rol: 'administrador' });
  await abrir(page);
  const e = await estado(page);

  expect(e.sincronizado).toBe(true);
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
  expect(e.sts).toHaveLength(1);
});

// --- F3 (P2): el CAS usa la version que capturo el formulario.

test('69 · UM: el CAS usa la version del formulario aunque el runtime ya avanzo', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  // El operador deja el foco dentro del formulario: el refresco no repinta.
  await page.focus('#umh5_proveedor');
  await page.fill('#umh5_proveedor', 'ESCRITO SOBRE V1');

  // Otro puesto guarda: el remoto pasa a V2 y el runtime lo incorpora.
  await page.evaluate((id) => {
    window.__H05_SET_UMS__([Object.assign({}, window.__H05_CFG__.ums[0], {
      id: id, estado: 'BAJA', fecha_actualizacion: '2026-08-31T23:59:59.000Z'
    })]);
  }, UM_A.id);
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(800);

  // El runtime ya tiene V2, pero los inputs siguen siendo los de V1.
  const versionRuntime = await page.evaluate(() => window.__COI_UM_H05__.confirmadoUM[0].fechaActualizacion);
  expect(versionRuntime).toBe('2026-08-31T23:59:59.000Z');
  await expect(page.locator('#umh5_proveedor')).toHaveValue('ESCRITO SOBRE V1');

  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  // La condicion viaja con V1, la version que produjo esos inputs.
  const cond = updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion');
  expect(cond.val).toBe(UM_A.fecha_actualizacion);
  // 0 filas afectadas: la baja del otro puesto sobrevive.
  expect(e.ums[0].estado).toBe('BAJA');
  const proveedor = await page.evaluate(() => window.__COI_UM_H05__.confirmadoUM[0].proveedorMantenimiento);
  expect(proveedor).toBe(UM_A.proveedor_mantenimiento);
  await expect(page.locator('#coiToastV581')).toContainText('modificada por otro usuario');
});

test('70 · ST: el CAS usa la version del formulario aunque el runtime ya avanzo', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.focus('#stfh5_descripcion');
  await page.fill('#stfh5_descripcion', 'ESCRITO SOBRE V1');

  await page.evaluate((id) => {
    window.__H05_SET_STS__([Object.assign({}, window.__H05_CFG__.sts[0], {
      id: id, tecnico: 'OTRO PUESTO', fecha_actualizacion: '2026-08-31T23:59:59.000Z'
    })]);
  }, ST_A.id);
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(800);

  const versionRuntime = await page.evaluate(() => window.__COI_UM_H05__.confirmadoST[0].fechaActualizacion);
  expect(versionRuntime).toBe('2026-08-31T23:59:59.000Z');
  await expect(page.locator('#stfh5_descripcion')).toHaveValue('ESCRITO SOBRE V1');

  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  const cond = updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion');
  expect(cond.val).toBe(ST_A.fecha_actualizacion);
  const tecnico = await page.evaluate(() => window.__COI_UM_H05__.confirmadoST[0].tecnico);
  expect(tecnico).toBe('OTRO PUESTO');
  await expect(page.locator('#coiToastV581')).toContainText('modificado por otro usuario');
});

// --- F4 (P2): estado remoto no canonico de ST.

const ST_RARO = Object.assign({}, ST_A, {
  id: '66666666-6666-4666-8666-666666666666',
  nro_st: 'ST-0009',
  estado: 'Mantenimiento'
});

test('71 · se puede editar otro campo conservando un estado de ST no canonico', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_RARO] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_RARO.id);

  // El select conserva el valor remoto aunque no sea canonico.
  await expect(page.locator('#stfh5_estado')).toHaveValue('Mantenimiento');

  await page.fill('#stfh5_proveedor', 'PROVEEDOR REVISADO');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1000);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.estado).toBe('Mantenimiento');
  expect(updates[0].payload.patch.proveedor).toBe('PROVEEDOR REVISADO');
});

test('72 · resolver un estado de ST no canonico a uno canonico es valido', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_RARO] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_RARO.id);

  await page.selectOption('#stfh5_estado', 'En curso');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1000);

  const updates = soloOp(await estado(page), 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.estado).toBe('En curso');
});

test('73 · no se puede crear un ST con un estado desconocido', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-0500');
  await page.fill('#sth5_descripcion', 'Con estado inventado');
  await page.evaluate(() => {
    const sel = document.getElementById('sth5_estado');
    const op = document.createElement('option');
    op.value = 'Inventado';
    op.textContent = 'Inventado';
    sel.appendChild(op);
    sel.value = 'Inventado';
  });
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(600);

  await expect(page.locator('#stFormMsgH05')).toContainText('Estado no valido');
  expect(soloOp(await estado(page), 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
});

test('74 · no se puede cambiar un ST canonico a un estado desconocido', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.evaluate(() => {
    const sel = document.getElementById('stfh5_estado');
    const op = document.createElement('option');
    op.value = 'Inventado';
    op.textContent = 'Inventado';
    sel.appendChild(op);
    sel.value = 'Inventado';
  });
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(700);

  await expect(page.locator('#stFichaMsgH05')).toContainText('Estado no valido');
  expect(soloOp(await estado(page), 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
});

test('75 · no se puede pasar de un estado desconocido a otro distinto', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_RARO] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_RARO.id);

  await page.evaluate(() => {
    const sel = document.getElementById('stfh5_estado');
    const op = document.createElement('option');
    op.value = 'Otro Raro';
    op.textContent = 'Otro Raro';
    sel.appendChild(op);
    sel.value = 'Otro Raro';
  });
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(700);

  await expect(page.locator('#stFichaMsgH05')).toContainText('Estado no valido');
  expect(soloOp(await estado(page), 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
});

// --- F5 (P2): los ST sin UM resoluble tienen que verse.

const ST_SIN_UM = Object.assign({}, ST_A, {
  id: '77777777-7777-4777-8777-777777777777',
  unidad_id: null,
  nro_st: 'ST-HUERFANO-1',
  descripcion: 'Sin unidad asociada'
});
const ST_UM_FANTASMA = Object.assign({}, ST_A, {
  id: '88888888-8888-4888-8888-888888888888',
  unidad_id: '99999999-9999-4999-8999-999999999999',
  nro_st: 'ST-HUERFANO-2',
  descripcion: 'Apunta a una UM que no existe'
});

test('76 · un ST sin unidad_id aparece en el panel de pendientes de asociacion', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A, ST_SIN_UM] });
  await abrir(page);
  await irAUM(page);

  await expect(page.locator('#umSTHuerfanosPanelH05')).toContainText('Servicios Técnicos pendientes de asociación');
  await expect(page.locator('#umSTHuerfanosPanelH05')).toContainText('ST-HUERFANO-1');
  await expect(page.locator('#umSTHuerfanosPanelH05')).toContainText('Sin unidad asociada');
  await expect(page.locator('#umSTHuerfanosPanelH05')).toContainText('sin unidad_id');
  await expect(page.locator('#umSTHuerfanosPanelH05')).toContainText(ST_SIN_UM.id);
  await expect(page.locator('#umSTHuerfanosPanelH05')).toContainText('pendiente(s) de regularización');
  // El ST normal sigue en su ficha, no en el panel.
  await expect(page.locator('#umSTHuerfanosPanelH05')).not.toContainText('ST-0001');
});

test('77 · un ST que apunta a una UM inexistente tambien aparece', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_UM_FANTASMA] });
  await abrir(page);
  await irAUM(page);

  await expect(page.locator('#umSTHuerfanosPanelH05')).toContainText('ST-HUERFANO-2');
  await expect(page.locator('#umSTHuerfanosPanelH05')).toContainText('99999999-9999-4999-8999-999999999999');
  // No se inventa una UM ni se autoasigna: la UM sigue sin ese ST.
  const e = await estado(page);
  expect(e.ums).toHaveLength(1);
  expect(e.sts).toHaveLength(1);
});

test('78 · sin huerfanos el panel no aparece', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await irAUM(page);

  await expect(page.locator('#umSTHuerfanosPanelH05')).toHaveCount(0);
});

// --- F2 (P2): el codigo de UM se compara canonicamente.

test('79 · una variante del mismo codigo de UM se bloquea antes de salir a la red', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  for (const variante of ['asc001', 'ASC / 001', 'asc.001']) {
    await page.fill('#umh5_codigo', variante);
    await page.selectOption('#umh5_tipo', 'Ascensor');
    await page.selectOption('#umh5_estacion', { index: 1 });
    await page.click('#btnGuardarUMH05');
    await page.waitForTimeout(450);
    await expect(page.locator('#umFormMsgH05')).toContainText('el mismo código una vez normalizado');
  }

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(e.ums).toHaveLength(1);
});

test('80 · un codigo de UM realmente distinto se sigue permitiendo', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.fill('#umh5_codigo', 'ASC-002');
  await page.selectOption('#umh5_tipo', 'Ascensor');
  await page.selectOption('#umh5_estacion', { index: 1 });
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(900);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_unidades_mantenimiento')).toHaveLength(1);
  expect(e.ums.map((u) => u.codigo).sort()).toEqual(['ASC-001', 'ASC-002']);
});

// ================================== tercera ronda de review del PR #59

// --- F1 (P1): el modo edicion de ST no sobrevive al cambio de contexto.

test('81 · un alta desde el panel independiente no se convierte en UPDATE del ST que se editaba', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  // 1-2) ficha de la UM A y Editar sobre su ST.
  await editarSTEnFicha(page, ST_A.id);
  await expect(page.locator('#fichaUMBody')).toContainText('Editar el Servicio Técnico ST-0001');

  // 3) se sale de la ficha sin guardar.
  await page.click('#btnVolverUM');
  await page.waitForTimeout(400);
  await irAUM(page);

  // 4-5) alta nueva en el panel independiente, sobre OTRA UM.
  await page.selectOption('#sth5_um', UM_B.id);
  await page.fill('#sth5_nro', 'ST-NUEVO-1');
  await page.fill('#sth5_descripcion', 'Alta desde el panel independiente');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1000);

  const e = await estado(page);
  // Exactamente un INSERT, para la UM B.
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.unidad_id).toBe(UM_B.id);
  expect(inserts[0].payload.nro_st).toBe('ST-NUEVO-1');
  // Y ni un solo UPDATE contra el ST que se estaba editando.
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(0);

  // El ST A quedo intacto.
  const stA = e.sts.find((s) => s.uuid === ST_A.id);
  expect(stA.nroST).toBe('ST-0001');
  expect(stA.unidadId).toBe(UM_A.id);
  expect(e.sts).toHaveLength(2);
});

test('82 · renderizar el panel de alta cierra cualquier edicion de ST abierta', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  // Se vuelve al listado, que es donde vive el panel de alta.
  const enAlta = await page.evaluate(() => {
    if (typeof window.mostrarVista === 'function') window.mostrarVista('vistaUnidadesMantenimiento');
    window.renderUnidadesMantenimiento();
    return document.getElementById('umCargaSTPanelH05') !== null;
  });
  expect(enAlta).toBe(true);

  // El formulario de alta esta vacio: no heredo el ST que se editaba.
  await expect(page.locator('#sth5_nro')).toHaveValue('');
  await expect(page.locator('#sth5_descripcion')).toHaveValue('');
});

test('83 · Limpiar del panel de alta tambien cierra la edicion', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);
  await irAUM(page);

  await page.click('#btnNuevoSTH05');
  await page.waitForTimeout(300);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-NUEVO-2');
  await page.fill('#sth5_descripcion', 'Tras limpiar');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1000);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(1);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
});

test('84 · la ficha sigue pudiendo editar normalmente', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_descripcion', 'Edicion normal desde la ficha');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1000);

  const e = await estado(page);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(1);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
});

// --- F2 (P2): localStorage.clear() no puede llevarse el legado.

test('85 · clear() conserva las claves legadas y limpia el resto', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY, legadoST: ST_LEGACY });
  const originalUM = JSON.stringify(UM_LEGACY);
  const originalST = JSON.stringify(ST_LEGACY);
  await abrir(page);

  const r = await page.evaluate(({ um, st }) => {
    localStorage.setItem('coi_clave_normal_h05', 'contenido normal');
    const antesNormal = localStorage.getItem('coi_clave_normal_h05');
    // Camino administrativo legado: limpiarLocal() llama directo a clear().
    localStorage.clear();
    return {
      antesNormal: antesNormal,
      normalDespues: localStorage.getItem('coi_clave_normal_h05'),
      rawUM: window.__COI_UM_H05_LEGACY_RAW__('coi_roca_unidades_mantenimiento'),
      rawST: window.__COI_UM_H05_LEGACY_RAW__('coi_servicios_tecnicos_um'),
      intactoUM: window.__COI_UM_H05_LEGACY_RAW__('coi_roca_unidades_mantenimiento') === um,
      intactoST: window.__COI_UM_H05_LEGACY_RAW__('coi_servicios_tecnicos_um') === st,
      operativoUM: localStorage.getItem('coi_roca_unidades_mantenimiento'),
      bloqueadas: window.__COI_UM_H05_ESCRITURAS_BLOQUEADAS__.slice()
    };
  }, { um: originalUM, st: originalST });

  // La clave ajena se fue, como corresponde a un clear().
  expect(r.antesNormal).toBe('contenido normal');
  expect(r.normalDespues).toBeNull();
  // El legado sigue fisicamente, byte a byte.
  expect(r.intactoUM).toBe(true);
  expect(r.intactoST).toBe(true);
  expect(r.rawUM).toBe(originalUM);
  expect(r.rawST).toBe(originalST);
  // Y sigue sin ser autoritativo para los lectores operativos.
  expect(JSON.parse(r.operativoUM)).toEqual([]);
  // El intento queda registrado.
  expect(r.bloqueadas.some((k) => String(k).indexOf('clear:') === 0)).toBe(true);
});

test('86 · tras un clear() el modelo remoto sigue siendo la autoridad', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], legadoUM: UM_LEGACY });
  await abrir(page);
  await irAUM(page);

  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(900);

  const e = await estado(page);
  expect(e.sincronizado).toBe(true);
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
  expect(JSON.stringify(e.ums)).not.toContain('LEGACY');
});

// --- F3 (P2): la OC se valida contra Supabase, no contra la cache.

test('87 · una OC que solo existe en la cache local se rechaza', async ({ page }) => {
  // Supabase NO tiene la OC; el catalogo en memoria si (cache del modulo Ordenes).
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530009999'], { soloCache: true });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-OC-CACHE');
  await page.fill('#sth5_oc', '4530009999');
  await page.fill('#sth5_descripcion', 'OC solo en cache');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  // Se consulto coi_ordenes de verdad y no se persistio nada.
  expect(soloOp(e, 'select:coi_ordenes')
    .filter((l) => (l.payload || []).some((f) => f.col === 'nro_oc')).length).toBeGreaterThan(0);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
  await expect(page.locator('#coiToastV581')).toContainText('no existe en Órdenes');
});

test('88 · una OC ausente de la cache pero presente en Supabase se acepta', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530007777' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  // El catalogo en memoria queda vacio a proposito: la autoridad es Supabase.
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-OC-REMOTA');
  await page.fill('#sth5_oc', '4530007777');
  await page.fill('#sth5_descripcion', 'OC confirmada en Supabase');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.nro_oc).toBe('4530007777');
});

test('89 · si la validacion remota de la OC falla, no se guarda', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530007777' }], fallaSelectOC: true
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530007777']);
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-OC-FALLA');
  await page.fill('#sth5_oc', '4530007777');
  await page.fill('#sth5_descripcion', 'La validacion no se pudo hacer');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  await expect(page.locator('#coiToastV581')).toContainText('No se pudo verificar la OC');
});

test('90 · editar otro campo con la OC sin modificar no exige validacion remota', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], ordenes: [], fallaSelectOC: true });
  await abrir(page);
  await fijarAdmin(page, true);
  // Ni cache ni validacion remota disponibles.
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_descripcion', 'Editada sin tocar la OC');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  // La OC sin tocar no viaja en el patch, y la asociacion persistida no cambia.
  expect(Object.prototype.hasOwnProperty.call(updates[0].payload.patch, 'nro_oc')).toBe(false);
  expect(updates[0].payload.patch.descripcion).toBe('Editada sin tocar la OC');
  expect(e.sts[0].oc).toBe(ST_A.nro_oc);
  // El modulo de Ordenes lee coi_ordenes por su cuenta; lo que no puede haber
  // es una busqueda por nro_oc, que es como valida la capa una OC cambiada.
  const busquedasDeOC = soloOp(e, 'select:coi_ordenes')
    .filter((l) => (l.payload || []).some((f) => f.col === 'nro_oc'));
  expect(busquedasDeOC).toHaveLength(0);
});

test('91 · cambiar la OC de un ST existente si exige confirmacion remota', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }]
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964', '4530009999'], { soloCache: true });
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  // 4530009999 esta en la cache pero NO en Supabase.
  await page.fill('#stfh5_oc', '4530009999');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(soloOp(e, 'select:coi_ordenes')
    .filter((l) => (l.payload || []).some((f) => f.col === 'nro_oc')).length).toBeGreaterThan(0);
  await expect(page.locator('#coiToastV581')).toContainText('no existe en Órdenes');
});

// --- F4 (P2): la estacion se compara normalizada.

const UM_ESTACION_RARA = Object.assign({}, UM_A, {
  id: 'aaaa1111-1111-4111-8111-111111111111',
  codigo_um: 'ASC-900',
  estacion: 'ESTACION SIN CATALOGO'
});

test('92 · la UM aparece aunque la estacion difiera en acentos o mayusculas', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTACION_RARA], sts: [] });
  await abrir(page);
  await irAUM(page);

  const r = await page.evaluate(() => {
    const probar = (n) => (window.umsPorEstacion(n) || []).length;
    return {
      exacto: probar('ESTACION SIN CATALOGO'),
      acentuado: probar('Estación Sin Catálogo'),
      minusculas: probar('estacion sin catalogo'),
      espacios: probar('  ESTACION   SIN CATALOGO  '),
      otra: probar('TEMPERLEY')
    };
  });

  expect(r.exacto).toBe(1);
  expect(r.acentuado).toBe(1);
  expect(r.minusculas).toBe(1);
  expect(r.espacios).toBe(1);
  // Una estacion realmente distinta sigue sin coincidir.
  expect(r.otra).toBe(0);
});

test('93 · una estacion del catalogo maestro coincide escrita como la guarda Supabase', async ({ page }) => {
  // Supabase guarda PLAZA CONSTITUCION; el catalogo dice Plaza Constitución.
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await irAUM(page);

  const r = await page.evaluate(() => {
    const probar = (n) => (window.umsPorEstacion(n) || []).length;
    return {
      comoSupabase: probar('PLAZA CONSTITUCION'),
      comoCatalogo: probar('Plaza Constitución'),
      minusculas: probar('plaza constitucion'),
      otra: probar('QUILMES')
    };
  });

  expect(r.comoSupabase).toBe(1);
  expect(r.comoCatalogo).toBe(1);
  expect(r.minusculas).toBe(1);
  expect(r.otra).toBe(0);
});

test('94 · el texto de la estacion en Supabase no se reescribe', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTACION_RARA], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  // Se normaliza la COMPARACION, no el dato.
  const e = await estado(page);
  expect(e.ums[0].estacion).toBe('ESTACION SIN CATALOGO');
  await expect(page.locator('#umTbody')).toContainText('ESTACION SIN CATALOGO');
  // Y no se emitio ningun UPDATE para «corregir» la estacion.
  expect(soloOp(e, 'update:coi_unidades_mantenimiento')).toHaveLength(0);
});

// ================================== cuarta ronda de review del PR #59

// --- F1: el formulario se repinta tras una mutacion propia confirmada.

test('95 · tras CREAR una UM el formulario queda con la version confirmada', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.fill('#umh5_codigo', 'ASC-500');
  await page.selectOption('#umh5_tipo', 'Ascensor');
  await page.selectOption('#umh5_estacion', { index: 1 });
  await page.click('#btnGuardarUMH05');
  // Se deja el foco en el boton a proposito: es la situacion del finding, y
  // Playwright no garantiza donde queda tras un click.
  await page.focus('#btnGuardarUMH05');
  await page.waitForTimeout(1100);

  const r = await page.evaluate(() => ({
    versionRuntime: window.__COI_UM_H05__.confirmadoUM[0].fechaActualizacion,
    codigo: document.getElementById('umh5_codigo').value,
    enBoton: document.activeElement && document.activeElement.tagName === 'BUTTON'
  }));
  expect(r.enBoton).toBe(true);
  expect(r.codigo).toBe('ASC-500');

  // Y un segundo guardado NO da falso conflicto: usa la version nueva.
  await page.fill('#umh5_proveedor', 'PROVEEDOR TRAS ALTA');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(1100);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  const cond = updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion');
  expect(cond.val).toBe(r.versionRuntime);
  const proveedor = await page.evaluate(() => window.__COI_UM_H05__.confirmadoUM[0].proveedorMantenimiento);
  expect(proveedor).toBe('PROVEEDOR TRAS ALTA');
});

test('96 · dos UPDATE seguidos de UM no producen un falso conflicto', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  await page.fill('#umh5_proveedor', 'PRIMERA EDICION');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(1100);

  await page.fill('#umh5_proveedor', 'SEGUNDA EDICION');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(1100);

  const e = await estado(page);
  // Dos UPDATE, ambos aplicados: el segundo uso la version que dejo el primero.
  expect(soloOp(e, 'update:coi_unidades_mantenimiento')).toHaveLength(2);
  const proveedor = await page.evaluate(() => window.__COI_UM_H05__.confirmadoUM[0].proveedorMantenimiento);
  expect(proveedor).toBe('SEGUNDA EDICION');
  // Y nunca aparecio el aviso de conflicto.
  const toast = await page.locator('#coiToastV581').textContent().catch(() => '');
  expect(String(toast)).not.toContain('modificada por otro usuario');
});

// --- F2: el chequeo de rol es fail-closed.

test('97 · si la RPC de rol falla no se consulta UM/ST', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], legadoUM: UM_LEGACY, fallaRol: true });
  await abrir(page);
  await irAUM(page);
  const e = await estado(page);

  expect(soloOp(e, 'select:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(soloOp(e, 'select:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(e.sincronizado).toBe(false);
  expect(e.origen).toBe('error-sin-sincronizar');
  expect(e.ultimoError).toContain('No se pudo verificar el perfil');
  expect(e.ums).toHaveLength(0);
  expect(JSON.stringify(e.ums)).not.toContain('LEGACY');
});

test('98 · con la RPC de rol sana la lectura sigue funcionando', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], rol: 'consulta' });
  await abrir(page);
  const e = await estado(page);
  expect(e.sincronizado).toBe(true);
  expect(e.ums.map((u) => u.codigo)).toEqual(['ASC-001']);
});

// --- F5: el select marca el valor exacto del remoto.

test('99 · el select de estacion marca el valor exacto que guarda Supabase', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  // El catalogo maestro contiene «Plaza Constitución»; Supabase guarda
  // «PLAZA CONSTITUCION». Las dos designan la misma estacion.
  const r = await page.evaluate(() => ({
    encontradasNormalizado: (window.umsPorEstacion('Plaza Constitución') || []).length,
    catalogoTiene: typeof window.resolverEstacionMaestra === 'function'
      ? Boolean(window.resolverEstacionMaestra('Plaza Constitución'))
      : false
  }));
  expect(r.encontradasNormalizado).toBe(1);
  expect(r.catalogoTiene).toBe(true);

  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  // El select tiene que quedar en el texto EXACTO del remoto.
  await expect(page.locator('#umh5_estacion')).toHaveValue('PLAZA CONSTITUCION');
});

test('100 · editar otro campo conserva exactamente el texto de estacion remoto', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);
  await page.click('#btnEditarUM');
  await page.waitForTimeout(400);

  await page.fill('#umh5_proveedor', 'PROVEEDOR SIN TOCAR ESTACION');
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(1100);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_unidades_mantenimiento');
  expect(updates).toHaveLength(1);
  // No se reescribio el texto remoto por una variante del catalogo.
  expect(updates[0].payload.patch.estacion).toBe('PLAZA CONSTITUCION');
  expect(updates[0].payload.patch.proveedor_mantenimiento).toBe('PROVEEDOR SIN TOCAR ESTACION');
  expect(e.ums[0].estacion).toBe('PLAZA CONSTITUCION');
});

// --- F4 (parte frontend): la OC no viaja si no se toco.

test('101 · editar un ST sin tocar la OC no reenvia el nro_oc', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_descripcion', 'Solo cambia la descripcion');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1100);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  // nro_oc NO viaja: un formulario abierto antes de una renumeracion no puede
  // reenviar el numero viejo.
  expect(Object.prototype.hasOwnProperty.call(updates[0].payload.patch, 'nro_oc')).toBe(false);
  expect(updates[0].payload.patch.descripcion).toBe('Solo cambia la descripcion');
});

test('102 · cambiar la OC si la incluye en el patch, ya confirmada', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }, { nro_oc: '4530003333' }]
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964', '4530003333']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_oc', '4530003333');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.nro_oc).toBe('4530003333');
});
