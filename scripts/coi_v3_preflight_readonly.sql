-- LECTURA SOLAMENTE: util para PRODUCCION y STAGING. No ejecuta DDL ni DML.
WITH tipos AS (
 SELECT tipo, count(*)::int n FROM public.coi_ordenes GROUP BY tipo
), roles_activos AS (
 SELECT rol, activo, count(*)::int n FROM public.profiles GROUP BY rol, activo
), perms AS (
 SELECT t.nombre,
 has_table_privilege('authenticated','public.'||t.nombre,'SELECT') AS sel_auth,
 has_table_privilege('authenticated','public.'||t.nombre,'INSERT') AS ins_auth,
 has_table_privilege('authenticated','public.'||t.nombre,'UPDATE') AS upd_auth,
 has_table_privilege('authenticated','public.'||t.nombre,'DELETE') AS del_auth
 FROM (VALUES ('coi_ordenes'),('coi_certificaciones'),('profiles')) t(nombre)
)
SELECT jsonb_build_object(
 'captura_utc',now(),
 'pg_version',current_setting('server_version'),
 'tablas_v3',jsonb_build_object(
  'cartera',to_regclass('public.coi_v3_cartera') IS NOT NULL,
  'importaciones',to_regclass('public.coi_v3_importaciones') IS NOT NULL,
  'items',to_regclass('public.coi_v3_importacion_items') IS NOT NULL
 ),
 'rpc_v3',to_regprocedure('public.coi_v3_confirmar_importacion(text,text,jsonb)') IS NOT NULL,
 'oc_total',(SELECT count(*) FROM public.coi_ordenes),
 'cert_total',(SELECT count(*) FROM public.coi_certificaciones),
 'tipos_oc',(SELECT coalesce(jsonb_agg(to_jsonb(tipos)),'[]'::jsonb) FROM tipos),
 'roles',(SELECT coalesce(jsonb_agg(to_jsonb(roles_activos)),'[]'::jsonb) FROM roles_activos),
 'oc_duplicadas',(SELECT count(*) FROM (SELECT nro_oc FROM public.coi_ordenes GROUP BY nro_oc HAVING count(*)>1) d),
 'huella_oc',(SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id)::text,'[]')) FROM public.coi_ordenes o),
 'huella_cert',(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'[]')) FROM public.coi_certificaciones c),
 'permisos_authenticated',(SELECT jsonb_agg(to_jsonb(perms)) FROM perms),
 'rls_v3',(SELECT coalesce(jsonb_agg(jsonb_build_object('tabla',c.relname,'enabled',c.relrowsecurity)),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'coi_v3_%' AND c.relkind='r'),
 'politicas_amplias',(SELECT coalesce(jsonb_agg(jsonb_build_object('tabla',tablename,'politica',policyname,'comando',cmd)),'[]'::jsonb) FROM pg_policies WHERE schemaname='public' AND tablename IN ('coi_ordenes','coi_certificaciones') AND cmd IN ('INSERT','UPDATE') AND ('true'=btrim(coalesce(qual,'')) OR coalesce(with_check,'') LIKE '%auth.uid() IS NOT NULL%')),
 'assert_role_definer',(SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='coi_assert_role' AND p.pronargs=1 LIMIT 1)
) AS reporte_preflight;
