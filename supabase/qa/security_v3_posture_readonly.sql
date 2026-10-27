-- COI Roca · Seguridad V3 · control no destructivo
-- Ejecutar por separado en STAGING y PROD con rol administrativo de lectura.
-- No crea tablas, funciones, usuarios ni escribe OC.
WITH
  rels AS (
    SELECT c.oid,c.relname,c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
  ),
  funcs AS (
    SELECT p.oid,p.proname,p.prosecdef,p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
  ),
  -- A policy FOR ALL applies to all four operations; expand before grouping.
  expanded_policies AS (
    SELECT p.tablename, ops.cmd, p.permissive, p.qual, p.with_check
    FROM pg_policies AS p
    CROSS JOIN LATERAL unnest(
      CASE WHEN p.cmd='ALL' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]
           ELSE ARRAY[p.cmd]::text[] END
    ) AS ops(cmd)
    WHERE p.schemaname='public'
      AND p.tablename IN ('profiles','coi_ordenes')
      AND 'authenticated'=ANY(p.roles)
  ),
  policy_pairs AS (
    SELECT tablename,cmd,
       bool_or(permissive='PERMISSIVE' AND
         (coalesce(qual,'') LIKE '%coi_current_role()%' OR
          coalesce(with_check,'') LIKE '%coi_current_role()%')) AS role_allow,
       bool_or(permissive='RESTRICTIVE' AND
         (coalesce(qual,'') LIKE '%coi_current_role()%' OR
          coalesce(with_check,'') LIKE '%coi_current_role()%')) AS role_restrict
    FROM expanded_policies
    GROUP BY tablename,cmd
  ),
  findings AS (
    SELECT 'C01_RLS_ON_ALL_TABLES' AS check_id,
      (SELECT count(*) FROM rels WHERE NOT relrowsecurity)::int AS violations,
      (SELECT count(*) FROM rels)::int AS inspected
    UNION ALL
    SELECT 'C02_NO_ANON_TABLE_GRANTS',
      (SELECT count(*) FROM rels WHERE
        has_table_privilege('anon',oid,'SELECT') OR
        has_table_privilege('anon',oid,'INSERT') OR
        has_table_privilege('anon',oid,'UPDATE') OR
        has_table_privilege('anon',oid,'DELETE') OR
        has_any_column_privilege('anon',oid,'SELECT') OR
        has_any_column_privilege('anon',oid,'INSERT') OR
        has_any_column_privilege('anon',oid,'UPDATE'))::int,
      (SELECT count(*) FROM rels)::int
    UNION ALL
    SELECT 'C03_NO_ANON_COI_RPC_EXECUTE',
      (SELECT count(*) FROM funcs WHERE proname LIKE 'coi_%' AND
        has_function_privilege('anon',oid,'EXECUTE'))::int,
      (SELECT count(*) FROM funcs WHERE proname LIKE 'coi_%')::int
    UNION ALL
    SELECT 'C04_NO_ANON_SECURITY_DEFINER',
      (SELECT count(*) FROM funcs WHERE prosecdef AND
        has_function_privilege('anon',oid,'EXECUTE'))::int,
      (SELECT count(*) FROM funcs WHERE prosecdef)::int
    UNION ALL
    SELECT 'C05_SECURITY_DEFINER_FIXED_PATH',
      (SELECT count(*) FROM funcs WHERE prosecdef AND
        coalesce(array_to_string(proconfig,','),'') !~ '(^|,)search_path=')::int,
      (SELECT count(*) FROM funcs WHERE prosecdef)::int
    UNION ALL
    SELECT 'C06_NO_CLIENT_SCHEMA_CREATE',
      (has_schema_privilege('anon','public','CREATE')::int +
       has_schema_privilege('authenticated','public','CREATE')::int),
       2
    UNION ALL
    SELECT 'C07_OC_PROFILE_ROLE_GUARDS',
      (8-(SELECT count(*) FROM policy_pairs
         WHERE role_allow AND role_restrict))::int,
      8
  )
SELECT check_id,
  CASE WHEN violations=0 AND inspected>0 THEN 'PASS' ELSE 'FAIL' END AS status,
  violations, inspected
FROM findings ORDER BY check_id;
