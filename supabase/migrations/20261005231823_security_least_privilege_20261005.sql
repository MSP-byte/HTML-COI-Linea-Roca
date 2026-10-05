-- COI Línea Roca · Security hardening · mínimo privilegio
-- Fecha: 2026-10-05
-- Alcance: privilegios de roles cliente, objetos RPC-only y RPC de capabilities.
-- No modifica datos operativos ni reglas funcionales.

begin;

-- El rol authenticated no necesita privilegios estructurales. TRUNCATE no
-- está sujeto a RLS y debe quedar fuera del rol de aplicación.
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

-- Anon no debe tener acceso directo a datos COI/profiles.
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

-- Backups históricos: sólo administración directa de base.
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

-- Objetos deliberadamente RPC-only: defensa en profundidad.
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

-- RPC de capabilities: sólo lectura, sin elevación de privilegios.
do $$
begin
  if to_regprocedure('public.coi_contractual_capabilities_v1()') is not null then
    alter function public.coi_contractual_capabilities_v1() security invoker;
    revoke all on function public.coi_contractual_capabilities_v1() from public, anon;
    grant execute on function public.coi_contractual_capabilities_v1() to authenticated;
  end if;
end $$;

commit;
