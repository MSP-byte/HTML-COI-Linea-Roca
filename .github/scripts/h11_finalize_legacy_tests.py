from pathlib import Path
import re

# H07 tests that asserted the retired browser-persistence bridge itself.
# H11 removes that bridge completely; their safety intent is now covered by
# h06_localstorage_non_authoritative.spec.js and h11_online_only.spec.js.
retired_h07 = {
    1, 3, 7, 8, 9, 10, 13, 15, 16, 17, 18, 19, 20, 23, 25, 26,
    27, 28, 29, 30, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 47, 49,
}

h07_path = Path('tests/h07_cierre_localstorage.spec.js')
h07 = h07_path.read_text(encoding='utf-8')
marker = """// H11 FINAL: las pruebas marcadas como RETIRADO H11 verificaban la compatibilidad\n// del puente localStorage (cuarentena, exportación, marcadores y restore local).\n// Ese puente ya no existe por diseño: localStorage es residuo opaco y Supabase es\n// la única autoridad operativa. La invariancia actual está cubierta por H06/H11.\n"""
if marker not in h07:
    h07 = h07.replace("const { test, expect } = require('@playwright/test');\n", "const { test, expect } = require('@playwright/test');\n\n" + marker, 1)

pattern = re.compile(r"(?m)^test\((['\"])H07-(\d+)\s")
seen = set()

def retire(match):
    num = int(match.group(2))
    if num not in retired_h07:
        return match.group(0)
    seen.add(num)
    return f"test.skip({match.group(1)}H07-{num} [RETIRADO H11] · "

h07 = pattern.sub(retire, h07)
missing = retired_h07 - seen
if missing:
    raise SystemExit(f'H07 IDs no encontrados: {sorted(missing)}')
h07_path.write_text(h07, encoding='utf-8')

# Timeline: retire the one-time localStorage migration contract. Keep the same
# Supabase fixture and assert only the H11 online-only behavior.
t_path = Path('tests/timeline_supabase_first.spec.js')
t = t_path.read_text(encoding='utf-8')

t = re.sub(
    r"  await page\.addInitScript\(\(\{ storageKey \}\) => \{.*?\n  \}, \{ storageKey: STORAGE_KEY \}\);",
    "  await page.addInitScript(() => {\n    localStorage.clear();\n    sessionStorage.clear();\n  });",
    t,
    count=1,
    flags=re.S,
)

t = re.sub(
    r"  await page\.waitForFunction\(\(legacyKey\) =>.*?\n  expect\(await page\.evaluate\(\(\) => window\.coiTimelineEvents\.length\)\)\.toBe\(0\);",
    "  await page.waitForFunction(() =>\n    Boolean(window.COI_TIMELINE_COI) && Array.isArray(window.coiTimelineEvents)\n  );\n  // Antes de inyectar el cliente de prueba no se publica ningún dato local.\n  expect(await page.evaluate(() => window.coiTimelineEvents.length)).toBe(0);",
    t,
    count=1,
    flags=re.S,
)

t = t.replace("await window.COI_TIMELINE_COI.load({ migrateLegacy: true });", "await window.COI_TIMELINE_COI.load({ migrateLegacy: false });", 1)

first_test = t.find("\ntest('migra localStorage")
if first_test < 0:
    raise SystemExit('No se encontró el bloque legacy de Timeline')
prefix = t[:first_test]

