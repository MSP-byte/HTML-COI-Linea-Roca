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
  fecha_actualizacion: '2026-08-10T10:00:00.000Z',
  // La OC se referencia por UUID; nro_oc es el numero visible derivado.
  orden_id: '0c000000-0000-4000-8000-004530008964'
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
    ordenes: [], fallaSelectOC: false, fallaRol: false, fallaNormalizacion: false,
    rolTrasPrimeraVerificacion: undefined,
    // Compuerta para la lectura de coi_ordenes: con `true` la consulta queda
    // suspendida hasta que el test llame a window.__H05_ABRIR_OC__().
    frenarSelectOC: false,
    // Simula que otro administrador inserta filas entre pagina y pagina.
    // `true` = sin limite (escritura sostenida); un numero = esa cantidad de
    // inserciones en total, repartidas entre los reintentos.
    insertarEntrePaginas: false,
    // Por defecto el intruso entra POR DEBAJO del cursor, que es el caso que
    // el keyset por UUID no puede detectar solo.
    intrusoMayor: false,
    // En que tabla se dispara la insercion del «otro administrador»: mientras
    // se pagina UM o mientras se pagina ST. Sirve para poner el commit ajeno
    // ENTRE los dos scans del snapshot conjunto.
    intrusoDurante: 'um',
    // Que tablas toca ese commit: solo UM, solo ST, o las dos a la vez —una
    // transaccion operativa real: alta de UM con su primer ST—.
    intrusoDestino: 'um',
    // Email de la sesion. La autoridad es el rol, no el correo: sirve para
    // probar un administrador real con otro correo.
    email: 'admin@coiroca.com'
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
    // El evento real que emite la aplicacion lleva { event, session }. El fake
    // reproduce esa forma para que ninguna prueba pase por la razon
    // equivocada: en un SIGNED_IN la sesion VIENE, de modo que invalidar el rol
    // ahi tiene que salir del cambio de UID y no de una sesion ausente.
    window.__H05_SIGN_OUT__ = () => {
      sesionActiva = false;
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', {
        detail: { event: 'SIGNED_OUT', session: null }
      }));
    };
    window.__H05_CAMBIAR_SESION__ = (uid) => {
      uidSesion = uid;
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', {
        detail: { event: 'SIGNED_IN', session: { user: { id: uid, email: c.email } } }
      }));
    };

    const registrar = (op, payload) => window.__H05_LLAMADAS__.push({ op, payload });
    let ums = c.ums.slice();
    let sts = c.sts.slice();
    // Cuantas filas lleva insertadas el «otro administrador».
    let intrusas = 0;
    // Catalogo REMOTO de Ordenes: deliberadamente distinto de todasLasOC(),
    // que es la cache local del modulo.
    //
    // Cada orden tiene su UUID —la identidad maestra del proyecto—, derivado
    // del numero para que un test pueda predecirlo sin leerlo antes.
    const idOC = (n) => '0c000000-0000-4000-8000-' +
      String(n || '').replace(/\D/g, '').padStart(12, '0').slice(-12);
    window.__H05_ID_OC__ = idOC;
    const conId = (lista) => (lista || []).map((o) => Object.assign({ id: idOC(o.nro_oc) }, o));
    let ordenes = conId(c.ordenes);
    window.__H05_SET_ORDENES__ = (v) => { ordenes = conId(v); };
    window.__H05_SET_UMS__ = (v) => { ums = v.slice(); };
    window.__H05_SET_STS__ = (v) => { sts = v.slice(); };
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    // Compuerta de coi_ordenes. Se abre desde el test.
    let liberarOC = null;
    const esperarCompuertaOC = () => new Promise((r) => { liberarOC = r; });
    window.__H05_ABRIR_OC__ = () => { const r = liberarOC; liberarOC = null; if (r) r(); };
    window.__H05_OC_FRENADA__ = () => Boolean(liberarOC);
    const uuid = (n) => '99999999-9999-4999-8999-' + String(n).padStart(12, '0');

    function consulta(tabla) {
      // filtros acumula TODAS las condiciones; `filtro` se conserva como la
      // primera igualdad para no romper las aserciones que ya lo usan.
      const st = { tabla, filtro: null, filtros: [], patch: null, op: null, rango: null, limite: 0, conteo: false };
      const anotar = (op, col, val) => {
        st.filtros.push({ op, col, val });
        if (op === 'eq' && !st.filtro) st.filtro = { col, val };
      };
      const cumple = (fila) => st.filtros.every((f) => {
        if (f.op === 'is') return fila[f.col] === null || fila[f.col] === undefined;
        if (f.op === 'range') return true;
        if (f.op === 'gt') return String(fila[f.col]) > String(f.val);
        if (f.op === 'ilike') {
          return String(fila[f.col] == null ? '' : fila[f.col]).toUpperCase() ===
            String(f.val == null ? '' : f.val).toUpperCase();
        }
        return fila[f.col] === f.val;
      });
      const api = {
        // PostgREST devuelve el conteo exacto sin traer filas cuando se pide
        // { count: 'exact', head: true }.
        select(cols, opciones) { st.conteo = Boolean(opciones && opciones.head); return api; },
        order() { return api; },
        range(a, b) { st.rango = [a, b]; st.filtros.push({ op: 'range', col: null, val: [a, b] }); return api; },
        in() { return api; },
        limit(n) { st.limite = n; return api; },
        eq(col, val) { anotar('eq', col, val); return api; },
        ilike(col, val) { anotar('ilike', col, val); return api; },
        gt(col, val) { anotar('gt', col, val); return api; },
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
            // La compuerta suspende la validacion remota justo donde el
            // formulario queda esperando: es la ventana en la que el operador
            // puede abrir otro ST.
            if (window.__H05_CFG__.frenarSelectOC) await esperarCompuertaOC();
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

          if (st.conteo) {
            registrar('count:' + st.tabla, st.filtros);
            if (window.__H05_CFG__.fallaSelect) return { data: null, count: null, error: { message: 'fallo de red' } };
            if (!sesionActiva) return { data: null, count: null, error: { message: 'JWT ausente' } };
            let todas = leer();
            if (st.filtros.length) todas = todas.filter((f) => cumple(f));
            // El conteo no trae filas y no mueve el conjunto: solo mide.
            return { data: null, count: todas.length, error: null };
          }
          registrar('select:' + st.tabla, st.filtros);
          if (window.__H05_CFG__.retardoSelectMs) await espera(window.__H05_CFG__.retardoSelectMs);
          if (window.__H05_CFG__.fallaSelect) return { data: null, error: { message: 'fallo de red' } };
          if (!sesionActiva) return { data: null, error: { message: 'JWT ausente' } };
          // El paginado real ordena por id: el fake hace lo mismo para que el
          // cursor tenga sentido.
          let base = leer().slice().sort((x, y) => String(x.id).localeCompare(String(y.id)));
          if (st.filtros.length) base = base.filter((f) => cumple(f));
          const tomar = st.limite || window.__H05_CFG__.pageSize;
          const pagina = base.slice(0, Math.min(tomar, window.__H05_CFG__.pageSize));
          // Entre paginas, otro puesto inserta y edita. Con offset esto producia
          // saltos y repeticiones; con cursor por id no puede.
          const cupo = window.__H05_CFG__.insertarEntrePaginas;
          const quedan = cupo === true || (typeof cupo === 'number' && intrusas < cupo);
          const durante = window.__H05_CFG__.intrusoDurante || 'um';
          const destino = window.__H05_CFG__.intrusoDestino || 'um';
          const enMomento = (durante === 'um' && esUM) || (durante === 'st' && esST);
          if (quedan && enMomento && pagina.length) {
            intrusas++;
            // Por debajo del cursor el keyset no vuelve a pasar por esa fila:
            // es justo el caso que el conteo tiene que delatar.
            const prefijo = window.__H05_CFG__.intrusoMayor ? 'ffffff' : '000000';
            const idIntrusa = prefijo + intrusas + '0-0000-4000-8000-000000000000';
            if (destino === 'um' || destino === 'ambos') {
              const intruso = Object.assign({}, ums[0] || {}, {
                id: idIntrusa,
                codigo_um: 'INTRUSA-' + intrusas
              });
              ums = [intruso].concat(ums);
            }
            if (destino === 'st' || destino === 'ambos') {
              // El ST intruso cuelga de la UM intrusa: es la transaccion
              // operativa real —alta de UM con su primer ST—. Si el modelo
              // publicara el ST sin su UM lo marcaria como huerfano.
              const intrusoST = Object.assign({}, sts[0] || {}, {
                id: 'a' + prefijo.slice(1) + intrusas + '-0000-4000-8000-000000000000',
                nro_st: 'ST-INTRUSO-' + intrusas,
                unidad_id: destino === 'ambos' ? idIntrusa : ((ums[0] || {}).id || null)
              });
              sts = [intrusoST].concat(sts);
            }
          }
          return { data: pagina, error: null };
        },
        then(res, rej) { return api._run(false).then(res, rej); }
      };
      return api;
    }

    let verificacionesRol = 0;
    const fake = {
      from: (t) => consulta(t),
      // Misma funcion que usan las policies RESTRICTIVE. rol null representa un
      // usuario autenticado SIN perfil activo.
      rpc: async (nombre, args) => {
        registrar('rpc:' + nombre, args || null);
        if (nombre === 'coi_normalize_order_number') {
          if (c.fallaNormalizacion) {
            return { data: null, error: { message: 'fallo de red al normalizar el numero' } };
          }
          // Mismo criterio que la funcion SQL: se saca el prefijo de orden de
          // compra, se borra todo lo que no sea alfanumerico y se pasa a
          // mayusculas. Cadena vacia se devuelve como null, igual que el
          // nullif del original.
          const crudo = String((args && args.p_value) == null ? '' : args.p_value).trim();
          const sinPrefijo = crudo.replace(
            /^(O(RDEN)?\s*(DE\s*)?C(OMPRA)?|OC)\s*[:#-]?\s*/i, '');
          const canonico = sinPrefijo.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          return { data: canonico || null, error: null };
        }
        if (nombre !== 'coi_current_role') return { data: null, error: null };
        if (!sesionActiva) return { data: null, error: null };
        if (c.fallaRol) return { data: null, error: { message: 'fallo de red al leer el perfil' } };
        verificacionesRol++;
        const rolActual = verificacionesRol > 1 && c.rolTrasPrimeraVerificacion !== undefined
? c.rolTrasPrimeraVerificacion
: c.rol;
        return { data: rolActual === null ? null : rolActual, error: null };
      },
      auth: {
        getSession: async () => ({
          data: { session: sesionActiva ? { user: { id: uidSesion, email: c.email } } : null },
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
// La autoridad de la UI pasa a ser el rol que confirmo Supabase, no el helper
// legado. Se fija el rol del runtime y ademas el helper viejo, para que ninguna
// prueba pueda pasar por la razon equivocada: si la capa volviera a mirar el
// helper, los casos que exigen «sin permisos» seguirian detectandolo.
async function fijarAdmin(page, valor) {
  await page.evaluate((v) => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => v;
    if (window.__COI_UM_H05__) window.__COI_UM_H05__.rol = v ? 'administrador' : 'consulta';
  }, valor);
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
  rol: window.__COI_UM_H05__.rol,
  sincronizado: window.__COI_UM_H05__.sincronizado,
  ultimoError: window.__COI_UM_H05__.ultimoError,
  ums: (window.unidadesMantenimiento || []).map((u) => ({
    codigo: u.codigoUM, uuid: u._supabaseId, estado: u.estado, tipo: u.tipoUM, estacion: u.estacion
  })),
  sts: (window.serviciosTecnicos || []).map((s) => ({
    uuid: s._supabaseId, nroST: s.nroST, unidadId: s._unidadId, estado: s.estado,
    oc: s.nroOC, ordenId: s.ordenId, um: s.idUM
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

// ================================== quinta ronda de review del PR #59

// La prevalidacion usa la MISMA identidad que PostgreSQL: le pregunta a la base
// cual es el numero canonico y recien despues busca la orden.

test('105 · una variante con prefijo y puntuacion se acepta y persiste el canonico', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  // El catalogo en memoria queda vacio: la autoridad es la base.
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-CANON-1');
  await page.fill('#sth5_oc', 'OC 4530-00.89/64');
  await page.fill('#sth5_descripcion', 'Variante con prefijo y puntuacion');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  // Se le pregunto a la base por el numero canonico.
  expect(soloOp(e, 'rpc:coi_normalize_order_number').length).toBeGreaterThan(0);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  // Y persiste el nro_oc remoto vigente, no lo que tecleo el operador.
  expect(inserts[0].payload.nro_oc).toBe('4530008964');
});

test('106 · varias variantes equivalentes resuelven a la misma OC', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);

  const variantes = ['4530-008964', '4530.008964', 'oc 4530008964'];
  for (let i = 0; i < variantes.length; i++) {
    await page.selectOption('#sth5_um', UM_A.id);
    await page.fill('#sth5_nro', 'ST-CANON-' + (i + 10));
    await page.fill('#sth5_oc', variantes[i]);
    await page.fill('#sth5_descripcion', 'Variante ' + variantes[i]);
    await page.click('#btnGuardarSTH05');
    await page.waitForTimeout(900);
  }

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(3);
  for (const ins of inserts) expect(ins.payload.nro_oc).toBe('4530008964');
});

test('107 · una OC inexistente se rechaza aunque normalice bien', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-CANON-NO');
  await page.fill('#sth5_oc', 'OC 4530-99.99/99');
  await page.fill('#sth5_descripcion', 'OC que no existe');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  await expect(page.locator('#coiToastV581')).toContainText('no existe en Órdenes');
});

test('108 · si la normalizacion remota falla no se guarda nada', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }], fallaNormalizacion: true
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964'], { soloCache: true });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-CANON-FALLA');
  await page.fill('#sth5_oc', '4530008964');
  await page.fill('#sth5_descripcion', 'La normalizacion no responde');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  // Fail-closed: ni INSERT ni UPDATE.
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
  await expect(page.locator('#coiToastV581')).toContainText('No se pudo verificar la OC');
});

test('109 · editar la descripcion con la OC sin tocar no consulta la normalizacion', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }], fallaNormalizacion: true
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_descripcion', 'Editada sin tocar la OC');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  // Sigue permitido aunque la normalizacion este caida: no hay nada que validar.
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.descripcion).toBe('Editada sin tocar la OC');
  expect(Object.prototype.hasOwnProperty.call(updates[0].payload.patch, 'nro_oc')).toBe(false);
  expect(soloOp(e, 'rpc:coi_normalize_order_number')).toHaveLength(0);
  // Y la asociacion persistida no cambio.
  expect(e.sts[0].oc).toBe(ST_A.nro_oc);
});

