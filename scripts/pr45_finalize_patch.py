from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'
SPEC = ROOT / 'tests' / 'timeline_supabase_first.spec.js'
WORKFLOW = ROOT / '.github' / 'workflows' / 'pr45-finalize.yml'
SELF = Path(__file__).resolve()


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: se esperaba 1 coincidencia y se encontraron {count}')
    return text.replace(old, new, 1)


index = INDEX.read_text(encoding='utf-8')

old = """  function mergeCommittedTimelineEvents(current,saved){
    const byId=new Map((Array.isArray(current)?current:[]).map(event=>[event.id,event]));
    (Array.isArray(saved)?saved:[]).forEach(event=>byId.set(event.id,event));
    return sortEvents([...byId.values()]);
  }
  async function saveTimelineEventsSupabase(events,reason){
"""
new = """  function mergeCommittedTimelineEvents(current,saved){
    const byId=new Map((Array.isArray(current)?current:[]).map(event=>[event.id,event]));
    (Array.isArray(saved)?saved:[]).forEach(event=>byId.set(event.id,event));
    return sortEvents([...byId.values()]);
  }
  function reconcileTimelineAfterConcurrentMutation(authGeneration,reason){
    Promise.resolve().then(async()=>{
      if(authGeneration!==timelineAuthGeneration)return;
      try{
        const {client}=await requireTimelineSupabase();
        if(authGeneration!==timelineAuthGeneration)return;
        const remote=await fetchTimelineEventsSupabase(client);
        if(authGeneration!==timelineAuthGeneration)return;
        applyTimelineEvents(remote,reason||'Timeline reconciliado desde Supabase');
        setTimelinePersistence('online',`${remote.length} evento(s) sincronizado(s) con Supabase.`);
      }catch(error){
        if(authGeneration!==timelineAuthGeneration)return;
        console.warn('Timeline COI: quedó pendiente una reconciliación remota.',error);
        setTimelinePersistence('warning',`Supabase confirmó una operación previa, pero la reconciliación quedó pendiente: ${error?.message||error}`);
      }
    });
  }
  async function saveTimelineEventsSupabase(events,reason){
"""
index = replace_once(index, old, new, 'insertar reconciliacion')

old = """    const writeMutationGeneration=++timelineMutationGeneration;
    const saved=await upsertTimelineEventsSupabase(client,events);
    if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
      return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true};
    }
"""
new = """    const writeMutationGeneration=++timelineMutationGeneration;
    let saved;
    try{saved=await upsertTimelineEventsSupabase(client,events);}
    catch(error){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras escritura rechazada');
      throw error;
    }
    if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras escritura concurrente');
      return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true};
    }
"""
index = replace_once(index, old, new, 'guardar: commit superpuesto')

old = """      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true};
      }
      applyTimelineEvents(remote,reason||'Timeline guardado en Supabase');
"""
new = """      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras refresco concurrente');
        return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true};
      }
      applyTimelineEvents(remote,reason||'Timeline guardado en Supabase');
"""
index = replace_once(index, old, new, 'guardar: refresco superpuesto')

old = """      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true,refreshError};
      }
      const committed=mergeCommittedTimelineEvents(window.coiTimelineEvents,saved);
"""
new = """      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras fallo de refresco concurrente');
        return {ok:true,count:saved.length,events:[],refreshed:false,discarded:true,refreshError};
      }
      const committed=mergeCommittedTimelineEvents(window.coiTimelineEvents,saved);
"""
index = replace_once(index, old, new, 'guardar: fallo refresco superpuesto')

old = """    list.forEach(validateExactTimelineSnapshotEvent);
    const payload=list.map(timelineEventToDatabase);
    const {data,error}=await client.rpc('coi_timeline_replace_events',{p_events:payload});
    if(error)throw error;
    const committed=(data||[]).map(databaseToTimelineEvent);
    if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
      return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true};
    }
"""
new = """    list.forEach(validateExactTimelineSnapshotEvent);
    const payload=list.map(event=>({...timelineEventToDatabase(event),actualizado_en:event.actualizado_en}));
    let data,error;
    try{({data,error}=await client.rpc('coi_timeline_replace_events',{p_events:payload}));}
    catch(rpcError){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras restore interrumpido');
      throw rpcError;
    }
    if(error){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras restore rechazado');
      throw error;
    }
    const committed=(data||[]).map(databaseToTimelineEvent);
    if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras restore concurrente');
      return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true};
    }
"""
index = replace_once(index, old, new, 'restore: payload timestamp y concurrencia')

