import fs from 'fs';

const file = 'index.html';
let html = fs.readFileSync(file, 'utf8');

function replaceOnce(label, before, after) {
  const first = html.indexOf(before);
  if (first < 0) throw new Error(`[${label}] bloque origen no encontrado`);
  if (html.indexOf(before, first + before.length) >= 0) throw new Error(`[${label}] bloque origen duplicado; abortando por seguridad`);
  html = html.slice(0, first) + after + html.slice(first + before.length);
}

const oldLogin = `function iniciarSesionAdministrador(){
  modoAccesoActual=esSesionSupabaseAdministradorV573()?"admin":"consulta";
  try{sessionStorage.removeItem("coi_modo_acceso_actual");}catch(e){}
  actualizarUIModoAcceso();
  return esModoAdmin();
}`;

const newLogin = `function prepararModalLoginAdministradorV573(){
  const modal=document.getElementById("supabaseAuthModal");
  if(!modal) return null;
  const titulo=document.getElementById("supabaseAuthTitle");
  if(titulo) titulo.textContent="Acceso de Administrador";
  const intro=modal.querySelector(".supabase-auth-head p");
  if(intro) intro.textContent="Ingresá con una cuenta Supabase que tenga rol Administrador habilitado para COI Línea Roca.";
  const errorEl=document.getElementById("supabaseLoginError");
  if(errorEl) errorEl.textContent="";
  return modal;
}
async function verificarResultadoLoginAdministradorV573(){
  const esperar=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  for(let intento=0;intento<32;intento++){
    await esperar(250);
    if(esSesionSupabaseAdministradorV573()){
      modoAccesoActual="admin";
      actualizarUIModoAcceso();
      if(typeof adminSetMsg==="function") adminSetMsg("Administrador autenticado correctamente mediante Supabase.","ok");
      if(typeof renderAdministracionSistema==="function") renderAdministracionSistema();
      return true;
    }
    const modal=document.getElementById("supabaseAuthModal");
    if(modal?.hidden){
      await esperar(450);
      if(esSesionSupabaseAdministradorV573()){
        modoAccesoActual="admin";
        actualizarUIModoAcceso();
        if(typeof adminSetMsg==="function") adminSetMsg("Administrador autenticado correctamente mediante Supabase.","ok");
        if(typeof renderAdministracionSistema==="function") renderAdministracionSistema();
        return true;
      }
      modoAccesoActual="consulta";
      actualizarUIModoAcceso();
      if(window.APP_STATE?.user && typeof adminSetMsg==="function") adminSetMsg("El usuario autenticado no posee permisos de Administrador.","err");
      if(typeof renderAdministracionSistema==="function") renderAdministracionSistema();
      return false;
    }
  }
  return esSesionSupabaseAdministradorV573();
}
function abrirLoginSupabaseAdministradorV573(){
  if(esSesionSupabaseAdministradorV573()){
    modoAccesoActual="admin";
    actualizarUIModoAcceso();
    return true;
  }
  const loginSupabaseBtn=document.getElementById("btnSupabaseLogin");
  if(!loginSupabaseBtn){
    if(typeof adminSetMsg==="function") adminSetMsg("El acceso Supabase todavía no está disponible. Recargá la página e intentá nuevamente.","err");
    return false;
  }
  loginSupabaseBtn.click();
  setTimeout(()=>{
    prepararModalLoginAdministradorV573();
    const form=document.getElementById("supabaseLoginForm");
    if(form){
      form.addEventListener("submit",()=>{void verificarResultadoLoginAdministradorV573();},{once:true,capture:true});
    }
    const email=document.getElementById("supabaseEmail");
    if(email) email.focus();
  },0);
  return false;
}
function cerrarSesionSupabaseAdministradorV573(){
  const logoutSupabaseBtn=document.getElementById("btnSupabaseLogout");
  if(!logoutSupabaseBtn){
    if(typeof adminSetMsg==="function") adminSetMsg("No se encontró una sesión Supabase activa para cerrar.","warn");
    return false;
  }
  logoutSupabaseBtn.click();
  modoAccesoActual="consulta";
  setTimeout(()=>{
    actualizarUIModoAcceso();
    if(typeof renderAdministracionSistema==="function") renderAdministracionSistema();
  },250);
  return true;
}
function iniciarSesionAdministrador(){
  try{sessionStorage.removeItem("coi_modo_acceso_actual");}catch(e){}
  return abrirLoginSupabaseAdministradorV573();
}`;
replaceOnce('login-admin', oldLogin, newLogin);

