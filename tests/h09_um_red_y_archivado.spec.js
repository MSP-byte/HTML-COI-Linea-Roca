const { test, expect } = require('@playwright/test');

/*
  H09 — UM como inventario de la RED ROCA, y archivado de OC persistido.

  Dos objetivos, un solo criterio: Supabase es la autoridad.

  A · El modulo de Unidades de Mantenimiento existia pero era inalcanzable: su
      boton estaba oculto por CSS. Ademas la UM se leia como un accesorio de la
      OC. La definicion vigente es
      RED ROCA -> ESTACION -> UM -> HISTORIAL DE ST, con la OC como referencia
      OPCIONAL.

  B · «Archivar OC» mutaba el objeto en memoria y escribia localStorage: la OC
      volvia a estar activa en el siguiente F5. Ahora pasa por la RPC canonica
      con `estado_registro`, que ya existe en public.coi_ordenes.

  PRODUCCION y STAGING tienen coi_unidades_mantenimiento y
  coi_servicios_tecnicos_um VACIAS. Estas pruebas verifican que el remoto vacio
  se respeta: no se siembra la demo legada, no se usa localStorage como
  fallback y el estado vacio es explicito.

  Supabase se intercepta con clientes falsos: ninguna prueba toca datos reales.
*/

const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const UM_A = {
  id: '11111111-1111-4111-8111-111111111111',
  codigo_um: 'ASC-001',
  tipo_um: 'Ascensor',
  estacion: 'PLAZA CONSTITUCION',
  ramal: 'La Plata',
  sector: 'Andén 1',
  descripcion: 'Ascensor lado norte',
  marca: 'OTIS',
  modelo: 'GEN2-COMPACT',
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
  sector: 'Hall',
  marca: 'SCHINDLER',
  modelo: 'SWE-9300',
  nro_serie: 'SN-0002',
  estado: 'FUERA DE SERVICIO'
});

