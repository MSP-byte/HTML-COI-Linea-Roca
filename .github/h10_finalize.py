from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8').replace('\r\n', '\n').replace('\r', '\n')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8', newline='\n')


def replace_one(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f'{label}: esperaba 1 coincidencia exacta y encontro {n}')
    return text.replace(old, new, 1)


def sub_one(text, pattern, repl, label):
    out, n = re.subn(pattern, repl, text, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f'{label}: esperaba 1 coincidencia regex y encontro {n}')
    return out


# ---------------------------------------------------------------- index.html
p = 'index.html'
html = read(p)

# P1: no hacer SELECT previo + UPDATE. El RPC integral ya toma FOR UPDATE; la
# migracion H10 instala guards BEFORE UPDATE dentro de esa misma transaccion.
html = sub_one(
    html,
    r"\n  async function leerCierreRemoto\(uuid\) \{.*?\n  \}\n\n  async function refrescarTrasCierreAjeno",
    "\n  async function refrescarTrasCierreAjeno",
    'retirar leerCierreRemoto TOCTOU'
)

html = sub_one(
    html,
    r"      // El snapshot local puede haber quedado viejo mientras otro operador\n"
    r"      // cerraba la OC\. Antes de escribir se relee Supabase y se preserva el\n"
    r"      // PRIMER cierre confirmado: fecha y observacion no se pisan con una\n"
    r"      // segunda decision tomada sobre una pantalla desactualizada\.\n"
    r"      const remotoAntes = await leerCierreRemoto\(uuid\);\n"
    r"      if \(cerradaOperativa\(remotoAntes\)\) \{\n"
    r"        await refrescarTrasCierreAjeno\(\);\n"
    r"        avisar\('La OC ya fue cerrada operativamente por otra actualización\. Se conservó el cierre existente\.', 'info'\);\n"
    r"        sincronizar\(\);\n"
    r"        return false;\n"
    r"      \}\n\n",
    "      // La atomicidad vive en PostgreSQL: coi_actualizar_orden_integral toma\n"
    "      // FOR UPDATE y los guards H10 impiden que un segundo cierre modifique\n"
    "      // fecha u observacion del primer cierre confirmado.\n",
    'retirar check-then-update de cierre'
)

html = replace_one(
    html,
    "    } catch (error) {\n"
    "      const detalle = (error && error.message) || String(error);\n"
    "      avisar('No se pudo cerrar la OC: ' + detalle + ' El estado no cambió.', 'error');\n"
    "      sincronizar();\n"
    "      return false;\n"
    "    } finally {",
    "    } catch (error) {\n"
    "      const detalle = (error && error.message) || String(error);\n"
    "      if (/COI_CLOSURE_IMMUTABLE|COI_ORDER_ALREADY_CLOSED/.test(detalle)) {\n"
    "        await refrescarTrasCierreAjeno();\n"
    "        avisar('La OC ya fue cerrada operativamente por otra actualización. Se conservó el cierre existente.', 'info');\n"
    "        sincronizar();\n"
    "        return false;\n"
    "      }\n"
    "      avisar('No se pudo cerrar la OC: ' + detalle + ' El estado no cambió.', 'error');\n"
    "      sincronizar();\n"
    "      return false;\n"
    "    } finally {",
    'manejar conflicto atomico de cierre'
)

# P1/P1: el editor generico no expone ni envia transiciones de archivo ni
# campos de auditoria de cierre. ALLOWED se conserva para el repositorio.
html = replace_one(
    html,
    "  const PROTECTED=Object.freeze(['id','nro_oc','creado_por','fecha_creacion','actualizado_por','fecha_actualizacion','saldo_remanente']);\n"
    "  const DATE_FIELDS=new Set(['fecha_acta_inicio','fecha_vencimiento','proxima_certificacion','fecha_recepcion_documentacion','fecha_ultimo_control','fecha_cierre_operativo','control_terceros_hasta']);",
    "  const PROTECTED=Object.freeze(['id','nro_oc','creado_por','fecha_creacion','actualizado_por','fecha_actualizacion','saldo_remanente']);\n"
    "  const EDITOR_BLOCKED=new Set(['estado_registro','fecha_cierre_operativo','observacion_cierre']);\n"
    "  const EDITOR_FIELDS=Object.freeze(ALLOWED.filter(name=>!EDITOR_BLOCKED.has(name)));\n"
    "  const DATE_FIELDS=new Set(['fecha_acta_inicio','fecha_vencimiento','proxima_certificacion','fecha_recepcion_documentacion','fecha_ultimo_control','fecha_cierre_operativo','control_terceros_hasta']);",
    'separar allowlist RPC de campos editables'
)