const oldEvents = `function initEventosModoAccesoV573(){
  const btn=document.getElementById("btnAdminMode");
  if(!btn||btn.dataset.v573ModeInit==="1") return;
  btn.dataset.v573ModeInit="1";
  btn.addEventListener("click",ev=>{
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if(esSesionSupabaseAdministradorV573()){
      actualizarUIModoAcceso();
      if(typeof adminSetMsg==="function") adminSetMsg("La sesion Supabase ya posee rol Administrador.","ok");
      if(typeof renderAdministracionSistema==="function") renderAdministracionSistema();
      return;
    }
    cerrarSesionAdministrador();
    if(typeof adminSetMsg==="function") adminSetMsg("La sesion Supabase actual no posee autorizacion administrativa.","err");
    if(typeof renderAdministracionSistema==="function") renderAdministracionSistema();
  },true);
}`;

const newEvents = `function initEventosModoAccesoV573(){
  const btn=document.getElementById("btnAdminMode");
  if(!btn||btn.dataset.v573ModeInit==="1") return;
  btn.dataset.v573ModeInit="1";
  btn.addEventListener("click",ev=>{
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if(esSesionSupabaseAdministradorV573()){
      if(typeof adminSetMsg==="function") adminSetMsg("Cerrando sesión de Administrador en Supabase…","warn");
      cerrarSesionSupabaseAdministradorV573();
      return;
    }
    iniciarSesionAdministrador();
    if(typeof adminSetMsg==="function") adminSetMsg("Autenticá una cuenta Supabase con rol Administrador.","warn");
    if(typeof renderAdministracionSistema==="function") renderAdministracionSistema();
  },true);
}`;
replaceOnce('eventos-admin', oldEvents, newEvents);

const oldButton = `  if(btn){
    btn.textContent=esSesionSupabaseAdministradorV573()?"Administrador autenticado":(esModoAdmin()?"Cerrar sesion de administrador":"Iniciar sesion como administrador");
    btn.title=esSesionSupabaseAdministradorV573()?"Rol Administrador otorgado por la sesion Supabase activa":"";
  }`;
const newButton = `  if(btn){
    const adminSupabase=esSesionSupabaseAdministradorV573();
    btn.textContent=adminSupabase?"Cerrar sesión de administrador":"Iniciar sesión como administrador";
    btn.title=adminSupabase?"Cerrar la sesión Supabase administrativa activa":"Autenticar una cuenta Supabase con rol Administrador";
    btn.setAttribute("aria-pressed",adminSupabase?"true":"false");
  }`;
replaceOnce('texto-boton-admin', oldButton, newButton);

const oldNotice = `  aviso.innerHTML=esModoAdmin()
    ? '<b>Modo Administrador activo</b>Las acciones de edicion, borrado, importacion y cierre estan habilitadas hasta cerrar sesion o recargar la pagina.'
    : '<b>Modo Consulta activo</b>Para modificar datos, limpiar base o restaurar backups, inicia sesion como administrador desde este modulo.';`;
const newNotice = `  aviso.innerHTML=esModoAdmin()
    ? '<b>Modo Administrador activo</b>Las acciones protegidas están habilitadas mientras la sesión Supabase administrativa permanezca autenticada.'
    : '<b>Modo Consulta activo</b>Para ejecutar acciones protegidas, iniciá sesión con una cuenta Supabase que tenga rol Administrador.';`;
replaceOnce('aviso-admin', oldNotice, newNotice);

const forbidden = [
  'La sesion Supabase actual no posee autorizacion administrativa.',
  'Administrador autenticado\":(esModoAdmin()'
];
for (const token of forbidden) {
  if (html.includes(token)) throw new Error(`Quedó un patrón legacy inesperado: ${token}`);
}
for (const required of [
  'function abrirLoginSupabaseAdministradorV573()',
  'loginSupabaseBtn.click();',
  'function cerrarSesionSupabaseAdministradorV573()',
  'logoutSupabaseBtn.click();',
  'El usuario autenticado no posee permisos de Administrador.',
  'Cerrar sesión de administrador'
]) {
  if (!html.includes(required)) throw new Error(`Falta contrato nuevo: ${required}`);
}

fs.writeFileSync(file, html, 'utf8');
console.log('Parche de login administrador aplicado de forma exacta.');
