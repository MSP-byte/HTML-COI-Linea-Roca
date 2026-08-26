from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    text = text.replace(old, new, 1)
    print('patched:', label)


def replace_function(marker, replacement, label):
    global text
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f'{label}: function marker not found')
    brace = text.find('{', start)
    depth = 0
    end = None
    in_s = in_d = in_t = False
    esc = False
    for i in range(brace, len(text)):
        ch = text[i]
        if esc:
            esc = False
            continue
        if ch == '\\':
            esc = True
            continue
        if in_s:
            if ch == "'": in_s = False
            continue
        if in_d:
            if ch == '"': in_d = False
            continue
        if in_t:
            if ch == '`': in_t = False
            continue
        if ch == "'": in_s = True; continue
        if ch == '"': in_d = True; continue
        if ch == '`': in_t = True; continue
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit(f'{label}: closing brace not found')
    text = text[:start] + replacement + text[end:]
    print('patched:', label)


# 1) INITIAL_SESSION con session=null nunca puede reexponer la caché del usuario anterior.
replace_once(
    "      const authEvent=event.detail?.event||'';\n      if(authEvent==='SIGNED_OUT'){",
    "      const authEvent=event.detail?.event||'';\n      const authSession=event.detail?.session||null;\n      if(authEvent==='SIGNED_OUT'||(authEvent==='INITIAL_SESSION'&&!authSession?.user)){",
    'initial-session-null'
)

# 2) Una OC ausente no puede heredar el UUID sintético devuelto por findOrder().
replace_once(
    "    const order=event.oc?findOrder(event.oc):null;\n    const current=window.coiTimelineEvents.find(item=>item.id===event.id);",
    """    const order=event.oc?findOrder(event.oc):null;
    const normalizedRequestedOC=text(event.oc).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const normalizedResolvedOC=text(
      order?.oc||order?.row?.oc||order?.row?.nro_oc||order?.row?.numeroOC||
      order?.item?.oc||order?.item?.nro_oc||order?.item?.numeroOC||order?.item?.numero_oc
    ).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const resolvedOrderId=text(order?.orderId);
    const exactOrderId=normalizedRequestedOC&&normalizedResolvedOC===normalizedRequestedOC&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resolvedOrderId)
      ?resolvedOrderId:null;
    const current=window.coiTimelineEvents.find(item=>item.id===event.id);""",
    'exact-oc-uuid'
)
replace_once("      orden_id:order?.orderId||null,", "      orden_id:exactOrderId,", 'use-exact-oc-uuid')

# 3) La reconciliación remota espera a que no haya mutaciones DB en vuelo.
replace_once(
    "  let timelineMutationGeneration=0;",
    "  let timelineMutationGeneration=0;\n  let timelineMutationsInFlight=0;\n  let timelineReconcileTimer=null;",
    'mutation-inflight-state'
)

replace_once(
    """    let saved;
    try{saved=await upsertTimelineEventsSupabase(client,events);}
    catch(error){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras escritura rechazada');
      throw error;
    }""",
    """    timelineMutationsInFlight+=1;
    let saved;
    try{saved=await upsertTimelineEventsSupabase(client,events);}
    catch(error){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras escritura rechazada');
      throw error;
    }finally{
      timelineMutationsInFlight=Math.max(0,timelineMutationsInFlight-1);
    }""",
    'track-upsert-flight'
)

replace_once(
    """    let data,error;
    try{({data,error}=await client.rpc('coi_timeline_replace_events',{p_events:payload}));}
    catch(rpcError){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras restore interrumpido');
      throw rpcError;
    }""",
    """    timelineMutationsInFlight+=1;
    let data,error;
    try{({data,error}=await client.rpc('coi_timeline_replace_events',{p_events:payload}));}
    catch(rpcError){
      if(writeGeneration===timelineAuthGeneration)reconcileTimelineAfterConcurrentMutation(writeGeneration,'Timeline reconciliado tras restore interrumpido');
      throw rpcError;
    }finally{
      timelineMutationsInFlight=Math.max(0,timelineMutationsInFlight-1);
    }""",
    'track-replace-flight'
)

replace_once(
    "      const {data,error}=await client.rpc('coi_timeline_delete_event',{p_id:id,p_expected_actualizado_en:event.actualizado_en||null});",
    """      timelineMutationsInFlight+=1;
      let deleteResponse;
      try{deleteResponse=await client.rpc('coi_timeline_delete_event',{p_id:id,p_expected_actualizado_en:event.actualizado_en||null});}
      finally{timelineMutationsInFlight=Math.max(0,timelineMutationsInFlight-1);}
      const {data,error}=deleteResponse;""",
    'track-delete-flight'
)

