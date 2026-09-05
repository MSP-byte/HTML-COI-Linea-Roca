const { test, expect } = require('@playwright/test');

/*
  H07 — cierre Supabase-first.

  H07 NO crea un modelo documental nuevo. La baseline vigente manda:

    AGENTS.md          · «No reintroducir OneDrive ni `Agregar link documental`
                          en Ficha OC.»
                       · «Supabase Storage y las tablas documentales vigentes
                          son el camino activo.»

  Por eso la documentacion por referencia externa queda RETIRADA del modelo
  operacional —conservada, exportable y nunca autoimportada— y el camino activo
  sigue siendo Supabase Storage + public.coi_documentos_oc.

  Criterio que fijan estas pruebas: NINGUN dato operacional se reconstruye desde
  localStorage, y ninguna accion retirada puede anunciar exito sin autoridad.

  Supabase se intercepta con un cliente falso: no se toca ningun dato real.
*/

const UID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDEN_ID = '11111111-1111-4111-8111-111111111111';
const ORDEN_NRO = '4530007777';

const OC_REMOTA = {
  id: ORDEN_ID,
  nro_oc: ORDEN_NRO,
  id_obra: 'OBRA-H07',
  tipo: 'Servicio',
  estacion: 'PLAZA CONSTITUCION',
  proveedor: 'PROVEEDOR H07',
  estado_coi: 'En ejecución',
  monto_total: 1000,
  plazo_dias: 30
};

// Documentacion que solo existe en localStorage: material historico retirado.
const DOC_LEGADO = [{
  idDocumento: 'DOC-OC-LEGADO-H07',
  ocNro: ORDEN_NRO,
  idObra: 'OBRA-H07',
  tipoDocumento: 'Acta de Medición',
  nroDocumento: '99',
  nombreArchivo: 'acta_legado_99.pdf',
  repositorio: 'OneDrive',
  linkDocumento: 'https://example.test/legado99.pdf',
  estadoDocumento: 'Pendiente',
  observaciones: 'DOCUMENTO SOLO LOCAL H07'
}];

// Forma V33: campos distintos (nOC / tipo). Tampoco puede entrar al modelo.
const DOC_LEGADO_V33 = [{
  idDoc: 'DOC-V33-H07',
  nOC: ORDEN_NRO,
  tipo: 'Remito',
  archivo: 'remito_v33.pdf'
}];

const OBS_LEGADA = [{
  idObservacion: 'OBS-A-LOCAL',
  ocNro: ORDEN_NRO,
  texto: 'OBSERVACION LOCAL SIN CONCILIAR',
  estadoObservacion: 'Abierta'
}];

// Misma observacion, guardada con los alias que tambien acepta la
// normalizacion canonica: numeroOC en lugar de ocNro y descripcion en lugar de
// texto. La conciliacion tiene que reconocerla igual.
const OBS_LEGADA_ALIAS = [{
  idObservacion: 'OBS-ALIAS-LOCAL',
  numeroOC: ORDEN_NRO,
  descripcion: 'OBSERVACION CON ALIAS LEGADOS',
  estadoObservacion: 'Abierta'
}];

const POSICION_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const POSICION_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const obsLegadaRepetida = (n) => Array.from({ length: n }, (_, i) => ({
  idObservacion: 'OBS-DUP-' + (i + 1),
  ocNro: ORDEN_NRO,
  texto: 'FALTA FIRMA',
  estadoObservacion: 'Abierta'
}));

// El marcador de corte ya no es un '1' pelado: guarda la HUELLA del contenido
// legado que se dio por conciliado, para que un cambio posterior de la clave
// reabra la cuarentena en vez de quedar oculto para siempre.
const marcadorConHuella = (crudo) => {
  if (!crudo) return false;
  try {
    const m = JSON.parse(crudo);
    return m.v === 2 && typeof m.huella === 'string' && m.huella.length > 0;
  } catch (e) { return false; }
};

const obsRemota = (id, texto) => ({
  id,
  orden_id: ORDEN_ID,
  nro_oc: ORDEN_NRO,
  observacion: texto,
  estado: 'Abierta',
  creado_por: UID_A,
  fecha_creacion: '2026-08-03T10:00:00.000Z',
  fecha_actualizacion: '2026-08-03T10:00:00.000Z'
});

// Observacion remota que NO tiene nada que ver con la legada.
const OBS_REMOTA_AJENA = {
  id: '44444444-4444-4444-8444-444444444444',
  orden_id: ORDEN_ID,
  nro_oc: ORDEN_NRO,
  observacion: 'OBSERVACION REMOTA AJENA',
  estado: 'Abierta',
  creado_por: UID_A,
  fecha_creacion: '2026-08-02T10:00:00.000Z',
  fecha_actualizacion: '2026-08-02T10:00:00.000Z'
};

async function prepararH07(page, opciones = {}) {
  const cfg = Object.assign({
    ordenes: [OC_REMOTA],
    observaciones: [],
    eventos: [],
    rol: 'administrador',
    legadoDocumental: true,
    legadoV33: false,
    legadoObservaciones: false,
    // Retardo artificial de la lectura remota de observaciones: reproduce el
    // puesto con red lenta, en el que el modelo NO puede seguir mostrando lo
    // que dejo publicado el inicializador legado.
    demoraObs: 0,
    // Posiciones financieras remotas, para el camino real de borrado.
    posiciones: [],
    consumos: [],
    marcadorH03: true
  }, opciones);
  const obsLegadas = opciones.legadoObsFilas || OBS_LEGADA;

  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());

  await page.addInitScript(({ c, docLegado, docV33, obsLegada, uidInicial }) => {
    window.__H07_CFG__ = c;
    window.__H07_LLAMADAS__ = [];
    if (c.legadoDocumental) localStorage.setItem('coi_documentacion_oc', JSON.stringify(docLegado));
    if (c.legadoV33) localStorage.setItem('coiDocumentos', JSON.stringify(docV33));
    if (c.legadoObservaciones) localStorage.setItem('coi_observaciones_oc', JSON.stringify(obsLegada));
    if (c.marcadorH03) localStorage.setItem('coi_observaciones_h03_imported_v1', '1');
    localStorage.setItem('coi_v2_theme', 'dark');

    let uid = uidInicial;
    let activa = true;
    const oyentes = [];
    let observaciones = c.observaciones.slice();
    window.__H07_OBS__ = () => observaciones;
    window.__H07_SET_OBS__ = (v) => { observaciones = Array.isArray(v) ? v.slice() : []; };

    window.__H07_EVENTO_AUTH__ = (evento, nuevoUid) => {
      if (evento === 'SIGNED_OUT') { uid = null; activa = false; }
      else if (nuevoUid) { uid = nuevoUid; activa = true; }
      const session = activa ? { user: { id: uid, email: uid + '@coiroca.test' } } : null;
      oyentes.forEach((fn) => { try { fn(evento, session); } catch (e) {} });
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: evento, session } }));
    };

    const registrar = (op, payload) => window.__H07_LLAMADAS__.push({ op, payload });

    function consulta(tabla) {
      const st = { tabla, filtros: [], op: null, payload: null, patch: null };
      const cumple = (f) => st.filtros.every((x) => {
        if (x.op === 'gt') return String(f[x.col]) > String(x.val);
        return String(f[x.col]) === String(x.val);
      });
      const api = {
        select() { return api; }, order() { return api; }, range() { return api; },
        limit() { return api; }, in() { return api; }, is() { return api; }, ilike() { return api; },
        eq(col, val) { st.filtros.push({ op: 'eq', col, val }); return api; },
        gt(col, val) { st.filtros.push({ op: 'gt', col, val }); return api; },
        insert(v) { st.op = 'insert'; st.payload = v; return api; },
        update(v) { st.op = 'update'; st.patch = v; return api; },
        delete() { st.op = 'delete'; return api; },
        single() { return api._run(true); },
        async _run(unico) {
          if (!activa) return { data: null, error: { message: 'JWT ausente' } };
          if (st.op) { registrar(st.op + ':' + st.tabla, st.payload || st.patch); return { data: [], error: null }; }
          registrar('select:' + st.tabla, st.filtros);
          // Solo la PRIMERA lectura de observaciones se demora: es la ventana
          // que interesa —arranque con red lenta— y asi el resto de la prueba
          // sigue corriendo a velocidad normal.
          const demora = Number(window.__H07_CFG__.demoraObs || 0);
          if (demora && st.tabla === 'coi_observaciones_oc' && !window.__H07_DEMORADA__) {
            window.__H07_DEMORADA__ = true;
            await new Promise((r) => setTimeout(r, demora));
          }
          const tablas = {
            coi_ordenes: window.__H07_CFG__.ordenes,
            coi_observaciones_oc: observaciones,
            coi_posiciones_oc: window.__H07_CFG__.posiciones || [],
            coi_consumos_posicion: window.__H07_CFG__.consumos || []
          };
          const base = tablas[st.tabla] || [];
          return { data: base.filter(cumple), error: null };
        },
        then(res, rej) { return api._run(false).then(res, rej); }
      };
      return api;
    }

    const fake = {
      from: (t) => consulta(t),
      rpc: async (nombre) => {
        registrar('rpc:' + nombre, null);
        if (!activa) return { data: null, error: null };
        if (nombre === 'coi_current_role') return { data: window.__H07_CFG__.rol, error: null };
        if (nombre === 'coi_timeline_list_page') return { data: window.__H07_CFG__.eventos, error: null };
        return { data: null, error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: activa ? { user: { id: uid, email: uid + '@coiroca.test' } } : null }, error: null }),
        getUser: async () => ({ data: { user: activa ? { id: uid } : null }, error: null }),
        onAuthStateChange: (fn) => { oyentes.push(fn); return { data: { subscription: { unsubscribe() {} } } }; }
      }
    };
    window.__COI_SUPABASE_CLIENT__ = fake;
    window.getSupabaseClient = () => fake;
    window.initSupabase = async () => fake;
    window.getUsuarioActual = async () => (activa ? { id: uid, email: uid + '@coiroca.test' } : null);
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.mostrarMensajeCOI = () => {};
    window.confirm = () => true;
    window.__H07_TOASTS__ = [];
    window.coiToast = (m) => window.__H07_TOASTS__.push(String(m));
    window.__H07_ALERTAS__ = [];
    window.alert = (m) => window.__H07_ALERTAS__.push(String(m));
  }, { c: cfg, docLegado: DOC_LEGADO, docV33: DOC_LEGADO_V33, obsLegada: obsLegadas, uidInicial: UID_A });
}

