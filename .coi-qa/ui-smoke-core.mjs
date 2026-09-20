import { chromium } from 'playwright-core';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

function arg(name, fallback=null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i+1] : fallback;
}
const mode = arg('--mode', 'dirty');
if (!['dirty','admin-state','full'].includes(mode)) {
  throw new Error(`Modo QA no soportado: ${mode}`);
}
const noPause = process.argv.includes('--no-pause');
const repo = path.resolve(arg('--repo', process.cwd()));
const qaDir = path.join(repo, '.coi-qa');
const cfgPath = path.join(qaDir, 'coi-qa.config.json');
const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const targetHtml = arg('--html', config.stagingHtml);
if (path.basename(targetHtml) !== targetHtml || !targetHtml.toLowerCase().endsWith('.html')) {
  throw new Error('El HTML bajo prueba debe estar en la raiz del repo.');
}
config.stagingHtml = targetHtml;
const stagingSource = fs.readFileSync(path.join(repo,config.stagingHtml),'utf8');
const adminResolverSource = stagingSource.match(
  /function resolverRolUsuarioExistente\(usuario\)\{[\s\S]*?\r?\n\}/
)?.[0] || '';
const adminPermissionSource = stagingSource.match(
  /function usuarioTienePermisoEdicion\(\)\{[\s\S]*?\r?\n\}/
)?.[0] || '';
const legacyGrantFindings = [
  ...stagingSource.matchAll(/return[^;\r\n]*(?:classList\.contains\(['"]modo-admin|dataset\.admin|headerModoSistema[^;\r\n]*admin)/gi),
  ...stagingSource.matchAll(/prompt\(['"]Ingrese PIN de Administrador['"]\)/gi)
].map(match => match[0].slice(0,240));
const logs = path.join(qaDir, 'logs');
fs.mkdirSync(logs, {recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const reportPath = path.join(logs, `ui-${mode}-${stamp}.json`);
const shot = name => path.join(logs, `${stamp}-${name}.png`);

const report = {
  mode,
  targetHtml,
  timestamp:new Date().toISOString(),
  steps:[],
  success:false,
  fallbackUsed:false,
  businessWriteRequests:[]
};
function step(name,status,detail={}) {
  report.steps.push({name,status,detail,at:new Date().toISOString()});
  console.log(`[${status}] ${name}`, detail);
}
function saveReport() {
  fs.writeFileSync(reportPath, JSON.stringify(report,null,2), 'utf8');
  console.log(`Reporte: ${reportPath}`);
}

async function waitEnter(msg) {
  console.log('\n' + msg);
  const rl = readline.createInterface({input:process.stdin, output:process.stdout});
  await new Promise(resolve => rl.question('Presiona ENTER para continuar... ', () => { rl.close(); resolve(); }));
}

async function findChromeExecutable() {
  const candidates = [
    process.env['PROGRAMFILES'] && path.join(process.env['PROGRAMFILES'],'Google','Chrome','Application','chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'],'Google','Chrome','Application','chrome.exe'),
    process.env['LOCALAPPDATA'] && path.join(process.env['LOCALAPPDATA'],'Google','Chrome','Application','chrome.exe')
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

function snapshotSummary(snapshot) {
  return {
    id: snapshot.id,
    nro_oc: snapshot.nro_oc,
    sha256: crypto.createHash('sha256').update(snapshot.serialized).digest('hex')
  };
}

async function readDbSnapshot(page) {
  const snapshot = await page.evaluate(async ({id, nroOc}) => {
    const client = window.__COI_SUPABASE_CLIENT__ ||
      (typeof window.getSupabaseClient === 'function' ? window.getSupabaseClient() : null);
    if (!client) return {ok:false, reason:'Cliente Supabase no disponible.'};

    const {data, error} = await client
      .from('coi_ordenes')
      .select('*')
      .eq('id', id)
      .limit(2);

    if (error) return {ok:false, reason:error.message || String(error)};
    if (!Array.isArray(data) || data.length !== 1) {
      return {ok:false, reason:`Se esperaban 1 fila y se recibieron ${Array.isArray(data) ? data.length : 0}.`};
    }

    const row = data[0];
    const actualId = String(row.id || '');
    const actualOc = String(row.nro_oc || '');
    if (actualId !== id || actualOc !== nroOc) {
      return {ok:false, reason:`Fixture inesperada: id=${actualId}, nro_oc=${actualOc}.`};
    }

    return {ok:true, id:actualId, nro_oc:actualOc, serialized:JSON.stringify(row)};
  }, {id:config.testOcUuid, nroOc:config.testOcOriginal});

  if (!snapshot?.ok) throw new Error(`No se pudo leer la fixture en STAGING: ${snapshot?.reason || 'error desconocido'}`);
  return snapshot;
}

const RELATED_ORDER_TABLES = Object.freeze([
  'coi_ordenes_estaciones',
  'coi_posiciones_oc',
  'coi_certificaciones',
  'coi_consumos_posicion',
  'coi_documentos_oc',
  'coi_links_documentales',
  'coi_observaciones_oc',
  'coi_alertas',
  'coi_historial_oc'
]);
const LEGACY_OC_TABLES = Object.freeze(['coi_servicios_tecnicos_um']);
const TEMP_OBSERVATION = 'QA RC2 E2E - TEMPORAL';

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function valueHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function fixtureSummary(snapshot) {
  return {
    projectRef:snapshot.projectRef,
    master:{
      count:snapshot.master.length,
      id:snapshot.master[0]?.id || null,
      nro_oc:snapshot.master[0]?.nro_oc || null,
      sha256:valueHash(snapshot.master)
    },
    tables:Object.fromEntries(Object.entries(snapshot.tables).map(([table,rows]) => [table,{
      count:rows.length,
      sha256:valueHash(rows),
      nroOcCounts:rows.reduce((acc,row) => {
        const key=String(row?.nro_oc ?? '<null>');
        acc[key]=(acc[key]||0)+1;
        return acc;
      },{})
    }])),
    audit:snapshot.audit.error
      ? {readable:false,error:snapshot.audit.error}
      : {readable:true,count:snapshot.audit.rows.length,sha256:valueHash(snapshot.audit.rows)}
  };
}

function businessSnapshot(snapshot) {
  const volatile = new Set(['fecha_actualizacion','actualizado_por','updated_at']);
  const cleanRows = rows => rows.map(row => Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !volatile.has(key))
      .map(([key,value]) => [key,key === 'observaciones' && (value == null || value === '') ? null : value])
  ));
  return {
    master:cleanRows(snapshot.master),
    tables:Object.fromEntries(Object.entries(snapshot.tables)
      .filter(([table]) => table !== 'coi_historial_oc')
      .map(([table,rows]) => [table,cleanRows(rows)]))
  };
}

async function verifyStagingProjectRef(page) {
  const result = await page.evaluate(() => {
    const client = window.__COI_SUPABASE_CLIENT__ ||
      (typeof window.getSupabaseClient === 'function' ? window.getSupabaseClient() : null);
    if (!client) return {ok:false,reason:'Cliente Supabase no disponible.'};
    const candidates=[client.supabaseUrl,client.rest?.url,client.auth?.url].filter(Boolean);
    let host='';
    for(const candidate of candidates){
      try{host=new URL(candidate).hostname;if(host)break;}catch{}
    }
    const projectRef=host.endsWith('.supabase.co')?host.split('.')[0]:null;
    return {ok:Boolean(projectRef),projectRef,host};
  });
  if (!result?.ok || result.projectRef !== config.stagingProjectRef) {
    throw new Error(`WRITE BLOQUEADO: project-ref=${result?.projectRef || '<desconocido>'}; esperado=${config.stagingProjectRef}.`);
  }
  step('Guard rail project-ref STAGING','PASS',{projectRef:result.projectRef});
  return result.projectRef;
}

async function readFixtureState(page) {
  const snapshot = await page.evaluate(async ({id,originalOc,temporaryOc,relatedTables,legacyTables}) => {
    const client = window.__COI_SUPABASE_CLIENT__ ||
      (typeof window.getSupabaseClient === 'function' ? window.getSupabaseClient() : null);
    if (!client) return {ok:false,reason:'Cliente Supabase no disponible.'};
    const candidates=[client.supabaseUrl,client.rest?.url,client.auth?.url].filter(Boolean);
    let host='';
    for(const candidate of candidates){try{host=new URL(candidate).hostname;if(host)break;}catch{}}
    const projectRef=host.endsWith('.supabase.co')?host.split('.')[0]:null;
    const masterResult=await client.from('coi_ordenes').select('*').eq('id',id).limit(2);
    if(masterResult.error)return {ok:false,reason:`coi_ordenes: ${masterResult.error.message || masterResult.error}`};
    const tables={};
    for(const table of relatedTables){
      const result=await client.from(table).select('*').eq('orden_id',id).limit(1000);
      if(result.error)return {ok:false,reason:`${table}: ${result.error.message || result.error}`};
      tables[table]=result.data || [];
    }
    for(const table of legacyTables){
      const result=await client.from(table).select('*').in('nro_oc',[originalOc,temporaryOc]).limit(1000);
      if(result.error)return {ok:false,reason:`${table}: ${result.error.message || result.error}`};
      tables[table]=result.data || [];
    }
    const auditResult=await client.from('coi_operaciones_auditoria').select('*').eq('registro_id',id).limit(1000);
    return {
      ok:true,
      projectRef,
      master:masterResult.data || [],
      tables,
      audit:auditResult.error
        ? {rows:[],error:auditResult.error.message || String(auditResult.error)}
        : {rows:auditResult.data || [],error:null}
    };
  },{
    id:config.testOcUuid,
    originalOc:config.testOcOriginal,
    temporaryOc:config.testOcTemporary,
    relatedTables:RELATED_ORDER_TABLES,
    legacyTables:LEGACY_OC_TABLES
  });
  if(!snapshot?.ok)throw new Error(`Snapshot Supabase incompleto: ${snapshot?.reason || 'error desconocido'}`);
  if(snapshot.projectRef!==config.stagingProjectRef)throw new Error(`Snapshot proviene de project-ref inesperado: ${snapshot.projectRef || '<desconocido>'}.`);
  return snapshot;
}

function validateFixtureNumber(snapshot,expectedOc,baseline=null) {
  const errors=[];
  const master=snapshot.master;
  if(master.length!==1)errors.push(`coi_ordenes count=${master.length}`);
  if(String(master[0]?.id||'')!==config.testOcUuid)errors.push(`UUID maestro=${master[0]?.id || '<null>'}`);
  if(String(master[0]?.nro_oc||'')!==expectedOc)errors.push(`nro_oc maestro=${master[0]?.nro_oc || '<null>'}`);
  for(const table of RELATED_ORDER_TABLES){
    const rows=snapshot.tables[table] || [];
    const mismatches=rows.filter(row => row.nro_oc != null && String(row.nro_oc)!==expectedOc);
    if(mismatches.length)errors.push(`${table}: ${mismatches.length} referencia(s) fuera de ${expectedOc}`);
  }
  for(const table of LEGACY_OC_TABLES){
    const rows=snapshot.tables[table] || [];
    const otherOc=expectedOc===config.testOcOriginal?config.testOcTemporary:config.testOcOriginal;
    const residues=rows.filter(row => String(row?.nro_oc||'')===otherOc).length;
    if(residues)errors.push(`${table}: ${residues} residuo(s) en ${otherOc}`);
    if(baseline){
      const baselineCount=(baseline.tables[table]||[]).filter(row => String(row?.nro_oc||'')===config.testOcOriginal).length;
      const expectedCount=rows.filter(row => String(row?.nro_oc||'')===expectedOc).length;
      if(expectedCount!==baselineCount)errors.push(`${table}: count ${expectedCount}; baseline ${baselineCount}`);
    }
  }
  return {ok:errors.length===0,errors};
}

function newHistoryRows(baseline,current) {
  const before=new Set((baseline.tables.coi_historial_oc||[]).map(row => JSON.stringify(stableValue(row))));
  return (current.tables.coi_historial_oc||[]).filter(row => !before.has(JSON.stringify(stableValue(row))));
}

async function hasAuthenticatedSession(page) {
  return page.evaluate(async () => {
    const client = window.__COI_SUPABASE_CLIENT__ ||
      (typeof window.getSupabaseClient === 'function' ? window.getSupabaseClient() : null);
    if (!client?.auth?.getSession) return false;
    const {data, error} = await client.auth.getSession();
    return !error && !!data?.session?.user;
  }).catch(() => false);
}

async function readEffectiveRole(page) {
  return page.evaluate(() => {
    let permission = null;
    try {
      permission = typeof window.usuarioTienePermisoEdicion === 'function'
        ? Boolean(window.usuarioTienePermisoEdicion())
        : null;
    } catch {}

    const role = String(window.APP_STATE?.role || '').trim().toLowerCase() || null;
    const headerMode = String(document.querySelector('#headerModoSistema')?.textContent || '').trim() || null;
    const adminButtonText = String(document.querySelector('#btnAdminMode')?.textContent || '').trim() || null;
    const editorApi = window.COI_ORDENES_EDIT_V60?.abrir;
    const editorSource = typeof editorApi === 'function' ? Function.prototype.toString.call(editorApi) : '';
    const editButton = document.querySelector('#btnEditarOCV60');

    return {
      appStateRole:role,
      effectiveLabel:role === 'administrador'
        ? 'Administrador'
        : role === 'jefatura'
          ? 'Jefatura'
          : role === 'visualizador'
            ? 'Visualizador'
            : 'Modo Consulta',
      headerMode,
      bodyModoAdmin:document.body.classList.contains('modo-admin'),
      bodyModoConsulta:document.body.classList.contains('modo-consulta'),
      adminButtonText,
      usuarioTienePermisoEdicion:permission,
      editorApiV60Available:typeof editorApi === 'function',
      editorApiChecksPermission:/usuarioTienePermisoEdicion|usuarioEsAdministrador|esModoAdmin/.test(editorSource),
      editButton:editButton ? {
        exists:true,
        disabled:Boolean(editButton.disabled),
        ariaDisabled:editButton.getAttribute('aria-disabled'),
        hidden:Boolean(editButton.hidden)
      } : {exists:false}
    };
  });
}

async function inspectAdminState(page, dialogs) {
  await page.waitForFunction(
    () => window.APP_STATE?.sessionChecked === true && window.APP_STATE?.user,
    null,
    {timeout:20000}
  );
  await page.waitForFunction(
    () => window.APP_STATE?.role === 'administrador',
    null,
    {timeout:20000}
  );

  const adminNav = page.locator('#btnAdministracionSistema');
  if (await adminNav.isVisible().catch(() => false)) await adminNav.click();
  else await page.evaluate(() => document.querySelector('#btnAdministracionSistema')?.click());

  await page.waitForFunction(() => {
    const view = document.querySelector('#vistaAdministracionSistema');
    const rect = view?.getBoundingClientRect();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }, null, {timeout:10000});
  await page.waitForFunction(
    () => document.querySelector('#adminRolActivo')?.textContent?.trim() === 'Administrador',
    null,
    {timeout:10000}
  );

  const snapshot = () => page.evaluate(async () => {
    const client = window.__COI_SUPABASE_CLIENT__ ||
      (typeof window.getSupabaseClient === 'function' ? window.getSupabaseClient() : null);
    const {data, error} = client?.auth?.getSession
      ? await client.auth.getSession()
      : {data:null, error:new Error('Cliente Supabase no disponible')};
    const user = data?.session?.user || null;
    const view = document.querySelector('#vistaAdministracionSistema');
    const button = document.querySelector('#btnAdminMode');
    const viewRect = view?.getBoundingClientRect();
    const buttonRect = button?.getBoundingClientRect();
    const roleStorageKeys = [
      'coi_admin_role_v47',
      'coi_rol_usuario',
      'rolUsuario',
      'coi_modo_usuario',
      'coi_modo_acceso_actual'
    ];
    const safeRoleStorage = Object.fromEntries(roleStorageKeys.map(key => [key, localStorage.getItem(key)]));
    let sessionAdmin = null;
    let legacyAdmin = null;
    try { sessionAdmin = typeof esSesionSupabaseAdministradorV573 === 'function' ? esSesionSupabaseAdministradorV573() : null; } catch {}
    try { legacyAdmin = typeof esModoAdmin === 'function' ? esModoAdmin() : null; } catch {}

    return {
      session:{
        hasSession:Boolean(data?.session),
        userPresent:Boolean(user),
        error:error?.message || null,
        appMetadataKeys:Object.keys(user?.app_metadata || {}).sort(),
        userMetadataKeys:Object.keys(user?.user_metadata || {}).sort()
      },
      appRole:window.APP_STATE?.role || null,
      sessionAdmin,
      legacyAdmin,
      viewVisible:Boolean(viewRect && viewRect.width > 0 && viewRect.height > 0 && getComputedStyle(view).display !== 'none'),
      roleBadge:document.querySelector('#adminRolActivo')?.textContent?.trim() || null,
      notice:document.querySelector('#adminAccessModeNotice')?.textContent?.trim() || null,
      button:button ? {
        text:button.textContent?.trim() || null,
        disabled:Boolean(button.disabled),
        pointerEvents:getComputedStyle(button).pointerEvents,
        width:buttonRect?.width || 0,
        height:buttonRect?.height || 0
      } : null,
      roleStorage:safeRoleStorage
    };
  });

  const beforeClick = await snapshot();
  const button = page.locator('#btnAdminMode');
  if (!(await button.isVisible())) throw new Error('El boton #btnAdminMode no esta visible en Administracion.');
  await button.click({timeout:4000});
  await page.waitForTimeout(400);
  const afterClick = await snapshot();

  const ok = beforeClick.session.hasSession &&
    beforeClick.session.userPresent &&
    beforeClick.appRole === 'administrador' &&
    beforeClick.sessionAdmin === true &&
    beforeClick.legacyAdmin === true &&
    beforeClick.viewVisible &&
    beforeClick.roleBadge === 'Administrador' &&
    /modo administrador activo/i.test(beforeClick.notice || '') &&
    beforeClick.button?.text === 'Administrador autenticado' &&
    !beforeClick.button?.disabled &&
    beforeClick.button?.pointerEvents !== 'none' &&
    dialogs.length === 0 &&
    afterClick.appRole === 'administrador' &&
    afterClick.roleBadge === 'Administrador' &&
    afterClick.button?.text === 'Administrador autenticado';

  report.adminState = {beforeClick, afterClick, dialogs:[...dialogs]};
  step('Consistencia Admin State',ok ? 'PASS':'FAIL',report.adminState);
  await page.screenshot({path:shot('admin-state'), fullPage:true});
  if (!ok) throw new Error('La UI de Administracion no coincide con la autorizacion Supabase efectiva.');
}

async function openOc(page, oc) {
  const fichaVisible = () => page.evaluate(() => {
    const view=document.querySelector('#vistaFichaOC');
    const body=document.querySelector('#fichaOCBody');
    const vr=view?.getBoundingClientRect();
    const br=body?.getBoundingClientRect();
    return Boolean(vr&&br&&vr.width>0&&vr.height>0&&br.width>0&&br.height>0);
  });
  const search = page.locator(config.ui.searchSelector).first();
  if(await search.count()) {
    await search.fill(oc);
    await page.waitForTimeout(700);
  }

  // Intento 1: texto exacto visible
  const exactMatches=page.getByText(oc,{exact:true});
  for(let i=0;i<await exactMatches.count()&&!await fichaVisible();i++){
    const exact=exactMatches.nth(i);
    if(!await exact.isVisible().catch(()=>false))continue;
    try{await exact.click({timeout:2500});await page.waitForTimeout(800);}catch{}
  }

  // Intento 2: cualquier elemento que contenga la OC
  if(!await fichaVisible()) {
    const anyMatches=page.getByText(oc,{exact:false});
    for(let i=0;i<Math.min(await anyMatches.count(),20)&&!await fichaVisible();i++){
      const any=anyMatches.nth(i);
      if(!await any.isVisible().catch(()=>false))continue;
      try{await any.click({timeout:2500});await page.waitForTimeout(800);}catch{}
    }
  }

  if(!await fichaVisible()){
    const opened=await page.evaluate(async reference => {
      if(typeof window.abrirFichaOC!=='function')return {ok:false,reason:'abrirFichaOC no disponible'};
      try{
        const result=window.abrirFichaOC(reference);
        if(result&&typeof result.then==='function')await result;
        await new Promise(resolve=>setTimeout(resolve,600));
        return {ok:result!==false};
      }catch(error){return {ok:false,reason:error?.message || String(error)}}
    },oc);
    if(!opened.ok)throw new Error(`No pude abrir la ficha de OC ${oc}: ${opened.reason || 'API devolvio false'}.`);
  }
  await page.waitForFunction(() => {
    const view=document.querySelector('#vistaFichaOC');
    const body=document.querySelector('#fichaOCBody');
    const vr=view?.getBoundingClientRect();
    const br=body?.getBoundingClientRect();
    return Boolean(vr&&br&&vr.width>0&&vr.height>0&&br.width>0&&br.height>0);
  },null,{timeout:7000});
  const edit=page.locator(config.ui.editButtonSelector).first();
  if(!(await edit.count())||!(await edit.isVisible().catch(()=>false))){
    throw new Error(`La ficha ${oc} esta visible pero Editar OC no esta disponible.`);
  }
}

async function ensureAuthenticated(page) {
  const deadline=Date.now()+20000;
  do {
    if (await hasAuthenticatedSession(page)) {
      step('Sesion STAGING','PASS','Sesion Supabase autenticada en el perfil QA.');
      return;
    }
    await page.waitForTimeout(500);
  } while(Date.now()<deadline);

  if(noPause) {
    throw new Error('El perfil QA no recupero una sesion Supabase valida dentro de 20 segundos.');
  }
  const text = await page.locator('body').innerText().catch(()=> '');
  const looksLogged =
    text.includes('SesiÃƒÆ’Ã‚Â³n Supabase activa') ||
    text.includes('Sesion Supabase activa') ||
    text.includes('AdministraciÃƒÆ’Ã‚Â³n del Sistema') ||
    text.includes('Ficha Individual de OC');

  if(looksLogged) {
    step('Sesion STAGING','PASS');
    return;
  }

  step('Sesion STAGING','WAIT','Se requiere login manual una unica vez en el perfil QA.');
  await waitEnter('Inicia sesion MANUALMENTE en la ventana de Chrome QA. No pegues la contraseÃƒÆ’Ã‚Â±a en PowerShell.');
  await page.reload({waitUntil:'domcontentloaded'});
  const postLoginDeadline=Date.now()+20000;
  let authenticated=false;
  do {
    authenticated=await hasAuthenticatedSession(page);
    if(authenticated)break;
    await page.waitForTimeout(500);
  } while(Date.now()<postLoginDeadline);
  if (!authenticated) {
    throw new Error('La sesion Supabase no quedo autenticada luego del login manual.');
  }
  step('Sesion STAGING','PASS','Sesion Supabase autenticada luego del login manual.');
}

async function inspectDirtyLegacy(page) {
  const editCandidates = page.locator(config.ui.editButtonSelector);
  const editCount = await editCandidates.count();
  let edit = null;

  for (let i = 0; i < editCount; i++) {
    const candidate = editCandidates.nth(i);
    if (await candidate.isVisible()) {
      edit = candidate;
      break;
    }
  }

  if (edit) {
    await edit.click();
  } else {
    const runtimeDiag = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      const chain = [];
      let node = el;
      while (node && chain.length < 8) {
        const cs = getComputedStyle(node);
        const r = node.getBoundingClientRect();
        chain.push({
          tag: node.tagName,
          id: node.id || null,
          className: typeof node.className === 'string' ? node.className : null,
          hidden: !!node.hidden,
          disabled: !!node.disabled,
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          width: r.width,
          height: r.height
        });
        node = node.parentElement;
      }
      return {
        selector,
        exists: !!el,
        chain,
        hasActivarModoEdicionOC: typeof window.activarModoEdicionOC === 'function',
        hasAbrirFichaOCEdicion: typeof window.abrirFichaOCEdicion === 'function',
        hasEditorV60: !!(window.COI_ORDENES_EDIT_V60 && typeof window.COI_ORDENES_EDIT_V60.abrir === 'function')
      };
    }, config.ui.editButtonSelector);

    console.warn('[COI QA] Editar OC no visible; diagnostico:', JSON.stringify(runtimeDiag));

    const opened = await page.evaluate(async (reference) => {
      const navBeforeEditor = async () => {
        try {
          if (typeof window.abrirFichaOC === 'function') {
            const r = window.abrirFichaOC(reference);
            if (r && typeof r.then === 'function') await r;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (_) {}
      };

      await navBeforeEditor();

      const fn =
        (window.COI_ORDENES_EDIT_V60 && typeof window.COI_ORDENES_EDIT_V60.abrir === 'function'
          ? (ref) => window.COI_ORDENES_EDIT_V60.abrir(ref)
          : null) ||
        (typeof window.abrirFichaOCEdicion === 'function' && window.abrirFichaOCEdicion) ||
        (typeof window.activarModoEdicionOC === 'function' && window.activarModoEdicionOC);

      if (!fn) return { ok: false, reason: 'No hay API publica del editor V60.' };

      try {
        const result = await fn(reference);
        return { ok: result !== false, resultType: typeof result };
      } catch (error) {
        return { ok: false, reason: error?.message || String(error) };
      }
    }, config.testOcOriginal);

    if (!opened?.ok) {
      throw new Error(`No se encontro un boton Editar OC visible y tampoco pudo abrirse el editor por API. Selector=${config.ui.editButtonSelector}; candidatos=${editCount}; detalle=${JSON.stringify(opened)}; diag=${JSON.stringify(runtimeDiag)}`);
    }

    const modalVisibleAfterApi = await page.locator(config.ui.editModalSelector).isVisible().catch(() => false);
    if (!modalVisibleAfterApi) {
      throw new Error(`La API del editor respondio pero ${config.ui.editModalSelector} no quedo visible.`);
    }

    console.warn('[COI QA] Fallback controlado: editor abierto por API publica V60 para aislar prueba DIRTY.');
  }
  const modal = page.locator(config.ui.editModalSelector);
  await modal.waitFor({state:'visible', timeout:7000});
  await page.waitForTimeout(1800);

  const badge = page.locator(config.ui.dirtyBadgeSelector);
  const dirtyText = (await badge.innerText()).trim();
  const diag = await page.evaluate(() => window.__COI_DIRTY_DIAG__ || null);
  await page.screenshot({path:shot('dirty-open'), fullPage:true});

  step('Estado dirty al abrir', /sin cambios pendientes/i.test(dirtyText) ? 'PASS':'FAIL', {dirtyText,diag});

  return {modal,badge,dirtyText,diag};
}

async function inspectDirty(page) {
  const modal = page.locator(config.ui.editModalSelector);
  const editCandidates = page.locator(config.ui.editButtonSelector);
  const editCount = await editCandidates.count();
  let edit = null;

  for (let i = 0; i < editCount; i++) {
    const candidate = editCandidates.nth(i);
    if (await candidate.isVisible()) {
      edit = candidate;
      break;
    }
  }

  const runtimeDiag = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    const chain = [];
    let node = el;
    while (node && chain.length < 8) {
      const cs = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      chain.push({
        tag:node.tagName,
        id:node.id || null,
        className:typeof node.className === 'string' ? node.className : null,
        hidden:!!node.hidden,
        disabled:!!node.disabled,
        display:cs.display,
        visibility:cs.visibility,
        opacity:cs.opacity,
        width:r.width,
        height:r.height
      });
      node = node.parentElement;
    }

    const rect = el?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : 0;
    const centerY = rect ? rect.top + rect.height / 2 : 0;
    const top = rect && rect.width > 0 && rect.height > 0
      ? document.elementFromPoint(centerX, centerY)
      : null;

    return {
      selector,
      exists:!!el,
      chain,
      topAtCenter:top ? {
        tag:top.tagName,
        id:top.id || null,
        className:typeof top.className === 'string' ? top.className : null
      } : null,
      targetOwnsCenter:!!(el && top && (top === el || el.contains(top))),
      onclickType:typeof el?.onclick,
      hasEditorV60:!!(window.COI_ORDENES_EDIT_V60 && typeof window.COI_ORDENES_EDIT_V60.abrir === 'function')
    };
  }, config.ui.editButtonSelector);

  let method = 'click-real';
  let clickError = null;
  let modalVisible = false;

  if (edit) {
    try {
      await edit.scrollIntoViewIfNeeded();
      await edit.click({timeout:3000});
      await modal.waitFor({state:'visible', timeout:3000});
      modalVisible = true;
    } catch (error) {
      clickError = error?.message || String(error);
    }
  }

  if (!modalVisible) {
    method = 'fallback-api-v60';
    report.fallbackUsed = true;
    console.warn('[COI QA] Click real no abrio el editor:', JSON.stringify({runtimeDiag, clickError}));

    const opened = await page.evaluate(async (reference) => {
      if (!window.COI_ORDENES_EDIT_V60 || typeof window.COI_ORDENES_EDIT_V60.abrir !== 'function') {
        return {ok:false, reason:'No hay API publica COI_ORDENES_EDIT_V60.abrir.'};
      }
      try {
        const result = await window.COI_ORDENES_EDIT_V60.abrir(reference);
        return {ok:result !== false, resultType:typeof result};
      } catch (error) {
        return {ok:false, reason:error?.message || String(error)};
      }
    }, config.testOcOriginal);

    if (!opened?.ok) {
      throw new Error(`No se pudo abrir el editor por click ni por API V60. clickError=${clickError}; api=${JSON.stringify(opened)}; diag=${JSON.stringify(runtimeDiag)}`);
    }
    await modal.waitFor({state:'visible', timeout:7000});
  }

  step('Abrir editor OC','PASS',{
    method,
    fallbackUsed:report.fallbackUsed,
    editCount,
    runtimeDiag,
    clickError
  });

  await page.waitForTimeout(1800);
  const badge = page.locator(config.ui.dirtyBadgeSelector);
  const dirtyText = (await badge.innerText()).trim();
  const save = modal.locator(config.ui.saveButtonSelector).first();
  if (!(await save.count())) throw new Error(`No existe ${config.ui.saveButtonSelector} dentro del editor.`);
  const saveDisabled = await save.isDisabled();
  const diag = await page.evaluate(() => window.__COI_DIRTY_DIAG__ || null);
  await page.screenshot({path:shot('dirty-open'), fullPage:true});

  step('Estado dirty al abrir',/sin cambios pendientes/i.test(dirtyText) ? 'PASS':'FAIL',{dirtyText,diag});
  step('Guardar deshabilitado al abrir',saveDisabled ? 'PASS':'FAIL',{disabled:saveDisabled});
  if (!saveDisabled) throw new Error('Guardar cambios esta habilitado al abrir un editor limpio.');

  return {modal,badge,save,dirtyText,diag};
}

async function testDirtyTransitions(page, state) {
  const provider = state.modal.locator(config.ui.providerFieldSelector).first();
  if(!(await provider.count())) {
    step('Transicion dirty por proveedor','FAIL','No encontre campo proveedor editable.');
    throw new Error(`No existe ${config.ui.providerFieldSelector}.`);
  }
  const original = await provider.inputValue();
  const temp = original + ' X';
  await provider.fill(temp);
  await page.waitForFunction(
    selector => /cambios pendientes/i.test(document.querySelector(selector)?.textContent || '') &&
      !/sin cambios pendientes/i.test(document.querySelector(selector)?.textContent || ''),
    config.ui.dirtyBadgeSelector,
    {timeout:3000}
  );
  const afterChange = (await state.badge.innerText()).trim();
  await provider.fill(original);
  await page.waitForFunction(
    selector => /sin cambios pendientes/i.test(document.querySelector(selector)?.textContent || ''),
    config.ui.dirtyBadgeSelector,
    {timeout:3000}
  );
  const afterRestore = (await state.badge.innerText()).trim();
  const restoredValue = await provider.inputValue();
  const saveDisabledAfterRestore = await state.save.isDisabled();

  const ok1 = /cambios pendientes/i.test(afterChange) && !/sin cambios pendientes/i.test(afterChange);
  const ok2 = /sin cambios pendientes/i.test(afterRestore) &&
    restoredValue === original && saveDisabledAfterRestore;
  step('dirty tras modificar campo', ok1 ? 'PASS':'FAIL', afterChange);
  step('dirty tras restaurar valor', ok2 ? 'PASS':'FAIL',{
    afterRestore,
    restoredExactly:restoredValue === original,
    saveDisabled:saveDisabledAfterRestore
  });
  if (!ok1 || !ok2) throw new Error('La transicion dirty/restauracion no cumplio el contrato esperado.');
}

async function closeDirtyEditor(page, state) {
  const cancel = state.modal.locator('[data-coi-edit-cancel]').first();
  if (!(await cancel.count())) throw new Error('No existe el boton Cancelar del editor.');
  await cancel.click();
  await state.modal.waitFor({state:'hidden', timeout:3000});
  const closed = !(await state.modal.isVisible().catch(() => false));
  step('Cerrar editor sin guardar',closed ? 'PASS':'FAIL',{closed});
  if (!closed) throw new Error('El editor no se cerro sin guardar.');
}

async function pollMaster(page,predicate,{timeout=15000,interval=350}={}) {
  const started=Date.now();
  let last=null;
  while(Date.now()-started<timeout){
    last=await page.evaluate(async id => {
      const client=window.__COI_SUPABASE_CLIENT__ ||
        (typeof window.getSupabaseClient==='function'?window.getSupabaseClient():null);
      if(!client)return {ok:false,reason:'Cliente Supabase no disponible.'};
      const {data,error}=await client.from('coi_ordenes').select('*').eq('id',id).single();
      return error?{ok:false,reason:error.message || String(error)}:{ok:true,row:data};
    },config.testOcUuid);
    if(last?.ok&&predicate(last.row))return last.row;
    await page.waitForTimeout(interval);
  }
  throw new Error(`Timeout esperando estado remoto de la OC. Ultimo=${JSON.stringify(last)}`);
}

async function reloadAndOpen(page,oc) {
  await page.reload({waitUntil:'domcontentloaded'});
  await ensureAuthenticated(page);
  await page.waitForFunction(() => window.APP_STATE?.sessionChecked === true,{timeout:20000});
  await page.waitForTimeout(700);
  await openOc(page,oc);
  const body=await page.locator('body').innerText();
  const visible=body.includes(oc);
  step(`Recarga HTML recupera ${oc}`,visible?'PASS':'FAIL',{visible});
  if(!visible)throw new Error(`La OC ${oc} no quedo visible luego de recargar STAGING.`);
}

async function runRenumber(page, fromOc, toOc, reason, baseline) {
  await verifyStagingProjectRef(page);
  const button = page.locator(config.ui.renumberButtonSelector).first();
  if(!(await button.count())) throw new Error('No encontre boton data-coi-renumber.');
  if(await button.isDisabled()) throw new Error('Boton de renumeracion esta deshabilitado.');

  const dialogAnswers = [toOc, reason];
  let dialogIndex = 0;
  const handler = async dialog => {
    try {
      if(dialog.type() === 'prompt') {
        const ans = dialogAnswers[dialogIndex++] ?? '';
        await dialog.accept(ans);
      } else {
        await dialog.accept();
      }
    } catch {}
  };
  page.on('dialog',handler);
  try{
    await button.click();
    await pollMaster(page,row => String(row?.nro_oc||'')===toOc);
  }finally{
    page.off('dialog',handler);
  }

  const direct=await readFixtureState(page);
  const integrity=validateFixtureNumber(direct,toOc,baseline);
  await page.screenshot({path:shot(`renumber-${fromOc}-to-${toOc}`), fullPage:true});
  step(`Renumeracion ${fromOc} -> ${toOc}`,integrity.ok?'PASS':'FAIL',{
    uuid:direct.master[0]?.id || null,
    integrityErrors:integrity.errors,
    tables:fixtureSummary(direct).tables
  });
  if(!integrity.ok)throw new Error(`Integridad de renumeracion fallida: ${integrity.errors.join(' | ')}`);
  await reloadAndOpen(page,toOc);
  return direct;
}

async function openCleanEditor(page,oc) {
  await openOc(page,oc);
  const state=await inspectDirty(page);
  if(!/sin cambios pendientes/i.test(state.dirtyText))throw new Error(`Editor de ${oc} no abrio limpio: ${state.dirtyText}`);
  return state;
}

async function saveObservationViaUi(page,oc,value) {
  const state=await openCleanEditor(page,oc);
  const field=state.modal.locator("[data-coi-edit-field='observaciones']").first();
  if(!(await field.count()))throw new Error('No existe el campo editable observaciones.');
  await field.fill(value == null ? '' : String(value));
  await page.waitForFunction(
    selector => /cambios pendientes/i.test(document.querySelector(selector)?.textContent || '') &&
      !/sin cambios pendientes/i.test(document.querySelector(selector)?.textContent || ''),
    config.ui.dirtyBadgeSelector,
    {timeout:3000}
  );
  await verifyStagingProjectRef(page);
  await state.save.click();
  const expected=value == null || value===''?null:String(value);
  try{
    await pollMaster(page,row => (row?.observaciones ?? null)===expected,{timeout:10000});
  }catch(error){
    const uiError=await page.locator('#coiEditErrorV60').innerText().catch(()=> '');
    throw new Error(`${error.message} UI=${uiError || '<sin mensaje>'}`);
  }
  step(`Guardar observaciones via HTML (${expected===TEMP_OBSERVATION?'temporal':'restauracion'})`,'PASS');
}

async function verifyObservationReload(page,oc,expected) {
  await reloadAndOpen(page,oc);
  const state=await inspectDirty(page);
  const field=state.modal.locator("[data-coi-edit-field='observaciones']").first();
  const value=await field.inputValue();
  const wanted=expected == null?'':String(expected);
  const ok=value===wanted;
  step('Recarga recupera observaciones desde Supabase',ok?'PASS':'FAIL',{matches:ok,length:value.length});
  await closeDirtyEditor(page,state);
  if(!ok)throw new Error('La observacion recargada no coincide con Supabase.');
}

async function inspectAdminNegative(page) {
  const result=await page.evaluate(({resolverSource,permissionSource,legacyFindings}) => {
    const fakeUser={
      id:'00000000-0000-4000-8000-000000000000',
      email:'qa-no-admin@example.invalid',
      app_metadata:{role:'administrador'},
      user_metadata:{role:'administrador'}
    };
    const direct=typeof window.esUsuarioSupabaseAdministradorR12==='function'
      ? Boolean(window.esUsuarioSupabaseAdministradorR12(fakeUser))
      : null;
    if(!resolverSource||!permissionSource)return {ok:false,reason:'No se pudieron extraer los helpers de autorizacion del HTML cargado',direct};
    const simulate=({bodyAdmin=false,storage={}}={}) => {
      const fakeWindow={
        esUsuarioSupabaseAdministradorR12:user => String(user?.email||'').trim().toLowerCase()==='admin@coiroca.com',
        esAdminR13:()=>false,
        usuarioEsAdministrador:()=>false
      };
      const fakeDocument={body:{classList:{contains:name=>bodyAdmin&&name==='modo-admin'}}};
      const fakeStorage={getItem:key=>Object.hasOwn(storage,key)?storage[key]:null};
      const clean=value=>String(value??'').trim();
      return Function('usuario','window','document','localStorage','clean',`return (${resolverSource})(usuario);`)(fakeUser,fakeWindow,fakeDocument,fakeStorage,clean);
    };
    const neutralRole=simulate();
    const legacyStorageRole=simulate({storage:{coi_rol_usuario:'administrador'}});
    const legacyBodyRole=simulate({bodyAdmin:true});
    const protectedControlAllowed=Function('window',`return (${permissionSource})();`)({
      APP_STATE:{role:'administrador'},
      esAutorizacionAdministrativaSupabaseV60:()=>false
    });
    return {
      ok:direct===false&&neutralRole==='consulta'&&legacyStorageRole==='consulta'&&legacyBodyRole==='consulta'&&protectedControlAllowed===false&&legacyFindings.length===0,
      direct,
      neutralRole,
      legacyStorageRole,
      legacyBodyRole,
      protectedControlAllowed,
      resolverUsesLegacy:/localStorage|modo-admin|esAdminR13|usuarioEsAdministrador/.test(resolverSource),
      legacyGrantFindings:legacyFindings
    };
  },{resolverSource:adminResolverSource,permissionSource:adminPermissionSource,legacyFindings:legacyGrantFindings});
  step('Admin negativo aislado',result.ok?'PASS':'FAIL',result);
  return result;
}

async function recoverFixture(page,baseline) {
  const recovery={attempted:true,actions:[],errors:[]};
  try{
    await verifyStagingProjectRef(page);
    const current=await pollMaster(page,()=>true,{timeout:5000});
    if(String(current.nro_oc||'')!==config.testOcOriginal){
      const result=await page.evaluate(async ({id,originalOc}) => {
        const client=window.__COI_SUPABASE_CLIENT__ ||
          (typeof window.getSupabaseClient==='function'?window.getSupabaseClient():null);
        const {data,error}=await client.rpc('coi_renumerar_oc',{
          p_orden_id:id,
          p_nuevo_nro_oc:originalOc,
          p_motivo:'Recuperacion automatica QA RC2 E2E'
        });
        return error?{ok:false,error:error.message || String(error)}:{ok:true,data};
      },{id:config.testOcUuid,originalOc:config.testOcOriginal});
      if(!result.ok)throw new Error(`Recovery renumeracion: ${result.error}`);
      await pollMaster(page,row=>String(row?.nro_oc||'')===config.testOcOriginal);
      recovery.actions.push('nro_oc restaurado');
    }
    const normalizeObservation=value=>value == null || value === '' ? null : value;
    const originalObservation=normalizeObservation(baseline.master[0]?.observaciones);
    const afterNumber=await pollMaster(page,()=>true,{timeout:5000});
    if(normalizeObservation(afterNumber.observaciones)!==originalObservation){
      await verifyStagingProjectRef(page);
      const restored=await page.evaluate(async ({id,value}) => {
        if(!window.COI_ORDENES_EDIT_V60?.actualizar)return {ok:false,error:'API V60 actualizar no disponible'};
        try{
          const result=await window.COI_ORDENES_EDIT_V60.actualizar(id,{observaciones:value});
          return {ok:Boolean(result?.ok),fields:result?.fields || [],error:result?.ok?null:'actualizar devolvio fallo'};
        }catch(error){return {ok:false,error:error?.message || String(error)}}
      },{id:config.testOcUuid,value:originalObservation});
      if(!restored.ok)throw new Error(`Recovery observaciones: ${restored.error}`);
      await pollMaster(page,row=>normalizeObservation(row?.observaciones)===originalObservation);
      recovery.actions.push('observaciones restauradas');
    }
  }catch(error){
    recovery.errors.push(error?.message || String(error));
  }
  const finalState=await readFixtureState(page).catch(error => ({error:error?.message || String(error)}));
  recovery.finalState=finalState.error?{error:finalState.error}:fixtureSummary(finalState);
  recovery.ok=!recovery.errors.length&&!finalState.error&&validateFixtureNumber(finalState,config.testOcOriginal,baseline).ok&&
    valueHash(businessSnapshot(finalState))===valueHash(businessSnapshot(baseline));
  step('Recuperacion final independiente',recovery.ok?'PASS':'FAIL',recovery);
  return {recovery,finalState};
}

async function runFullE2E(page,initialEditor,businessWriteRequests) {
  const failures=[];
  const baseline=await readFixtureState(page);
  const baselineValidation=validateFixtureNumber(baseline,config.testOcOriginal,baseline);
  if(!baselineValidation.ok)throw new Error(`Fixture inicial invalida: ${baselineValidation.errors.join(' | ')}`);
  report.fullE2E={baseline:fixtureSummary(baseline),tests:{}};
  step('Snapshot inicial completo OC QA','PASS',report.fullE2E.baseline);

  try{
    try{
      const outbound=await runRenumber(page,config.testOcOriginal,config.testOcTemporary,'QA RC2 E2E - ida controlada',baseline);
      const outboundHistory=newHistoryRows(baseline,outbound).filter(row =>
        String(row?.campo_modificado||'')==='nro_oc'&&
        String(row?.valor_anterior||'')===config.testOcOriginal&&
        String(row?.valor_nuevo||'')===config.testOcTemporary
      );
      if(!outboundHistory.length)throw new Error('No se encontro historial funcional de la renumeracion de ida.');
      const reverseEditor=await openCleanEditor(page,config.testOcTemporary);
      const reversed=await runRenumber(page,config.testOcTemporary,config.testOcOriginal,'QA RC2 E2E - reversion controlada',baseline);
      void reverseEditor;
      const historyDelta=newHistoryRows(baseline,reversed).filter(row => String(row?.campo_modificado||'')==='nro_oc');
      const hasReturn=historyDelta.some(row =>
        String(row?.valor_anterior||'')===config.testOcTemporary&&
        String(row?.valor_nuevo||'')===config.testOcOriginal
      );
      if(!hasReturn)throw new Error('No se encontro historial funcional de la renumeracion de vuelta.');
      await reloadAndOpen(page,config.testOcOriginal);
      report.fullE2E.tests.renumber={ok:true,historyCreated:historyDelta.length};
      step('E2E renumeracion/reversion','PASS',{historyCreated:historyDelta.length});
    }catch(error){
      failures.push(`Renumeracion: ${error?.message || error}`);
      report.fullE2E.tests.renumber={ok:false,error:error?.message || String(error)};
      step('E2E renumeracion/reversion','FAIL',report.fullE2E.tests.renumber);
    }

    try{
      const current=await pollMaster(page,()=>true,{timeout:5000});
      if(String(current.nro_oc||'')!==config.testOcOriginal)throw new Error('La OC no esta restaurada antes de Test B.');
      const originalObservation=baseline.master[0]?.observaciones ?? null;
      await saveObservationViaUi(page,config.testOcOriginal,TEMP_OBSERVATION);
      await verifyObservationReload(page,config.testOcOriginal,TEMP_OBSERVATION);
      await saveObservationViaUi(page,config.testOcOriginal,originalObservation);
      await verifyObservationReload(page,config.testOcOriginal,originalObservation);
      report.fullE2E.tests.ordinaryEdit={ok:true};
      step('E2E edicion ordinaria persistente','PASS');
    }catch(error){
      failures.push(`Edicion ordinaria: ${error?.message || error}`);
      report.fullE2E.tests.ordinaryEdit={ok:false,error:error?.message || String(error)};
      step('E2E edicion ordinaria persistente','FAIL',report.fullE2E.tests.ordinaryEdit);
    }

    try{
      const negative=await inspectAdminNegative(page);
      report.fullE2E.tests.adminNegative=negative;
      if(!negative.ok)throw new Error('La resolucion de rol admite autoridad administrativa legacy fuera de Supabase.');
    }catch(error){
      failures.push(`Admin negativo: ${error?.message || error}`);
      report.fullE2E.tests.adminNegative={...(report.fullE2E.tests.adminNegative||{}),ok:false,error:error?.message || String(error)};
    }
  }finally{
    const {recovery,finalState}=await recoverFixture(page,baseline);
    report.fullE2E.recovery=recovery;
    if(!recovery.ok)failures.push(`Recovery: ${recovery.errors.join(' | ') || 'estado final no equivalente'}`);
    if(!finalState.error){
      const historyDelta=newHistoryRows(baseline,finalState).filter(row => String(row?.campo_modificado||'')==='nro_oc');
      report.fullE2E.historyGenerated=historyDelta.map(row => ({
        tipo_evento:row.tipo_evento || null,
        campo_modificado:row.campo_modificado || null,
        valor_anterior:row.valor_anterior ?? null,
        valor_nuevo:row.valor_nuevo ?? null,
        nro_oc:row.nro_oc || null,
        fecha_evento:row.fecha_evento || row.created_at || null
      }));
    }
  }

  report.businessWriteRequests=businessWriteRequests;
  step('Writes limitados a STAGING',businessWriteRequests.every(req => req.host===`${config.stagingProjectRef}.supabase.co`)?'PASS':'FAIL',{
    count:businessWriteRequests.length,
    requests:businessWriteRequests
  });
  if(failures.length)throw new Error(failures.join(' || '));
}

let context;
try {
  const chrome = await findChromeExecutable();
  if(!chrome) throw new Error('No encontre Google Chrome instalado.');

  const profileDir = path.join(qaDir,'chrome-profile');
  const url = `http://${config.localHost}:${config.localPort}/${config.stagingHtml}`;

  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chrome,
    headless: false,
    viewport: {width: 1500, height: 950}
  });
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', {cacheDisabled:true});
  await cdp.send('Network.clearBrowserCache');
  const businessWriteRequests = [];
  const dialogs = [];
  if (mode === 'admin-state') {
    page.on('dialog', async dialog => {
      dialogs.push({type:dialog.type(), message:String(dialog.message() || '').slice(0,300)});
      await dialog.dismiss();
    });
  }
  page.on('request', request => {
    const method = request.method().toUpperCase();
    const requestUrl = request.url();
    if (!['POST','PUT','PATCH','DELETE'].includes(method)) return;
    if (!requestUrl.startsWith(`https://${config.stagingProjectRef}.supabase.co/`)) return;
    const pathname = (() => {
      try { return new URL(requestUrl).pathname; }
      catch { return requestUrl; }
    })();
    if (!pathname.startsWith('/rest/v1/') && !pathname.startsWith('/storage/v1/')) return;
    let host=null;
    try{host=new URL(requestUrl).hostname;}catch{}
    businessWriteRequests.push({method,host,pathname});
  });
  if (mode !== 'full') {
    await context.route(`https://${config.stagingProjectRef}.supabase.co/**`, async route => {
      const request = route.request();
      const method = request.method().toUpperCase();
      const pathname = (() => {
        try { return new URL(request.url()).pathname; }
        catch { return request.url(); }
      })();
      if (['POST','PUT','PATCH','DELETE'].includes(method) &&
          (pathname.startsWith('/rest/v1/') || pathname.startsWith('/storage/v1/'))) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
  }
  await page.goto(url, {waitUntil:'domcontentloaded'});
  step('Abrir STAGING','PASS',url);

  await ensureAuthenticated(page);
  if (mode === 'admin-state') {
    await inspectAdminState(page, dialogs);
    report.businessWriteRequests = businessWriteRequests;
    const noWrites = businessWriteRequests.length === 0;
    step('Sin requests de escritura Supabase',noWrites ? 'PASS':'FAIL',{requests:businessWriteRequests});
    if (!noWrites) throw new Error('Admin State genero requests de escritura contra Supabase.');
    report.success = report.steps.every(item => item.status !== 'FAIL');
    saveReport();
  } else {
  const effectiveRole = await readEffectiveRole(page);
  report.effectiveRole = effectiveRole;
  step('Rol efectivo COI','PASS',effectiveRole);
  const dbBefore = await readDbSnapshot(page);
  step('Fixture DB inicial','PASS',snapshotSummary(dbBefore));
  await openOc(page, config.testOcOriginal);
  const roleAtFicha = await readEffectiveRole(page);
  report.roleAtFicha = roleAtFicha;
  step('Permiso de editor en ficha','PASS',roleAtFicha);

  const fichaReady = await page.evaluate(async (reference) => {
    const snapshot = () => {
      const view = document.querySelector('#vistaFichaOC');
      const body = document.querySelector('#fichaOCBody');
      const vr = view?.getBoundingClientRect();
      const br = body?.getBoundingClientRect();
      return {
        viewExists: !!view,
        bodyExists: !!body,
        viewActive: !!view?.classList.contains('active'),
        viewDisplay: view ? getComputedStyle(view).display : null,
        viewWidth: vr?.width || 0,
        viewHeight: vr?.height || 0,
        bodyWidth: br?.width || 0,
        bodyHeight: br?.height || 0
      };
    };

    let state = snapshot();

    if (!(state.viewWidth > 0 && state.viewHeight > 0 && state.bodyWidth > 0 && state.bodyHeight > 0)) {
      if (typeof window.abrirFichaOC === 'function') {
        try {
          const r = window.abrirFichaOC(reference);
          if (r && typeof r.then === 'function') await r;
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 700));
        state = snapshot();
      }
    }

    return state;
  }, config.testOcOriginal);

  if (!(fichaReady.viewWidth > 0 && fichaReady.viewHeight > 0 && fichaReady.bodyWidth > 0 && fichaReady.bodyHeight > 0)) {
    throw new Error(`La OC fue localizada pero la ficha no quedo visible. Estado=${JSON.stringify(fichaReady)}`);
  }

  step('Abrir OC de prueba','PASS',{nro_oc:config.testOcOriginal, geometry:fichaReady});

  const state = await inspectDirty(page);
  if(!/sin cambios pendientes/i.test(state.dirtyText)) {
    report.success = false;
    saveReport();
    console.error('\nFAIL: el editor queda dirty apenas se abre. No se ejecutan escrituras.');
    process.exitCode = 2;
  } else {
    await testDirtyTransitions(page, state);

    if(mode === 'dirty') {
      await closeDirtyEditor(page, state);
      const dbAfter = await readDbSnapshot(page);
      const dbUnchanged = dbBefore.serialized === dbAfter.serialized;
      step('DB sin cambios',dbUnchanged ? 'PASS':'FAIL',{
        unchanged:dbUnchanged,
        before:snapshotSummary(dbBefore),
        after:snapshotSummary(dbAfter)
      });
      if (!dbUnchanged) throw new Error('La fila de la fixture cambio durante UiDirty.');

      report.businessWriteRequests = businessWriteRequests;
      const noWrites = businessWriteRequests.length === 0;
      step('Sin requests de escritura Supabase',noWrites ? 'PASS':'FAIL',{requests:businessWriteRequests});
      if (!noWrites) throw new Error('UiDirty genero requests de escritura contra Supabase.');
      await page.screenshot({path:shot('dirty-final'), fullPage:true});
    } else if(mode === 'full') {
      // Debe haber quedado sin cambios luego de restaurar proveedor
      const currentDirty = (await state.badge.innerText()).trim();
      if(!/sin cambios pendientes/i.test(currentDirty)) {
        throw new Error('No ejecuto E2E: el editor sigue dirty antes de renumerar.');
      }

      await runFullE2E(page,state,businessWriteRequests);
    }

    report.success = report.steps.every(s => !['FAIL'].includes(s.status));
    saveReport();
    if(!report.success) process.exitCode = 2;
  }
  }
} catch(err) {
  step('Excepcion UI','FAIL',String(err && err.stack || err));
  report.success = false;
  saveReport();
  process.exitCode = 2;
} finally {
  if(context) {
    if(!noPause) await waitEnter('QA terminada. Revisa la ventana y los resultados.').catch(()=>{});
    await context.close().catch(()=>{});
  }
}
