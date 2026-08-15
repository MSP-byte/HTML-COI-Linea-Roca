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
const logs = path.join(qaDir, 'logs');
fs.mkdirSync(logs, {recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const reportPath = path.join(logs, `ui-${mode}-${stamp}.json`);
const shot = name => path.join(logs, `${stamp}-${name}.png`);

const report = {
  mode,
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
  const search = page.locator(config.ui.searchSelector).first();
  if(await search.count()) {
    await search.fill(oc);
    await page.waitForTimeout(700);
  }

  // Intento 1: texto exacto visible
  const exact = page.getByText(oc, {exact:true}).first();
  if(await exact.count()) {
    try {
      await exact.click({timeout:2500});
      await page.waitForTimeout(800);
    } catch {}
  }

  // Intento 2: cualquier elemento que contenga la OC
  if(!(await page.locator(config.ui.editButtonSelector).count())) {
    const any = page.getByText(oc, {exact:false}).first();
    if(await any.count()) {
      try {
        await any.click({timeout:2500});
        await page.waitForTimeout(800);
      } catch {}
    }
  }

  if(!(await page.locator(config.ui.editButtonSelector).count())) {
    throw new Error(`No pude abrir automaticamente la ficha de OC ${oc}.`);
  }
}

async function ensureAuthenticated(page) {
  await page.waitForTimeout(1200);
  if (await hasAuthenticatedSession(page)) {
    step('Sesion STAGING','PASS','Sesion Supabase autenticada en el perfil QA.');
    return;
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
  await page.waitForTimeout(1000);
  if (!(await hasAuthenticatedSession(page))) {
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

async function runRenumber(page, fromOc, toOc, reason) {
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
  page.on('dialog', handler);
  await button.click();
  await page.waitForTimeout(2200);
  page.off('dialog', handler);

  const body = await page.locator('body').innerText();
  const ok = body.includes(toOc);
  await page.screenshot({path:shot(`renumber-${fromOc}-to-${toOc}`), fullPage:true});
  step(`Renumeracion ${fromOc} -> ${toOc}`, ok ? 'PASS':'FAIL', {visible:ok});
  if(!ok) throw new Error(`La UI no muestra ${toOc} luego de renumerar.`);

  // Persistencia: reload y volver a buscar
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  await openOc(page, toOc);
  const persisted = (await page.locator('body').innerText()).includes(toOc);
  step(`Persistencia tras reload ${toOc}`, persisted ? 'PASS':'FAIL');
  if(!persisted) throw new Error(`La OC ${toOc} no persistio tras reload.`);

  // Abrir editor para siguiente operacion
  await page.locator(config.ui.editButtonSelector).first().click();
  await page.locator(config.ui.editModalSelector).waitFor({state:'visible', timeout:7000});
  await page.waitForTimeout(700);
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
    businessWriteRequests.push({method, pathname});
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

      await runRenumber(
        page,
        config.testOcOriginal,
        config.testOcTemporary,
        'Prueba automatizada COI STAGING DOCTOR'
      );

      // El modal ya queda abierto tras runRenumber
      await runRenumber(
        page,
        config.testOcTemporary,
        config.testOcOriginal,
        'Reversion automatizada COI STAGING DOCTOR'
      );

      step('Estado final OC original','PASS',config.testOcOriginal);
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