// Abre la Ficha OC y activa el sector 7. Observaciones: es el sector real donde
// el operador se topa con el bloqueo de la cuarentena, y donde vive su salida.
async function abrirObservaciones(page) {
  await page.evaluate(() => {
    const filas = typeof window.todasLasOC === 'function' ? window.todasLasOC() : [];
    const clave = filas[0] && filas[0].item && (filas[0].item.idObra || filas[0].item.idOC);
    window.abrirFichaOC(clave || (filas[0] && filas[0].oc));
    if (typeof window.activarSubmoduloFichaOC === 'function') {
      window.activarSubmoduloFichaOC('panelFichaObservaciones');
    }
  });
  await page.waitForSelector('#panelFichaObservaciones', { timeout: 10000 });
}

async function abrirH07(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_DOCUMENTACION_H07), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  return errores;
}

const radiografia = (page) => page.evaluate(() => {
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    diag: window.COI_DOCUMENTACION_H07.diagnostico(),
    docsOperativos: arr(window.documentacionOC).length,
    v62: (typeof window.v62DocsGlobales === 'function' ? window.v62DocsGlobales() : []).length,
    legadoIntacto: localStorage.getItem('coi_documentacion_oc') !== null,
    v33Intacto: localStorage.getItem('coiDocumentos') !== null,
    tema: localStorage.getItem('coi_v2_theme'),
    alertas: arr(window.__H07_ALERTAS__),
    llamadas: arr(window.__H07_LLAMADAS__).map((l) => l.op)
  };
});

// ================================== 1 · el modelo documental legado esta fuera

test('H07-1 · la documentación legada no entra al modelo operacional y se conserva', async ({ page }) => {
  await prepararH07(page, { legadoV33: true });
  const errores = await abrirH07(page);

  const r = await radiografia(page);
  expect(r.diag.estado).toBe('retirada');
  expect(r.diag.tablaActiva).toBe('coi_documentos_oc');
  // Ni una fila local llega al modelo operativo…
  expect(r.docsOperativos).toBe(0);
  expect(r.v62).toBe(0);
  // …y el material historico sigue intacto en sus claves.
  expect(r.legadoIntacto).toBe(true);
  expect(r.v33Intacto).toBe(true);
  expect(r.diag.legadoFilas).toBeGreaterThanOrEqual(1);
  expect(errores).toEqual([]);
});

test('H07-2 · republicar documentacionOC desde una capa legada se ignora', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  const resultado = await page.evaluate(() => {
    window.documentacionOC = [{ idDocumento: 'DOC-OC-LEGADO-H07', tipoDocumento: 'Acta' }];
    return { largo: window.documentacionOC.length, bloqueadas: window.__COI_DOC_H07_ESCRITURAS__.length };
  });
  expect(resultado.largo).toBe(0);
  expect(resultado.bloqueadas).toBeGreaterThan(0);
});

test('H07-3 · el legado documental se puede exportar y nunca se autoimporta', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  const exportado = await page.evaluate(() => JSON.parse(window.__COI_DOC_H07_LEGACY__.exportarJSON()));
  expect(exportado.autoritativo).toBe(false);
  expect(exportado.filas.length).toBeGreaterThanOrEqual(1);

  const r = await radiografia(page);
  // No existe ninguna escritura documental automatica.
  expect(r.llamadas.filter((o) => String(o).indexOf('insert:') === 0)).toHaveLength(0);
  expect(r.legadoIntacto).toBe(true);
});

// ================================ 2 · acciones retiradas no anuncian exito

test('H07-4 · las acciones del editor documental retirado no escriben nada', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  const salida = await page.evaluate(() => ({
    guardar: window.v64GuardarDocumentoDesdeForm({ dataset: { ocKey: 'X', docId: '__new__' } }),
    eliminar: window.v64EliminarDocumento('DOC-OC-LEGADO-H07'),
    carpeta: window.v64GuardarCarpetaOC('X'),
    migrar: window.v64MigrarDocsEmbebidos(),
    cargar: window.v64CargarDocumentacionOC().length,
    guardarLista: window.v64GuardarDocumentacionOC().length
  }));

  // Ninguna promete exito.
  expect(salida.guardar).toBe(false);
  expect(salida.eliminar).toBe(false);
  expect(salida.carpeta).toBe(false);
  expect(salida.migrar).toBe(false);
  expect(salida.cargar).toBe(0);
  expect(salida.guardarLista).toBe(0);

  const r = await radiografia(page);
  expect(r.docsOperativos).toBe(0);
  expect(r.legadoIntacto).toBe(true);
  // Y no se escribio la clave documental.
  const crudo = await page.evaluate(() => localStorage.getItem('coi_documentacion_oc'));
  expect(crudo).toContain('DOC-OC-LEGADO-H07');
});

test('H07-5 · «Limpiar documentación global» no anuncia éxito ni borra nada', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'btnV64LimpiarDocGlobal';
    document.body.appendChild(b);
    b.click();
  });
  await page.waitForTimeout(300);

  const r = await radiografia(page);
  expect(r.legadoIntacto).toBe(true);
  expect(r.docsOperativos).toBe(0);
});

// ============================== 3 · Timeline: la señal no rebota (F6)

test('H07-6 · un ping de otra pestaña produce UNA relectura y no un eco', async ({ page }) => {
  await prepararH07(page, { eventos: [] });
  await abrirH07(page);

  const antes = await page.evaluate(() => ({
    lecturas: window.__H07_LLAMADAS__.filter((l) => l.op === 'rpc:coi_timeline_list_page').length,
    ping: localStorage.getItem('coi_timeline_sync_ping_v1')
  }));

  // Se simula el evento `storage` que emitiria OTRA pestaña.
  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'coi_timeline_sync_ping_v1',
      newValue: JSON.stringify({ en: new Date().toISOString(), eventos: 0 })
    }));
  });
  await page.waitForTimeout(1500);

  const despues = await page.evaluate(() => ({
    lecturas: window.__H07_LLAMADAS__.filter((l) => l.op === 'rpc:coi_timeline_list_page').length,
    ping: localStorage.getItem('coi_timeline_sync_ping_v1')
  }));

  // Hubo relectura…
  expect(despues.lecturas).toBeGreaterThan(antes.lecturas);
  // …y NO se reemitio la señal: el ping no cambio, de modo que la otra pestaña
  // no vuelve a dispararse. Sin esto las pestañas se releian sin fin.
  expect(despues.ping).toBe(antes.ping);
});

