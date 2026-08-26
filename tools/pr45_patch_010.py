from pathlib import Path

INDEX = Path('index.html')
TEST = Path('tests/check_timeline_supabase_first.js')
s = INDEX.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    s = s.replace(old, new, 1)


# 1) Auth generation already protects account switches. Add a separate mutation
# generation so an older read in the same session can never overwrite a newer
# Supabase-confirmed write/delete/restore.
replace_once(
    "  let timelineLoadPromise=null;\n  let timelineLoadGeneration=-1;\n  let timelineAuthGeneration=0;",
    "  let timelineLoadPromise=null;\n  let timelineLoadGeneration=-1;\n  let timelineLoadMutationGeneration=-1;\n  let timelineAuthGeneration=0;\n  let timelineMutationGeneration=0;",
    'timeline mutation generation declarations'
)

# 2) Once Supabase confirms the one-time legacy migration, retire the legacy
# source first. The local marker is only best-effort metadata and can never be
# allowed to keep replayable data alive.
replace_once(
    "    if(pending.length)await upsertTimelineEventsSupabase(client,pending);\n    localStorage.setItem(TIMELINE_MIGRATION_KEY,JSON.stringify({completedAt:nowISO(),migrated:pending.length}));\n    localStorage.removeItem(TIMELINE_LEGACY_KEY);\n    return {migrated:pending.length};",
    "    if(pending.length)await upsertTimelineEventsSupabase(client,pending);\n    try{localStorage.removeItem(TIMELINE_LEGACY_KEY);}catch(error){console.warn('Timeline COI: Supabase confirmó la migración, pero no se pudo retirar la entrada legacy.',error);}\n    try{localStorage.setItem(TIMELINE_MIGRATION_KEY,JSON.stringify({completedAt:nowISO(),migrated:pending.length}));}\n    catch(error){console.warn('Timeline COI: la migración quedó confirmada en Supabase; el marcador local es no autoritativo.',error);}\n    return {migrated:pending.length};",
    'legacy migration retirement order'
)

# 3) Key load de-duplication and all completion guards by auth + mutation gen.
replace_once(
    "  async function loadEvents(options={}){\n    const loadGeneration=timelineAuthGeneration;\n    if(timelineLoadPromise&&timelineLoadGeneration===loadGeneration)return timelineLoadPromise;\n    timelineLoadGeneration=loadGeneration;",
    "  async function loadEvents(options={}){\n    const loadGeneration=timelineAuthGeneration;\n    const loadMutationGeneration=timelineMutationGeneration;\n    if(timelineLoadPromise&&timelineLoadGeneration===loadGeneration&&timelineLoadMutationGeneration===loadMutationGeneration)return timelineLoadPromise;\n    timelineLoadGeneration=loadGeneration;\n    timelineLoadMutationGeneration=loadMutationGeneration;",
    'load generation header'
)
load_start = s.index("  async function loadEvents(options={}){")
load_end = s.index("  function mergeCommittedTimelineEvents", load_start)
load_section = s[load_start:load_end]
old_guard = "loadGeneration!==timelineAuthGeneration"
if old_guard not in load_section:
    raise SystemExit('load mutation completion guard: no auth-generation guard found')
load_section = load_section.replace(
    old_guard,
    "loadGeneration!==timelineAuthGeneration||loadMutationGeneration!==timelineMutationGeneration"
)
s = s[:load_start] + load_section + s[load_end:]

# Exact backup validator: an exported Timeline snapshot must already be in the
# canonical client representation. Reject values that normalize differently;
# never silently rewrite a backup on restore.
validator = r'''  function validateExactTimelineSnapshotEvent(item,index){
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error(`El evento Timeline #${index+1} no es un objeto válido.`);
    for(const field of TIMELINE_FIELDS){
      if(!Object.prototype.hasOwnProperty.call(item,field))throw new Error(`El evento Timeline #${index+1} no contiene el campo ${field}.`);
      if(typeof item[field]!=='string')throw new Error(`El campo ${field} del evento Timeline #${index+1} debe ser texto.`);
    }
    const normalized=normalizeEvent(item);
    for(const field of TIMELINE_FIELDS){
      if(normalized[field]!==item[field])throw new Error(`El campo ${field} del evento Timeline #${index+1} no está normalizado; se rechaza para preservar exactamente el backup.`);
    }
    return item;
  }
'''

