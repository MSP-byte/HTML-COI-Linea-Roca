import fs from 'node:fs';

const path = 'index.html';
let html = fs.readFileSync(path, 'utf8');
const marker = 'id="coi-admin-session-button-bridge"';
if (html.includes(marker)) throw new Error('Guardrail: bridge ya instalado.');

const anchor = '</body></html>';
const count = html.split(anchor).length - 1;
if (count !== 1) throw new Error(`Guardrail: se esperaba 1 cierre </body></html> y se encontraron ${count}.`);

const bridge = String.raw`
<script id="coi-admin-session-button-bridge">
(function(){
  'use strict';
  const BUTTON_ID='btnAdminMode';
  function snapshot(){
    const state=window.APP_STATE||{};
    const user=state.user||null;
    const authenticated=state.sessionChecked===true&&Boolean(user);
    let admin=false;
    try{admin=authenticated&&typeof window.esAutorizacionAdministrativaSupabaseV60==='function'&&window.esAutorizacionAdministrativaSupabaseV60()===true;}catch(_){admin=false;}
    return{authenticated,admin,email:String(user?.email||'').trim()};
  }
  function setMsg(text,kind){
    if(typeof window.adminSetMsg==='function'){window.adminSetMsg(text,kind);return;}
    if(typeof window.coiToast==='function'){window.coiToast(text,kind==='err'?'error':kind==='ok'?'ok':'warning');}
  }
  function sync(){
    const btn=document.getElementById(BUTTON_ID);if(!btn)return;
    const s=snapshot();
    btn.dataset.supabaseAuth=s.admin?'admin':s.authenticated?'authenticated':'anonymous';
    if(s.admin){
      btn.textContent='Administrador autenticado';
      btn.title='Rol Administrador otorgado por la sesión Supabase activa';
      btn.setAttribute('aria-label',btn.title);
      return;
    }
    if(s.authenticated){
      btn.textContent='Sin permisos de administrador';
      btn.title='La sesión Supabase activa no posee rol Administrador';
      btn.setAttribute('aria-label',btn.title);
      return;
    }
    btn.textContent='Iniciar sesión';
    btn.title='Iniciar sesión con Supabase';
    btn.setAttribute('aria-label',btn.title);
  }
  function openSupabaseLogin(){
    const login=document.getElementById('btnSupabaseLogin');
    if(login&&!login.hidden){login.click();return true;}
    const shell=document.getElementById('coiV2AuthButton');
    if(shell){shell.click();return true;}
    return false;
  }
  document.addEventListener('click',function(event){
    const btn=event.target?.closest?.('#'+BUTTON_ID);if(!btn)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    const s=snapshot();
    if(!s.authenticated){
      if(!openSupabaseLogin())setMsg('Inicie sesión en Supabase para acceder al sistema.','warn');
      setTimeout(sync,0);setTimeout(sync,500);return;
    }
    if(s.admin){
      setMsg('Sesión Supabase activa con rol Administrador.','ok');
      if(typeof window.actualizarUIModoAcceso==='function')window.actualizarUIModoAcceso();
      if(typeof window.renderAdministracionSistema==='function')window.renderAdministracionSistema();
      setTimeout(sync,0);return;
    }
    const who=s.email?` (${s.email})`:'';
    setMsg(`La sesión Supabase actual${who} no posee rol Administrador. Cierre sesión e ingrese con una cuenta administradora.`,'err');
    setTimeout(sync,0);
  },true);
  function init(){sync();const root=document.body||document.documentElement;if(root){new MutationObserver(sync).observe(root,{subtree:true,childList:true});}setInterval(sync,1500);}
  window.COI_ADMIN_SESSION_UI={snapshot,sync,openSupabaseLogin};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
</script>
`;

html = html.replace(anchor, bridge + '\n' + anchor);
fs.writeFileSync(path, html, 'utf8');

const verify = fs.readFileSync(path, 'utf8');
for (const token of [marker,"btn.textContent='Administrador autenticado'","btn.textContent='Sin permisos de administrador'","btn.textContent='Iniciar sesión'","window.COI_ADMIN_SESSION_UI={snapshot,sync,openSupabaseLogin}"]) {
  if (!verify.includes(token)) throw new Error(`Verificación posterior falló: ${token}`);
}
console.log('Hotfix admin-session button aplicado con guardrails.');