// ==================== 4 · cuarentena de observaciones (F11 · F16)

test('H07-7 · una observación remota ajena NO libera la cuarentena del legado local', async ({ page }) => {
  // localStorage tiene OBS-A; Supabase tiene OBS-B, que no tiene relacion.
  await prepararH07(page, {
    legadoObservaciones: true,
    marcadorH03: false,
    observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);

  const estado = await page.evaluate(() => ({
    origen: window.__COI_OBS_H03__.origen,
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    pendientes: window.__COI_OBS_H07_CUARENTENA__.pendientes().map((o) => String(o.texto || '')),
    modelo: (window.observacionesOC || []).map((o) => String(o.texto || '')),
    marcador: localStorage.getItem('coi_observaciones_h03_imported_v1'),
    claveIntacta: localStorage.getItem('coi_observaciones_oc') !== null
  }));

  // El remoto manda en el modelo…
  expect(estado.origen).toBe('supabase');
  expect(estado.modelo).toContain('OBSERVACION REMOTA AJENA');
  expect(estado.modelo).not.toContain('OBSERVACION LOCAL SIN CONCILIAR');
  // …pero OBS-A sigue pendiente: una fila remota ajena no la concilia.
  expect(estado.cuarentena).toBe(1);
  expect(estado.pendientes).toEqual(['OBSERVACION LOCAL SIN CONCILIAR']);
  // El corte NO se dio por cumplido y el material sigue intacto.
  expect(estado.marcador).toBeNull();
  expect(estado.claveIntacta).toBe(true);
});

test('H07-8 · con la cuarentena pendiente ninguna mutación llega a Supabase', async ({ page }) => {
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);
  expect(await page.evaluate(() => window.__COI_OBS_H03__.legadoEnCuarentena)).toBe(1);

  await page.evaluate(async () => {
    window.prompt = () => 'NO DEBERIA LLEGAR';
    const ta = document.createElement('textarea');
    ta.id = 'v65NuevaObservacion';
    ta.value = 'ALTA DURANTE LA CUARENTENA';
    document.body.appendChild(ta);
    try { window.guardarObservacionOC('4530007777'); } catch (e) {}
    await new Promise((r) => setTimeout(r, 800));
  });

  const ops = await page.evaluate(() =>
    window.__H07_LLAMADAS__.filter((l) => /^(insert|update|delete):coi_observaciones_oc/.test(l.op)).length);
  expect(ops).toBe(0);
});

test('H07-9 · conciliar libera la cuarentena solo cuando la fila ya está en Supabase', async ({ page }) => {
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);

  // Todavia falta OBS-A: conciliar no puede liberar nada.
  const parcial = await page.evaluate(() => window.__COI_OBS_H07_CUARENTENA__.conciliar());
  expect(parcial.resuelta).toBe(false);
  expect(parcial.pendientes).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('coi_observaciones_h03_imported_v1'))).toBeNull();

  // Ahora la fila SI existe en el remoto: la conciliacion la reconoce.
  const resuelta = await page.evaluate(async () => {
    window.__H07_SET_OBS__(window.__H07_OBS__().concat([{
      id: '55555555-5555-4555-8555-555555555555',
      orden_id: '11111111-1111-4111-8111-111111111111',
      nro_oc: '4530007777',
      observacion: 'OBSERVACION LOCAL SIN CONCILIAR',
      estado: 'Abierta',
      creado_por: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      fecha_creacion: '2026-08-03T10:00:00.000Z',
      fecha_actualizacion: '2026-08-03T10:00:00.000Z'
    }]));
    return window.__COI_OBS_H07_CUARENTENA__.conciliar();
  });
  expect(resuelta.resuelta).toBe(true);
  expect(resuelta.pendientes).toBe(0);
  expect(await page.evaluate(() => window.__COI_OBS_H03__.legadoEnCuarentena)).toBe(0);
  // El material local NO se borro.
  expect(await page.evaluate(() => localStorage.getItem('coi_observaciones_oc'))).not.toBeNull();
});

test('H07-10 · descartar exige confirmación explícita, exporta y no borra el material', async ({ page }) => {
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);

  // Sin confirmacion no hace nada.
  const sinConfirmar = await page.evaluate(async () => {
    try { await window.__COI_OBS_H07_CUARENTENA__.descartar({}); return 'no lanzo'; }
    catch (e) { return String(e.message || e); }
  });
  expect(sinConfirmar).toMatch(/confirmado: true/);
  expect(await page.evaluate(() => window.__COI_OBS_H03__.legadoEnCuarentena)).toBe(1);

  // Con confirmacion: exporta, libera el bloqueo y CONSERVA la clave.
  const salida = await page.evaluate(() => window.__COI_OBS_H07_CUARENTENA__.descartar({ confirmado: true }));
  expect(salida.claveConservada).toBe(true);
  expect(salida.exportado).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__COI_OBS_H03__.legadoEnCuarentena)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('coi_observaciones_oc'))).not.toBeNull();
});

// ============================================ 5 · identidad e interfaz

test('H07-11 · un cambio de identidad no deja documentación del operador anterior', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  await page.evaluate((uidB) => window.__H07_EVENTO_AUTH__('SIGNED_IN', uidB), UID_B);
  await page.waitForTimeout(1200);

  const r = await radiografia(page);
  expect(r.docsOperativos).toBe(0);
  expect(r.v62).toBe(0);
  expect(r.legadoIntacto).toBe(true);
});

test('H07-12 · las preferencias de interfaz siguen funcionando', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  const r = await radiografia(page);
  expect(r.tema).toBe('dark');
  await page.evaluate(() => localStorage.setItem('coi_v2_theme', 'light'));
  expect(await page.evaluate(() => localStorage.getItem('coi_v2_theme'))).toBe('light');
});

// ============ 6 · el legado no puede sobrevivir a la espera de Supabase (A)

test('H07-13 · el legado sale del modelo ANTES de que Supabase conteste', async ({ page }) => {
  // El inicializador historico publica en window.observacionesOC lo que
  // encuentra en la clave legada, y eso pasa mucho antes de que la capa H03
  // empiece a leer. Con la lectura remota demorada se abre exactamente la
  // ventana del hallazgo: red lenta, respuesta pendiente, paneles y KPIs
  // mostrando material local —que puede ser de otro operador del mismo
  // navegador— como si fuera dato operativo.
  await prepararH07(page, {
    legadoObservaciones: true,
    marcadorH03: false,
    demoraObs: 6000,
    observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);

  const durante = await page.evaluate(() => ({
    sincronizado: window.__COI_OBS_H03__.sincronizado,
    retiradas: window.__COI_OBS_H03__.legadoRetirado,
    modelo: (window.observacionesOC || []).map((o) => String(o.texto || o.observacion || '')),
    // El material sigue entero y accesible por la cuarentena, que usa el
    // getter nativo.
    cuarentena: window.__COI_OBS_H07_CUARENTENA__.filas().map((o) => String(o.texto || '')),
    marcador: localStorage.getItem('coi_observaciones_h03_imported_v1')
  }));

  // La lectura remota todavia no contesto…
  expect(durante.sincronizado).toBe(false);
  // …y aun asi el modelo operativo NO tiene ni una fila legada.
  expect(durante.modelo).toEqual([]);
  // La retirada ocurrio de verdad: sin esto la prueba seria vacia.
  expect(durante.retiradas).toBeGreaterThanOrEqual(1);
  // El material historico esta intacto y el corte NO se dio por cumplido.
  expect(durante.cuarentena).toEqual(['OBSERVACION LOCAL SIN CONCILIAR']);
  expect(durante.marcador).toBeNull();

  // Y cuando Supabase finalmente contesta, el modelo se puebla con el remoto.
  await page.waitForFunction(() => window.__COI_OBS_H03__.sincronizado === true, null, { timeout: 20000 });
  const despues = await page.evaluate(() => (window.observacionesOC || []).map((o) => String(o.texto || '')));
  expect(despues).toEqual(['OBSERVACION REMOTA AJENA']);
});

test('H07-14 · una recarga de la misma sesión no destruye el snapshot confirmado', async ({ page }) => {
  await prepararH07(page, { observaciones: [OBS_REMOTA_AJENA] });
  await abrirH07(page);
  await page.waitForFunction(() => window.__COI_OBS_H03__.sincronizado === true, null, { timeout: 20000 });

  const r = await page.evaluate(async () => {
    const antes = (window.observacionesOC || []).length;
    const p = window.recargarObservacionesOC();
    // Inmediatamente despues de pedir la recarga, ANTES de que conteste.
    const durante = (window.observacionesOC || []).map((o) => String(o.texto || ''));
    await p;
    return { antes, durante, retiradas: window.__COI_OBS_H03__.legadoRetirado };
  });

  expect(r.antes).toBe(1);
  // La lectura confirmada de esta sesion sigue en pantalla mientras se relee.
  expect(r.durante).toEqual(['OBSERVACION REMOTA AJENA']);
  expect(r.retiradas).toBe(0);
});

// ============ 7 · circuito user-facing de la cuarentena (B · G)

test('H07-15 · el sector Observaciones muestra la cuarentena y permite conciliar', async ({ page }) => {
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);
  await abrirObservaciones(page);

  const aviso = page.locator('[data-h07-obs-cuarentena]');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('Observaciones históricas pendientes de conciliar: 1');
  await expect(aviso).toContainText('No borra el archivo legado ni lo importa a Supabase.');

  // Conciliar con el remoto todavia sin la fila: NO libera nada.
  await page.click('[data-h07-obs-conciliar]');
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-h07-obs-cuarentena]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('coi_observaciones_h03_imported_v1'))).toBeNull();

  // Ahora la fila SI esta en Supabase: conciliar la reconoce y el aviso se va.
  await page.evaluate((fila) => window.__H07_SET_OBS__(window.__H07_OBS__().concat([fila])),
    obsRemota('55555555-5555-4555-8555-555555555555', 'OBSERVACION LOCAL SIN CONCILIAR'));
  await page.click('[data-h07-obs-conciliar]');
  await expect(page.locator('[data-h07-obs-cuarentena]')).toHaveCount(0);

  const estado = await page.evaluate(() => ({
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    marcador: localStorage.getItem('coi_observaciones_h03_imported_v1')
  }));
  expect(estado.cuarentena).toBe(0);
  expect(marcadorConHuella(estado.marcador)).toBe(true);
});

