const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/*
  H03 — Observaciones OC con Supabase como unica fuente de verdad.

  Las acciones reales de la UI viven dentro de IIFEs que llaman a
  stopImmediatePropagation, de modo que reasignar window.funcion no alcanza.
  Por eso los casos de edicion y de Centro de Alertas hacen click DOM real
  sobre el boton que renderiza la aplicacion, no invocan el helper.

  Supabase se intercepta con un cliente falso y page.route(): ninguna prueba
  toca datos reales.
*/

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

const LEGACY = [
  { idObservacion: 'OBS-LEGACY-1', ocNro: '4530008964', texto: 'LEGADO UNO', estadoObservacion: 'Pendiente', fechaCarga: '2026-01-01T10:00:00.000Z' },
  { idObservacion: 'OBS-LEGACY-2', ocNro: '4530008964', texto: 'LEGADO DOS', estadoObservacion: 'Pendiente', fechaCarga: '2026-01-02T10:00:00.000Z' }
];

const ORDEN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USUARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const REMOTA = {
  id: '11111111-1111-4111-8111-111111111111',
  orden_id: ORDEN_ID,
  nro_oc: '4530008964',
  observacion: 'OBSERVACION REMOTA DE SUPABASE',
  estado: 'Pendiente',
  prioridad: 'Normal',
  creado_por: USUARIO,
  resuelto_por: null,
  fecha_creacion: '2026-08-30T10:00:00.000Z',
  fecha_resolucion: null
};

// Cliente Supabase falso: soporta paginado por range, order encadenado, in() para
// profiles, retardos programables y fallos por operacion.
async function prepararEntorno(page, opciones) {
  const cfg = Object.assign({
    filas: [], legado: null, marker: false,
    fallaSelect: false, fallaMutacion: false,
    retardoSelectMs: 0, retardoPerfilesMs: 0, pageSize: 1000, perfiles: [], admin: true
  }, opciones);

  await page.addInitScript((c) => {
    window.__H03_LLAMADAS__ = [];
    window.__H03_LEGACY_WRITES__ = [];
    window.__H03_CFG__ = c;
    if (c.legado) localStorage.setItem('coi_observaciones_oc', JSON.stringify(c.legado));
    if (c.marker) localStorage.setItem('coi_observaciones_h03_imported_v1', '1');

    // Cualquier intento de persistir observaciones en localStorage queda registrado.
    const setItemNativo = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'coi_observaciones_oc') window.__H03_LEGACY_WRITES__.push(String(v).slice(0, 80));
      return setItemNativo.call(this, k, v);
    };

    let sesionActiva = true;
    // El UID de la sesion se puede cambiar para simular que entra otro usuario.
    let uidSesion = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    window.__H03_SET_UID__ = (v) => { uidSesion = v; };
    const registrar = (op, payload) => window.__H03_LLAMADAS__.push({ op, payload });
    let filas = c.filas.slice();
    // Con backend compartido las filas viven en Node y se leen/escriben por RPC:
    // dos contextos distintos golpean entonces el mismo estado de servidor.
    const leerFilas = async () => (window.__h03Rpc ? await window.__h03Rpc(null) : filas);
    const escribirFilas = async (f) => {
      if (window.__h03Rpc) { await window.__h03Rpc(f.slice()); return; }
      filas = f.slice();
    };
    window.__H03_SET_FILAS__ = (nuevas) => {
      filas = nuevas.slice();
      if (window.__h03Rpc) window.__h03Rpc(nuevas.slice());
    };
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));

    function consulta(tabla) {
      const st = { tabla, filtro: null, patch: null, op: null, rango: null, inIds: null };
      const api = {
        select() { return api; },
        order() { return api; },
        range(a, b) { st.rango = [a, b]; return api; },
        in(col, vals) { st.inIds = vals; return api; },
        limit(n) { st.limite = n; return api; },
        eq(col, val) { st.filtro = { col, val }; return api; },
        single() { return api._run(true); },
        insert(f) { st.op = 'insert'; st.payload = f; return api; },
        update(p) { st.op = 'update'; st.patch = p; return api; },
        delete() { st.op = 'delete'; return api; },
        async _run(unico) {
          if (st.tabla === 'profiles') {
            registrar('profiles', st.inIds);
            const cfg = window.__H03_CFG__;
            // Lo que el servidor puede devolver se resuelve con la RLS VIGENTE al
            // iniciar la request, no con la de la sesion que llegue despues.
            const disponibles = (cfg.perfiles || []).slice();
            if (cfg.retardoPerfilesMs) await espera(cfg.retardoPerfilesMs);
            return { data: disponibles.filter((p) => !st.inIds || st.inIds.includes(p.id)), error: null };
          }
          if (st.tabla !== 'coi_observaciones_oc') return { data: [], error: null };

          if (st.op === 'insert') {
            registrar('insert', st.payload);
            if (c.fallaMutacion) return { data: null, error: { message: 'RLS denegado' } };
            const previas = await leerFilas();
            const creada = Object.assign({
              id: '99999999-9999-4999-8999-' + String(previas.length).padStart(12, '0'),
              fecha_creacion: new Date().toISOString(), fecha_resolucion: null, resuelto_por: null
            }, st.payload);
            await escribirFilas([creada].concat(previas));
            return { data: unico ? creada : [creada], error: null };
          }
          if (st.op === 'update') {
            registrar('update', { filtro: st.filtro, patch: st.patch });
            if (c.fallaMutacion) return { data: null, error: { message: 'RLS denegado' } };
            const actuales = await leerFilas();
            const i = actuales.findIndex((f) => f.id === (st.filtro && st.filtro.val));
            if (i < 0) return { data: [], error: null };
            actuales[i] = Object.assign({}, actuales[i], st.patch);
            await escribirFilas(actuales);
            return { data: [actuales[i]], error: null };
          }
          if (st.op === 'delete') { registrar('delete', st.filtro); return { data: [], error: null }; }

          registrar('select', st.rango);
          if (window.__H03_CFG__.retardoSelectMs) await espera(window.__H03_CFG__.retardoSelectMs);
          if (window.__H03_CFG__.fallaSelect) return { data: null, error: { message: 'fallo de red' } };
          // Sin sesion PostgREST responde 401: el fake lo refleja.
          if (!sesionActiva) return { data: null, error: { message: 'JWT ausente' } };
          // El select tambien filtra por eq y respeta limit, que es lo que usa
          // leerFila para releer una unica fila por UUID.
          let base = await leerFilas();
          if (st.filtro) base = base.filter((f) => f[st.filtro.col] === st.filtro.val);
          if (st.limite) return { data: base.slice(0, st.limite), error: null };
          const [a, b] = st.rango || [0, 999999];
          // Se respeta el pageSize simulado para poder ejercitar el paginado.
          const tope = Math.min(b, a + window.__H03_CFG__.pageSize - 1);
          return { data: base.slice(a, tope + 1), error: null };
        },
        then(res, rej) { return api._run(false).then(res, rej); }
      };
      return api;
    }

    window.__H03_SIGN_OUT__ = () => {
      sesionActiva = false;
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'SIGNED_OUT' } }));
    };

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
    // Gate canonico de administrador: el mismo que consultan esAdminR13 e isAdminR14.
    window.esAutorizacionAdministrativaSupabaseV60 = () => c.admin === true;
  }, cfg);

  if (opciones && opciones.backend) {
    const b = opciones.backend;
    // Un unico arreglo en Node: pasar filas lo reemplaza, null solo lo lee.
    await page.exposeFunction('__h03Rpc', (f) => {
      if (f) b.filas = f;
      return b.filas;
    });
  }

  await page.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, body: '[]' }));
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, body: '{}' }));
}

