-- COI Línea Roca · H11 online-only review hardening
-- Persistencia remota de auditoría frontend y acuses de revisión de alertas.
-- No modifica datos operativos existentes ni relaja RLS de tablas actuales.

begin;

create or replace function public.coi_registrar_auditoria_frontend(
  p_accion text,
  p_entidad text default 'general',
  p_registro_id text default null,
  p_nro_oc text default null,
  p_datos_anteriores jsonb default null,
  p_datos_nuevos jsonb default null,
  p_contexto jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'COI_AUTH_REQUIRED';
  end if;
  v_role := public.coi_current_role();
  if v_role is null then
    raise exception using errcode = '42501', message = 'COI_ROLE_REQUIRED';
  end if;
  if v_role is distinct from 'administrador' then
    raise exception using errcode = '42501', message = 'COI_ADMIN_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_accion, '')), '') is null then
    raise exception using errcode = '22023', message = 'COI_AUDIT_ACTION_REQUIRED';
  end if;
  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role, btrim(p_accion),
    coalesce(nullif(btrim(coalesce(p_entidad, '')), ''), 'general'),
    nullif(btrim(coalesce(p_registro_id, '')), ''),
    nullif(btrim(coalesce(p_nro_oc, '')), ''),
    p_datos_anteriores, p_datos_nuevos,
    coalesce(p_contexto, '{}'::jsonb) || jsonb_build_object('origen_writer', 'frontend_h11')
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.coi_registrar_auditoria_frontend(text,text,text,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.coi_registrar_auditoria_frontend(text,text,text,text,jsonb,jsonb,jsonb) to authenticated;

create table if not exists public.coi_alertas_revisadas (
  alerta_id text not null,
  revisada_por uuid not null references auth.users(id) on delete cascade,
  fecha_revision timestamptz not null default clock_timestamp(),
  primary key (revisada_por, alerta_id)
);
alter table public.coi_alertas_revisadas enable row level security;
revoke all on table public.coi_alertas_revisadas from public, anon, authenticated;
create index if not exists coi_alertas_revisadas_fecha_idx on public.coi_alertas_revisadas (fecha_revision desc);

create or replace function public.coi_marcar_alerta_revisada(p_alerta_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_alerta text;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'COI_AUTH_REQUIRED'; end if;
  v_role := public.coi_current_role();
  if v_role is null then raise exception using errcode = '42501', message = 'COI_ROLE_REQUIRED'; end if;
  if v_role is distinct from 'administrador' then raise exception using errcode = '42501', message = 'COI_ADMIN_REQUIRED'; end if;
  v_alerta := nullif(btrim(coalesce(p_alerta_id, '')), '');
  if v_alerta is null then raise exception using errcode = '22023', message = 'COI_ALERT_ID_REQUIRED'; end if;
  insert into public.coi_alertas_revisadas (alerta_id, revisada_por, fecha_revision)
  values (v_alerta, auth.uid(), clock_timestamp())
  on conflict (revisada_por, alerta_id) do update set fecha_revision = excluded.fecha_revision;
  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'REVISAR_ALERTA', 'coi_alertas_revisadas', v_alerta,
    jsonb_build_object('alerta_id', v_alerta, 'origen_writer', 'frontend_h11')
  );
  return true;
end;
$$;
revoke all on function public.coi_marcar_alerta_revisada(text) from public, anon;
grant execute on function public.coi_marcar_alerta_revisada(text) to authenticated;

create or replace function public.coi_listar_alertas_revisadas()
returns table (alerta_id text, fecha_revision timestamptz, revisada_por uuid)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'COI_AUTH_REQUIRED'; end if;
  v_role := public.coi_current_role();
  if v_role is null then raise exception using errcode = '42501', message = 'COI_ROLE_REQUIRED'; end if;
  if v_role is distinct from 'administrador' then raise exception using errcode = '42501', message = 'COI_ADMIN_REQUIRED'; end if;
  return query
    select r.alerta_id, r.fecha_revision, r.revisada_por
    from public.coi_alertas_revisadas r
    where r.revisada_por = auth.uid()
    order by r.fecha_revision desc;
end;
$$;
revoke all on function public.coi_listar_alertas_revisadas() from public, anon;
grant execute on function public.coi_listar_alertas_revisadas() to authenticated;

commit;