test('110 · cambiar la OC de un ST existente resuelve por la identidad canonica', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }, { nro_oc: '4530003333' }]
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_oc', 'OC 4530-00.33/33');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.nro_oc).toBe('4530003333');
});

// ==================================== sexta ronda de review del PR #59

// --- F1: el catalogo local nunca es autoridad negativa.

test('111 · una OC ausente del catalogo local pero presente en Supabase se acepta', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530007777' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  // Catalogo POBLADO pero sin la OC: antes eso bastaba para rechazar.
  await sembrarOC(page, ['4530001111', '4530002222'], { soloCache: true });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-HINT-1');
  await page.fill('#sth5_oc', '4530007777');
  await page.fill('#sth5_descripcion', 'OC recien creada en otro puesto');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.nro_oc).toBe('4530007777');
});

test('112 · una OC que solo vive en el catalogo local se rechaza', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530009999'], { soloCache: true });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-HINT-2');
  await page.fill('#sth5_oc', '4530009999');
  await page.fill('#sth5_descripcion', 'Dato viejo de la cache');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  await expect(page.locator('#coiToastV581')).toContainText('no existe en Órdenes');
});

test('113 · una variante canonica se acepta con el catalogo local poblado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  // El catalogo compara por texto: «OC 4530008964» no figura literalmente.
  await sembrarOC(page, ['4530008964'], { soloCache: true });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-HINT-3');
  await page.fill('#sth5_oc', 'OC 4530-00.89/64');
  await page.fill('#sth5_descripcion', 'Variante canonica valida');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const inserts = soloOp(await estado(page), 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.nro_oc).toBe('4530008964');
});

test('114 · con el catalogo poblado, un fallo remoto sigue sin guardar', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }], fallaSelectOC: true
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964'], { soloCache: true });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-HINT-4');
  await page.fill('#sth5_oc', '4530008964');
  await page.fill('#sth5_descripcion', 'El remoto no responde');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(soloOp(e, 'update:coi_servicios_tecnicos_um')).toHaveLength(0);
  await expect(page.locator('#coiToastV581')).toContainText('No se pudo verificar la OC');
});

// --- F2: la OC original es la RENDERIZADA, no la del runtime.

