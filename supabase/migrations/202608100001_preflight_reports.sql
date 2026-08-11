-- COI Linea Roca - preflight no destructivo para el contrato transaccional.
-- Esta migracion no modifica datos operativos. Expone un diagnostico agregado
-- para que los duplicados se resuelvan manualmente antes de crear indices unicos.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nombre text,
  apellido text,
  rol text not null default 'consulta',
  activo boolean not null default true,
  fecha_alta timestamptz not null default now(),
  ultimo_login timestamptz,
  observaciones text
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists nombre text;
alter table public.profiles add column if not exists apellido text;
alter table public.profiles add column if not exists rol text not null default 'consulta';
alter table public.profiles add column if not exists activo boolean not null default true;
alter table public.profiles add column if not exists fecha_alta timestamptz not null default now();
alter table public.profiles add column if not exists ultimo_login timestamptz;
alter table public.profiles add column if not exists observaciones text;

create or replace function public.coi_preflight_integridad()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_links_principales_duplicados bigint := null;
  v_resultado jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'COI_AUTH_REQUIRED';
  end if;

  select lower(trim(coalesce(p.rol, '')))
    into v_rol
    from public.profiles p
   where p.id = v_uid
     and coalesce(p.activo, false)
   limit 1;

  if coalesce(v_rol, '') not in ('administrador', 'jefatura') then
    raise exception using errcode = '42501', message = 'COI_ROLE_REQUIRED: administrador o jefatura';
  end if;

  -- La tabla de links pertenece a un modulo opcional en instalaciones
  -- historicas. El diagnostico la inspecciona sin volverla un requisito para
  -- ejecutar este preflight inicial.
  if to_regclass('public.coi_links_documentales') is not null then
    execute $sql$
      select count(*)
        from (
          select upper(trim(nro_oc))
            from public.coi_links_documentales
           where es_principal is true
           group by upper(trim(nro_oc))
          having count(*) > 1
        ) duplicados
    $sql$ into v_links_principales_duplicados;
  end if;

  select jsonb_build_object(
    'fecha', clock_timestamp(),
    'ordenes_nro_oc_duplicado', (
      select count(*)
        from (
          select upper(trim(nro_oc))
            from public.coi_ordenes
           where nullif(trim(nro_oc), '') is not null
           group by upper(trim(nro_oc))
          having count(*) > 1
        ) duplicados
    ),
    'posiciones_duplicadas', (
      select count(*)
        from (
          select orden_id, upper(trim(replace(posicion, ',', '.')))
            from public.coi_posiciones_oc
           group by orden_id, upper(trim(replace(posicion, ',', '.')))
          having count(*) > 1
        ) duplicados
    ),
    'ordenes_con_multiples_estaciones_principales', (
      select count(*)
        from (
          select orden_id
            from public.coi_ordenes_estaciones
           where es_principal is true
           group by orden_id
          having count(*) > 1
        ) duplicados
    ),
    'ordenes_sin_estacion_principal', (
      select count(*)
        from public.coi_ordenes o
       where not exists (
         select 1
           from public.coi_ordenes_estaciones oe
          where oe.orden_id = o.id
            and oe.es_principal is true
       )
    ),
    'links_principales_duplicados', v_links_principales_duplicados,
    'perfiles_inactivos', (
      select count(*) from public.profiles where coalesce(activo, false) is false
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.coi_preflight_integridad() from public, anon;
grant execute on function public.coi_preflight_integridad() to authenticated;

comment on function public.coi_preflight_integridad() is
  'Diagnostico agregado y no destructivo previo a las restricciones de integridad COI.';

commit;
