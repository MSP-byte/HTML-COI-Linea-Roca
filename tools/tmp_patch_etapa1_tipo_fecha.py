from pathlib import Path

p=Path('index.html')
html=p.read_text(encoding='utf-8')
marker='<script id="coi-etapa1-pipeline-contractual">'
start=html.index(marker)
end=html.index('</script>',start)
mod=html[start:end]


def once(text, old, new, label):
    n=text.count(old)
    if n==0 and new in text:
        return text
    if n!=1:
        raise SystemExit(f'{label}: se esperaba 1 coincidencia, hubo {n}')
    return text.replace(old,new,1)

anchor="  const MS_DIA = 86400000;\n\n  const texto = (v) => String(v == null ? '' : v).trim();"
helpers="""  const MS_DIA = 86400000;

  const texto = (v) => String(v == null ? '' : v).trim();
  function tipoOrden(orden) {
    const raw=texto(orden&&((orden._supabaseRaw&&orden._supabaseRaw.tipo)||orden.tipo||orden.tipo_oc||orden.tipoOC));
    const t=raw.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase();
    if(t.indexOf('SERVICIO')>=0)return 'SERVICIO';
    if(t.indexOf('OBRA')>=0)return 'OBRA';
    return t;
  }
  function esObra(orden){return tipoOrden(orden)==='OBRA';}
  function nombreEtapaPorTipo(etapa,orden){
    const codigo=texto(etapa&&etapa.codigo);
    const tipo=tipoOrden(orden);
    if(tipo!=='OBRA'&&tipo!=='SERVICIO')return texto(etapa&&etapa.nombre);
    const servicio=tipo==='SERVICIO';
    if(codigo==='ejecucion')return servicio?'SERVICIO EN EJECUCIÓN':'OBRA EN EJECUCIÓN';
    if(codigo==='finalizada')return servicio?'SERVICIO FINALIZADO':'OBRA FINALIZADA';
    if(codigo==='finalizada_actas')return servicio?'SERVICIO FINALIZADO CON ACTA PROVISORIA Y DEFINITIVA':'OBRA FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA';
    if(codigo==='finalizada_saldo_remanente')return servicio?'SERVICIO FINALIZADO PERO CON SALDO REMANENTE':'OBRA FINALIZADA';
    if(codigo==='cancelada_suspendida')return servicio?'SERVICIO CANCELADO O SUSPENDIDO':'OBRA CANCELADA O SUSPENDIDA';
    return texto(etapa&&etapa.nombre);
  }"""
if 'function nombreEtapaPorTipo(etapa,orden)' not in mod:
    mod=once(mod,anchor,helpers,'helpers tipo')

fecha_anchor="""  const fechaHora = (v) => {
    try { return typeof window.formatearFechaHoraCOI === 'function' ? window.formatearFechaHoraCOI(v) : texto(v) || '—'; }
    catch (e) { return texto(v) || '—'; }
  };"""
fecha_helpers=fecha_anchor+"""
  function hoyBuenosAires(){
    try{
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      const get=(k)=>parts.find((part)=>part.type===k)?.value||'';
      return get('year')+'-'+get('month')+'-'+get('day');
    }catch(e){return new Date().toISOString().slice(0,10);}
  }
  function fechaInputEvento(ev){
    const efectiva=texto(ev&&ev.fecha_efectiva);
    if(/^\\d{4}-\\d{2}-\\d{2}$/.test(efectiva))return efectiva;
    const registrada=texto(ev&&ev.fecha_evento);
    return /^\\d{4}-\\d{2}-\\d{2}/.test(registrada)?registrada.slice(0,10):'';
  }
  function fechaCalculoEvento(ev){
    const f=fechaInputEvento(ev);
    return f ? f+'T12:00:00-03:00' : texto(ev&&ev.fecha_evento);
  }
  function fechaEventoUI(ev){
    const efectiva=texto(ev&&ev.fecha_efectiva);
    if(/^\\d{4}-\\d{2}-\\d{2}$/.test(efectiva)){
      const a=efectiva.split('-'); return a[2]+'/'+a[1]+'/'+a[0];
    }
    return fechaHora(ev&&ev.fecha_evento);
  }"""
if 'function hoyBuenosAires()' not in mod:
    mod=once(mod,fecha_anchor,fecha_helpers,'helpers fecha')

old_et2="""  function etapasEtapa2() {
    const todas = etapas();
    const extra = etapaExtraSaldo();
    const lista = todas.filter((e) => CODIGOS_ETAPA2.indexOf(e.codigo) >= 0);
    if (extra && !lista.some((e) => e.codigo === extra.codigo)) lista.push(Object.assign({}, extra));
    return lista;
  }"""