test('115 · una renumeracion remota no convierte una edicion de descripcion en cambio de OC', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }]
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  // Los inputs muestran la OC A.
  await expect(page.locator('#stfh5_oc')).toHaveValue('4530008964');
  await page.focus('#stfh5_descripcion');

  // El servidor renumera A -> B y el runtime lo absorbe, pero el formulario
  // sigue enfocado y no se repinta.
  await page.evaluate((id) => {
    window.__H05_SET_ORDENES__([{ nro_oc: '4530555555' }]);
    window.__H05_SET_STS__([Object.assign({}, window.__H05_CFG__.sts[0], {
      id: id, nro_oc: '4530555555'
    })]);
  }, ST_A.id);
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(900);

  // El runtime ya tiene B; los inputs siguen en A.
  const runtimeOC = await page.evaluate(() => window.__COI_UM_H05__.confirmadoST[0].nroOC);
  expect(runtimeOC).toBe('4530555555');
  await expect(page.locator('#stfh5_oc')).toHaveValue('4530008964');

  await page.fill('#stfh5_descripcion', 'Solo cambia la descripcion');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.descripcion).toBe('Solo cambia la descripcion');
  // La OC no viaja: para el formulario no cambio.
  expect(Object.prototype.hasOwnProperty.call(updates[0].payload.patch, 'nro_oc')).toBe(false);
  // No se intento validar el numero viejo.
  const busquedas = soloOp(e, 'select:coi_ordenes')
    .filter((l) => (l.payload || []).some((f) => f.col === 'nro_oc'));
  expect(busquedas).toHaveLength(0);
  // Y la renumeracion remota sobrevive.
  expect(e.sts[0].oc).toBe('4530555555');
});

test('116 · si el formulario se repinta, el token de OC pasa a ser la nueva', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }]
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  // Sin foco dentro, el refresco SI repinta y el token se actualiza.
  await page.evaluate((id) => {
    window.__H05_SET_ORDENES__([{ nro_oc: '4530666666' }]);
    window.__H05_SET_STS__([Object.assign({}, window.__H05_CFG__.sts[0], {
      id: id, nro_oc: '4530666666'
    })]);
    document.activeElement && document.activeElement.blur();
  }, ST_A.id);
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(1000);

  await expect(page.locator('#stfh5_oc')).toHaveValue('4530666666');

  await page.fill('#stfh5_descripcion', 'Editada tras el repintado');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  // Tampoco viaja: para el formulario repintado, la OC sigue sin cambiar.
  expect(Object.prototype.hasOwnProperty.call(updates[0].payload.patch, 'nro_oc')).toBe(false);
  expect(e.sts[0].oc).toBe('4530666666');
});

// --- F3: el paginado va por keyset sobre el uuid.

test('117 · el paginado usa cursor por id, no offset sobre campos editables', async ({ page }) => {
  const muchas = Array.from({ length: 7 }, (_, i) => Object.assign({}, UM_A, {
    id: '6666666' + i + '-6666-4666-8666-666666666666',
    codigo_um: 'KEY-' + String(i).padStart(3, '0')
  }));
  await prepararEntorno(page, { ums: muchas, sts: [], pageSize: 3 });
  await abrir(page);

  const e = await estado(page);
  expect(e.ums).toHaveLength(7);
  expect(new Set(e.ums.map((u) => u.uuid)).size).toBe(7);
  // Cada pagina posterior a la primera lleva el cursor por id.
  const lecturas = soloOp(e, 'select:coi_unidades_mantenimiento');
  expect(lecturas.length).toBeGreaterThan(2);
  const conCursor = lecturas.filter((l) => (l.payload || []).some((f) => f.col === 'id' && f.op === 'gt'));
  expect(conCursor.length).toBeGreaterThan(0);
  // Y ninguna usa offset.
  expect(lecturas.every((l) => !(l.payload || []).some((f) => f.op === 'range'))).toBe(true);
});

test('118 · insertar filas entre paginas no pierde ni duplica ninguna', async ({ page }) => {
  // Diez UM con ids ordenables; el fake devuelve de a 3.
  const base = Array.from({ length: 10 }, (_, i) => Object.assign({}, UM_A, {
    id: '7777777' + i + '-7777-4777-8777-777777777777',
    codigo_um: 'PAG-' + String(i).padStart(3, '0')
  }));
  await prepararEntorno(page, { ums: base, sts: [], pageSize: 3, insertarEntrePaginas: 1 });
  await abrir(page);

  const e = await estado(page);
  // Las 10 originales siguen estando, sin repetidos, pese a que el fake inserta
  // una fila entre pagina y pagina: el scan se descarta y se reinicia.
  const codigos = e.ums.map((u) => u.codigo);
  for (const u of base) expect(codigos).toContain(u.codigo_um);
  expect(new Set(e.ums.map((u) => u.uuid)).size).toBe(e.ums.length);
  expect(e.sincronizado).toBe(true);
});

// --- F4: la autoridad de la UI es el rol confirmado por Supabase.

test('119 · un administrador con otro email tiene los controles habilitados', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], rol: 'administrador', admin: false });
  await abrir(page);
  // El helper legado dice NO y el email no es el conocido: da igual, manda el rol.
  await page.evaluate(() => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => false;
  });
  await irAUM(page);

  const e = await estado(page);
  expect(e.rol).toBe('administrador');
  await expect(page.locator('#btnGuardarUMH05')).toBeEnabled();
  await expect(page.locator('#umh5_codigo')).toBeEnabled();
});

test('120 · el email conocido con rol consulta NO habilita controles', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], rol: 'consulta', admin: true });
  await abrir(page);
  // El helper legado dice SI —es admin@coiroca.com—, pero el rol real es consulta.
  await page.evaluate(() => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
  });
  await irAUM(page);

  const e = await estado(page);
  expect(e.rol).toBe('consulta');
  // Lectura si.
  expect(e.sincronizado).toBe(true);
  expect(e.ums).toHaveLength(1);
  // Mutaciones no.
  await expect(page.locator('#btnGuardarUMH05')).toBeDisabled();
  await expect(page.locator('#umh5_codigo')).toBeDisabled();
  await expect(page.locator('#umFormMsgH05')).toContainText('Ingrese como Administrador');
});

test('121 · sin rol confirmado no hay mutaciones ni sincronizacion', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], rol: null, admin: true });
  await abrir(page);
  await page.evaluate(() => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
  });
  await irAUM(page);

  const e = await estado(page);
  expect(e.sincronizado).toBe(false);
  expect(e.ums).toHaveLength(0);
  await expect(page.locator('#btnGuardarUMH05')).toBeDisabled();
});

test('122 · el administrador conserva el flujo normal de alta', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [], rol: 'administrador', admin: false });
  await abrir(page);
  await page.evaluate(() => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => false;
  });
  await irAUM(page);

  await page.fill('#umh5_codigo', 'ASC-ROL');
  await page.selectOption('#umh5_tipo', 'Ascensor');
  await page.selectOption('#umh5_estacion', { index: 1 });
  await page.click('#btnGuardarUMH05');
  await page.waitForTimeout(1100);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_unidades_mantenimiento')).toHaveLength(1);
  expect(e.ums.map((u) => u.codigo)).toContain('ASC-ROL');
});

// ================================== septima ronda de review del PR #59

// --- F1 (P1): la identidad tecnica de la OC es coi_ordenes.id.
//
// nro_oc es un identificador de NEGOCIO renumerable. Mientras la relacion
// colgaba de el, renumerar una OC movia el vinculo. Ahora el ST guarda el UUID
// —que no cambia nunca— y el numero queda como dato visible derivado.

const OC_UUID = (n) => '0c000000-0000-4000-8000-' +
  String(n).replace(/\D/g, '').padStart(12, '0').slice(-12);

test('123 · un ST nuevo con OC valida persiste el UUID de la orden y el numero canonico', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-UUID-1');
  await page.fill('#sth5_oc', '4530008964');
  await page.fill('#sth5_descripcion', 'Alta con OC valida');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.orden_id).toBe(OC_UUID('4530008964'));
  expect(inserts[0].payload.nro_oc).toBe('4530008964');
});

test('124 · la variante «OC 4530008964» resuelve al mismo UUID', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  await page.evaluate(() => { window.todasLasOC = () => []; });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-UUID-2');
  await page.fill('#sth5_oc', 'OC 4530008964');
  await page.fill('#sth5_descripcion', 'Alta con variante');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  // La identidad no depende de como se escriba el numero.
  expect(inserts[0].payload.orden_id).toBe(OC_UUID('4530008964'));
  expect(inserts[0].payload.nro_oc).toBe('4530008964');
});

test('125 · una OC inexistente no persiste ni el numero ni la identidad', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  // La cache local la ofrece; el remoto no la tiene: manda el remoto.
  await sembrarOC(page, ['4530999999'], { soloCache: true });
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-UUID-3');
  await page.fill('#sth5_oc', '4530999999');
  await page.fill('#sth5_descripcion', 'OC que no existe');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(e.sts).toHaveLength(0);
});

