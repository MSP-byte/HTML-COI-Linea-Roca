'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const program = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'coi_v3_role_matrix_readonly.cjs'), 'utf8');
const roles = ['administrador','jefatura','editor','planificacion','control','supervisor','consulta'];
const fixture = '123e4567-e89b-42d3-a456-426614174000';
const root = 'https://brmrroikctfbtzwfewan.supabase.co';

async function exercise({rpcStatus=401, rpcCode='42501', emptyRole='', missingFixture=false,
  crossRoleEscalation='', crossRoleDeniedStatus=403, crossRoleDeniedCode='42501'}={}){
  const env = {COI_STAGING_API_KEY:'public_test_key'};
  if(!missingFixture)env.COI_STAGING_OC_FIXTURE_ID=fixture;
  for(const role of roles)env['COI_STAGING_JWT_'+role.toUpperCase()]='testjwt-'+role;
  const errors=[], calls=[];
  const context = vm.createContext({
    require: id => {assert.equal(id,'node:assert/strict');return assert;},
    process:{
      env,
      exit(code){throw new Error('PROCESS_EXIT_'+code)},
      exitCode:0
    },
    console:{log(){},error:msg=>errors.push(String(msg))},
    assert,
    Set,
    encodeURIComponent,
    AbortSignal:{timeout(){return null}},
    fetch:async (url,opts)=>{
      assert.ok(url.startsWith(root+'/'),'No se admiten hosts externos');
      const isAssert=url===root+'/rest/v1/rpc/coi_assert_role';
      assert.equal(opts.method,isAssert?'POST':'GET','Prohibida toda RPC de mutación');
      if(isAssert)assert.equal(opts.headers['content-type'],'application/json');
      const route=url.slice(root.length);
      calls.push(route);
      const jwt=opts.headers.Authorization?.replace(/^Bearer /,'')||null;
      const role=jwt?.startsWith('testjwt-')?jwt.slice('testjwt-'.length):null;
      let status=200,json=null;
      if(route.startsWith('/auth/v1/user')){
        assert.ok(role,'Auth sólo con JWT');
        json={id:'uuid-cuenta-'+role};
      }else if(route==='/rest/v1/rpc/coi_current_role'){
        if(!role){status=rpcStatus;json={code:rpcCode,message:'Permiso denegado'};}
        else json=role;
      }else if(route==='/rest/v1/rpc/coi_assert_role'){
        assert.ok(role,'La RPC asertiva requiere token real');
        const params=JSON.parse(opts.body||'{}');
        assert.deepEqual(Object.keys(params),['p_roles']);
        assert.ok(Array.isArray(params.p_roles) && params.p_roles.length===1);
        const requested=params.p_roles[0];
        assert.ok(roles.includes(requested),'Los probes se limitan a siete roles');
        if(role===requested || (role+'->'+requested)===crossRoleEscalation){
          json=requested;
        }else{
          status=crossRoleDeniedStatus;
          json={code:crossRoleDeniedCode,message:'COI_ROLE_REQUIRED'};
        }
      }else if(route.startsWith('/rest/v1/coi_ordenes?')){
        if(!role) json=[];
        else {
          assert.ok(route.includes('id=eq.'+fixture),'La consulta debe buscar una OC específica');
          json=role===emptyRole?[]:[{id:fixture}];
        }
      }else throw new Error('Ruta inesperada '+route);
      return {status,ok:status>=200&&status<300,text:async()=>JSON.stringify(json)};
    }
  });
  let earlyExit=null;
  try {
    await vm.runInContext(program,context,{timeout:3000});
  } catch(e) {
    earlyExit=String(e.message||e);
  }
  return {errorCode:context.process.exitCode||0,earlyExit,errors,calls};
}

(async()=>{
  const good=await exercise();
  assert.equal(good.errorCode,0,'Siete roles con fixture visible y rechazo 42501 deben pasar');
  assert.equal(good.earlyExit,null);
  assert.equal(good.calls.filter(x=>x.includes('id=eq.'+fixture)).length,7);
  assert.equal(good.calls.filter(x=>x==='/rest/v1/rpc/coi_assert_role').length,49,
    '7 identidades por 7 roles = 49 comprobaciones positivas/negativas');

  const rpc503=await exercise({rpcStatus:503,rpcCode:'PGRST500'});
  assert.equal(rpc503.errorCode,1,'HTTP 503 nunca prueba falta de permiso');
  const rpc403wrong=await exercise({rpcStatus:403,rpcCode:'PGRST301'});
  assert.equal(rpc403wrong.errorCode,1,'HTTP 403 no basta sin código 42501');
  const rpc404=await exercise({rpcStatus:404,rpcCode:'PGRST202'});
  assert.equal(rpc404.errorCode,1,'404 de esquema no acredita denegación');
  const empty=await exercise({emptyRole:'consulta'});
  assert.equal(empty.errorCode,1,'HTTP 200 [] no prueba lectura de OC');
  const escalation=await exercise({crossRoleEscalation:'consulta->administrador'});
  assert.equal(escalation.errorCode,1,'Cualquier autorización cruzada inesperada debe bloquear QA');
  const denied503=await exercise({crossRoleDeniedStatus:503,crossRoleDeniedCode:'PGRST500'});
  assert.equal(denied503.errorCode,1,'503 no acredita rechazo de rol');
  const denied403Other=await exercise({crossRoleDeniedStatus:403,crossRoleDeniedCode:'PGRST301'});
  assert.equal(denied403Other.errorCode,1,'El rechazo de rol requiere código 42501');
  const missing=await exercise({missingFixture:true});
  assert.match(missing.earlyExit||'',/PROCESS_EXIT_2/,'UUID de fixture obligatorio');

  console.log('Security role matrix: 7 JWT x 7 permisos + no escalada + 503/403/404 + fixture positiva PASS');
})().catch(err=>{console.error(err);process.exitCode=1;});
