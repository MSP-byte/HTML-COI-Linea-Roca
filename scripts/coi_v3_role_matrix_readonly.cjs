#!/usr/bin/env node
'use strict';
// Security V3 — QA con JWT genuinos y alcance SOLO LECTURA.
// No emite, crea, altera ni almacena credenciales o registros.
const assert = require('node:assert/strict');

const STAGING_URL='https://brmrroikctfbtzwfewan.supabase.co';
const ROLES=['administrador','jefatura','editor','planificacion','control','supervisor','consulta'];

const apiKey=process.env.COI_STAGING_API_KEY;
const suppliedUrl=String(process.env.COI_STAGING_URL||STAGING_URL).replace(/\/$/,'');
if(suppliedUrl!==STAGING_URL){
  console.error('SECURITY STOP: este control solo acepta STAGING (ref brmrroikctfbtzwfewan).');
  process.exit(2);
}
const missing=[...(!apiKey?['COI_STAGING_API_KEY']:[]),
  ...ROLES.filter(r=>!process.env['COI_STAGING_JWT_'+r.toUpperCase()]).map(r=>'COI_STAGING_JWT_'+r.toUpperCase())];
if(missing.length){
  console.error('NO EJECUTADO: faltan variables de entorno para pruebas con siete sesiones reales: '+missing.join(', '));
  console.error('No se pueden sustituir JWT reales por mocks, SET ROLE o perfiles de la base.');
  process.exit(2);
}

function headers(jwt){
  return {'apikey':apiKey,'accept':'application/json',...(jwt?{'Authorization':'Bearer '+jwt}:{})};
}
async function get(path,jwt){
  const response=await fetch(STAGING_URL+path,{method:'GET',headers:headers(jwt),signal:AbortSignal.timeout(15000)});
  const text=await response.text();
  let json;
  try{json=text?JSON.parse(text):null;}catch{json=null;}
  return {status:response.status,ok:response.ok,json};
}
(async()=>{
  const seen=new Set();
  const anonymous=await get('/rest/v1/coi_ordenes?select=id&limit=1',null);
  if(anonymous.ok&&Array.isArray(anonymous.json))assert.equal(anonymous.json.length,0,'ANON expone OC');
  else assert.ok([401,403,404].includes(anonymous.status),'Resultado anon inesperado: '+anonymous.status);
  const anonymousRpc=await get('/rest/v1/rpc/coi_current_role',null);
  assert.ok(!anonymousRpc.ok,'ANON puede ejecutar coi_current_role');
  console.log('ANON: sin filas OC y sin RPC privilegiada accesible — PASS');

  const results=[];
  for(const expected of ROLES){
    const jwt=process.env['COI_STAGING_JWT_'+expected.toUpperCase()];
    const account=await get('/auth/v1/user',jwt);
    assert.ok(account.ok && typeof account.json?.id==='string','AUTH no valido para rol '+expected);
    const id=account.json.id;
    assert.ok(!seen.has(id),'Las pruebas necesitan siete identidades distintas; duplicado en '+expected);
    seen.add(id);

    const role=await get('/rest/v1/rpc/coi_current_role',jwt);
    assert.ok(role.ok,'RPC de rol rechazada para '+expected+' HTTP '+role.status);
    const resolved=String(role.json||'').trim().toLowerCase();
    assert.equal(resolved,expected,'El rol no coincide con el perfil activo del servidor: '+expected);

    const oc=await get('/rest/v1/coi_ordenes?select=id&limit=1',jwt);
    assert.ok(oc.ok && Array.isArray(oc.json),'No puede leer listado OC: '+expected+' HTTP '+oc.status);
    results.push({rol:expected,autenticacion:'OK',rol_verificado:'OK',lectura_oc:'OK'});
    console.log(expected+': Auth real + rol servidor + lectura de OC = PASS');
  }
  assert.equal(results.length,7);
  console.log('MATRIZ SOLO LECTURA 7/7 completada. No se ejecutaron INSERT/UPDATE/DELETE ni RPC de mutación.');
  console.log('IMPORTANTE: NO certifica edición, cierre, certificación, permisos de escritura ni MFA.');
})().catch(e=>{
  console.error('MATRIZ INCOMPLETA: '+(e&&e.message||String(e)));
  process.exitCode=1;
});