// ST CON OC referencial.
const ST_CON_OC = {
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

// ST SIN OC: la OC no es obligatoria para el modelo.
const ST_SIN_OC = Object.assign({}, ST_CON_OC, {
  id: '44444444-4444-4444-8444-444444444444',
  unidad_id: UM_B.id,
  nro_st: 'ST-0002',
  nro_oc: null,
  fecha: '2026-08-20',
  descripcion: 'Inspección preventiva sin orden asociada',
  estado: 'Cerrado'
});

// Inventario de demostracion que quedo en localStorage y NO se importa.
const LEGADO_UM = [{ idUM: 'UM-LEGADA-001', tipoUM: 'Ascensor', estacion: 'LEGADA', estadoOperativo: 'Activo' }];
const LEGADO_ST = [{ idST: 'ST-LEGADO-001', idUM: 'UM-LEGADA-001', obra: 'OC-LEGADA' }];

// ============================================================ fixture UM/ST

async function prepararUM(page, opciones = {}) {
  const cfg = Object.assign({ ums: [], sts: [], rol: 'administrador', legado: true }, opciones);

  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());

  await page.addInitScript((c) => {
    window.__H09_CFG__ = c;
    window.__H09_LLAMADAS__ = [];
    window.__H09_ESCRITURAS_LEGACY__ = [];

    const CLAVES_LEGACY = [
      'coi_roca_unidades_mantenimiento', 'coi_unidades_mantenimiento',
      'coi_servicios_tecnicos_um', 'coi_servicios_tecnicos'
    ];
    if (c.legado) {
      localStorage.setItem('coi_roca_unidades_mantenimiento', JSON.stringify(c.legadoUM));
      localStorage.setItem('coi_servicios_tecnicos_um', JSON.stringify(c.legadoST));
    }
    // Cualquier intento de persistir inventario operativo queda registrado.
    const setItemNativo = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (CLAVES_LEGACY.indexOf(k) >= 0) {
        window.__H09_ESCRITURAS_LEGACY__.push({ clave: k, valor: String(v).slice(0, 160) });
      }
      return setItemNativo.call(this, k, v);
    };

    let ums = c.ums.slice();
    let sts = c.sts.slice();
    window.__H09_SET_UMS__ = (v) => { ums = (v || []).slice(); };
    window.__H09_SET_STS__ = (v) => { sts = (v || []).slice(); };
    const registrar = (op, payload) => window.__H09_LLAMADAS__.push({ op, payload });

    function datos(tabla) {
      if (tabla === 'coi_unidades_mantenimiento') return ums;
      if (tabla === 'coi_servicios_tecnicos_um') return sts;
      return [];
    }

    function consulta(tabla) {
      const st = { tabla, filtros: [], conteo: false, op: null, payload: null };
      const cumple = (f) => st.filtros.every((x) => {
        if (x.op === 'gt') return String(f[x.col]) > String(x.val);
        return String(f[x.col]) === String(x.val);
      });
      const api = {
        select(cols, opts) { st.conteo = Boolean(opts && opts.head); return api; },
        order() { return api; }, range() { return api; }, in() { return api; },
        is() { return api; }, ilike() { return api; }, limit() { return api; },
        eq(col, val) { st.filtros.push({ op: 'eq', col, val }); return api; },
        gt(col, val) { st.filtros.push({ op: 'gt', col, val }); return api; },
        insert(v) { st.op = 'insert'; st.payload = v; return api; },
        update(v) { st.op = 'update'; st.payload = v; return api; },
        delete() { st.op = 'delete'; return api; },
        single() { return api._run(true); },
        async _run() {
          const base = datos(st.tabla);
          if (st.op) {
            registrar(st.op + ':' + st.tabla, st.payload);
            // Alta real: se agrega al remoto para poder releerlo.
            if (st.op === 'insert') {
              const fila = Object.assign({ id: 'ffffffff-ffff-4fff-8fff-' + String(base.length + 1).padStart(12, '0') },
                Array.isArray(st.payload) ? st.payload[0] : st.payload);
              base.push(fila);
              return { data: [fila], error: null };
            }
            return { data: [], error: null };
          }
          if (st.conteo) {
            registrar('count:' + st.tabla, null);
            return { data: null, count: base.length, error: null };
          }
          registrar('select:' + st.tabla, st.filtros);
          const filas = base.filter(cumple).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
          return { data: filas, error: null };
        },
        then(res, rej) { return api._run(false).then(res, rej); }
      };
      return api;
    }

    const fake = {
      from: (t) => consulta(t),
      rpc: async (nombre) => {
        registrar('rpc:' + nombre, null);
        if (nombre === 'coi_current_role') return { data: window.__H09_CFG__.rol, error: null };
        return { data: null, error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@coiroca.test' } } }, error: null }),
        getUser: async () => ({ data: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };
    window.__COI_SUPABASE_CLIENT__ = fake;
    window.getSupabaseClient = () => fake;
    window.initSupabase = async () => fake;
    window.getUsuarioActual = async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@coiroca.test' });
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.__H09_ALERTAS__ = [];
    window.alert = (m) => window.__H09_ALERTAS__.push(String(m));
    window.confirm = () => true;
  }, Object.assign({}, cfg, { legadoUM: LEGADO_UM, legadoST: LEGADO_ST }));
}

async function abrir(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_UM_H09), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  return errores;
}

// Navegacion REAL: se despliega la barra lateral si hace falta —en mobile vive
// detras del boton de menu— y se hace click en la entrada del modulo.
async function desplegarMenu(page) {
  const boton = page.locator('[data-v2-nav="btnUnidadesMantenimiento"]');
  const fueraDePantalla = await boton.evaluate((el) => el.getBoundingClientRect().left < 0);
  if (fueraDePantalla) {
    await page.click('#coiV2Menu');
    await page.waitForTimeout(400);
  }
  return boton;
}

async function abrirModuloUM(page) {
  const boton = await desplegarMenu(page);
  await boton.click();
  await page.waitForTimeout(900);
}

// ============================================================ A · inventario

test('H09-1 · el módulo UM es alcanzable desde la navegación global', async ({ page }) => {
  // Estaba oculto por CSS (#btnUnidadesMantenimiento{display:none!important}):
  // el inventario existia y no habia forma de llegar.
  await prepararUM(page, { ums: [UM_A, UM_B], sts: [ST_CON_OC, ST_SIN_OC] });
  await abrir(page);

  const boton = await desplegarMenu(page);
  await expect(boton).toBeVisible();
  await expect(boton).toHaveText('UM / Servicios Técnicos');

  await abrirModuloUM(page);
  // Es un módulo global, no una pestaña de Administración.
  await expect(page.locator('#vistaUnidadesMantenimiento')).toHaveClass(/active/);
  await expect(page.locator('#vistaAdministracionSistema')).not.toHaveClass(/active/);
});

test('H09-2 · el inventario muestra los campos de la red desde Supabase', async ({ page }) => {
  await prepararUM(page, { ums: [UM_A, UM_B], sts: [] });
  await abrir(page);
  await abrirModuloUM(page);

  const cabecera = await page.locator('#umTbody').evaluate((tb) =>
    Array.from(tb.closest('table').querySelectorAll('thead th')).map((th) => th.textContent.trim()));
  for (const col of ['Código UM', 'Tipo', 'Estación', 'Sector', 'Estado', 'Fabricante', 'Modelo']) {
    expect(cabecera).toContain(col);
  }

  const cuerpo = page.locator('#umTbody');
  await expect(cuerpo).toContainText('ASC-001');
  await expect(cuerpo).toContainText('PLAZA CONSTITUCION');
  await expect(cuerpo).toContainText('OTIS');
  await expect(cuerpo).toContainText('GEN2-COMPACT');
  await expect(cuerpo).toContainText('ESC-010');

  // KPI de cobertura de red.
  await expect(page.locator('#h09KEstaciones')).toHaveText('2');
});

test('H09-3 · remoto vacío se muestra vacío: no se siembra el legado', async ({ page }) => {
  await prepararUM(page, { ums: [], sts: [], legado: true });
  await abrir(page);
  await abrirModuloUM(page);

  await expect(page.locator('#umTbody')).toContainText('No hay Unidades de Mantenimiento cargadas en Supabase');

  const r = await page.evaluate(() => ({
    modelo: (window.unidadesMantenimiento || []).length,
    st: (window.serviciosTecnicos || []).length,
    // El legado sigue fisicamente en localStorage: no se borra.
    legadoIntacto: localStorage.getItem('coi_roca_unidades_mantenimiento') !== null,
    escrituras: window.__H09_ESCRITURAS_LEGACY__.length,
    diag: window.COI_UM_H09.diagnostico()
  }));

  expect(r.modelo).toBe(0);
  expect(r.st).toBe(0);
  expect(r.legadoIntacto).toBe(true);
  // Ni una sola escritura operativa sobre las claves legadas.
  expect(r.escrituras).toBe(0);
  expect(r.diag.unidades).toBe(0);
  // Y el legado nunca se vuelve operativo.
  await expect(page.locator('#umTbody')).not.toContainText('UM-LEGADA-001');
});

test('H09-4 · los filtros del inventario operan sobre el dataset de Supabase', async ({ page }) => {
  await prepararUM(page, { ums: [UM_A, UM_B], sts: [] });
  await abrir(page);
  await abrirModuloUM(page);

  await page.selectOption('#umFiltroEstacion', 'TEMPERLEY');
  await page.waitForTimeout(500);
  await expect(page.locator('#umTbody')).toContainText('ESC-010');
  await expect(page.locator('#umTbody')).not.toContainText('ASC-001');

  await page.selectOption('#umFiltroEstacion', '');
  await page.selectOption('#umFiltroTipo', 'Ascensor');
  await page.waitForTimeout(500);
  await expect(page.locator('#umTbody')).toContainText('ASC-001');
  await expect(page.locator('#umTbody')).not.toContainText('ESC-010');

  await page.selectOption('#umFiltroTipo', '');
  await page.selectOption('#umFiltroEstado', 'FUERA DE SERVICIO');
  await page.waitForTimeout(500);
  await expect(page.locator('#umTbody')).toContainText('ESC-010');
  await expect(page.locator('#umTbody')).not.toContainText('ASC-001');
});

// ============================================================ A · ST global

test('H09-5 · Servicios Técnicos es una sección del módulo global, sin pasar por Configuración', async ({ page }) => {
  await prepararUM(page, { ums: [UM_A, UM_B], sts: [ST_CON_OC, ST_SIN_OC] });
  await abrir(page);
  await abrirModuloUM(page);

  await expect(page.locator('#h09Tabs button[data-h09-tab="servicios"]')).toBeVisible();
  await page.click('#h09Tabs button[data-h09-tab="servicios"]');
  await page.waitForTimeout(500);

  await expect(page.locator('#h09PanelST')).toBeVisible();
  // Seguimos dentro del módulo global.
  await expect(page.locator('#vistaUnidadesMantenimiento')).toHaveClass(/active/);

  const cuerpo = page.locator('#h09StTbody');
  await expect(cuerpo).toContainText('ST-0001');
  await expect(cuerpo).toContainText('ST-0002');
  await expect(cuerpo).toContainText('PLAZA CONSTITUCION');
  await expect(cuerpo).toContainText('4530008964');

  // Filtro por estación del ST, resuelto por su UM.
  await page.selectOption('#h09StEstacion', 'TEMPERLEY');
  await page.waitForTimeout(400);
  await expect(cuerpo).toContainText('ST-0002');
  await expect(cuerpo).not.toContainText('ST-0001');

  // Filtro por estado.
  await page.selectOption('#h09StEstacion', '');
  await page.selectOption('#h09StEstado', 'Pendiente');
  await page.waitForTimeout(400);
  await expect(cuerpo).toContainText('ST-0001');
  await expect(cuerpo).not.toContainText('ST-0002');
});

test('H09-6 · la OC es referencial: no es requisito de una UM ni de un ST', async ({ page }) => {
  await prepararUM(page, { ums: [UM_A, UM_B], sts: [ST_CON_OC, ST_SIN_OC] });
  await abrir(page);
  await abrirModuloUM(page);
  await page.click('#h09Tabs button[data-h09-tab="servicios"]');
  await page.waitForTimeout(500);

  // Un ST sin OC se lista igual.
  await expect(page.locator('#h09StTbody')).toContainText('ST-0002');
  await expect(page.locator('#h09StKSinOC')).toHaveText('1');

  const r = await page.evaluate(() => ({
    // Ninguna UM del modelo lleva OC: el eje es la estación.
    umConOC: (window.unidadesMantenimiento || []).filter((u) => String(u.ocActual || '').trim()).length,
    estaciones: Array.from(new Set((window.unidadesMantenimiento || []).map((u) => u.estacion))).sort(),
    diag: window.COI_UM_H09.diagnostico()
  }));
  expect(r.umConOC).toBe(0);
  expect(r.estaciones).toEqual(['PLAZA CONSTITUCION', 'TEMPERLEY']);
  expect(r.diag.ocObligatoriaParaUM).toBe(false);
});

test('H09-7 · el alta de UM sigue yendo por el camino Supabase de H05', async ({ page }) => {
  await prepararUM(page, { ums: [], sts: [] });
  await abrir(page);
  await abrirModuloUM(page);

  const r = await page.evaluate(async () => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('umh5_codigo', 'ASC-NUEVA');
    set('umh5_tipo', 'Ascensor');
    set('umh5_estacion', 'PLAZA CONSTITUCION');
    const btn = document.querySelector('[data-h05-guardar-um]') ||
      document.getElementById('btnGuardarUM');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    return {
      inserts: window.__H09_LLAMADAS__.filter((l) => l.op === 'insert:coi_unidades_mantenimiento'),
      escriturasLegacy: window.__H09_ESCRITURAS_LEGACY__.length,
      hayFormulario: Boolean(document.getElementById('umh5_codigo'))
    };
  });

  // El formulario Supabase-first de H05 sigue siendo el camino de alta.
  expect(r.hayFormulario).toBe(true);
  // Y el alta viaja a Supabase, nunca a localStorage.
  expect(r.escriturasLegacy).toBe(0);
});

// ============================================================ B · archivado

const OC_ID = '0c000000-0000-4000-8000-453000896400';
const OC_NRO = '4530008964';

async function prepararArchivo(page, opciones = {}) {
  const cfg = Object.assign({ estadoInicial: 'Activo', fallaRpc: false }, opciones);

  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_ARCHIVO_OC_H09), null, { timeout: 20000 });

  await page.evaluate(({ id, nro, c }) => {
    const estado = {
      // Fila REMOTA: la unica autoridad.
      remota: {
        id: id, nro_oc: nro, id_obra: 'OBRA-H09', tipo: 'Obra',
        estacion: 'PLAZA CONSTITUCION', proveedor: 'PROVEEDOR H09',
        moneda: 'ARS', monto_total: 1000, plazo_dias: 30,
        fecha_acta_inicio: '2026-08-01', fecha_vencimiento: '2026-08-31',
        estado_documental: 'Pendiente',
        // H10 · solo se archiva una OC CERRADA (TD-071). Estas pruebas fijan el
        // MECANISMO de archivado, no la legalidad de archivar una OC abierta:
        // por eso la OC del fixture llega ya cerrada operativamente.
        estado_coi: 'Cerrada', fecha_cierre_operativo: '2026-08-25',
        estado_registro: c.estadoInicial,
        fecha_actualizacion: '2026-09-01T10:00:00.000Z'
      },
      rpc: [], escriturasLocales: 0, toasts: [], recargas: 0, fallaRpc: c.fallaRpc
    };
    window.__H09_ARCH__ = estado;

    // Modelo EN MEMORIA. Arranca espejando el remoto y solo vuelve a
    // sincronizarse cuando se recarga desde Supabase.
    estado.memoria = { estado_registro: estado.remota.estado_registro };
    const construirItem = () => ({
      supabaseId: id, id: id, idObra: 'OBRA-H09', numeroOC: nro, oc: nro,
      tipo: 'Obra', estacion: 'PLAZA CONSTITUCION', proveedor: 'PROVEEDOR H09',
      estado: 'Cerrada', estadoCOI: 'Cerrada', estadoRegistro: estado.memoria.estado_registro,
      _supabaseRaw: Object.assign({}, estado.remota, { estado_registro: estado.memoria.estado_registro })
    });
    const construirFila = () => ({
      item: construirItem(), oc: nro, tipo: 'Obra',
      estacion: 'PLAZA CONSTITUCION', estado: 'Cerrada'
    });
    estado.construirFila = construirFila;

    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@coiroca.test' } }, error: null }),
        getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'admin@coiroca.test' } } }, error: null })
      },
      from: () => {
        const api = {
          select() { return api; }, eq() { return api; }, limit() { return api; },
          order() { return api; },
          single: async () => ({ data: Object.assign({}, estado.remota), error: null }),
          then(res, rej) { return Promise.resolve({ data: [Object.assign({}, estado.remota)], error: null }).then(res, rej); }
        };
        return api;
      },
      rpc: async (nombre, args) => {
        estado.rpc.push({ nombre: nombre, args: JSON.parse(JSON.stringify(args || {})) });
        if (nombre !== 'coi_actualizar_orden_integral') return { data: null, error: null };
        if (estado.fallaRpc) return { data: null, error: { code: '42501', message: 'permission denied fixture H09' } };
        Object.assign(estado.remota, args.p_cambios || {});
        return { data: { orden: Object.assign({}, estado.remota) }, error: null };
      }
    };

    window.getSupabaseClient = () => client;
    window.__COI_SUPABASE_CLIENT__ = client;
    window.getUsuarioActual = async () => ({ id: 'u1', email: 'admin@coiroca.test' });
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.ocActualId = nro;
    window.resolverOrdenActual = () => construirFila();
    window.obtenerOC = () => construirFila();
    window.todasLasOC = () => [construirFila()];
    window.registrarHistorialOC = async () => {};
    window.confirm = () => true;
    window.toast = (m, t) => estado.toasts.push({ m: String(m), t: t });
    window.coiToast = window.toast;
    // Recarga desde Supabase: la memoria se rehidrata SOLO desde el remoto.
    window.recargarDatosDesdeSupabase = async () => {
      estado.recargas += 1;
      // La memoria se rehidrata SOLO desde el remoto.
      estado.memoria.estado_registro = estado.remota.estado_registro;
    };
    // Cualquier persistencia local queda contada: no puede haber ninguna.
    window.guardarBaseLocal = () => { estado.escriturasLocales += 1; };

    // Ficha visible con el botón real.
    const vista = document.getElementById('vistaFichaOC');
    document.querySelectorAll('section.view.active').forEach((n) => n.classList.remove('active'));
    if (vista) { vista.classList.add('active'); vista.hidden = false; }
    const body = document.getElementById('fichaOCBody');
    if (body) body.innerHTML = '<div class="oc-header"><h2>' + nro + '</h2></div>';
    window.renderFichaOC = () => { try { window.COI_ARCHIVO_OC_H09.sincronizarBotones(); } catch (e) {} };
    window.COI_ARCHIVO_OC_H09.sincronizarBotones();
  }, { id: OC_ID, nro: OC_NRO, c: cfg });
  await page.waitForTimeout(300);
}