html = replace_one(
    html,
    "    ['Documentación',['fecha_recepcion_documentacion','estado_documental']],\n"
    "    ['Gestión COI',['estado_coi','estado_registro','observaciones','responsable_coi','requiere_accion','motivo_requiere_accion','fecha_ultimo_control']],\n"
    "    ['Control de Terceros',['control_terceros_hasta']],\n"
    "    ['Cierre',['fecha_cierre_operativo','observacion_cierre']],\n"
    "    ['Calidad y prioridad',['calidad_datos_estado','calidad_datos_score','prioridad_operativa']]",
    "    ['Documentación',['fecha_recepcion_documentacion','estado_documental']],\n"
    "    ['Gestión COI',['estado_coi','observaciones','responsable_coi','requiere_accion','motivo_requiere_accion','fecha_ultimo_control']],\n"
    "    ['Control de Terceros',['control_terceros_hasta']],\n"
    "    ['Calidad y prioridad',['calidad_datos_estado','calidad_datos_score','prioridad_operativa']]",
    'retirar archivo y auditoria de SECTIONS'
)

html = replace_one(
    html,
    "  async function saveEditor(){\n"
    "    if(!editState||savePromise)return;const modal=editState.modal,button=modal.querySelector('#coiEditSaveV60'),errorBox=modal.querySelector('#coiEditErrorV60');showFieldErrors();errorBox.textContent='';button.disabled=true;button.textContent='Guardando…';\n"
    "    try{\n"
    "      const current=collectForm(modal),baseline=JSON.parse(editState.baseline),changes={};for(const name of ALLOWED)if(has(current,name)&&comparable(name,current[name])!==comparable(name,baseline[name]))changes[name]=current[name];",
    "  function estadoCierreEditor(value){const n=text(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase();return n==='CERRADA'||n==='CERRADO';}\n"
    "  function validarLifecycleEditor(current,baseline){\n"
    "    if(has(current,'estado_coi')&&has(baseline,'estado_coi')&&comparable('estado_coi',current.estado_coi)!==comparable('estado_coi',baseline.estado_coi)&&(estadoCierreEditor(current.estado_coi)||estadoCierreEditor(baseline.estado_coi)))throw new Error('El cierre operativo no se edita desde este formulario. Use «Cerrar OC».');\n"
    "  }\n"
    "  async function saveEditor(){\n"
    "    if(!editState||savePromise)return;const modal=editState.modal,button=modal.querySelector('#coiEditSaveV60'),errorBox=modal.querySelector('#coiEditErrorV60');showFieldErrors();errorBox.textContent='';button.disabled=true;button.textContent='Guardando…';\n"
    "    try{\n"
    "      const current=collectForm(modal),baseline=JSON.parse(editState.baseline);validarLifecycleEditor(current,baseline);const changes={};for(const name of EDITOR_FIELDS)if(has(current,name)&&comparable(name,current[name])!==comparable(name,baseline[name]))changes[name]=current[name];",
    'blindar saveEditor'
)

html = replace_one(
    html,
    "window.COI_ORDENES_EDIT_V60=Object.freeze({version:'V60.0-EDITAR-OC-A',abrir:openEditor,cerrar:closeEditor,actualizar,parseAmount,normalizarCambios:normalizeChanges,camposEditables:ALLOWED,camposProtegidos:PROTECTED,rpcRenumerarInstalada:RENUMBER_RPC_INSTALLED,cacheKey:CACHE_KEY});",
    "window.COI_ORDENES_EDIT_V60=Object.freeze({version:'V60.0-EDITAR-OC-A',abrir:openEditor,cerrar:closeEditor,actualizar,parseAmount,normalizarCambios:normalizeChanges,camposEditables:EDITOR_FIELDS,camposProtegidos:PROTECTED,rpcRenumerarInstalada:RENUMBER_RPC_INSTALLED,cacheKey:CACHE_KEY});",
    'exportar campos editables seguros'
)

# P2: #ficha-um sin identidad vuelve al inventario y no reutiliza UM stale.
html = replace_one(
    html,
    "        if (!id) { abrirVista('vistaFichaUM'); return; }",
    "        if (!id) {\n"
    "          try { window.umActualId = ''; } catch (e) {}\n"
    "          abrirVista('vistaUnidadesMantenimiento');\n"
    "          aplicarTabUM('inventario');\n"
    "          return;\n"
    "        }",
    'ficha-um incompleta a inventario'
)

