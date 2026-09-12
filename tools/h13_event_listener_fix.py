from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')
start=s.index('  async function fillLastActs()')
end=s.index('  function enhanceOrders()',start)
repl='''  async function fillLastActs(){
    const my=++seq,cells=qa('#vistaOrdenes #ordenesTbody [data-h13-acta-oc]');if(!cells.length)return;
    try{if(window.__coiSupabaseReady)await window.__coiSupabaseReady;}catch(e){}const c=client();
    const clearRetry=x=>{if(x._h13RetryClick)x.removeEventListener('click',x._h13RetryClick);if(x._h13RetryKey)x.removeEventListener('keydown',x._h13RetryKey);delete x._h13RetryClick;delete x._h13RetryKey;x.removeAttribute('role');x.removeAttribute('tabindex');};
    const armRetry=(x,msg)=>{clearRetry(x);x.textContent='⚠';x.title=msg+' · Click para reintentar';x.tabIndex=0;x.setAttribute('role','button');x._h13RetryClick=()=>fillLastActs();x._h13RetryKey=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fillLastActs();}};x.addEventListener('click',x._h13RetryClick);x.addEventListener('keydown',x._h13RetryKey);};
    const fail=msg=>{if(my!==seq)return;cells.forEach(x=>armRetry(x,msg));};
    if(!c){fail('Consulta de Actas no disponible');return;}try{
      const ids=[...new Set(cells.map(x=>text(x.dataset.h13ActaId)).filter(Boolean))],legacy=[...new Set(cells.filter(x=>!text(x.dataset.h13ActaId)).map(x=>text(x.dataset.h13ActaOc)).filter(Boolean))],rows=[],pageSize=1000;
      async function pageBy(field,values){for(let k=0;k<values.length;k+=100){const batch=values.slice(k,k+100);for(let from=0;;from+=pageSize){const res=await c.from('coi_certificaciones').select('orden_id,nro_oc,acta_medicion_nro,fecha_inicio,fecha_fin,fecha_actualizacion').in(field,batch).order('fecha_fin',{ascending:false,nullsFirst:false}).order('fecha_actualizacion',{ascending:false,nullsFirst:false}).range(from,from+pageSize-1);if(res.error)throw res.error;rows.push(...(res.data||[]));if((res.data||[]).length<pageSize)break;}}}
      if(ids.length)await pageBy('orden_id',ids);if(legacy.length)await pageBy('nro_oc',legacy);if(my!==seq)return;
      const bestId=new Map(),bestOc=new Map(),stamp=r=>text(r.fecha_fin||r.fecha_inicio||r.fecha_actualizacion),better=(m,k,r)=>{if(!k||!text(r.acta_medicion_nro))return;const p=m.get(k);if(!p||stamp(r)>stamp(p)||(stamp(r)===stamp(p)&&Number(r.acta_medicion_nro||0)>Number(p.acta_medicion_nro||0)))m.set(k,r);};
      rows.forEach(r=>{better(bestId,text(r.orden_id),r);better(bestOc,text(r.nro_oc),r);});cells.forEach(x=>{const id=text(x.dataset.h13ActaId),oc=text(x.dataset.h13ActaOc),r=(id&&bestId.get(id))||bestOc.get(oc);clearRetry(x);x.textContent=r?text(r.acta_medicion_nro):'—';x.title=r?'Última Acta de Medición registrada en Supabase':'Sin Acta de Medición registrada';});
    }catch(err){console.warn('COI H13 Actas',err);fail('No se pudo consultar la última Acta de Medición');}}
'''
s=s[:start]+repl+s[end:]
if 'x.onclick=' in s[s.index('<script id="coi-h13-ordenes-avance-acta-alertas">'):]:
    raise SystemExit('onclick handler remains in H13 block')
p.write_text(s,encoding='utf-8')
Path('.github/workflows/h13-event-listener-fix.yml').unlink()
Path('tools/h13_event_listener_fix.py').unlink()
