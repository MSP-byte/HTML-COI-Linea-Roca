-- COI Línea Roca · Security hardening · cierre de RPC legacy de auditoría
-- Fecha: 2026-10-05
-- El frontend vigente no invoca esta RPC. Acepta JSON before/after arbitrario
-- para auditoría, por lo que no debe estar expuesta a PostgREST.

begin;

do $$
begin
  if to_regprocedure('public.coi_record_direct_order_update(jsonb,jsonb)') is not null then
    revoke all on function public.coi_record_direct_order_update(jsonb,jsonb)
      from public, anon, authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.coi_record_direct_order_update(jsonb,jsonb) to service_role';
    end if;
  end if;
end $$;

commit;
