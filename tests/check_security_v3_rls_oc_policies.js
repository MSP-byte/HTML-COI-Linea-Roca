'use strict';
// Ejecuta SQL real en memoria: sin OCs productivas, cuentas ni grants remotos.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','202610260001_security_v3_rls_oc_policies.sql'),'utf8');

for(const table of ['coi_ordenes','coi_ordenes_estaciones']){
  assert.ok(migration.includes("'"+table+"'"),'El script debe contemplar '+table);
}
assert.match(migration,/COI_RLS_ROLE_GUARD_MISSING/);
assert.match(migration,/DROP POLICY IF EXISTS/);
assert.doesNotMatch(migration,/\b(?:revoke|grant|delete from|truncate|drop table|alter table)\b/i);
assert.match(migration,/BEGIN;[\s\S]*COMMIT;\s*$/i);

(async()=>{
 const db=new PGlite();
 try{
   await db.exec(`
CREATE ROLE authenticated;
CREATE FUNCTION public.coi_current_role() RETURNS text LANGUAGE sql STABLE AS $fn$
 SELECT NULLIF(current_setting('coi.mock_role',true),'')
$fn$;
`);
   for(const table of ['coi_ordenes','coi_ordenes_estaciones']){
     await db.exec(`
CREATE TABLE public.${table} (id int primary key, valor text);
INSERT INTO public.${table}(id,valor) VALUES (1,'original');
ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.${table} TO authenticated;
CREATE POLICY ${table}_select_auth ON public.${table} FOR SELECT TO authenticated USING (true);
CREATE POLICY ${table}_insert_auth ON public.${table} FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ${table}_update_auth ON public.${table} FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY ${table}_delete_admin ON public.${table} FOR DELETE TO authenticated USING (true);
CREATE POLICY ${table}_select_guard ON public.${table} FOR SELECT TO authenticated USING (public.coi_current_role() IS NOT NULL);
CREATE POLICY ${table}_insert_guard ON public.${table} FOR INSERT TO authenticated WITH CHECK (public.coi_current_role()='administrador');
CREATE POLICY ${table}_update_guard ON public.${table} FOR UPDATE TO authenticated USING (public.coi_current_role()='administrador') WITH CHECK (public.coi_current_role()='administrador');
CREATE POLICY ${table}_delete_guard ON public.${table} FOR DELETE TO authenticated USING (public.coi_current_role()='administrador');
`);
   }
   await db.exec('SET ROLE authenticated');
   let before=await db.query("SELECT count(*)::int n FROM public.coi_ordenes");
   assert.equal(before.rows[0].n,1,'Control negativo: el bypass existe antes de migrar');
   await db.exec('RESET ROLE');
   await db.exec(migration);
   const {rows:policies}=await db.query("SELECT tablename,policyname FROM pg_policies WHERE schemaname='public'");
   assert.equal(policies.filter(p=>/_(?:select_auth|insert_auth|update_auth|delete_admin)$/.test(p.policyname)).length,0,'Sin políticas bypass residuales');
   await db.exec('SET ROLE authenticated');
   for(const table of ['coi_ordenes','coi_ordenes_estaciones']){
     let res=await db.query(`SELECT count(*)::int n FROM public.${table}`);
     assert.equal(res.rows[0].n,0,'Sin perfil, la lectura queda cerrada en '+table);
     await db.exec("SELECT set_config('coi.mock_role','consulta',false)");
     res=await db.query(`SELECT count(*)::int n FROM public.${table}`);
     assert.equal(res.rows[0].n,1,'Perfil consulta puede leer '+table);
     res=await db.query(`UPDATE public.${table} SET valor='no permitida' WHERE id=1 RETURNING id`);
     assert.equal(res.rows.length,0,'Perfil consulta no puede actualizar '+table);
     await db.exec("SELECT set_config('coi.mock_role','administrador',false)");
     res=await db.query(`UPDATE public.${table} SET valor='permitida' WHERE id=1 RETURNING id`);
     assert.equal(res.rows.length,1,'Administrador conserva actualizaciones en '+table);
     await db.exec("SELECT set_config('coi.mock_role','',false)");
   }
   console.log('Security V3 OC RLS: 2 tablas · bypass detectado · rol ausente/consulta/admin PASS');
 }finally{
   try{await db.exec('RESET ROLE')}catch{}
   await db.close();
 }
})().catch(err=>{console.error('FAIL RLS OC V3:',err);process.exitCode=1;});
