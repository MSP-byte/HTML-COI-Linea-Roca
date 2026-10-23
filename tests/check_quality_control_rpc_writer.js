'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const excerpt=html.match(/  async function actualizarCalidadOrdenSupabase\(orden,resultado\)\{[\s\S]*?\n  \}(?=\n  async function guardarResultadoAuditoriaSupabase)/)?.[0];
assert.ok(excerpt,'No se pudo aislar el escritor de calidad V3');
assert.doesNotMatch(excerpt,/\.from\(T_ORDENES\)\.update\(/,'La auditoría de calidad nunca puede hacer UPDATE directo');
assert.match(excerpt,/\.rpc\('coi_actualizar_orden_integral'/,'El escritor debe usar la RPC canónica');
assert.match(excerpt,/\.eq\('id',id\)/,'La lectura confirmatoria debe usar el UUID');
assert.match(excerpt,/mergeRows\(\[persisted\]\)/,'El cache se sincroniza solamente tras confirmación autoritativa');

const UUID='33333333-3333-4333-8333-333333333333';
const NRO='4530009805';
const TODAY='2026-10-22T22:30:15.000Z';
const RESULT={estado:'AMARILLO',score:73,requiere_accion:true,motivo_requiere_accion:'Falta acta'};

function mock(overrides={}){
  const calls=[],merged=[];
  let rpcPayload=null;
  const expected={id:UUID,nro_oc:NRO,calidad_datos_estado:RESULT.estado,calidad_datos_score:RESULT.score,
    fecha_ultimo_control:TODAY,requiere_accion:RESULT.requiere_accion,
    motivo_requiere_accion:RESULT.motivo_requiere_accion};
  const server={
    from(table){
      assert.equal(table,'coi_ordenes');
      return {
        select(fields){
          return {
            eq(column,value){
              return {
                async limit(limit){
                  calls.push({kind:'read',fields,column,value,limit});
                  if(fields==='id,nro_oc'){
                    if(overrides.lookupError)return {error:new Error('LOOKUP_DENIED')};
                    return {data:overrides.lookupRows??[{id:UUID,nro_oc:NRO}],error:null};
                  }
                  assert.equal(fields,'*');
                  if(overrides.persistError)return {error:new Error('VERIFY_DENIED')};
                  return {data:[overrides.persisted??expected],error:null};
                }
              };
            }
          };
        }
      };
    },
    async rpc(name,args){
      calls.push({kind:'rpc',name,args});
      rpcPayload=args;
      if(overrides.rpcError)return {error:new Error(overrides.rpcError)};
      return {data:{orden:overrides.confirmed??{id:UUID,nro_oc:NRO,...args.p_cambios}},error:null};
    }
  };
  const sandbox={
    T_ORDENES:'coi_ordenes',
    nro:o=>String(o?.nro_oc||'').replace(/\s+/g,''),
    clean:v=>String(v??'').trim(),
    bool:v=>v===true||String(v??'').toLowerCase()==='true',
    isoNow:()=>TODAY,
    client:()=>server,
    requireWrite:async()=>{calls.push({kind:'auth'});if(overrides.unauthenticated)throw new Error('LOGIN_REQUIRED');},
    mergeRows:rows=>merged.push(...rows)
  };
  const fn=vm.runInNewContext('('+excerpt.trim()+')',sandbox,{timeout:2000});
  return {run:()=>fn({nro_oc:NRO},RESULT),calls,merged,get rpcPayload(){return rpcPayload;}};
}

(async()=>{
  const ok=mock();
  const rows=await ok.run();
  assert.equal(rows.length,1);
  assert.equal(ok.calls[0].kind,'auth');
  assert.equal(ok.calls[1].fields,'id,nro_oc');
  assert.equal(ok.calls[1].column,'nro_oc');
  assert.equal(ok.calls[1].limit,2);
  assert.equal(ok.calls[2].kind,'rpc');
  assert.equal(ok.calls[2].name,'coi_actualizar_orden_integral');
  assert.equal(ok.rpcPayload.p_orden_id,UUID);
  assert.equal(Object.keys(ok.rpcPayload.p_cambios).length,5);
  assert.equal(ok.rpcPayload.p_cambios.calidad_datos_estado,RESULT.estado);
  assert.equal(ok.calls[3].fields,'*');
  assert.equal(ok.calls[3].column,'id');
  assert.equal(ok.calls[3].value,UUID);
  assert.equal(ok.merged.length,1,'La ficha se actualiza tras verificar');

  const missing=mock({lookupRows:[]});
  await assert.rejects(missing.run(),/única OC remota/);
  assert.equal(missing.calls.filter(x=>x.kind==='rpc').length,0);
  assert.equal(missing.merged.length,0);

  const duplicate=mock({lookupRows:[{id:UUID,nro_oc:NRO},{id:'otra',nro_oc:NRO}]});
  await assert.rejects(duplicate.run(),/única OC remota/);
  assert.equal(duplicate.calls.filter(x=>x.kind==='rpc').length,0);

  const badId=mock({confirmed:{id:'otra',nro_oc:NRO}});
  await assert.rejects(badId.run(),/RPC no confirmó/);
  assert.equal(badId.merged.length,0);

  const denied=mock({rpcError:'COI_ROLE_REQUIRED'});
  await assert.rejects(denied.run(),/COI_ROLE_REQUIRED/);
  assert.equal(denied.merged.length,0);

  const lost=mock({persisted:{id:UUID,nro_oc:NRO,...RESULT,calidad_datos_estado:'ROJO',fecha_ultimo_control:TODAY}});
  await assert.rejects(lost.run(),/no confirmó la persistencia/);
  assert.equal(lost.merged.length,0);

  const disconnected=mock({unauthenticated:true});
  await assert.rejects(disconnected.run(),/LOGIN_REQUIRED/);
  assert.equal(disconnected.calls.length,1,'Sin sesión no debe consultar ni escribir');

  const unavailable=mock({lookupError:true});
  await assert.rejects(unavailable.run(),/LOOKUP_DENIED/);
  assert.equal(unavailable.calls.some(x=>x.kind==='rpc'),false);

  console.log('Security V3 quality control: RPC positiva y 7 controles negativos PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