write(p, html)

# ---------------------------------------------------------------- migration H10 lifecycle guard
migration = r'''-- H10 - atomicidad e invariantes del ciclo Cerrar / Archivar OC.
-- No agrega tablas ni columnas. Endurece cualquier UPDATE, incluida la RPC
-- coi_actualizar_orden_integral, para que el primer cierre confirmado sea
-- inmutable y una OC no pueda archivarse antes de estar cerrada.

begin;

create or replace function public.coi_guard_order_lifecycle_h10()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_estado_cerrado boolean;
  v_new_estado_cerrado boolean;
  v_old_cerrado boolean;
  v_new_cerrado boolean;
  v_old_registro text;
  v_new_registro text;
begin
  v_old_estado_cerrado := upper(btrim(coalesce(old.estado_coi, ''))) in ('CERRADA', 'CERRADO');
  v_new_estado_cerrado := upper(btrim(coalesce(new.estado_coi, ''))) in ('CERRADA', 'CERRADO');
  v_old_registro := upper(btrim(coalesce(old.estado_registro, '')));
  v_new_registro := upper(btrim(coalesce(new.estado_registro, '')));

  v_old_cerrado := v_old_estado_cerrado
    or old.fecha_cierre_operativo is not null
    or v_old_registro = 'CERRADO';
  v_new_cerrado := v_new_estado_cerrado
    or new.fecha_cierre_operativo is not null
    or v_new_registro = 'CERRADO';

  if tg_name = 'coi_ordenes_h10_audit_guard' then
    -- UPDATE OF dispara aun cuando se intente escribir el mismo valor: una vez
    -- cerrada, fecha y motivo pertenecen al primer cierre y no se reescriben.
    if v_old_cerrado then
      raise exception using
        errcode = 'P0001',
        message = 'COI_CLOSURE_IMMUTABLE',
        detail = 'fecha_cierre_operativo y observacion_cierre pertenecen al primer cierre confirmado';
    end if;

    if not v_new_estado_cerrado
       or new.fecha_cierre_operativo is null
       or nullif(btrim(coalesce(new.observacion_cierre, '')), '') is null then
      raise exception using
        errcode = 'P0001',
        message = 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT',
        detail = 'el cierre requiere estado_coi Cerrada, fecha y observacion en la misma transaccion';
    end if;
    return new;
  end if;

  -- Nunca crear cierres nuevos en la columna historica de registro.
  if not v_old_cerrado and v_new_registro = 'CERRADO' then
    raise exception using
      errcode = 'P0001',
      message = 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT';
  end if;

  -- Archivar es una segunda transicion: exige cierre previo ya confirmado.
  if v_new_registro = 'ARCHIVADO'
     and v_old_registro <> 'ARCHIVADO'
     and not v_old_cerrado then
    raise exception using
      errcode = 'P0001',
      message = 'COI_ARCHIVE_REQUIRES_CLOSED_ORDER';
  end if;

  -- Un cierre confirmado no puede reabrirse ni perder su unico marcador.
  if v_old_cerrado and not v_new_cerrado then
    raise exception using
      errcode = 'P0001',
      message = 'COI_CLOSURE_IMMUTABLE';
  end if;
  if v_old_estado_cerrado and not v_new_estado_cerrado then
    raise exception using
      errcode = 'P0001',
      message = 'COI_CLOSURE_IMMUTABLE';
  end if;

  -- El primer cierre valido se escribe completo en un unico UPDATE.
  if not v_old_cerrado and v_new_estado_cerrado then
    if new.fecha_cierre_operativo is null
       or nullif(btrim(coalesce(new.observacion_cierre, '')), '') is null then
      raise exception using
        errcode = 'P0001',
        message = 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists coi_ordenes_h10_audit_guard on public.coi_ordenes;
create trigger coi_ordenes_h10_audit_guard
before update of fecha_cierre_operativo, observacion_cierre on public.coi_ordenes
for each row execute function public.coi_guard_order_lifecycle_h10();

drop trigger if exists coi_ordenes_h10_state_guard on public.coi_ordenes;
create trigger coi_ordenes_h10_state_guard
before update of estado_coi, estado_registro on public.coi_ordenes
for each row execute function public.coi_guard_order_lifecycle_h10();

comment on function public.coi_guard_order_lifecycle_h10() is
  'H10: preserva atomicamente el primer cierre y exige cerrar antes de archivar.';

commit;
'''
mp = Path('supabase/migrations/202609070001_h10_order_lifecycle_guard.sql')
if mp.exists():
    raise SystemExit('la migracion H10 ya existe inesperadamente')