test('126 · un ST sin OC se guarda con identidad y numero en null', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], ordenes: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);

  await page.selectOption('#sth5_um', UM_A.id);
  await page.fill('#sth5_nro', 'ST-SIN-OC');
  await page.fill('#sth5_descripcion', 'Sin orden asociada');
  await page.click('#btnGuardarSTH05');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const inserts = soloOp(e, 'insert:coi_servicios_tecnicos_um');
  expect(inserts).toHaveLength(1);
  expect(inserts[0].payload.orden_id).toBeNull();
  expect(inserts[0].payload.nro_oc).toBeNull();
});

test('127 · editar sin tocar la OC no reenvia ni el numero ni la identidad', async ({ page }) => {
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
  // Omitir los dos deja intacta la referencia ya persistida, que es la correcta
  // precisamente porque renumerar la OC no cambia su UUID.
  expect(Object.prototype.hasOwnProperty.call(updates[0].payload.patch, 'nro_oc')).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(updates[0].payload.patch, 'orden_id')).toBe(false);
});

test('128 · cambiar de OC mueve la identidad tecnica, no solo el numero', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }, { nro_oc: '4530003333' }]
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964', '4530003333']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_oc', '4530-00.33/33');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1300);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.orden_id).toBe(OC_UUID('4530003333'));
  expect(updates[0].payload.patch.nro_oc).toBe('4530003333');
});

test('129 · quitar la OC envia los dos campos explicitamente en null', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  await page.fill('#stfh5_oc', '');
  await page.click('[data-h05-guardar-st-ficha]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  // Omitirlos aca dejaria la asociacion vieja para siempre.
  expect(updates[0].payload.patch.orden_id).toBeNull();
  expect(updates[0].payload.patch.nro_oc).toBeNull();
});

test('130 · el modelo en memoria conserva el UUID de la OC leido de Supabase', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A], ordenes: [{ nro_oc: '4530008964' }] });
  await abrir(page);
  const e = await estado(page);
  expect(e.sts).toHaveLength(1);
  expect(e.sts[0].ordenId).toBe(ST_A.orden_id);
  expect(e.sts[0].oc).toBe('4530008964');
});

// --- F2 (P2): cancelar un ST usa la version que el operador vio.
//
// La tabla puede estar mostrando la V1 mientras un input mantiene la ficha sin
// repintar y un refresco lleva el runtime a V2. El boton Cancelar sigue
// perteneciendo visualmente a la V1: si el CAS tomara la version del runtime,
// la cancelacion pisaria un cambio que el operador nunca vio.

test('131 · el boton Cancelar lleva la version con la que se pinto la fila', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);

  const version = await page.getAttribute('[data-h05-cancelar-st="' + ST_A.id + '"]', 'data-h05-st-version');
  expect(version).toBe(ST_A.fecha_actualizacion);
});

test('132 · cancelar usa la version renderizada y el CAS rechaza si el remoto avanzo', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964']);
  await irAUM(page);
  // Se abre la edicion para tener un input que sostenga la ficha sin repintar.
  await editarSTEnFicha(page, ST_A.id);
  await page.focus('#stfh5_descripcion');

  // Otro puesto resuelve el ST: el runtime pasa a V2, la ficha sigue en V1.
  await page.evaluate((id) => {
    window.__H05_SET_STS__([Object.assign({}, window.__H05_CFG__.sts[0], {
      id: id, estado: 'Resuelto', fecha_actualizacion: '2026-08-31T23:59:59.000Z'
    })]);
  }, ST_A.id);
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(800);

  const versionRuntime = await page.evaluate(
    () => window.__COI_UM_H05__.confirmadoST[0].fechaActualizacion);
  expect(versionRuntime).toBe('2026-08-31T23:59:59.000Z');
  // El boton visible sigue siendo el de la V1.
  const versionBoton = await page.getAttribute('[data-h05-cancelar-st="' + ST_A.id + '"]', 'data-h05-st-version');
  expect(versionBoton).toBe(ST_A.fecha_actualizacion);

  page.on('dialog', (d) => d.accept());
  await page.click('[data-h05-cancelar-st="' + ST_A.id + '"]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  expect(updates[0].payload.patch.estado).toBe('Cancelado');
  // El CAS viaja con la version RENDERIZADA, no con la del runtime.
  const cond = updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion');
  expect(cond.val).toBe(ST_A.fecha_actualizacion);
  // Y como el remoto avanzo, no se cancelo nada: sigue Resuelto en V2.
  const remoto = await page.evaluate(() => window.__COI_UM_H05__.confirmadoST[0]);
  expect(remoto.estado).toBe('Resuelto');
  expect(remoto.fechaActualizacion).toBe('2026-08-31T23:59:59.000Z');
  await expect(page.locator('#coiToastV581')).toContainText('modificado por otro usuario');
});

test('133 · sin conflicto, cancelar con la version renderizada se aplica', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [ST_A] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);

  page.on('dialog', (d) => d.accept());
  await page.click('[data-h05-cancelar-st="' + ST_A.id + '"]');
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  const cond = updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion');
  expect(cond.val).toBe(ST_A.fecha_actualizacion);
  expect(e.sts[0].estado).toBe('Cancelado');
});

// --- F3 (P2): un estado de UM desconocido no puede verse verde.
//
// estadoUM() conserva el valor remoto que no reconoce —es dato del servidor—,
// pero pintarlo con la clase «activo» afirmaba que la unidad esta operativa.

const UM_ESTADO = (sufijo, estado) => Object.assign({}, UM_A, {
  id: '77777777-7777-4777-8777-' + String(sufijo).padStart(12, '0'),
  codigo_um: 'ASC-EST-' + sufijo,
  estado: estado
});

const badges = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('#umTbody .um-status')
).map((n) => ({ clase: n.className, texto: n.textContent })));

test('134 · el semaforo de UM: ACTIVA verde, y cualquier estado desconocido neutro', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [
      UM_ESTADO(1, 'ACTIVA'),
      UM_ESTADO(2, 'FUERA DE SERVICIO'),
      UM_ESTADO(3, 'BAJA'),
      UM_ESTADO(4, 'Mantenimiento'),
      UM_ESTADO(5, 'Reparación programada')
    ],
    sts: []
  });
  await abrir(page);
  await irAUM(page);

  const pintados = await badges(page);
  expect(pintados).toHaveLength(5);
  const porTexto = {};
  pintados.forEach((b) => { porTexto[b.texto] = b.clase; });

  expect(porTexto['ACTIVA']).toContain('activo');
  expect(porTexto['FUERA DE SERVICIO']).toContain('fuera');
  expect(porTexto['FUERA DE SERVICIO']).not.toContain('activo');
  expect(porTexto['BAJA']).toContain('baja');
  expect(porTexto['BAJA']).not.toContain('activo');

  // El texto remoto se conserva; lo unico neutro es el estilo.
  expect(porTexto['Mantenimiento']).toContain('sindatos');
  expect(porTexto['Mantenimiento']).not.toContain('activo');
  expect(porTexto['Reparación programada']).toContain('sindatos');
  expect(porTexto['Reparación programada']).not.toContain('activo');
});

test('135 · el estado desconocido tampoco se ve verde en la ficha', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTADO(6, 'Mantenimiento')], sts: [] });
  await abrir(page);
  await irAUM(page);
  await abrirFichaPrimeraUM(page);

  const enFicha = await page.evaluate(() => Array.from(
    document.querySelectorAll('#fichaUMBody .um-status')
  ).map((n) => ({ clase: n.className, texto: n.textContent })));
  expect(enFicha.length).toBeGreaterThan(0);
  enFicha.forEach((b) => {
    expect(b.texto).toBe('Mantenimiento');
    expect(b.clase).toContain('sindatos');
    expect(b.clase).not.toContain('activo');
  });
});

// --- El listado de UM sigue siendo de la capa H05 despues del primer pintado.
//
// La capa legada V58.1R9 repinta #umTbody desde temporizadores propios
// (900/2400/5200 ms) y desde sus listeners de input/change, llamando a
// renderUMFinal() por su nombre lexico dentro de un IIFE cerrado: sustituir
// window.renderUnidadesMantenimiento no lo alcanza. Ese repintado deriva la
// clase del estado a partir del TEXTO, con lo que «Mantenimiento» vuelve a
// verse amarillo y «Reparación programada» directamente verde.
//
// El caso 134 fallaba de forma intermitente por esto: en un runner lento el
// repintado legado caia dentro de la ventana de medicion. Aca no se espera a
// ningun temporizador: se reproduce el repintado a mano y se exige que la capa
// autoritativa recupere la tabla.