new_tests = r'''

test('H11 Timeline · Supabase es autoridad y Mailing CRUD persiste remoto', async ({ page }) => {
  await openTimelineFixture(page);

  const results = page.locator('.timeline-result');
  await expect(results.getByRole('heading', { name: 'Mailing local pendiente de migración', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Nueva carga manual' }).click();
  await page.locator('[data-timeline-field="fecha"]').fill('2026-08-26');
  await page.locator('[data-timeline-field="titulo"]').fill('Mailing persistido en Supabase');
  await page.locator('[data-timeline-field="remitente"]').fill('contratista@example.test');
  await page.locator('[data-timeline-field="destinatarios"]').fill('equipo-coi@example.test');
  await page.locator('[data-timeline-field="descripcion"]').fill('Seguimiento operativo compartido.');
  await page.getByRole('button', { name: 'Guardar evento' }).click();

  await expect(results.getByRole('heading', { name: 'Mailing persistido en Supabase', exact: true })).toBeVisible();
  const created = await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.rows.find(row => row.titulo === 'Mailing persistido en Supabase'));
  expect(created).toMatchObject({
    remitente: 'contratista@example.test',
    destinatarios: 'equipo-coi@example.test',
    tipo_evento: 'Mailing',
    origen: 'Mailing'
  });
  expect(created.created_by).toBeTruthy();

  // Vaciar la memoria de la pestaña y recargar debe reconstruir desde Supabase.
  await page.evaluate(async () => {
    window.coiTimelineEvents = [];
    await window.COI_TIMELINE_COI.reload();
  });
  await expect(results.getByRole('heading', { name: 'Mailing persistido en Supabase', exact: true })).toBeVisible();

  const card = page.locator('.timeline-event-card').filter({ hasText: 'Mailing persistido en Supabase' });
  await card.getByRole('button', { name: 'Eliminar' }).click();
  await expect(results.getByRole('heading', { name: 'Mailing persistido en Supabase', exact: true })).toHaveCount(0);
  expect(await page.evaluate(id => window.__TIMELINE_REMOTE_STATE__.rows.some(row => row.id === id), created.id)).toBe(false);

  const actions = await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.operations.map(item => item.action));
  expect(actions).toContain('upsert');
  expect(actions).toContain('delete');
});

test('H11 Timeline · rol consulta conserva lectura Supabase y oculta mutaciones', async ({ page }) => {
  await openTimelineFixture(page, {
    role: 'consulta',
    remoteRows: [{
      id: 'TL-REMOTE-CANONICAL-1',
      fecha: '2026-08-25',
      hora: '10:00:00',
      semana: '2026-W35',
      titulo: 'Mailing canónico de Supabase',
      tipo_evento: 'Mailing',
      origen: 'Mailing',
      estado: 'Informativo',
      riesgo: 'Bajo'
    }]
  });

  const results = page.locator('.timeline-result');
  await expect(results.getByRole('heading', { name: 'Mailing canónico de Supabase', exact: true })).toBeVisible();
  const view = page.locator('#vistaTimelineCOI');
  await expect(view.getByRole('button', { name: 'Nueva carga manual' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Importar JSON' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
  await expect(view.getByText('acceso de solo lectura', { exact: false })).toBeVisible();

  const mutaciones = await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.operations.filter(item => ['upsert', 'delete', 'replace'].includes(item.action)));
  expect(mutaciones).toEqual([]);
});

test('H11 Timeline · replace es remoto y un fallo no deja estado local falso', async ({ page }) => {
  await openTimelineFixture(page, {
    remoteRows: [{
      id: 'TL-REMOTE-ANTERIOR', fecha: '2026-08-25', hora: '10:00:00',
      titulo: 'Evento remoto anterior', tipo_evento: 'Mailing', origen: 'Mailing',
      estado: 'Informativo', riesgo: 'Bajo'
    }]
  });

  await page.evaluate(async () => {
    const template = { ...window.coiTimelineEvents[0] };
    window.__TIMELINE_EXACT_TEMPLATE__ = template;
    await window.COI_TIMELINE_COI.replace([{
      ...template,
      id: 'TL-SNAPSHOT-UNICO', fecha: '2026-08-26', hora: '09:00', semana: '2026-W35',
      titulo: 'Snapshot único', tipo_evento: 'Mailing', origen: 'Mailing',
      estado: 'Cerrado', riesgo: 'Bajo'
    }]);
  });
  expect(await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.rows.map(row => row.id))).toEqual(['TL-SNAPSHOT-UNICO']);

  await page.evaluate(async () => window.COI_TIMELINE_COI.replace([]));
  expect(await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.rows)).toEqual([]);
  expect(await page.evaluate(() => window.coiTimelineEvents)).toEqual([]);

  const outcome = await page.evaluate(async () => {
    window.__TIMELINE_REMOTE_STATE__.failNextReplace = true;
    let error = '';
    try {
      await window.COI_TIMELINE_COI.replace([{
        ...window.__TIMELINE_EXACT_TEMPLATE__,
        id: 'TL-NO-DEBE-QUEDAR', fecha: '2026-08-27', hora: '09:00', semana: '2026-W35',
        titulo: 'No persistir', tipo_evento: 'Mailing', origen: 'Mailing',
        estado: 'Informativo', riesgo: 'Bajo'
      }]);
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    return {
      error,
      remoteIds: window.__TIMELINE_REMOTE_STATE__.rows.map(row => row.id),
      runtimeIds: window.coiTimelineEvents.map(row => row.id)
    };
  });
  expect(outcome.remoteIds).toEqual([]);
  expect(outcome.runtimeIds).toEqual([]);
});
'''

t_path.write_text(prefix + new_tests, encoding='utf-8')

print(f'H07 retired tests: {len(seen)}; Timeline rewritten for H11 online-only')