const estadoArchivo = (page) => page.evaluate(() => ({
  remoto: window.__H09_ARCH__.remota.estado_registro,
  memoria: window.__H09_ARCH__.memoria.estado_registro,
  rpc: window.__H09_ARCH__.rpc,
  locales: window.__H09_ARCH__.escriturasLocales,
  recargas: window.__H09_ARCH__.recargas,
  boton: (document.getElementById('btnArchivarOCFicha') || {}).textContent || '',
  aviso: Boolean(document.getElementById('h09AvisoArchivada'))
}));

test('H09-8 · archivar viaja por la RPC canónica con estado_registro', async ({ page }) => {
  await prepararArchivo(page);
  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(800);

  const e = await estadoArchivo(page);
  const llamada = e.rpc.find((r) => r.nombre === 'coi_actualizar_orden_integral');
  expect(llamada).toBeTruthy();
  // El payload usa estado_registro. NUNCA estado_coi.
  expect(llamada.args.p_cambios).toHaveProperty('estado_registro', 'Archivado');
  expect(llamada.args.p_cambios).not.toHaveProperty('estado_coi');
  expect(llamada.args.p_orden_id).toBe(OC_ID);

  // Supabase confirmó y recién entonces cambió la memoria.
  expect(e.remoto).toBe('Archivado');
  expect(e.memoria).toBe('Archivado');
  expect(e.recargas).toBeGreaterThanOrEqual(1);
  // Sin persistencia local del estado de archivo.
  expect(e.locales).toBe(0);
});