const REPINTADO_LEGADO = (ums) => ums.map((u) =>
  '<tr class="row-clickable" data-open-um="' + u.codigo_um + '">' +
  '<td><b>' + u.codigo_um + '</b></td><td>' + u.tipo_um + '</td>' +
  '<td>' + u.estacion + '</td><td>—</td><td>—</td>' +
  '<td><span class="um-status ' +
  (String(u.estado).toUpperCase().indexOf('MANT') >= 0 ? 'mantenimiento' : 'activo') +
  '">' + u.estado + '</span></td>' +
  '<td>—</td><td>—</td><td>—</td>' +
  '<td><button type="button" class="btn-open-um" data-open-um="' + u.codigo_um + '">Ver ficha UM</button></td>' +
  '</tr>'
).join('');

test('136 · un repintado legado de la tabla de UM no reinterpreta el estado', async ({ page }) => {
  const ums = [
    UM_ESTADO(1, 'ACTIVA'),
    UM_ESTADO(4, 'Mantenimiento'),
    UM_ESTADO(5, 'Reparación programada')
  ];
  await prepararEntorno(page, { ums: ums, sts: [] });
  await abrir(page);
  await irAUM(page);

  // Estado de partida: lo pinta la capa autoritativa.
  const antes = await badges(page);
  expect(antes.find((b) => b.texto === 'Mantenimiento').clase).toContain('sindatos');

  // La capa legada pisa la tabla, exactamente como lo hace renderUMFinal().
  await page.evaluate((html) => {
    document.getElementById('umTbody').innerHTML = html;
  }, REPINTADO_LEGADO(ums));
  await page.waitForTimeout(300);

  // La capa autoritativa recupero la tabla: filas propias y semaforo correcto.
  const despues = await badges(page);
  expect(despues).toHaveLength(3);
  const porTexto = {};
  despues.forEach((b) => { porTexto[b.texto] = b.clase; });
  expect(porTexto['ACTIVA']).toContain('activo');
  expect(porTexto['Mantenimiento']).toContain('sindatos');
  expect(porTexto['Mantenimiento']).not.toContain('mantenimiento');
  expect(porTexto['Reparación programada']).toContain('sindatos');
  expect(porTexto['Reparación programada']).not.toContain('activo');

  // Y las filas volvieron a tener los enganches de esta capa.
  const enganches = await page.evaluate(() => ({
    h05: document.querySelectorAll('#umTbody [data-h05-open-um]').length,
    legadas: document.querySelectorAll('#umTbody [data-open-um]:not([data-h05-open-um])').length
  }));
  expect(enganches.h05).toBeGreaterThan(0);
  expect(enganches.legadas).toBe(0);
});

test('137 · la vigilancia no se dispara sola ni pierde el estado sin UM', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [] });
  await abrir(page);
  await irAUM(page);
  await page.waitForTimeout(600);

  // Sin UM la tabla queda con su mensaje, que no trae data-open-um: la
  // vigilancia no puede confundirlo con un repintado ajeno y entrar en bucle.
  await expect(page.locator('#umTbody')).toContainText('No hay Unidades de Mantenimiento cargadas en Supabase');
  const e = await estado(page);
  expect(e.ums).toHaveLength(0);
  expect(e.escriturasLegacy).toEqual([]);
});

// ================================== octava ronda de review del PR #59

// --- El paginado keyset cierra el snapshot, no solo lo ordena.
//
// `id` es un gen_random_uuid(): una fila insertada por otro puesto mientras
// dura el recorrido puede caer POR DEBAJO del cursor y quedar afuera sin que
// nada lo delate. El scan se acota entre dos conteos exactos del servidor; si
// no coinciden, se descarta entero y se reinicia.

// Filas suficientes para que el recorrido use mas de una pagina con el
// PAGE_SIZE real de la capa (1000). Los id arrancan en «1» para que el intruso
// «0…» quede por debajo del cursor y «f…» por encima.
const MUCHAS_UM = (n) => Array.from({ length: n }, (_, i) => Object.assign({}, UM_A, {
  id: '1' + String(i).padStart(7, '0') + '-1111-4111-8111-111111111111',
  codigo_um: 'MASIVA-' + String(i).padStart(4, '0')
}));

// Solo lo necesario: devolver 1000+ filas por evaluate encarece el test sin
// aportar nada.
const resumen = (page) => page.evaluate(() => ({
  sincronizado: window.__COI_UM_H05__.sincronizado,
  ultimoError: window.__COI_UM_H05__.ultimoError,
  total: (window.unidadesMantenimiento || []).length,
  unicos: new Set((window.unidadesMantenimiento || []).map((u) => u._supabaseId)).size,
  intrusas: (window.unidadesMantenimiento || []).filter((u) => String(u.codigoUM).indexOf('INTRUSA-') === 0).length,
  conteos: window.__H05_LLAMADAS__.filter((l) => l.op === 'count:coi_unidades_mantenimiento').length,
  paginas: window.__H05_LLAMADAS__.filter((l) => l.op === 'select:coi_unidades_mantenimiento').length
}));

test('138 · A · un insert con UUID por debajo del cursor obliga a releer entero', async ({ page }) => {
  const base = MUCHAS_UM(1001);
  await prepararEntorno(page, { ums: base, sts: [], insertarEntrePaginas: 1 });
  await abrir(page);

  const r = await resumen(page);
  // El primer scan quedo corto —la intrusa cayo por debajo del cursor— y se
  // reinicio: hubo mas de un par de conteos.
  expect(r.conteos).toBeGreaterThan(2);
  // Y el resultado final las tiene todas: las 1001 originales y la intrusa.
  expect(r.total).toBe(1002);
  expect(r.unicos).toBe(1002);
  expect(r.intrusas).toBe(1);
  expect(r.sincronizado).toBe(true);
});

test('139 · B · un insert con UUID por encima del cursor termina completo y sin duplicados', async ({ page }) => {
  const base = MUCHAS_UM(1001);
  await prepararEntorno(page, {
    ums: base, sts: [], insertarEntrePaginas: 1, intrusoMayor: true
  });
  await abrir(page);

  const r = await resumen(page);
  expect(r.total).toBe(1002);
  expect(r.unicos).toBe(1002);
  expect(r.intrusas).toBe(1);
  expect(r.sincronizado).toBe(true);
});

test('140 · C · con escritura sostenida no se publica un snapshot parcial', async ({ page }) => {
  await prepararEntorno(page, {
    ums: MUCHAS_UM(1001), sts: [], insertarEntrePaginas: true
  });
  await abrir(page);

  const r = await resumen(page);
  // El conjunto nunca se estabiliza: no se acepta un modelo incompleto.
  expect(r.sincronizado).toBe(false);
  expect(r.ultimoError).toMatch(/cambió durante la lectura/i);
  // No hubo primer confirmado, de modo que no se publica nada.
  expect(r.total).toBe(0);
  // Y se reintento un numero acotado de veces, no indefinidamente.
  expect(r.conteos).toBe(6);
});

test('141 · C · una lectura previa confirmada se conserva ante escritura sostenida', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [] });
  await abrir(page);
  expect((await resumen(page)).total).toBe(2);

  // Ahora el remoto entra en escritura sostenida.
  await page.evaluate(() => { window.__H05_CFG__.insertarEntrePaginas = true; });
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(900);

  const r = await resumen(page);
  expect(r.sincronizado).toBe(false);
  // Se conserva el ultimo remoto confirmado: ni cero, ni un listado a medias.
  expect(r.total).toBe(2);
  expect(r.intrusas).toBe(0);
});

test('142 · D · sin concurrencia el scan es una sola pasada', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [ST_A] });
  await abrir(page);

  const r = await resumen(page);
  expect(r.sincronizado).toBe(true);
  expect(r.total).toBe(2);
  // Un conteo antes y otro despues: una unica pasada.
  expect(r.conteos).toBe(2);
  const e = await estado(page);
  // El cursor sigue siendo por id y no aparece ningun offset.
  const lecturas = soloOp(e, 'select:coi_unidades_mantenimiento');
  expect(lecturas.every((l) => !(l.payload || []).some((f) => f.op === 'range'))).toBe(true);
});

test('143 · E · el remoto vacio sigue siendo un estado valido y sincronizado', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [] });
  await abrir(page);

  const r = await resumen(page);
  expect(r.sincronizado).toBe(true);
  expect(r.ultimoError).toBeNull();
  expect(r.total).toBe(0);
  expect(r.conteos).toBe(2);
});

// ================================== octava ronda de review del PR #59

// --- P1: el rol cacheado es fail-closed.
//
// `runtime.rol` es una CACHE de lo que dijo coi_current_role(). Mientras
// cualquier camino que no confirmaba el rol lo dejaba intacto, la UI podia
// seguir mostrando controles de administrador despues de que Supabase ya lo
// hubiera revocado: sin sesion, con el RPC en error, con el perfil desactivado
// o borrado, o con otro usuario en la sesion. Ahora todo camino que no termina
// en un rol confirmado deja `runtime.rol` en null.

