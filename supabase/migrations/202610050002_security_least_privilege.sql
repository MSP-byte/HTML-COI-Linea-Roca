-- COI Línea Roca · Security hardening · mínimo privilegio
-- Fecha: 2026-10-05
-- Alcance: privilegios de roles cliente, objetos RPC-only y RPC de capabilities.
-- No modifica datos operativos ni reglas funcionales.

begin;

-- 1) El rol authenticated no necesita privilegios de DDL/estructura sobre
-- tablas consumidas por la aplicación. En particular TRUNCATE no está sujeto
-- a RLS y debe quedar fuera del rol de aplicación.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and (c.relname like 'coi_%' or c.relname = 'profiles')
  loop
    execute format(
      'revoke truncate, references, trigger on table %I.%I from authenticated',
      r.nspname,
      r.relname
    );
  end loop;
end $$;

-- 2) Defensa en profundidad: anon nunca debe tener privilegios directos sobre
-- datos COI/profiles, aunque una migración futura use defaults más amplios.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and (c.relname like 'coi_%' or c.relname = 'profiles')
  loop
    execute format(
      'revoke all privileges on table %I.%I from anon',
      r.nspname,
      r.relname
    );
  end loop;
end $$;

-- 3) Backups históricos: el patrón anterior basado en LEFT podía no cubrir
-- correctamente el prefijo completo. Los backups quedan exclusivamente para
-- administración directa de base, nunca para clientes web.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname like 'coi_documentos_oc_backup_%'
  loop
    execute format(
      'revoke all privileges on table %I.%I from public, anon, authenticated',
      r.nspname,
      r.relname
    );

    execute format(
      'drop policy if exists coi_backup_no_client_access on %I.%I',
      r.nspname,
      r.relname
    );

    execute format(
      'create policy coi_backup_no_client_access on %I.%I as restrictive for all to public using (false) with check (false)',
      r.nspname,
      r.relname
    );
  end loop;
end $$;

-- 4) Tablas deliberadamente RPC-only. Se mantiene RLS y se expresa la
-- denegación directa también mediante una policy explícita para evitar que
-- futuras concesiones de grants abran accidentalmente una vía de acceso.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'coi_alertas_revisadas',
    'coi_idempotency_requests'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format(
        'revoke all privileges on table public.%I from public, anon, authenticated',
        v_table
      );

      execute format(
        'drop policy if exists coi_rpc_only_no_client_access on public.%I',
        v_table
      );

      execute format(
        'create policy coi_rpc_only_no_client_access on public.%I as restrictive for all to public using (false) with check (false)',
        v_table
      );
    end if;
  end loop;
end $$;

-- 5) Esta RPC sólo informa capacidades del schema y no necesita elevar
-- privilegios. Mantenerla SECURITY INVOKER reduce superficie privilegiada.
do $$
begin
  if to_regprocedure('public.coi_contractual_capabilities_v1()') is not null then
    alter function public.coi_contractual_capabilities_v1() security invoker;
    revoke all on function public.coi_contractual_capabilities_v1() from public, anon;
    grant execute on function public.coi_contractual_capabilities_v1() to authenticated;
  end if;
end $$;

commit;