new_et2="""  function etapasEtapa2(orden) {
    const todas = etapas();
    const extra = etapaExtraSaldo();
    const lista = todas.filter((e) => CODIGOS_ETAPA2.indexOf(e.codigo) >= 0)
      .filter((e) => !(esObra(orden) && e.codigo === 'finalizada_saldo_remanente'));
    if (extra && !esObra(orden) && !lista.some((e) => e.codigo === extra.codigo)) lista.push(Object.assign({}, extra));
    return lista;
  }"""
if 'function etapasEtapa2(orden)' not in mod:
    mod=once(mod,old_et2,new_et2,'etapa2 tipo')

if '      orden: orden,\n      hitos: hitos,' not in mod:
    mod=once(mod,"""    return {
      nro: nro,
      hitos: hitos,""","""    return {
      nro: nro,
      orden: orden,
      hitos: hitos,""",'estado orden')

mod=mod.replace('    const lista = etapasEtapa2();','    const lista = etapasEtapa2(estado.orden);')
mod=mod.replace('esc(et.nombre)', 'esc(nombreEtapaPorTipo(et,estado.orden))')

mod=mod.replace('fechaHora(ev.fecha_evento)','fechaEventoUI(ev)')
mod=mod.replace('fechaHora(ultimaAct.ev.fecha_evento)','fechaEventoUI(ultimaAct.ev)')
# Separación deliberada: la fecha del hito es administrativa; "Última actualización"
# es el timestamp real de registración/auditoría.
mod=mod.replace('ultimaAct ? fechaEventoUI(ultimaAct.ev)', 'ultimaAct ? fechaHora(ultimaAct.ev.fecha_evento)')
mod=mod.replace('new Date(transversal.fecha_evento || 0) < new Date(actaEvento.fecha_evento || 0)',
                'new Date(fechaCalculoEvento(transversal) || 0) < new Date(fechaCalculoEvento(actaEvento) || 0)')

old_dias="""      if (esActual && !estado.etapa1Finalizada) return diasEntre(x.ev.fecha_evento, null);
      // Hueco: el inmediato siguiente no esta registrado.
      return null;
    }
    const desde = new Date(x.ev.fecha_evento);
    const hasta = new Date(siguienteEv.fecha_evento);
    if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) return null;
    // Backfill incoherente: el siguiente quedo con fecha anterior.
    if (hasta.getTime() < desde.getTime()) return null;
    return diasEntre(x.ev.fecha_evento, siguienteEv.fecha_evento);"""
new_dias="""      if (esActual && !estado.etapa1Finalizada) return diasEntre(fechaCalculoEvento(x.ev), null);
      // Hueco: el inmediato siguiente no esta registrado.
      return null;
    }
    const desde = new Date(fechaCalculoEvento(x.ev));
    const hasta = new Date(fechaCalculoEvento(siguienteEv));
    if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) return null;
    // Backfill incoherente: el siguiente quedo con fecha anterior.
    if (hasta.getTime() < desde.getTime()) return null;
    return diasEntre(fechaCalculoEvento(x.ev), fechaCalculoEvento(siguienteEv));"""
if old_dias in mod:
    mod=mod.replace(old_dias,new_dias,1)

modal_old="""    const estado = estadoPipeline(orden || {});
    // Advertencia por salto:"""
modal_new="""    const estado = estadoPipeline(orden || {});
    const eventoExistente = estado.porCodigo.get(codigo) || null;
    const fechaDefault = fechaInputEvento(eventoExistente) || hoyBuenosAires();
    // Advertencia por salto:"""
if 'const fechaDefault = fechaInputEvento(eventoExistente) || hoyBuenosAires();' not in mod:
    mod=once(mod,modal_old,modal_new,'modal fecha default')

mod=mod.replace('payload real de coi_confirmar_etapa_circuito_v2','payload real de coi_confirmar_etapa_circuito_v3')

required=[
    'function nombreEtapaPorTipo(etapa,orden)',
    'function hoyBuenosAires()',
    'function etapasEtapa2(orden)',
    "e.codigo === 'finalizada_saldo_remanente'",
    'const fechaDefault = fechaInputEvento(eventoExistente) || hoyBuenosAires();',
    'fechaEventoUI(ev)',
    'ultimaAct ? fechaHora(ultimaAct.ev.fecha_evento)'
]
missing=[x for x in required if x not in mod]
if missing:
    raise SystemExit('faltan guards: '+repr(missing))

html=html[:start]+mod+html[end:]
p.write_text(html,encoding='utf-8')
print('repair aplicado/idempotente')
