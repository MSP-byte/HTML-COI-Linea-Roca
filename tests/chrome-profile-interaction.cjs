const { chromium } = require(process.env.COI_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const baseUrl = process.env.COI_TEST_URL || 'http://127.0.0.1:4173/';
const chromePath = process.env.COI_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const longRunMs = Number(process.env.COI_LONG_TEST_MS || 0);
const artifactDir = path.resolve('tests/artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

const scenarios = [
  { name: 'A-clean-incognito', storage: {}, session: false },
  { name: 'B-persistent-profile', persistent: true, storage: {}, session: false },
  { name: 'C-persistent-localstorage', persistent: true, storage: { coi_modo: 'admin', rolActivo: 'Administrador', coi_rol_usuario: 'administrador' }, session: false },
  { name: 'D-restored-session', persistent: true, storage: { coi_rol_usuario: 'administrador' }, session: true },
  { name: 'E-invalid-old-state', persistent: true, storage: { coi_active_view: 'vistaInexistente', activeView: 'vistaInexistente', modoAdministradorActivo: 'true', sesionAdminActiva: 'true', coi_modo_usuario: 'visualizador' }, session: false },
  { name: 'F-login-and-reload', persistent: true, storage: { coi_rol_usuario: 'administrador' }, loginAndReload: true },
  { name: 'G-return-navigation', persistent: true, storage: { coi_rol_usuario: 'administrador' }, session: true, returnNavigation: true }
];
const scenarioFilter = String(process.env.COI_SCENARIO_FILTER || '').trim();
const selectedScenarios = scenarioFilter ? scenarios.filter(item => item.name.startsWith(scenarioFilter)) : scenarios;

function mockSupabaseScript() {
  return `(() => {
    let currentSession = localStorage.getItem('__coi_test_session__') === '1'
      ? { user: { id: 'fixture-user', email: 'admin@coiroca.com' }, access_token: 'redacted-test-token' }
      : null;
    const listeners = new Set();
    const result = (data = []) => Promise.resolve({ data, error: null });
    const chain = new Proxy({}, { get(_target, prop) {
      if (prop === 'then') return (resolve) => result([]).then(resolve);
      if (prop === 'single' || prop === 'maybeSingle') return () => result(null);
      return () => chain;
    }});
    const client = {
      auth: {
        getSession: async () => ({ data: { session: currentSession }, error: null }),
        getUser: async () => ({ data: { user: currentSession?.user || null }, error: null }),
        onAuthStateChange: (cb) => { listeners.add(cb); setTimeout(() => cb('INITIAL_SESSION', currentSession), 0); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
        signInWithPassword: async () => { currentSession = { user: { id: 'fixture-user', email: 'admin@coiroca.com' }, access_token: 'redacted-test-token' }; localStorage.setItem('__coi_test_session__', '1'); listeners.forEach(cb => cb('SIGNED_IN', currentSession)); return { data: { session: currentSession, user: currentSession.user }, error: null }; },
        signOut: async () => { currentSession = null; localStorage.removeItem('__coi_test_session__'); listeners.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; }
      },
      from: () => chain,
      storage: { from: () => ({ createSignedUrl: async storagePath => ({ data: { signedUrl: storagePath ? 'data:application/pdf;base64,JVBERi0xLjQK' : null }, error: storagePath ? null : new Error('missing path') }) }) }
    };
    window.supabase = { createClient: () => client };
  })();`;
}

async function installHarness(page, scenario) {
  const messages = { errors: [], warnings: [], rejections: [] };
  const pending = new Set();
  page.on('console', message => {
    const item = message.text();
    if (message.type() === 'error') messages.errors.push(item);
    if (message.type() === 'warning') messages.warnings.push(item);
  });
  page.on('pageerror', error => messages.errors.push(String(error?.stack || error)));
  page.on('dialog', dialog => dialog.accept().catch(() => {}));
  page.on('request', request => pending.add(request.url()));
  page.on('requestfinished', request => pending.delete(request.url()));
  page.on('requestfailed', request => pending.delete(request.url()));
  await page.addInitScript(({ storage, session }) => {
    for (const [key, value] of Object.entries(storage || {})) localStorage.setItem(key, String(value));
    if (session) localStorage.setItem('__coi_test_session__', '1');
    window.addEventListener('unhandledrejection', event => {
      window.__COI_TEST_REJECTIONS__ = window.__COI_TEST_REJECTIONS__ || [];
      window.__COI_TEST_REJECTIONS__.push(String(event.reason?.message || event.reason));
    });
  }, scenario);
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js|unpkg\.com\/@supabase\/supabase-js/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: mockSupabaseScript() }));
  return { messages, pending };
}