test('144 · A · un administrador confirmado por el servidor habilita los controles', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], rol: 'administrador', admin: false });
  await abrir(page);
  await irAUM(page);

  const e = await estado(page);
  expect(e.rol).toBe('administrador');
  expect(e.sincronizado).toBe(true);
  await expect(page.locator('#btnGuardarUMH05')).toBeEnabled();
});

test('145 · B · si el perfil desaparece el rol cacheado se apaga y los controles se bloquean', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], rol: 'administrador', admin: true });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).rol).toBe('administrador');

  // Otro administrador desactiva el perfil: coi_current_role() pasa a NULL.
  await page.evaluate(() => { window.__H05_CFG__.rol = null; });
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(900);
  await irAUM(page);

  const e = await estado(page);
  expect(e.rol).toBeNull();
  expect(e.sincronizado).toBe(false);
  await expect(page.locator('#btnGuardarUMH05')).toBeDisabled();
});

test('146 · C · si coi_current_role falla el rol se invalida y no queda cacheado', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], rol: 'administrador', admin: true });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).rol).toBe('administrador');

  // La comprobacion no se pudo hacer. Fail-closed: no se conserva el rol.
  await page.evaluate(() => { window.__H05_CFG__.fallaRol = true; });
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(900);
  await irAUM(page);

  const e = await estado(page);
  expect(e.rol).toBeNull();
  expect(e.sincronizado).toBe(false);
  expect(e.ultimoError).toMatch(/no se pudo verificar el perfil/i);
  await expect(page.locator('#btnGuardarUMH05')).toBeDisabled();
});

test('147 · D · el usuario B no hereda el rol administrador del usuario A', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], rol: 'administrador', admin: true });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).rol).toBe('administrador');

  // Entra otro operador, sin perfil habilitado. El evento trae sesion: lo que
  // invalida el rol es el cambio de UID, no una sesion ausente.
  await page.evaluate(() => {
    window.__H05_CFG__.rol = null;
    window.__H05_CAMBIAR_SESION__('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });
  await page.waitForTimeout(1200);
  await irAUM(page);

  const e = await estado(page);
  expect(e.rol).toBeNull();
  expect(e.ums).toHaveLength(0);
  await expect(page.locator('#btnGuardarUMH05')).toBeDisabled();
});

test('148 · E · el rol consulta lee pero no puede escribir', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [ST_A], rol: 'consulta', admin: true });
  await abrir(page);
  await irAUM(page);

  const e = await estado(page);
  // Lectura si: el listado remoto se muestra completo.
  expect(e.rol).toBe('consulta');
  expect(e.sincronizado).toBe(true);
  expect(e.ums).toHaveLength(2);
  // Escritura no: ni el formulario habilitado ni ningun insert/update emitido.
  await expect(page.locator('#btnGuardarUMH05')).toBeDisabled();
  expect(soloOp(e, 'insert:')).toHaveLength(0);
  expect(soloOp(e, 'update:')).toHaveLength(0);
});

test('149 · F · un administrador con otro correo tiene los controles habilitados', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [], rol: 'administrador', admin: false,
    email: 'operador.mantenimiento@linearoca.gob.ar'
  });
  await abrir(page);
  await page.evaluate(() => { window.esAutorizacionAdministrativaSupabaseV60 = () => false; });
  await irAUM(page);

  const e = await estado(page);
  expect(e.rol).toBe('administrador');
  await expect(page.locator('#btnGuardarUMH05')).toBeEnabled();
});

test('150 · G · SIGNED_OUT apaga el rol de inmediato, sin esperar la recarga', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A], sts: [], rol: 'administrador', admin: true });
  await abrir(page);
  await irAUM(page);
  expect((await estado(page)).rol).toBe('administrador');

  // Se lee el rol en la MISMA vuelta del event loop en que se emite el evento:
  // no puede quedar autoridad viva mientras se resuelve la sesion.
  const rolInmediato = await page.evaluate(() => {
    window.__H05_SIGN_OUT__();
    return window.__COI_UM_H05__.rol;
  });
  expect(rolInmediato).toBeNull();

  await page.waitForTimeout(900);
  await irAUM(page);
  const e = await estado(page);
  expect(e.rol).toBeNull();
  await expect(page.locator('#btnGuardarUMH05')).toBeDisabled();
});

// --- P2: los botones de la ficha UM y el binding de la UM actual.
//
// `let umActualId` es un binding LEXICO global: no es window.umActualId. H05
// —y varias rutas legadas— escriben la propiedad de window, mientras que
// copiarResumenUM() e irEstacionUM() leian la variable lexica, que quedaba con
// la UM anterior o en null. Ahora los dos nombres son el mismo almacenamiento.

const UM_ESTACION_A = Object.assign({}, UM_A, {
  id: '55555555-5555-4555-8555-555555555555',
  codigo_um: 'ASC-PC-1',
  estacion: 'Plaza Constitución'
});
const UM_ESTACION_B = Object.assign({}, UM_A, {
  id: '66666666-6666-4666-8666-666666666666',
  codigo_um: 'ESC-TEMP-2',
  tipo_um: 'Escalera mecánica',
  estacion: 'Temperley'
});
const UM_SIN_ESTACION = Object.assign({}, UM_A, {
  id: '77777777-7777-4777-8777-777777777777',
  codigo_um: 'BOM-SIN-EST',
  estacion: ''
});

// Captura lo que hacen los dos handlers legados sin cambiarlos: el resumen se
// copia al portapapeles y la navegacion pasa por selectStation().
async function instrumentarFichaUM(page) {
  await page.evaluate(() => {
    window.__UM_COPIADO__ = [];
    window.__UM_ESTACION__ = [];
    window.alert = () => {};
    window.prompt = (mensaje, texto) => { window.__UM_COPIADO__.push(String(texto || '')); return null; };
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { window.__UM_COPIADO__.push(String(t)); return Promise.resolve(); } }
      });
    } catch (e) { /* el prompt de respaldo ya deja constancia */ }
    window.selectStation = (est) => { window.__UM_ESTACION__.push(est && est.nombre); };
  });
}

// Abre la ficha de una UM concreta por la ruta de H05.
async function abrirFichaUMPorCodigo(page, codigo) {
  await page.evaluate((c) => {
    const um = (window.unidadesMantenimiento || []).find((u) => u.codigoUM === c);
    window.abrirFichaUM(um ? um._supabaseId : c);
  }, codigo);
  await page.waitForTimeout(350);
}

const bindingUM = (page) => page.evaluate(() => ({
  ventana: window.umActualId,
  // El binding lexico se resuelve por la cadena de ambitos del eval, que
  // incluye el ambito lexico global donde vive el `let`.
  lexico: eval('typeof umActualId === "undefined" ? null : umActualId')
}));

test('151 · abrir una UM desde H05 deja el mismo identificador en los dos bindings', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTACION_A, UM_ESTACION_B], sts: [] });
  await abrir(page);
  await instrumentarFichaUM(page);
  await abrirFichaUMPorCodigo(page, 'ASC-PC-1');

  const b = await bindingUM(page);
  expect(b.ventana).toBe('ASC-PC-1');
  expect(b.lexico).toBe('ASC-PC-1');
});

test('152 · Copiar resumen UM usa la UM abierta, no la anterior', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTACION_A, UM_ESTACION_B], sts: [] });
  await abrir(page);
  await instrumentarFichaUM(page);

  await abrirFichaUMPorCodigo(page, 'ASC-PC-1');
  await page.click('#btnCopiarUM');
  await page.waitForTimeout(250);
  let copiado = await page.evaluate(() => window.__UM_COPIADO__);
  expect(copiado).toHaveLength(1);
  expect(copiado[0]).toContain('ASC-PC-1');

  // Se abre otra UM: las acciones tienen que pasar a la nueva.
  await abrirFichaUMPorCodigo(page, 'ESC-TEMP-2');
  await page.click('#btnCopiarUM');
  await page.waitForTimeout(250);
  copiado = await page.evaluate(() => window.__UM_COPIADO__);
  expect(copiado).toHaveLength(2);
  expect(copiado[1]).toContain('ESC-TEMP-2');
  expect(copiado[1]).not.toContain('ASC-PC-1');
});