# 4) Replace the two mutation helpers as complete units. This is intentionally
# structural instead of line-based so the patch remains deterministic.
save_start = s.index("  async function saveTimelineEventsSupabase(events,reason){")
save_end = s.index("  async function replaceTimelineEventsSupabase(events,reason){", save_start)
new_save = """  async function saveTimelineEventsSupabase(events,reason){
    const writeGeneration=timelineAuthGeneration;
    const {client}=await requireTimelineSupabase('write');
    if(writeGeneration!==timelineAuthGeneration)throw new Error('La sesión cambió antes de iniciar la escritura del Timeline.');
    const writeMutationGeneration=++timelineMutationGeneration;
    const saved=await upsertTimelineEventsSupabase(client,events);
    if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
      return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true};
    }
    try{
      const remote=await fetchTimelineEventsSupabase(client);
      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true};
      }
      applyTimelineEvents(remote,reason||'Timeline guardado en Supabase');
      setTimelinePersistence('online',`${remote.length} evento(s) sincronizado(s) con Supabase.`);
      return {ok:true,count:saved.length,events:saved,refreshed:true};
    }catch(refreshError){
      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true,refreshError};
      }
      const committed=mergeCommittedTimelineEvents(window.coiTimelineEvents,saved);
      applyTimelineEvents(committed,reason||'Timeline guardado en Supabase');
      setTimelinePersistence('warning',`Supabase confirmó ${saved.length} evento(s), pero no se pudo refrescar la lista completa: ${refreshError?.message||refreshError}`);
      return {ok:true,count:saved.length,events:saved,refreshed:false,refreshError};
    }
  }
"""
s = s[:save_start] + new_save + s[save_end:]

replace_start = s.index("  async function replaceTimelineEventsSupabase(events,reason){")
replace_end = s.index("  window.coiTimelineEvents=[];", replace_start)
new_replace = validator + """  async function replaceTimelineEventsSupabase(events,reason){
    const writeGeneration=timelineAuthGeneration;
    const {client}=await requireTimelineSupabase('delete');
    if(writeGeneration!==timelineAuthGeneration)throw new Error('La sesión cambió antes de iniciar la restauración del Timeline.');
    const writeMutationGeneration=++timelineMutationGeneration;
    const list=Array.isArray(events)?events:[];
    list.forEach(validateExactTimelineSnapshotEvent);
    const payload=list.map(timelineEventToDatabase);
    const {data,error}=await client.rpc('coi_timeline_replace_events',{p_events:payload});
    if(error)throw error;
    const committed=(data||[]).map(databaseToTimelineEvent);
    if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
      return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true};
    }
    try{
      const remote=await fetchTimelineEventsSupabase(client);
      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true};
      }
      applyTimelineEvents(remote,reason||'Timeline reemplazado en Supabase');
      setTimelinePersistence('online',`${remote.length} evento(s) restaurado(s) en Supabase.`);
      return {ok:true,count:remote.length,events:remote,refreshed:true};
    }catch(refreshError){
      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true,refreshError};
      }
      applyTimelineEvents(committed,reason||'Timeline reemplazado en Supabase');
      setTimelinePersistence('warning',`Supabase confirmó la restauración de ${committed.length} evento(s), pero falló el refresco posterior: ${refreshError?.message||refreshError}`);
      return {ok:true,count:committed.length,events:committed,refreshed:false,refreshError};
    }
  }
"""
s = s[:replace_start] + new_replace + s[replace_end:]

# 5) Versioned DELETE goes through the serialized database RPC introduced by
# migration 010. No local/UI deletion is considered authoritative before the
# remote transaction confirms success.
delete_start = s.index("  async function deleteEvent(id){")
delete_end = s.index("  function downloadJSON(){", delete_start)
new_delete = """  async function deleteEvent(id){
    const event=window.coiTimelineEvents.find(item=>item.id===id);
    if(!event)return;
    if(!confirm(`Eliminar el movimiento \\\"${event.titulo}\\\" del ${displayDate(event.fecha)}?\\n\\nSe eliminará el registro compartido de Supabase y quedará constancia en la auditoría.`))return;
    const deleteGeneration=timelineAuthGeneration;
    try{
      const {client}=await requireTimelineSupabase('delete');
      if(deleteGeneration!==timelineAuthGeneration)return;
      const deleteMutationGeneration=++timelineMutationGeneration;
      const {data,error}=await client.rpc('coi_timeline_delete_event',{p_id:id,p_expected_actualizado_en:event.actualizado_en||null});
      if(error)throw error;
      if(!Array.isArray(data)||data.length!==1)throw new Error('COI_TIMELINE_STALE_DELETE: Supabase no confirmó una única eliminación.');
      if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration)return;
      try{
        const remote=await fetchTimelineEventsSupabase(client);
        if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration)return;
        applyTimelineEvents(remote,'Evento eliminado en Supabase');
        setTimelinePersistence('online',`${remote.length} evento(s) sincronizado(s) con Supabase.`);
      }catch(refreshError){
        if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration)return;
        const committed=window.coiTimelineEvents.filter(item=>item.id!==id);
        applyTimelineEvents(committed,'Evento eliminado en Supabase');
        setTimelinePersistence('warning',`Supabase confirmó la eliminación, pero no se pudo refrescar la lista completa: ${refreshError?.message||refreshError}`);
      }
      if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration)return;
      if(typeof window.mostrarMensajeCOI==='function')window.mostrarMensajeCOI('Evento eliminado de Supabase.','ok');
    }catch(error){
      if(deleteGeneration!==timelineAuthGeneration)return;
      console.error('Timeline COI: no se eliminó el evento.',error);
      alert(`No se eliminó el evento.\\n\\n${error?.message||error}`);
    }
  }
"""
s = s[:delete_start] + new_delete + s[delete_end:]

