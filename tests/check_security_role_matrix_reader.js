'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const program = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'coi_v3_role_matrix_readonly.cjs'), 'utf8');
const roles = ['administrador','jefatura','editor','planificacion','control','supervisor','consulta'];
const fixture = '123e4567-e89b-42d3-a456-426614174000';
const root = 'https://brmrroikctfbtzwfewan.supabase.co';

async function exercise({rpcStatus=401, rpcCode='42501', emptyRole='', missingFixture=false}={}){
  const env = {COI_STAGING_API_KEY:'public_test_key'};
  if(!missingFixture)env.COI_STAGING_OC_FIXTURE_ID=fixture;
  for(const role of roles)env['COI_STAGING_JWT_'+role.toUpperCase()]='testjwt-'+role;
  const errors=[], calls=[];
  const context = vm.createContext({
    require,
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
      assert.equal(opts.method,'GET','Solo peticiones de lectura');
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

  const rpc503=await exercise({rpcStatus:503,rpcCode:'PGRST500'});
  assert.equal(rpc503.errorCode,1,'HTTP 503 nunca prueba falta de permiso');
  const rpc403wrong=await exercise({rpcStatus:403,rpcCode:'PGRST301'});
  assert.equal(rpc403wrong.errorCode,1,'HTTP 403 no basta sin código 42501');
  const rpc404=await exercise({rpcStatus:404,rpcCode:'PGRST202'});
  assert.equal(rpc404.errorCode,1,'404 de esquema no acredita denegación');
  const empty=await exercise({emptyRole:'consulta'});
  assert.equal(empty.errorCode,1,'HTTP 200 [] no prueba lectura de OC');
  const missing=await exercise({missingFixture:true});
  assert.match(missing.earlyExit||'',/PROCESS_EXIT_2/,'UUID de fixture obligatorio');

  console.log('Security role matrix runner: visibilidad positiva + 503/403/404 + 200 vacío + fixture ausente PASS');
})().catch(err=>{console.error(err);process.exitCode=1;});