async function openPage(page, url = baseUrl) {
  const started = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.COIDiagnosticoInteraccion === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(8500);
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    return { domContentLoadedMs: Math.round(entry?.domContentLoadedEventEnd || 0), loadMs: Math.round(entry?.loadEventEnd || 0) };
  });
  return { started, navigation };
}

async function clickNavigation(page) {
  const expected = {
    btnDashboard: 'vistaDashboard', btnRed: 'vistaRed', btnCalendarioCOI: 'vistaCalendarioCOI', btnOrdenes: 'vistaOrdenes',
    btnCarga: 'vistaCarga', btnAdministracionSistema: 'vistaAdministracionSistema', btnCentroAlertas: 'vistaCentroAlertas', btnAccesoBusquedaOrdenes: 'vistaOrdenes'
  };
  const results = [];
  for (const [id, view] of Object.entries(expected)) {
    const hit = await page.evaluate(buttonId => {
      const button = document.getElementById(buttonId);
      if (!button) return { id: buttonId, missing: true };
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return { id: buttonId, hidden: true, disabled: !!button.disabled };
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, top = document.elementFromPoint(x, y);
      return { id: buttonId, disabled: !!button.disabled, point: { x: Math.round(x), y: Math.round(y) }, top: top ? { tag: top.tagName, id: top.id || '', className: String(top.className || '') } : null, legitimate: top === button || button.contains(top) };
    }, id);
    const item = { ...hit, expectedView: view };
    if (hit.hidden && id === 'btnCentroAlertas') { item.restrictedAsExpected = true; results.push(item); continue; }
    if (!hit.missing && !hit.hidden && hit.legitimate) {
      try {
        await page.locator(`#${id}`).click({ timeout: 5000 });
        await page.waitForTimeout(180);
        item.activeView = await page.evaluate(() => document.querySelector('.view.active')?.id || '');
        item.passed = item.activeView === view;
      } catch (error) { item.passed = false; item.error = error.message; }
    } else item.passed = false;
    results.push(item);
  }
  return results;
}

async function testRecoveryAndExternalDetection(page) {
  const result = {};
  await page.evaluate(() => {
    document.body.classList.add('coi-booting');
    const loader = document.createElement('div'); loader.id = 'coiTestStaleLoader'; loader.className = 'coi-loader'; loader.textContent = 'fixture loader'; Object.assign(loader.style, { position: 'fixed', inset: '0', zIndex: '50000', background: 'rgba(255,255,255,.01)' }); document.body.appendChild(loader);
    const orphan = document.createElement('div'); orphan.id = 'coiTestOrphan'; orphan.className = 'op-modal'; document.body.appendChild(orphan);
  });
  result.recovery = await page.evaluate(async () => {
    const response = await window.COIRecuperarInterfaz();
    return { recovered: response.recovered, changes: response.changes, bootClass: document.body.classList.contains('coi-booting'), staleLoaderVisible: getComputedStyle(document.getElementById('coiTestStaleLoader')).display !== 'none', orphanVisible: getComputedStyle(document.getElementById('coiTestOrphan')).display !== 'none' };
  });
  await page.evaluate(() => {
    const external = document.createElement('div'); external.id = 'coiExtensionFixture'; external.setAttribute('data-origin', 'chrome-extension://fixture/profile'); Object.assign(external.style, { position: 'fixed', inset: '0', zIndex: '2147482000', pointerEvents: 'auto', background: 'transparent' }); document.body.appendChild(external);
  });
  result.externalDiagnostic = await page.evaluate(() => {
    const report = window.COIDiagnosticoInteraccion();
    const blocker = report.blockingOverlays.find(item => item.id === 'coiExtensionFixture');
    return { detected: !!blocker, extensionHint: !!blocker?.extensionHint, reason: blocker?.reason || '' };
  });
  result.externalRecovery = await page.evaluate(async () => {
    await window.COIRecuperarInterfaz();
    return { stillPresent: !!document.getElementById('coiExtensionFixture'), stillVisible: getComputedStyle(document.getElementById('coiExtensionFixture')).display !== 'none' };
  });
  await page.evaluate(() => document.getElementById('coiExtensionFixture')?.remove());
  return result;
}

