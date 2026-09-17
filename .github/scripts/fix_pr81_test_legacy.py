from pathlib import Path

p=Path('tests/check_etapa1_pipeline_contractual.js')
s=p.read_text(encoding='utf-8')
old="""  check(/if \\(hasta\\.getTime\\(\\) < desde\\.getTime\\(\\)\\) return null;/.test(cuerpoDias),
    'un backfill con fecha anterior no puede producir una duracion');"""
new="""  check(/if\\s*\\(hastaDia\\s*<\\s*desdeDia\\)\\s*return null;/.test(cuerpoDias),
    'un backfill con día administrativo anterior no puede producir una duración');"""
if old not in s:
    raise SystemExit('guard legacy de backfill no encontrado exactamente una vez')
if s.count(old) != 1:
    raise SystemExit(f'guard legacy repetido: {s.count(old)}')
p.write_text(s.replace(old,new,1), encoding='utf-8')

spec=Path('tests/etapa1_ficha_integracion.spec.js')
t=spec.read_text(encoding='utf-8')
repls={
"await abrirPorNavegacion(page,{tipo:'Obra',estado_documental:'PLIEGOS TERMINADO SIN SOLPED',historial:[h1,h2]});":
"await abrirPorNavegacion(page,{tipo:'Obra',estado_coi:'PLIEGOS TERMINADO SIN SOLPED',historial:[h1,h2]});",
"await abrirPorNavegacion(page,{tipo:'Obra',estado_documental:'OBRA/SERVICIO CANCELADA O SUSPENDIDA',historial:[h1,cancel]});":
"await abrirPorNavegacion(page,{tipo:'Obra',estado_coi:'OBRA/SERVICIO CANCELADA O SUSPENDIDA',historial:[h1,cancel]});"
}
for old2,new2 in repls.items():
    if old2 not in t:
        raise SystemExit('fixture esperado no encontrado: '+old2)
    t=t.replace(old2,new2,1)
spec.write_text(t,encoding='utf-8')