async function abrir(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.__COI_OBS_H03__), null, { timeout: 20000 });
  await page.waitForFunction(
    () => window.__COI_OBS_H03__ && window.__COI_OBS_H03__.origen !== 'inicial',
    null, { timeout: 20000 }
  );
  return errores;
}

// Abre la aplicacion sin esperar a que la primera lectura termine: hace falta
// para intervenir MIENTRAS una request remota sigue en vuelo.
async function abrirSinEsperarCarga(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.__COI_OBS_H03__), null, { timeout: 20000 });
}

// El arranque de la aplicacion reasigna esAutorizacionAdministrativaSupabaseV60
// (index.html:8558), de modo que fijarlo en addInitScript no sirve: hay que
// hacerlo despues de la carga.
async function fijarAdmin(page, valor) {
  await page.evaluate((v) => {
    window.esAutorizacionAdministrativaSupabaseV60 = () => v;
  }, valor);
}

// Catalogo de OC en memoria: la identidad canonica es el UUID.
async function sembrarOC(page, opciones) {
  const o = Object.assign({ nro: '4530008964', id: ORDEN_ID }, opciones);
  await page.evaluate((x) => {
    window.todasLasOC = () => ([{ oc: x.nro, item: { numeroOC: x.nro, supabaseId: x.id, idObra: 'OB-1' } }]);
  }, o);
}

const estado = (page) => page.evaluate(() => ({
  origen: window.__COI_OBS_H03__.origen,
  sincronizado: window.__COI_OBS_H03__.sincronizado,
  observaciones: (window.observacionesOC || []).map((o) => ({
    id: o.idObservacion, texto: o.texto, estado: o.estadoObservacion,
    ocNro: o.ocNro, usuarioCarga: o.usuarioCarga, usuarioResolucion: o.usuarioResolucion,
    creadoPorId: o.creadoPorId, resueltoPorId: o.resueltoPorId,
    soloLectura: Boolean(o._soloLectura)
  })),
  legacyKey: localStorage.getItem('coi_observaciones_oc'),
  marker: localStorage.getItem('coi_observaciones_h03_imported_v1'),
  llamadas: window.__H03_LLAMADAS__,
  escriturasLegacy: window.__H03_LEGACY_WRITES__
}));

const soloOp = (e, op) => e.llamadas.filter((l) => l.op === op);

// =============================================== casos originales

test('1 · Supabase con filas manda sobre el legado local', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA], legado: LEGACY });
  const errores = await abrir(page);
  const e = await estado(page);

  expect(e.origen).toBe('supabase');
  expect(e.observaciones).toHaveLength(1);
  expect(e.observaciones[0].texto).toBe('OBSERVACION REMOTA DE SUPABASE');
  expect(e.observaciones.map((o) => o.texto)).not.toContain('LEGADO UNO');
  expect(e.legacyKey).not.toBeNull(); // no se borra: queda para la importacion controlada
  expect(errores).toEqual([]);
});

test('2 · Supabase vacio sin marker muestra el legado en solo lectura', async ({ page }) => {
  await prepararEntorno(page, { filas: [], legado: LEGACY });
  await abrir(page);
  const e = await estado(page);

  expect(e.origen).toBe('legacy-readonly');
  expect(e.observaciones).toHaveLength(2);
  expect(e.observaciones.every((o) => o.soloLectura)).toBe(true);
  expect(e.marker).toBeNull();
});

test('3 · Supabase vacio con marker no resucita el legado', async ({ page }) => {
  await prepararEntorno(page, { filas: [], legado: LEGACY, marker: true });
  await abrir(page);
  const e = await estado(page);

  expect(e.origen).toBe('supabase');
  expect(e.observaciones).toHaveLength(0);
});

test('4 · crear una observacion genera INSERT en coi_observaciones_oc', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);
  await sembrarOC(page);

  await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'NUEVA OBSERVACION DE PRUEBA';
    document.body.appendChild(ta);
    window.guardarObservacionOC('4530008964');
  });
  await page.waitForTimeout(700);
  const e = await estado(page);

  const ins = soloOp(e, 'insert');
  expect(ins).toHaveLength(1);
  expect(ins[0].payload.observacion).toBe('NUEVA OBSERVACION DE PRUEBA');
  expect(ins[0].payload.orden_id).toBe(ORDEN_ID);
  expect(ins[0].payload.creado_por).toBe(USUARIO);
  expect(e.escriturasLegacy).toEqual([]);
});

