from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')

def replace_once(old,new,label):
    global s
    count=s.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected exactly 1 occurrence, found {count}')
    s=s.replace(old,new,1)

# Orders: remove UI-only filters requested by the user.
replace_once(
    '<div class="ordenes-filtro-group"><label for="ordenesFiltroEstado">Estado COI</label><select id="ordenesFiltroEstado"><option value="">Todos los estados</option></select></div>',
    '',
    'remove orders Estado COI filter'
)
replace_once(
    '<div class="ordenes-filtro-group"><label for="ordenesFiltroDoc">Estado documental</label><select id="ordenesFiltroDoc"><option value="">Todos los estados</option></select></div>',
    '',
    'remove orders Estado documental filter'
)
replace_once(
    '<label for="ordenesFiltroMesVenc">Orden vencimiento</label>',
    '<label for="ordenesFiltroMesVenc">Orden de vencimiento</label>',
    'rename expiry order label'
)

# Do not overwrite the semantic expiry-order options with month values.
replace_once(
    "  setOptions('ordenesFiltroMesVenc',rows.map(r=>valorMesOrdenes(r.calc.venc)).filter(Boolean),'Todos los meses');",
    "  if(typeof asegurarSelectorOrdenVencimiento==='function') asegurarSelectorOrdenVencimiento();",
    'preserve expiry order selector options'
)

# Inicio operativo: remove Period and Branch controls from the V33 dashboard skeleton.
period_html='<div class="d33-field"><label for="d33Period">Período</label><select id="d33Period"><option value="today">Hoy</option><option value="30">Próximos 30 días</option><option value="60">Próximos 60 días</option><option value="90">Próximos 90 días</option><option value="180">Próximos 180 días</option><option value="year">Año actual</option><option value="all">Todo</option></select></div>'
branch_html='<div class="d33-field"><label for="d33Branch">Ramal</label><select id="d33Branch"></select></div>'
replace_once(period_html,'','remove dashboard Period filter')
replace_once(branch_html,'','remove dashboard Branch filter')

replace_once(
    "    $('d33Period').value=state.filters.period;\n",
    '',
    'remove dashboard Period renderer'
)
replace_once(
    "    fillSelect('d33Branch',unique(records.flatMap(r=>[...r.branches])).sort(),'Todos los ramales',state.filters.branch);\n",
    '',
    'remove dashboard Branch renderer'
)
replace_once(
    "const map={d33Period:'period',d33Type:'type',d33Branch:'branch',d33Provider:'provider',d33Station:'station',d33Status:'status'};",
    "const map={d33Type:'type',d33Provider:'provider',d33Station:'station',d33Status:'status'};",
    'remove dashboard Period/Branch listeners'
)

# Avoid hidden persisted filters after controls are removed. Keep the business horizon fixed at the former default: 30 days.
replace_once(
    "      setVersion();if(!$('dashboardInteractivoMount'))return;if(!$('d33Filters'))skeleton();",
    "      setVersion();if(!$('dashboardInteractivoMount'))return;if(!$('d33Filters'))skeleton();state.filters.period='30';state.filters.branch='';",
    'neutralize removed dashboard filters'
)

p.write_text(s,encoding='utf-8',newline='')