async function testFinancialFixture(page) {
  await page.evaluate(() => {
    localStorage.removeItem('coi_posiciones_financieras');
    localStorage.removeItem('coi_finanzas_por_oc_v1');
    const fixture = { id: 'fixture-order-id', supabaseId: 'fixture-order-id', nro_oc: '4530009999', numeroOC: '4530009999', idObra: 'FIXTURE-OC', tipo: 'Servicio', proveedor: 'Proveedor Fixture', estacion: 'Temperley' };
    window.supabaseOrdenesActuales = [fixture]; window.ordenesSupabase = [fixture]; window.__coiExecutiveRows = [fixture];
    window.todasLasOC = () => [{ ...fixture, oc: fixture.nro_oc, item: fixture }];
  });
  await page.locator('#btnCarga').click();
  await page.locator('[data-carga-tipo="Financiera"]').click();
  await page.waitForSelector('#panelCargaFinanciera.active #cargaRapidaFinancieraBody tr');
  const fixtureRows = [
    ['4530009999','R-01','10','Posicion 1','1','1.000','','07/2026','1.000'],
    ['4530009999','R-02','20','Posicion 2','1','102.976','','07/2026','102.976'],
    ['4530009999','R-03','30','Posicion 3','1','2.000.000','','07/2026','2.000.000'],
    ['4530009999','R-04','40','Posicion 4','1','102.975,84','','07/2026','102.975,84'],
    ['4530009999','R-05','50','Posicion 5','1','12.5','','07/2026','12.5']
  ];
  await page.evaluate(rows => {
    const columns = ['OC','REMITO','POS','DESCRIPCION','CANTIDAD','PRECIO_UNITARIO','PRECIO_TOTAL','PERIODO','SALDO'];
    const trs = [...document.querySelectorAll('#cargaRapidaFinancieraBody tr')].slice(0, rows.length);
    rows.forEach((values, index) => columns.forEach((column, col) => { const input = trs[index]?.querySelector(`[data-campo="${column}"]`); if (input) { input.value = values[col]; input.dispatchEvent(new Event('input', { bubbles: true })); } }));
  }, fixtureRows);
  await page.locator('#btnGuardarCargaRapida').click();
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('coi_posiciones_financieras') || '[]').filter(item => String(item.ocNro || item.nro_oc) === '4530009999');
    const amounts = rows.map(item => Number(item.precioUnitario));
    const parserChecks = ['1.000','2.000.000','102.976','102.975,84','12.5'].map(value => ({ value, parsed: window.coiParseMontoAR(value) }));
    const associated = window.COI_FINANZAS?.obtenerPorOC?.('4530009999') || [];
    let fichaOpened = false, fichaError = '';
    try { window.abrirFichaOC?.('FIXTURE-OC'); fichaOpened = document.getElementById('vistaFichaOC')?.classList.contains('active') || false; } catch (error) { fichaError = error.message; }
    return { count: rows.length, amounts, parserChecks, associatedCount: associated.length, summary: window.COI_FINANZAS?.resumenPorOC?.('4530009999') || null, fichaOpened, fichaError, appReady: window.__COI_APP_READY === true };
  });
  await page.locator('#btnDashboard').click();
  saved.navigationResponsiveAfterSave = await page.evaluate(() => document.getElementById('vistaDashboard')?.classList.contains('active') || false);
  saved.passed = saved.count === 5 && saved.associatedCount === 5 && saved.navigationResponsiveAfterSave && saved.parserChecks.map(item => item.parsed).join('|') === '1000|2000000|102976|102975.84|12.5';
  return saved;
}