test('6 · resolver actualiza estado, resuelto_por y fecha_resolucion', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);
  await page.evaluate(() => { window.prompt = () => ''; });
  await page.evaluate((id) => window.resolverObservacionOC(id), REMOTA.id);
  await page.waitForTimeout(700);
  const e = await estado(page);

  const up = soloOp(e, 'update');
  expect(up).toHaveLength(1);
  expect(up[0].payload.filtro.val).toBe(REMOTA.id);
  expect(up[0].payload.patch.estado).toBe('Resuelta');
  expect(up[0].payload.patch.resuelto_por).toBe(USUARIO);
  expect(up[0].payload.patch.fecha_resolucion).toBeTruthy();
});

test('8 · si la mutacion remota falla no queda una observacion falsa', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true, fallaMutacion: true });
  await abrir(page);
  await sembrarOC(page);

  await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'OBSERVACION QUE DEBE FALLAR';
    document.body.appendChild(ta);
    window.guardarObservacionOC('4530008964');
  });
  await page.waitForTimeout(900);
  const e = await estado(page);

  expect(e.observaciones).toHaveLength(0);
  expect(e.escriturasLegacy).toEqual([]);
});

test('9 · ningun writer activo persiste observaciones en localStorage', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);

  await page.evaluate(() => {
    window.v65GuardarObservacionesOC();
    if (typeof window.v65MigrarObservacionesLegacy === 'function') window.v65MigrarObservacionesLegacy({});
  });
  const e = await estado(page);
  expect(e.escriturasLegacy).toEqual([]);
  expect(SOURCE).toContain('window.v65GuardarObservacionesOC = function ()');
});

test('10 · un segundo contexto ve la observacion creada por el primero', async ({ browser }) => {
  test.slow();
  // Los dos contextos comparten el mismo arreglo de filas en Node: si el insert
  // se quedara en el navegador, el segundo contexto no veria nada.
  const backend = { filas: [] };

  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await prepararEntorno(page1, { backend, marker: true });
  await abrir(page1);
  await sembrarOC(page1);
  await page1.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'OBSERVACION COMPARTIDA ENTRE OPERADORES';
    document.body.appendChild(ta);
    window.guardarObservacionOC('4530008964');
  });
  await page1.waitForFunction(
    () => (window.observacionesOC || []).some((o) => o.texto === 'OBSERVACION COMPARTIDA ENTRE OPERADORES'),
    null, { timeout: 15000 }
  );
  await ctx1.close();

  // El insert quedo del lado del servidor simulado, no del navegador.
  expect(backend.filas).toHaveLength(1);

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await prepararEntorno(page2, { backend, marker: true });
  await abrir(page2);
  await sembrarOC(page2);
  const e = await estado(page2);
  await ctx2.close();

  expect(e.origen).toBe('supabase');
  expect(e.observaciones.map((o) => o.texto)).toEqual(['OBSERVACION COMPARTIDA ENTRE OPERADORES']);
  expect(JSON.parse(e.legacyKey || '[]')).toHaveLength(0);
});

// =============================================== findings del review

test('F1 · el click real en Editar termina en el UPDATE remoto, no en el legacy', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);
  await fijarAdmin(page, true);

  // Boton exactamente como lo renderiza la aplicacion (index.html:11676).
  await page.evaluate((id) => {
    window.prompt = () => 'TEXTO EDITADO POR CLICK REAL';
    const cont = document.createElement('div');
    cont.className = 'obs-actions';
    cont.innerHTML = '<button type="button" id="btnEditReal" data-r13-edit-obs="' + id + '">Editar</button>';
    document.body.appendChild(cont);
  }, REMOTA.id);

  await page.evaluate(() => document.getElementById('btnEditReal').click());
  await page.waitForTimeout(800);
  const e = await estado(page);

  const up = soloOp(e, 'update');
  expect(up).toHaveLength(1);
  expect(up[0].payload.filtro).toEqual({ col: 'id', val: REMOTA.id });
  expect(up[0].payload.patch.observacion).toBe('TEXTO EDITADO POR CLICK REAL');
  // El legacy habria mutado memoria y persistido: no debe haber ocurrido.
  expect(e.escriturasLegacy).toEqual([]);
  expect(e.observaciones[0].texto).toBe('TEXTO EDITADO POR CLICK REAL');
});

test('F2 · el click real en Centro de Alertas genera exactamente un INSERT remoto', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);
  await sembrarOC(page);

  // Boton exactamente como lo emite renderCentroAlertasV581.
  await page.evaluate(() => {
    const alerta = { oc: '4530008964', tipoAlerta: 'OC vencida', mensaje: 'MENSAJE DE ALERTA', accionSugerida: 'ACCION SUGERIDA' };
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnAlertaReal';
    b.dataset.v581AlertObs = encodeURIComponent(JSON.stringify(alerta));
    b.textContent = 'Observacion';
    document.body.appendChild(b);
  });

  await page.evaluate(() => document.getElementById('btnAlertaReal').click());
  await page.waitForTimeout(800);
  const e = await estado(page);

  const ins = soloOp(e, 'insert');
  expect(ins).toHaveLength(1);
  expect(ins[0].payload.orden_id).toBe(ORDEN_ID);
  expect(ins[0].payload.observacion).toContain('MENSAJE DE ALERTA');
  expect(ins[0].payload.observacion).toContain('ACCION SUGERIDA');
  expect(e.escriturasLegacy).toEqual([]);
});

test('F3 · una carga vieja no pisa a una nueva ni repuebla tras SIGNED_OUT', async ({ page }) => {
  test.slow();
  await prepararEntorno(page, { filas: [REMOTA], marker: true });
  await abrir(page);

  const resultado = await page.evaluate(async () => {
    // A: lenta y con el dataset viejo. B: rapida y con el dataset nuevo.
    window.__H03_CFG__.retardoSelectMs = 1200;
    const A = window.recargarObservacionesOC();
    await new Promise((r) => setTimeout(r, 100));
    window.__H03_CFG__.retardoSelectMs = 0;
    window.__H03_SET_FILAS__([{
      id: '22222222-2222-4222-8222-222222222222', orden_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      nro_oc: '4530008964', observacion: 'GANADORA B', estado: 'Pendiente', prioridad: 'Normal',
      creado_por: null, resuelto_por: null, fecha_creacion: '2026-08-30T12:00:00.000Z', fecha_resolucion: null
    }]);
    const B = window.recargarObservacionesOC();
    await B;
    const trasB = (window.observacionesOC || []).map((o) => o.texto);
    await A;
    const trasA = (window.observacionesOC || []).map((o) => o.texto);
    return { trasB, trasA };
  });

  // B gana; cuando A responde despues, no cambia la memoria.
  expect(resultado.trasB).toEqual(['GANADORA B']);
  expect(resultado.trasA).toEqual(['GANADORA B']);

  // SIGNED_OUT mientras una carga esta pendiente: no repuebla.
  const trasSignOut = await page.evaluate(async () => {
    window.__H03_CFG__.retardoSelectMs = 900;
    const pendiente = window.recargarObservacionesOC();
    await new Promise((r) => setTimeout(r, 100));
    window.__H03_SIGN_OUT__();
    await pendiente.catch(() => {});
    await new Promise((r) => setTimeout(r, 1400));
    return (window.observacionesOC || []).map((o) => o.texto);
  });
  expect(trasSignOut).not.toContain('GANADORA B');
});