test('H07-16 · «Exportar legado» descarga el material y no lo borra', async ({ page }) => {
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);
  await page.evaluate(() => {
    window.__H07_DESCARGAS__ = [];
    window.descargarArchivo = (nombre, contenido) => window.__H07_DESCARGAS__.push({ nombre, contenido });
  });
  await abrirObservaciones(page);

  await page.click('[data-h07-obs-exportar]');
  await page.waitForTimeout(800);

  const r = await page.evaluate(() => ({
    descargas: (window.__H07_DESCARGAS__ || []).map((d) => ({
      nombre: d.nombre, datos: JSON.parse(d.contenido)
    })),
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    legadoIntacto: window.__COI_OBS_H07_CUARENTENA__.filas().length
  }));

  expect(r.descargas).toHaveLength(1);
  expect(r.descargas[0].nombre).toMatch(/^observaciones_legacy_\d+\.json$/);
  expect(r.descargas[0].datos.autoritativo).toBe(false);
  expect(r.descargas[0].datos.filas.map((o) => o.texto)).toEqual(['OBSERVACION LOCAL SIN CONCILIAR']);
  // Exportar no resuelve el bloqueo ni toca el material.
  expect(r.cuarentena).toBe(1);
  expect(r.legadoIntacto).toBe(1);
});

test('H07-17 · «Descartar bloqueo» exige confirmación, exporta y conserva la clave', async ({ page }) => {
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);
  await page.evaluate(() => {
    window.__H07_DESCARGAS__ = [];
    window.descargarArchivo = (nombre, contenido) => window.__H07_DESCARGAS__.push({ nombre, contenido });
    window.__H07_CONFIRMS__ = [];
    window.confirm = (m) => { window.__H07_CONFIRMS__.push(String(m)); return false; };
  });
  await abrirObservaciones(page);

  // Sin confirmacion no pasa nada: ni exportacion, ni liberacion del bloqueo.
  await page.click('[data-h07-obs-descartar]');
  await page.waitForTimeout(800);
  const cancelado = await page.evaluate(() => ({
    preguntas: window.__H07_CONFIRMS__,
    descargas: (window.__H07_DESCARGAS__ || []).length,
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    marcador: localStorage.getItem('coi_observaciones_h03_imported_v1')
  }));
  expect(cancelado.preguntas).toHaveLength(1);
  expect(cancelado.preguntas[0]).toContain('NO se borra');
  expect(cancelado.descargas).toBe(0);
  expect(cancelado.cuarentena).toBe(1);
  expect(cancelado.marcador).toBeNull();
  await expect(page.locator('[data-h07-obs-cuarentena]')).toBeVisible();

  // Con confirmacion: exporta ANTES, libera el bloqueo y CONSERVA el material.
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click('[data-h07-obs-descartar]');
  await expect(page.locator('[data-h07-obs-cuarentena]')).toHaveCount(0);

  const confirmado = await page.evaluate(() => ({
    descargas: (window.__H07_DESCARGAS__ || []).length,
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    marcador: localStorage.getItem('coi_observaciones_h03_imported_v1'),
    // La clave legada NO se borro: sigue teniendo su fila.
    legadoIntacto: window.__COI_OBS_H07_CUARENTENA__.filas().map((o) => String(o.texto || ''))
  }));
  expect(confirmado.descargas).toBe(1);
  expect(confirmado.cuarentena).toBe(0);
  expect(marcadorConHuella(confirmado.marcador)).toBe(true);
  expect(confirmado.legadoIntacto).toEqual(['OBSERVACION LOCAL SIN CONCILIAR']);
});

test('H07-18 · resuelta la cuarentena, las mutaciones vuelven a llegar a Supabase', async ({ page }) => {
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);
  await abrirObservaciones(page);

  // H07-8 ya prueba que con la cuarentena pendiente nada llega a Supabase.
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click('[data-h07-obs-descartar]');
  await expect(page.locator('[data-h07-obs-cuarentena]')).toHaveCount(0);

  await page.evaluate(async () => {
    let ta = document.getElementById('v65NuevaObservacion');
    if (!ta) { ta = document.createElement('textarea'); ta.id = 'v65NuevaObservacion'; document.body.appendChild(ta); }
    ta.value = 'ALTA DESPUES DE RESOLVER';
    window.guardarObservacionOC('4530007777');
    await new Promise((r) => setTimeout(r, 1200));
  });

  const inserts = await page.evaluate(() =>
    window.__H07_LLAMADAS__.filter((l) => l.op === 'insert:coi_observaciones_oc'));
  expect(inserts.length).toBe(1);
  expect(String(inserts[0].payload.observacion)).toBe('ALTA DESPUES DE RESOLVER');
});

// ============ 8 · alias legados en la conciliación (D)

