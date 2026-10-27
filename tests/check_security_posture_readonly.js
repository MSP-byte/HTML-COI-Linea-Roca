'use strict';
// Tests the *executable* security audit with an isolated in-memory PostgreSQL.
// No keys, credentials, live Supabase clients, or production data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase','qa','security_v3_posture_readonly.sql'),'utf8');
const executable=sql.replace(/--[^\n]*/g,'');
assert.doesNotMatch(executable,/\b(?:insert\s+into|update\s+\w+|delete\s+from|truncate|alter|create|drop|revoke|grant|execute|call|copy|do)\b/i,
 'The live audit must remain strictly read-only SQL');
assert.match(executable,/^\s*WITH\b/i);
assert.match(executable,/ORDER BY check_id;\s*$/i);

(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.coi_current_role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';
REVOKE ALL ON FUNCTION public.coi_current_role() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.coi_current_role() TO authenticated;
CREATE FUNCTION public.coi_secure_helper() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS 'SELECT ''ok''::text';
REVOKE ALL ON FUNCTION public.coi_secure_helper() FROM PUBLIC,anon;
CREATE TABLE public.profiles (id int primary key);
CREATE TABLE public.coi_ordenes (id int primary key);
`);
  for(const table of ['profiles','coi_ordenes']){
   await db.exec(`
ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY ${table}_select_allow ON public.${table} FOR SELECT TO authenticated USING (public.coi_current_role() IS NOT NULL);
CREATE POLICY ${table}_select_guard ON public.${table} AS RESTRICTIVE FOR SELECT TO authenticated USING (public.coi_current_role() IS NOT NULL);
CREATE POLICY ${table}_insert_allow ON public.${table} FOR INSERT TO authenticated WITH CHECK (public.coi_current_role() IS NOT NULL);
CREATE POLICY ${table}_insert_guard ON public.${table} AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.coi_current_role() IS NOT NULL);
CREATE POLICY ${table}_update_allow ON public.${table} FOR UPDATE TO authenticated USING (public.coi_current_role() IS NOT NULL) WITH CHECK (public.coi_current_role() IS NOT NULL);
CREATE POLICY ${table}_update_guard ON public.${table} AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.coi_current_role() IS NOT NULL) WITH CHECK (public.coi_current_role() IS NOT NULL);
CREATE POLICY ${table}_delete_allow ON public.${table} FOR DELETE TO authenticated USING (public.coi_current_role() IS NOT NULL);
CREATE POLICY ${table}_delete_guard ON public.${table} AS RESTRICTIVE FOR DELETE TO authenticated USING (public.coi_current_role() IS NOT NULL);
`);
  }
  async function statuses(){
    const {rows}=await db.query(sql);
    assert.equal(rows.length,7,'Audit must return seven deterministic checks');
    return Object.fromEntries(rows.map(r=>[r.check_id,r.status]));
  }
  const good=await statuses();
  assert.ok(Object.values(good).every(v=>v==='PASS'),'Healthy database must pass all checks: '+JSON.stringify(good));
  await db.exec('GRANT SELECT ON public.profiles TO anon');
  assert.equal((await statuses()).C02_NO_ANON_TABLE_GRANTS,'FAIL','Detect accidental anonymous access');
  await db.exec('REVOKE SELECT ON public.profiles FROM anon');
  await db.exec('ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY');
  assert.equal((await statuses()).C01_RLS_ON_ALL_TABLES,'FAIL','Detect disabled RLS');
  await db.exec('ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY');
  await db.exec('DROP POLICY profiles_select_guard ON public.profiles');
  assert.equal((await statuses()).C07_OC_PROFILE_ROLE_GUARDS,'FAIL','Detect missing restrictive role guard');
  await db.exec('DROP FUNCTION public.coi_secure_helper()');
  await db.exec("CREATE FUNCTION public.coi_secure_helper() RETURNS text LANGUAGE sql SECURITY DEFINER AS 'SELECT ''ok''::text'");
  await db.exec('REVOKE ALL ON FUNCTION public.coi_secure_helper() FROM PUBLIC,anon');
  assert.equal((await statuses()).C05_SECURITY_DEFINER_FIXED_PATH,'FAIL','Detect unpinned privileged search_path');
  console.log('Security posture: seven checks + four negative controls PASS');
 }finally{await db.close();}
})().catch(e=>{console.error('FAIL security posture:',e);process.exitCode=1;});