test('F4 · un fallo de lectura tras el marker no se convierte en cero observaciones', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);
  let e = await estado(page);
  expect(e.observaciones).toHaveLength(1);
  expect(e.marker).toBe('1');

  await page.evaluate(async () => {
    window.__H03_CFG__.fallaSelect = true;
    await window.recargarObservacionesOC();
  });
  e = await estado(page);

  // Se conserva el ultimo modelo remoto confirmado y se marca no sincronizado.
  expect(e.observaciones).toHaveLength(1);
  expect(e.observaciones[0].texto).toBe('OBSERVACION REMOTA DE SUPABASE');
  expect(e.origen).toBe('error-sin-sincronizar');
  expect(e.sincronizado).toBe(false);
});

test('F5 · la lectura pagina y une todas las paginas sin duplicados', async ({ page }) => {
  const muchas = Array.from({ length: 7 }, (_, i) => Object.assign({}, REMOTA, {
    id: '3333333' + i + '-3333-4333-8333-333333333333',
    observacion: 'OBSERVACION ' + i
  }));
  await prepararEntorno(page, { filas: muchas, pageSize: 3 });
  await abrir(page);
  const e = await estado(page);

  expect(e.observaciones).toHaveLength(7);
  const ids = e.observaciones.map((o) => o.id);
  expect(new Set(ids).size).toBe(7);
  // 3 + 3 + 1: la ultima pagina incompleta corta el bucle.
  expect(soloOp(e, 'select').length).toBeGreaterThanOrEqual(3);
});

test('F6 · se preservan las identidades de creador y resolutor', async ({ page }) => {
  const conResolutor = Object.assign({}, REMOTA, {
    estado: 'Resuelta', resuelto_por: USUARIO, fecha_resolucion: '2026-08-30T11:00:00.000Z'
  });
  await prepararEntorno(page, {
    filas: [conResolutor],
    perfiles: [{ id: USUARIO, email: 'admin@coiroca.com', nombre: 'Ada', apellido: 'Lovelace' }]
  });
  await abrir(page);
  const e = await estado(page);

  expect(e.observaciones[0].creadoPorId).toBe(USUARIO);
  expect(e.observaciones[0].resueltoPorId).toBe(USUARIO);
  expect(e.observaciones[0].usuarioCarga).toBe('Ada Lovelace');
  expect(e.observaciones[0].usuarioResolucion).toBe('Ada Lovelace');
  // Nunca se atribuye una observacion remota a "Local".
  expect(e.observaciones[0].usuarioCarga).not.toBe('Local');
});

test('F6b · sin perfil resoluble se muestra una identidad neutra, nunca Local', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA], perfiles: [] });
  await abrir(page);
  const e = await estado(page);

  expect(e.observaciones[0].usuarioCarga).toContain('Usuario ');
  expect(e.observaciones[0].usuarioCarga).not.toBe('Local');
});

test('F7 · sin UUID maestro de la OC no se inserta nada', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);
  // Catalogo sin la OC: ordenIdDe no puede resolver el UUID.
  await page.evaluate(() => { window.todasLasOC = () => ([]); });

  await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'NO DEBE INSERTARSE';
    document.body.appendChild(ta);
    window.guardarObservacionOC('4530008964');
  });
  await page.waitForTimeout(900);
  const e = await estado(page);

  expect(soloOp(e, 'insert')).toHaveLength(0);
  expect(e.observaciones).toHaveLength(0);
  expect(e.escriturasLegacy).toEqual([]);
});

test('F8 · la observacion se asocia por orden_id aunque nro_oc este desactualizado', async ({ page }) => {
  const desactualizada = Object.assign({}, REMOTA, { nro_oc: '4530000000-VIEJO' });
  await prepararEntorno(page, { filas: [desactualizada] });
  await abrir(page);
  // La OC real tiene otro numero, pero el mismo UUID maestro.
  await sembrarOC(page, { nro: '4530099999', id: ORDEN_ID });
  await page.evaluate(() => window.recargarObservacionesOC());
  await page.waitForTimeout(600);
  const e = await estado(page);

  // El nro_oc se deriva de la OC canonica, no del valor viejo de la fila.
  expect(e.observaciones[0].ocNro).toBe('4530099999');
});

test('F9 · el Refresh general de Supabase recarga tambien las observaciones', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);

  const resultado = await page.evaluate(async () => {
    // El refresh general esta envuelto por varias capas: H05 envuelve a H03,
    // que envuelve al original. Mirar solo la marca de la funcion exterior daba
    // un falso negativo apenas se sumo H05, aunque la cadena siga instalada.
    // Se recorre la cadena por sus punteros `...Base` hasta encontrar H03.
    const envuelto = (() => {
      let fn = window.recargarDatosDesdeSupabase;
      const vistos = new Set();
      while (typeof fn === 'function' && !vistos.has(fn)) {
        vistos.add(fn);
        if (fn.__coiObsH03 === true) return true;
        fn = fn.__coiObsH03Base || fn.__coiUmH05Base || null;
      }
      return false;
    })();
    // Otro operador crea una fila.
    window.__H03_SET_FILAS__([{
      id: '44444444-4444-4444-8444-444444444444', orden_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      nro_oc: '4530008964', observacion: 'CREADA POR OTRO OPERADOR', estado: 'Pendiente',
      prioridad: 'Normal', creado_por: null, resuelto_por: null,
      fecha_creacion: '2026-08-30T13:00:00.000Z', fecha_resolucion: null
    }]);
    await window.recargarDatosDesdeSupabase();
    await new Promise((r) => setTimeout(r, 700));
    return { envuelto, textos: (window.observacionesOC || []).map((o) => o.texto) };
  });

  expect(resultado.envuelto).toBe(true);
  expect(resultado.textos).toContain('CREADA POR OTRO OPERADOR');
});