replace_function(
    '  function reconcileTimelineAfterConcurrentMutation(authGeneration,reason){',
    """  function reconcileTimelineAfterConcurrentMutation(authGeneration,reason){
    if(timelineReconcileTimer)clearTimeout(timelineReconcileTimer);
    const attempt=()=>{
      if(authGeneration!==timelineAuthGeneration)return;
      if(timelineMutationsInFlight>0){
        timelineReconcileTimer=setTimeout(attempt,30);
        return;
      }
      const stableGeneration=timelineMutationGeneration;
      timelineReconcileTimer=null;
      Promise.resolve().then(async()=>{
        if(authGeneration!==timelineAuthGeneration)return;
        if(timelineMutationsInFlight>0||timelineMutationGeneration!==stableGeneration){
          timelineReconcileTimer=setTimeout(attempt,30);
          return;
        }
        try{
          const {client}=await requireTimelineSupabase();
          if(authGeneration!==timelineAuthGeneration)return;
          if(timelineMutationsInFlight>0||timelineMutationGeneration!==stableGeneration){
            timelineReconcileTimer=setTimeout(attempt,30);
            return;
          }
          const remote=await fetchTimelineEventsSupabase(client);
          if(authGeneration!==timelineAuthGeneration)return;
          if(timelineMutationsInFlight>0||timelineMutationGeneration!==stableGeneration){
            timelineReconcileTimer=setTimeout(attempt,30);
            return;
          }
          applyTimelineEvents(remote,reason||'Timeline reconciliado desde Supabase');
          setTimelinePersistence('online',`${remote.length} evento(s) sincronizado(s) con Supabase.`);
        }catch(error){
          if(authGeneration!==timelineAuthGeneration)return;
          if(timelineMutationsInFlight>0||timelineMutationGeneration!==stableGeneration){
            timelineReconcileTimer=setTimeout(attempt,30);
            return;
          }
          console.warn('Timeline COI: quedó pendiente una reconciliación remota.',error);
          setTimelinePersistence('warning',`Supabase confirmó una operación previa, pero la reconciliación quedó pendiente: ${error?.message||error}`);
        }
      });
    };
    timelineReconcileTimer=setTimeout(attempt,0);
  }""",
    'stable-reconcile'
)

# 4) Backup maestro V58.1: solo restaura Timeline por su RPC; no escribe datasets canónicos locales.
pos = text.find('backup maestro V58.1')
if pos < 0:
    raise SystemExit('master-restore: marker not found')
start = text.rfind('  function importarBackup(file){', 0, pos)
if start < 0:
    raise SystemExit('master-restore: function start not found')
marker = text[start:text.find('{', start)+1]
replacement = """  function importarBackup(file){
    if(!file)return;
    if(!confirm('Este backup solo restaurará datasets con una ruta autoritativa Supabase disponible. Los datos sin RPC de restore no se escribirán localmente como fuente de verdad. ¿Continuar?'))return;
    const reader=new FileReader();
    reader.onload=async()=>{
      try{
        const data=JSON.parse(reader.result);
        if(!data||typeof data!=='object')throw new Error('JSON inválido');
        const timelineKey=window.COI_TIMELINE_COI?.storageKey||'coi_timeline_events_v1';
        let timelineRestored=false;
        if(data.localStorage&&typeof data.localStorage==='object'&&Object.prototype.hasOwnProperty.call(data.localStorage,timelineKey)){
          if(typeof window.COI_TIMELINE_COI?.replace!=='function')throw new Error('La restauración autoritativa de Timeline no está disponible.');
          const raw=data.localStorage[timelineKey];
          const incoming=typeof raw==='string'?JSON.parse(raw):raw;
          if(!Array.isArray(incoming))throw new Error('El Timeline del backup no es una colección válida.');
          await window.COI_TIMELINE_COI.replace(incoming,'Timeline restaurado desde backup maestro V58.1');
          timelineRestored=true;
        }
        const omitted=data.datos&&typeof data.datos==='object'
          ?Object.entries(data.datos).filter(([,value])=>Array.isArray(value)&&value.length).map(([key])=>key)
          :[];
        saveJSONKey(LS_BACKUP_META,{fecha:now(),tipo:'Importado Supabase-first',version:data.version||data.appVersion||VERSION,archivo:file.name,usuario:'Supabase'});
        const detail=[
          timelineRestored?'Timeline restaurado y confirmado en Supabase.':'El archivo no contenía un snapshot Timeline para restaurar.',
          omitted.length?`No se aplicaron localmente datasets canónicos sin RPC de restore: ${omitted.join(', ')}.`:''
        ].filter(Boolean).join(' ');
        toast('Backup procesado',omitted.length||!timelineRestored?'warn':'ok',detail);
        if(timelineRestored)setTimeout(()=>location.reload(),700);
      }catch(e){
        toast('No se pudo importar backup','error',e.message||String(e));
      }
    };
    reader.readAsText(file);
  }"""

# Balanceo de llaves desde el inicio específico encontrado.
brace = text.find('{', start)
depth = 0
end = None
in_s = in_d = in_t = False
esc = False
for i in range(brace, len(text)):
    ch = text[i]
    if esc:
        esc = False
        continue
    if ch == '\\':
        esc = True
        continue
    if in_s:
        if ch == "'": in_s = False
        continue
    if in_d:
        if ch == '"': in_d = False
        continue
    if in_t:
        if ch == '`': in_t = False
        continue
    if ch == "'": in_s = True; continue
    if ch == '"': in_d = True; continue
    if ch == '`': in_t = True; continue
    if ch == '{': depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    raise SystemExit('master-restore: closing brace not found')
text = text[:start] + replacement + text[end:]
print('patched: supabase-only-master-restore')

path.write_text(text, encoding='utf-8')
