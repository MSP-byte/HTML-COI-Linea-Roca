const { test, expect } = require('@playwright/test');

const STORAGE_KEY = 'coi_timeline_events_v1';
const MIGRATION_KEY = 'coi_timeline_supabase_migrated_v1';

async function openTimelineFixture(page) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(({ storageKey }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(storageKey, JSON.stringify([{
      id: 'TL-LEGACY-BROWSER-1',
      fecha: '2026-08-25',
      hora: '08:30',
      semana: '2026-W35',
      titulo: 'Mailing local pendiente de migración',
      tipo_evento: 'Mailing',
      origen: 'Mailing',
      remitente: 'proveedor@example.test',
      destinatarios: 'coi@example.test',
      estado: 'Informativo',
      riesgo: 'Bajo',
      creado_por: 'Usuario anterior'
    }, {
      id: 'TL-DEMO-NO-MIGRAR',
      fecha: '2026-08-24',
      titulo: 'Dato demostrativo que no debe migrarse',
      tipo_evento: 'Mailing'
    }]));
  }, { storageKey: STORAGE_KEY });

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    Boolean(window.COI_TIMELINE_COI) &&
    Array.isArray(window.coiTimelineEvents) &&
    window.coiTimelineEvents.some(event => event.id === 'TL-LEGACY-BROWSER-1')
  );

  await page.evaluate(() => {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const actorId = '85555555-5555-4555-8555-555555555555';
    const state = { rows: [], operations: [] };

    function serverRow(payload, previous = {}) {
      const now = new Date().toISOString();
      return {
        ...previous,
        ...clone(payload),
        created_by: previous.created_by || actorId,
        updated_by: actorId,
        creado_en: previous.creado_en || now,
        actualizado_en: now
      };
    }

    function queryFor(table) {
      let action = 'select';
      let payload = null;
      const filters = [];
      const matchingRows = () => state.rows.filter(row =>
        filters.every(({ field, value }) => String(row?.[field] ?? '') === String(value ?? ''))
      );
      const query = {
        upsert(value) {
          action = 'upsert';
          payload = Array.isArray(value) ? value : [value];
          return query;
        },
        delete() {
          action = 'delete';
          return query;
        },
        eq(field, value) {
          filters.push({ field, value });
          return query;
        },
        order() { return query; },
        range(from, to) {
          state.operations.push({ action: 'select', table, from, to });
          return Promise.resolve({ data: clone(matchingRows().slice(from, to + 1)), error: null });
        },
        select() {
          if (action === 'upsert') {
            const saved = payload.map(item => {
              const index = state.rows.findIndex(row => row.id === item.id);
              const row = serverRow(item, index >= 0 ? state.rows[index] : {});
              if (index >= 0) state.rows[index] = row;
              else state.rows.push(row);
              return row;
            });
            state.operations.push({ action: 'upsert', table, ids: saved.map(row => row.id) });
            return Promise.resolve({ data: clone(saved), error: null });
          }
          if (action === 'delete') {
            const deleted = matchingRows();
            const deletedIds = new Set(deleted.map(row => row.id));
            state.rows = state.rows.filter(row => !deletedIds.has(row.id));
            state.operations.push({ action: 'delete', table, ids: [...deletedIds] });
            return Promise.resolve({ data: clone(deleted.map(row => ({ id: row.id }))), error: null });
          }
          return query;
        }
      };
      return query;
    }

    const client = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: actorId, email: 'admin.timeline@coiroca.test' } } },
          error: null
        })
      },
      from: table => queryFor(table)
    };
    window.__TIMELINE_REMOTE_STATE__ = state;
    window.initSupabase = async () => client;
    window.getSupabaseClient = () => client;
    window.mostrarMensajeCOI = () => {};
    window.confirm = () => true;
  });

  await page.evaluate(async () => {
    await window.COI_TIMELINE_COI.reload();
    window.COI_TIMELINE_COI.open();
  });
  await expect(page.locator('#vistaTimelineCOI')).toHaveClass(/\bactive\b/);
  await expect(page.locator('.timeline-persistence')).toContainText('Supabase sincronizado');
}

test('migra localStorage una vez y hace CRUD de Mailing con Supabase como autoridad', async ({ page }) => {
  await openTimelineFixture(page);

  const results = page.locator('.timeline-result');
  await expect(results.getByRole('heading', { name: 'Mailing local pendiente de migración', exact: true })).toBeVisible();
  await expect(results.getByRole('heading', { name: 'Dato demostrativo que no debe migrarse', exact: true })).toHaveCount(0);
  expect(await page.evaluate(migrationKey => Boolean(localStorage.getItem(migrationKey)), MIGRATION_KEY)).toBe(true);
  expect(await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.rows.map(row => row.id))).toEqual([
    'TL-LEGACY-BROWSER-1'
  ]);

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

  await page.evaluate(async storageKey => {
    localStorage.removeItem(storageKey);
    window.coiTimelineEvents = [];
    await window.COI_TIMELINE_COI.reload();
  }, STORAGE_KEY);
  await expect(results.getByRole('heading', { name: 'Mailing persistido en Supabase', exact: true })).toBeVisible();

  const card = page.locator('.timeline-event-card').filter({ hasText: 'Mailing persistido en Supabase' });
  await card.getByRole('button', { name: 'Eliminar' }).click();
  await expect(results.getByRole('heading', { name: 'Mailing persistido en Supabase', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.rows.some(row => row.titulo === 'Mailing persistido en Supabase'))).toBe(false);

  const actions = await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.operations.map(item => item.action));
  expect(actions).toContain('upsert');
  expect(actions).toContain('delete');
});
