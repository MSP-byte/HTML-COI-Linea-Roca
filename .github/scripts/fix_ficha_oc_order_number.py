from pathlib import Path

index = Path('index.html')
test = Path('tests/ficha_oc_supabase_hydration.spec.js')
workflow = Path('.github/workflows/ficha-oc-order-number-once.yml')
self_path = Path('.github/scripts/fix_ficha_oc_order_number.py')

html = index.read_text(encoding='utf-8')
old = """    const candidates=[item?._supabaseRaw?.nro_oc,item?.numeroOC,item?.oc,item?.ocNro,id];\n    for(const value of candidates){\n      const normalized=String(value??'').trim().replace(/\\s+/g,'');\n      if(normalized)return normalized;\n    }\n"""
new = """    const candidates=[item?._supabaseRaw?.nro_oc,item?.numeroOC,item?.oc,item?.ocNro,item?.idObra,item?.idOC,id];\n    for(const value of candidates){\n      const normalized=String(value??'').trim().replace(/\\s+/g,'');\n      if(!normalized)continue;\n      const prefixed=normalized.match(/^OC[-_ ]*(\\d{6,})$/i);\n      if(prefixed)return prefixed[1];\n      if(/^\\d{6,}$/.test(normalized))return normalized;\n    }\n"""
if old not in html:
    raise SystemExit('No se encontro el bloque orderNumber esperado')
html = html.replace(old, new, 1)
index.write_text(html, encoding='utf-8')

spec = test.read_text(encoding='utf-8')
needle = """  test('no borra un dato derivado existente cuando Supabase no trae valor util', async ({ page }) => {\n"""
extra = r'''  test('normaliza ID obra prefijado al nro_oc contractual', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.COI_EXPEDIENTE_HYDRATION?.orderNumber === 'function');
    const nro = await page.evaluate(() => window.COI_EXPEDIENTE_HYDRATION.orderNumber({ idObra: 'OC-4530008964' }, 'OC-4530008964'));
    expect(nro).toBe('4530008964');
  });

'''
if "normaliza ID obra prefijado" not in spec:
    if needle not in spec:
        raise SystemExit('No se encontro punto de insercion del test')
    spec = spec.replace(needle, extra + needle, 1)
    test.write_text(spec, encoding='utf-8')

for helper in (workflow, self_path):
    if helper.exists():
        helper.unlink()