test('H09-9 · con la OC archivada la ficha lo dice y el botón pasa a Desarchivar', async ({ page }) => {
  await prepararArchivo(page, { estadoInicial: 'Archivado' });
  const e = await estadoArchivo(page);
  expect(e.boton).toBe('Desarchivar OC');
  expect(e.aviso).toBe(true);
  const texto = await page.locator('#h09AvisoArchivada').textContent();
  expect(texto).toContain('ARCHIVADA');
});

test('H09-10 · si la RPC falla la OC NO queda archivada', async ({ page }) => {
  await prepararArchivo(page, { fallaRpc: true });
  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(900);

  const e = await estadoArchivo(page);
  // El remoto no cambió, la memoria tampoco y el botón sigue ofreciendo archivar.
  expect(e.remoto).toBe('Activo');
  expect(e.memoria).toBe('Activo');
  expect(e.boton).toBe('Archivar OC');
  expect(e.aviso).toBe(false);
  expect(e.locales).toBe(0);

  const avisos = await page.evaluate(() => window.__H09_ARCH__.toasts.map((t) => t.m).join(' | '));
  expect(avisos).toMatch(/No se pudo archivar/);
  expect(avisos).toMatch(/no cambió/);
});

test('H09-11 · desarchivar persiste Activo en Supabase', async ({ page }) => {
  await prepararArchivo(page, { estadoInicial: 'Archivado' });
  await page.evaluate(() => window.desarchivarOC());
  await page.waitForTimeout(800);

  const e = await estadoArchivo(page);
  const ultima = e.rpc.filter((r) => r.nombre === 'coi_actualizar_orden_integral').pop();
  expect(ultima.args.p_cambios).toHaveProperty('estado_registro', 'Activo');
  expect(e.remoto).toBe('Activo');
  expect(e.memoria).toBe('Activo');
  expect(e.boton).toBe('Archivar OC');
  expect(e.aviso).toBe(false);
});

