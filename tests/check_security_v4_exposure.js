'use strict';
// Run actual live read-only exposure audit against an isolated PGlite fixture.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase','qa','security_v4_exposure_readonly.sql'),'utf8');
const clean=sql.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
assert.doesNotMatch(clean,/\b(?:insert\s+into|update\s+\w+|delete\s+from|truncate|alter|create|drop|revoke|grant|execute|call|copy|do)\b/i,
  'Live audit must be read-only SELECT');
assert.match(clean,/^\s*WITH\b/i);
assert.match(clean,/ORDER BY check_id;\s*$/i);

(async()=>{
  const db=new PGlite();
  try{
    await db.exec([
      'CREATE ROLE anon;',
      'CREATE ROLE authenticated;',
      'CREATE SCHEMA storage;',
      'CREATE TABLE storage.buckets (id text primary key, public boolean NOT NULL DEFAULT false);',
      'CREATE TABLE storage.objects (id integer primary key, bucket_id text);',
      'ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;',
      "INSERT INTO storage.buckets (id,public) VALUES ('private-docs',false);",
      'CREATE TABLE public.secure_data (id integer primary key);',
      'ALTER TABLE public.secure_data ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY safe_data_select ON public.secure_data FOR SELECT TO authenticated USING (id > 0);',
      "CREATE FUNCTION public.audit_fixture() RETURNS integer LANGUAGE sql AS 'SELECT 1';",
      'REVOKE ALL ON FUNCTION public.audit_fixture() FROM PUBLIC,anon;',
      'CREATE VIEW public.invoker_view WITH (security_invoker=true) AS SELECT id FROM public.secure_data;',
      'GRANT SELECT ON public.invoker_view TO authenticated;'
    ].join('\n'));
    async function check(){
      const {rows}=await db.query(sql);
      assert.equal(rows.length,5);
      return Object.fromEntries(rows.map(r=>[r.check_id,r.status]));
    }
    const expected=[
      'E01_NO_ANON_PUBLIC_FUNCTION_EXECUTE',
      'E02_NO_EXPOSED_RLS_BYPASS_VIEWS',
      'E03_NO_USER_METADATA_RLS_AUTH',
      'E04_NO_PUBLIC_STORAGE_BUCKETS',
      'E05_STORAGE_CORE_RLS_ENABLED'
    ];
    let x=await check();
    assert.ok(expected.every(k=>x[k]==='PASS'),'Secure fixture should pass: '+JSON.stringify(x));

    await db.exec('GRANT EXECUTE ON FUNCTION public.audit_fixture() TO anon;');
    assert.equal((await check()).E01_NO_ANON_PUBLIC_FUNCTION_EXECUTE,'FAIL','Detect anon executable RPC with arbitrary name');
    await db.exec('REVOKE EXECUTE ON FUNCTION public.audit_fixture() FROM anon;');

    await db.exec('CREATE VIEW public.legacy_exposed_view AS SELECT id FROM public.secure_data; GRANT SELECT ON public.legacy_exposed_view TO authenticated;');
    assert.equal((await check()).E02_NO_EXPOSED_RLS_BYPASS_VIEWS,'FAIL','Detect exposed owner-rights view');
    await db.exec('DROP VIEW public.legacy_exposed_view;');
    await db.exec('CREATE VIEW public.column_exposed AS SELECT id FROM public.secure_data; GRANT SELECT(id) ON public.column_exposed TO authenticated;');
    assert.equal((await check()).E02_NO_EXPOSED_RLS_BYPASS_VIEWS,'FAIL',
      'Detect exposed owner-rights view with only a column-level SELECT grant');
    await db.exec('DROP VIEW public.column_exposed;');

    await db.exec("CREATE POLICY bad_metadata_role ON public.secure_data FOR SELECT TO authenticated USING (current_setting('request.jwt.claims',true)::jsonb -> 'user_metadata' ? 'role');");
    assert.equal((await check()).E03_NO_USER_METADATA_RLS_AUTH,'FAIL','Detect mutable user metadata in policies');
    await db.exec('DROP POLICY bad_metadata_role ON public.secure_data;');

    await db.exec("INSERT INTO storage.buckets (id,public) VALUES ('unexpected-public',true);");
    assert.equal((await check()).E04_NO_PUBLIC_STORAGE_BUCKETS,'FAIL','Detect accidentally public buckets');
    await db.exec("DELETE FROM storage.buckets WHERE id='unexpected-public';");

    await db.exec('ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;');
    assert.equal((await check()).E05_STORAGE_CORE_RLS_ENABLED,'FAIL','Detect missing storage object RLS');
    await db.exec('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;');

    x=await check();
    assert.ok(expected.every(k=>x[k]==='PASS'),'Repaired fixture must return PASS: '+JSON.stringify(x));
    console.log('Security V4 exposure: five checks + six negative controls PASS');
  }finally{await db.close();}
})().catch(e=>{console.error('FAIL exposure regression:',e);process.exitCode=1;});
