-- COI Roca | Auditoría V4: superficie anónima, políticas y Storage.
-- EXCLUSIVAMENTE SELECT: no modifica datos, grants ni políticas.
WITH
  public_functions AS (
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
  ),
  exposed_views AS (
    SELECT c.oid,c.relkind,c.reloptions
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('v','m')
  ),
  policies AS (
    SELECT tablename,policyname,qual,with_check
    FROM pg_policies WHERE schemaname IN ('public','storage')
  ),
  storage_tables AS (
    SELECT c.relname,c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='storage' AND c.relname IN ('objects','buckets')
      AND c.relkind IN ('r','p')
  ),
  checks AS (
    SELECT 'E01_NO_ANON_PUBLIC_FUNCTION_EXECUTE' AS check_id,
      (SELECT count(*) FROM public_functions WHERE has_function_privilege('anon',oid,'EXECUTE'))::int AS violations,
      (SELECT count(*) FROM public_functions)::int AS inspected
    UNION ALL
    SELECT 'E02_NO_EXPOSED_RLS_BYPASS_VIEWS',
      (SELECT count(*) FROM exposed_views
       WHERE (has_table_privilege('anon',oid,'SELECT') OR
              has_table_privilege('authenticated',oid,'SELECT') OR
              has_any_column_privilege('anon',oid,'SELECT') OR
              has_any_column_privilege('authenticated',oid,'SELECT'))
         AND (relkind='m' OR NOT ('security_invoker=true'=ANY(coalesce(reloptions,ARRAY[]::text[])))))::int,
      (SELECT count(*) FROM exposed_views)::int
    UNION ALL
    SELECT 'E03_NO_USER_METADATA_RLS_AUTH',
      (SELECT count(*) FROM policies
       WHERE (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~* '(raw_user_meta_data|user_metadata)')::int,
      (SELECT count(*) FROM policies)::int
    UNION ALL
    SELECT 'E04_NO_PUBLIC_STORAGE_BUCKETS',
      (SELECT count(*) FROM storage.buckets WHERE public)::int,
      (SELECT count(*) FROM storage.buckets)::int
    UNION ALL
    SELECT 'E05_STORAGE_CORE_RLS_ENABLED',
      (SELECT 2-count(*) FROM storage_tables
       WHERE relname IN ('objects','buckets') AND relrowsecurity)::int,
      2
  )
SELECT check_id,
  CASE WHEN violations=0 THEN 'PASS' ELSE 'FAIL' END AS status,
  violations, inspected
FROM checks ORDER BY check_id;