# 6) Raw backup must pass exact validation BEFORE any normalization.
replace_once(
    "          if(Array.isArray(parsed)){\n            const invalidIndex=parsed.findIndex(item=>!text(item?.titulo));\n            if(invalidIndex>=0)throw new Error(`El evento Timeline #${invalidIndex+1} no tiene título.`);\n            incoming=parsed.map(normalizeEvent);\n          }",
    "          if(Array.isArray(parsed)){\n            parsed.forEach(validateExactTimelineSnapshotEvent);\n            incoming=parsed.map(item=>({...item}));\n          }",
    'raw backup validation before normalization'
)

# 7) Do not tell an administrator that the whole backup was remotely restored
# when this wrapper only has a Supabase replacement contract for Timeline.
replace_once(
    "adminSetMsg(`Backup importado correctamente en Supabase: ${file.name}`,'ok');",
    "adminSetMsg(`Backup procesado: Timeline restaurado en Supabase. Las demás secciones del archivo no reemplazan tablas remotas desde este flujo: ${file.name}`,'warn');",
    'honest imported backup message'
)
replace_once(
    "adminSetMsg('Backup interno restaurado correctamente en Supabase.','ok');",
    "adminSetMsg('Backup procesado: Timeline restaurado en Supabase. Las demás secciones del backup interno no reemplazan tablas remotas desde este flujo.','warn');",
    'honest internal backup message'
)

INDEX.write_text(s, encoding='utf-8')

# Update the static contract to include the forward-only serialization layer.
t = TEST.read_text(encoding='utf-8')
old = "const finalHardening = fs.readFileSync('supabase/migrations/202608250009_timeline_final_review_hardening.sql', 'utf8');"
new = old + "\nconst serialization = fs.readFileSync('supabase/migrations/202608260010_timeline_transaction_serialization.sql', 'utf8');"
if t.count(old) != 1:
    raise SystemExit('migration 010 test reference: finalHardening marker mismatch')
t = t.replace(old, new, 1)

old = "/\\.delete\\(\\)\\.eq\\('id',id\\)\\.eq\\('actualizado_en',event\\.actualizado_en\\)\\.select\\('id'\\)/,"
new = "/client\\.rpc\\('coi_timeline_delete_event',\\{p_id:id,p_expected_actualizado_en:event\\.actualizado_en\\|\\|null\\}\\)/,"
if t.count(old) != 1:
    raise SystemExit('delete RPC static assertion mismatch')
t = t.replace(old, new, 1)

old = "assert.match(html, /invalidIndex=parsed\\.findIndex\\(item=>!text\\(item\\?\\.titulo\\)\\)/);"
new = "assert.match(html, /validateExactTimelineSnapshotEvent/);\nassert.match(html, /let timelineMutationGeneration=0/);\nassert.match(html, /loadMutationGeneration!==timelineMutationGeneration/);"
if t.count(old) != 1:
    raise SystemExit('exact backup static assertion mismatch')
t = t.replace(old, new, 1)

marker = "assert.match(html, /replacement\\?\\.discarded/);"
addition = """for (const pattern of [
  /pg_advisory_xact_lock\\(hashtextextended\\('coi_timeline_mutation_v1'/,
  /coi_timeline_replace_events/,
  /coi_timeline_delete_event/,
  /COI_TIMELINE_STALE_DELETE/,
  /Restore administrativo atomico y sin limite artificial de 5000/
]) assert.match(serialization, pattern);
assert.match(html, /replacement\\?\\.discarded/);"""
if t.count(marker) != 1:
    raise SystemExit('serialization static assertion insertion marker mismatch')
t = t.replace(marker, addition, 1)

TEST.write_text(t, encoding='utf-8')
