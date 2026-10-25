'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const fnCode=html.match(/  async function updateOrder\([\s\S]*?\n  \}(?=\n  function refreshAll\()/)?.[0];
assert.ok(fnCode,'Falta updateOrder RPC en modulo ejecutivo');
assert.doesNotMatch(fnCode,/\.from\(T_ORDENES\)\.update\s*\(/,'UPDATE directo prohibido');
assert.match(fnCode,/\.rpc\('coi_actualizar_orden_integral'/,'Usar RPC canonica');
assert.match(fnCode,/\.eq\('id',id\)\.limit\(2\)/,'Verificar por UUID');
assert.match(fnCode,/mergeRows\(\[persisted\]\)/,'Sincronizar solo despues de releer');
assert.match(fnCode,/Cambiar Nro\. OC/,'Renumeracion debe permanecer en flujo dedicado');
assert.match(html,/fecha_cierre_operativo:dateOnly\(isoNow\(\)\)/,'El cierre debe enviar fecha SQL, no timestamp');

const ID='33333333-3333-4333-8333-333333333333';
const NRO='4530009805';
const SOURCE={id:ID,nro_oc:NRO,id_obra:'OC-'+NRO,proveedor:'Contratista inicial',estado_registro:'Activo'};
const clone=x=>JSON.parse(JSON.stringify(x));
function mock(opts={}){
  const calls=[],merged=[],history=[];
  let persisted=clone(SOURCE);
  const sb={
    from(table){
      assert.equal(table,'coi_ordenes');
      return {select(fields){
        assert.ok(['*'].includes(fields));
        return {eq(field,val){
          return {async limit(limit){
            calls.push({kind:'select',field,val,fields,limit});
            if(field==='nro_oc'){
              if(opts.lookupError)return {error:new Error('LOOKUP_DENIED')};
              return {data:opts.lookupRows!==undefined?opts.lookupRows:[clone(SOURCE)],error:null};
            }
            assert.equal(field,'id');
            if(opts.verifyError)return {error:new Error('VERIFY_DENIED')};
            return {data:opts.persistRows!==undefined?opts.persistRows:[clone(persisted)],error:null};
          }};
        }};
      }};
    },
    async rpc(name,args){
      calls.push({kind:'rpc',name,args});
      assert.equal(name,'coi_actualizar_orden_integral');
      if(opts.rpcError)return {error:new Error(opts.rpcError)};
      persisted={...persisted,...args.p_cambios};
      if(persisted.fecha_cierre_operativo)persisted.fecha_cierre_operativo=String(persisted.fecha_cierre_operativo).slice(0,10);
      return {data:{orden:opts.rpcResponse!==undefined?opts.rpcResponse:clone(persisted)},error:null};
    }
  };
  const sandbox={
    requireWrite:async()=>{calls.push({kind:'auth'});if(opts.noSession)throw new Error('LOGIN_REQUIRED')},
    resolveOrder:o=>o,
    nro:o=>String(o?.nro_oc||o?.numeroOC||'').replace(/\s+/g,''),
    clean:v=>String(v??'').trim(),
    client:()=>sb,
    T_ORDENES:'coi_ordenes',
    bool:v=>v===true||['true','si','1'].includes(String(v).toLowerCase()),
    mergeRows:r=>merged.push(...r),
    compararCambiosOC:(before,after)=>before.proveedor!==after.proveedor?[{campo:'proveedor',anterior:before.proveedor,nuevo:after.proveedor}]:[],
    registrarCambioCampo:async(...args)=>history.push(args),
    refreshAll:()=>calls.push({kind:'refresh'})
  };
  const update=vm.runInNewContext('('+fnCode.trim()+')',sandbox,{timeout:2000});
  return {run:(changes,options)=>update({nro_oc:NRO},changes,options),calls,merged,history};
}
async function rejectsWithoutWrite(ctx,changes,pattern){
  await assert.rejects(ctx.run(changes),pattern);
  assert.equal(ctx.calls.filter(x=>x.kind==='rpc').length,0);
  assert.equal(ctx.merged.length,0);
}
(async()=>{
  const updated=mock();
  const input={nro_oc:NRO,proveedor:'Nuevo proveedor',monto_total:120000};
  const row=await updated.run(input);
  assert.equal(row.proveedor,'Nuevo proveedor');
  assert.equal(row.monto_total,120000);
  assert.equal(input.nro_oc,NRO,'No mutar payload de editor');
  assert.equal(updated.calls[0].kind,'auth');
  assert.equal(updated.calls[1].field,'nro_oc');
  assert.equal(updated.calls[1].limit,2);
  assert.equal(updated.calls[2].kind,'rpc');
  assert.equal(updated.calls[2].args.p_orden_id,ID);
  assert.equal(updated.calls[2].args.p_cambios.nro_oc,undefined);
  assert.equal(updated.calls[3].field,'id');
  assert.equal(updated.calls[3].limit,2);
  assert.equal(updated.merged.length,1);
  assert.equal(updated.history.length,1,'Mantener historial ejecutivo');
  assert.equal(updated.calls.at(-1).kind,'refresh');

  const closed=mock();
  await closed.run({estado_registro:'Cerrado',fecha_cierre_operativo:'2026-10-25',observacion_cierre:'Cierre de prueba'},{history:false});
  assert.equal(closed.merged[0].estado_registro,'Cerrado');
  assert.equal(closed.merged[0].fecha_cierre_operativo,'2026-10-25');
  assert.equal(closed.history.length,0,'No duplicar historial en cierre');

  const noop=mock();await noop.run({nro_oc:NRO});
  assert.equal(noop.calls.filter(x=>x.kind==='rpc').length,0,'Evitar escritura vacia');

  await rejectsWithoutWrite(mock(),{nro_oc:'4530009999',proveedor:'Otro'},/Cambiar Nro\. OC/);
  await rejectsWithoutWrite(mock(),null,/objeto válido/);
  await rejectsWithoutWrite(mock({noSession:true}),{proveedor:'Otro'},/LOGIN_REQUIRED/);
  await rejectsWithoutWrite(mock({lookupRows:[]}),{proveedor:'Otro'},/única OC remota/);
  await rejectsWithoutWrite(mock({lookupRows:[clone(SOURCE),{...SOURCE,id:'otro'}]}),{proveedor:'Otro'},/única OC remota/);
  await rejectsWithoutWrite(mock({lookupError:true}),{proveedor:'Otro'},/LOOKUP_DENIED/);

  const denied=mock({rpcError:'COI_ROLE_REQUIRED'});
  await assert.rejects(denied.run({proveedor:'Otro'}),/COI_ROLE_REQUIRED/);
  assert.equal(denied.merged.length,0);

  const wrongRPC=mock({rpcResponse:{id:'otro',nro_oc:NRO}});
  await assert.rejects(wrongRPC.run({proveedor:'Otro'}),/RPC no confirmó/);
  assert.equal(wrongRPC.merged.length,0);

  const missingReadback=mock({persistRows:[]});
  await assert.rejects(missingReadback.run({proveedor:'Otro'}),/no confirmó la OC persistida/);
  assert.equal(missingReadback.merged.length,0);

  const silentFailure=mock({persistRows:[clone(SOURCE)]});
  await assert.rejects(silentFailure.run({proveedor:'Otro'}),/no confirmó el valor persistido/);
  assert.equal(silentFailure.merged.length,0);

  const missingColumn=mock({persistRows:[{id:ID,nro_oc:NRO}]});
  await assert.rejects(missingColumn.run({proveedor:'Otro'}),/no incluyó el campo actualizado/);
  assert.equal(missingColumn.merged.length,0);

  const verifyDenied=mock({verifyError:true});
  await assert.rejects(verifyDenied.run({proveedor:'Otro'}),/VERIFY_DENIED/);
  assert.equal(verifyDenied.merged.length,0);

  console.log('Security V3 updateOrder RPC: edición, cierre, no-op y 11 controles de falla/rechazo PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
