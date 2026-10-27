#!/usr/bin/env node
'use strict';
// Security V3 — QA con JWT genuinos, solo consultas y RPC STABLE sin efectos de escritura.
// POST se utiliza exclusivamente para la función PostgreSQL STABLE coi_assert_role.
// No emite, crea, altera ni almacena credenciales o registros.
const assert = require('node:assert/strict');

const STAGING_URL='https://brmrroikctfbtzwfewan.supabase.co';
const ROLES=['administrador','jefatura','editor','planificacion','control','supervisor','consulta'];

const apiKey=process.env.COI_STAGING_API_KEY;
const fixtureId=String(process.env.COI_STAGING_OC_FIXTURE_ID||'').trim();
const suppliedUrl=String(process.env.COI_STAGING_URL||STAGING_URL).replace(/\/$/,'');
if(suppliedUrl!==STAGING_URL){
  console.error('SECURITY STOP: este control solo acepta STAGING (ref brmrroikctfbtzwfewan).');
  process.exit(2);
}
const missing=[...(!apiKey?['COI_STAGING_API_KEY']:[]),
  ...(!fixtureId?['COI_STAGING_OC_FIXTURE_ID']:[]),
  ...ROLES.filter(r=>!process.env['COI_STAGING_JWT_'+r.toUpperCase()]).map(r=>'COI_STAGING_JWT_'+r.toUpperCase())];
if(missing.length){
  console.error('NO EJECUTADO: faltan variables de entorno para pruebas con siete sesiones reales: '+missing.join(', '));
  console.error('No se pueden sustituir JWT reales por mocks, SET ROLE o perfiles de la base.');
  process.exit(2);
}

// Un fixture explícito evita certificar lecturas vacías como lecturas válidas.
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fixtureId)){
  console.error('NO EJECUTADO: COI_STAGING_OC_FIXTURE_ID debe ser el UUID de una OC real preexistente en STAGING.');
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

// Lista de RPC permitidas: únicamente coi_assert_role (STABLE, sin mutaciones).
// Cada prueba cruza una sesión JWT genuina con un rol solicitado distinto.
async function checkRole(jwt,requestedRole){
  assert.ok(ROLES.includes(requestedRole),'Rol de QA fuera del catálogo.');
  const response=await fetch(STAGING_URL+'/rest/v1/rpc/coi_assert_role',{
    method:'POST',
    headers:{...headers(jwt),'content-type':'application/json'},
    body:JSON.stringify({p_roles:[requestedRole]}),
    signal:AbortSignal.timeout(15000)
  });
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
  // Fallos 5xx, rate limit o 404 no prueban denegación de autorización.
  assert.ok([401,403].includes(anonymousRpc.status) && anonymousRpc.json?.code==='42501',
    'ANON RPC: se exige denegación de permisos 401/403 con código PostgreSQL 42501; HTTP '+anonymousRpc.status+
    ' y código '+String(anonymousRpc.json?.code||'ausente'));
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

    const oc=await get('/rest/v1/coi_ordenes?select=id&id=eq.'+encodeURIComponent(fixtureId)+'&limit=1',jwt);
    assert.ok(oc.ok && Array.isArray(oc.json) && oc.json.length===1 &&
      String(oc.json[0]?.id||'').toLowerCase()===fixtureId.toLowerCase(),
      'No se confirmó visibilidad de la OC fixture en STAGING: '+expected+' HTTP '+oc.status);
    // 7 x 7 comprobaciones auténticas y sin escrituras.
    // Solo el rol real de cada cuenta debe autorizarse; los seis restantes
    // deben devolver 403 con el error PostgreSQL 42501 (no 404, 5xx ni 429).
    for(const requested of ROLES){
      const check=await checkRole(jwt,requested);
      if(requested===expected){
        assert.ok(check.ok && String(check.json||'').trim().toLowerCase()===expected,
          'coi_assert_role denegó el rol legítimo '+expected+' HTTP '+check.status);
      }else{
        assert.ok(check.status===403 && check.json?.code==='42501',
          'Posible escalada o respuesta no verificable: sesión '+expected+
          ' solicitó rol '+requested+' HTTP '+check.status+
          ' code '+String(check.json?.code||'ausente'));
      }
    }
    results.push({rol:expected,autenticacion:'OK',rol_verificado:'OK',lectura_oc:'OK',roles_probados:7});
    console.log(expected+': Auth + lectura OC + 1 autorización y 6 rechazos por RPC STABLE = PASS');
  }
  assert.equal(results.length,7);
  console.log('MATRIZ STAGING 7/7 autenticaciones y 49/49 aserciones de rol completada (7 positivas, 42 negativas). Ninguna escritura ni RPC de mutación.');
  console.log('IMPORTANTE: NO certifica permisos de INSERT/UPDATE/DELETE, cierre, certificación, MFA ni lógica de autorización de otras RPC.');
})().catch(e=>{
  console.error('MATRIZ INCOMPLETA: '+(e&&e.message||String(e)));
  process.exitCode=1;
});