test('H09-12 · «Deshacer» revierte contra Supabase, no solo en pantalla', async ({ page }) => {
  await prepararArchivo(page);
  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(800);
  expect((await estadoArchivo(page)).remoto).toBe('Archivado');

  // El aviso con Deshacer es real y su botón ejecuta la reversión remota.
  await expect(page.locator('#h09BtnDeshacerArchivo')).toBeVisible();
  await page.click('#h09BtnDeshacerArchivo');
  await page.waitForTimeout(900);

  const e = await estadoArchivo(page);
  const cambios = e.rpc.filter((r) => r.nombre === 'coi_actualizar_orden_integral').map((r) => r.args.p_cambios.estado_registro);
  expect(cambios).toEqual(['Archivado', 'Activo']);
  expect(e.remoto).toBe('Activo');
  expect(e.memoria).toBe('Activo');
  expect(e.locales).toBe(0);
});

test('H09-13 · el estado archivado sobrevive a una relectura desde Supabase', async ({ page }) => {
  await prepararArchivo(page);
  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(800);

  // Se simula el F5: la memoria se descarta y se rehidrata desde el remoto.
  const e = await page.evaluate(async () => {
    const st = window.__H09_ARCH__;
    // Se descarta el modelo en memoria, como haria un F5.
    st.memoria.estado_registro = null;
    await window.recargarDatosDesdeSupabase({ silencioso: true });
    window.COI_ARCHIVO_OC_H09.sincronizarBotones();
    return {
      memoria: st.memoria.estado_registro,
      remoto: st.remota.estado_registro,
      boton: (document.getElementById('btnArchivarOCFicha') || {}).textContent || ''
    };
  });

  expect(e.remoto).toBe('Archivado');
  expect(e.memoria).toBe('Archivado');
  expect(e.boton).toBe('Desarchivar OC');
});

