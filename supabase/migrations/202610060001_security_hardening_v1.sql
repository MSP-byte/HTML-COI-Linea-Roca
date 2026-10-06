-- COI Línea Roca · Security Hardening V1
-- Reduce superficie de ataque de la Data API sin alterar el contrato authenticated.
-- 1) Ninguna función COI queda ejecutable por PUBLIC/anon.
-- 2) Las funciones nuevas creadas por postgres en public nacen cerradas a PUBLIC.
-- 3) No modifica datos ni revoca permisos authenticated/service_role existentes.

begin;

do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and left(p.proname, 4) = 'coi_'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon',
      r.schema_name,
      r.function_name,
      r.identity_args
    );
  end loop;
end
$$;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

commit;