test('F9b · el refresh general vuelve a leer Observaciones sin mirar marcas de wrapper', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);

  // Criterio de comportamiento: se ejecuta el refresh general y Observaciones
  // tiene que volver a leerse. No se inspecciona ninguna propiedad de la
  // cadena de wrappers, de modo que sumar o quitar una capa no rompe el test.
  const textos = await page.evaluate(async () => {
    window.__H03_SET_FILAS__([{
      id: '45454545-4545-4545-8454-454545454545', orden_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      nro_oc: '4530008964', observacion: 'RELEIDA POR EL REFRESH GENERAL', estado: 'Pendiente',
      prioridad: 'Normal', creado_por: null, resuelto_por: null,
      fecha_creacion: '2026-08-30T14:00:00.000Z', fecha_resolucion: null
    }]);
    await window.recargarDatosDesdeSupabase();
    await new Promise((r) => setTimeout(r, 700));
    return (window.observacionesOC || []).map((o) => o.texto);
  });

  expect(textos).toContain('RELEIDA POR EL REFRESH GENERAL');
  // Una sola relectura: la cadena de wrappers no puede duplicar el refresh.
  expect(textos.filter((t) => t === 'RELEIDA POR EL REFRESH GENERAL')).toHaveLength(1);
});

test('F10 · el lector de backup no elige el legado por tener mas filas', async ({ page }) => {
  const legadoLargo = Array.from({ length: 31 }, (_, i) => ({
    idObservacion: 'OBS-LEGACY-' + i, ocNro: '4530008964', texto: 'LEGADO ' + i, estadoObservacion: 'Pendiente'
  }));
  await prepararEntorno(page, { filas: [REMOTA], legado: legadoLargo, marker: true });
  await abrir(page);

  const resultado = await page.evaluate(() => {
    // Reproduce exactamente getObs() de V58.1: prefiere el array mas largo.
    let a = Array.isArray(window.observacionesOC) ? window.observacionesOC : [];
    let ls = [];
    try { ls = JSON.parse(localStorage.getItem('coi_observaciones_oc') || '[]'); } catch (e) { ls = []; }
    if (Array.isArray(ls) && ls.length > a.length) a = ls;
    return { elegidas: a.length, textos: a.map((o) => o.texto) };
  });

  // Con el marker puesto, el legado ya no es visible para ningun lector.
  expect(resultado.elegidas).toBe(1);
  expect(resultado.textos).toEqual(['OBSERVACION REMOTA DE SUPABASE']);
});

test('F10b · sin marker el legado sigue disponible como fallback identificado', async ({ page }) => {
  await prepararEntorno(page, { filas: [], legado: LEGACY });
  await abrir(page);

  const crudo = await page.evaluate(() => localStorage.getItem('coi_observaciones_oc'));
  expect(crudo).not.toBeNull();
  expect(JSON.parse(crudo)).toHaveLength(2);
});

test('F-extra · el detalle de resolucion no se duplica al reintentar', async ({ page }) => {
  const conDetalle = Object.assign({}, REMOTA, { observacion: 'BASE\n[Resolucion] YA APLICADO' });
  await prepararEntorno(page, { filas: [conDetalle] });
  await abrir(page);

  await page.evaluate(() => { window.prompt = () => 'YA APLICADO'; });
  await page.evaluate((id) => window.resolverObservacionOC(id), REMOTA.id);
  await page.waitForTimeout(800);
  const e = await estado(page);

  const up = soloOp(e, 'update');
  expect(up).toHaveLength(1);
  // El texto ya contenia ese detalle: no se vuelve a anexar.
  expect(up[0].payload.patch.observacion).toBeUndefined();
});

test('F-extra · el borrado informa trazabilidad y no emite ninguna llamada remota', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);

  await page.evaluate(() => window.borrarObservacionOC('cualquiera'));
  await page.waitForTimeout(300);
  const e = await estado(page);

  expect(soloOp(e, 'delete')).toHaveLength(0);
  expect(e.observaciones).toHaveLength(1);
  expect(SOURCE).toContain('Las observaciones se conservan por trazabilidad');
});

// =============================================== findings sobre c695318

// Boton tal como lo emite procesarAlertas en cada capa.
async function botonAlerta(page, variante, key, textoAccion) {
  await page.evaluate((x) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnAlerta_' + x.variante;
    b.setAttribute('data-' + x.variante + '-alert-to-obs', x.key);
    b.setAttribute('data-' + x.variante + '-alert-text', x.textoAccion);
    b.textContent = 'Enviar a Observaciones';
    document.body.appendChild(b);
  }, { variante, key, textoAccion });
}

test('N1 · el click real en el boton R14 genera exactamente un INSERT remoto', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);
  await sembrarOC(page);
  await botonAlerta(page, 'r14', '4530008964', 'ACCION SUGERIDA R14');

  await page.evaluate(() => document.getElementById('btnAlerta_r14').click());
  await page.waitForTimeout(800);
  const e = await estado(page);

  const ins = soloOp(e, 'insert');
  expect(ins).toHaveLength(1);
  expect(ins[0].payload.observacion).toBe('ACCION SUGERIDA R14');
  expect(ins[0].payload.orden_id).toBe(ORDEN_ID);
  expect(e.escriturasLegacy).toEqual([]);
});

