'use strict';

/* Fixture REMOTO del circuito contractual.

   A diferencia de los harness anteriores, este NO reemplaza
   cargarHistorialCircuitoOC, __COI_CIRCUITO_CACHE_GET__, resolverOrdenActual
   ni actualizarEstadoDocumentalDesdePasoContractual: la aplicacion corre su
   camino real de lectura, confirmacion y repintado. Lo unico falso es el
   cliente Supabase, y se comporta como Supabase:

   - las consultas respetan .eq(), .order() y .limit();
   - cada lectura devuelve COPIAS (nunca el objeto que la app ya tiene);
   - coi_confirmar_etapa_circuito_v3 es un port 1:1 de la migracion
     202609170002 (idempotencia, reingreso, primera confirmacion, gate de acta
     y conciliacion de fecha_acta_inicio), incluido el writer base que escribe
     las DOS filas ("Circuito administrativo" + "Cambio de estado contractual")
     y actualiza fecha_ultimo_control con el reloj del servidor;
   - el estado remoto vive en sessionStorage, asi un F5 relee lo persistido y
     no lo que la pagina tenia en memoria.

   Ninguna prueba toca datos reales. */

const UID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EMAIL = 'admin@coiroca.test';

function ordenBase(extra = {}) {
  return Object.assign({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    nro_oc: '4530009514',
    id_obra: 'OC-4530009514',
    tipo: 'Servicio', tipo_trabajo: 'Mantenimiento', especialidad: 'Ascensores',
    descripcion: 'Servicio contractual 10 hitos', proveedor: 'PROVEEDOR CT',
    estacion: 'PLAZA CONSTITUCION', ramal: 'La Plata', sector: 'Hall',
    monto_total: 1000, moneda: 'ARS', plazo_dias: 30,
    fecha_acta_inicio: null, fecha_vencimiento: '2026-12-31',
    estado_coi: 'PLIEGOS EN PREPARACIÓN', estado_documental: 'PLIEGOS EN PREPARACIÓN',
    estado_registro: 'Activo', fecha_ultimo_control: '2026-08-01T13:00:00.000Z',
    fecha_creacion: '2026-08-01T10:00:00.000Z', fecha_actualizacion: '2026-08-01T10:00:00.000Z'
  }, extra);
}

/* Evento tal como lo persiste el writer base: la fila canonica y su espejo
   de auditoria. `fechaEvento` es el timestamp tecnico; `fechaEfectiva` la
   fecha contractual. */
function evento(orden, codigo, fechaEvento, fechaEfectiva, opciones = {}) {
  const NOMBRES = {
    pliegos_preparacion: 'PLIEGOS EN PREPARACIÓN',
    pliegos_terminado_sin_solped: 'PLIEGOS TERMINADO SIN SOLPED',
    solped_sin_expediente: 'PLIEGO CON SOLPED SIN EXPTE',
    pliego_con_oc: 'PLIEGO CON OC',
    pliego_con_expediente: 'PLIEGO CON EXPTE',
    oc_sin_control_terceros: 'PLIEGO CON EXPTE Y CON OC EMITIDA, PERO SIN CONTROL DE 3',
    control_terceros_sin_acta: 'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',
    control_terceros_con_acta: 'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO',
    ejecucion: 'OBRA/SERVICIO EN EJECUCIÓN',
    cancelada_suspendida: 'OBRA/SERVICIO CANCELADA O SUSPENDIDA',
    finalizada: 'OBRA/SERVICIO FINALIZADA',
    finalizada_actas: 'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA',
    finalizada_saldo_remanente: 'OBRA/SERVICIO FINALIZADA PERO CON SALDO REMANENTE'
  };
  const base = {
    orden_id: orden.id, nro_oc: orden.nro_oc, valor_anterior: opciones.anterior || null,
    valor_nuevo: NOMBRES[codigo], usuario_email: EMAIL, creado_por: UID,
    fecha_evento: fechaEvento, fecha_efectiva: fechaEfectiva
  };
  const filas = [Object.assign({}, base, {
    id: 'ca-' + codigo + '-' + fechaEvento, tipo_evento: 'Circuito administrativo',
    campo_modificado: codigo, motivo: opciones.motivo || null
  })];
  if (opciones.espejo !== false) {
    filas.push(Object.assign({}, base, {
      id: 'ce-' + codigo + '-' + fechaEvento, tipo_evento: 'Cambio de estado contractual',
      campo_modificado: 'estado_documental', motivo: 'Selección de etapa contractual: ' + NOMBRES[codigo]
    }));
  }
  return filas;
}