old = """      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true};
      }
      applyTimelineEvents(remote,reason||'Timeline reemplazado en Supabase');
"""
new = """      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras refresco de restore concurrente');
        return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true};
      }
      applyTimelineEvents(remote,reason||'Timeline reemplazado en Supabase');
"""
index = replace_once(index, old, new, 'restore: refresco superpuesto')

old = """      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true,refreshError};
      }
      applyTimelineEvents(committed,reason||'Timeline reemplazado en Supabase');
"""
new = """      if(writeGeneration!==timelineAuthGeneration||writeMutationGeneration!==timelineMutationGeneration){
        if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras fallo de refresco de restore');
        return {ok:true,count:committed.length,events:[],refreshed:false,discarded:true,refreshError};
      }
      applyTimelineEvents(committed,reason||'Timeline reemplazado en Supabase');
"""
index = replace_once(index, old, new, 'restore: fallo refresco superpuesto')

old = """      const {data,error}=await client.rpc('coi_timeline_delete_event',{p_id:id,p_expected_actualizado_en:event.actualizado_en||null});
      if(error)throw error;
      if(!Array.isArray(data)||data.length!==1)throw new Error('COI_TIMELINE_STALE_DELETE: Supabase no confirmó una única eliminación.');
      if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration)return;
"""
new = """      const {data,error}=await client.rpc('coi_timeline_delete_event',{p_id:id,p_expected_actualizado_en:event.actualizado_en||null});
      if(error)throw error;
      if(!Array.isArray(data)||data.length!==1)throw new Error('COI_TIMELINE_STALE_DELETE: Supabase no confirmó una única eliminación.');
      if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration){
        if(deleteGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(deleteGeneration,'Timeline reconciliado tras eliminación concurrente');
        return;
      }
"""
index = replace_once(index, old, new, 'delete: commit superpuesto')

old = """        if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration)return;
        applyTimelineEvents(remote,'Evento eliminado en Supabase');
"""
new = """        if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration){
          if(deleteGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(deleteGeneration,'Timeline reconciliado tras refresco de eliminación concurrente');
          return;
        }
        applyTimelineEvents(remote,'Evento eliminado en Supabase');
"""
index = replace_once(index, old, new, 'delete: refresco superpuesto')

old = """        if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration)return;
        const committed=window.coiTimelineEvents.filter(item=>item.id!==id);
"""
new = """        if(deleteGeneration!==timelineAuthGeneration||deleteMutationGeneration!==timelineMutationGeneration){
          if(deleteGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(deleteGeneration,'Timeline reconciliado tras fallo de refresco de eliminación');
          return;
        }
        const committed=window.coiTimelineEvents.filter(item=>item.id!==id);
"""
index = replace_once(index, old, new, 'delete: fallo refresco superpuesto')

old = """    }catch(error){
      if(deleteGeneration!==timelineAuthGeneration)return;
      console.error('Timeline COI: no se eliminó el evento.',error);
      alert(`No se eliminó el evento.\\n\\n${error?.message||error}`);
    }
"""
new = """    }catch(error){
      if(deleteGeneration!==timelineAuthGeneration)return;
      reconcileTimelineAfterConcurrentMutation(deleteGeneration,'Timeline reconciliado tras eliminación rechazada');
      console.error('Timeline COI: no se eliminó el evento.',error);
      alert(`No se eliminó el evento.\\n\\n${error?.message||error}`);
    }
"""
index = replace_once(index, old, new, 'delete: reconciliar error')

INDEX.write_text(index, encoding='utf-8')

spec = SPEC.read_text(encoding='utf-8')

