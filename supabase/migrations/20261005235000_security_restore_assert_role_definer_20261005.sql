-- COI Línea Roca · Security hardening · compatibilidad del guard de rol
-- Fecha: 2026-10-05
-- coi_assert_role consulta public.profiles a través de coi_current_role(). Se
-- conserva como SECURITY DEFINER para que el contrato funcione tanto en
-- Supabase como en la base reproducible de CI sin ampliar permisos del cliente.
-- La función sigue cerrada a public/anon, con search_path fijo y EXECUTE sólo
-- para authenticated/service_role.

begin;

do $$
begin
  if to_regprocedure('public.coi_assert_role(text[])') is not null then
    alter function public.coi_assert_role(text[]) security definer;
    alter function public.coi_assert_role(text[]) set search_path = public, pg_temp;
    revoke all on function public.coi_assert_role(text[]) from public, anon;
    grant execute on function public.coi_assert_role(text[]) to authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.coi_assert_role(text[]) to service_role';
    end if;
  end if;
end $$;

commit;
