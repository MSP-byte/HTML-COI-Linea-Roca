from pathlib import Path
import re

p=Path('index.html')
s=p.read_text(encoding='utf-8')
old="""  function fechaInputEvento(ev){
    const efectiva=texto(ev&&ev.fecha_efectiva);
    if(/^\\d{4}-\\d{2}-\\d{2}$/.test(efectiva))return efectiva;
    const registrada=texto(ev&&ev.fecha_evento);
    return /^\\d{4}-\\d{2}-\\d{2}/.test(registrada)?registrada.slice(0,10):'';
  }
  function fechaCalculoEvento(ev){
    const f=fechaInputEvento(ev);
    return f ? f+'T12:00:00-03:00' : texto(ev&&ev.fecha_evento);
  }
"""
new="""  function diaBuenosAires(valor){
    const raw=texto(valor);
    if(!raw)return '';
    if(/^\\d{4}-\\d{2}-\\d{2}$/.test(raw))return raw;
    try{
      const d=new Date(raw); if(isNaN(d.getTime()))return '';
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
      const get=(k)=>parts.find((part)=>part.type===k)?.value||'';
      return get('year')+'-'+get('month')+'-'+get('day');
    }catch(e){return '';}
  }
  function fechaInputEvento(ev){
    const efectiva=texto(ev&&ev.fecha_efectiva);
    if(/^\\d{4}-\\d{2}-\\d{2}$/.test(efectiva))return efectiva;
    return diaBuenosAires(ev&&ev.fecha_evento);
  }
  function fechaCalculoEvento(ev){
    const efectiva=texto(ev&&ev.fecha_efectiva);
    if(/^\\d{4}-\\d{2}-\\d{2}$/.test(efectiva))return efectiva;
    return texto(ev&&ev.fecha_evento);
  }
  function ordinalDiaBuenosAires(valor){
    const raw=texto(valor);
    const dia=/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)?raw:diaBuenosAires(raw);
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(dia))return null;
    const a=dia.split('-').map(Number);
    return Math.floor(Date.UTC(a[0],a[1]-1,a[2])/MS_DIA);
  }
"""
if old not in s:
    raise SystemExit('bloque fechaInputEvento no encontrado')
s=s.replace(old,new,1)

pat=r"  function diasEntre\(desde, hasta\) \{\n    const a = desde \? new Date\(desde\) : null;\n    const b = hasta \? new Date\(hasta\) : new Date\(\);\n    if \(!a \|\| isNaN\(a\.getTime\(\)\) \|\| !b \|\| isNaN\(b\.getTime\(\)\)\) return null;\n    const dias = Math\.floor\(\(b\.getTime\(\) - a\.getTime\(\)\) / MS_DIA\);\n    return dias < 0 \? null : dias;\n  \}"
repl="""  function diasEntre(desde, hasta) {
    const a=ordinalDiaBuenosAires(desde);
    const b=ordinalDiaBuenosAires(hasta||hoyBuenosAires());
    if(a==null||b==null)return null;
    const dias=b-a;
    return dias<0?null:dias;
  }"""
s,n=re.subn(pat,repl,s,count=1)
if n!=1:
    raise SystemExit(f'diasEntre reemplazos={n}')

old2="const dias = ult && !estado.etapa1Finalizada ? diasEntre(ult.ev.fecha_evento, null) : null;"
if old2 not in s:
    raise SystemExit('resumen dias no encontrado')
s=s.replace(old2,"const dias = ult && !estado.etapa1Finalizada ? diasDeHito(estado, ult) : null;",1)

old3="""    const eventoExistente = estado.porCodigo.get(codigo) || null;
    const fechaDefault = fechaInputEvento(eventoExistente) || hoyBuenosAires();"""
new3="""    const eventoExistente = estado.porCodigo.get(codigo) || null;
    const confirmacionVigente = Boolean(eventoExistente && (
      (estado.etapaVigente && estado.etapaVigente.codigo===codigo) ||
      (estado.hitoActual && estado.hitoActual.etapa.codigo===codigo && !estado.etapa1Finalizada)
    ));
    const fechaDefault = confirmacionVigente ? (fechaInputEvento(eventoExistente) || hoyBuenosAires()) : hoyBuenosAires();"""
if old3 not in s:
    raise SystemExit('fechaDefault modal no encontrado')
s=s.replace(old3,new3,1)
p.write_text(s,encoding='utf-8')

pkg=Path('package.json')
ps=pkg.read_text(encoding='utf-8')
if 'check_etapa1_fecha_rpc_v3_hardening.js' not in ps:
    needle='node tests/check_etapa1_tipo_fecha_efectiva.js &&'
    if needle not in ps:
        raise SystemExit('needle package no encontrado')
    ps=ps.replace(needle,needle+' node tests/check_etapa1_fecha_rpc_v3_hardening.js &&',1)
    pkg.write_text(ps,encoding='utf-8')

tp=Path('tests/etapa1_ficha_integracion.spec.js')
ts=tp.read_text(encoding='utf-8')
if 'E1F-23 · legacy UTC usa día administrativo Buenos Aires' not in ts:
    ts += r'''

test('E1F-23 · legacy UTC usa día administrativo Buenos Aires', async ({ page }) => {
  await abrirPorNavegacion(page,{tipo:'Obra',historial:[EVENTO('pliegos_preparacion','2026-09-17T01:00:00Z')]});
  await expect(page.locator(PANEL+' [data-etapa1-hito="pliegos_preparacion"] .etapa1-meta')).toContainText('16/09/2026');
});

test('E1F-24 · reingreso histórico propone hoy y edición vigente conserva fecha efectiva', async ({ page }) => {
  const h1=EVENTO('pliegos_preparacion','2026-09-10T10:00:00-03:00'); h1.fecha_efectiva='2026-09-10';
  const h2=EVENTO('pliegos_terminado_sin_solped','2026-09-12T10:00:00-03:00'); h2.fecha_efectiva='2026-09-12';
  await abrirPorNavegacion(page,{tipo:'Obra',estado_documental:'PLIEGOS TERMINADO SIN SOLPED',historial:[h1,h2]});
  const hoy=await page.evaluate(()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const g=k=>p.find(x=>x.type===k).value;return g('year')+'-'+g('month')+'-'+g('day')});
  await page.click(PANEL+' [data-etapa1-hito="pliegos_preparacion"]');
  await expect(page.locator('#etapa1ModalFecha')).toHaveValue(hoy);
  await page.click('#etapa1ModalCancelar');
  await page.click(PANEL+' [data-etapa1-hito="pliegos_terminado_sin_solped"]');
  await expect(page.locator('#etapa1ModalFecha')).toHaveValue('2026-09-12');
});
'''
    tp.write_text(ts,encoding='utf-8')
