from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor missing: {label}')
    return text.replace(old, new, 1)


def replace_all_exact(text, old, new, expected, label):
    found = text.count(old)
    if found != expected:
        raise SystemExit(f'{label}: expected {expected} anchors, found {found}')
    return text.replace(old, new)


# ------------------------------------------------------------ SQL guard
sqlp = Path('supabase/migrations/202609070001_h10_order_lifecycle_guard.sql')
sql = sqlp.read_text(encoding='utf-8')
sql = replace_once(
    sql,
    "    if v_new_registro = 'ARCHIVADO' then\n",
    "    if v_new_registro in ('ARCHIVADO', 'ARCHIVADA') then\n",
    'INSERT archive spellings',
)
sql = replace_once(
    sql,
    "     and v_new_registro = 'ARCHIVADO'\n",
    "     and v_new_registro in ('ARCHIVADO', 'ARCHIVADA')\n",
    'legacy-only archive spellings',
)
anchor = "  -- Nunca crear cierres nuevos en la columna historica de registro.\n"
canonical = """  -- `Archivado` es el unico valor canonico que H10 escribe. Filas historicas
  -- con `Archivada` siguen reconociendose como ya archivadas para poder
  -- restaurarlas/normalizarlas, pero una escritura NUEVA con esa variante se
  -- rechaza: de otro modo Supabase puede guardar un estado que algunos filtros
  -- leen como activo y otros como archivado.
  if v_new_registro = 'ARCHIVADA'
     and v_old_registro is distinct from 'ARCHIVADA' then
    raise exception using
      errcode = 'P0001',
      message = 'COI_ARCHIVE_STATE_CANONICAL_REQUIRED',
      detail = 'use estado_registro=Archivado para archivar una OC';
  end if;

"""
sql = replace_once(sql, anchor, canonical + anchor, 'canonical archive spelling guard')
sql = replace_once(
    sql,
    "  if v_new_registro = 'ARCHIVADO'\n     and v_old_registro <> 'ARCHIVADO'\n     and not v_old_cerrado then\n",
    "  if v_new_registro in ('ARCHIVADO', 'ARCHIVADA')\n     and v_old_registro not in ('ARCHIVADO', 'ARCHIVADA')\n     and not v_old_cerrado then\n",
    'UPDATE archive lifecycle spellings',
)
sqlp.write_text(sql, encoding='utf-8')


# ------------------------------------------------------------ index.html
hp = Path('index.html')
html = hp.read_text(encoding='utf-8')
html = replace_all_exact(
    html,
    "function estaArchivada(item) { return norm(estadoRegistro(item)) === norm(ARCHIVADO); }",
    "function estaArchivada(item) { return ['ARCHIVADO','ARCHIVADA'].includes(norm(estadoRegistro(item))); }",
    1,
    'H09 estaArchivada',
)
html = replace_all_exact(
    html,
    "function estaArchivada(item) { return norm(estadoRegistroDe(item)) === norm(ARCHIVADO); }",
    "function estaArchivada(item) { return ['ARCHIVADO','ARCHIVADA'].includes(norm(estadoRegistroDe(item))); }",
    1,
    'H10 estaArchivada',
)
html = replace_once(
    html,
    "  if(modo==='archivadas')return rows.filter(r=>coiEstadoRegistroDeFila(r)==='ARCHIVADO');\n  return rows.filter(r=>coiEstadoRegistroDeFila(r)!=='ARCHIVADO');",
    "  const archivada=(r)=>['ARCHIVADO','ARCHIVADA'].includes(coiEstadoRegistroDeFila(r));\n  if(modo==='archivadas')return rows.filter(archivada);\n  return rows.filter(r=>!archivada(r));",
    'registration filter archive spellings',
)

# Post-commit warning in the H09 executor.
execute_start = html.find('async function ejecutar(')
if execute_start < 0:
    raise SystemExit('archive ejecutar() not found')
persist_at = html.find('const salida = await persistir(item, destino);', execute_start)
if persist_at < 0:
    raise SystemExit('archive persistir result not found')
sync_at = html.find('sincronizarBotones();', persist_at)
if sync_at < 0 or sync_at - persist_at > 1800:
    raise SystemExit('archive success synchronization anchor not found')
