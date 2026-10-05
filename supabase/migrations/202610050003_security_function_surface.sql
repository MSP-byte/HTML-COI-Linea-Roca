-- COI Línea Roca · Security hardening · superficie de funciones
-- Fecha: 2026-10-05
-- coi_assert_role sólo valida la identidad/rol corriente mediante coi_current_role;
-- no necesita ejecutar con privilegios del owner.
-- No modifica datos operativos.

begin;

do $$
begin
  if to_regprocedure('public.coi_assert_role(text[])') is not null then
    alter function public.coi_assert_role(text[]) security invoker;
    alter function public.coi_assert_role(text[]) set search_path = public, pg_temp;
    revoke all on function public.coi_assert_role(text[]) from public, anon;
    grant execute on function public.coi_assert_role(text[]) to authenticated;
  end if;
end $$;

commit;
