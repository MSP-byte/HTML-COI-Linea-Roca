from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'tests' / 'check_supabase_runtime.js'
WORKFLOW = ROOT / '.github' / 'workflows' / 'pr45-runtime-fixture.yml'
SELF = Path(__file__).resolve()

text = TARGET.read_text(encoding='utf-8')
old = """    const exactSnapshot = JSON.stringify([\n      { id: 'TL-REPLACE-ONLY', fecha: '2026-08-26', titulo: 'Snapshot exacto', estado: 'Cerrado', riesgo: 'Bajo' }\n    ]);\n    const replaced = await db.query(\n      'select id from public.coi_timeline_replace_events($1::jsonb)',\n      [exactSnapshot]\n    );\n    assert.deepEqual(replaced.rows.map(row => row.id), ['TL-REPLACE-ONLY']);\n    assert.equal((await db.query('select count(*)::int n from public.coi_timeline_events')).rows[0].n, 1);\n"""
new = """    const exactRestoreStamp = '2026-08-26T12:34:56.000Z';\n    const exactSnapshot = JSON.stringify([\n      {\n        id: 'TL-REPLACE-ONLY', fecha: '2026-08-26', titulo: 'Snapshot exacto',\n        estado: 'Cerrado', riesgo: 'Bajo', actualizado_en: exactRestoreStamp\n      }\n    ]);\n    const replaced = await db.query(\n      'select id,actualizado_en from public.coi_timeline_replace_events($1::jsonb)',\n      [exactSnapshot]\n    );\n    assert.deepEqual(replaced.rows.map(row => row.id), ['TL-REPLACE-ONLY']);\n    assert.equal(new Date(replaced.rows[0].actualizado_en).toISOString(), exactRestoreStamp);\n    assert.equal((await db.query('select count(*)::int n from public.coi_timeline_events')).rows[0].n, 1);\n"""
count = text.count(old)
if count != 1:
    raise RuntimeError(f'fixture exactSnapshot: se esperaba 1 coincidencia y se encontraron {count}')
TARGET.write_text(text.replace(old, new, 1), encoding='utf-8')

if WORKFLOW.exists():
    WORKFLOW.unlink()
if SELF.exists():
    SELF.unlink()

print('Runtime fixture PR45 actualizado y tooling temporal retirado.')