write(mp, migration)

# ---------------------------------------------------------------- Playwright fixture + nuevos casos
p = 'tests/h10_routing_cierre_archivo.spec.js'
t = read(p)
t = replace_one(
    t,
    '      Ahora son dos ejes separados, sin columnas nuevas ni migracion:',
    '      Ahora son dos ejes separados, sin columnas nuevas. H10 agrega una\n      migracion de hardening que protege las transiciones en PostgreSQL:',
    'cabecera spec migracion'
)

old_rpc = """        if (nombre === 'coi_actualizar_orden_integral') {
          if (c.fallaRpc) return { data: null, error: { code: '42501', message: 'permission denied fixture H10' } };
          const f = filas.find((x) => x.id === args.p_orden_id);
          if (!f) return { data: null, error: { message: 'la OC no existe' } };
          Object.assign(f, args.p_cambios || {});
          persistir();
          return { data: { orden: Object.assign({}, f) }, error: null };
        }"""
new_rpc = """        if (nombre === 'coi_actualizar_orden_integral') {
          if (c.fallaRpc) return { data: null, error: { code: '42501', message: 'permission denied fixture H10' } };
          const f = filas.find((x) => x.id === args.p_orden_id);
          if (!f) return { data: null, error: { message: 'la OC no existe' } };
          const cambios = args.p_cambios || {};
          const n = (v) => String(v ?? '').trim().toUpperCase();
          const estadoCerrado = (r) => ['CERRADA','CERRADO'].includes(n(r.estado_coi));
          const cerrado = (r) => estadoCerrado(r) || Boolean(r.fecha_cierre_operativo) || n(r.estado_registro) === 'CERRADO';
          const antes = Object.assign({}, f), despues = Object.assign({}, f, cambios);
          const oldClosed = cerrado(antes), newClosed = cerrado(despues);
          const has = (k) => Object.prototype.hasOwnProperty.call(cambios, k);

          if (n(despues.estado_registro) === 'ARCHIVADO' && n(antes.estado_registro) !== 'ARCHIVADO' && !oldClosed)
            return { data: null, error: { code: 'P0001', message: 'COI_ARCHIVE_REQUIRES_CLOSED_ORDER' } };
          if (oldClosed && has('estado_coi') && estadoCerrado(antes) && !estadoCerrado(despues))
            return { data: null, error: { code: 'P0001', message: 'COI_CLOSURE_IMMUTABLE' } };
          if (oldClosed && ((has('fecha_cierre_operativo')) || (has('observacion_cierre'))))
            return { data: null, error: { code: 'P0001', message: 'COI_CLOSURE_IMMUTABLE' } };
          if (oldClosed && !newClosed)
            return { data: null, error: { code: 'P0001', message: 'COI_CLOSURE_IMMUTABLE' } };
          if (!oldClosed && n(despues.estado_registro) === 'CERRADO')
            return { data: null, error: { code: 'P0001', message: 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT' } };
          if (!oldClosed && (estadoCerrado(despues) || has('fecha_cierre_operativo') || has('observacion_cierre'))) {
            if (!estadoCerrado(despues) || !despues.fecha_cierre_operativo || !String(despues.observacion_cierre || '').trim())
              return { data: null, error: { code: 'P0001', message: 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT' } };
          }
          Object.assign(f, cambios);
          persistir();
          return { data: { orden: Object.assign({}, f) }, error: null };
        }"""
t = replace_one(t, old_rpc, new_rpc, 'fixture lifecycle server guard')