test('H07-19 · una fila legada con numeroOC + descripción se concilia igual', async ({ page }) => {
  // La normalizacion canonica acepta numeroOC y descripcion. Si la conciliacion
  // usa otros alias, esta fila produce una clave vacia y queda bloqueada para
  // siempre aunque la observacion ya este en Supabase.
  await prepararH07(page, {
    legadoObservaciones: true,
    legadoObsFilas: OBS_LEGADA_ALIAS,
    marcadorH03: false,
    observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);

  // Con el remoto sin esa observacion, sigue pendiente: la clave NO es vacia y
  // no matchea contra cualquier cosa.
  const pendiente = await page.evaluate(() => ({
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    pendientes: window.__COI_OBS_H07_CUARENTENA__.pendientes()
      .map((o) => String(o.descripcion || o.texto || ''))
  }));
  expect(pendiente.cuarentena).toBe(1);
  expect(pendiente.pendientes).toEqual(['OBSERVACION CON ALIAS LEGADOS']);

  // Con la misma observacion ya en Supabase, la conciliacion la reconoce.
  const resuelta = await page.evaluate(async (fila) => {
    window.__H07_SET_OBS__(window.__H07_OBS__().concat([fila]));
    return window.__COI_OBS_H07_CUARENTENA__.conciliar();
  }, obsRemota('66666666-6666-4666-8666-666666666666', 'OBSERVACION CON ALIAS LEGADOS'));

  expect(resuelta.resuelta).toBe(true);
  expect(resuelta.pendientes).toBe(0);
  expect(await page.evaluate(() => window.__COI_OBS_H03__.legadoEnCuarentena)).toBe(0);
  expect(marcadorConHuella(await page.evaluate(() => localStorage.getItem('coi_observaciones_h03_imported_v1')))).toBe(true);
});

// ============ 9 · Timeline seguro ante señales solapadas (C)

test('H07-20 · dos pings solapados no contaminan las lecturas siguientes', async ({ page }) => {
  await prepararH07(page, { eventos: [] });
  await abrirH07(page);

  const r = await page.evaluate(async () => {
    const ping = () => localStorage.getItem('coi_timeline_sync_ping_v1');
    const lecturas = () => window.__H07_LLAMADAS__.filter((l) => l.op === 'rpc:coi_timeline_list_page').length;
    const emitir = () => window.dispatchEvent(new StorageEvent('storage', {
      key: 'coi_timeline_sync_ping_v1',
      newValue: JSON.stringify({ en: new Date().toISOString(), eventos: 0 })
    }));

    const antes = { ping: ping(), lecturas: lecturas() };
    // Dos señales de OTRAS pestañas, solapadas.
    emitir(); emitir();
    await new Promise((r) => setTimeout(r, 1600));
    const trasPings = { ping: ping(), lecturas: lecturas() };

    // Y despues una mutacion LOCAL real.
    await window.COI_TIMELINE_COI.save(
      [{ fecha: '2026-09-01', tipoEvento: 'Nota', oc: '4530007777', titulo: 'H07-20' }],
      'H07-20');
    await new Promise((r) => setTimeout(r, 1000));
    return { antes, trasPings, trasMutacion: { ping: ping(), lecturas: lecturas() } };
  });

  // Hubo relectura por las señales…
  expect(r.trasPings.lecturas).toBeGreaterThan(r.antes.lecturas);
  // …y ninguna de las dos reemitio: no hay eco entre pestañas.
  expect(r.trasPings.ping).toBe(r.antes.ping);
  // Con la global mutable anterior el origen quedaba pegado en 'storage' y esta
  // mutacion local ya no avisaba a nadie. Ahora si emite.
  expect(r.trasMutacion.ping).not.toBe(r.trasPings.ping);
  expect(JSON.parse(r.trasMutacion.ping).en).toBeTruthy();
});

// ============ 10 · alertas del modelo documental retirado (E)

test('H07-21 · no quedan alertas que pidan carpeta OneDrive ni referencia documental', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  const r = await page.evaluate(() => {
    const tipos = (lista) => Array.from(new Set((lista || []).map((a) => String(a.tipoAlerta || ''))));
    const acciones = (lista) => (lista || []).map((a) => String(a.accionSugerida || a.accion || '')).join(' | ');
    const vigentes = window.generarAlertasCOI();
    const base = typeof window.generarAlertasCOI.__coiDocH07Base === 'function'
      ? window.generarAlertasCOI.__coiDocH07Base() : null;
    return { tipos: tipos(vigentes), acciones: acciones(vigentes), tiposBase: base ? tipos(base) : null };
  });

  // El filtro esta instalado sobre el generador real…
  expect(r.tiposBase).not.toBeNull();
  // …y de verdad estaba emitiendo las alertas retiradas: no es un filtro vacio.
  expect(r.tiposBase).toContain('OC sin carpeta documental');

  // Ninguna alerta vigente empuja al modelo retirado.
  for (const retirada of [
    'OC sin carpeta documental',
    'OC activa sin carpeta documental',
    'OC sin Acta de Inicio',
    'Documento sin link',
    'Acta de Medición pendiente de link'
  ]) {
    expect(r.tipos).not.toContain(retirada);
  }
  expect(r.acciones).not.toMatch(/OneDrive|SharePoint|referencia documental|carpeta documental/i);

  // Y las alertas documentales del camino VIGENTE siguen intactas.
  expect(r.tipos).toContain('OC activa sin Acta de Inicio');
  expect(r.tipos).toContain('Falta expediente');
  expect(r.tipos).toContain('Falta última acta');
});

test('H07-22 · la documentación Storage vigente sigue siendo el camino activo', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  const r = await page.evaluate(() => ({
    diag: window.COI_DOCUMENTACION_H07.diagnostico(),
    operativos: (window.documentacionOC || []).length
  }));

  expect(r.diag.tablaActiva).toBe('coi_documentos_oc');
  expect(r.diag.estado).toBe('retirada');
  expect(r.operativos).toBe(0);
});

// ============ 11 · lectores legados de observaciones aislados (F)

test('H07-23 · ningún lector operativo ve la clave legada; la cuarentena sí', async ({ page }) => {
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);

  const r = await page.evaluate(() => ({
    // Lectura comun: enmascarada, con marcador o sin el.
    crudo: localStorage.getItem('coi_observaciones_oc'),
    porBackup: JSON.stringify((typeof window.adminBackupPayload === 'function'
      ? window.adminBackupPayload() : {}) || {}).indexOf('OBSERVACION LOCAL SIN CONCILIAR') >= 0,
    porCargador: (typeof window.v65CargarObservacionesOC === 'function'
      ? window.v65CargarObservacionesOC() : []).map((o) => String(o.texto || '')),
    modelo: (window.observacionesOC || []).map((o) => String(o.texto || '')),
    // La cuarentena, en cambio, conserva el material completo.
    cuarentena: window.__COI_OBS_H07_CUARENTENA__.filas().map((o) => String(o.texto || '')),
    autoritativo: window.__COI_OBS_H07_CUARENTENA__.autoritativo
  }));

  expect(r.crudo).toBe('[]');
  expect(r.porBackup).toBe(false);
  expect(r.porCargador).not.toContain('OBSERVACION LOCAL SIN CONCILIAR');
  expect(r.modelo).toEqual(['OBSERVACION REMOTA AJENA']);
  expect(r.cuarentena).toEqual(['OBSERVACION LOCAL SIN CONCILIAR']);
  expect(r.autoritativo).toBe(false);
});

// ============ 12 · el Diagnóstico avanzado tampoco pide la acción retirada

test('H07-24 · el panel Diagnóstico no ofrece «Asociar carpeta OneDrive/SharePoint»', async ({ page }) => {
  // No era codigo muerto: la tabla del Diagnóstico avanzado V58.1 mostraba el
  // problema y cada fila trae un boton «Enviar a Observaciones» cargado con esa
  // accion. Un administrador podia convertirlo en una observacion real.
  await prepararH07(page);
  await abrirH07(page);

  const r = await page.evaluate(() => {
    const contenedor = document.createElement('div');
    contenedor.id = 'adminTabDiagnostico';
    document.body.appendChild(contenedor);

    // Camino 1 · el global.
    const porGlobal = window.ejecutarDiagnosticoSistema();
    // Camino 2 · el que usa el boton del panel: llama al diagnostico por su
    // referencia cerrada y despues al render por window.
    const crudo = window.ejecutarDiagnosticoSistema.__coiDocH07Base
      ? window.ejecutarDiagnosticoSistema.__coiDocH07Base() : null;
    window.renderAdminDiagnostico(crudo);

    const textos = (lista) => (lista || [])
      .map((p) => String(p.descripcion || '') + ' | ' + String(p.accion || '')).join(' ~ ');

    return {
      // Lo que el operador ve realmente renderizado.
      html: contenedor.textContent || '',
      dataset: contenedor.innerHTML.indexOf('data-v581-problem-obs') >= 0
        ? decodeURIComponent(contenedor.innerHTML) : '',
      filtrado: textos(porGlobal.problemas),
      crudo: crudo ? textos(crudo.problemas) : null,
      docsFiltrados: porGlobal.problemasDocumentales,
      docsCrudos: crudo ? crudo.problemasDocumentales : null
    };
  });

  // El generador sin filtrar SI emitia el problema retirado: el filtro no es vacio.
  expect(r.crudo).not.toBeNull();
  expect(r.crudo).toContain('Asociar carpeta OneDrive/SharePoint.');

  // Nada de eso llega al operador, ni en la tabla ni en el payload del boton
  // «Enviar a Observaciones».
  expect(r.filtrado).not.toMatch(/OneDrive|SharePoint|carpeta documental/i);
  expect(r.html).not.toMatch(/OneDrive|SharePoint/i);
  expect(r.dataset).not.toMatch(/OneDrive|SharePoint/i);
  // Y el contador documental se recalcula, no queda inflado por lo filtrado.
  expect(r.docsFiltrados).toBeLessThanOrEqual(r.docsCrudos);
});

