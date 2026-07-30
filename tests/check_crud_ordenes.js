'use strict';
const assert = require('assert');
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const normalize = value => String(value ?? '').trim().replace(/^OC-\s*/i, '').replace(/\s+/g, '');
class MockStore {
  constructor(orders, options = {}) { this.orders=structuredClone(orders); this.stations=structuredClone(options.stations||[]); this.deps=options.deps||{}; this.offline=!!options.offline; this.rls=!!options.rls; this.empty=!!options.empty; this.writes=0; this.deletes=[]; this.lookups=[]; this.messages=[]; this.cache=structuredClone(orders); }
  async remove(selected,{pin=true,confirmed=true,locked=false}={}) {
    if(locked)return {status:'busy'};
    if(!pin)return {status:'bad-pin'};
    if(!confirmed)return {status:'cancelled'};
    if(this.offline){this.messages.push('No se puede confirmar la eliminación sin conexión a Supabase');return {status:'offline'};}
    const unique=[...new Map(selected.map(o=>[normalize(o.nro_oc??o.numeroOC),o])).values()];
    const blocked=unique.filter(o=>Object.values(this.deps[normalize(o.nro_oc??o.numeroOC)]||{}).some(Boolean));
    const allowed=unique.filter(o=>!blocked.includes(o));
    if(!allowed.length)return {status:'blocked',blocked};
    const canonical=[];
    for(const visual of allowed){const number=normalize(visual.nro_oc??visual.numeroOC);this.lookups.push({field:'nro_oc',value:number});const rows=this.orders.filter(o=>normalize(o.nro_oc)===number);if(rows.length!==1)return {status:rows.length?'inconsistent':'missing'};canonical.push(rows[0]);}
    if(this.rls){this.messages.push('Supabase no confirmó la eliminación de la OC. Puede existir una política RLS que impida borrar. La OC permanece sin cambios.');return {status:'rls'};}
    this.writes++; this.deletes.push(canonical.map(o=>o.id));
    if(this.empty){this.messages.push('Supabase no confirmó la eliminación de la OC');return {status:'unconfirmed'};}
    const ids=new Set(canonical.map(o=>o.id)); const nros=new Set(canonical.map(o=>normalize(o.nro_oc)));
    this.stations=this.stations.filter(s=>!(ids.has(s.orden_id)||nros.has(normalize(s.nro_oc))));
    this.orders=this.orders.filter(o=>!(ids.has(o.id)||nros.has(normalize(o.nro_oc))));
    this.cache=structuredClone(this.orders);
    return {status:blocked.length?'partial':'success',deleted:canonical,blocked};
  }
  reload(){return structuredClone(this.orders);}
}
const fixtures=[{id:'a',nro_oc:'4530009999'},{id:'b',nro_oc:'00004'},{id:'c',nro_oc:'4530008964'}];
(async()=>{
  assert.strictEqual(normalize('OC-4530009999'),'4530009999'); assert.strictEqual(normalize(' 4530009999 '),'4530009999'); assert.strictEqual(normalize('00004'),'00004');
  let m=new MockStore(fixtures); let r=await m.remove(fixtures.slice(0,2)); assert.strictEqual(r.status,'success'); assert.deepStrictEqual(m.deletes,[['a','b']]); assert.deepStrictEqual(m.reload().map(x=>x.nro_oc),['4530008964']); assert.deepStrictEqual(m.cache,m.orders);
  m=new MockStore(fixtures); await m.remove([fixtures[0]],{pin:false}); assert.strictEqual(m.writes,0); assert.deepStrictEqual(m.cache,fixtures);
  m=new MockStore(fixtures); await m.remove([fixtures[0]],{confirmed:false}); assert.strictEqual(m.writes,0); assert.strictEqual(m.orders.length,3);
  m=new MockStore(fixtures,{offline:true}); r=await m.remove([fixtures[0]]); assert.strictEqual(r.status,'offline'); assert.strictEqual(m.orders.length,3); assert.match(m.messages[0],/sin conexión a Supabase/);
  m=new MockStore(fixtures,{rls:true}); r=await m.remove([fixtures[0]]); assert.strictEqual(r.status,'rls'); assert.strictEqual(m.orders.length,3); assert.deepStrictEqual(m.cache,fixtures);
  m=new MockStore(fixtures,{empty:true}); r=await m.remove([fixtures[0]]); assert.strictEqual(r.status,'unconfirmed'); assert.strictEqual(m.orders.length,3); assert.deepStrictEqual(m.cache,fixtures);
  const visual={idObra:'TEST-SUPABASE01',numeroOC:'00004'},remoteRow={id:'0923335e-5c48-49b7-95c2-6234483bb17e',nro_oc:'00004'};
  m=new MockStore([remoteRow]); r=await m.remove([visual]); assert.strictEqual(r.status,'success'); assert.deepStrictEqual(m.lookups,[{field:'nro_oc',value:'00004'}]); assert.deepStrictEqual(m.deletes,[[remoteRow.id]]); assert.deepStrictEqual(m.reload(),[]); assert.deepStrictEqual(m.cache,[]);
  m=new MockStore([remoteRow],{empty:true}); r=await m.remove([visual]); assert.strictEqual(r.status,'unconfirmed'); assert.deepStrictEqual(m.reload(),[remoteRow]); assert.deepStrictEqual(m.cache,[remoteRow]); assert.match(m.messages[0],/no confirmó/);
  m=new MockStore([remoteRow],{rls:true}); r=await m.remove([visual]); assert.strictEqual(r.status,'rls'); assert.deepStrictEqual(m.reload(),[remoteRow]); assert.deepStrictEqual(m.cache,[remoteRow]); assert.match(m.messages[0],/RLS/);
  m=new MockStore(fixtures,{deps:{'4530009999':{documentos:3,certificaciones:2,'movimientos financieros':5}}}); r=await m.remove([fixtures[0]]); assert.strictEqual(r.status,'blocked'); assert.strictEqual(m.writes,0); assert.deepStrictEqual(r.blocked[0] && m.deps['4530009999'],{documentos:3,certificaciones:2,'movimientos financieros':5});
  m=new MockStore(fixtures,{stations:[{id:1,orden_id:'a',nro_oc:'4530009999'},{id:2,orden_id:'a',nro_oc:'4530009999'},{id:3,orden_id:'c',nro_oc:'4530008964'}]}); await m.remove([fixtures[0]]); assert.deepStrictEqual(m.stations,[{id:3,orden_id:'c',nro_oc:'4530008964'}]);
  m=new MockStore(fixtures); const [x,y]=await Promise.all([m.remove([fixtures[0]]),m.remove([fixtures[0]],{locked:true})]); assert.strictEqual(x.status,'success'); assert.strictEqual(y.status,'busy'); assert.strictEqual(m.writes,1);
  const remote=[fixtures[2]], legacy=[fixtures[0],fixtures[1]]; assert.deepStrictEqual(structuredClone(remote),[fixtures[2]]); assert.strictEqual(legacy.length,2);
  m=new MockStore(fixtures); await m.remove([fixtures[0]]); r=await m.remove([fixtures[0]]); assert.strictEqual(m.orders.length,2); assert.ok(!m.orders.some(o=>o.nro_oc==='4530009999'));
  for(const marker of ['eliminarOrdenesPersistentes','canonicalOrder','deleteCanonical','coi_ordenes_estaciones',".delete().eq('id',canonical.id).select('id,nro_oc')",'No se puede confirmar la eliminación sin conexión a Supabase','V60.1.1-DELETE-REMOTO-CONFIRMADO','Esta acción no elimina PDFs de Storage.']) assert.ok(html.includes(marker),`Falta marcador: ${marker}`);
  const crudModule=html.match(/<script id="coi-crud-ordenes-v601">([\s\S]*?)<\/script>/)?.[1]||''; assert.ok(crudModule); assert.ok(!/localStorage\.clear\s*\(/.test(crudModule));
  console.log('CRUD Órdenes: 15 casos OK; cliente Supabase 100% simulado, cero conexiones productivas.');
})().catch(error=>{console.error(error);process.exit(1)});
