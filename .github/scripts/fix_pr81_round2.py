from pathlib import Path


def replace_once(text, old, new, label):
    n=text.count(old)
    if n!=1:
        raise SystemExit(f'{label}: esperado 1 match, encontrados {n}')
    return text.replace(old,new,1)

# 1) Frontend: al editar la etapa vigente, usar la ULTIMA confirmación de ese
# código. porCodigo conserva a propósito la primera para la cronología X/8.
p=Path('index.html')
html=p.read_text(encoding='utf-8')
old="""    const eventoExistente = estado.porCodigo.get(codigo) || null;
    const etapaCanonica=estado.etapaVigente||null;
    const confirmacionVigente = Boolean(eventoExistente && (
      (etapaCanonica && etapaCanonica.codigo===codigo) ||
      (!etapaCanonica && estado.hitoActual && estado.hitoActual.etapa.codigo===codigo && !estado.etapa1Finalizada)
    ));
    const fechaDefault = confirmacionVigente ? (fechaInputEvento(eventoExistente) || hoyBuenosAires()) : hoyBuenosAires();"""
new="""    const eventoExistente = estado.porCodigo.get(codigo) || null;
    const etapaCanonica=estado.etapaVigente||null;
    const confirmacionVigente = Boolean(eventoExistente && (
      (etapaCanonica && etapaCanonica.codigo===codigo) ||
      (!etapaCanonica && estado.hitoActual && estado.hitoActual.etapa.codigo===codigo && !estado.etapa1Finalizada)
    ));
    // porCodigo conserva la PRIMERA confirmación para la cronología del hito.
    // Si la etapa fue recorrida, dejada y luego reingresada, la edición vigente
    // debe cargar la ÚLTIMA confirmación, que es la misma fila que v3 actualiza.
    const eventoVigente=confirmacionVigente
      ? (estado.historial||[]).filter((ev)=>
          fold(ev&&ev.tipo_evento)===fold('Circuito administrativo') &&
          texto(ev&&ev.campo_modificado)===codigo
        ).slice().sort((a,b)=>{
          const d=new Date(b.fecha_evento||0)-new Date(a.fecha_evento||0);
          return d||texto(b&&b.id).localeCompare(texto(a&&a.id));
        })[0] || eventoExistente
      : eventoExistente;
    const fechaDefault = confirmacionVigente ? (fechaInputEvento(eventoVigente) || hoyBuenosAires()) : hoyBuenosAires();"""
html=replace_once(html,old,new,'modal última reentrada')
p.write_text(html,encoding='utf-8')

# 2) SQL: una grafía legacy reconocida por el frontend también debe clasificar
# como edición idempotente. Normalizamos acentos y º/° en ambos lados.
for name in [
    'supabase/migrations/202609170001_etapa1_fecha_rpc_v3_hardening.sql',
    'supabase/migrations/202609170002_etapa1_rpc_v3_review_fix.sql'
]:
    q=Path(name)
    sql=q.read_text(encoding='utf-8')
    old_sql="  if upper(trim(coalesce(v_current,'')))=upper(trim(v_nombre)) and v_seen then"
    new_sql="""  if translate(upper(trim(coalesce(v_current,''))),'ÁÉÍÓÚÜÑº°','AEIOUUNOO')
     = translate(upper(trim(v_nombre)),'ÁÉÍÓÚÜÑº°','AEIOUUNOO')
     and v_seen then"""
    sql=replace_once(sql,old_sql,new_sql,'normalización estado vigente '+name)
    q.write_text(sql,encoding='utf-8')

# 3) Guardas estáticas de ambos hallazgos.
q=Path('tests/check_etapa1_fecha_rpc_v3_hardening.js')
check=q.read_text(encoding='utf-8')
marker="console.log('Etapa1 fecha/RPC v3 hardening: OK');"
extra="""assert(sql.includes(\"translate(upper(trim(coalesce(v_current,'')))\"),'estado vigente legacy debe normalizarse antes de decidir edición/reingreso');
assert(html.includes('const eventoVigente=confirmacionVigente'),'edición vigente debe resolver la última confirmación del código');
assert(html.includes('fechaInputEvento(eventoVigente)'),'modal vigente debe precargar la fila que v3 realmente edita');
"""
if extra not in check:
    check=check.replace(marker,extra+marker)
q.write_text(check,encoding='utf-8')

# 4) Comportamiento navegador: una etapa reingresada y actualmente vigente
# carga su fecha más reciente, no la primera llegada histórica.
q=Path('tests/etapa1_ficha_integracion.spec.js')
spec=q.read_text(encoding='utf-8')
extra_spec=r'''

test('E1F-27 · edición de reingreso vigente carga la última fecha efectiva', async ({ page }) => {
  const h1=EVENTO('pliegos_preparacion','2026-09-10T10:00:00-03:00'); h1.fecha_efectiva='2026-09-10';
  const h2=EVENTO('pliegos_terminado_sin_solped','2026-09-12T10:00:00-03:00'); h2.fecha_efectiva='2026-09-12';
  const h1r=EVENTO('pliegos_preparacion','2026-09-14T10:00:00-03:00'); h1r.fecha_efectiva='2026-09-14'; h1r.id='ev-reingreso-h1';
  await abrirPorNavegacion(page,{tipo:'Obra',estado_coi:'PLIEGOS EN PREPARACIÓN',historial:[h1,h2,h1r]});
  await page.click(PANEL+' [data-etapa1-hito="pliegos_preparacion"]');
  await expect(page.locator('#etapa1ModalFecha')).toHaveValue('2026-09-14');
});
'''
if 'E1F-27 · edición de reingreso vigente carga la última fecha efectiva' not in spec:
    spec += extra_spec
q.write_text(spec,encoding='utf-8')