test('N1b · el click real en el boton R15 genera exactamente un INSERT remoto', async ({ page }) => {
  await prepararEntorno(page, { filas: [], marker: true });
  await abrir(page);
  await sembrarOC(page);
  await botonAlerta(page, 'r15', '4530008964', 'ACCION SUGERIDA R15');

  await page.evaluate(() => document.getElementById('btnAlerta_r15').click());
  await page.waitForTimeout(800);
  const e = await estado(page);

  const ins = soloOp(e, 'insert');
  expect(ins).toHaveLength(1);
  expect(ins[0].payload.observacion).toBe('ACCION SUGERIDA R15');
  expect(e.escriturasLegacy).toEqual([]);
});

test('N2 · sin rol administrador el click real en Editar no pide texto ni actualiza', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA], admin: false });
  await abrir(page);
  await fijarAdmin(page, false);

  const resultado = await page.evaluate((id) => {
    let promptAbierto = false;
    window.prompt = () => { promptAbierto = true; return 'NO DEBERIA LLEGAR'; };
    const cont = document.createElement('div');
    cont.innerHTML = '<button type="button" id="btnEditNoAdmin" data-r13-edit-obs="' + id + '">Editar</button>';
    document.body.appendChild(cont);
    document.getElementById('btnEditNoAdmin').click();
    return { promptAbierto };
  }, REMOTA.id);
  await page.waitForTimeout(600);
  const e = await estado(page);

  expect(resultado.promptAbierto).toBe(false);
  expect(soloOp(e, 'update')).toHaveLength(0);
  expect(e.observaciones[0].texto).toBe('OBSERVACION REMOTA DE SUPABASE');
});

test('N2b · con rol administrador el click real en Editar produce exactamente un UPDATE', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA], admin: true });
  await abrir(page);
  await fijarAdmin(page, true);

  await page.evaluate((id) => {
    window.prompt = () => 'EDITADO POR ADMIN';
    const cont = document.createElement('div');
    cont.innerHTML = '<button type="button" id="btnEditAdmin" data-r13-edit-obs="' + id + '">Editar</button>';
    document.body.appendChild(cont);
    document.getElementById('btnEditAdmin').click();
  }, REMOTA.id);
  await page.waitForTimeout(800);
  const e = await estado(page);

  expect(soloOp(e, 'update')).toHaveLength(1);
  expect(e.observaciones[0].texto).toBe('EDITADO POR ADMIN');
});

test('N3 · el click real en btnSupabaseSync recarga las observaciones', async ({ page }) => {
  test.slow();
  await prepararEntorno(page, { filas: [REMOTA], marker: true });
  await abrir(page);
  let e = await estado(page);
  expect(e.observaciones.map((o) => o.texto)).toEqual(['OBSERVACION REMOTA DE SUPABASE']);

  await page.evaluate(() => {
    window.__H03_SET_FILAS__([
      {
        id: '11111111-1111-4111-8111-111111111111', orden_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        nro_oc: '4530008964', observacion: 'OBSERVACION REMOTA DE SUPABASE', estado: 'Pendiente',
        prioridad: 'Normal', creado_por: null, resuelto_por: null,
        fecha_creacion: '2026-08-30T10:00:00.000Z', fecha_resolucion: null
      },
      {
        id: '55555555-5555-4555-8555-555555555555', orden_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        nro_oc: '4530008964', observacion: 'OBS B DE OTRO OPERADOR', estado: 'Pendiente',
        prioridad: 'Normal', creado_por: null, resuelto_por: null,
        fecha_creacion: '2026-08-30T14:00:00.000Z', fecha_resolucion: null
      }
    ]);
    // Boton real del header, con su id de produccion.
    if (!document.getElementById('btnSupabaseSync')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'btnSupabaseSync'; b.textContent = 'Recargar';
      document.body.appendChild(b);
    }
    document.getElementById('btnSupabaseSync').click();
  });

  await page.waitForFunction(
    () => (window.observacionesOC || []).some((o) => o.texto === 'OBS B DE OTRO OPERADOR'),
    null, { timeout: 15000 }
  );
  e = await estado(page);
  expect(e.observaciones.map((o) => o.texto)).toContain('OBS B DE OTRO OPERADOR');
});

test('N4 · si el catalogo de OC llega despues, la observacion se remapea sin recargar', async ({ page }) => {
  test.slow();
  const conNroViejo = Object.assign({}, REMOTA, { nro_oc: '4530000000-VIEJO' });
  await prepararEntorno(page, { filas: [conNroViejo] });
  // El catalogo arranca vacio: el mapper no puede derivar el nro_oc canonico.
  await page.addInitScript(() => { window.todasLasOC = () => ([]); });
  await abrir(page);

  let e = await estado(page);
  expect(e.observaciones[0].ocNro).toBe('4530000000-VIEJO');
  const selectsAntes = soloOp(e, 'select').length;

  // Recien ahora termina de cargar el catalogo maestro de OC.
  await sembrarOC(page, { nro: '4530099999', id: ORDEN_ID });
  await page.waitForFunction(
    () => (window.observacionesOC || [])[0] && window.observacionesOC[0].ocNro === '4530099999',
    null, { timeout: 15000 }
  );
  e = await estado(page);

  expect(e.observaciones[0].ocNro).toBe('4530099999');
  // El remapeo usa las filas crudas guardadas: no dispara otra consulta remota.
  expect(soloOp(e, 'select').length).toBe(selectsAntes);
});

test('N5 · el panel ya no afirma que las observaciones se guardan en localStorage', () => {
  expect(SOURCE).not.toContain('Las observaciones se guardan en localStorage');
  expect(SOURCE).toContain('Las observaciones se sincronizan con Supabase');
});

test('N6 · resolver compone sobre el texto vigente en el servidor, no sobre el de memoria', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);

  const resultado = await page.evaluate(async (id) => {
    // La memoria queda con el texto viejo; el servidor tiene una edicion posterior.
    (window.observacionesOC || []).forEach((o) => { if (o.idObservacion === id) o.texto = 'Texto viejo'; });
    window.__H03_SET_FILAS__([{
      id: id, orden_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nro_oc: '4530008964',
      observacion: 'Texto editado por otro operador', estado: 'Pendiente', prioridad: 'Normal',
      creado_por: null, resuelto_por: null, fecha_creacion: '2026-08-30T10:00:00.000Z', fecha_resolucion: null
    }]);
    window.prompt = () => 'Finalizado';
    window.resolverObservacionOC(id);
    await new Promise((r) => setTimeout(r, 1500));
    return window.__H03_LLAMADAS__.filter((l) => l.op === 'update');
  }, REMOTA.id);

  expect(resultado).toHaveLength(1);
  const nuevo = resultado[0].payload.patch.observacion;
  expect(nuevo).toContain('Texto editado por otro operador');
  expect(nuevo).toContain('[Resolucion] Finalizado');
  expect(nuevo).not.toContain('Texto viejo');
});

