from pathlib import Path

index = Path('index.html')
text = index.read_text(encoding='utf-8')

old_init = """    vaciarOrdenesEnMemoria();
    fallbackLocalStorageSiFallaSupabase('Inicializando Supabase como fuente principal.');
    initSupabase();"""
new_init = """    vaciarOrdenesEnMemoria();
    // H10 final review: arrancar no es fallar. Mientras initSupabase() todavía
    // no confirmó ni rechazó una lectura remota, el catálogo permanece pendiente.
    // Solo los caminos de error reales llaman a degradarSinAutoridadLocal().
    ordenesLecturaEstado = 'pendiente';
    initSupabase();"""
if text.count(old_init) != 1:
    raise SystemExit(f'init snippet expected once, found {text.count(old_init)}')
text = text.replace(old_init, new_init, 1)

old_buttons = "const BOTONES_CERRAR = ['btnCerrarOCFicha', 'btnCerrarOCFichaTop', 'btnCerrarOC'];"
new_buttons = "const BOTONES_CERRAR = ['btnCerrarOCFicha', 'btnCerrarOCFichaTop', 'btnCerrarOC', 'execBtnClose'];"
if text.count(old_buttons) != 1:
    raise SystemExit(f'close button snippet expected once, found {text.count(old_buttons)}')
text = text.replace(old_buttons, new_buttons, 1)
index.write_text(text, encoding='utf-8')

test_file = Path('tests/check_h10_routing_cierre_archivo.js')
checks = test_file.read_text(encoding='utf-8')
marker = "console.log('H10 final review guards: OK');"
if checks.count(marker) != 1:
    raise SystemExit(f'test marker expected once, found {checks.count(marker)}')
extra = """
// ============ 11) review final pre-merge PR #64
const bootstrapInicio = html.slice(
  html.indexOf('function bootstrapSupabasePrincipal()'),
  html.indexOf('window.initSupabase = initSupabase;'));
check(bootstrapInicio.length > 0,
  'se debe poder inspeccionar el bootstrap principal de Supabase');
check(bootstrapInicio.indexOf(\"fallbackLocalStorageSiFallaSupabase('Inicializando Supabase como fuente principal.')\") < 0,
  'inicializar Supabase no puede marcar el catálogo como error antes del primer intento remoto');
check(/vaciarOrdenesEnMemoria\\(\\);[\\s\\S]{0,420}ordenesLecturaEstado = 'pendiente';[\\s\\S]{0,120}initSupabase\\(\\);/.test(bootstrapInicio),
  'el catálogo debe permanecer pendiente hasta que initSupabase resuelva éxito o error real');
check(cierreCodigo.indexOf(\"const BOTONES_CERRAR = ['btnCerrarOCFicha', 'btnCerrarOCFichaTop', 'btnCerrarOC', 'execBtnClose'];\") >= 0,
  'el botón ejecutivo de cierre debe sincronizar texto, disabled y estado con los demás botones H10');

"""
checks = checks.replace(marker, extra + marker, 1)
test_file.write_text(checks, encoding='utf-8')