// ============ 13 · el legado documental no se cuenta como documentación activa

test('H07-25 · el backup y el diagnóstico no cuentan el legado como documentación', async ({ page }) => {
  // El helper getDocs() del bloque V58.1 delega en v62DocsGlobales(), que H07
  // deja en vacio: las claves legadas nunca se leen por ese camino.
  await prepararH07(page, { legadoV33: true });
  await abrirH07(page);

  const r = await page.evaluate(() => {
    window.__H07_BACKUP__ = null;
    const crearURL = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      try { blob.text().then((t) => { window.__H07_BACKUP__ = t; }); } catch (e) {}
      return crearURL.call(URL, blob);
    };
    return {
      docsGlobales: (typeof window.v62DocsGlobales === 'function' ? window.v62DocsGlobales() : null),
      diagnostico: window.ejecutarDiagnosticoSistema()
    };
  });

  // Ningun lector legado devuelve documentacion.
  expect(r.docsGlobales).toEqual([]);
  // Y el diagnostico no inventa problemas documentales del store retirado.
  expect(JSON.stringify(r.diagnostico.problemas)).not.toContain('DOC-OC-LEGADO-H07');

  // El backup: el dataset documental va vacio y el conteo es cero. El material
  // legado solo puede viajar en el volcado crudo de localStorage, que es una
  // seccion de recuperacion, no documentacion operativa.
  await page.evaluate(() => window.COI_V581.exportBackup());
  await page.waitForFunction(() => window.__H07_BACKUP__ !== null, null, { timeout: 10000 });

  const backup = await page.evaluate(() => JSON.parse(window.__H07_BACKUP__));
  expect(backup.resumen.totalDocumentos).toBe(0);
  expect(backup.datos.documentosOC).toEqual([]);
  // No se mezcla con el indice vigente.
  expect(JSON.stringify(backup.datos)).not.toContain('DOC-OC-LEGADO-H07');
  // El volcado crudo si lo conserva, bajo su propia seccion y sin autoridad.
  expect(JSON.stringify(backup.localStorage)).toContain('DOC-OC-LEGADO-H07');
});

// ============ 14 · la conciliación preserva la multiplicidad (F1)

// Con un Set, dos filas legadas identicas quedaban conciliadas por UNA sola
// fila remota equivalente: el marcador se ponia y la segunda observacion
// historica desaparecia de la recuperacion sin haber llegado nunca a Supabase.
async function cuarentenaCon(page, locales, remotas) {
  await prepararH07(page, {
    legadoObservaciones: true,
    legadoObsFilas: obsLegadaRepetida(locales),
    marcadorH03: false,
    observaciones: Array.from({ length: remotas }, (_, i) =>
      obsRemota('7777777' + i + '-7777-4777-8777-77777777777' + i, 'FALTA FIRMA'))
  });
  await abrirH07(page);
  await page.waitForFunction(() => window.__COI_OBS_H03__.sincronizado === true, null, { timeout: 20000 });
  return page.evaluate(() => ({
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    pendientes: window.__COI_OBS_H07_CUARENTENA__.pendientes().length,
    marcador: localStorage.getItem('coi_observaciones_h03_imported_v1'),
    conservadas: window.__COI_OBS_H07_CUARENTENA__.filas().length
  }));
}

test('H07-26 · A · dos filas legadas idénticas y una remota dejan UNA pendiente', async ({ page }) => {
  const r = await cuarentenaCon(page, 2, 1);
  expect(r.cuarentena).toBe(1);
  expect(r.pendientes).toBe(1);
  // La cuarentena sigue activa y el corte NO se dio por cumplido.
  expect(r.marcador).toBeNull();
  // Ninguna de las dos filas locales se perdio.
  expect(r.conservadas).toBe(2);
});

test('H07-27 · B · dos filas legadas idénticas y dos remotas concilian', async ({ page }) => {
  const r = await cuarentenaCon(page, 2, 2);
  expect(r.cuarentena).toBe(0);
  expect(r.pendientes).toBe(0);
  expect(marcadorConHuella(r.marcador)).toBe(true);
  expect(r.conservadas).toBe(2);
});

test('H07-28 · C · tres filas legadas idénticas y dos remotas dejan exactamente una', async ({ page }) => {
  const r = await cuarentenaCon(page, 3, 2);
  expect(r.cuarentena).toBe(1);
  expect(r.pendientes).toBe(1);
  expect(r.marcador).toBeNull();
  expect(r.conservadas).toBe(3);
});

// ============ 15 · la caché financiera retirada tampoco vuelve por el DELETE (F2)

test('H07-29 · borrar una posición con readback fallido no reescribe la caché financiera', async ({ page }) => {
  await prepararH07(page, {
    posiciones: [{
      id: POSICION_A, orden_id: ORDEN_ID, nro_oc: ORDEN_NRO, posicion: '10',
      descripcion: 'POSICION A', cantidad_total: 1, monto_total: 100,
      cantidad_consumida: 0, monto_consumido: 0, estado: 'LIBRE'
    }]
  });
  await abrirH07(page);

  const r = await page.evaluate(async ({ idA, idB }) => {
    const CLAVE = 'coi_cache_posiciones_oc_supabase_v1';
    // Caché pre-H07 con varias posiciones: el estado que hace visible el bug.
    localStorage.setItem(CLAVE, JSON.stringify({
      source: 'Supabase', savedAt: '2026-08-01T00:00:00.000Z',
      positions: [{ id: idA, nro_oc: '4530007777', monto_total: 100 },
        { id: idB, nro_oc: '4530007777', monto_total: 200 }]
    }));

    window.obtenerPerfilUsuarioActual = async () => ({ profile_ok: true, rol: 'administrador' });
    const api = window.COI_FINANZAS_SUPABASE;
    // El DELETE remoto tiene EXITO y el readback posterior FALLA: el modulo
    // devuelve su refreshWarning en vez de una relectura confirmada.
    api.eliminarPosiciones = async (ids) => {
      const salida = ids.map((id) => ({ id }));
      salida.refreshWarning = 'No se pudo releer Supabase tras la eliminación.';
      return salida;
    };

    // Flujo real de la UI: sección de finanzas, checkbox y botón delegados.
    const seccion = document.createElement('div');
    seccion.setAttribute('data-fin-oc', 'OC-H07');
    seccion.innerHTML = '<input type="checkbox" class="finance-check chk-fin-delete-position-v60" ' +
      'data-fin-delete-id-v60="' + idA + '" checked>' +
      '<div class="finance-delete-bar-v60"><b data-fin-delete-count-v60></b>' +
      '<button type="button" data-fin-delete-selected-v60>Eliminar seleccionadas</button></div>';
    document.body.appendChild(seccion);

    seccion.querySelector('[data-fin-delete-selected-v60]').click();
    // Espera a que la validación remota abra el modal real.
    for (let i = 0; i < 60 && !document.querySelector('#coiFinDeleteInputV60'); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const input = document.querySelector('#coiFinDeleteInputV60');
    if (!input) return { modal: false };
    input.value = 'ELIMINAR';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#coiFinDeleteConfirmV60').click();
    await new Promise((r) => setTimeout(r, 1500));

    return {
      modal: true,
      cache: localStorage.getItem(CLAVE),
      warning: (window.__H07_TOASTS__ || []).join(' | ')
    };
  }, { idA: POSICION_A, idB: POSICION_B });

  // El flujo real llegó hasta el modal de confirmación.
  expect(r.modal).toBe(true);
  // La eliminación remota ocurrió, el readback falló y aún así la clave
  // retirada NO quedó reescrita con las posiciones restantes: se descartó.
  expect(r.cache).toBeNull();
});

// ============ 16 · el backup lleva el Timeline autoritativo (F3)

const EVENTOS_REMOTOS = [
  { id: 'e1', fecha: '2026-09-01', tipo_evento: 'Nota', oc: '4530007777', titulo: 'EVENTO REMOTO UNO' },
  { id: 'e2', fecha: '2026-09-02', tipo_evento: 'Nota', oc: '4530007777', titulo: 'EVENTO REMOTO DOS' }
];

async function backupDe(page) {
  await page.evaluate(() => {
    window.__H07_BACKUP__ = null;
    const crear = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      try { blob.text().then((t) => { window.__H07_BACKUP__ = t; }); } catch (e) {}
      return crear.call(URL, blob);
    };
  });
  await page.evaluate(() => window.COI_V581.exportBackup());
  await page.waitForFunction(() => window.__H07_BACKUP__ !== null, null, { timeout: 10000 });
  return page.evaluate(() => JSON.parse(window.__H07_BACKUP__));
}