old = """        if (name === 'coi_timeline_replace_events') {
"""
new = """        if (name === 'coi_timeline_delete_event') {
          if (!['administrador', 'jefatura'].includes(state.role)) {
            return { data: null, error: { code: '42501', message: 'COI_ROLE_REQUIRED' } };
          }
          const id = args.p_id;
          const previous = state.rows.find(row => row.id === id);
          if (!previous || !args.p_expected_actualizado_en || previous.actualizado_en !== args.p_expected_actualizado_en) {
            return {
              data: null,
              error: { code: '40001', message: 'COI_TIMELINE_STALE_DELETE: El evento fue modificado por otra sesión.' }
            };
          }
          state.rows = state.rows.filter(row => row.id !== id);
          state.operations.push({ action: 'delete', table: 'coi_timeline_events', ids: [id] });
          return { data: clone([previous]), error: null };
        }
        if (name === 'coi_timeline_replace_events') {
"""
spec = replace_once(spec, old, new, 'fixture RPC delete versionado')

old = """          state.rows = (args.p_events || []).map(item => serverRow(item, previous.get(item.id) || {}));
"""
new = """          state.rows = (args.p_events || []).map(item => {
            const row = serverRow(item, previous.get(item.id) || {});
            if (item.actualizado_en) row.actualizado_en = item.actualizado_en;
            return row;
          });
"""
spec = replace_once(spec, old, new, 'fixture restore timestamp')

old = """  await page.evaluate(async () => {
    await window.COI_TIMELINE_COI.replace([{
      id: 'TL-SNAPSHOT-UNICO', fecha: '2026-08-26', hora: '09:00',
      titulo: 'Snapshot único', tipo_evento: 'Mailing', origen: 'Mailing',
      estado: 'Cerrado', riesgo: 'Bajo'
    }]);
  });
"""
new = """  await page.evaluate(async () => {
    const template = { ...window.coiTimelineEvents[0] };
    window.__TIMELINE_EXACT_TEMPLATE__ = template;
    await window.COI_TIMELINE_COI.replace([{
      ...template,
      id: 'TL-SNAPSHOT-UNICO', fecha: '2026-08-26', hora: '09:00', semana: '2026-W35',
      titulo: 'Snapshot único', tipo_evento: 'Mailing', origen: 'Mailing',
      estado: 'Cerrado', riesgo: 'Bajo'
    }]);
  });
"""
spec = replace_once(spec, old, new, 'test restore snapshot exacto')

old = """        [storageKey]: JSON.stringify([{
          id: 'TL-RESTORE-COMMITTED', fecha: '2026-08-27', titulo: 'Restore confirmado',
          tipo_evento: 'Mailing', estado: 'Informativo', riesgo: 'Bajo'
        }])
"""
new = """        [storageKey]: JSON.stringify([{
          ...window.__TIMELINE_EXACT_TEMPLATE__,
          id: 'TL-RESTORE-COMMITTED', fecha: '2026-08-27', hora: '09:00', semana: '2026-W35',
          titulo: 'Restore confirmado', tipo_evento: 'Mailing', estado: 'Informativo', riesgo: 'Bajo'
        }])
"""
spec = replace_once(spec, old, new, 'test restore marker failure exacto')

old = """        [storageKey]: JSON.stringify([{
          id: 'TL-NO-DEBE-QUEDAR', fecha: '2026-08-27', titulo: 'No persistir',
          tipo_evento: 'Mailing', estado: 'Informativo', riesgo: 'Bajo'
        }])
"""
new = """        [storageKey]: JSON.stringify([{
          ...window.__TIMELINE_EXACT_TEMPLATE__,
          id: 'TL-NO-DEBE-QUEDAR', fecha: '2026-08-27', hora: '09:00', semana: '2026-W35',
          titulo: 'No persistir', tipo_evento: 'Mailing', estado: 'Informativo', riesgo: 'Bajo'
        }])
"""
spec = replace_once(spec, old, new, 'test restore rollback exacto')

SPEC.write_text(spec, encoding='utf-8')

# El finalizador es deliberadamente efimero: no deja tooling temporal en la rama.
if WORKFLOW.exists():
    WORKFLOW.unlink()
if SELF.exists():
    SELF.unlink()

print('PR45 patch aplicado: index.html + timeline_supabase_first.spec.js; tooling temporal retirado.')
