-- COI Línea Roca · Security hardening V1
-- Cierra exposición API innecesaria de funciones de trigger.
-- Los triggers continúan ejecutándose por PostgreSQL; no requieren EXECUTE
-- directo de roles cliente (anon/authenticated).
-- No modifica datos operativos.
--
-- Snapshot ACL productivo previo (2026-10-05) para rollback selectivo:
--   authenticated: coi_direct_order_update_audit(), coi_direct_order_update_guard()
--   public+anon+authenticated: coi_guard_order_lifecycle_h10(),
--     coi_normalizar_posicion_oc(), coi_version_servidor()
-- El resto de las funciones trigger coi_* ya estaba cerrado a roles cliente.
--
-- ROLLBACK SELECTIVO (sólo si una regresión demostrada lo exige):
--   grant execute on function public.coi_direct_order_update_audit() to authenticated;
--   grant execute on function public.coi_direct_order_update_guard() to authenticated;
--   grant execute on function public.coi_guard_order_lifecycle_h10() to public, anon, authenticated;
--   grant execute on function public.coi_normalizar_posicion_oc() to public, anon, authenticated;
--   grant execute on function public.coi_version_servidor() to public, anon, authenticated;
-- No aplicar grants más amplios que este snapshot.

begin;

do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name,
           p.proname as function_name,
           pg_get_function_identity_arguments(p.oid) as identity_args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'coi_%'
       and p.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke all privileges on function %I.%I(%s) from public, anon, authenticated',
      r.schema_name, r.function_name, r.identity_args
    );
  end loop;
end
$$;

commit;