append = r'''

// ============================================================ F · revisión final Codex del PR #64

test('H10-64 · P2 · #ficha-um sin identificador vuelve al inventario y no hereda una UM previa', async ({ page }) => {
  await prepararH10(page, { ums: [UM_UNA] });
  await abrir(page);
  await page.evaluate((id) => { location.hash = '#ficha-um/' + id; }, UM_UNA.codigo_um);
  await page.waitForFunction(() => (document.querySelector('.view.active') || {}).id === 'vistaFichaUM', null, { timeout: 12000 });

  await page.evaluate(() => { location.hash = '#ficha-um'; });
  await page.waitForTimeout(2200);
  const e = await page.evaluate(() => ({
    hash: location.hash,
    vista: (document.querySelector('.view.active') || {}).id || '',
    umActual: String(window.umActualId || '')
  }));
  expect(e.vista).toBe('vistaUnidadesMantenimiento');
  expect(e.hash).toBe('#um');
  expect(e.umActual).toBe('');
});

test('H10-65 · P1 · el servidor rechaza archivar una OC abierta aunque se saltee la UI', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => window.getSupabaseClient().rpc('coi_actualizar_orden_integral', {
    p_orden_id: id, p_cambios: { estado_registro: 'Archivado' }
  }), OC_ACTIVA.id);
  expect(r.error && r.error.message).toBe('COI_ARCHIVE_REQUIRES_CLOSED_ORDER');
  expect((await remoto(page, OC_ACTIVA.nro_oc)).estado_registro).toBe('Activo');
});

test('H10-66 · P1 · la auditoría del primer cierre no puede sobrescribirse por el RPC genérico', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => window.getSupabaseClient().rpc('coi_actualizar_orden_integral', {
    p_orden_id: id, p_cambios: { observacion_cierre: 'Intento de pisado' }
  }), OC_CERRADA.id);
  expect(r.error && r.error.message).toBe('COI_CLOSURE_IMMUTABLE');
  const f = await page.evaluate((n) => window.__H10__.fila(n), OC_CERRADA.nro_oc);
  expect(f.observacion_cierre).toBe('Cierre previo');
  expect(f.fecha_cierre_operativo).toBe('2026-08-25');
});

test('H10-67 · P1 · no se puede crear un cierre incompleto desde estado_coi', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => window.getSupabaseClient().rpc('coi_actualizar_orden_integral', {
    p_orden_id: id, p_cambios: { estado_coi: 'Cerrada' }
  }), OC_ACTIVA.id);
  expect(r.error && r.error.message).toBe('COI_CLOSE_REQUIRES_ATOMIC_AUDIT');
  expect((await remoto(page, OC_ACTIVA.nro_oc)).estado_coi).toBe('En ejecución');
});

test('H10-68 · P1 · dos cierres competidores conservan los datos del primero', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => {
    const c = window.getSupabaseClient();
    const primero = await c.rpc('coi_actualizar_orden_integral', { p_orden_id: id, p_cambios: {
      estado_coi: 'Cerrada', fecha_cierre_operativo: '2026-09-07', observacion_cierre: 'Primer cierre'
    }});
    const segundo = await c.rpc('coi_actualizar_orden_integral', { p_orden_id: id, p_cambios: {
      estado_coi: 'Cerrada', fecha_cierre_operativo: '2026-09-07', observacion_cierre: 'Segundo cierre'
    }});
    return { primero, segundo, fila: window.__H10__.fila('4530000001') };
  }, OC_ACTIVA.id);
  expect(r.primero.error).toBeNull();
  expect(r.segundo.error && r.segundo.error.message).toBe('COI_CLOSURE_IMMUTABLE');
  expect(r.fila.observacion_cierre).toBe('Primer cierre');
});

test('H10-69 · P1 · el editor genérico no renderiza archivo ni campos de auditoría de cierre', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ACTIVA.nro_oc);
  await page.evaluate((n) => window.abrirEdicionFichaOC(n), OC_ACTIVA.nro_oc);
  await page.waitForFunction(() => {
    const m = document.getElementById('coiEditOCModalV60');
    return Boolean(m && !m.hidden);
  }, null, { timeout: 12000 });
  for (const campo of ['estado_registro','fecha_cierre_operativo','observacion_cierre']) {
    await expect(page.locator(`[data-coi-edit-field="${campo}"]`)).toHaveCount(0);
  }
});
'''
if 'H10-64 · P2 · #ficha-um sin identificador' in t:
    raise SystemExit('los tests H10-64+ ya estaban presentes')
t = t.rstrip() + append + '\n'
write(p, t)

