from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)


index = Path('index.html')
html = index.read_text(encoding='utf-8')

old_global = """  window.archivarOC = guardarArchivado(window.archivarOC, 'window.archivarOC');

  // El export de H09 se envuelve en su propia propiedad, no en una copia: si
"""
new_global = """  function guardarDesarchivado(fn, contexto) {
    if (typeof fn !== 'function' || fn.__coiH10ExactRestore) return fn;
    const envuelto = function (referencia) {
      const ref = referencia || referenciaFicha() || '';
      const itemExacto = itemDe(ref);
      if (!itemExacto) {
        avisar('No se pudo identificar una OC exacta para restaurar. Revise el número o vuelva a sincronizar.', 'error');
        return Promise.resolve(false);
      }
      return fn.call(this, ref);
    };
    envuelto.__coiH10ExactRestore = true;
    envuelto.__coiH10ExactRestoreBase = fn;
    envuelto.__coiH10ExactRestoreCtx = contexto;
    return envuelto;
  }

  function protegerDesarchivoGlobal() {
    if (typeof window.desarchivarOC === 'function' && !window.desarchivarOC.__coiH10ExactRestore) {
      window.desarchivarOC = guardarDesarchivado(window.desarchivarOC, 'window.desarchivarOC');
    }
    if (typeof window.restaurarOC === 'function' && !window.restaurarOC.__coiH10ExactRestore) {
      window.restaurarOC = guardarDesarchivado(window.restaurarOC, 'window.restaurarOC');
    }
  }

  window.archivarOC = guardarArchivado(window.archivarOC, 'window.archivarOC');
  protegerDesarchivoGlobal();

  // El export de H09 se envuelve en su propia propiedad, no en una copia: si
"""
html = replace_once(html, old_global, new_global, 'global desarchive guard')

old_export = """  function protegerExportH09() {
    const api = window.COI_ARCHIVO_OC_H09;
    if (!api || typeof api.archivar !== 'function' || api.archivar.__coiH10Guard) return;
    api.archivar = guardarArchivado(api.archivar, 'COI_ARCHIVO_OC_H09.archivar');
  }
"""
new_export = """  function protegerExportH09() {
    const api = window.COI_ARCHIVO_OC_H09;
    if (!api) return;
    if (typeof api.archivar === 'function' && !api.archivar.__coiH10Guard) {
      api.archivar = guardarArchivado(api.archivar, 'COI_ARCHIVO_OC_H09.archivar');
    }
    if (typeof api.desarchivar === 'function' && !api.desarchivar.__coiH10ExactRestore) {
      api.desarchivar = guardarDesarchivado(api.desarchivar, 'COI_ARCHIVO_OC_H09.desarchivar');
    }
    if (typeof api.restaurar === 'function' && !api.restaurar.__coiH10ExactRestore) {
      api.restaurar = guardarDesarchivado(api.restaurar, 'COI_ARCHIVO_OC_H09.restaurar');
    }
  }
"""
html = replace_once(html, old_export, new_export, 'H09 export desarchive guard')

old_timer = """  [0, 450, 1600, 3100, 6100].forEach((ms) => setTimeout(() => {
    try { protegerExportH09(); } catch (e) {}
  }, ms));
"""
new_timer = """  [0, 450, 1600, 3100, 6100].forEach((ms) => setTimeout(() => {
    try { protegerExportH09(); protegerDesarchivoGlobal(); } catch (e) {}
  }, ms));
"""
html = replace_once(html, old_timer, new_timer, 'H09 reinstall guards')
index.write_text(html, encoding='utf-8')

spec = Path('tests/h10_routing_cierre_archivo.spec.js')
s = spec.read_text(encoding='utf-8').rstrip() + "\n\n"
s += r"""test('H10-88 · P1 · desarchivar global exige identidad exacta antes de mutar', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  const parcial = OC_ARCHIVADA.nro_oc.slice(-6);
  const resultado = await page.evaluate(async (ref) => window.desarchivarOC(ref), parcial);
  expect(resultado).toBe(false);
  expect((await remoto(page, OC_ARCHIVADA.nro_oc)).estado_registro).toBe('Archivado');
  expect((await cambiosRPC(page)).length).toBe(0);
});

test('H10-89 · P1 · export H09 desarchivar exige identidad exacta antes de mutar', async ({ page }) => {
  await prepararH10(page);
  await abrir(page);
  await page.waitForFunction(() => Boolean(window.COI_ARCHIVO_OC_H09 && typeof window.COI_ARCHIVO_OC_H09.desarchivar === 'function'));
  const parcial = OC_ARCHIVADA.nro_oc.slice(-6);
  const resultado = await page.evaluate(async (ref) => window.COI_ARCHIVO_OC_H09.desarchivar(ref), parcial);
  expect(resultado).toBe(false);
  expect((await remoto(page, OC_ARCHIVADA.nro_oc)).estado_registro).toBe('Archivado');
  expect((await cambiosRPC(page)).length).toBe(0);
});
"""
spec.write_text(s, encoding='utf-8')

static = Path('tests/check_h10_routing_cierre_archivo.js')
t = static.read_text(encoding='utf-8').rstrip() + "\n\n"
t += r"""check(cierreCodigo.indexOf('function guardarDesarchivado(fn, contexto)') >= 0,
  'desarchivar debe exigir identidad exacta antes de mutar');
check(cierreCodigo.indexOf("api.desarchivar = guardarDesarchivado(api.desarchivar, 'COI_ARCHIVO_OC_H09.desarchivar')") >= 0,
  'el export H09 desarchivar debe usar el mismo guard de identidad exacta');
console.log('H10 desarchive exact-identity final guard: OK');
"""
static.write_text(t, encoding='utf-8')

print('H10 PR64 desarchive exact-identity patch applied.')
