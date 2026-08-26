from pathlib import Path
import re

path = Path('index.html')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    text = text.replace(old, new, 1)


def inject_function_guard(name, guard, label):
    global text
    pattern = rf'(function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{)'
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise SystemExit(f'{label}: expected exactly 1 function, got {len(matches)}')
    m = matches[0]
    text = text[:m.end()] + guard + text[m.end():]

replace_once(
    '  let timelineMutationsInFlight=0;\n  let timelineReconcileTimer=null;',
    '  let timelineMutationsInFlight=0;\n  let timelineReconcileTimer=null;\n  let timelineAuthoritativeReady=false;',
    'authoritative state'
)

replace_once(
    "    const currentLoad=(async()=>{\n      setTimelinePersistence('loading','Cargando Timeline desde Supabase\\u2026');",
    "    const currentLoad=(async()=>{\n      timelineAuthoritativeReady=false;\n      setTimelinePersistence('loading','Cargando Timeline desde Supabase\\u2026');",
    'load start'
)

replace_once(
    "            applyTimelineEvents(remote,'Timeline cargado desde Supabase');\n            setTimelinePersistence('warning',",
    "            applyTimelineEvents(remote,'Timeline cargado desde Supabase');\n            timelineAuthoritativeReady=true;\n            setTimelinePersistence('warning',",
    'migration warning authoritative load'
)

replace_once(
    "        applyTimelineEvents(remote,'Timeline cargado desde Supabase');\n        setTimelinePersistence('online',",
    "        applyTimelineEvents(remote,'Timeline cargado desde Supabase');\n        timelineAuthoritativeReady=true;\n        setTimelinePersistence('online',",
    'normal authoritative load'
)

replace_once(
    "        console.warn('Timeline COI: no se pudo cargar Supabase.',error);\n        setTimelinePermissions('');",
    "        console.warn('Timeline COI: no se pudo cargar Supabase.',error);\n        timelineAuthoritativeReady=false;\n        setTimelinePermissions('');",
    'load failure'
)

replace_once(
    "          applyTimelineEvents(remote,reason||'Timeline reconciliado desde Supabase');\n          setTimelinePersistence('online',",
    "          applyTimelineEvents(remote,reason||'Timeline reconciliado desde Supabase');\n          timelineAuthoritativeReady=true;\n          setTimelinePersistence('online',",
    'reconcile authoritative load'
)

replace_once(
    "        timelineAuthGeneration+=1;\n        setTimelinePermissions('');",
    "        timelineAuthGeneration+=1;\n        timelineAuthoritativeReady=false;\n        setTimelinePermissions('');",
    'auth reset'
)

marker = '  function downloadJSON(){'
assert_fn = """  function assertAuthoritativeTimelineBackup(){
    if(!timelineAuthoritativeReady){
      throw new Error('El Timeline todavía no terminó una carga autoritativa desde Supabase. Esperá la sincronización y volvé a intentar el backup.');
    }
    return true;
  }
"""
replace_once(marker, assert_fn + marker, 'backup assertion')

replace_once(
    '  function downloadJSON(){\n    const payload={',
    "  function downloadJSON(){\n    try{assertAuthoritativeTimelineBackup();}catch(error){alert(error.message);return;}\n    const payload={",
    'timeline json export guard'
)

replace_once(
    '    fields:[...TIMELINE_FIELDS],\n    load:loadEvents,',
    "    fields:[...TIMELINE_FIELDS],\n    isAuthoritativeReady:()=>timelineAuthoritativeReady,\n    assertAuthoritativeBackup:assertAuthoritativeTimelineBackup,\n    load:loadEvents,",
    'public authority API'
)

admin_guard = "\n  if(!window.COI_TIMELINE_COI?.isAuthoritativeReady?.())throw new Error('Backup bloqueado: Timeline no está cargado autoritativamente desde Supabase.');"
inject_function_guard('adminBackupPayload', admin_guard, 'adminBackupPayload guard')
inject_function_guard('obtenerBackupCompletoCOI', admin_guard, 'full backup payload guard')

friendly_guard = "\n  if(!window.COI_TIMELINE_COI?.isAuthoritativeReady?.()){adminSetMsg('Backup bloqueado: espere a que Timeline termine de sincronizar con Supabase.','warn');return;}"
inject_function_guard('adminExportBaseJSON', friendly_guard, 'admin export guard')
inject_function_guard('adminCrearBackupInterno', friendly_guard, 'internal backup guard')

path.write_text(text, encoding='utf-8')
print('PR45 backup authority patch applied')
