from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = """    const order=event.oc?findOrder(event.oc):null;
    const normalizedRequestedOC=text(event.oc).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const normalizedResolvedOC=text(
      order?.oc||order?.row?.oc||order?.row?.nro_oc||order?.row?.numeroOC||
      order?.item?.oc||order?.item?.nro_oc||order?.item?.numeroOC||order?.item?.numero_oc
    ).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const resolvedOrderId=text(order?.orderId);
    const exactOrderId=normalizedRequestedOC&&normalizedResolvedOC===normalizedRequestedOC&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resolvedOrderId)
      ?resolvedOrderId:null;
    const current=window.coiTimelineEvents.find(item=>item.id===event.id);"""
new = """    // Supabase/PostgreSQL resuelve la identidad de la OC desde nro_oc.
    // El cliente no envía UUIDs derivados de una caché que podría estar desactualizada.
    const current=window.coiTimelineEvents.find(item=>item.id===event.id);"""

if s.count(old) != 1:
    raise SystemExit(f'order resolver block matches={s.count(old)}')
s = s.replace(old, new, 1)

old2 = '      orden_id:exactOrderId,'
if s.count(old2) != 1:
    raise SystemExit(f'orden_id payload matches={s.count(old2)}')
s = s.replace(old2, '      orden_id:null,', 1)

p.write_text(s, encoding='utf-8')
print('Supabase OC authority patch applied')
