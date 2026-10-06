-- COI Línea Roca · Security hardening V1
-- Cierra exposición API innecesaria de funciones de trigger.
-- Los triggers continúan ejecutándose por PostgreSQL; no requieren EXECUTE
-- directo de roles cliente (anon/authenticated).
-- No modifica datos operativos.

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
