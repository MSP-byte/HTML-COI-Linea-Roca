-- COI Línea Roca · capability probe contractual no mutante
begin;
create or replace function public.coi_contractual_capabilities_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select pg_catalog.jsonb_build_object(
    'anular_etapa_circuito_v1',
    pg_catalog.to_regprocedure('public.coi_anular_etapa_circuito_v1(uuid,text,text,uuid[])') is not null
  );
$$;
revoke all on function public.coi_contractual_capabilities_v1() from public, anon, authenticated;
grant execute on function public.coi_contractual_capabilities_v1() to authenticated;
commit;
