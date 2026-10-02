#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {PGlite}=require('@electric-sql/pglite');

const DIST=path.dirname(require.resolve('@electric-sql/pglite'));
const PGCRYPTO=pathToFileURL(path.join(DIST,'pgcrypto.tar.gz'));
const DIR='supabase/migrations';
const UID='11111111-1111-4111-8111-111111111111';
let ok=0;
const check=(v,m)=>{assert.ok(v,m);ok++;};

const PLATAFORMA=[
 'create role anon nologin;',
 'create role authenticated nologin;',
 'create schema auth;',
 'create table auth.users(id uuid primary key,email text);',
 'create function auth.uid() returns uuid language sql stable as $fn$',
 " select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid",
 '$fn$;',
 'create function auth.jwt() returns jsonb language sql stable as $fn$',
 " select jsonb_build_object('email',current_setting('request.jwt.claim.email',true),'role',current_setting('request.jwt.claim.role',true))",
 '$fn$;'
].join('\n');

async function main(){
 const db=new PGlite({extensions:{pgcrypto:PGCRYPTO}});
 await db.exec(PLATAFORMA);
 for(const f of fs.readdirSync(DIR).filter(x=>x.endsWith('.sql')).sort())
   await db.exec(fs.readFileSync(path.join(DIR,f),'utf8'));

 await db.query('insert into auth.users(id,email) values ($1,$2)',[UID,'admin@coiroca.com']);
 await db.query("insert into public.profiles(id,email,rol,activo) values ($1,$2,'administrador',true)",[UID,'admin@coiroca.com']);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[UID]);
 await db.query("select set_config('request.jwt.claim.email','admin@coiroca.com',false)");
 await db.query("select set_config('request.jwt.claim.role','administrador',false)");

 const {rows:[oc]}=await db.query(
   "insert into public.coi_ordenes(nro_oc,tipo,estado_coi) values ('4530999901','Servicio','Pendiente de completar') returning id");
 const id=oc.id;
 const {rows:[hoy]}=await db.query("select to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date,'YYYY-MM-DD') d");
 const H=hoy.d;
 const confirmar=(codigo)=>db.query(
   'select public.coi_confirmar_etapa_circuito_v3($1,$2,null,$3::date) r',[id,codigo,H]);
 const anular=(codigo)=>db.query(
   "select public.coi_anular_etapa_circuito_v1($1,$2,'corrección de prueba') r",[id,codigo]);

 await confirmar('pliegos_preparacion');
 await confirmar('pliegos_terminado_sin_solped');
 await confirmar('pliegos_preparacion');

 const antes=await db.query(
   "select count(*)::int n from public.coi_historial_oc h where orden_id=$1 and tipo_evento='Circuito administrativo' and campo_modificado='pliegos_preparacion'",[id]);
 check(antes.rows[0].n===2,'el reingreso H1 debe dejar dos confirmaciones auditables');

 const r1=(await anular('pliegos_preparacion')).rows[0].r;
 check(r1.anuladas===2,'desmarcar H1 debe anular todos sus ingresos activos');
 check(r1.ya_anulada===false,'la primera anulación no es idempotente');

 const estado1=await db.query("select estado_documental,estado_coi from public.coi_ordenes where id=$1",[id]);
 check(estado1.rows[0].estado_documental==='PLIEGOS TERMINADO SIN SOLPED','al quitar H1 debe restaurarse H2');
 const activasH1=await db.query(
   "select count(*)::int n from public.coi_historial_oc h where h.orden_id=$1 and h.tipo_evento='Circuito administrativo' and h.campo_modificado='pliegos_preparacion' and not exists (select 1 from public.coi_historial_oc a where a.orden_id=h.orden_id and a.tipo_evento='Anulación circuito administrativo' and a.valor_anterior=h.id::text)",[id]);
 check(activasH1.rows[0].n===0,'H1 no puede seguir activo después de desmarcar');
 const anulaciones=await db.query(
   "select count(*)::int n from public.coi_historial_oc where orden_id=$1 and tipo_evento='Anulación circuito administrativo' and campo_modificado='pliegos_preparacion'",[id]);
 check(anulaciones.rows[0].n===2,'la auditoría debe conservar una anulación por ingreso H1');

 const r2=(await confirmar('pliegos_preparacion')).rows[0].r;
 const filaNueva=(r2.historial||[]).find(x=>x.tipo_evento==='Circuito administrativo');
 check(Boolean(filaNueva),'reconfirmar H1 debe crear una transición nueva');
 check(String(filaNueva.fecha_efectiva).slice(0,10)===H,'la nueva H1 debe iniciar en la fecha efectiva elegida');

 await anular('pliegos_preparacion');
 await anular('pliegos_terminado_sin_solped');
 const vacio=await db.query("select estado_documental,estado_coi from public.coi_ordenes where id=$1",[id]);
 check(vacio.rows[0].estado_documental===null,'sin hitos activos estado_documental debe quedar vacío');
 check(vacio.rows[0].estado_coi==='Pendiente de completar','sin hitos activos el estado visible queda Pendiente de completar');

 const idem=(await anular('pliegos_preparacion')).rows[0].r;
 check(idem.ya_anulada===true&&idem.anuladas===0,'desmarcar otra vez debe ser idempotente');

 const acl=await db.query(`
   select coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false) auth_exec,
          coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false) anon_exec
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='coi_anular_etapa_circuito_v1'`);
 check(acl.rows.length===1&&acl.rows[0].auth_exec===true,'authenticated debe ejecutar la RPC controlada');
 check(acl.rows[0].anon_exec===false,'anon no puede ejecutar la RPC');

 console.log(`Contractual unmark: ${ok} controles aprobados; 0 fallidos.`);
}
main().catch(e=>{console.error('Contractual unmark FAIL:',e.message||e);process.exit(1);});
