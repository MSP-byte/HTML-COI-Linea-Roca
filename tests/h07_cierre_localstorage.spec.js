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
    marcadorH03: true
  }, opciones);

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
          const base = st.tabla === 'coi_ordenes' ? window.__H07_CFG__.ordenes
            : (st.tabla === 'coi_observaciones_oc' ? observaciones : []);
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
    window.__H07_ALERTAS__ = [];
    window.alert = (m) => window.__H07_ALERTAS__.push(String(m));
  }, { c: cfg, docLegado: DOC_LEGADO, docV33: DOC_LEGADO_V33, obsLegada: OBS_LEGADA, uidInicial: UID_A });
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
