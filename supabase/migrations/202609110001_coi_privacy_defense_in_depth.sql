-- COI Línea Roca · Privacy hardening / defense in depth
-- Objetivo: mantener Supabase como fuente privada, accesible sólo por usuarios Auth
-- con perfil COI activo y por las RPC explícitamente autorizadas.
-- No modifica datos operativos.

begin;

-- El rol anon no necesita privilegios directos sobre tablas COI ni profiles.
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p','v','m','f')
      and (left(c.relname,4) = 'coi_' or c.relname = 'profiles')
  loop
    execute format('revoke all privileges on table %I.%I from anon', r.nspname, r.relname);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
      and left(c.relname,4) = 'coi_'
  loop
    execute format('revoke all privileges on sequence %I.%I from anon', r.nspname, r.relname);
  end loop;
end $$;

-- Backups históricos: sólo administración directa, nunca clientes Auth/anon.
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and left(c.relname,24) = 'coi_documentos_oc_backup_'
  loop
    execute format('revoke all privileges on table %I.%I from authenticated', r.nspname, r.relname);
  end loop;
end $$;

-- Guardas restrictivas sobre tablas legacy con políticas permisivas amplias.
drop policy if exists coi_alertas_select_guard_privacy on public.coi_alertas;
create policy coi_alertas_select_guard_privacy
on public.coi_alertas as restrictive for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_alertas_insert_guard_privacy on public.coi_alertas;
create policy coi_alertas_insert_guard_privacy
on public.coi_alertas as restrictive for insert to authenticated
with check (public.coi_current_role() = any (array['administrador','jefatura','editor','planificacion','control','supervisor']::text[]));

drop policy if exists coi_alertas_update_guard_privacy on public.coi_alertas;
create policy coi_alertas_update_guard_privacy
on public.coi_alertas as restrictive for update to authenticated
using (public.coi_current_role() = any (array['administrador','jefatura','editor','planificacion','control','supervisor']::text[]))
with check (public.coi_current_role() = any (array['administrador','jefatura','editor','planificacion','control','supervisor']::text[]));

drop policy if exists coi_observaciones_select_guard_privacy on public.coi_observaciones_oc;
create policy coi_observaciones_select_guard_privacy
on public.coi_observaciones_oc as restrictive for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_observaciones_insert_guard_privacy on public.coi_observaciones_oc;
create policy coi_observaciones_insert_guard_privacy
on public.coi_observaciones_oc as restrictive for insert to authenticated
with check (public.coi_current_role() = any (array['administrador','jefatura','editor','planificacion','control','supervisor','inspector']::text[]));

drop policy if exists coi_observaciones_update_guard_privacy on public.coi_observaciones_oc;
create policy coi_observaciones_update_guard_privacy
on public.coi_observaciones_oc as restrictive for update to authenticated
using (public.coi_current_role() = any (array['administrador','jefatura','editor','planificacion','control','supervisor','inspector']::text[]))
with check (public.coi_current_role() = any (array['administrador','jefatura','editor','planificacion','control','supervisor','inspector']::text[]));

-- Reconciliación del contrato H11 final.
alter table public.coi_alertas_revisadas drop constraint if exists coi_alertas_revisadas_pkey;
alter table public.coi_alertas_revisadas add primary key (revisada_por, alerta_id);
alter table public.coi_alertas_revisadas enable row level security;
revoke all on table public.coi_alertas_revisadas from public, anon, authenticated;

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
declare v_id bigint; v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='COI_AUTH_REQUIRED'; end if;
  v_role := public.coi_current_role();
  if v_role is distinct from 'administrador' then raise exception using errcode='42501',message='COI_ADMIN_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_accion,'')),'') is null then raise exception using errcode='22023',message='COI_AUDIT_ACTION_REQUIRED'; end if;
  insert into public.coi_operaciones_auditoria(
    usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
    datos_anteriores,datos_nuevos,contexto
  ) values(
    auth.uid(),nullif(auth.jwt()->>'email',''),v_role,btrim(p_accion),
    coalesce(nullif(btrim(coalesce(p_entidad,'')),''),'general'),
    nullif(btrim(coalesce(p_registro_id,'')),''),
    nullif(btrim(coalesce(p_nro_oc,'')),''),
    p_datos_anteriores,p_datos_nuevos,
    coalesce(p_contexto,'{}'::jsonb)||jsonb_build_object('origen_writer','frontend_h11')
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.coi_registrar_auditoria_frontend(text,text,text,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.coi_registrar_auditoria_frontend(text,text,text,text,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.coi_marcar_alerta_revisada(p_alerta_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_role text; v_alerta text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='COI_AUTH_REQUIRED'; end if;
  v_role := public.coi_current_role();
  if v_role is distinct from 'administrador' then raise exception using errcode='42501',message='COI_ADMIN_REQUIRED'; end if;
  v_alerta := nullif(btrim(coalesce(p_alerta_id,'')),'');
  if v_alerta is null then raise exception using errcode='22023',message='COI_ALERT_ID_REQUIRED'; end if;
  insert into public.coi_alertas_revisadas(alerta_id,revisada_por,fecha_revision)
  values(v_alerta,auth.uid(),clock_timestamp())
  on conflict (revisada_por,alerta_id) do update set fecha_revision=excluded.fecha_revision;
  insert into public.coi_operaciones_auditoria(usuario_id,usuario_email,rol,accion,entidad,registro_id,contexto)
  values(auth.uid(),nullif(auth.jwt()->>'email',''),v_role,'REVISAR_ALERTA','coi_alertas_revisadas',v_alerta,
         jsonb_build_object('alerta_id',v_alerta,'origen_writer','frontend_h11'));
  return true;
end;
$$;
revoke all on function public.coi_marcar_alerta_revisada(text) from public, anon;
grant execute on function public.coi_marcar_alerta_revisada(text) to authenticated;

create or replace function public.coi_listar_alertas_revisadas()
returns table(alerta_id text, fecha_revision timestamptz, revisada_por uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='COI_AUTH_REQUIRED'; end if;
  v_role := public.coi_current_role();
  if v_role is distinct from 'administrador' then raise exception using errcode='42501',message='COI_ADMIN_REQUIRED'; end if;
  return query
    select r.alerta_id,r.fecha_revision,r.revisada_por
    from public.coi_alertas_revisadas r
    where r.revisada_por=auth.uid()
    order by r.fecha_revision desc;
end;
$$;
revoke all on function public.coi_listar_alertas_revisadas() from public, anon;
grant execute on function public.coi_listar_alertas_revisadas() to authenticated;

-- Helpers internos no necesitan superficie RPC directa.
do $$
begin
  if to_regprocedure('public.coi_assert_role(text[])') is not null then
    revoke all on function public.coi_assert_role(text[]) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.coi_record_direct_order_update(jsonb,jsonb)') is not null then
    revoke all on function public.coi_record_direct_order_update(jsonb,jsonb) from public, anon, authenticated;
  end if;
end $$;

commit;
