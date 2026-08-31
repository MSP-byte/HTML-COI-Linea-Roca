const { chromium } = require(process.env.COI_PLAYWRIGHT_MODULE || 'playwright');

const baseUrl = process.env.COI_TEST_URL || 'http://127.0.0.1:4173/';
const scenarios = [
  { name: 'clean-incognito', storage: {} },
  { name: 'persistent-empty', storage: {}, persistent: true },
  { name: 'persistent-old-mode', persistent: true, storage: {
    coi_modo: 'admin', rolActivo: 'Administrador', coi_rol_usuario: 'administrador',
    coi_modo_usuario: 'admin', coi_admin_role: 'admin'
  } },
  { name: 'persistent-invalid-view', persistent: true, storage: {
    coi_active_view: 'vistaInexistente', activeView: 'vistaInexistente',
    modoAdministradorActivo: 'true', sesionAdminActiva: 'true'
  } },
  { name: 'restored-session', persistent: true, session: true, storage: {
    coi_modo: 'consulta', coi_rol_usuario: 'visualizador'
  } },
];

function mockSupabaseScript() {
  return `(() => {
    const session = window.__COI_TEST_SESSION__ ? { user: { id: 'fixture-user', email: 'fixture@example.test' }, access_token: 'redacted-test-token' } : null;
    const result = (data = []) => Promise.resolve({ data, error: null });
    const chain = new Proxy({}, { get(_t, prop) {
      if (prop === 'then') return (resolve) => result([]).then(resolve);
      if (prop === 'single' || prop === 'maybeSingle') return () => result(null);
      return () => chain;
    }});
    const client = {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        getUser: async () => ({ data: { user: session?.user || null }, error: null }),
        onAuthStateChange: (cb) => { setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithPassword: async () => ({ data: { session }, error: null }),
        signOut: async () => ({ error: null })
      },
      from: () => chain,
      storage: { from: () => ({ createSignedUrl: async (path) => ({ data: { signedUrl: 'data:application/pdf;base64,JVBERi0xLjQK' }, error: path ? null : new Error('missing path') }) }) }
    };
    window.supabase = { createClient: () => client };
  })();`;
}

async function capture(page, scenario) {
  const errors = [];
  const rejections = [];
  const requests = new Set();
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  page.on('request', req => requests.add(req.url()));
  page.on('requestfinished', req => requests.delete(req.url()));
  page.on('requestfailed', req => requests.delete(req.url()));
  await page.addInitScript(({ storage, session }) => {
    window.__COI_TEST_SESSION__ = !!session;
    for (const [key, value] of Object.entries(storage || {})) localStorage.setItem(key, String(value));
    window.addEventListener('unhandledrejection', event => {
      window.__COI_TEST_REJECTIONS__ = window.__COI_TEST_REJECTIONS__ || [];
      window.__COI_TEST_REJECTIONS__.push(String(event.reason?.message || event.reason));
    });
  }, scenario);
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js|unpkg\.com\/@supabase\/supabase-js/, route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: mockSupabaseScript() })
  );
  const started = Date.now();
  let domContentLoadedAt = null;
  let loadAt = null;
  page.once('domcontentloaded', () => { domContentLoadedAt = Date.now() - started; });
  page.once('load', () => { loadAt = Date.now() - started; });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  const buttons = ['btnDashboard','btnRed','btnCalendarioCOI','btnOrdenes','btnCarga','btnAdministracionSistema','btnCentroAlertas','btnAccesoBusquedaOrdenes'];
  const interactions = [];
  for (const id of buttons) {
    const entry = await page.evaluate(buttonId => {
      const button = document.getElementById(buttonId);
      if (!button) return { id: buttonId, missing: true };
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return {
        id: buttonId,
        disabled: !!button.disabled,
        visible: rect.width > 0 && rect.height > 0,
        point: { x: Math.round(x), y: Math.round(y) },
        top: top ? { tag: top.tagName, id: top.id || '', className: String(top.className || ''), legitimate: top === button || button.contains(top) } : null
      };
    }, id);
    if (!entry.missing && entry.visible && entry.top?.legitimate) {
      try {
        await page.locator(`#${id}`).click({ timeout: 4000 });
        await page.waitForTimeout(120);
        entry.activeView = await page.evaluate(() => document.querySelector('.view.active')?.id || '');
        entry.clicked = true;
      } catch (error) {
        entry.clicked = false;
        entry.clickError = error.message;
      }
    }
    interactions.push(entry);
  }
  const runtime = await page.evaluate(() => {
    const fixed = [...document.querySelectorAll('body *')].filter(el => getComputedStyle(el).position === 'fixed').map(el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return { tag: el.tagName, id: el.id || '', className: String(el.className || ''), display: s.display, visibility: s.visibility, opacity: s.opacity, pointerEvents: s.pointerEvents, zIndex: s.zIndex, area: Math.round(r.width * r.height) };
    });
    return {
      bodyClassName: document.body.className,
      activeView: document.querySelector('.view.active')?.id || '',
      fixed,
      visibleOverlays: fixed.filter(x => x.display !== 'none' && x.visibility !== 'hidden' && Number(x.opacity) > 0 && x.pointerEvents !== 'none' && x.area > innerWidth * innerHeight * 0.5),
      appReady: window.__COI_APP_READY ?? null,
      rejections: window.__COI_TEST_REJECTIONS__ || [],
      localStorageKeys: Object.keys(localStorage).sort()
    };
  });
  return { scenario: scenario.name, domContentLoadedMs: domContentLoadedAt, loadMs: loadAt, elapsedMs: Date.now() - started, errors, rejections, requestsPending: [...requests], interactions, runtime };
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.COI_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });
  const results = [];
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      results.push(await capture(page, scenario));
      await page.screenshot({ path: `tests/artifacts/baseline-${scenario.name}.png`, fullPage: false });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