async function prepararRemotoContractual(page, opciones = {}) {
  const cfg = Object.assign({ ordenes: [ordenBase()], historial: [], ahora: null }, opciones);
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  if (cfg.ahora) await page.clock.setFixedTime(new Date(cfg.ahora));

  await page.addInitScript(({ c, uid, email }) => {
    const CLAVE = '__CT10_REMOTO__';
    let remoto = null;
    try { remoto = JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); } catch (e) {}
    if (!remoto || !Array.isArray(remoto.ordenes)) {
      remoto = { ordenes: c.ordenes.map((o) => Object.assign({}, o)), historial: c.historial.map((h) => Object.assign({}, h)), seq: 0 };
    }
    const persistir = () => { try { sessionStorage.setItem(CLAVE, JSON.stringify(remoto)); } catch (e) {} };
    persistir();

    const copia = (x) => JSON.parse(JSON.stringify(x));
    const lecturas = { coi_historial_oc: [], coi_ordenes: 0 };
    window.__CT10__ = {
      rpc: [], lecturas,
      remoto: () => copia(remoto),
      historial: (nro) => copia(remoto.historial.filter((h) => !nro || h.nro_oc === nro)),
      orden: (nro) => copia(remoto.ordenes.find((o) => o.nro_oc === nro) || null)
    };

    // Reloj de servidor monotono: dos escrituras en el mismo ms no empatan.
    const reloj = () => {
      remoto.seq += 1;
      return new Date(Date.now() + remoto.seq).toISOString();
    };
    const hoyBA = () => {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const g = (k) => p.find((x) => x.type === k).value;
      return g('year') + '-' + g('month') + '-' + g('day');
    };
    const diaBA = (iso) => {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
      const g = (k) => p.find((x) => x.type === k).value;
      return g('year') + '-' + g('month') + '-' + g('day');
    };
    const plano = (v) => String(v == null ? '' : v).trim().toUpperCase()
      .replace(/[ÁÉÍÓÚÜÑº°]/g, (ch) => ({ 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ü': 'U', 'Ñ': 'N', 'º': 'O', '°': 'O' }[ch]));

    const NOMBRES = {
      pliegos_preparacion: 'PLIEGOS EN PREPARACIÓN',
      pliegos_terminado_sin_solped: 'PLIEGOS TERMINADO SIN SOLPED',
      solped_sin_expediente: 'PLIEGO CON SOLPED SIN EXPTE',
      pliego_con_oc: 'PLIEGO CON OC',
      pliego_con_expediente: 'PLIEGO CON EXPTE',
      oc_sin_control_terceros: 'PLIEGO CON EXPTE Y CON OC EMITIDA, PERO SIN CONTROL DE 3',
      control_terceros_sin_acta: 'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO',
      control_terceros_con_acta: 'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO',
      ejecucion: 'OBRA/SERVICIO EN EJECUCIÓN',
      cancelada_suspendida: 'OBRA/SERVICIO CANCELADA O SUSPENDIDA',
      finalizada: 'OBRA/SERVICIO FINALIZADA',
      finalizada_actas: 'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA',
      finalizada_saldo_remanente: 'OBRA/SERVICIO FINALIZADA PERO CON SALDO REMANENTE'
    };
    const GATE_LEGACY = [
      'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO', 'PLIEGO CON OC Y CONTROL DE 3° CON ACTA DE INICIO',
      'OBRA/SERVICIO EN EJECUCIÓN', 'OBRA/SERVICIO EN EJECUCION', 'OBRA/SERVICIO FINALIZADA',
      'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA', 'OBRA/SERVICIO FINALIZADA PERO CON SALDO REMANENTE'
    ];
    const insertar = (fila) => {
      const f = Object.assign({ id: 'h-' + (remoto.seq + 1) + '-' + Math.random().toString(36).slice(2, 8), fecha_evento: reloj(), usuario_email: email, creado_por: uid }, fila);
      remoto.historial.push(f);
      return f;
    };

    // Port de public.coi_confirmar_etapa_circuito (writer base).
    function writerBase(orden, codigo, observacion) {
      const nombre = NOMBRES[codigo];
      const anterior = orden.estado_documental != null ? orden.estado_documental : orden.estado_coi;
      const ya = remoto.historial.some((h) => h.orden_id === orden.id && h.tipo_evento === 'Circuito administrativo' &&
        (h.campo_modificado === codigo || (codigo === 'finalizada_saldo_remanente' && h.campo_modificado === 'enviada_pyc')));
      orden.estado_documental = nombre;
      orden.estado_coi = nombre;
      orden.fecha_ultimo_control = reloj();
      if (codigo === 'finalizada_saldo_remanente') orden.certificable_con_saldo = true;
      let historial = [];
      if (!ya) {
        historial = [
          insertar({ orden_id: orden.id, nro_oc: orden.nro_oc, tipo_evento: 'Circuito administrativo', campo_modificado: codigo, valor_anterior: anterior, valor_nuevo: nombre, motivo: String(observacion || '').trim() || null, fecha_efectiva: null }),
          insertar({ orden_id: orden.id, nro_oc: orden.nro_oc, tipo_evento: 'Cambio de estado contractual', campo_modificado: 'estado_documental', valor_anterior: anterior, valor_nuevo: nombre, motivo: 'Selección de etapa contractual: ' + nombre, fecha_efectiva: null })
        ];
      }
      return { orden: copia(orden), historial: copia(historial), codigo, nombre, ya_confirmada: ya, anterior };
    }

    // Port de public.coi_confirmar_etapa_circuito_v3 (202609170002).
    function rpcV3(args) {
      const codigo = String(args.p_codigo || '').trim().toLowerCase();
      const fechaParam = args.p_fecha_efectiva || null;
      if (fechaParam && fechaParam > hoyBA()) return { data: null, error: { code: '22007', message: 'COI_EFFECTIVE_DATE_FUTURE' } };
      const nombre = NOMBRES[codigo];
      if (!nombre) return { data: null, error: { code: '22023', message: 'COI_UNKNOWN_CIRCUIT_STAGE' } };
      const orden = remoto.ordenes.find((o) => o.id === args.p_orden_id);
      if (!orden) return { data: null, error: { code: 'P0002', message: 'COI_ORDER_NOT_FOUND' } };
      if (codigo === 'finalizada_saldo_remanente' && plano(orden.tipo) === 'OBRA')
        return { data: null, error: { code: '23514', message: 'COI_STAGE_NOT_APPLICABLE_TO_TYPE' } };
      const actual = orden.estado_documental != null ? orden.estado_documental : orden.estado_coi;
      const propias = remoto.historial.filter((h) => h.orden_id === orden.id && h.tipo_evento === 'Circuito administrativo' && h.campo_modificado === codigo);
      const visto = propias.length > 0;
      if (['ejecucion', 'finalizada', 'finalizada_actas', 'finalizada_saldo_remanente'].includes(codigo)) {
        const gate = remoto.historial.some((h) => h.orden_id === orden.id && h.tipo_evento === 'Circuito administrativo' && h.campo_modificado === 'control_terceros_con_acta');
        const legacy = GATE_LEGACY.map((x) => x.toUpperCase()).includes(String(actual || '').trim().toUpperCase());
        if (!orden.fecha_acta_inicio && !gate && !legacy)
          return { data: null, error: { code: '23514', message: 'COI_ACTA_INICIO_REQUIRED' } };
      }
      let resultado, fecha = fechaParam, idempotente = false;
      if (plano(actual) === plano(nombre) && visto) {
        const ultimo = propias.slice().sort((a, b) => (a.fecha_evento < b.fecha_evento ? 1 : a.fecha_evento > b.fecha_evento ? -1 : (a.id < b.id ? 1 : -1)))[0];
        idempotente = true;
        fecha = fechaParam || ultimo.fecha_efectiva || diaBA(ultimo.fecha_evento) || hoyBA();
        if (fechaParam) ultimo.fecha_efectiva = fecha;
        resultado = { orden: copia(orden), historial: [copia(ultimo)], codigo, nombre, ya_confirmada: true };
      } else {
        fecha = fechaParam || hoyBA();
        const base = writerBase(orden, codigo, args.p_observacion);
        if (base.ya_confirmada) {
          const filas = [
            insertar({ orden_id: orden.id, nro_oc: orden.nro_oc, tipo_evento: 'Circuito administrativo', campo_modificado: codigo, valor_anterior: actual, valor_nuevo: nombre, motivo: String(args.p_observacion || '').trim() || 'Reingreso a etapa previamente recorrida', fecha_efectiva: fecha }),
            insertar({ orden_id: orden.id, nro_oc: orden.nro_oc, tipo_evento: 'Cambio de estado contractual', campo_modificado: 'estado_documental', valor_anterior: actual, valor_nuevo: nombre, motivo: 'Reingreso contractual: ' + nombre, fecha_efectiva: fecha })
          ];
          resultado = { orden: base.orden, historial: copia(filas), codigo, nombre, ya_confirmada: false };
        } else {
          const ids = base.historial.map((h) => h.id);
          remoto.historial.forEach((h) => { if (ids.includes(h.id)) h.fecha_efectiva = fecha; });
          resultado = { orden: base.orden, historial: copia(remoto.historial.filter((h) => ids.includes(h.id))), codigo, nombre, ya_confirmada: false };
        }
      }
      if (codigo === 'control_terceros_con_acta' && !(idempotente && !fechaParam)) {
        if (!orden.fecha_acta_inicio) {
          orden.fecha_acta_inicio = fecha;
          resultado.acta_inicio = { estado: 'registrada', valor: fecha, valor_confirmacion: fecha };
        } else if (orden.fecha_acta_inicio === fecha) {
          resultado.acta_inicio = { estado: 'coincide', valor: orden.fecha_acta_inicio, valor_confirmacion: fecha };
        } else {
          const f = insertar({ orden_id: orden.id, nro_oc: orden.nro_oc, tipo_evento: 'Conciliación Acta de Inicio', campo_modificado: 'fecha_acta_inicio', valor_anterior: orden.fecha_acta_inicio, valor_nuevo: fecha, motivo: 'conflicto', fecha_efectiva: fecha });
          resultado.historial = resultado.historial.concat([copia(f)]);
          resultado.acta_inicio = { estado: 'conflicto', valor: orden.fecha_acta_inicio, valor_confirmacion: fecha };
        }
      }
      resultado.orden = copia(orden);
      resultado.fecha_efectiva = fecha;
      persistir();
      return { data: resultado, error: null };
    }

    function consulta(tabla) {
      const st = { filtros: [], orden: null, limite: null, conteo: false };
      const perfil = [{ id: uid, email, nombre: 'Admin', apellido: 'CT10', rol: 'administrador', activo: true }];
      const datos = () => tabla === 'coi_ordenes' ? remoto.ordenes : tabla === 'coi_historial_oc' ? remoto.historial : tabla === 'profiles' ? perfil : [];
      const cumple = (f) => st.filtros.every((x) => String(f[x.col]) === String(x.val));
      const api = {
        select(cols, o) { st.conteo = Boolean(o && o.head); return api; },
        order(col, o) { if (!st.orden) st.orden = { col, asc: !(o && o.ascending === false) }; return api; },
        limit(n) { st.limite = n; return api; },
        range() { return api; }, in() { return api; }, is() { return api; }, ilike() { return api; }, gt() { return api; },
        eq(col, val) { st.filtros.push({ col, val }); return api; },
        insert() { return api; }, update() { return api; }, delete() { return api; },
        single: async () => { const f = datos().filter(cumple)[0]; return f ? { data: copia(f), error: null } : { data: null, error: { message: 'no rows' } }; },
        maybeSingle: async () => { const f = datos().filter(cumple)[0]; return { data: f ? copia(f) : null, error: null }; },
        async _run() {
          if (tabla === 'coi_historial_oc') lecturas.coi_historial_oc.push(copia(st.filtros));
          if (tabla === 'coi_ordenes') lecturas.coi_ordenes += 1;
          let filas = datos().filter(cumple).map(copia);
          if (st.orden) {
            const { col, asc } = st.orden;
            filas.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
          }
          if (st.limite != null) filas = filas.slice(0, st.limite);
          if (st.conteo) return { data: null, count: filas.length, error: null };
          return { data: filas, error: null };
        },
        then(res, rej) { return api._run().then(res, rej); }
      };
      return api;
    }

    const fake = {
      from: (t) => consulta(t),
      rpc: async (nombre, args) => {
        window.__CT10__.rpc.push({ nombre, args: copia(args || {}) });
        if (nombre === 'coi_current_role') return { data: 'administrador', error: null };
        if (nombre === 'coi_confirmar_etapa_circuito_v3') return rpcV3(args || {});
        return { data: null, error: null };
      },
      storage: { from: () => ({ list: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: uid, email } } }, error: null }),
        getUser: async () => ({ data: { user: { id: uid, email } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
      }
    };

    window.__COI_SUPABASE_CLIENT__ = fake;
    window.getSupabaseClient = () => fake;
    window.initSupabase = async () => fake;
    window.getUsuarioActual = async () => ({ id: uid, email });
    window.esAutorizacionAdministrativaSupabaseV60 = () => true;
    window.confirm = () => true;
    window.prompt = () => '';
  }, { c: cfg, uid: UID, email: EMAIL });
}

/* Abre la Ficha por deep-link y espera a que el pipeline este montado con
   el historial remoto ya leido. */
async function abrirFichaContractual(page, nro = '4530009514') {
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto('/index.html?h14_force_auth=1#ficha-oc/' + nro + '/contractual', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fichaOCBody #etapa1PipelineContractual', { timeout: 25000 });
  await esperarHistorialLeido(page);
  return errores;
}

async function esperarHistorialLeido(page) {
  await page.waitForFunction(() => (window.__CT10__.lecturas.coi_historial_oc || []).length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}

/* Estado OBSERVABLE completo del modulo. Lo que el usuario ve, no el estado
   interno: es la base de las comparaciones de idempotencia y de F5. */
async function observable(page) {
  return page.evaluate(() => {
    const t = (sel) => { const n = document.querySelector(sel); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; };
    const host = document.querySelector('#fichaOCBody #etapa1PipelineContractual');
    const tarjetas = Array.from(document.querySelectorAll('#fichaOCBody #etapa1PipelineContractual [data-etapa1-hito]')).map((b) => ({
      codigo: b.getAttribute('data-etapa1-hito'),
      hito: b.getAttribute('data-etapa1-logico') || '',
      clase: (b.className.match(/etapa1-(pendiente|actual|completado)/) || [])[1] || '',
      estado: (b.querySelector('.etapa1-estado') || {}).textContent || '',
      meta: (b.querySelector('.etapa1-meta') || {}).textContent || '',
      dias: (b.querySelector('.etapa1-dias') || {}).textContent || '',
      oc: b.getAttribute('data-etapa1-oc') || ''
    }));
    return {
      oc: host ? host.getAttribute('data-etapa1-oc') : null,
      estadoActual: t('#etapa1EstadoActual'),
      ultimaAct: t('#etapa1UltimaAct'),
      diasEstado: t('#etapa1DiasEstado'),
      avance: t('#etapa1Avance'),
      etapa2: host ? (host.querySelector('#etapa1Panel2') || {}).getAttribute?.('data-etapa1-habilitada') : null,
      transversal: t('#etapa1AvisoTransversal'),
      aviso: t('#etapa1AvisoHitosSinRegistrar'),
      tarjetas
    };
  });
}

async function confirmarHito(page, codigo, fecha) {
  const card = page.locator('#fichaOCBody #etapa1PipelineContractual [data-etapa1-hito="' + codigo + '"]');
  const panel = await card.evaluate((n) => (n.closest('.etapa1-panel') || {}).id || '');
  if (panel) await page.locator('#fichaOCBody [data-etapa1-tab="' + panel + '"]').click();
  await card.click();
  await page.waitForSelector('#etapa1ModalConfirmar', { timeout: 5000 });
  if (fecha) await page.fill('#etapa1ModalFecha', fecha);
  const antes = await page.evaluate(() => window.__CT10__.lecturas.coi_historial_oc.length);
  await page.click('#etapa1ModalConfirmarBtn');
  try {
    await page.waitForSelector('#etapa1ModalConfirmar', { state: 'detached', timeout: 10000 });
  } catch (e) {
    const msg = await page.evaluate(() => (document.getElementById('etapa1ModalError') || {}).textContent || '');
    throw new Error('El modal no se cerró: ' + msg);
  }
  await page.waitForFunction((n) => window.__CT10__.lecturas.coi_historial_oc.length > n, antes, { timeout: 10000 });
  await page.waitForTimeout(500);
}

module.exports = { UID, EMAIL, ordenBase, evento, prepararRemotoContractual, abrirFichaContractual, esperarHistorialLeido, observable, confirmarHito };
