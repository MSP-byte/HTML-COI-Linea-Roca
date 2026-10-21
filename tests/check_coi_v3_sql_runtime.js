#!/usr/bin/env node
'use strict';
// COI V3: ejecutar la migracion REAL en PostgreSQL embebido.
// Sin red, credenciales ni escrituras a Supabase.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {PGlite}=require('@electric-sql/pglite');

const db=new PGlite({extensions:{
 pgcrypto:pathToFileURL(path.join(path.dirname(require.resolve('@electric-sql/pglite')),'pgcrypto.tar.gz'))
}});
const UID='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const OC_ID='33333333-3333-4333-8333-333333333333';
const MIGRATION='supabase/migrations/202610160001_coi_v3_carteras_importacion.sql';
let checks=0;
function check(condition,msg){assert.ok(condition,msg);checks++;}
async function fails(action,pattern){
 let error=null;try{await action();}catch(e){error=String(e.message||e)}
 check(Boolean(error)&&pattern.test(error),'Error esperado '+pattern+', recibido: '+error);
}
async function query(sql,params=[]){return (await db.query(sql,params)).rows}
async function rpc(source,rows){return (await query(
 'select public.coi_v3_confirmar_importacion($1,$2,$3::jsonb) as result',
 [source,'lote-prueba.xlsx',JSON.stringify(rows)]
))[0].result}
function service(oc,fila,description,expected=null){
 return {clave_fuente:'oc:'+oc,nro_oc:oc,fila_excel:fila,
  datos:{descripcion:description,proveedor:'FEMYP',estacion:'Temperley'},
  huella_esperada:expected};
}
async function main(){
 await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
   SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $fn$;
  CREATE TABLE public.profiles(id uuid PRIMARY KEY,rol text,activo boolean);
  CREATE TABLE public.coi_ordenes(id uuid PRIMARY KEY,nro_oc text NOT NULL,tipo text NOT NULL DEFAULT 'Servicio');
  CREATE FUNCTION public.coi_current_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
   SELECT rol FROM public.profiles WHERE id=auth.uid() AND activo=true
  $fn$;
  CREATE FUNCTION public.coi_assert_role(p_roles text[]) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  BEGIN
   IF public.coi_current_role() IS NULL OR NOT(public.coi_current_role()=ANY(p_roles))
   THEN RAISE EXCEPTION 'COI_FORBIDDEN'; END IF;
  END $fn$;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT SELECT ON public.coi_ordenes TO authenticated;
 `);
 await query("INSERT INTO auth.users(id,email) VALUES ($1,'admin@coi.test'),($2,'reader@coi.test')",[UID,OTHER]);
 await query("INSERT INTO public.profiles(id,rol,activo) VALUES ($1,'administrador',true),($2,'consulta',true)",[UID,OTHER]);
 await query("INSERT INTO public.coi_ordenes(id,nro_oc) VALUES ($1,'4530009805')",[OC_ID]);
 await query("INSERT INTO public.coi_ordenes(id,nro_oc,tipo) VALUES ($1,'4530999500','Obra')",['55555555-5555-4555-8555-555555555555']);
 const sql=fs.readFileSync(MIGRATION,'utf8');
 // Impide recuperar el bug 42883 aun cuando alguien modifique el selector.
 check(!/\bmin\s*\(\s*id\s*\)/i.test(sql),'No usar MIN(uuid)');
 await db.exec(sql);
 await db.exec(fs.readFileSync('supabase/migrations/202610190001_coi_v3_tipo_oc_guard.sql','utf8'));
 const homologacion=fs.readFileSync('supabase/migrations/202610210001_coi_v3_homologacion_no_autovinculo.sql','utf8');
 check(/SET nro_oc=v_oc,orden_id=NULL/.test(homologacion),'No autovincular en UPDATE');
 check(/VALUES\(p_fuente,v_clave,v_fila,v_oc,NULL,v_datos/.test(homologacion),'No autovincular en INSERT');
 await db.exec(homologacion);
 await db.exec(fs.readFileSync('supabase/migrations/202610210002_coi_v3_promocion_homologacion.sql','utf8'));
 const auditTables=await query("SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('coi_v3_promociones','coi_v3_procedencia','coi_v3_homologaciones') AND relkind='r'");
 check(auditTables.length===3&&auditTables.every(x=>x.relrowsecurity),'RLS protegida para las tres tablas de procedencia');
 const rls=await query("SELECT relname,relrowsecurity FROM pg_class WHERE relname LIKE 'coi_v3_%' AND relkind='r'");
 check(rls.length===6&&rls.every(x=>x.relrowsecurity),'RLS debe estar activo en las 6 tablas V3');
 await query("SELECT set_config('request.jwt.claim.sub',$1,false)",[UID]);
 await db.exec('SET ROLE authenticated');
 const initial=[service('4530009805',7,'Mantenimiento preventivo'),service('4530009806',8,'Reparacion sin OC contractual')];
 const first=await rpc('servicios',initial);
 check(first.total===2&&first.nuevos===2&&first.actualizados===0,'Primera carga');
 const stored=await query("SELECT clave_fuente,orden_id,huella FROM public.coi_v3_cartera ORDER BY clave_fuente");
 check(stored.length===2,'Dos filas creadas');
 check(stored.find(x=>x.clave_fuente==='oc:4530009805').orden_id===null,'OC existente es referencia, no vínculo homologado');
 check(stored.find(x=>x.clave_fuente==='oc:4530009806').orden_id===null,'OC inexistente no genera OC ficticia');
 const expected=Object.fromEntries(stored.map(r=>[r.clave_fuente,r.huella]));
 const same=initial.map(row=>({...row,huella_esperada:expected[row.clave_fuente]}));
 const again=await rpc('servicios',same);
 check(again.sin_cambios===2&&again.nuevos===0&&again.actualizados===0,'Reintento sin cambios con CAS');
 const changed=service('4530009805',7,'Mantenimiento preventivo actualizado',expected['oc:4530009805']);
 const updated=await rpc('servicios',[changed]);
 check(updated.actualizados===1,'Actualizacion explicita');
 const audit=await query("SELECT huella_anterior,huella_nueva FROM public.coi_v3_importacion_items WHERE accion='actualizado'");
 check(audit.length===1&&audit[0].huella_anterior===expected['oc:4530009805']&&audit[0].huella_nueva!==audit[0].huella_anterior,'Auditoria conserva huella anterior');
 await fails(()=>rpc('servicios',[changed]),/COI_V3_CONCURRENT_CHANGE/);
 const before=await query("SELECT count(*)::int AS n FROM public.coi_v3_cartera");
 await fails(()=>rpc('servicios',[service('4530009810',12,'Se debe revertir'),changed]),/COI_V3_CONCURRENT_CHANGE/);
 const after=await query("SELECT count(*)::int AS n FROM public.coi_v3_cartera");
 check(before[0].n===after[0].n,'Error en lote revierte todas las filas');
 await fails(()=>rpc('servicios',[{clave_fuente:'oc:sin-numero',nro_oc:null,fila_excel:12,datos:{}}]),/COI_V3_SERVICIO_KEY_MISMATCH/);
 await fails(()=>query("INSERT INTO public.coi_v3_cartera(fuente,clave_fuente,fila_excel,datos,huella,creado_por,modificado_por) VALUES ('obras','obra:falsa',1,'{}','x',$1,$1)",[UID]),/permission denied|row-level security/i);
 const asAdmin=await query("SELECT count(*)::int AS n FROM public.coi_v3_cartera");
 check(asAdmin[0].n===2,'Administrador lee cartera');
 await query("SELECT set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
 await fails(()=>rpc('servicios',[service('4530009870',13,'No permitido')]),/COI_FORBIDDEN/);
 await query("SELECT set_config('request.jwt.claim.sub','',false)");
 const noSession=await query("SELECT count(*)::int AS n FROM public.coi_v3_cartera");
 check(noSession[0].n===0,'RLS niega lectura sin identidad');
 await query("SELECT set_config('request.jwt.claim.sub',$1,false)",[UID]);
 const obra1='obra:uuid:77777777-7777-4777-8777-777777777777';
 const obra2='obra:uuid:88888888-8888-4888-8888-888888888888';
 const intervenciones=[
  {clave_fuente:obra1,nro_oc:'4530999500',fila_excel:4,datos:{descripcion:'Anden norte',identificacion:{id_obra_excel:null,estado_identidad:'PENDIENTE_IDENTIFICADOR_ADMIN'}},huella_esperada:null},
  {clave_fuente:obra2,nro_oc:'4530999500',fila_excel:5,datos:{descripcion:'Anden sur',identificacion:{id_obra_excel:null,estado_identidad:'PENDIENTE_IDENTIFICADOR_ADMIN'}},huella_esperada:null}
 ];
 const importObras=await rpc('obras',intervenciones);
 check(importObras.nuevos===2,'Dos intervenciones de Obra pueden compartir una OC');
 const storedObras=await query("SELECT id,clave_fuente,huella,orden_id FROM public.coi_v3_cartera WHERE fuente='obras' ORDER BY fila_excel");
 check(storedObras.length===2&&storedObras[0].id!==storedObras[1].id,'IDs internos UUID independientes');
 check(storedObras.every(r=>r.orden_id===null),'Obras separadas no se vinculan por coincidir número de OC');
 const corregido={...intervenciones[0],datos:{descripcion:'Anden norte',identificacion:{id_obra_excel:'2026/37',estado_identidad:'CON_IDENTIFICADOR_ADMIN'}},huella_esperada:storedObras[0].huella};
 const rectifica=await rpc('obras',[corregido]);
 check(rectifica.actualizados===1,'Asignación posterior del número administrativo actualiza la misma intervención');
 const remap=await query("SELECT id,huella FROM public.coi_v3_cartera WHERE clave_fuente=$1",[obra1]);
 check(remap[0].id===storedObras[0].id,'La intervención conserva el UUID al recibir número administrativo');
 // Simula una homologación externa previamente aprobada por un administrador.
 // La reimportación idéntica la preserva; cualquier modificación la invalida.
 await db.exec('RESET ROLE');
 await query('UPDATE public.coi_v3_cartera SET orden_id=$1 WHERE clave_fuente=$2',
  ['55555555-5555-4555-8555-555555555555',obra2]);
 await db.exec('SET ROLE authenticated');
 const sameApproved={...intervenciones[1],huella_esperada:storedObras[1].huella};
 const sameApprovedResult=await rpc('obras',[sameApproved]);
 check(sameApprovedResult.sin_cambios===1,'Reimportación igual de vínculo homologado');
 const stillApproved=await query('SELECT orden_id FROM public.coi_v3_cartera WHERE clave_fuente=$1',[obra2]);
 check(stillApproved[0].orden_id==='55555555-5555-4555-8555-555555555555',
  'Reimportación idéntica conserva vínculo previamente homologado');
 const changedApproved={...sameApproved,
  datos:{...sameApproved.datos,descripcion:'Andén sur: modificación que requiere nueva homologación'}};
 const changedApprovalResult=await rpc('obras',[changedApproved]);
 check(changedApprovalResult.actualizados===1,'Cambio real reimportado tras homologación');
 const invalidated=await query('SELECT orden_id FROM public.coi_v3_cartera WHERE clave_fuente=$1',[obra2]);
 check(invalidated[0].orden_id===null,'Cambio documental invalida vínculo sin recrearlo');
 await fails(()=>rpc('obras',[{...intervenciones[0],nro_oc:'4530009805',huella_esperada:remap[0].huella}]),/COI_V3_OC_TYPE_MISMATCH/);
 await fails(()=>rpc('servicios',[service('4530999500',20,'Contratación errónea')]),/COI_V3_OC_TYPE_MISMATCH/);
 // Sin referencia documental y sin coincidencia contractual no se homologa.
 const target=await query("SELECT id,huella FROM public.coi_v3_cartera WHERE clave_fuente='oc:4530009805'");
 await fails(()=>query('SELECT public.coi_v3_homologar_contrato($1,$2,$3,$4,$5)',[
  target[0].id,OC_ID,target[0].huella,'SIN REF','SIN OBS'
 ]),/COI_V3_FALTA_EVIDENCIA_O_HUELLA/);
 await fails(()=>query('SELECT public.coi_v3_homologar_contrato($1,$2,$3,$4,$5)',[
  target[0].id,'55555555-5555-4555-8555-555555555555',target[0].huella,
  'SERCAE:documento-legible','Validacion documental en laboratorio'
 ]),/COI_V3_OC_DIFERENTE/);
 const approve=await query('SELECT public.coi_v3_homologar_contrato($1,$2,$3,$4,$5) as id',[
  target[0].id,OC_ID,target[0].huella,'SERCAE:documento-legible','Validacion documental en laboratorio'
 ]);
 check(Boolean(approve[0].id),'Homologacion explícita aprobada con referencia documental');
 const approved=await query('SELECT orden_id FROM public.coi_v3_cartera WHERE id=$1',[target[0].id]);
 check(approved[0].orden_id===OC_ID,'Vincula UUID solo con aprobación explícita');
 const evidence=await query('SELECT aprobado_por,referencia_documental FROM public.coi_v3_homologaciones WHERE cartera_id=$1',[target[0].id]);
 check(evidence.length===1 && evidence[0].aprobado_por===UID,'Auditoria documental del administrador es persistente');
 await fails(()=>query('SELECT public.coi_v3_homologar_contrato($1,$2,$3,$4,$5)',[
  target[0].id,OC_ID,target[0].huella,'SERCAE:documento-legible','Validacion documental duplicada bloqueada'
 ]),/COI_V3_YA_HOMOLOGADA/);
 await query("SELECT set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
 await fails(()=>query('SELECT public.coi_v3_homologar_contrato($1,$2,$3,$4,$5)',[
  target[0].id,OC_ID,target[0].huella,'SERCAE:documento-legible','Intento de usuario consulta'
 ]),/COI_FORBIDDEN/);
 await query("SELECT set_config('request.jwt.claim.sub',$1,false)",[UID]);
 await db.exec('RESET ROLE');
 const unchanged=await query("SELECT count(*)::int AS n FROM public.coi_ordenes WHERE id=$1 AND nro_oc='4530009805'",[OC_ID]);
 check(unchanged[0].n===1,'La OC contractual permanece intacta');
 const batch=await query("SELECT count(*)::int AS n FROM public.coi_v3_importaciones");
 check(batch[0].n===7,'Solo se auditan los lotes confirmados');
 console.log('PASS COI V3 SQL PGlite: '+checks+' verificaciones (UUID, RLS, CAS, reintento, auditoria, rollback, roles)');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.close());