warning_block = """const advertencias = Array.from(new Set([].concat(
        Array.isArray(salida && salida.warnings) ? salida.warnings : [],
        Array.isArray(salida && salida.resultado && salida.resultado.warnings) ? salida.resultado.warnings : []
      ).filter(Boolean)));
      if (advertencias.length) {
        avisar((destino === ARCHIVADO ? 'OC archivada correctamente. ' : 'OC restaurada al registro activo. ') +
          advertencias.join(' '), 'warning');
        return true;
      }
      """
html = html[:sync_at] + warning_block + html[sync_at:]

# Retry becomes a navigation phase that can be superseded by the operator.
html = replace_once(
    html,
    "  let navegacionUsuario = 0;  // version independiente: una accion real del operador gana al startup\n  let silencio = 0;",
    "  let navegacionUsuario = 0;  // version independiente: una accion real del operador gana al startup\n  let reintentando = false;   // una relectura no puede reabrir una ruta que el operador abandono\n  let silencio = 0;",
    'retry navigation state',
)
html = replace_once(
    html,
    "    if (aplicando || restaurando) return false;",
    "    if (aplicando || restaurando || reintentando) return false;",
    'mute automatic retry repaints',
)
html = replace_once(
    html,
    "    if (!restaurando && !aplicando && !tecladoConIntencion) return;",
    "    if (!restaurando && !aplicando && !reintentando && !tecladoConIntencion) return;",
    'observe user navigation during retry',
)
html = replace_once(
    html,
    "      if (resuelta || (!restaurando && !aplicando)) return;",
    "      if (resuelta || (!restaurando && !aplicando && !reintentando)) return;",
    'observe legacy navigation during retry',
)
old_retry = """        const ruta = rutaError || hashActual();
        const esUM = Boolean(t.closest('#h10ReintentarUM'));
        limpiarRutaError();
        (async () => {
          try {
            if (esUM) {
              if (typeof window.recargarUnidadesMantenimiento === 'function') {
                await window.recargarUnidadesMantenimiento();
              }
            } else if (typeof window.recargarDatosDesdeSupabase === 'function') {
              await window.recargarDatosDesdeSupabase({ silencioso: true });
            }
          } catch (e) {
            // Si la relectura vuelve a fallar, aplicar() reevalua el estado y
            // vuelve al error que corresponda. Nunca se afirma que la entidad
            // no existe.
          }
          await aplicar(ruta);
        })().catch(() => {});
"""
new_retry = """        const ruta = rutaError || hashActual();
        const esUM = Boolean(t.closest('#h10ReintentarUM'));
        const versionUsuarioReintento = navegacionUsuario;
        const hashReintento = hashActual();
        reintentando = true;
        limpiarRutaError();
        (async () => {
          try {
            if (esUM) {
              if (typeof window.recargarUnidadesMantenimiento === 'function') {
                await window.recargarUnidadesMantenimiento();
              }
            } else if (typeof window.recargarDatosDesdeSupabase === 'function') {
              await window.recargarDatosDesdeSupabase({ silencioso: true });
            }
          } catch (e) {
            // Si la relectura vuelve a fallar, aplicar() reevalua el estado y
            // vuelve al error que corresponda. Nunca se afirma que la entidad
            // no existe.
          }
          // La lectura puede tardar. Si entretanto el operador eligio otro
          // modulo, ese destino es mas nuevo que la ruta de error capturada y
          // el retry queda obsoleto: no puede reabrirla al finalizar.
          if (navegacionUsuario !== versionUsuarioReintento || hashActual() !== hashReintento) return;
          await aplicar(ruta);
        })().catch(() => {}).finally(() => { reintentando = false; });
"""
html = replace_once(html, old_retry, new_retry, 'retry stale-route guard')
hp.write_text(html, encoding='utf-8')


