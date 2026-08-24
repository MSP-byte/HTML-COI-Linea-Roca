from pathlib import Path

INDEX = Path('index.html')
source = INDEX.read_text(encoding='utf-8')

render_start = source.index('  function renderAlertsExecutive(){')
render_end = source.index('  function renderExecutiveFicha(', render_start)
new_render = r'''  function renderAlertsExecutive(){
    const host=document.querySelector('#vistaCentroAlertas .view-body');
    if(!host)return;
    let card=$('execAlertsCard');
    const wasOpen=card?.tagName==='DETAILS'&&card.open===true;
    if(card)card.remove();
    const ready=metaByOC.size>0||Array.isArray(window.__coiExecutiveRows);
    const rows=ready?generarAlertasCalidadYDocumentales():[];
    card=document.createElement('details');
    card.id='execAlertsCard';
    card.className='exec-alert-card exec-alert-collapsible';
    card.open=wasOpen;
    const countLabel=ready?`${rows.length} alerta${rows.length===1?'':'s'}`:'Cargando…';
    card.innerHTML=`<summary class="exec-alert-summary"><div class="exec-alert-summary-main"><div><h3>Alertas de calidad y documentación</h3><span class="muted">Panel específico de calidad y seguimiento documental</span></div><div class="exec-alert-summary-meta"><span class="exec-alert-summary-count">${esc(countLabel)}</span><span class="exec-alert-chevron" aria-hidden="true">⌄</span></div></div></summary><div class="exec-alert-collapsible-body">${ready?`<div class="muted exec-alert-source">${rows.length} alerta(s) calculadas desde Supabase.</div><div class="table-wrap"><table class="coi-table tabla-operativa exec-alert-table"><thead><tr><th>Severidad</th><th>Tipo</th><th>OC</th><th>Estación</th><th>Mensaje</th><th>Acción sugerida</th><th>Ficha</th></tr></thead><tbody>${rows.map(a=>`<tr class="${norm(a.sev)==='CRITICA'?'exec-critical-row':''}"><td>${badge(a.sev,norm(a.sev).includes('CRIT')||norm(a.sev)==='ALTA'?'rojo':norm(a.sev)==='MEDIA'?'amarillo':'gris')}</td><td>${esc(a.tipo)}</td><td>${esc(a.oc)}</td><td>${esc(a.est||'—')}</td><td>${esc(a.msg)}</td><td>${esc(a.accion)}</td><td><button type="button" data-open-oc="${esc(a.oc)}">Ver ficha</button></td></tr>`).join('')||'<tr><td colspan="7">Sin alertas ejecutivas.</td></tr>'}</tbody></table></div>`:'<div class="exec-alert-loading">Cargando alertas desde Supabase…</div>'}</div>`;
    host.insertBefore(card,host.firstChild);
  }
'''
source = source[:render_start] + new_render + source[render_end:]

state_start = source.index('  function setState(state,error=null){')
state_end = source.index('  function isRlsError(', state_start)
new_state = r'''  function setState(state,error=null){
    runtime.estado=state;runtime.ultimoError=error?text(error?.message||error):null;
    const initializing=state===STATES.CLIENTE_INICIALIZANDO;
    const readOnly=state!==STATES.SUPABASE_FIRST;
    if(document.body){document.body.classList.toggle('coi-data-readonly',readOnly);document.body.dataset.coiDataMode=readOnly?'readonly':'supabase-first';document.body.dataset.coiDataState=state;document.body.dataset.coiDataReason=runtime.ultimoError||'';}
    const mode=$('headerModoSistema');if(mode)mode.textContent=initializing?'Conectando…':readOnly?'Modo solo lectura':'Modo Operativo';
    let banner=$('coiV60ReadOnlyBanner');
    if(readOnly&&!initializing&&!banner&&document.body){banner=document.createElement('div');banner.id='coiV60ReadOnlyBanner';banner.setAttribute('role','status');banner.style.cssText='position:fixed;right:18px;bottom:18px;z-index:5000;padding:10px 14px;border-radius:10px;background:#7f1d1d;color:#fff;font-weight:800;box-shadow:0 8px 24px #0005';document.body.appendChild(banner);}
    if(banner){banner.textContent=stateMessage(state,runtime.ultimoError);banner.hidden=!readOnly||initializing;}
    return state;
  }
  async function waitForSupabaseClient({timeoutMs=15000,intervalMs=250,graceMs=5000}={}){
    const existing=client();if(existing)return existing;
    setState(STATES.CLIENTE_INICIALIZANDO);
    if(typeof window.initSupabase==='function')Promise.resolve(window.initSupabase()).catch(()=>null);
    const started=Date.now();
    while(Date.now()-started<timeoutMs){const available=client();if(available)return available;await new Promise(resolve=>setTimeout(resolve,intervalMs));}
    const graceStarted=Date.now();
    while(Date.now()-graceStarted<graceMs){const available=client();if(available)return available;await new Promise(resolve=>setTimeout(resolve,intervalMs));}
    const late=client();if(late)return late;
    setState(STATES.SIN_CLIENTE,'Tiempo de espera agotado.');return null;
  }
'''
source = source[:state_start] + new_state + source[state_end:]

style_id = 'coi-alerts-collapsible-init-fix'
if style_id not in source:
    css = r'''<style id="coi-alerts-collapsible-init-fix">
#execAlertsCard.exec-alert-collapsible{margin-bottom:14px;border:1px solid #d8e2ee;border-radius:14px;background:#fff;overflow:hidden}
#execAlertsCard.exec-alert-collapsible>summary{display:block;cursor:pointer;list-style:none;padding:14px 16px;user-select:none;background:#f8fafc}
#execAlertsCard.exec-alert-collapsible>summary::-webkit-details-marker{display:none}
#execAlertsCard .exec-alert-summary-main{display:flex;align-items:center;justify-content:space-between;gap:16px}
#execAlertsCard .exec-alert-summary h3{margin:0 0 3px;font-size:16px;color:#17324d}
#execAlertsCard .exec-alert-summary-meta{display:flex;align-items:center;gap:10px;flex:0 0 auto}
#execAlertsCard .exec-alert-summary-count{display:inline-flex;align-items:center;min-height:28px;padding:4px 10px;border:1px solid #cfdbea;border-radius:999px;background:#fff;color:#31516f;font-size:12px;font-weight:800}
#execAlertsCard .exec-alert-chevron{font-size:22px;line-height:1;color:#59728b;transition:transform .18s ease}
#execAlertsCard[open] .exec-alert-chevron{transform:rotate(180deg)}
#execAlertsCard .exec-alert-collapsible-body{border-top:1px solid #e3eaf2;padding:12px}
#execAlertsCard .exec-alert-source{margin:0 0 10px 2px}
#execAlertsCard .exec-alert-loading{padding:18px;text-align:center;color:#64748b;font-weight:700;background:#f8fafc;border-radius:10px}
@media(max-width:760px){#execAlertsCard .exec-alert-summary-main{align-items:flex-start}#execAlertsCard .exec-alert-summary .muted{display:block;max-width:220px}#execAlertsCard .exec-alert-summary-meta{gap:6px}#execAlertsCard .exec-alert-summary-count{white-space:nowrap}}
</style>
'''
    source = source.replace('</head>', css + '</head>', 1)

INDEX.write_text(source, encoding='utf-8', newline='')

TEST = Path('tests/alerts_collapsible_init.spec.js')
TEST.write_text(r'''const { test, expect } = require('@playwright/test');
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
''', encoding='utf-8', newline='')