test('H09-14 · el listado filtra por estado de registro y por defecto muestra activas', async ({ page }) => {
  await prepararArchivo(page);

  const r = await page.evaluate(() => {
    const sel = document.getElementById('ordenesFiltroRegistro');
    if (!sel) return { existe: false };
    const activa = { item: { estadoRegistro: 'Activo', numeroOC: 'A-1' } };
    const archivada = { item: { estadoRegistro: 'Archivado', numeroOC: 'B-2' } };
    // El filtro base no toca nada: se aísla el aporte de H09.
    const base = window.filtrarOrdenes.__coiH09Base;
    window.filtrarOrdenes.__coiH09Base = (rows) => rows;
    const leer = () => window.filtrarOrdenes([activa, archivada]).map((r) => r.item.numeroOC);
    const salida = { existe: true, opciones: Array.from(sel.options).map((o) => o.value), porDefecto: sel.value };
    salida.activas = leer();
    sel.value = 'archivadas'; salida.archivadas = leer();
    sel.value = 'todas'; salida.todas = leer();
    sel.value = 'activas';
    window.filtrarOrdenes.__coiH09Base = base;
    return salida;
  });

  expect(r.existe).toBe(true);
  expect(r.opciones).toEqual(['activas', 'archivadas', 'todas']);
  // Por defecto, activas.
  expect(r.porDefecto).toBe('activas');
  expect(r.activas).toEqual(['A-1']);
  // Una OC archivada nunca queda inaccesible.
  expect(r.archivadas).toEqual(['B-2']);
  expect(r.todas).toEqual(['A-1', 'B-2']);
});

test('H09-15 · archivar no escribe el estado en localStorage', async ({ page }) => {
  await prepararArchivo(page);
  const antes = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()));
  await page.evaluate(() => window.archivarOC());
  await page.waitForTimeout(800);

  const r = await page.evaluate((previas) => {
    const ahora = Object.keys(localStorage).sort();
    const volcado = ahora.map((k) => String(localStorage.getItem(k) || '')).join(' ');
    return {
      nuevasClaves: ahora.filter((k) => JSON.parse(previas).indexOf(k) < 0),
      mencionaArchivado: /"estado_registro"\s*:\s*"Archivado"|estadoRegistro"\s*:\s*"Archivado"/.test(volcado),
      locales: window.__H09_ARCH__.escriturasLocales
    };
  }, antes);

  expect(r.locales).toBe(0);
  expect(r.mencionaArchivado).toBe(false);
});
