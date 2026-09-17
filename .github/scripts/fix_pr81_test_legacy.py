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