# ------------------------------------------------------------ static guards
sp = Path('tests/check_h10_routing_cierre_archivo.js')
static = sp.read_text(encoding='utf-8')
static = replace_once(
    static,
    "check(/if\\(modo==='archivadas'\\)return rows\\.filter\\(r=>coiEstadoRegistroDeFila\\(r\\)==='ARCHIVADO'\\);/.test(htmlSinComentarios),\n  'archivadas incluye exclusivamente las archivadas');\ncheck(/return rows\\.filter\\(r=>coiEstadoRegistroDeFila\\(r\\)!=='ARCHIVADO'\\);/.test(htmlSinComentarios),\n  'activas excluye las archivadas');",
    "check(/const archivada=\\(r\\)=>\\['ARCHIVADO','ARCHIVADA'\\]\\.includes\\(coiEstadoRegistroDeFila\\(r\\)\\);/.test(htmlSinComentarios),\n  'el filtro de registro reconoce Archivado y la variante histórica Archivada');\ncheck(/if\\(modo==='archivadas'\\)return rows\\.filter\\(archivada\\);/.test(htmlSinComentarios),\n  'archivadas incluye exclusivamente ambos marcadores archivados');\ncheck(/return rows\\.filter\\(r=>!archivada\\(r\\)\\);/.test(htmlSinComentarios),\n  'activas excluye ambos marcadores archivados');",
    'static registration filter checks',
)
marker = "console.log('H10 final review guards: OK');"
extra_static = r'''
// ============ 12) cierre de los tres P2 posteriores al Quality Gate verde
check(h10Sql.indexOf("v_new_registro in ('ARCHIVADO', 'ARCHIVADA')") >= 0,
  'PostgreSQL debe reconocer ambas grafías archivadas al aplicar el lifecycle guard');
check(h10Sql.indexOf("v_new_registro = 'ARCHIVADA'") >= 0 &&
      h10Sql.indexOf('COI_ARCHIVE_STATE_CANONICAL_REQUIRED') >= 0,
  'una escritura nueva con Archivada debe rechazarse y exigir Archivado canónico');
check(cierreCodigo.indexOf("['ARCHIVADO','ARCHIVADA'].includes(norm(estadoRegistroDe(item)))") >= 0,
  'H10 debe leer Archivada histórica como archivada, no como activa');
check(archivoCodigo.indexOf("['ARCHIVADO','ARCHIVADA'].includes(norm(estadoRegistro(item)))") >= 0,
  'H09 debe leer Archivada histórica como archivada, no como activa');
check(archivoCodigo.indexOf('salida.resultado && salida.resultado.warnings') >= 0 &&
      archivoCodigo.indexOf("advertencias.join(' '), 'warning'") >= 0,
  'archivar/desarchivar debe propagar warnings de resincronización post-commit');
check(routerCodigo.indexOf('let reintentando = false;') >= 0,
  'el router debe modelar explícitamente una relectura de retry en vuelo');
check(routerCodigo.indexOf('navegacionUsuario !== versionUsuarioReintento || hashActual() !== hashReintento') >= 0,
  'un retry debe descartarse si el operador navegó durante la relectura');
check(routerCodigo.indexOf('aplicando || restaurando || reintentando') >= 0,
  'los repintados automáticos no pueden publicar una ruta transitoria durante retry');

'''
static = replace_once(static, marker, extra_static + marker, 'append final P2 static guards')
sp.write_text(static, encoding='utf-8')