test('153 · Ir a estación usa la estación de la UM abierta', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTACION_A, UM_ESTACION_B], sts: [] });
  await abrir(page);
  await instrumentarFichaUM(page);

  await abrirFichaUMPorCodigo(page, 'ASC-PC-1');
  await page.click('#btnIrEstacionUM');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__UM_ESTACION__)).toEqual(['Plaza Constitución']);

  await abrirFichaUMPorCodigo(page, 'ESC-TEMP-2');
  await page.click('#btnIrEstacionUM');
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__UM_ESTACION__))
    .toEqual(['Plaza Constitución', 'Temperley']);
});

test('154 · volver de la ficha no deja una UM fantasma en el binding', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTACION_A, UM_ESTACION_B], sts: [] });
  await abrir(page);
  await instrumentarFichaUM(page);

  await abrirFichaUMPorCodigo(page, 'ASC-PC-1');
  await page.click('#btnVolverUM');
  await page.waitForTimeout(300);

  // Al volver, los dos bindings siguen coincidiendo: nunca puede quedar uno
  // apuntando a una UM y el otro a otra.
  let b = await bindingUM(page);
  expect(b.ventana).toBe(b.lexico);

  // Y al abrir la segunda UM, las acciones son de la segunda.
  await abrirFichaUMPorCodigo(page, 'ESC-TEMP-2');
  b = await bindingUM(page);
  expect(b.ventana).toBe('ESC-TEMP-2');
  expect(b.lexico).toBe('ESC-TEMP-2');
  await page.click('#btnCopiarUM');
  await page.waitForTimeout(250);
  const copiado = await page.evaluate(() => window.__UM_COPIADO__);
  expect(copiado.at(-1)).toContain('ESC-TEMP-2');
});

test('155 · una UM sin estación no navega a ningún lado y no rompe la ficha', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_SIN_ESTACION], sts: [] });
  const errores = await abrir(page);
  await instrumentarFichaUM(page);
  await abrirFichaUMPorCodigo(page, 'BOM-SIN-EST');

  await page.click('#btnIrEstacionUM');
  await page.waitForTimeout(250);
  // Comportamiento seguro: no se navega a una estacion inventada.
  expect(await page.evaluate(() => window.__UM_ESTACION__)).toEqual([]);
  // Y Copiar sigue funcionando sobre la UM abierta.
  await page.click('#btnCopiarUM');
  await page.waitForTimeout(250);
  expect((await page.evaluate(() => window.__UM_COPIADO__)).at(-1)).toContain('BOM-SIN-EST');
  expect(errores).toEqual([]);
});

// --- P2: el snapshot es CONJUNTO de UM y ST.
//
// Cerrar cada tabla por separado no alcanza: UM y ST se escriben en la misma
// transaccion operativa, de modo que entre el scan de una y el de la otra cabe
// un commit ajeno completo. El modelo combinado mostraba el ST nuevo sin su UM
// —y lo marcaba como huerfano— afirmandolo ademas como sincronizado.

const MUCHOS_ST = (n, unidadId) => Array.from({ length: n }, (_, i) => Object.assign({}, ST_A, {
  id: '88888888-8888-4888-8888-' + String(i + 1).padStart(12, '0'),
  nro_st: 'ST-MASIVO-' + (i + 1),
  unidad_id: unidadId
}));

const resumenPar = (page) => page.evaluate(() => ({
  sincronizado: window.__COI_UM_H05__.sincronizado,
  ultimoError: window.__COI_UM_H05__.ultimoError,
  ums: (window.unidadesMantenimiento || []).length,
  umsUnicas: new Set((window.unidadesMantenimiento || []).map((u) => u._supabaseId)).size,
  sts: (window.serviciosTecnicos || []).length,
  stsUnicos: new Set((window.serviciosTecnicos || []).map((s) => s._supabaseId)).size,
  // Un ST cuyo unidad_id no aparece entre las UM del modelo: exactamente el
  // falso huerfano que el snapshot conjunto tiene que evitar.
  huerfanos: (window.serviciosTecnicos || []).filter((s) => !s.idUM).length,
  conteosUM: window.__H05_LLAMADAS__.filter((l) => l.op === 'count:coi_unidades_mantenimiento').length,
  conteosST: window.__H05_LLAMADAS__.filter((l) => l.op === 'count:coi_servicios_tecnicos_um').length,
  intrusasUM: (window.unidadesMantenimiento || []).filter((u) => String(u.codigoUM).indexOf('INTRUSA-') === 0).length,
  intrusosST: (window.serviciosTecnicos || []).filter((s) => String(s.nroST).indexOf('ST-INTRUSO-') === 0).length
}));

test('156 · A · un commit de UM+ST entre los dos scans descarta el par y relee', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A, UM_B], sts: [ST_A],
    insertarEntrePaginas: 1, intrusoDurante: 'st', intrusoDestino: 'ambos'
  });
  await abrir(page);

  const r = await resumenPar(page);
  // El par se descarto y se reinicio entero: hubo mas de un par de conteos en
  // LAS DOS tablas.
  expect(r.conteosUM).toBeGreaterThan(2);
  expect(r.conteosST).toBeGreaterThan(2);
  // El segundo par llego completo: la UM nueva y su ST viajan juntos.
  expect(r.sincronizado).toBe(true);
  expect(r.intrusasUM).toBe(1);
  expect(r.intrusosST).toBe(1);
  // Y el ST nuevo NO aparece como huerfano: su UM esta en el mismo snapshot.
  expect(r.huerfanos).toBe(0);
});

test('157 · B · un insert solo en UM durante el scan de ST reinicia el par', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A, UM_B], sts: [ST_A],
    insertarEntrePaginas: 1, intrusoDurante: 'st', intrusoDestino: 'um'
  });
  await abrir(page);

  const r = await resumenPar(page);
  expect(r.conteosUM).toBeGreaterThan(2);
  expect(r.sincronizado).toBe(true);
  expect(r.ums).toBe(3);
  expect(r.umsUnicas).toBe(3);
});

test('158 · C · un insert solo en ST durante el scan de UM reinicia el par completo', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A, UM_B], sts: [ST_A],
    insertarEntrePaginas: 1, intrusoDurante: 'um', intrusoDestino: 'st'
  });
  await abrir(page);

  const r = await resumenPar(page);
  // Lo que cambio fue ST, pero se descartan LOS DOS scans: por eso tambien se
  // volvio a contar UM. Con la verificacion por tabla esto no se detectaba.
  expect(r.conteosST).toBeGreaterThan(2);
  expect(r.conteosUM).toBeGreaterThan(2);
  expect(r.sincronizado).toBe(true);
  expect(r.sts).toBe(2);
  expect(r.stsUnicos).toBe(2);
});

test('159 · D · con escritura sostenida no se publica una mezcla parcial y se conserva el par previo', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_A, UM_B], sts: [ST_A] });
  await abrir(page);
  const inicial = await resumenPar(page);
  expect(inicial.sincronizado).toBe(true);
  expect(inicial.ums).toBe(2);
  expect(inicial.sts).toBe(1);

  // El remoto entra en escritura sostenida sobre las dos tablas.
  await page.evaluate(() => {
    window.__H05_CFG__.insertarEntrePaginas = true;
    window.__H05_CFG__.intrusoDurante = 'st';
    window.__H05_CFG__.intrusoDestino = 'ambos';
  });
  await page.evaluate(() => window.recargarUnidadesMantenimiento());
  await page.waitForTimeout(1200);

  const r = await resumenPar(page);
  expect(r.sincronizado).toBe(false);
  expect(r.ultimoError).toMatch(/cambió durante la lectura/i);
  // Se conserva el ultimo snapshot CONJUNTO confirmado: ni cero, ni mezcla.
  expect(r.ums).toBe(2);
  expect(r.sts).toBe(1);
  expect(r.intrusasUM).toBe(0);
  expect(r.intrusosST).toBe(0);
  // Tres intentos del par: seis conteos por tabla.
  expect(r.conteosUM).toBe(2 + 6);
  expect(r.conteosST).toBe(2 + 6);
});

test('160 · E · el remoto vacio es un par valido y sincronizado', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [] });
  await abrir(page);

  const r = await resumenPar(page);
  expect(r.sincronizado).toBe(true);
  expect(r.ultimoError).toBeNull();
  expect(r.ums).toBe(0);
  expect(r.sts).toBe(0);
  // Una sola pasada del par: dos conteos por tabla.
  expect(r.conteosUM).toBe(2);
  expect(r.conteosST).toBe(2);
});

