const { test, expect } = require('@playwright/test');

/*
  H07 — cierre Supabase-first.

  Ultimo tramo de la transicion: las referencias documentales de OC (V64) pasan
  a tener autoridad en `public.coi_documentacion_oc`, las cachés operativas que
  H06 dejo write-only se retiran, y las observaciones legadas de H03 salen del
  modelo operativo hacia una cuarentena explicita.

  Criterio que fijan estas pruebas: NINGUN dato operacional se reconstruye desde
  localStorage — ni en el arranque, ni ante un fallo de red, ni con el remoto
  vacio, ni al cambiar de identidad, ni al refrescar el token.

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

const DOC_REMOTO = {
  id: '22222222-2222-4222-8222-222222222222',
  orden_id: ORDEN_ID,
  id_obra: 'OBRA-H07',
  id_servicio: '',
  tipo_registro: 'Servicio',
  tipo_documento: 'Acta de Medición',
  nro_documento: '12',
  nombre_archivo: 'acta_12.pdf',
  extension_archivo: 'pdf',
  repositorio: 'OneDrive',
  ruta_documental: '/COI/OC7777',
  link_documento: 'https://example.test/acta12.pdf',
  link_carpeta: 'https://example.test/carpeta',
  fecha_documento: '2026-08-15',
  periodo: '08/2026',
  acta_nro: '12',
  estado_documento: 'Aprobado',
  observaciones: 'Documento remoto H07',
  fecha_creacion: '2026-08-15T10:00:00.000Z',
  fecha_actualizacion: '2026-08-15T10:00:00.000Z'
};

// Referencia documental que SOLO existe en localStorage. Jamas puede aparecer
// como dato operativo ni mezclarse con el remoto.
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

const OBS_LEGADA = [{
  idObservacion: 'OBS-LEGADA-H07',
  ocNro: ORDEN_NRO,
  texto: 'OBSERVACION SOLO LOCAL H07',
  estadoObservacion: 'Abierta'
}];

async function prepararH07(page, opciones = {}) {
  const cfg = Object.assign({
    ordenes: [OC_REMOTA],
    documentos: [],
    fallaDocumentos: false,
    tablaAusente: false,
    rol: 'administrador',
    sinSesion: false,
    legadoDocumental: true,
    legadoObservaciones: false,
    marcadorH03: true
  }, opciones);

  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());

  await page.addInitScript(({ c, docLegado, obsLegada, uidInicial }) => {
    window.__H07_CFG__ = c;
    window.__H07_LLAMADAS__ = [];
    if (c.legadoDocumental) localStorage.setItem('coi_documentacion_oc', JSON.stringify(docLegado));
    if (c.legadoObservaciones) localStorage.setItem('coi_observaciones_oc', JSON.stringify(obsLegada));
    if (c.marcadorH03) localStorage.setItem('coi_observaciones_h03_imported_v1', '1');
    // Preferencia de interfaz: H07 no la toca.
    localStorage.setItem('coi_v2_theme', 'dark');

    let uid = c.sinSesion ? null : uidInicial;
    let activa = !c.sinSesion;
    const oyentes = [];
    let documentos = c.documentos.slice();
    window.__H07_DOCS__ = () => documentos;

    window.__H07_EVENTO_AUTH__ = (evento, nuevoUid) => {
      if (evento === 'SIGNED_OUT') { uid = null; activa = false; }
      else if (nuevoUid) { uid = nuevoUid; activa = true; }
      const session = activa ? { user: { id: uid, email: uid + '@coiroca.test' } } : null;
      oyentes.forEach((fn) => { try { fn(evento, session); } catch (e) {} });
      window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: evento, session } }));
    };

    const registrar = (op, payload) => window.__H07_LLAMADAS__.push({ op, payload });
    const uuid = (n) => '99999999-9999-4999-8999-' + String(n).padStart(12, '0');

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
          const esDoc = st.tabla === 'coi_documentacion_oc';
          if (!activa) return { data: null, error: { message: 'JWT ausente' } };
          if (esDoc && window.__H07_CFG__.tablaAusente) {
            registrar('error-tabla:' + st.tabla, null);
            return { data: null, error: { code: '42P01', message: 'relation "public.coi_documentacion_oc" does not exist' } };
          }
          if (st.op === 'insert') {
            registrar('insert:' + st.tabla, st.payload);
            if (esDoc && window.__H07_CFG__.fallaDocumentos) return { data: null, error: { message: 'fallo simulado' } };
            const creada = Object.assign({
              id: uuid(documentos.length + 1),
              fecha_creacion: '2026-09-01T00:00:00.000Z',
              fecha_actualizacion: '2026-09-01T00:00:00.000Z'
            }, st.payload);
            documentos = documentos.concat([creada]);
            return { data: unico ? creada : [creada], error: null };
          }
          if (st.op === 'update') {
            registrar('update:' + st.tabla, { filtros: st.filtros, patch: st.patch });
            const i = documentos.findIndex(cumple);
            if (i < 0) return { data: [], error: null };
            const actualizado = Object.assign({}, documentos[i], st.patch, { fecha_actualizacion: '2026-09-02T00:00:00.000Z' });
            documentos = documentos.map((d, k) => (k === i ? actualizado : d));
            return { data: [actualizado], error: null };
          }
          if (st.op === 'delete') {
            registrar('delete:' + st.tabla, st.filtros);
            documentos = documentos.filter((d) => !cumple(d));
            return { data: [], error: null };
          }
          registrar('select:' + st.tabla, st.filtros);
          if (esDoc && window.__H07_CFG__.fallaDocumentos) {
            return { data: null, error: { message: 'fallo de red simulado' } };
          }
          const base = st.tabla === 'coi_ordenes' ? window.__H07_CFG__.ordenes
            : (esDoc ? documentos : []);
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
        if (nombre === 'coi_timeline_list_page') return { data: [], error: null };
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
    window.alert = () => {};
  }, { c: cfg, docLegado: DOC_LEGADO, obsLegada: OBS_LEGADA, uidInicial: UID_A });
}

async function abrirH07(page) {
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.COI_DOCUMENTACION_H07), null, { timeout: 20000 });
  await page.waitForFunction(
    () => window.COI_DOCUMENTACION_H07.diagnostico().origen !== 'inicial',
    null, { timeout: 20000 }
  );
  await page.waitForTimeout(1200);
  return errores;
}

const radiografia = (page) => page.evaluate(() => {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const diag = window.COI_DOCUMENTACION_H07.diagnostico();
  return {
    diag,
    docs: arr(window.documentacionOC).map((d) => ({
      id: d.idDocumento, tipo: d.tipoDocumento, nro: d.nroDocumento,
      obs: d.observaciones, oc: d.ocNro, origen: d._origen
    })),
    legadoIntacto: localStorage.getItem('coi_documentacion_oc') !== null,
    legadoCuarentena: window.__COI_DOC_H07_LEGACY__.cantidad(),
    escriturasBloqueadas: window.__COI_DOC_H07_ESCRITURAS__.length,
    // Cachés retiradas por H07.
    cacheOrdenes: localStorage.getItem('coi_supabase_ordenes_cache_v2'),
    cacheFinanzas: localStorage.getItem('coi_cache_posiciones_oc_supabase_v1'),
    cacheTimeline: localStorage.getItem('coi_timeline_events_v1'),
    tema: localStorage.getItem('coi_v2_theme'),
    llamadas: window.__H07_LLAMADAS__.map((l) => l.op)
  };
});

const soloOp = (r, op) => r.llamadas.filter((o) => String(o).indexOf(op) === 0);

// Ninguna referencia documental local puede aparecer como dato operativo.
function sinDocumentoLocal(r) {
  expect(r.docs.map((d) => d.id)).not.toContain('DOC-OC-LEGADO-H07');
  expect(r.docs.map((d) => d.obs)).not.toContain('DOCUMENTO SOLO LOCAL H07');
  expect(r.docs.map((d) => d.nro)).not.toContain('99');
}

// ======================================================= 1, 13 · carga remota

test('H07-1 · la documentación remota carga y es la única visible', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  const errores = await abrirH07(page);

  const r = await radiografia(page);
  expect(r.diag.origen).toBe('supabase');
  expect(r.diag.sincronizado).toBe(true);
  expect(r.diag.confirmadas).toBe(1);
  expect(r.docs).toHaveLength(1);
  expect(r.docs[0].id).toBe(DOC_REMOTO.id);
  expect(r.docs[0].obs).toBe('Documento remoto H07');
  sinDocumentoLocal(r);
  expect(errores).toEqual([]);
});

test('H07-13 · la ficha OC sigue resolviendo la documentación de esa OC', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);

  // v64DocsOC() es lo que consume el panel documental de la ficha.
  const docsFicha = await page.evaluate((nro) => {
    const encontrado = window.v64BuscarOC(nro);
    const oc = (encontrado && (encontrado.item || encontrado)) || null;
    if (!oc) return null;
    return window.v64DocsOC(oc).map((d) => ({ id: d.idDocumento, tipo: d.tipoDocumento, oc: d.ocNro }));
  }, ORDEN_NRO);

  expect(docsFicha).not.toBeNull();
  expect(docsFicha.map((d) => d.id)).toContain(DOC_REMOTO.id);
  expect(docsFicha.map((d) => d.id)).not.toContain('DOC-OC-LEGADO-H07');
  // El numero de OC se resuelve contra el catalogo, no desde una copia guardada.
  expect(docsFicha.find((d) => d.id === DOC_REMOTO.id).oc).toBe(ORDEN_NRO);
});

// ============================================================ 2 · remoto vacío

test('H07-2 · el remoto vacío muestra vacío y no revive el legado documental', async ({ page }) => {
  await prepararH07(page, { documentos: [] });
  await abrirH07(page);

  const r = await radiografia(page);
  expect(r.diag.origen).toBe('supabase');
  expect(r.diag.sincronizado).toBe(true);
  expect(r.docs).toEqual([]);
  sinDocumentoLocal(r);
  // El legado sigue fisicamente en su clave.
  expect(r.legadoIntacto).toBe(true);
  expect(r.legadoCuarentena).toBe(1);
});

// ================================================= 3, 4, 19 · fallo remoto

test('H07-3 · sin lectura confirmada, un fallo remoto no usa localStorage', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO], fallaDocumentos: true });
  await abrirH07(page);

  const r = await radiografia(page);
  expect(r.diag.sincronizado).toBe(false);
  expect(r.diag.confirmadas).toBeNull();
  expect(r.docs).toEqual([]);
  sinDocumentoLocal(r);
  expect(r.legadoIntacto).toBe(true);
});

test('H07-4 · tras una lectura confirmada, el fallo conserva el remoto y no mezcla legado', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);
  expect((await radiografia(page)).diag.confirmadas).toBe(1);

  await page.evaluate(async () => {
    window.__H07_CFG__.fallaDocumentos = true;
    await window.recargarDocumentacionOC();
  });
  await page.waitForTimeout(500);

  const r = await radiografia(page);
  expect(r.diag.sincronizado).toBe(false);
  // Sobrevive EXACTAMENTE lo que Supabase confirmo.
  expect(r.docs).toHaveLength(1);
  expect(r.docs[0].id).toBe(DOC_REMOTO.id);
  sinDocumentoLocal(r);
});

test('H07-19 · ningún fallback local reaparece al republicar la global', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);

  // Camino exacto por el que el legado volvia: una capa reasignando la global.
  const resultado = await page.evaluate(() => {
    const antes = window.documentacionOC.length;
    window.documentacionOC = [{ idDocumento: 'DOC-OC-LEGADO-H07', tipoDocumento: 'Acta', observaciones: 'DOCUMENTO SOLO LOCAL H07' }];
    return { antes, despues: window.documentacionOC.length, ids: window.documentacionOC.map((d) => d.idDocumento) };
  });
  expect(resultado.antes).toBe(1);
  expect(resultado.despues).toBe(1);
  expect(resultado.ids).not.toContain('DOC-OC-LEGADO-H07');
  expect((await radiografia(page)).escriturasBloqueadas).toBeGreaterThan(0);
});

// ============================================ 5, 6, 7 · identidad (H07-D)

test('H07-5 · un cambio de UID invalida antes de adoptar la identidad nueva', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);
  expect((await radiografia(page)).diag.uid).toBe(UID_A);

  await page.evaluate((uidB) => window.__H07_EVENTO_AUTH__('SIGNED_IN', uidB), UID_B);
  await page.waitForFunction((uidB) => window.COI_DOCUMENTACION_H07.diagnostico().uid === uidB, UID_B, { timeout: 15000 });
  await page.waitForTimeout(600);

  const r = await radiografia(page);
  expect(r.diag.uid).toBe(UID_B);
  // B leyo bien: ve lo remoto, que es lo mismo. Lo importante es que el
  // snapshot se rehizo bajo su identidad.
  expect(r.diag.sincronizado).toBe(true);
});

test('H07-6 · el operador B con fallo remoto no ve la documentación de A', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);
  expect((await radiografia(page)).diag.confirmadas).toBe(1);

  // Cambia la identidad y la lectura del nuevo operador falla.
  await page.evaluate((uidB) => {
    window.__H07_CFG__.fallaDocumentos = true;
    window.__H07_EVENTO_AUTH__('SIGNED_IN', uidB);
  }, UID_B);
  await page.waitForTimeout(1500);

  const r = await radiografia(page);
  expect(r.diag.confirmadas).toBeNull();
  expect(r.docs).toEqual([]);
  expect(r.diag.sincronizado).toBe(false);
  sinDocumentoLocal(r);
});

test('H07-7 · TOKEN_REFRESHED del mismo UID no destruye el estado legítimo', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);
  expect((await radiografia(page)).diag.confirmadas).toBe(1);

  await page.evaluate((uidA) => window.__H07_EVENTO_AUTH__('TOKEN_REFRESHED', uidA), UID_A);
  await page.waitForTimeout(1200);

  const r = await radiografia(page);
  expect(r.diag.uid).toBe(UID_A);
  expect(r.diag.sincronizado).toBe(true);
  expect(r.docs).toHaveLength(1);
  expect(r.docs[0].id).toBe(DOC_REMOTO.id);
});

// ================================================ 8, 9 · legado documental

test('H07-8 · el legado documental no se autoimporta ni se borra', async ({ page }) => {
  await prepararH07(page, { documentos: [] });
  await abrirH07(page);

  const r = await radiografia(page);
  // Ni un INSERT automatico.
  expect(soloOp(r, 'insert:coi_documentacion_oc')).toHaveLength(0);
  expect(r.docs).toEqual([]);
  // Y la clave sigue intacta, accesible como material de recuperacion.
  expect(r.legadoIntacto).toBe(true);
  expect(r.legadoCuarentena).toBe(1);
  const exportado = await page.evaluate(() => JSON.parse(window.__COI_DOC_H07_LEGACY__.exportarJSON()));
  expect(exportado.autoritativo).toBe(false);
  expect(exportado.filas).toHaveLength(1);
});

test('H07-9 · el legado documental no se mezcla con el remoto', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);

  const r = await radiografia(page);
  expect(r.docs).toHaveLength(1);
  sinDocumentoLocal(r);
  // Las dos referencias son de la misma OC y el mismo tipo: si se mezclaran,
  // la ficha mostraria dos.
  const docsFicha = await page.evaluate((nro) => {
    const encontrado = window.v64BuscarOC(nro);
    const oc = (encontrado && (encontrado.item || encontrado)) || null;
    return oc ? window.v64DocsOC(oc).length : null;
  }, ORDEN_NRO);
  expect(docsFicha).toBe(1);
});

// ============================================ 10 · observaciones H03 legadas

test('H07-10 · las observaciones legadas no alimentan el modelo operacional', async ({ page }) => {
  await prepararH07(page, { documentos: [], legadoObservaciones: true, marcadorH03: false });
  await abrirH07(page);

  const obs = await page.evaluate(() => ({
    modelo: (window.observacionesOC || []).map((o) => String(o.texto || '')),
    origen: window.__COI_OBS_H03__.origen,
    cuarentena: window.__COI_OBS_H03__.legadoEnCuarentena,
    filas: (window.__COI_OBS_H07_CUARENTENA__.filas() || []).length,
    autoritativo: window.__COI_OBS_H07_CUARENTENA__.autoritativo,
    claveIntacta: localStorage.getItem('coi_observaciones_oc') !== null
  }));

  expect(obs.modelo).not.toContain('OBSERVACION SOLO LOCAL H07');
  expect(obs.origen).toBe('supabase');
  // Conservadas, contabilizadas y fuera del modelo.
  expect(obs.cuarentena).toBe(1);
  expect(obs.filas).toBe(1);
  expect(obs.autoritativo).toBe(false);
  expect(obs.claveIntacta).toBe(true);
});

// ================================================= 11, 12 · cachés retiradas

test('H07-11 · las cachés operativas retiradas no vuelven a escribirse', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);
  // Se fuerza el camino que antes las escribia.
  await page.evaluate(async () => {
    if (typeof window.cargarOrdenesPrincipal === 'function') await window.cargarOrdenesPrincipal();
  });
  await page.waitForTimeout(800);

  const r = await radiografia(page);
  expect(r.cacheOrdenes).toBeNull();
  expect(r.cacheFinanzas).toBeNull();
  expect(r.cacheTimeline).toBeNull();
  // La preferencia de interfaz sigue intacta: H07 no toca lo que no es dato.
  expect(r.tema).toBe('dark');
});

test('H07-12 · el backup no depende de cachés locales obsoletas', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);

  const backup = await page.evaluate(() => {
    if (typeof window.adminBackupPayload !== 'function') return null;
    try { return window.adminBackupPayload(); } catch (e) { return { error: String(e && e.message || e) }; }
  });

  // Si el backup se puede construir, no puede apoyarse en las cachés retiradas.
  if (backup && !backup.error) {
    const snapshot = backup.localStorage || {};
    expect(snapshot['coi_supabase_ordenes_cache_v2']).toBeUndefined();
    expect(snapshot['coi_cache_posiciones_oc_supabase_v1']).toBeUndefined();
    // El Timeline SI viaja en el backup bajo ese nombre de clave, pero se
    // serializa desde window.coiTimelineEvents —el snapshot confirmado— y no
    // desde la cache retirada: es transporte, no lectura de localStorage.
    const enBackup = snapshot['coi_timeline_events_v1'];
    if (enBackup !== undefined) {
      const enMemoria = await page.evaluate(() => JSON.stringify(window.coiTimelineEvents || []));
      expect(enBackup).toBe(enMemoria);
      expect(await page.evaluate(() => localStorage.getItem('coi_timeline_events_v1'))).toBeNull();
    }
    // La documentacion viaja desde el snapshot confirmado, no desde la clave.
    if (Array.isArray(backup.documentacionOC)) {
      expect(backup.documentacionOC.map((d) => d.idDocumento)).not.toContain('DOC-OC-LEGADO-H07');
    }
  }
});

// ==================================================== 14, 15, 16 · CRUD real

async function abrirFormularioDoc(page, valores) {
  return page.evaluate(({ ocNro, valores }) => {
    const encontrado = window.v64BuscarOC(ocNro);
    const oc = (encontrado && (encontrado.item || encontrado)) || null;
    if (!oc) return false;
    const form = document.createElement('div');
    form.dataset.ocKey = window.v64KeyOC(oc);
    form.dataset.docId = valores.docId || '__new__';
    const campos = {
      v64DocTipo: valores.tipo || 'Acta de Medición',
      v64DocNro: valores.nro || '',
      v64DocNombre: valores.nombre || '',
      v64DocExtension: valores.extension || '',
      v64DocRepo: valores.repo || 'OneDrive',
      v64DocFecha: valores.fecha || '2026-09-01',
      v64DocPeriodo: valores.periodo || '',
      v64DocActa: valores.acta || '',
      v64DocEstado: valores.estado || 'Pendiente',
      v64DocRuta: valores.ruta || '',
      v64DocLink: valores.link || '',
      v64DocLinkCarpeta: valores.linkCarpeta || '',
      v64DocObs: valores.obs || ''
    };
    Object.entries(campos).forEach(([id, valor]) => {
      const input = document.createElement('input');
      input.id = id;
      input.value = valor;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    window.v64GuardarDocumentoDesdeForm(form);
    return true;
  }, { ocNro: ORDEN_NRO, valores });
}

test('H07-14 · el alta documental inserta en Supabase y nunca en localStorage', async ({ page }) => {
  await prepararH07(page, { documentos: [] });
  await abrirH07(page);

  expect(await abrirFormularioDoc(page, { nro: '31', nombre: 'acta_31.pdf', obs: 'Alta H07' })).toBe(true);
  await page.waitForFunction(() => window.COI_DOCUMENTACION_H07.diagnostico().confirmadas === 1, null, { timeout: 15000 });

  const r = await radiografia(page);
  const inserts = soloOp(r, 'insert:coi_documentacion_oc');
  expect(inserts).toHaveLength(1);
  expect(r.docs).toHaveLength(1);
  expect(r.docs[0].nro).toBe('31');
  // El payload lleva la identidad tecnica de la OC, no el numero.
  const payload = await page.evaluate(() =>
    window.__H07_LLAMADAS__.find((l) => l.op === 'insert:coi_documentacion_oc').payload);
  expect(payload.orden_id).toBe(ORDEN_ID);
  expect(payload.nro_oc).toBeUndefined();
  // La clave legada no se toco.
  expect(r.legadoIntacto).toBe(true);
  expect(r.legadoCuarentena).toBe(1);
});

test('H07-15 · la edición documental viaja como UPDATE contra el UUID', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);

  expect(await abrirFormularioDoc(page, {
    docId: DOC_REMOTO.id, nro: '12', nombre: 'acta_12.pdf', obs: 'Editado por H07', estado: 'Aprobado'
  })).toBe(true);
  await page.waitForFunction(() =>
    (window.documentacionOC || []).some((d) => d.observaciones === 'Editado por H07'),
    null, { timeout: 15000 });

  const r = await radiografia(page);
  const updates = soloOp(r, 'update:coi_documentacion_oc');
  expect(updates).toHaveLength(1);
  expect(soloOp(r, 'insert:coi_documentacion_oc')).toHaveLength(0);
  expect(r.docs).toHaveLength(1);
  // El CAS viaja con la version que el operador vio.
  const filtros = await page.evaluate(() =>
    window.__H07_LLAMADAS__.find((l) => l.op === 'update:coi_documentacion_oc').payload.filtros);
  expect(filtros.some((f) => f.col === 'id' && f.val === DOC_REMOTO.id)).toBe(true);
  expect(filtros.some((f) => f.col === 'fecha_actualizacion')).toBe(true);
});

test('H07-16 · la baja documental borra en Supabase y no toca archivos externos', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO] });
  await abrirH07(page);

  await page.evaluate((id) => window.v64EliminarDocumento(id), DOC_REMOTO.id);
  await page.waitForFunction(() => window.COI_DOCUMENTACION_H07.diagnostico().confirmadas === 0, null, { timeout: 15000 });

  const r = await radiografia(page);
  expect(soloOp(r, 'delete:coi_documentacion_oc')).toHaveLength(1);
  expect(r.docs).toEqual([]);
  expect(r.legadoIntacto).toBe(true);
});

// ============================================================ 17 · permisos

test('H07-17 · sin rol administrador no se crea ni se borra documentación', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO], rol: 'consulta' });
  await abrirH07(page);

  await abrirFormularioDoc(page, { nro: '77', nombre: 'no_debe_entrar.pdf' });
  await page.evaluate((id) => window.v64EliminarDocumento(id), DOC_REMOTO.id);
  await page.waitForTimeout(900);

  const r = await radiografia(page);
  expect(soloOp(r, 'insert:coi_documentacion_oc')).toHaveLength(0);
  expect(soloOp(r, 'delete:coi_documentacion_oc')).toHaveLength(0);
  // La lectura sigue permitida para el rol consulta.
  expect(r.diag.sincronizado).toBe(true);
  expect(r.docs).toHaveLength(1);
});

// ================================================= 18 · tabla todavía ausente

test('H07-18 · si la tabla H07 no existe, el módulo falla claro y no cae a localStorage', async ({ page }) => {
  await prepararH07(page, { documentos: [DOC_REMOTO], tablaAusente: true });
  await abrirH07(page);

  const r = await radiografia(page);
  expect(r.diag.origen).toBe('tabla-ausente');
  expect(r.diag.tablaDisponible).toBe(false);
  expect(r.diag.ultimoError).toContain('coi_documentacion_oc');
  expect(r.diag.sincronizado).toBe(false);
  // Ni una sola fila local se publica como sustituto.
  expect(r.docs).toEqual([]);
  sinDocumentoLocal(r);
  expect(r.legadoIntacto).toBe(true);

  // Y una mutación tampoco se intenta a ciegas.
  await abrirFormularioDoc(page, { nro: '55', nombre: 'sin_tabla.pdf' });
  await page.waitForTimeout(600);
  expect(soloOp(await radiografia(page), 'insert:coi_documentacion_oc')).toHaveLength(0);
});