# ------------------------------------------------------------ browser fixture + regressions
tp = Path('tests/h10_routing_cierre_archivo.spec.js')
test = tp.read_text(encoding='utf-8')
test = replace_once(
    test,
    "          const estadoArchivadoCoi = (r) => ['ARCHIVADA','ARCHIVADO'].includes(n(r.estado_coi));\n          const legacyOnly = n(antes.estado_registro) === 'CERRADO' && !estadoCerrado(antes) && !antes.fecha_cierre_operativo;",
    "          const estadoArchivadoCoi = (r) => ['ARCHIVADA','ARCHIVADO'].includes(n(r.estado_coi));\n          const registroArchivado = (v) => ['ARCHIVADO','ARCHIVADA'].includes(n(v));\n          const legacyOnly = n(antes.estado_registro) === 'CERRADO' && !estadoCerrado(antes) && !antes.fecha_cierre_operativo;",
    'fixture archive spelling helper',
)
test = replace_once(
    test,
    "          if (legacyOnly && n(despues.estado_registro) === 'ARCHIVADO' && !estadoCerrado(despues))\n            return { data: null, error: { code: 'P0001', message: 'COI_LEGACY_CLOSE_REQUIRES_CANONICALIZATION' } };\n          if (n(despues.estado_registro) === 'ARCHIVADO' && n(antes.estado_registro) !== 'ARCHIVADO' && !oldClosed)\n            return { data: null, error: { code: 'P0001', message: 'COI_ARCHIVE_REQUIRES_CLOSED_ORDER' } };",
    "          if (has('estado_registro') && n(despues.estado_registro) === 'ARCHIVADA' && n(antes.estado_registro) !== 'ARCHIVADA')\n            return { data: null, error: { code: 'P0001', message: 'COI_ARCHIVE_STATE_CANONICAL_REQUIRED' } };\n          if (legacyOnly && registroArchivado(despues.estado_registro) && !estadoCerrado(despues))\n            return { data: null, error: { code: 'P0001', message: 'COI_LEGACY_CLOSE_REQUIRES_CANONICALIZATION' } };\n          if (registroArchivado(despues.estado_registro) && !registroArchivado(antes.estado_registro) && !oldClosed)\n            return { data: null, error: { code: 'P0001', message: 'COI_ARCHIVE_REQUIRES_CLOSED_ORDER' } };",
    'fixture archive lifecycle spellings',
)
regressions = r'''

test('H10-84 · P2 · estado_registro Archivada no puede escribirse como variante nueva', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const r = await page.evaluate(async (id) => window.getSupabaseClient().rpc('coi_actualizar_orden_integral', {
    p_orden_id: id, p_cambios: { estado_registro: 'Archivada' }
  }), OC_ACTIVA.id);
  expect(r.error && r.error.message).toBe('COI_ARCHIVE_STATE_CANONICAL_REQUIRED');
  expect((await remoto(page, OC_ACTIVA.nro_oc)).estado_registro).toBe('Activo');
});

test('H10-85 · P2 · archivado confirmado con refresh fallido informa warning de sincronización', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_CERRADA.nro_oc);
  const resultado = await page.evaluate(async (n) => {
    window.recargarDatosDesdeSupabase = async () => { throw new Error('fixture H10: refresh archivo post-commit falló'); };
    return await window.archivarOC(n);
  }, OC_CERRADA.nro_oc);
  expect(resultado).toBe(true);
  expect((await remoto(page, OC_CERRADA.nro_oc)).estado_registro).toBe('Archivado');
  expect(await page.evaluate(() => window.__H10__.toasts.some((t) =>
    t.t === 'warning' && /confirmada en el servidor|resincronizar|actualizar/i.test(t.m)))).toBe(true);
});

test('H10-86 · P2 · restauración confirmada con refresh fallido informa warning de sincronización', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await abrirFicha(page, OC_ARCHIVADA.nro_oc);
  const resultado = await page.evaluate(async (n) => {
    window.recargarDatosDesdeSupabase = async () => { throw new Error('fixture H10: refresh restore post-commit falló'); };
    return await window.desarchivarOC(n);
  }, OC_ARCHIVADA.nro_oc);
  expect(resultado).toBe(true);
  expect((await remoto(page, OC_ARCHIVADA.nro_oc)).estado_registro).toBe('Activo');
  expect(await page.evaluate(() => window.__H10__.toasts.some((t) =>
    t.t === 'warning' && /confirmada en el servidor|resincronizar|actualizar/i.test(t.m)))).toBe(true);
});

test('H10-87 · P2 · un retry lento no reabre la ruta de error si el operador navega a Red', async ({ page }) => {
  await prepararH10(page, { fallaOrdenes: true });
  await abrirCrudo(page, '#ficha-oc/' + OC_ACTIVA.nro_oc);
  await page.waitForFunction(() => Boolean(document.getElementById('h10CatalogoNoDisponible')),
    null, { timeout: 12000 });
  await page.evaluate(() => {
    window.recargarDatosDesdeSupabase = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      throw new Error('fixture H10: retry sigue sin remoto');
    };
  });
  await page.click('#h10ReintentarCatalogo');
  await page.waitForTimeout(180);
  await navegarV2(page, 'btnRed');
  await page.waitForTimeout(2600);
  const e = await estadoRuta(page);
  expect(e.vista).toBe('vistaRed');
  expect(e.hash).toBe('#red');
  expect(e.errorCatalogo).toBe(false);
});
'''
if 'H10-84 · P2' in test:
    raise SystemExit('runtime regressions already present unexpectedly')
test = test.rstrip() + regressions + '\n'
tp.write_text(test, encoding='utf-8')

print('H10 PR64 final P2 patch applied.')