test('N6b · si la relectura del servidor falla, resolver no escribe texto obsoleto', async ({ page }) => {
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);

  const resultado = await page.evaluate(async (id) => {
    window.__H03_CFG__.fallaSelect = true;
    window.prompt = () => 'Finalizado';
    window.resolverObservacionOC(id);
    await new Promise((r) => setTimeout(r, 1500));
    return window.__H03_LLAMADAS__.filter((l) => l.op === 'update');
  }, REMOTA.id);

  expect(resultado).toHaveLength(0);
});

// =============================================== findings sobre a4bd955

test('N7 · un remapeo diferido no repuebla despues de un SIGNED_OUT', async ({ page }) => {
  test.slow();
  const conNroViejo = Object.assign({}, REMOTA, { nro_oc: '4530000000-VIEJO' });
  await prepararEntorno(page, { filas: [conNroViejo] });
  // Sin catalogo el mapper no puede canonizar el nro_oc: queda remapeo pendiente.
  await page.addInitScript(() => { window.todasLasOC = () => ([]); });
  await abrir(page);
  expect((await estado(page)).observaciones).toHaveLength(1);

  const resultado = await page.evaluate(async () => {
    window.__H03_SIGN_OUT__();
    // Recien despues del cierre de sesion aparece el catalogo de OC: el timer
    // diferido de la sesion anterior no debe reinstalar esas filas.
    window.todasLasOC = () => ([{ oc: '4530099999', item: { numeroOC: '4530099999', supabaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', idObra: 'OB-1' } }]);
    await new Promise((r) => setTimeout(r, 12000));
    return (window.observacionesOC || []).map((o) => o.texto);
  });

  expect(resultado).toEqual([]);
});

test('N8 · el cambio de USUARIO descarta los nombres de perfil resueltos', async ({ page }) => {
  test.slow();
  await prepararEntorno(page, {
    filas: [REMOTA],
    perfiles: [{ id: USUARIO, nombre: 'ADMIN VISIBLE', email: 'admin@coiroca.com' }]
  });
  await abrir(page);
  let e = await estado(page);
  expect(e.observaciones[0].usuarioCarga).toBe('ADMIN VISIBLE');

  // Mismo usuario: un TOKEN_REFRESHED no puede tirar la cache ni el modelo.
  await page.evaluate(async () => {
    window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'TOKEN_REFRESHED' } }));
    await new Promise((r) => setTimeout(r, 1200));
  });
  e = await estado(page);
  expect(e.observaciones[0].usuarioCarga).toBe('ADMIN VISIBLE');

  // Otro usuario: su RLS no autoriza ese perfil, la cache no debe filtrarlo.
  await page.evaluate(async () => {
    window.__H03_CFG__.perfiles = [];
    window.__H03_SET_UID__('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'SIGNED_IN' } }));
    await new Promise((r) => setTimeout(r, 1500));
  });
  e = await estado(page);
  expect(e.observaciones[0].usuarioCarga).not.toBe('ADMIN VISIBLE');
});

test('N9 · editar no borra el detalle de resolucion ya persistido', async ({ page }) => {
  const resuelta = Object.assign({}, REMOTA, {
    observacion: 'TEXTO ORIGINAL' + String.fromCharCode(10) + '[Resolucion] Cerrado con acta',
    estado: 'Resuelta'
  });
  await prepararEntorno(page, { filas: [resuelta], admin: true });
  await abrir(page);
  await fijarAdmin(page, true);

  const propuesto = await page.evaluate(async (id) => {
    let visto = null;
    window.prompt = (_t, valor) => { visto = valor; return 'TEXTO CORREGIDO'; };
    const cont = document.createElement('div');
    cont.innerHTML = '<button type="button" id="btnEditRes" data-r13-edit-obs="' + id + '">Editar</button>';
    document.body.appendChild(cont);
    document.getElementById('btnEditRes').click();
    await new Promise((r) => setTimeout(r, 900));
    return visto;
  }, REMOTA.id);
  const e = await estado(page);

  // El prompt propone solo el texto editable, sin la traza de resolucion.
  expect(propuesto).toBe('TEXTO ORIGINAL');
  const ups = soloOp(e, 'update');
  expect(ups).toHaveLength(1);
  expect(ups[0].payload.patch.observacion).toContain('TEXTO CORREGIDO');
  expect(ups[0].payload.patch.observacion).toContain('[Resolucion] Cerrado con acta');
});

// =============================================== findings sobre 43cdc08

test('N10 · un TOKEN_REFRESHED del mismo usuario no convierte un fallo de lectura en cero', async ({ page }) => {
  test.slow();
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);
  let e = await estado(page);
  expect(e.observaciones).toHaveLength(1);
  expect(e.marker).toBe('1');

  await page.evaluate(async () => {
    // Mismo usuario: solo se renovo el token. La relectura posterior falla.
    window.__H03_CFG__.fallaSelect = true;
    window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'TOKEN_REFRESHED' } }));
    await new Promise((r) => setTimeout(r, 2500));
  });
  e = await estado(page);

  // El dataset confirmado sigue en pantalla: un refresh de token no puede
  // producir un cero falso.
  expect(e.observaciones.map((o) => o.texto)).toEqual(['OBSERVACION REMOTA DE SUPABASE']);
  expect(e.sincronizado).toBe(false);
  expect(e.origen).toBe('error-sin-sincronizar');
});