# ---------------------------------------------------------------- static H10 checks
p = 'tests/check_h10_routing_cierre_archivo.js'
s = read(p)
s = replace_one(
    s,
    "    7) H10 no crea migraciones: los tres campos del cierre y estado_registro\n       ya existen y ya estan permitidos por coi_actualizar_orden_integral.",
    "    7) H10 no crea columnas ni tablas. La revisión final agrega un guard\n       PostgreSQL de ciclo de vida para atomicidad e inmutabilidad del cierre.",
    'descripcion static migration'
)
s = replace_one(
    s,
    "// ============ 7) sin migraciones\nconst migraciones = fs.readdirSync('supabase/migrations').filter((f) => /h10/i.test(f));\ncheck(migraciones.length === 0, `H10 no crea migraciones (encontradas: ${migraciones.join(', ')})`);",
    "// ============ 7) hardening PostgreSQL, sin tablas ni columnas nuevas\nconst migraciones = fs.readdirSync('supabase/migrations').filter((f) => /h10/i.test(f));\ncheck(migraciones.length === 1 && migraciones[0] === '202609070001_h10_order_lifecycle_guard.sql',\n  `H10 requiere exactamente su migracion de guard (encontradas: ${migraciones.join(', ')})`);\nconst h10Sql = fs.readFileSync('supabase/migrations/202609070001_h10_order_lifecycle_guard.sql', 'utf8');\ncheck(/before update of fecha_cierre_operativo, observacion_cierre/i.test(h10Sql),\n  'la auditoria de cierre tiene un guard BEFORE UPDATE');\ncheck(/before update of estado_coi, estado_registro/i.test(h10Sql),\n  'estado operativo y archivo tienen un guard BEFORE UPDATE');\ncheck(h10Sql.indexOf('COI_CLOSURE_IMMUTABLE') >= 0 && h10Sql.indexOf('COI_ARCHIVE_REQUIRES_CLOSED_ORDER') >= 0,\n  'PostgreSQL protege primer cierre y cierre-antes-de-archivo');\ncheck(!/create\\s+table|alter\\s+table[^;]*add\\s+column/i.test(h10Sql),\n  'H10 no agrega tablas ni columnas');",
    'static section 7'
)

# Inserta controles nuevos antes de los logs finales.
marker = "console.log('H10: cierre operativo, archivo de registro y navegación por URL.');"
extra = r'''// ============ 10) revisión final Codex — invariantes de ciclo de vida
check(cierreCodigo.indexOf('leerCierreRemoto') < 0,
  'el cierre no puede hacer SELECT previo + UPDATE: la atomicidad vive en la transaccion PostgreSQL');
check(cierreCodigo.indexOf('COI_CLOSURE_IMMUTABLE') >= 0,
  'el frontend reconoce el conflicto atomico y refresca el primer cierre');
check(html.indexOf("const EDITOR_BLOCKED=new Set(['estado_registro','fecha_cierre_operativo','observacion_cierre'])") >= 0,
  'el editor separa campos de transicion de la allowlist del repositorio');
check(/for\(const name of EDITOR_FIELDS\)/.test(html),
  'saveEditor solo recorre campos realmente editables');
check(!/\['Gestión COI',\[[^\]]*'estado_registro'/.test(html),
  'estado_registro no puede editarse desde Gestion COI');
check(html.indexOf("['Cierre',['fecha_cierre_operativo','observacion_cierre']]") < 0,
  'fecha y observacion de cierre no se renderizan como inputs genericos');
check(/function validarLifecycleEditor\(current,baseline\)/.test(html),
  'el editor bloquea entrar/salir de Cerrada por el formulario generico');
check(/if \(!id\) \{[\s\S]{0,220}?vistaUnidadesMantenimiento[\s\S]{0,120}?aplicarTabUM\('inventario'\)/.test(routerCodigo),
  '#ficha-um sin id vuelve al inventario');

'''
if marker not in s:
    raise SystemExit('no se encontro marker de logs static')
s = s.replace(marker, extra + marker, 1)
s = s.replace("console.log('  Migraciones  : H10 no crea ninguna');",
              "console.log('  Migraciones  : 1 guard H10; sin tablas ni columnas nuevas');")
write(p, s)

# ---------------------------------------------------------------- docs, solo afirmaciones H10 que quedaron obsoletas
for path in ['docs/agent/03_SUPABASE_DATA_MODEL.md','docs/agent/04_FUNCTIONAL_RULES.md','docs/agent/14_TECHNICAL_DECISIONS.md']:
    d = read(path)
    d = d.replace('sin columnas nuevas y sin migración', 'sin columnas nuevas; la revisión final agrega un guard PostgreSQL H10')
    d = d.replace('Sin migraciones.', 'Sin tablas ni columnas nuevas; H10 agrega una migración de hardening del ciclo de vida.')
    d = d.replace('H10 no crea ninguna migración', 'H10 crea una migración de hardening sin tablas ni columnas nuevas')
    write(path, d)

print('H10 final patch aplicado correctamente')