async function runScenario(scenario, browser) {
  let context;
  let profileDir = null;
  if (scenario.persistent) {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coi-chrome-profile-'));
    context = await chromium.launchPersistentContext(profileDir, { headless: true, executablePath: chromePath, viewport: { width: 1440, height: 1000 } });
  } else context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = context.pages()[0] || await context.newPage();
  const harness = await installHarness(page, scenario);
  const url = scenario.name === 'A-clean-incognito' ? `${baseUrl}?coiDebug=1` : baseUrl;
  const opened = await openPage(page, url);
  const result = { scenario: scenario.name, context: scenario.persistent ? 'persistent' : 'clean', ...opened.navigation };
  if (scenario.loginAndReload) {
    await page.locator('#btnSupabaseLogin').click();
    await page.locator('#supabaseEmail').fill('fixture@example.test');
    await page.locator('#supabasePassword').fill('fixture-only');
    await page.locator('#btnConfirmarSupabaseLogin').click();
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.COIDiagnosticoInteraccion === 'function');
    await page.waitForTimeout(8500);
    result.reloadedAfterLogin = true;
  }
  result.navigation = await clickNavigation(page);
  if (scenario.returnNavigation) {
    await page.locator('#btnOrdenes').click(); await page.locator('#btnDashboard').click(); await page.locator('#btnRed').click();
    result.returnNavigationView = await page.evaluate(() => document.querySelector('.view.active')?.id || '');
  }
  result.diagnostic = await page.evaluate(() => window.COIDiagnosticoInteraccion());
  if (scenario.name === 'D-restored-session') result.recoveryAndExternal = await testRecoveryAndExternalDetection(page);
  if (scenario.name === 'C-persistent-localstorage') result.financialFixture = await testFinancialFixture(page);
  result.runtimeRejections = await page.evaluate(() => window.__COI_TEST_REJECTIONS__ || []);
  result.errors = harness.messages.errors;
  result.warnings = harness.messages.warnings;
  result.pendingRequests = [...harness.pending];
  result.elapsedMs = Date.now() - opened.started;
  result.passed = result.errors.length === 0 && result.runtimeRejections.length === 0 && result.navigation.every(item => item.passed || item.restrictedAsExpected) && result.diagnostic.blockingOverlays.length === 0 && result.diagnostic.appReady === true && (!result.financialFixture || result.financialFixture.passed) && (!result.recoveryAndExternal || (result.recoveryAndExternal.externalDiagnostic.detected && result.recoveryAndExternal.externalDiagnostic.extensionHint && result.recoveryAndExternal.externalRecovery.stillPresent));
  await page.screenshot({ path: path.join(artifactDir, `final-${scenario.name}.png`), fullPage: false });
  await context.close();
  return result;
}

async function runLongTest(browser) {
  if (!longRunMs) return { skipped: true, requestedMs: 0 };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const harness = await installHarness(page, { storage: { coi_rol_usuario: 'administrador' }, session: true });
  await openPage(page);
  const started = Date.now();
  await page.waitForTimeout(longRunMs);
  const navigation = await clickNavigation(page);
  const diagnostic = await page.evaluate(() => window.COIDiagnosticoInteraccion());
  const result = { skipped: false, requestedMs: longRunMs, actualMs: Date.now() - started, navigation, diagnostic, errors: harness.messages.errors, runtimeRejections: await page.evaluate(() => window.__COI_TEST_REJECTIONS__ || []), passed: navigation.every(item => item.passed || item.restrictedAsExpected) && diagnostic.blockingOverlays.length === 0 && diagnostic.appReady === true && harness.messages.errors.length === 0 };
  await page.screenshot({ path: path.join(artifactDir, 'final-after-long-run.png'), fullPage: false });
  await context.close();
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const results = [];
  try {
    for (const scenario of selectedScenarios) results.push(await runScenario(scenario, browser));
    const longRun = await runLongTest(browser);
    const report = { generatedAt: new Date().toISOString(), baseUrl, chromePath, mockedSupabase: true, productiveWrites: 0, longRun, results };
    report.passed = results.every(item => item.passed) && (longRun.skipped || longRun.passed);
    process.stdout.write(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
