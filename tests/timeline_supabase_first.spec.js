const { test, expect } = require('@playwright/test');

const STORAGE_KEY = 'coi_timeline_events_v1';
const LEGACY_KEY = 'coi_timeline_legacy_pending_v1';
const MIGRATION_KEY = 'coi_timeline_supabase_migrated_v1';

async function openTimelineFixture(page, { role = 'administrador', remoteRows = [] } = {}) {
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
        if (name === 'coi_timeline_replace_events') {
          if (!['administrador', 'jefatura'].includes(state.role)) {
            return { data: null, error: { code: '42501', message: 'COI_ROLE_REQUIRED' } };
          }
          if (state.failNextReplace) {
            state.failNextReplace = false;
            return { data: null, error: { code: '40001', message: 'fallo de replace simulado' } };
          }
          const previous = new Map(state.rows.map(row => [row.id, row]));
          state.rows = (args.p_events || []).map(item => serverRow(item, previous.get(item.id) || {}));
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
    await window.COI_TIMELINE_COI.load({ migrateLegacy: true });
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

  const upsertsBeforeRefresh = await page.evaluate(() =>
    window.__TIMELINE_REMOTE_STATE__.operations.filter(item => item.action === 'upsert').length
  );
  await page.evaluate(async () => {
    window.__TIMELINE_REMOTE_STATE__.rows = window.__TIMELINE_REMOTE_STATE__.rows.filter(row => row.id !== 'TL-LEGACY-BROWSER-1');
    await window.COI_TIMELINE_COI.reload();
  });
  await expect(results.getByRole('heading', { name: 'Mailing local pendiente de migración', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() =>
    window.__TIMELINE_REMOTE_STATE__.operations.filter(item => item.action === 'upsert').length
  )).toBe(upsertsBeforeRefresh);

  await page.getByRole('button', { name: 'Nueva carga manual' }).click();
  await page.locator('[data-timeline-field="fecha"]').fill('2026-08-26');
  await page.locator('[data-timeline-field="titulo"]').fill('Mailing persistido en Supabase');
  await page.locator('[data-timeline-field="remitente"]').fill('contratista@example.test');
  await page.locator('[data-timeline-field="destinatarios"]').fill('equipo-coi@example.test');
  await page.locator('[data-timeline-field="descripcion"]').fill('Seguimiento operativo compartido.');
  await page.evaluate(() => { window.__TIMELINE_REMOTE_STATE__.failNextRefresh = true; });
  await page.getByRole('button', { name: 'Guardar evento' }).click();

  await expect(results.getByRole('heading', { name: 'Mailing persistido en Supabase', exact: true })).toBeVisible();
  await expect(page.locator('.timeline-persistence')).toContainText('Supabase sincronizado con advertencia');
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
  await page.evaluate(id => {
    const row = window.__TIMELINE_REMOTE_STATE__.rows.find(item => item.id === id);
    row.titulo = 'Mailing editado por otra sesión';
    row.actualizado_en = '2099-01-01T00:00:00.000Z';
  }, created.id);
  await card.getByRole('button', { name: 'Eliminar' }).click();
  expect(await page.evaluate(id => window.__TIMELINE_REMOTE_STATE__.rows.some(row => row.id === id), created.id)).toBe(true);
  expect(await page.evaluate(() => window.__TIMELINE_ALERTS__.at(-1))).toMatch(/modificado por otra sesión/i);

  await page.evaluate(async () => window.COI_TIMELINE_COI.reload());
  const refreshedCard = page.locator('.timeline-event-card').filter({ hasText: 'Mailing editado por otra sesión' });
  await expect(refreshedCard).toBeVisible();
  await refreshedCard.getByRole('button', { name: 'Eliminar' }).click();
  await expect(results.getByRole('heading', { name: 'Mailing persistido en Supabase', exact: true })).toHaveCount(0);
  expect(await page.evaluate(id => window.__TIMELINE_REMOTE_STATE__.rows.some(row => row.id === id), created.id)).toBe(false);

  const actions = await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.operations.map(item => item.action));
  expect(actions).toContain('upsert');
  expect(actions).toContain('delete');
});