test('161 · F · mas de 1000 UM y mas de 1000 ST se leen sin saltos ni duplicados', async ({ page }) => {
  const ums = MUCHAS_UM(1001);
  const sts = MUCHOS_ST(1001, ums[0].id);
  await prepararEntorno(page, { ums: ums, sts: sts });
  await abrir(page);

  const r = await resumenPar(page);
  expect(r.sincronizado).toBe(true);
  expect(r.ums).toBe(1001);
  expect(r.umsUnicas).toBe(1001);
  expect(r.sts).toBe(1001);
  expect(r.stsUnicos).toBe(1001);
  expect(r.huerfanos).toBe(0);
  // Sin concurrencia, una sola pasada del par.
  expect(r.conteosUM).toBe(2);
  expect(r.conteosST).toBe(2);

  // Y el paginado sigue siendo keyset por id, sin offset, en las dos tablas.
  const e = await estado(page);
  for (const op of ['select:coi_unidades_mantenimiento', 'select:coi_servicios_tecnicos_um']) {
    const lecturas = soloOp(e, op);
    expect(lecturas.length).toBeGreaterThan(1);
    expect(lecturas.every((l) => !(l.payload || []).some((f) => f.op === 'range'))).toBe(true);
  }
});

// ================================== novena ronda de review del PR #59

// --- P2: «Ir a estación» resuelve la estacion como el resto del sistema.
//
// La UM guarda texto libre y el catalogo el nombre canonico. La comparacion
// era por igualdad exacta, de modo que una UM con «PLAZA CONSTITUCION»
// aparecia asociada en Red y en las listas, pero el boton no navegaba.

const UM_ESTACION_CRUDA = Object.assign({}, UM_A, {
  id: '88888888-8888-4888-8888-888888888888',
  codigo_um: 'ASC-PC-CRUDA',
  estacion: 'PLAZA CONSTITUCION'
});
const UM_ESTACION_DESCONOCIDA = Object.assign({}, UM_A, {
  id: '99999999-9999-4999-8999-999999999999',
  codigo_um: 'ASC-FANTASMA',
  estacion: 'Estación Que No Existe'
});

test('162 · Ir a estación resuelve «PLAZA CONSTITUCION» contra «Plaza Constitución»', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTACION_CRUDA], sts: [] });
  const errores = await abrir(page);
  await instrumentarFichaUM(page);
  await abrirFichaUMPorCodigo(page, 'ASC-PC-CRUDA');

  // Click DOM real sobre el boton de la ficha.
  await page.click('#btnIrEstacionUM');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__UM_ESTACION__))
    .toEqual(['Plaza Constitución']);

  // El valor almacenado de la UM NO se toca: solo se compara normalizado.
  const guardada = await page.evaluate(
    () => (window.unidadesMantenimiento || []).find((u) => u.codigoUM === 'ASC-PC-CRUDA').estacion);
  expect(guardada).toBe('PLAZA CONSTITUCION');
  expect(errores).toEqual([]);
});

test('163 · una estación que no existe en el catálogo no inventa destino ni rompe la ficha', async ({ page }) => {
  await prepararEntorno(page, { ums: [UM_ESTACION_DESCONOCIDA], sts: [] });
  const errores = await abrir(page);
  await instrumentarFichaUM(page);
  await abrirFichaUMPorCodigo(page, 'ASC-FANTASMA');

  await page.click('#btnIrEstacionUM');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__UM_ESTACION__)).toEqual([]);

  // Y el resto de las acciones de la ficha siguen respondiendo.
  await page.click('#btnCopiarUM');
  await page.waitForTimeout(250);
  expect((await page.evaluate(() => window.__UM_COPIADO__)).at(-1)).toContain('ASC-FANTASMA');
  expect(errores).toEqual([]);
});

// --- P2: guardar un ST congela su contexto antes del primer await.
//
// confirmarOC() sale a la red. Si en esa ventana el operador abre otro ST, la
// version del CAS se leia del global stEditandoVersion —ya movido— y el UPDATE
// viajaba con el uuid de A y la version de B. Ademas limpiarEdicionST() borraba
// la edicion recien abierta.

test('164 · abrir otro ST durante la validación de OC no mezcla uuid y versión CAS', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A, ST_B],
    ordenes: [{ nro_oc: '4530008964' }, { nro_oc: '4530003333' }]
  });
  await abrir(page);
  await fijarAdmin(page, true);
  await sembrarOC(page, ['4530008964', '4530003333']);
  await irAUM(page);
  await editarSTEnFicha(page, ST_A.id);

  // Cambiar la OC obliga a la validacion remota, que queda suspendida.
  await page.fill('#stfh5_oc', '4530003333');
  await page.evaluate(() => { window.__H05_CFG__.frenarSelectOC = true; });
  await page.click('[data-h05-guardar-st-ficha]');

  // Con A en vuelo, el operador abre B.
  await page.waitForFunction(() => window.__H05_OC_FRENADA__(), null, { timeout: 5000 });
  await page.click('[data-h05-editar-st="' + ST_B.id + '"]');
  await page.waitForTimeout(300);
  await expect(page.locator('#stfh5_nro')).toHaveValue(ST_B.nro_st);

  // Recien ahora se libera la validacion de A.
  await page.evaluate(() => { window.__H05_ABRIR_OC__(); });
  await page.waitForTimeout(1200);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  // El UPDATE es de A, con la version de A. Nunca uuid A + version B.
  expect(updates[0].payload.filtro).toEqual({ col: 'id', val: ST_A.id });
  const cas = updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion');
  expect(cas.val).toBe(ST_A.fecha_actualizacion);
  expect(cas.val).not.toBe(ST_B.fecha_actualizacion);

  // B sigue siendo la edicion activa: A no le borro el contexto al terminar.
  await expect(page.locator('#fichaUMBody')).toContainText('Editar el Servicio Técnico ' + ST_B.nro_st);
  await expect(page.locator('#stfh5_nro')).toHaveValue(ST_B.nro_st);

  // Ni altas ni bajas inesperadas, ni escritura legada.
  expect(soloOp(e, 'insert:coi_servicios_tecnicos_um')).toHaveLength(0);
  expect(e.llamadas.filter((l) => String(l.op).indexOf('delete') === 0)).toHaveLength(0);
  expect(e.escriturasLegacy).toEqual([]);
  // El lector legado sigue viendo vacio: ningun ST operativo se persistio.
  expect(JSON.parse(e.legacyST)).toEqual([]);
});

test('165 · sin interleaving, guardar un ST sigue cerrando su propia edición', async ({ page }) => {
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
  await page.waitForTimeout(1300);

  const e = await estado(page);
  const updates = soloOp(e, 'update:coi_servicios_tecnicos_um');
  expect(updates).toHaveLength(1);
  const cas = updates[0].payload.filtros.find((f) => f.col === 'fecha_actualizacion');
  expect(cas.val).toBe(ST_A.fecha_actualizacion);
  // La edicion propia si se cierra: la ficha vuelve al alta.
  await expect(page.locator('#fichaUMBody')).toContainText('Cargar ST para esta UM');
  await expect(page.locator('#fichaUMBody')).not.toContainText('Editar el Servicio Técnico');
});

test('166 · F · si el rol se revoca durante el scan no se publica un snapshot autoritativo', async ({ page }) => {
  await prepararEntorno(page, {
    ums: [UM_A], sts: [ST_A], rol: 'administrador', rolTrasPrimeraVerificacion: null
  });
  await abrirSinEsperarCarga(page);
  await page.waitForFunction(() =>
    (window.__H05_LLAMADAS__ || []).filter((l) => l.op === 'rpc:coi_current_role').length >= 2,
    null, { timeout: 20000 }
  );
  await page.waitForTimeout(300);
  const e = await estado(page);
  expect(e.sincronizado).toBe(false);
  expect(e.rol).toBeNull();
  expect(e.ums.map((u) => u.codigo)).not.toContain('ASC-001');
  expect(e.sts.map((st) => st.nroST)).not.toContain('ST-0001');
  expect(e.llamadas.filter((l) => l.op === 'rpc:coi_current_role').length).toBeGreaterThanOrEqual(2);
  expect(e.escriturasLegacy).toEqual([]);
});

test('167 · F · codigo UM que normaliza a vacio se rechaza sin INSERT', async ({ page }) => {
  await prepararEntorno(page, { ums: [], sts: [] });
  await abrir(page);
  await fijarAdmin(page, true);
  await irAUM(page);
  for (const invalido of ['-', '///', ' . / - ']) {
    await page.fill('#umh5_codigo', invalido);
    await page.selectOption('#umh5_tipo', 'Ascensor');
    await page.selectOption('#umh5_estacion', { index: 1 });
    await page.selectOption('#umh5_estado', 'ACTIVA');
    await page.click('#btnGuardarUMH05');
    await page.waitForTimeout(120);
    await expect(page.locator('#umFormMsgH05')).toContainText('código UM');
  }
  const e = await estado(page);
  expect(soloOp(e, 'insert:coi_unidades_mantenimiento')).toHaveLength(0);
  expect(e.ums).toHaveLength(0);
  expect(e.escriturasLegacy).toEqual([]);
});
