from pathlib import Path

p = Path('index.html')
text = p.read_text(encoding='utf-8')
marker = 'COI-OBRA-RESUMEN-SUPABASE-V1'

old_repo = '''          <div><b>Repositorio documental</b>${coiURLHTTPValida(item.linkOneDrive)?'<a href="'+esc(item.linkOneDrive)+'" target="_blank" rel="noopener noreferrer">Abrir OneDrive</a>':'—'}</div>'''
new_repo = '''          <div><b>Repositorio documental</b><span data-coi-repo-supabase>Supabase Storage</span></div>'''
if old_repo in text:
    text = text.replace(old_repo, new_repo, 1)

text = text.replace(
    'Carpetas OneDrive y documentos vinculados a la OC ${esc(nro(o))}.',
    'Vínculos documentales registrados en Supabase para la OC ${esc(nro(o))}.'
)

if marker not in text:
    patch = Path('.coi-qa/obra_summary_patch.html').read_text(encoding='utf-8')
    pos = text.lower().rfind('</body>')
    if pos < 0:
        raise SystemExit('No se encontro </body> en index.html')
    text = text[:pos] + '\n' + patch + '\n' + text[pos:]

p.write_text(text, encoding='utf-8')
print('Hotfix Obras/Supabase aplicado.')