test('H07-30 · A · el backup exporta el Timeline confirmado aunque la caché ya no exista', async ({ page }) => {
  await prepararH07(page, { eventos: EVENTOS_REMOTOS });
  await abrirH07(page);
  await page.waitForFunction(() => window.COI_TIMELINE_COI.isAuthoritativeReady() === true, null, { timeout: 20000 });

  // La caché retirada no existe: antes de esto el backup salía sin Timeline.
  expect(await page.evaluate(() => localStorage.getItem('coi_timeline_events_v1'))).toBeNull();

  const backup = await backupDe(page);
  expect(backup.autoritativo.timeline.confirmado).toBe(true);
  expect(backup.autoritativo.timeline.fuente).toBe('supabase');
  expect(backup.autoritativo.timeline.eventos.length).toBe(2);
  expect(JSON.stringify(backup.autoritativo.timeline.eventos)).toContain('EVENTO REMOTO UNO');
  expect(backup.resumen.totalEventosTimeline).toBe(2);
  // El volcado crudo es una sección aparte y NO trae el Timeline.
  expect(Object.prototype.hasOwnProperty.call(backup.localStorage, 'coi_timeline_events_v1')).toBe(false);
  // Exportar no reintrodujo la clave.
  expect(await page.evaluate(() => localStorage.getItem('coi_timeline_events_v1'))).toBeNull();
});

test('H07-31 · B · restaurar ese backup usa la ruta remota y no escribe caché local', async ({ page }) => {
  await prepararH07(page, { eventos: EVENTOS_REMOTOS });
  await abrirH07(page);
  await page.waitForFunction(() => window.COI_TIMELINE_COI.isAuthoritativeReady() === true, null, { timeout: 20000 });

  const backup = await backupDe(page);

  const r = await page.evaluate(async (payload) => {
    const registro = [];
    window.COI_TIMELINE_COI.replace = async (eventos, motivo) => {
      registro.push({ eventos: (eventos || []).length, motivo: String(motivo || '') });
      return eventos;
    };
    window.confirm = () => true;

    // Camino real del panel de backup: el input de importación delegado.
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'fileImportarBackupV581';
    document.body.appendChild(input);
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Se devuelve ANTES del recargado diferido que hace el importador.
    await new Promise((r) => setTimeout(r, 450));
    return { registro, cache: localStorage.getItem('coi_timeline_events_v1') };
  }, backup);

  expect(r.registro).toHaveLength(1);
  expect(r.registro[0].eventos).toBe(2);
  // Se restauró por el campo autoritativo, no por el volcado crudo.
  expect(r.registro[0].motivo).toContain('snapshot autoritativo');
  // Y la caché retirada nunca se escribió.
  expect(r.cache).toBeNull();
});

test('H07-32 · C · un Timeline vacío confirmado se exporta como vacío, no como ausente', async ({ page }) => {
  await prepararH07(page, { eventos: [] });
  await abrirH07(page);
  await page.waitForFunction(() => window.COI_TIMELINE_COI.isAuthoritativeReady() === true, null, { timeout: 20000 });

  const backup = await backupDe(page);
  expect(backup.autoritativo.timeline.confirmado).toBe(true);
  expect(backup.autoritativo.timeline.eventos).toEqual([]);
  // Vacío confirmado es 0. Ausente sería null.
  expect(backup.resumen.totalEventosTimeline).toBe(0);
});

test('H07-33 · D · sin lectura confirmada el backup no inventa un Timeline', async ({ page }) => {
  await prepararH07(page, { eventos: [] });
  await abrirH07(page);

  const backup = await page.evaluate(async () => {
    // Estado degradado: esta sesión no tiene lectura remota confirmada.
    window.COI_TIMELINE_COI.isAuthoritativeReady = () => false;
    // Y un legado local de una versión anterior tampoco puede colarse.
    localStorage.setItem('coi_timeline_events_v1', JSON.stringify([{ id: 'legado', titulo: 'NO DEBE APARECER' }]));
    window.__H07_BACKUP__ = null;
    const crear = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      try { blob.text().then((t) => { window.__H07_BACKUP__ = t; }); } catch (e) {}
      return crear.call(URL, blob);
    };
    window.COI_V581.exportBackup();
    await new Promise((r) => setTimeout(r, 800));
    return JSON.parse(window.__H07_BACKUP__ || 'null');
  });

  expect(backup).not.toBeNull();
  expect(backup.autoritativo.timeline.confirmado).toBe(false);
  expect(backup.autoritativo.timeline.eventos).toEqual([]);
  // Ausente, no vacío confirmado.
  expect(backup.resumen.totalEventosTimeline).toBeNull();
  // El legado local NO se promovió a snapshot autoritativo.
  expect(JSON.stringify(backup.autoritativo)).not.toContain('NO DEBE APARECER');
});

// ============ 17 · un solo gesto no puede preguntar dos veces

test('H07-34 · dos clicks del mismo gesto producen UNA sola confirmación', async ({ page }) => {
  // En tactil el navegador sintetiza un click de compatibilidad ademas del
  // real, y llega en un task posterior. Sin ventana de gesto, «Descartar
  // bloqueo» le preguntaba dos veces al operador por un solo toque.
  await prepararH07(page, {
    legadoObservaciones: true, marcadorH03: false, observaciones: [OBS_REMOTA_AJENA]
  });
  await abrirH07(page);
  await page.evaluate(() => {
    window.__H07_CONFIRMS__ = [];
    window.confirm = (m) => { window.__H07_CONFIRMS__.push(String(m)); return false; };
  });
  await abrirObservaciones(page);

  const r = await page.evaluate(async () => {
    const boton = document.querySelector('[data-h07-obs-descartar]');
    boton.click();
    // El segundo click del mismo gesto, en un task posterior.
    await new Promise((r) => setTimeout(r, 120));
    const b2 = document.querySelector('[data-h07-obs-descartar]');
    if (b2) b2.click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      preguntas: window.__H07_CONFIRMS__.length,
      cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena
    };
  });

  expect(r.preguntas).toBe(1);
  // Y como se cancelo, el bloqueo sigue vigente.
  expect(r.cuarentena).toBe(1);
  await expect(page.locator('[data-h07-obs-cuarentena]')).toBeVisible();
});

// ============ 18 · el corte no puede tapar filas legadas nuevas (F1)