test('rol de lectura conserva Supabase si la migración local es denegada y oculta mutaciones', async ({ page }) => {
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
  await expect(results.getByRole('heading', { name: 'Mailing local pendiente de migración', exact: true })).toHaveCount(0);
  await expect(page.locator('.timeline-persistence')).toContainText(/migración pendiente/i);
  const view = page.locator('#vistaTimelineCOI');
  await expect(view.getByRole('button', { name: 'Nueva carga manual' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Importar JSON' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
  await expect(view.getByText('acceso de solo lectura', { exact: false })).toBeVisible();

  expect(await page.evaluate(legacyKey => Boolean(localStorage.getItem(legacyKey)), LEGACY_KEY)).toBe(true);
  await page.evaluate(() => {
    window.__TIMELINE_REMOTE_STATE__.deferNextRefresh = true;
    window.__PENDING_TIMELINE_LOAD__ = window.COI_TIMELINE_COI.reload();
  });
  await page.waitForFunction(() => typeof window.__TIMELINE_REMOTE_STATE__.resolveNextRefresh === 'function');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('coi:supabase-auth', { detail: { event: 'SIGNED_OUT' } }));
    window.__TIMELINE_REMOTE_STATE__.resolveNextRefresh();
  });
  await page.evaluate(async () => window.__PENDING_TIMELINE_LOAD__);
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), STORAGE_KEY)).toBeNull();
  expect(await page.evaluate(legacyKey => Boolean(localStorage.getItem(legacyKey)), LEGACY_KEY)).toBe(true);
  await expect(results.getByRole('heading', { name: 'Mailing canónico de Supabase', exact: true })).toHaveCount(0);
});

test('restore reemplaza exactamente Supabase y revierte todas las claves locales si falla', async ({ page }) => {
  await openTimelineFixture(page, {
    remoteRows: [{
      id: 'TL-REMOTE-ANTERIOR', fecha: '2026-08-25', hora: '10:00:00',
      titulo: 'Evento remoto anterior', tipo_evento: 'Mailing', origen: 'Mailing',
      estado: 'Informativo', riesgo: 'Bajo'
    }]
  });

  await page.evaluate(async () => {
    await window.COI_TIMELINE_COI.replace([{
      id: 'TL-SNAPSHOT-UNICO', fecha: '2026-08-26', hora: '09:00',
      titulo: 'Snapshot único', tipo_evento: 'Mailing', origen: 'Mailing',
      estado: 'Cerrado', riesgo: 'Bajo'
    }]);
  });
  expect(await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.rows.map(row => row.id))).toEqual(['TL-SNAPSHOT-UNICO']);

  await page.evaluate(async () => window.COI_TIMELINE_COI.replace([]));
  expect(await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.rows)).toEqual([]);

  const committedWithMarkerFailure = await page.evaluate(async ({ storageKey, migrationKey }) => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === migrationKey) throw new DOMException('cuota simulada', 'QuotaExceededError');
      return originalSetItem.call(this, key, value);
    };
    try {
      await window.adminApplyLocalStorageSnapshot({
        [storageKey]: JSON.stringify([{
          id: 'TL-RESTORE-COMMITTED', fecha: '2026-08-27', titulo: 'Restore confirmado',
          tipo_evento: 'Mailing', estado: 'Informativo', riesgo: 'Bajo'
        }])
      }, { tipo: 'test cuota', archivo: 'quota.json' });
      return window.__TIMELINE_REMOTE_STATE__.rows.map(row => row.id);
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
  }, { storageKey: STORAGE_KEY, migrationKey: MIGRATION_KEY });
  expect(committedWithMarkerFailure).toEqual(['TL-RESTORE-COMMITTED']);
  await expect(page.locator('.timeline-persistence')).toContainText(/restauración.*marcador local/i);
  await page.evaluate(async () => window.COI_TIMELINE_COI.replace([]));

  const rollback = await page.evaluate(async ({ storageKey }) => {
    localStorage.setItem('coi_test_rollback', 'antes');
    window.__TIMELINE_REMOTE_STATE__.failNextReplace = true;
    let error = '';
    try {
      await window.adminApplyLocalStorageSnapshot({
        coi_test_rollback: 'después',
        [storageKey]: JSON.stringify([{
          id: 'TL-NO-DEBE-QUEDAR', fecha: '2026-08-27', titulo: 'No persistir',
          tipo_evento: 'Mailing', estado: 'Informativo', riesgo: 'Bajo'
        }])
      }, { tipo: 'test', archivo: 'fixture.json' });
    } catch (caught) {
      error = caught?.message || String(caught);
    }
    return { value: localStorage.getItem('coi_test_rollback'), error };
  }, { storageKey: STORAGE_KEY });
  expect(rollback.value).toBe('antes');
  expect(rollback.error).toMatch(/restauración integral/i);
  expect(await page.evaluate(() => window.__TIMELINE_REMOTE_STATE__.rows)).toEqual([]);
});