test('N10b · un SIGNED_IN con otro usuario si descarta el dataset de la sesion anterior', async ({ page }) => {
  test.slow();
  await prepararEntorno(page, { filas: [REMOTA] });
  await abrir(page);
  expect((await estado(page)).observaciones).toHaveLength(1);

  await page.evaluate(async () => {
    window.__H03_CFG__.fallaSelect = true;
    window.__H03_SET_UID__('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'SIGNED_IN' } }));
    await new Promise((r) => setTimeout(r, 2500));
  });
  const e = await estado(page);

  // Otro usuario no puede heredar lo que vio el anterior.
  expect(e.observaciones).toHaveLength(0);
});

test('N11 · una respuesta de profiles de la sesion anterior no escribe en la cache nueva', async ({ page }) => {
  test.slow();
  await prepararEntorno(page, {
    filas: [REMOTA],
    perfiles: [{ id: USUARIO, nombre: 'ADMIN VISIBLE', email: 'admin@coiroca.com' }],
    retardoPerfilesMs: 3000
  });
  await abrirSinEsperarCarga(page);

  const resultado = await page.evaluate(async () => {
    // La request de profiles de la sesion A sigue en vuelo. Entra el usuario B,
    // cuya RLS no autoriza ese perfil, y su propia lectura tarda mas que la
    // respuesta pendiente de A.
    await new Promise((r) => setTimeout(r, 300));
    window.__H03_CFG__.perfiles = [];
    window.__H03_CFG__.retardoPerfilesMs = 0;
    window.__H03_CFG__.retardoSelectMs = 4000;
    window.__H03_SET_UID__('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'SIGNED_IN' } }));
    await new Promise((r) => setTimeout(r, 9000));
    return (window.observacionesOC || []).map((o) => o.usuarioCarga);
  });

  expect(resultado).toHaveLength(1);
  expect(resultado[0]).not.toBe('ADMIN VISIBLE');
  // Identidad neutra derivada del UUID, nunca un nombre de la sesion anterior.
  expect(resultado[0]).toContain('Usuario');
});

test('N12 · editar no pisa en silencio una edicion concurrente de otro puesto', async ({ page }) => {
  test.slow();
  await prepararEntorno(page, { filas: [REMOTA], admin: true });
  await abrir(page);
  await fijarAdmin(page, true);

  const propuesto = await page.evaluate(async (id) => {
    // Lo que este puesto tiene en memoria es lo que vio el operador.
    let visto = null;
    window.prompt = (_t, valor) => { visto = valor; return 'TEXTO C DE ESTE PUESTO'; };
    // Otro operador ya dejo otra version en el servidor.
    window.__H03_SET_FILAS__([{
      id: id, orden_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nro_oc: '4530008964',
      observacion: 'TEXTO B DE OTRO PUESTO', estado: 'Pendiente', prioridad: 'Normal',
      creado_por: null, resuelto_por: null,
      fecha_creacion: '2026-08-30T10:00:00.000Z', fecha_resolucion: null
    }]);
    const cont = document.createElement('div');
    cont.innerHTML = '<button type="button" id="btnEditConflicto" data-r13-edit-obs="' + id + '">Editar</button>';
    document.body.appendChild(cont);
    document.getElementById('btnEditConflicto').click();
    await new Promise((r) => setTimeout(r, 1500));
    return visto;
  }, REMOTA.id);
  const e = await estado(page);

  expect(propuesto).toBe('OBSERVACION REMOTA DE SUPABASE');
  // Ningun UPDATE: no hay last-writer-wins silencioso.
  expect(soloOp(e, 'update')).toHaveLength(0);
  // El texto del otro puesto sobrevive y es lo que se muestra tras la recarga.
  expect(e.observaciones.map((o) => o.texto)).toEqual(['TEXTO B DE OTRO PUESTO']);
  const aviso = await page.evaluate(() => {
    const caja = document.getElementById('coiToastV581');
    return caja ? caja.textContent : '';
  });
  expect(aviso).toContain('cambió en otro puesto');
});

test('N13 · con legado pendiente de migrar ninguna mutacion llega a Supabase', async ({ page }) => {
  test.slow();
  // Supabase vacio y sin marcador: el legado historico se muestra en solo lectura.
  await prepararEntorno(page, { filas: [], legado: LEGACY });
  await abrir(page);
  await sembrarOC(page);
  await fijarAdmin(page, true);
  let e = await estado(page);
  expect(e.origen).toBe('legacy-readonly');
  expect(e.observaciones).toHaveLength(2);

  await page.evaluate(async (id) => {
    window.prompt = () => 'NO DEBERIA LLEGAR';
    // 1) alta comun desde la ficha de OC
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'ALTA DURANTE EL CUTOVER';
    document.body.appendChild(ta);
    window.guardarObservacionOC('4530008964');
    // 2) accion del Centro de Alertas
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnAlertaCutover';
    b.setAttribute('data-r15-alert-to-obs', '4530008964');
    b.setAttribute('data-r15-alert-text', 'ALERTA DURANTE EL CUTOVER');
    document.body.appendChild(b);
    b.click();
    // 3) editar y resolver sobre la fila legada
    window.editarObservacionR13(id);
    window.resolverObservacionOC(id);
    window.reabrirObservacionOC(id);
    await new Promise((r) => setTimeout(r, 1500));
  }, LEGACY[0].idObservacion);
  e = await estado(page);

  expect(soloOp(e, 'insert')).toHaveLength(0);
  expect(soloOp(e, 'update')).toHaveLength(0);
  expect(soloOp(e, 'delete')).toHaveLength(0);
  // El legado sigue visible y nada se escribio en localStorage.
  expect(e.observaciones).toHaveLength(2);
  expect(e.marker).toBeNull();
  expect(e.escriturasLegacy).toEqual([]);
});

test('N13b · sin legado pendiente el alta comun sigue funcionando', async ({ page }) => {
  // Instalacion limpia: Supabase vacio y sin legado. El gate del cutover no
  // debe bloquear el caso legitimo.
  await prepararEntorno(page, { filas: [] });
  await abrir(page);
  await sembrarOC(page);

  await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'PRIMERA OBSERVACION DE LA INSTALACION';
    document.body.appendChild(ta);
    window.guardarObservacionOC('4530008964');
  });
  await page.waitForTimeout(900);
  const e = await estado(page);

  const ins = soloOp(e, 'insert');
  expect(ins).toHaveLength(1);
  expect(ins[0].payload.observacion).toBe('PRIMERA OBSERVACION DE LA INSTALACION');
  expect(e.escriturasLegacy).toEqual([]);
});