test('H07-35 · si la clave legada cambia después del corte, la cuarentena se reabre', async ({ page }) => {
  // El marcador era un '1' pelado: puesto una vez, daba la cuarentena por
  // resuelta para siempre. Una observación legada que apareciera después
  // quedaba oculta, sin llegar nunca a Supabase y sin que nada la señalara.
  await prepararH07(page, {
    legadoObservaciones: true,
    marcadorH03: false,
    observaciones: [obsRemota('88888888-8888-4888-8888-888888888888', 'OBSERVACION LOCAL SIN CONCILIAR')]
  });
  await abrirH07(page);
  await page.waitForFunction(() => window.__COI_OBS_H03__.sincronizado === true, null, { timeout: 20000 });

  // Punto de partida: todo conciliado y el corte registrado CON huella.
  const inicial = await page.evaluate(() => ({
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    marcador: localStorage.getItem('coi_observaciones_h03_imported_v1')
  }));
  expect(inicial.cuarentena).toBe(0);
  expect(marcadorConHuella(inicial.marcador)).toBe(true);

  // Ahora aparece una fila legada NUEVA: un proceso viejo, un backup restaurado,
  // una edición del archivo. El contenido ya no es el que se concilió.
  const reabierta = await page.evaluate(() => {
    const actual = JSON.parse(localStorage.getItem('coi_observaciones_oc') === '[]'
      ? '[]' : localStorage.getItem('coi_observaciones_oc') || '[]');
    // El escudo enmascara la lectura pública: se escribe el conjunto completo.
    localStorage.setItem('coi_observaciones_oc', JSON.stringify([
      { idObservacion: 'OBS-A-LOCAL', ocNro: '4530007777', texto: 'OBSERVACION LOCAL SIN CONCILIAR', estadoObservacion: 'Abierta' },
      { idObservacion: 'OBS-NUEVA', ocNro: '4530007777', texto: 'OBSERVACION APARECIDA DESPUES DEL CORTE', estadoObservacion: 'Abierta' }
    ]));
    return {
      cuarentena: window.__COI_OBS_H07_CUARENTENA__.cantidad(),
      pendientes: window.__COI_OBS_H07_CUARENTENA__.pendientes().map((o) => String(o.texto || '')),
      marcadorConservado: localStorage.getItem('coi_observaciones_h03_imported_v1') !== null,
      filas: window.__COI_OBS_H07_CUARENTENA__.filas().length
    };
  });

  // La cuarentena se reabre y señala exactamente la fila nueva.
  expect(reabierta.cuarentena).toBe(1);
  expect(reabierta.pendientes).toEqual(['OBSERVACION APARECIDA DESPUES DEL CORTE']);
  // No se borró nada.
  expect(reabierta.marcadorConservado).toBe(true);
  expect(reabierta.filas).toBe(2);

  // Y las mutaciones vuelven a estar bloqueadas.
  await page.evaluate(async () => {
    let ta = document.getElementById('v65NuevaObservacion');
    if (!ta) { ta = document.createElement('textarea'); ta.id = 'v65NuevaObservacion'; document.body.appendChild(ta); }
    ta.value = 'NO DEBERIA LLEGAR TRAS LA REAPERTURA';
    window.guardarObservacionOC('4530007777');
    await new Promise((r) => setTimeout(r, 900));
  });
  const inserts = await page.evaluate(() =>
    window.__H07_LLAMADAS__.filter((l) => l.op === 'insert:coi_observaciones_oc').length);
  expect(inserts).toBe(0);

  // La salida vuelve a estar visible en el sector de Observaciones.
  await abrirObservaciones(page);
  await expect(page.locator('[data-h07-obs-cuarentena]')).toBeVisible();
});

test('H07-36 · un marcador histórico «1» sigue valiendo y se migra a huella', async ({ page }) => {
  // Compatibilidad: los puestos que ya tenían el corte hecho no pueden ver la
  // cuarentena reabierta de golpe. Se adopta su contenido actual como el
  // conciliado y se migra al formato nuevo.
  await prepararH07(page, { legadoObservaciones: true, marcadorH03: true });
  await abrirH07(page);

  const r = await page.evaluate(() => ({
    cuarentena: window.__COI_OBS_H07_CUARENTENA__.cantidad(),
    marcador: localStorage.getItem('coi_observaciones_h03_imported_v1'),
    filas: window.__COI_OBS_H07_CUARENTENA__.filas().length
  }));

  expect(r.cuarentena).toBe(0);
  // Ya no es un '1' pelado: quedó migrado con huella.
  expect(marcadorConHuella(r.marcador)).toBe(true);
  // Y el material sigue intacto.
  expect(r.filas).toBe(1);
});

// ============ 19 · exportar documentación legada no finge documentación activa (F2)

test('H07-37 · «Exportar documentación» va al exportador de cuarentena, no a un CSV vacío', async ({ page }) => {
  await prepararH07(page);
  await abrirH07(page);

  const r = await page.evaluate(async () => {
    window.__H07_CSV__ = [];
    window.v64ExportarDocumentosCSV = (docs, nombre) =>
      window.__H07_CSV__.push({ filas: (docs || []).length, nombre });
    window.__H07_DESCARGAS__ = [];
    window.descargarArchivo = (nombre, contenido) => window.__H07_DESCARGAS__.push({ nombre, contenido });

    // Panel real de administración: el botón lo dibuja renderAdminEstado.
    let cont = document.getElementById('adminTabEstado');
    if (!cont) { cont = document.createElement('div'); cont.id = 'adminTabEstado'; document.body.appendChild(cont); }
    if (typeof window.renderAdminEstado === 'function') window.renderAdminEstado();
    await new Promise((r) => setTimeout(r, 200));

    const boton = document.getElementById('btnV64ExportDocGlobal');
    if (!boton) return { boton: false };
    const rotulo = String(boton.textContent || '');
    boton.click();
    await new Promise((r) => setTimeout(r, 400));

    return {
      boton: true,
      rotulo,
      csv: window.__H07_CSV__,
      descargas: window.__H07_DESCARGAS__.map((d) => ({ nombre: d.nombre, datos: JSON.parse(d.contenido) }))
    };
  });

  expect(r.boton).toBe(true);
  // El rótulo ya no promete documentación de la OC.
  expect(r.rotulo).toContain('cuarentena');
  expect(r.rotulo).not.toMatch(/CSV/i);
  // No se exportó ningún CSV vacío haciéndose pasar por documentación activa.
  expect(r.csv).toEqual([]);
  // Sí se exportó el material en cuarentena, declarado como no autoritativo.
  expect(r.descargas).toHaveLength(1);
  expect(r.descargas[0].nombre).toMatch(/^documentacion_oc_legacy_\d+\.json$/);
  expect(r.descargas[0].datos.autoritativo).toBe(false);
  expect(JSON.stringify(r.descargas[0].datos)).toContain('DOC-OC-LEGADO-H07');
});

// ============ 20 · un restore descartado no se anuncia como exitoso (F3)

test('H07-38 · si replace() devuelve discarded, el restore NO se declara exitoso', async ({ page }) => {
  await prepararH07(page, { eventos: EVENTOS_REMOTOS });
  await abrirH07(page);
  await page.waitForFunction(() => window.COI_TIMELINE_COI.isAuthoritativeReady() === true, null, { timeout: 20000 });

  const backup = await backupDe(page);

  const r = await page.evaluate(async (payload) => {
    window.__H07_VIVO__ = true;
    // La escritura llegó a Supabase pero una operación concurrente la invalidó:
    // el resultado no se publicó.
    window.COI_TIMELINE_COI.replace = async () => ({
      ok: true, count: 2, events: [], refreshed: false, discarded: true
    });
    window.confirm = () => true;

    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'fileImportarBackupV581';
    document.body.appendChild(input);
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Más que la ventana de recarga del importador (700 ms).
    await new Promise((r) => setTimeout(r, 1400));
    const caja = document.getElementById('coiToastV581');
    let meta = null;
    try { meta = JSON.parse(localStorage.getItem('coi_v581_backup_meta') || 'null'); } catch (e) {}
    return {
      vivo: window.__H07_VIVO__ === true,
      aviso: caja ? String(caja.textContent || '') : '',
      clase: caja ? String(caja.className || '') : '',
      meta,
      cache: localStorage.getItem('coi_timeline_events_v1')
    };
  }, backup);

  // No recargó: la página sigue siendo la misma.
  expect(r.vivo).toBe(true);
  // No anunció éxito; informó el descarte.
  expect(r.aviso).toContain('descartada');
  expect(r.aviso).toContain('DESCARTÓ');
  expect(r.aviso).not.toContain('Timeline restaurado y confirmado');
  expect(r.clase).toContain('warn');
  // La traza registra el estado real.
  expect(r.meta && r.meta.timeline).toBe('descartado');
  // Y la caché retirada tampoco se escribió.
  expect(r.cache).toBeNull();
});

test('H07-39 · un restore confirmado sí se declara restaurado', async ({ page }) => {
  await prepararH07(page, { eventos: EVENTOS_REMOTOS });
  await abrirH07(page);
  await page.waitForFunction(() => window.COI_TIMELINE_COI.isAuthoritativeReady() === true, null, { timeout: 20000 });

  const backup = await backupDe(page);

  const r = await page.evaluate(async (payload) => {
    window.COI_TIMELINE_COI.replace = async (eventos) => ({
      ok: true, count: (eventos || []).length, events: eventos, refreshed: true
    });
    window.confirm = () => true;

    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'fileImportarBackupV581';
    document.body.appendChild(input);
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Antes de la recarga diferida del importador.
    await new Promise((r) => setTimeout(r, 450));
    const caja = document.getElementById('coiToastV581');
    let meta = null;
    try { meta = JSON.parse(localStorage.getItem('coi_v581_backup_meta') || 'null'); } catch (e) {}
    return { aviso: caja ? String(caja.textContent || '') : '', meta };
  }, backup);

  expect(r.aviso).toContain('Timeline restaurado y confirmado');
  expect(r.meta && r.meta.timeline).toBe('restaurado');
});
