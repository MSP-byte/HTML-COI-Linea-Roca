const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function between(start, end) {
  const a = SOURCE.indexOf(start);
  const b = SOURCE.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`No se encontró bloque: ${start}`);
  return SOURCE.slice(a, b);
}

const RENDER_ALERTS = between('  function renderAlertsExecutive(){', '  function renderExecutiveFicha(');
const STATE_MESSAGE = between('  function stateMessage(state,detail=\'\'){', '  function setState(state,error=null){');
const STATE_BLOCK = between('  function setState(state,error=null){', '  function isRlsError(');

async function mountAlertsRenderer(page, ready = true) {
  await page.setContent('<section id="vistaCentroAlertas"><div class="view-body"><div id="general-alerts">Centro de Alertas general</div></div></section>');
  await page.addScriptTag({ content: `
    const metaByOC = new Map(${ready ? "[['4530009384',{}]]" : '[]'});
    ${ready ? 'window.__coiExecutiveRows=[{}];' : 'delete window.__coiExecutiveRows;'}
    const $ = id => document.getElementById(id);
    const clean = v => String(v ?? '').trim();
    const norm = v => clean(v).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().replace(/\\s+/g,' ');
    const esc = v => clean(v).replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
    const badge = (text,kind) => '<span class="exec-badge '+esc(kind)+'">'+esc(text)+'</span>';
    function generarAlertasCalidadYDocumentales(){return [{sev:'Crítica',tipo:'Calidad roja',oc:'4530009384',est:'PLAZA CONSTITUCIÓN',msg:'Dato pendiente',accion:'Completar datos'}];}
    ${RENDER_ALERTS}
    window.__renderAlertsExecutive = renderAlertsExecutive;
  `});
}

test('panel especializado queda plegado por defecto y conserva la tabla general', async ({ page }) => {
  await mountAlertsRenderer(page, true);
  await page.evaluate(() => window.__renderAlertsExecutive());
  const panel = page.locator('#execAlertsCard');
  await expect(panel).toHaveJSProperty('open', false);
  await expect(panel.locator('summary')).toContainText('Alertas de calidad y documentación');
  await expect(panel.locator('.exec-alert-summary-count')).toHaveText('1 alerta');
  await expect(page.locator('#general-alerts')).toBeVisible();
  await expect(panel.locator('.exec-alert-table')).toBeHidden();

  await panel.locator('summary').click();
  await expect(panel).toHaveJSProperty('open', true);
  await expect(panel.locator('.exec-alert-table')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ver ficha' })).toBeVisible();
});

test('rerender no duplica el panel y conserva el estado abierto', async ({ page }) => {
  await mountAlertsRenderer(page, true);
  await page.evaluate(() => window.__renderAlertsExecutive());
  await page.locator('#execAlertsCard summary').click();
  await page.evaluate(() => window.__renderAlertsExecutive());
  await expect(page.locator('#execAlertsCard')).toHaveCount(1);
  await expect(page.locator('#execAlertsCard')).toHaveJSProperty('open', true);
});

test('antes de recibir metadata remota muestra carga compacta y no calcula alertas locales', async ({ page }) => {
  await mountAlertsRenderer(page, false);
  await page.evaluate(() => window.__renderAlertsExecutive());
  const panel = page.locator('#execAlertsCard');
  await expect(panel.locator('.exec-alert-summary-count')).toHaveText('Cargando…');
  await panel.locator('summary').click();
  await expect(panel.locator('.exec-alert-loading')).toContainText('Cargando alertas desde Supabase');
  await expect(panel.locator('.exec-alert-table')).toHaveCount(0);
});

test('inicialización tardía no muestra falso SIN_CLIENTE y un fallo definitivo sí conserva la advertencia', async ({ page }) => {
  await page.setContent('<div id="headerModoSistema"></div>');
  await page.addScriptTag({ content: `
    const STATES={CLIENTE_INICIALIZANDO:'CLIENTE_INICIALIZANDO',SIN_CLIENTE:'SIN_CLIENTE',SIN_SESION:'SIN_SESION',OFFLINE:'OFFLINE',ERROR_RLS:'ERROR_RLS',SUPABASE_FIRST:'SUPABASE_FIRST'};
    const runtime={estado:null,ultimoError:null};
    const text=v=>String(v??'');
    const $=id=>document.getElementById(id);
    let fakeClient=null;
    function client(){return fakeClient;}
    ${STATE_MESSAGE}
    ${STATE_BLOCK}
    window.__lateClientScenario=async()=>{
      fakeClient=null;
      window.initSupabase=()=>new Promise(resolve=>setTimeout(()=>{fakeClient={ready:true};resolve(fakeClient);},35));
      const result=await waitForSupabaseClient({timeoutMs:10,intervalMs:5,graceMs:100});
      return {hasClient:!!result,state:runtime.estado,banner:document.getElementById('coiV60ReadOnlyBanner')?.hidden===false,mode:document.getElementById('headerModoSistema').textContent};
    };
    window.__missingClientScenario=async()=>{
      fakeClient=null;runtime.estado=null;runtime.ultimoError=null;
      document.getElementById('coiV60ReadOnlyBanner')?.remove();
      window.initSupabase=async()=>null;
      const result=await waitForSupabaseClient({timeoutMs:10,intervalMs:5,graceMs:15});
      const banner=document.getElementById('coiV60ReadOnlyBanner');
      return {hasClient:!!result,state:runtime.estado,bannerVisible:!!banner&&!banner.hidden,text:banner?.textContent||''};
    };
  `});

  const late = await page.evaluate(() => window.__lateClientScenario());
  expect(late.hasClient).toBe(true);
  expect(late.state).toBe('CLIENTE_INICIALIZANDO');
  expect(late.banner).toBe(false);
  expect(late.mode).toBe('Conectando…');

  const missing = await page.evaluate(() => window.__missingClientScenario());
  expect(missing.hasClient).toBe(false);
  expect(missing.state).toBe('SIN_CLIENTE');
  expect(missing.bannerVisible).toBe(true);
  expect(missing.text).toContain('cliente Supabase no disponible');
});

test('contratos de UX y Supabase quedan explícitos en la fuente', async () => {
  expect(SOURCE).toContain('id="coi-alerts-collapsible-init-fix"');
  expect(RENDER_ALERTS).toContain("document.createElement('details')");
  expect(RENDER_ALERTS).toContain("card.open=wasOpen");
  expect(RENDER_ALERTS).toContain("const ready=metaByOC.size>0||Array.isArray(window.__coiExecutiveRows)");
  expect(STATE_BLOCK).toContain('timeoutMs=15000');
  expect(STATE_BLOCK).toContain('graceMs=5000');
  expect(STATE_BLOCK).toContain("banner.hidden=!readOnly||initializing");
});
