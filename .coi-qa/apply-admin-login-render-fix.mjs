import fs from 'fs';

const file='index.html';
let html=fs.readFileSync(file,'utf8');
const before="    const btn=$a('btnAdminMode'); if(btn) btn.textContent=(typeof esSesionSupabaseAdministradorV573==='function'&&esSesionSupabaseAdministradorV573())?'Administrador autenticado':(isAdmin?'Cerrar sesion de administrador':'Iniciar sesion como administrador');";
const after="    const btn=$a('btnAdminMode'); if(btn){const adminSupabase=typeof esSesionSupabaseAdministradorV573==='function'&&esSesionSupabaseAdministradorV573();btn.textContent=adminSupabase?'Cerrar sesión de administrador':'Iniciar sesión como administrador';btn.title=adminSupabase?'Cerrar la sesión Supabase administrativa activa':'Autenticar una cuenta Supabase con rol Administrador';btn.setAttribute('aria-pressed',adminSupabase?'true':'false');}";
const matches=html.split(before).length-1;
if(matches!==1) throw new Error(`Se esperaba 1 override legacy de btnAdminMode y se encontraron ${matches}`);
html=html.replace(before,after);
if(html.includes("?'Administrador autenticado':(isAdmin?'Cerrar sesion de administrador':'Iniciar sesion como administrador')")) throw new Error('Persistió el renderer legacy del botón admin');
fs.writeFileSync(file,html,'utf8');
console.log('Renderer tardío del botón admin normalizado.');
