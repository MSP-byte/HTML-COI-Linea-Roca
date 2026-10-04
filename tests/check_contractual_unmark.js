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
const fallo=async(fn)=>{try{await fn();return null}catch(e){return String(e.message||e)}};

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

async function nuevaOC(db,nro,cerrada=false){
 await db.exec('begin;');
 try{
   const {rows:[oc]}=cerrada
     ? await db.query(
       `insert into public.coi_ordenes(
          nro_oc,tipo,estado_coi,fecha_cierre_operativo,observacion_cierre
        ) values ($1,'Servicio','Cerrada','2026-10-02','Cierre de prueba') returning id`,[nro])
     : await db.query(
       "insert into public.coi_ordenes(nro_oc,tipo,estado_coi) values ($1,'Servicio','Pendiente de completar') returning id",[nro]);
   await db.query(
     'insert into public.coi_ordenes_estaciones(orden_id,nro_oc,estacion,es_principal) values ($1,$2,$3,true)',
     [oc.id,nro,'PLAZA CONSTITUCION']);
   await db.exec('commit;');
   return oc.id;
 }catch(e){try{await db.exec('rollback')}catch(_){}throw e}
}

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

 const {rows:[hoy]}=await db.query("select to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date,'YYYY-MM-DD') d");
 const H=hoy.d;
 const confirmar=(id,codigo)=>db.query(
   'select public.coi_confirmar_etapa_circuito_v3($1,$2,null,$3::date) r',[id,codigo,H]);
 const anular=(id,codigo)=>db.query(
   "select public.coi_anular_etapa_circuito_v1($1,$2,'corrección de prueba') r",[id,codigo]);

 // A · múltiples reingresos: todos quedan anulados y una nueva H1 reinicia.
 const id=await nuevaOC(db,'4530999901');
 await confirmar(id,'pliegos_preparacion');
 await confirmar(id,'pliegos_terminado_sin_solped');
 await confirmar(id,'pliegos_preparacion');
 const antes=await db.query(
   "select count(*)::int n from public.coi_historial_oc h where orden_id=$1 and tipo_evento='Circuito administrativo' and campo_modificado='pliegos_preparacion'",[id]);
 check(antes.rows[0].n===2,'el reingreso H1 debe dejar dos confirmaciones auditables');

 const r1=(await anular(id,'pliegos_preparacion')).rows[0].r;
 check(r1.anuladas===2&&!r1.ya_anulada,'desmarcar H1 anula todos sus ingresos activos');
 const estado1=await db.query("select estado_documental from public.coi_ordenes where id=$1",[id]);
 check(estado1.rows[0].estado_documental==='PLIEGOS TERMINADO SIN SOLPED','al quitar H1 debe restaurarse H2');
 const activasH1=await db.query(
   "select count(*)::int n from public.coi_historial_oc h where h.orden_id=$1 and h.tipo_evento='Circuito administrativo' and h.campo_modificado='pliegos_preparacion' and not exists (select 1 from public.coi_historial_oc a where a.orden_id=h.orden_id and a.tipo_evento='Anulación circuito administrativo' and a.valor_anterior=h.id::text)",[id]);
 check(activasH1.rows[0].n===0,'H1 no puede seguir activo después de desmarcar');

 const r2=(await confirmar(id,'pliegos_preparacion')).rows[0].r;
 const filaNueva=(r2.historial||[]).find(x=>x.tipo_evento==='Circuito administrativo');
 check(Boolean(filaNueva)&&String(filaNueva.fecha_efectiva).slice(0,10)===H,'reconfirmar H1 crea un ingreso nuevo con fecha efectiva propia');

 // B · predecessor legacy: al anular la canónica más nueva no se pierde el estado migrado.
 const idLegacy=await nuevaOC(db,'4530999902');
 await db.query(
   `insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,motivo,fecha_evento,fecha_efectiva
    ) values (
      $1,'4530999902','Cambio de estado contractual','estado_documental',
      'PLIEGOS TERMINADO SIN SOLPED','legacy',clock_timestamp()-interval '2 days',(current_date-2)
    )`,[idLegacy]);
 await confirmar(idLegacy,'solped_sin_expediente');
 await anular(idLegacy,'solped_sin_expediente');
 const legacyRestaurado=await db.query("select estado_documental from public.coi_ordenes where id=$1",[idLegacy]);
 check(legacyRestaurado.rows[0].estado_documental==='PLIEGOS TERMINADO SIN SOLPED','la anulación restaura una transición legacy activa');

 // B2 · una transición legacy-only también puede ser el hito a desmarcar.
 const idLegacyOnly=await nuevaOC(db,'4530999905');
 await db.query(
   `insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,motivo,fecha_evento,fecha_efectiva
    ) values (
      $1,'4530999905','Cambio de estado contractual','estado_documental',
      'PLIEGOS TERMINADO SIN SOLPED','legacy-only',clock_timestamp()-interval '1 day',(current_date-1)
    )`,[idLegacyOnly]);
 const legacyOnlyRes=(await anular(idLegacyOnly,'pliegos_terminado_sin_solped')).rows[0].r;
 check(legacyOnlyRes.anuladas===1&&!legacyOnlyRes.ya_anulada,'un hito legacy-only se puede desmarcar');
 const legacyOnlyState=await db.query("select estado_documental from public.coi_ordenes where id=$1",[idLegacyOnly]);
 check(legacyOnlyState.rows[0].estado_documental===null,'el legacy-only desmarcado deja de gobernar el snapshot');

 // B3 · espejo legacy normalizado: una fila histórica equivalente por acentos,
 // grado o whitespace NO puede revivir el hito que acaba de anularse.
 const idMirror=await nuevaOC(db,'4530999907');
 await db.query(
   `insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,motivo,fecha_evento,fecha_efectiva
    ) values
      ($1,'4530999907','Circuito administrativo','pliegos_preparacion',
       'PLIEGOS EN PREPARACIÓN','canónica',clock_timestamp(),'2026-09-24'),
      ($1,'4530999907','Cambio de estado contractual','estado_documental',
       'PLIEGOS  EN PREPARACION','espejo legacy sin acento',clock_timestamp(),'2026-09-24')`,[idMirror]);
 const mirrorRes=(await anular(idMirror,'pliegos_preparacion')).rows[0].r;
 check(mirrorRes.anuladas===1,'el espejo legacy equivalente no se anula dos veces');
 const mirrorState=await db.query("select estado_documental,estado_coi from public.coi_ordenes where id=$1",[idMirror]);
 check(mirrorState.rows[0].estado_documental===null&&mirrorState.rows[0].estado_coi==='Pendiente de completar',
   'el espejo legacy normalizado no puede restaurar un hito anulado');

 // C · cierre operativo inmutable: desmarcar no reabre ni rompe el guard H10.
 const idClosed=await nuevaOC(db,'4530999903',true);
 await db.query(
   `insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,motivo,fecha_efectiva
    ) values (
      $1,'4530999903','Circuito administrativo','pliegos_preparacion',
      'PLIEGOS EN PREPARACIÓN','histórico','2026-09-24'
    )`,[idClosed]);
 const closedRes=(await anular(idClosed,'pliegos_preparacion')).rows[0].r;
 check(closedRes.anuladas===1,'una OC cerrada también puede corregir su traza contractual');
 const closed=await db.query("select estado_coi,estado_documental from public.coi_ordenes where id=$1",[idClosed]);
 check(closed.rows[0].estado_coi==='Cerrada','desmarcar jamás reabre una OC cerrada');
 check(closed.rows[0].estado_documental===null,'el eje documental sí puede quedar sin hito activo');

 // D · sin hitos activos vuelve a Pendiente de completar; segunda anulación es idempotente.
 await anular(id,'pliegos_preparacion');
 await anular(id,'pliegos_terminado_sin_solped');
 const vacio=await db.query("select estado_documental,estado_coi from public.coi_ordenes where id=$1",[id]);
 check(vacio.rows[0].estado_documental===null&&vacio.rows[0].estado_coi==='Pendiente de completar','sin hitos activos el snapshot vuelve a pendiente');
 const idem=(await anular(id,'pliegos_preparacion')).rows[0].r;
 check(idem.ya_anulada===true&&idem.anuladas===0,'desmarcar otra vez es idempotente');

 // E · seguridad: authenticated no puede fabricar anulaciones por INSERT directo,
 // pero sí puede invocar la RPC SECURITY DEFINER.
 const idAcl=await nuevaOC(db,'4530999904');
 await confirmar(idAcl,'pliegos_preparacion');
 await db.exec('set role authenticated');
 const directo=await fallo(()=>db.query(
   "insert into public.coi_historial_oc(orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo) values ($1,'4530999904','Anulación circuito administrativo','pliegos_preparacion','00000000-0000-4000-8000-000000000000','PLIEGOS EN PREPARACIÓN')",[idAcl]));
 check(Boolean(directo)&&/row-level security|policy/i.test(directo),'la anulación directa debe ser rechazada por RLS');
 const directoSinAcento=await fallo(()=>db.query(
   "insert into public.coi_historial_oc(orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo) values ($1,'4530999904','Anulacion circuito administrativo','pliegos_preparacion','00000000-0000-4000-8000-000000000001','PLIEGOS EN PREPARACIÓN')",[idAcl]));
 check(Boolean(directoSinAcento)&&/row-level security|policy/i.test(directoSinAcento),'la variante sin acento también debe ser rechazada por RLS');
 const directoEspacios=await fallo(()=>db.query(
   "insert into public.coi_historial_oc(orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo) values ($1,'4530999904','Anulación  circuito   administrativo','pliegos_preparacion','00000000-0000-4000-8000-000000000002','PLIEGOS EN PREPARACIÓN')",[idAcl]));
 check(Boolean(directoEspacios)&&/row-level security|policy/i.test(directoEspacios),'la variante con espacios repetidos también debe ser rechazada por RLS');
 const directoDescompuesto=await fallo(()=>db.query(
   "insert into public.coi_historial_oc(orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo) values ($1,'4530999904',$2,'pliegos_preparacion','00000000-0000-4000-8000-000000000003','PLIEGOS EN PREPARACIÓN')",
   [idAcl,'Anulacio\u0301n circuito administrativo']));
 check(Boolean(directoDescompuesto)&&/row-level security|policy/i.test(directoDescompuesto),'la variante Unicode descompuesta también debe ser rechazada por RLS');
 const directoCombiningIgnorable=await fallo(()=>db.query(
   "insert into public.coi_historial_oc(orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo) values ($1,'4530999904',$2,'pliegos_preparacion','00000000-0000-4000-8000-000000000004','PLIEGOS EN PREPARACIÓN')",
   [idAcl,'Anulacio\u034Fn circuito administrativo']));
 check(Boolean(directoCombiningIgnorable)&&/row-level security|policy/i.test(directoCombiningIgnorable),
   'U+034F dentro del tipo de anulación también debe ser rechazado por RLS');
 const espaciosUnicode=[
   '\u00A0','\u1680','\u2000','\u2001','\u2002','\u2003','\u2004','\u2005','\u2006','\u2007',
   '\u2008','\u2009','\u200A','\u2028','\u2029','\u202F','\u205F','\u3000','\uFEFF'
 ].map(x=>JSON.parse('"'+x+'"'));
 for(let i=0;i<espaciosUnicode.length;i+=1){
   const tipo='Anulación'+espaciosUnicode[i]+'circuito'+espaciosUnicode[i]+'administrativo';
   const err=await fallo(()=>db.query(
     "insert into public.coi_historial_oc(orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo) values ($1,'4530999904',$2,'pliegos_preparacion',$3,'PLIEGOS EN PREPARACIÓN')",
     [idAcl,tipo,'00000000-0000-4000-8000-'+String(i+10).padStart(12,'0')]));
   check(Boolean(err)&&/row-level security|policy/i.test(err),'la variante con whitespace Unicode U+'+espaciosUnicode[i].codePointAt(0).toString(16).toUpperCase()+' debe ser rechazada por RLS');
 }
 const porRpc=await db.query("select public.coi_anular_etapa_circuito_v1($1,'pliegos_preparacion','vía RPC') r",[idAcl]);
 check(porRpc.rows[0].r.anuladas===1,'authenticated sí puede anular por la RPC controlada');
 await db.exec('reset role');

 // F · un H8 anulado sin fecha de Acta no habilita ejecución por RPC.
 const idGate=await nuevaOC(db,'4530999906');
 await db.query(
   `insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_nuevo,motivo,fecha_efectiva
    ) values (
      $1,'4530999906','Circuito administrativo','control_terceros_con_acta',
      'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO','histórico sin fecha','2026-09-20'
    )`,[idGate]);
 await anular(idGate,'control_terceros_con_acta');
 const gateError=await fallo(()=>confirmar(idGate,'ejecucion'));
 check(Boolean(gateError)&&/COI_ACTA_INICIO_REQUIRED/.test(gateError),'H8 anulado sin fecha de Acta no habilita H9');

 // G · si v3 creó la fecha de Acta exclusivamente al confirmar H8, desmarcar H8
 // revierte esa fecha y el gate vuelve a quedar cerrado.
 const idActaDerivada=await nuevaOC(db,'4530999908');
 await confirmar(idActaDerivada,'control_terceros_con_acta');
 const actaCreada=await db.query(
   "select to_char(fecha_acta_inicio,'YYYY-MM-DD') fecha_acta_inicio from public.coi_ordenes where id=$1",[idActaDerivada]);
 check(actaCreada.rows[0].fecha_acta_inicio===H,'H8 crea la fecha de Acta cuando estaba vacía');
 const marker=await db.query(
   "select count(*)::int n from public.coi_historial_oc where orden_id=$1 and tipo_evento='Conciliación Acta de Inicio' and motivo='registrada_por_hito_8'",[idActaDerivada]);
 check(marker.rows[0].n===1,'la fecha creada por H8 queda marcada con procedencia auditable');
 const unmarkActa=(await anular(idActaDerivada,'control_terceros_con_acta')).rows[0].r;
 check(unmarkActa.orden.fecha_acta_inicio===null,'desmarcar H8 revierte la fecha que H8 había creado');
 const actaRevertidaDB=await db.query("select fecha_acta_inicio from public.coi_ordenes where id=$1",[idActaDerivada]);
 check(actaRevertidaDB.rows[0].fecha_acta_inicio===null,'la reversión H8 también queda persistida en la OC');
 const gateDerivado=await fallo(()=>confirmar(idActaDerivada,'ejecucion'));
 check(Boolean(gateDerivado)&&/COI_ACTA_INICIO_REQUIRED/.test(gateDerivado),'la fecha derivada anulada no sigue habilitando H9');

 // H · una fecha existente antes de H8 no pertenece al hito y nunca se borra.
 const idActaPrevia=await nuevaOC(db,'4530999909');
 await db.query("update public.coi_ordenes set fecha_acta_inicio='2026-09-01' where id=$1",[idActaPrevia]);
 await db.query(
   "select public.coi_confirmar_etapa_circuito_v3($1,'control_terceros_con_acta',null,'2026-09-01'::date) r",[idActaPrevia]);
 await anular(idActaPrevia,'control_terceros_con_acta');
 const actaPrevia=await db.query("select to_char(fecha_acta_inicio,'YYYY-MM-DD') fecha_acta_inicio from public.coi_ordenes where id=$1",[idActaPrevia]);
 check(actaPrevia.rows[0].fecha_acta_inicio==='2026-09-01','desmarcar H8 preserva una fecha de Acta preexistente');

 // I · si la fecha derivada fue modificada después, la edición posterior gana.
 const idActaEditada=await nuevaOC(db,'4530999910');
 await confirmar(idActaEditada,'control_terceros_con_acta');
 await db.query(
   `insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo,motivo,fecha_efectiva
    ) values (
      $1,'4530999910','Conciliación Acta de Inicio','fecha_acta_inicio',$2,'2026-09-30',
      'edicion_posterior_independiente','2026-09-30'
    )`,[idActaEditada,H]);
 await db.query("update public.coi_ordenes set fecha_acta_inicio='2026-09-30' where id=$1",[idActaEditada]);
 await anular(idActaEditada,'control_terceros_con_acta');
 const actaEditada=await db.query("select to_char(fecha_acta_inicio,'YYYY-MM-DD') fecha_acta_inicio from public.coi_ordenes where id=$1",[idActaEditada]);
 check(actaEditada.rows[0].fecha_acta_inicio==='2026-09-30','una edición posterior de la fecha de Acta se preserva');

 const acl=await db.query(`
   select coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false) auth_exec,
          coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false) anon_exec
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='coi_anular_etapa_circuito_v1'`);
 check(acl.rows.length===1&&acl.rows[0].auth_exec===true&&acl.rows[0].anon_exec===false,'ACL de RPC: authenticated sí, anon no');

 const pol=await db.query(
   "select permissive,cmd,roles::text,with_check from pg_policies where schemaname='public' and tablename='coi_historial_oc' and policyname='coi_historial_anulacion_rpc_only_v1'");
 check(pol.rows.length===1&&String(pol.rows[0].permissive).toUpperCase().startsWith('RESTRICTIVE'),'existe policy restrictiva para anulaciones');

 console.log(`Contractual unmark: ${ok} controles aprobados; 0 fallidos.`);
}
main().catch(e=>{console.error('Contractual unmark FAIL:',e.message||e);process.exit(1);});
