const { test, expect } = require('@playwright/test');

const STORAGE_KEY = 'coi_timeline_events_v1';
const LEGACY_KEY = 'coi_timeline_legacy_pending_v1';
const MIGRATION_KEY = 'coi_timeline_supabase_migrated_v1';

async function openTimelineFixture(page, { role = 'administrador', remoteRows = [] } = {}) {
  await page.route(url => url.hostname !== '127.0.0.1', route => route.abort());
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    Boolean(window.COI_TIMELINE_COI) && Array.isArray(window.coiTimelineEvents)
  );
  // Antes de inyectar el cliente de prueba no se publica ningún dato local.
  expect(await page.evaluate(() => window.coiTimelineEvents.length)).toBe(0);

  await page.evaluate(({ role, remoteRows }) => {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const actorId = '85555555-5555-4555-8555-555555555555';
    const state = {
      rows: clone(remoteRows), operations: [], role, failNextRefresh: false, failNextReplace: false,
      deferNextRefresh: false, resolveNextRefresh: null
    };

    function serverRow(payload, previous = {}) {
      const now = new Date().toISOString();
      const clean = clone(payload);
      delete clean.expected_actualizado_en;
      return {
        ...previous,
        ...clean,
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
          if (state.failNextRefresh) {
            state.failNextRefresh = false;
            return Promise.resolve({ data: null, error: { message: 'fallo de refresco simulado' } });
          }
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
      from: table => queryFor(table),
      rpc: async (name, args = {}) => {
        if (name === 'coi_current_role') return { data: state.role, error: null };
        if (name === 'coi_timeline_list_page') {
          state.operations.push({ action: 'list_page', table: 'coi_timeline_events', cursor: clone(args) });
          if (state.failNextRefresh) {
            state.failNextRefresh = false;
            return { data: null, error: { message: 'fallo de refresco simulado' } };
          }
          const key = row => `${row.fecha || ''}|${String(row.hora || '').slice(0, 8)}|${row.id || ''}`;
          const before = args.p_before_fecha == null ? null : `${args.p_before_fecha}|${String(args.p_before_hora || '').slice(0, 8)}|${args.p_before_id || ''}`;
          const rows = [...state.rows].sort((a, b) => key(b).localeCompare(key(a)));
          const page = rows.filter(row => before == null || key(row) < before).slice(0, args.p_limit || 1000);
          if (state.deferNextRefresh) {
            state.deferNextRefresh = false;
            return await new Promise(resolve => {
              state.resolveNextRefresh = () => {
                state.resolveNextRefresh = null;
                resolve({ data: clone(page), error: null });
              };
            });
          }
          return { data: clone(page), error: null };
        }
        if (name === 'coi_timeline_upsert_events') {
          if (!['administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'].includes(state.role)) {
            return { data: null, error: { code: '42501', message: 'row-level security fixture' } };
          }
          const items = args.p_events || [];
          const stale = items.find(item => {
            const previous = state.rows.find(row => row.id === item.id);
            return previous && (!item.expected_actualizado_en || item.expected_actualizado_en !== previous.actualizado_en);
          });
          if (stale) return { data: null, error: { code: '40001', message: 'COI_TIMELINE_STALE_WRITE' } };
          const saved = items.map(item => {
            const index = state.rows.findIndex(row => row.id === item.id);
            const row = serverRow(item, index >= 0 ? state.rows[index] : {});
            if (index >= 0) state.rows[index] = row;
            else state.rows.push(row);
            return row;
          });
          state.operations.push({ action: 'upsert', table: 'coi_timeline_events', ids: saved.map(row => row.id) });
          return { data: clone(saved), error: null };
        }
        if (name === 'coi_timeline_delete_event') {
          if (!['administrador', 'jefatura'].includes(state.role)) {
            return { data: null, error: { code: '42501', message: 'COI_ROLE_REQUIRED' } };
          }
          const id = args.p_id;
          const previous = state.rows.find(row => row.id === id);
          if (!previous || !args.p_expected_actualizado_en || previous.actualizado_en !== args.p_expected_actualizado_en) {
            return {
              data: null,
              error: { code: '40001', message: 'COI_TIMELINE_STALE_DELETE: El evento fue modificado por otra sesión.' }
            };
          }
          state.rows = state.rows.filter(row => row.id !== id);
          state.operations.push({ action: 'delete', table: 'coi_timeline_events', ids: [id] });
          return { data: clone([previous]), error: null };
        }
        if (name === 'coi_timeline_replace_events') {
          if (!['administrador', 'jefatura'].includes(state.role)) {
            return { data: null, error: { code: '42501', message: 'COI_ROLE_REQUIRED' } };
          }
          if (state.failNextReplace) {
            state.failNextReplace = false;
            return { data: null, error: { code: '40001', message: 'fallo de replace simulado' } };
          }
          const previous = new Map(state.rows.map(row => [row.id, row]));
          state.rows = (args.p_events || []).map(item => {
            const row = serverRow(item, previous.get(item.id) || {});
            if (item.actualizado_en) row.actualizado_en = item.actualizado_en;
            return row;
          });
          state.operations.push({ action: 'replace', table: 'coi_timeline_events', ids: state.rows.map(row => row.id) });
          return { data: clone(state.rows), error: null };
        }
        return { data: null, error: { code: '42883', message: `RPC no simulada: ${name}` } };
      }
    };
    window.__TIMELINE_REMOTE_STATE__ = state;
    window.initSupabase = async () => client;
    window.getSupabaseClient = () => client;
    window.mostrarMensajeCOI = () => {};
    window.confirm = () => true;
    window.__TIMELINE_ALERTS__ = [];
    window.alert = message => window.__TIMELINE_ALERTS__.push(String(message));
  }, { role, remoteRows });

  await page.evaluate(async () => {
    await window.COI_TIMELINE_COI.load({ migrateLegacy: false });
    window.COI_TIMELINE_COI.open();
  });
  await expect(page.locator('#vistaTimelineCOI')).toHaveClass(/\bactive\b/);
  await expect(page.locator('.timeline-persistence')).toContainText('Supabase sincronizado');
}


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
