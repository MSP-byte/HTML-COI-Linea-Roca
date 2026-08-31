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
    retardoSelectMs: 0, pageSize: 1000, admin: true
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

    let sesionActiva = true;
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
    window.__H05_SET_UMS__ = (v) => { ums = v.slice(); };
    window.__H05_SET_STS__ = (v) => { sts = v.slice(); };
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    const uuid = (n) => '99999999-9999-4999-8999-' + String(n).padStart(12, '0');

    function consulta(tabla) {
      const st = { tabla, filtro: null, patch: null, op: null, rango: null, limite: 0 };
      const api = {
        select() { return api; },
        order() { return api; },
        range(a, b) { st.rango = [a, b]; return api; },
        in() { return api; },
        limit(n) { st.limite = n; return api; },
        eq(col, val) { st.filtro = { col, val }; return api; },
        single() { return api._run(true); },
        insert(f) { st.op = 'insert'; st.payload = f; return api; },
        update(p) { st.op = 'update'; st.patch = p; return api; },
        delete() { st.op = 'delete'; return api; },
        async _run(unico) {
          const esUM = st.tabla === 'coi_unidades_mantenimiento';
          const esST = st.tabla === 'coi_servicios_tecnicos_um';
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
            registrar('update:' + st.tabla, { filtro: st.filtro, patch: st.patch });
            if (c.fallaMutacion) return { data: null, error: { message: c.errorMutacion } };
            const actuales = leer().slice();
            const i = actuales.findIndex((f) => f.id === (st.filtro && st.filtro.val));
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
          if (st.filtro) base = base.filter((f) => f[st.filtro.col] === st.filtro.val);
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
async function sembrarOC(page, numeros) {
  await page.evaluate((ns) => {
    window.todasLasOC = () => ns.map((n) => ({
      oc: n, item: { numeroOC: n, supabaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', idObra: 'OB-' + n }
    }));
  }, numeros);
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

  const fila = page.locator('#umTbody tr').first();
  await expect(fila).toHaveAttribute('data-h05-open-um', UM_A.id);
  await fila.locator('button.btn-open-um').click();
  await page.waitForTimeout(300);
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

  await page.locator('#umTbody tr').first().locator('button.btn-open-um').click();
  await page.waitForTimeout(300);
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

  await page.locator('#umTbody tr').first().locator('button.btn-open-um').click();
  await page.waitForTimeout(300);
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

  await page.locator('#umTbody tr').first().locator('button.btn-open-um').click();
  await page.waitForTimeout(300);
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

  await page.locator('#umTbody tr').first().locator('button.btn-open-um').click();
  await page.waitForTimeout(300);
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

  await page.locator('#umTbody tr').first().locator('button.btn-open-um').click();
  await page.waitForTimeout(300);
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
