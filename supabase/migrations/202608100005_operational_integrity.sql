-- COI Linea Roca - integridad operativa de ordenes, circuito y links.
-- Las operaciones que antes requerian varias llamadas HTTP se consolidan en
-- una unica transaccion PostgreSQL y se autorizan por rol del servidor.

begin;

create table if not exists public.coi_historial_oc (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references public.coi_ordenes(id) on delete restrict,
  nro_oc text not null,
  tipo_evento text not null,
  campo_modificado text,
  valor_anterior text,
  valor_nuevo text,
  motivo text,
  usuario_email text,
  creado_por uuid references auth.users(id) on delete set null,
  fecha_evento timestamptz not null default clock_timestamp()
);

alter table public.coi_historial_oc add column if not exists orden_id uuid;
alter table public.coi_historial_oc add column if not exists nro_oc text;
alter table public.coi_historial_oc add column if not exists tipo_evento text;
alter table public.coi_historial_oc add column if not exists campo_modificado text;
alter table public.coi_historial_oc add column if not exists valor_anterior text;
alter table public.coi_historial_oc add column if not exists valor_nuevo text;
alter table public.coi_historial_oc add column if not exists motivo text;
alter table public.coi_historial_oc add column if not exists usuario_email text;
alter table public.coi_historial_oc add column if not exists creado_por uuid;
alter table public.coi_historial_oc add column if not exists fecha_evento timestamptz default clock_timestamp();

create index if not exists coi_historial_oc_orden_fecha_idx
  on public.coi_historial_oc (orden_id, fecha_evento desc);
create index if not exists coi_historial_oc_nro_fecha_idx
  on public.coi_historial_oc (nro_oc, fecha_evento desc);

create or replace function public.coi_historial_enforce_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_nro_oc text;
begin
  if new.orden_id is not null then
    select o.id, o.nro_oc into v_order_id, v_nro_oc
      from public.coi_ordenes o where o.id = new.orden_id;
  elsif nullif(trim(coalesce(new.nro_oc, '')), '') is not null then
    select o.id, o.nro_oc into v_order_id, v_nro_oc
      from public.coi_ordenes o
     where upper(trim(o.nro_oc)) = upper(trim(new.nro_oc))
     limit 1;
  end if;
  if v_order_id is null then
    raise exception using errcode = '23503', message = 'COI_HISTORY_ORDER_NOT_FOUND';
  end if;
  new.orden_id := v_order_id;
  new.nro_oc := v_nro_oc;
  if auth.uid() is not null then
    new.creado_por := auth.uid();
    new.usuario_email := coalesce(nullif(auth.jwt() ->> 'email', ''), new.usuario_email);
  end if;
  new.fecha_evento := coalesce(new.fecha_evento, clock_timestamp());
  return new;
end;
$$;

drop trigger if exists coi_historial_enforce_order on public.coi_historial_oc;
create trigger coi_historial_enforce_order
before insert on public.coi_historial_oc
for each row execute function public.coi_historial_enforce_order();

create table if not exists public.coi_links_documentales (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.coi_ordenes(id) on delete restrict,
  nro_oc text not null,
  tipo_link text not null default 'Otro',
  titulo text not null,
  url text not null,
  estado text not null default 'Cargado',
  es_principal boolean not null default false,
  observaciones text,
  creado_por uuid references auth.users(id) on delete set null,
  actualizado_por uuid references auth.users(id) on delete set null,
  fecha_creacion timestamptz not null default clock_timestamp(),
  fecha_actualizacion timestamptz not null default clock_timestamp()
);

alter table public.coi_links_documentales add column if not exists orden_id uuid;
alter table public.coi_links_documentales add column if not exists nro_oc text;
alter table public.coi_links_documentales add column if not exists tipo_link text default 'Otro';
alter table public.coi_links_documentales add column if not exists titulo text;
alter table public.coi_links_documentales add column if not exists url text;
alter table public.coi_links_documentales add column if not exists estado text default 'Cargado';
alter table public.coi_links_documentales add column if not exists es_principal boolean default false;
alter table public.coi_links_documentales add column if not exists observaciones text;
alter table public.coi_links_documentales add column if not exists creado_por uuid;
alter table public.coi_links_documentales add column if not exists actualizado_por uuid;
alter table public.coi_links_documentales add column if not exists fecha_creacion timestamptz default clock_timestamp();
alter table public.coi_links_documentales add column if not exists fecha_actualizacion timestamptz default clock_timestamp();

create index if not exists coi_links_documentales_orden_idx
  on public.coi_links_documentales (orden_id, fecha_actualizacion desc);
create index if not exists coi_links_documentales_nro_idx
  on public.coi_links_documentales (nro_oc, fecha_actualizacion desc);

-- Si el preflight informo mas de un principal por OC, este indice aborta la
-- migracion sin modificar esos datos. No se elige ni se borra uno de oficio.
create unique index if not exists coi_links_documentales_principal_uq
  on public.coi_links_documentales (upper(trim(nro_oc)))
  where es_principal is true;

create or replace function public.coi_refresh_documental_state(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_principal jsonb;
  v_total bigint;
  v_url text;
  v_estado text;
  v_orden jsonb;
begin
  select count(*) into v_total
    from public.coi_links_documentales l
   where l.orden_id = p_order_id;

  select to_jsonb(l.*) into v_principal
    from public.coi_links_documentales l
   where l.orden_id = p_order_id
     and l.es_principal is true
   order by l.fecha_actualizacion desc, l.id::text
   limit 1;

  v_url := nullif(trim(coalesce(v_principal ->> 'url', '')), '');
  if v_total = 0 then
    v_estado := 'Sin link';
  elsif v_principal is null then
    v_estado := 'Incompleto';
  elsif upper(trim(coalesce(v_principal ->> 'estado', ''))) = 'VALIDADO' then
    v_estado := 'Validado';
  elsif upper(trim(coalesce(v_principal ->> 'tipo_link', ''))) = 'CARPETA ONEDRIVE' then
    v_estado := 'Cargado';
  else
    v_estado := 'Incompleto';
  end if;

  update public.coi_ordenes o
     set link_documental_principal = v_url,
         estado_link_documental = v_estado
   where o.id = p_order_id
  returning to_jsonb(o.*) into v_orden;

  if v_orden is null then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;
  return jsonb_build_object('orden', v_orden, 'estado', v_estado, 'url_principal', v_url);
end;
$$;

create or replace function public.coi_guardar_link_documental(
  p_orden_id uuid,
  p_link_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_orden public.coi_ordenes%rowtype;
  v_before public.coi_links_documentales%rowtype;
  v_after public.coi_links_documentales%rowtype;
  v_key text;
  v_principal boolean;
  v_documental jsonb;
  v_action text;
begin
  v_role := public.coi_assert_role(array['administrador', 'jefatura', 'editor']);
  if p_orden_id is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'COI_INVALID_LINK_PAYLOAD';
  end if;

  for v_key in select jsonb_object_keys(p_payload) loop
    if not (v_key = any(array['tipo_link', 'titulo', 'url', 'estado', 'es_principal', 'observaciones'])) then
      raise exception using errcode = '22023', message = 'COI_PROTECTED_OR_UNKNOWN_LINK_FIELD', detail = v_key;
    end if;
  end loop;

  select * into v_orden
    from public.coi_ordenes o
   where o.id = p_orden_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  if nullif(trim(coalesce(p_link_id, '')), '') is null then
    if nullif(trim(coalesce(p_payload ->> 'url', '')), '') is null
       or trim(p_payload ->> 'url') !~* '^https?://' then
      raise exception using errcode = '22023', message = 'COI_INVALID_LINK_URL';
    end if;
    if length(trim(coalesce(p_payload ->> 'url', ''))) > 2048 then
      raise exception using errcode = '22001', message = 'COI_LINK_URL_TOO_LONG';
    end if;
    v_principal := coalesce((p_payload ->> 'es_principal')::boolean, false);
    if v_principal then
      update public.coi_links_documentales
         set es_principal = false,
             actualizado_por = auth.uid(),
             fecha_actualizacion = clock_timestamp()
       where orden_id = p_orden_id
         and es_principal is true;
    end if;

    insert into public.coi_links_documentales (
      orden_id, nro_oc, tipo_link, titulo, url, estado, es_principal,
      observaciones, creado_por, actualizado_por
    ) values (
      p_orden_id, v_orden.nro_oc,
      coalesce(nullif(trim(p_payload ->> 'tipo_link'), ''), 'Otro'),
      coalesce(nullif(trim(p_payload ->> 'titulo'), ''), nullif(trim(p_payload ->> 'tipo_link'), ''), 'Documento'),
      trim(p_payload ->> 'url'),
      coalesce(nullif(trim(p_payload ->> 'estado'), ''), 'Cargado'),
      v_principal,
      nullif(trim(p_payload ->> 'observaciones'), ''),
      auth.uid(), auth.uid()
    ) returning * into v_after;
    v_action := 'AGREGAR_LINK_DOCUMENTAL';
  else
    select * into v_before
      from public.coi_links_documentales l
     where l.id::text = trim(p_link_id)
       and l.orden_id = p_orden_id
     for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'COI_LINK_NOT_FOUND';
    end if;

    if p_payload ? 'url' and (
      nullif(trim(coalesce(p_payload ->> 'url', '')), '') is null
      or trim(p_payload ->> 'url') !~* '^https?://'
      or length(trim(p_payload ->> 'url')) > 2048
    ) then
      raise exception using errcode = '22023', message = 'COI_INVALID_LINK_URL';
    end if;
    v_principal := case
      when p_payload ? 'es_principal' then (p_payload ->> 'es_principal')::boolean
      else coalesce(v_before.es_principal, false)
    end;
    if v_principal then
      update public.coi_links_documentales
         set es_principal = false,
             actualizado_por = auth.uid(),
             fecha_actualizacion = clock_timestamp()
       where orden_id = p_orden_id
         and id::text <> trim(p_link_id)
         and es_principal is true;
    end if;

    update public.coi_links_documentales l
       set tipo_link = case when p_payload ? 'tipo_link' then coalesce(nullif(trim(p_payload ->> 'tipo_link'), ''), 'Otro') else l.tipo_link end,
           titulo = case when p_payload ? 'titulo' then coalesce(nullif(trim(p_payload ->> 'titulo'), ''), 'Documento') else l.titulo end,
           url = case when p_payload ? 'url' then trim(p_payload ->> 'url') else l.url end,
           estado = case when p_payload ? 'estado' then coalesce(nullif(trim(p_payload ->> 'estado'), ''), 'Cargado') else l.estado end,
           es_principal = v_principal,
           observaciones = case when p_payload ? 'observaciones' then nullif(trim(p_payload ->> 'observaciones'), '') else l.observaciones end,
           actualizado_por = auth.uid(),
           fecha_actualizacion = clock_timestamp()
     where l.id::text = trim(p_link_id)
    returning * into v_after;
    v_action := 'ACTUALIZAR_LINK_DOCUMENTAL';
  end if;

  v_documental := public.coi_refresh_documental_state(p_orden_id);

  insert into public.coi_historial_oc (
    orden_id, nro_oc, tipo_evento, campo_modificado, valor_anterior,
    valor_nuevo, motivo, usuario_email, creado_por
  ) values (
    p_orden_id, v_orden.nro_oc, 'Cambio de link documental',
    case when v_after.es_principal then 'link_documental_principal' else 'link_documental' end,
    case when v_before.id is null then null else v_before.url end,
    v_after.url,
    case when v_before.id is null then 'Link agregado' else 'Link actualizado' end,
    nullif(auth.jwt() ->> 'email', ''), auth.uid()
  );

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role, v_action,
    'coi_links_documentales', v_after.id::text, v_orden.nro_oc,
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after), jsonb_build_object('documental', v_documental)
  );

  return jsonb_build_object('link', to_jsonb(v_after), 'documental', v_documental);
end;
$$;

create or replace function public.coi_eliminar_link_documental(p_link_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order_id uuid;
  v_orden public.coi_ordenes%rowtype;
  v_before public.coi_links_documentales%rowtype;
  v_documental jsonb;
begin
  v_role := public.coi_assert_role(array['administrador', 'jefatura', 'editor']);
  if nullif(trim(coalesce(p_link_id, '')), '') is null then
    raise exception using errcode = '22023', message = 'COI_INVALID_LINK_ID';
  end if;

  select l.orden_id into v_order_id
    from public.coi_links_documentales l
   where l.id::text = trim(p_link_id);
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_LINK_NOT_FOUND';
  end if;

  select * into v_orden
    from public.coi_ordenes o
   where o.id = v_order_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  select * into v_before
    from public.coi_links_documentales l
   where l.id::text = trim(p_link_id)
     and l.orden_id = v_order_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_LINK_NOT_FOUND';
  end if;

  delete from public.coi_links_documentales l where l.id::text = trim(p_link_id);
  v_documental := public.coi_refresh_documental_state(v_order_id);

  insert into public.coi_historial_oc (
    orden_id, nro_oc, tipo_evento, campo_modificado, valor_anterior,
    valor_nuevo, motivo, usuario_email, creado_por
  ) values (
    v_order_id, v_orden.nro_oc, 'Cambio de link documental',
    case when v_before.es_principal then 'link_documental_principal' else 'link_documental' end,
    v_before.url, null, 'Link eliminado',
    nullif(auth.jwt() ->> 'email', ''), auth.uid()
  );

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ELIMINAR_LINK_DOCUMENTAL', 'coi_links_documentales', v_before.id::text,
    v_orden.nro_oc, to_jsonb(v_before), jsonb_build_object('documental', v_documental)
  );

  return jsonb_build_object('eliminado', to_jsonb(v_before), 'documental', v_documental);
end;
$$;

create or replace function public.coi_confirmar_etapa_circuito(
  p_orden_id uuid,
  p_codigo text,
  p_observacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_orden public.coi_ordenes%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_codigo text := lower(trim(coalesce(p_codigo, '')));
  v_nombre text;
  v_anterior text;
  v_history jsonb := '[]'::jsonb;
  v_already boolean;
begin
  v_role := public.coi_assert_role(array[
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ]);
  if p_orden_id is null then
    raise exception using errcode = '22023', message = 'COI_INVALID_ORDER_ID';
  end if;
  if length(coalesce(p_observacion, '')) > 3000 then
    raise exception using errcode = '22001', message = 'COI_CIRCUIT_OBSERVATION_TOO_LONG';
  end if;

  v_nombre := case v_codigo
    when 'pliegos_preparacion' then 'PLIEGOS EN PREPARACIÓN'
    when 'pliegos_terminado_sin_solped' then 'PLIEGOS TERMINADO SIN SOLPED'
    when 'solped_sin_expediente' then 'PLIEGO CON SOLPED SIN EXPTE'
    when 'pliego_con_oc' then 'PLIEGO CON OC'
    when 'pliego_con_expediente' then 'PLIEGO CON EXPTE'
    when 'oc_sin_control_terceros' then 'PLIEGO CON EXPTE Y CON OC EMITIDA, PERO SIN CONTROL DE 3'
    when 'control_terceros_sin_acta' then 'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO'
    when 'control_terceros_con_acta' then 'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO'
    when 'ejecucion' then 'OBRA/SERVICIO EN EJECUCIÓN'
    when 'cancelada_suspendida' then 'OBRA/SERVICIO CANCELADA O SUSPENDIDA'
    when 'finalizada' then 'OBRA/SERVICIO FINALIZADA'
    when 'finalizada_actas' then 'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA'
    when 'finalizada_saldo_remanente' then 'OBRA/SERVICIO FINALIZADA PERO CON SALDO REMANENTE'
    else null
  end;
  if v_nombre is null then
    raise exception using errcode = '22023', message = 'COI_UNKNOWN_CIRCUIT_STAGE', detail = v_codigo;
  end if;

  select * into v_orden
    from public.coi_ordenes o
   where o.id = p_orden_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;
  v_before := to_jsonb(v_orden);
  v_anterior := coalesce(v_orden.estado_documental, v_orden.estado_coi);

  select exists (
    select 1
      from public.coi_historial_oc h
     where h.orden_id = p_orden_id
       and h.tipo_evento = 'Circuito administrativo'
       and (
         h.campo_modificado = v_codigo
         or (v_codigo = 'finalizada_saldo_remanente' and h.campo_modificado = 'enviada_pyc')
       )
  ) into v_already;

  update public.coi_ordenes o
     set estado_documental = v_nombre,
         estado_coi = v_nombre,
         fecha_ultimo_control = clock_timestamp(),
         responsable_coi = coalesce(nullif(o.responsable_coi, ''), nullif(auth.jwt() ->> 'email', '')),
         certificable_con_saldo = case
           when v_codigo = 'finalizada_saldo_remanente' then true
           else o.certificable_con_saldo
         end
   where o.id = p_orden_id
  returning to_jsonb(o.*) into v_after;

  if not v_already then
    with inserted as (
      insert into public.coi_historial_oc (
        orden_id, nro_oc, tipo_evento, campo_modificado, valor_anterior,
        valor_nuevo, motivo, usuario_email, creado_por
      ) values
      (
        p_orden_id, v_orden.nro_oc, 'Circuito administrativo', v_codigo,
        v_anterior, v_nombre, nullif(trim(coalesce(p_observacion, '')), ''),
        nullif(auth.jwt() ->> 'email', ''), auth.uid()
      ),
      (
        p_orden_id, v_orden.nro_oc, 'Cambio de estado contractual', 'estado_documental',
        v_anterior, v_nombre, 'Selección de etapa contractual: ' || v_nombre,
        nullif(auth.jwt() ->> 'email', ''), auth.uid()
      )
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted.*)), '[]'::jsonb)
      into v_history
      from inserted;
  end if;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'CONFIRMAR_ETAPA_CIRCUITO', 'coi_ordenes', p_orden_id::text,
    v_orden.nro_oc, v_before, v_after,
    jsonb_build_object('codigo', v_codigo, 'ya_confirmada', v_already)
  );

  return jsonb_build_object(
    'orden', v_after,
    'historial', v_history,
    'codigo', v_codigo,
    'nombre', v_nombre,
    'ya_confirmada', v_already
  );
end;
$$;

create or replace function public.coi_count_order_dependencies(
  p_table_name text,
  p_order_id uuid,
  p_nro_oc text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_order_id boolean;
  v_has_nro_oc boolean;
  v_sql text;
  v_count bigint := 0;
begin
  if p_table_name !~ '^coi_[a-z0-9_]+$'
     or to_regclass('public.' || p_table_name) is null then
    return 0;
  end if;
  select
    bool_or(column_name = 'orden_id'),
    bool_or(column_name = 'nro_oc')
    into v_has_order_id, v_has_nro_oc
    from information_schema.columns
   where table_schema = 'public'
     and table_name = p_table_name
     and column_name in ('orden_id', 'nro_oc');
  if not coalesce(v_has_order_id, false) and not coalesce(v_has_nro_oc, false) then
    return 0;
  end if;

  v_sql := format('select count(*) from public.%I where ', p_table_name);
  if coalesce(v_has_order_id, false) then
    v_sql := v_sql || 'orden_id::text = $1';
  end if;
  if coalesce(v_has_order_id, false) and coalesce(v_has_nro_oc, false) then
    v_sql := v_sql || ' or ';
  end if;
  if coalesce(v_has_nro_oc, false) then
    v_sql := v_sql || 'upper(trim(nro_oc::text)) = upper(trim($2))';
  end if;
  execute v_sql using p_order_id::text, p_nro_oc into v_count;
  return coalesce(v_count, 0);
end;
$$;

create or replace function public.coi_eliminar_orden_integral(p_orden_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_before public.coi_ordenes%rowtype;
  v_dependencies jsonb := '{}'::jsonb;
  v_table text;
  v_count bigint;
  v_station_count bigint;
begin
  v_role := public.coi_assert_role(array['administrador']);
  if p_orden_id is null then
    raise exception using errcode = '22023', message = 'COI_INVALID_ORDER_ID';
  end if;

  select * into v_before
    from public.coi_ordenes o
   where o.id = p_orden_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  foreach v_table in array array[
    'coi_posiciones_oc', 'coi_consumos_posicion', 'coi_certificaciones',
    'coi_documentos_oc', 'coi_historial_oc', 'coi_links_documentales',
    'coi_auditorias_calidad', 'coi_timeline_events', 'coi_documentos_versiones'
  ] loop
    v_count := public.coi_count_order_dependencies(v_table, p_orden_id, v_before.nro_oc);
    if v_count > 0 then
      v_dependencies := v_dependencies || jsonb_build_object(v_table, v_count);
    end if;
  end loop;
  if v_dependencies <> '{}'::jsonb then
    raise exception using
      errcode = '23503',
      message = 'COI_ORDER_HAS_DEPENDENCIES',
      detail = v_dependencies::text,
      hint = 'Conserve la OC para trazabilidad o elimine primero solo dependencias expresamente anulables.';
  end if;

  delete from public.coi_ordenes_estaciones oe
   where oe.orden_id = p_orden_id;
  get diagnostics v_station_count = row_count;

  delete from public.coi_ordenes o where o.id = p_orden_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND_DURING_DELETE';
  end if;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ELIMINAR_ORDEN_INTEGRAL', 'coi_ordenes', p_orden_id::text,
    v_before.nro_oc, to_jsonb(v_before),
    jsonb_build_object('estaciones_eliminadas', v_station_count)
  );

  return jsonb_build_object(
    'deleted', to_jsonb(v_before),
    'estaciones_eliminadas', v_station_count
  );
end;
$$;

-- Politicas de las dos tablas incorporadas por esta migracion. Las guardas
-- restrictivas prevalecen aun si quedara una politica permisiva historica.
alter table public.coi_historial_oc enable row level security;
alter table public.coi_links_documentales enable row level security;

drop policy if exists coi_historial_select_v2 on public.coi_historial_oc;
create policy coi_historial_select_v2 on public.coi_historial_oc
for select to authenticated using (public.coi_current_role() is not null);
drop policy if exists coi_historial_insert_v2 on public.coi_historial_oc;
create policy coi_historial_insert_v2 on public.coi_historial_oc
for insert to authenticated with check (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor')
  and (creado_por is null or creado_por = auth.uid())
  and lower(trim(tipo_evento)) not in (
    'circuito administrativo', 'cambio de estado contractual', 'cambio de link documental'
  )
);
drop policy if exists coi_historial_select_guard_v2 on public.coi_historial_oc;
create policy coi_historial_select_guard_v2 on public.coi_historial_oc as restrictive
for select to authenticated using (public.coi_current_role() is not null);
drop policy if exists coi_historial_insert_guard_v2 on public.coi_historial_oc;
create policy coi_historial_insert_guard_v2 on public.coi_historial_oc as restrictive
for insert to authenticated with check (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor')
  and (creado_por is null or creado_por = auth.uid())
  and lower(trim(tipo_evento)) not in (
    'circuito administrativo', 'cambio de estado contractual', 'cambio de link documental'
  )
);
drop policy if exists coi_historial_update_guard_v2 on public.coi_historial_oc;
create policy coi_historial_update_guard_v2 on public.coi_historial_oc as restrictive
for update to authenticated using (false) with check (false);
drop policy if exists coi_historial_delete_guard_v2 on public.coi_historial_oc;
create policy coi_historial_delete_guard_v2 on public.coi_historial_oc as restrictive
for delete to authenticated using (false);

drop policy if exists coi_links_select_v2 on public.coi_links_documentales;
create policy coi_links_select_v2 on public.coi_links_documentales
for select to authenticated using (public.coi_current_role() is not null);
drop policy if exists coi_links_select_guard_v2 on public.coi_links_documentales;
create policy coi_links_select_guard_v2 on public.coi_links_documentales as restrictive
for select to authenticated using (public.coi_current_role() is not null);
drop policy if exists coi_links_insert_guard_v2 on public.coi_links_documentales;
create policy coi_links_insert_guard_v2 on public.coi_links_documentales as restrictive
for insert to authenticated with check (false);
drop policy if exists coi_links_update_guard_v2 on public.coi_links_documentales;
create policy coi_links_update_guard_v2 on public.coi_links_documentales as restrictive
for update to authenticated using (false) with check (false);
drop policy if exists coi_links_delete_guard_v2 on public.coi_links_documentales;
create policy coi_links_delete_guard_v2 on public.coi_links_documentales as restrictive
for delete to authenticated using (false);

revoke all on public.coi_historial_oc from anon;
revoke all on public.coi_links_documentales from anon;
revoke all on public.coi_historial_oc from authenticated;
revoke all on public.coi_links_documentales from authenticated;
grant select, insert on public.coi_historial_oc to authenticated;
grant select on public.coi_links_documentales to authenticated;

-- Endurecimiento de tablas legacy cuando ya existen en la instalacion. No se
-- inventan esquemas opcionales: se aplican RLS y privilegios solo a las tablas
-- detectadas, preservando sus columnas y datos actuales.
create or replace function public.coi_apply_optional_role_rls(
  p_table_name text,
  p_read_roles text[],
  p_insert_roles text[],
  p_update_roles text[],
  p_delete_roles text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table regclass;
  v_policy text;
  v_expression text;
begin
  if p_table_name !~ '^coi_[a-z0-9_]+$' then
    raise exception using errcode = '22023', message = 'COI_INVALID_TABLE_NAME';
  end if;
  v_table := to_regclass('public.' || p_table_name);
  if v_table is null then return; end if;

  execute format('alter table %s enable row level security', v_table);
  execute format('revoke all on %s from anon, authenticated', v_table);
  execute format('grant select on %s to authenticated', v_table);

  foreach v_policy in array array['select', 'insert', 'update', 'delete'] loop
    execute format('drop policy if exists %I on %s', 'coi_optional_' || v_policy || '_v2', v_table);
    execute format('drop policy if exists %I on %s', 'coi_optional_' || v_policy || '_guard_v2', v_table);
  end loop;

  v_expression := case when cardinality(p_read_roles) = 0 then 'false'
    else format('public.coi_current_role() = any (%L::text[])', p_read_roles) end;
  execute format('create policy coi_optional_select_v2 on %s for select to authenticated using (%s)', v_table, v_expression);
  execute format('create policy coi_optional_select_guard_v2 on %s as restrictive for select to authenticated using (%s)', v_table, v_expression);

  v_expression := case when cardinality(p_insert_roles) = 0 then 'false'
    else format('public.coi_current_role() = any (%L::text[])', p_insert_roles) end;
  execute format('create policy coi_optional_insert_v2 on %s for insert to authenticated with check (%s)', v_table, v_expression);
  execute format('create policy coi_optional_insert_guard_v2 on %s as restrictive for insert to authenticated with check (%s)', v_table, v_expression);
  if cardinality(p_insert_roles) > 0 then execute format('grant insert on %s to authenticated', v_table); end if;

  v_expression := case when cardinality(p_update_roles) = 0 then 'false'
    else format('public.coi_current_role() = any (%L::text[])', p_update_roles) end;
  execute format('create policy coi_optional_update_v2 on %s for update to authenticated using (%s) with check (%s)', v_table, v_expression, v_expression);
  execute format('create policy coi_optional_update_guard_v2 on %s as restrictive for update to authenticated using (%s) with check (%s)', v_table, v_expression, v_expression);
  if cardinality(p_update_roles) > 0 then execute format('grant update on %s to authenticated', v_table); end if;

  v_expression := case when cardinality(p_delete_roles) = 0 then 'false'
    else format('public.coi_current_role() = any (%L::text[])', p_delete_roles) end;
  execute format('create policy coi_optional_delete_v2 on %s for delete to authenticated using (%s)', v_table, v_expression);
  execute format('create policy coi_optional_delete_guard_v2 on %s as restrictive for delete to authenticated using (%s)', v_table, v_expression);
  if cardinality(p_delete_roles) > 0 then execute format('grant delete on %s to authenticated', v_table); end if;
end;
$$;

select public.coi_apply_optional_role_rls(
  'coi_certificaciones',
  array['administrador','jefatura','editor','planificacion','control','supervisor','inspector','consulta','invitado','contratista'],
  array['administrador','jefatura','editor','control'],
  array['administrador','jefatura','editor','control'],
  array[]::text[]
);
select public.coi_apply_optional_role_rls(
  'coi_documentos_oc',
  array['administrador','jefatura','editor','planificacion','control','supervisor','inspector','consulta','invitado','contratista'],
  array['administrador','jefatura','editor','control','inspector','contratista'],
  array['administrador','jefatura','editor','control','inspector'],
  array['administrador','jefatura']
);
select public.coi_apply_optional_role_rls(
  'coi_timeline_events',
  array['administrador','jefatura','editor','planificacion','control','supervisor','inspector','consulta','invitado','contratista'],
  array['administrador','jefatura','editor','planificacion','control','supervisor'],
  array['administrador','jefatura','editor','planificacion','control','supervisor'],
  array['administrador','jefatura']
);
select public.coi_apply_optional_role_rls(
  'coi_auditorias_calidad',
  array['administrador','jefatura'], array['administrador','jefatura'],
  array[]::text[], array[]::text[]
);
select public.coi_apply_optional_role_rls(
  'coi_auditoria_global',
  array['administrador','jefatura'],
  array['administrador','jefatura','editor','planificacion','control','supervisor','inspector','consulta','invitado','contratista'],
  array[]::text[], array[]::text[]
);
select public.coi_apply_optional_role_rls(
  'coi_documentos_versiones',
  array['administrador','jefatura','editor','planificacion','control','supervisor','inspector','consulta','contratista'],
  array['administrador','jefatura','editor','control','inspector','contratista'],
  array['administrador','jefatura','control'],
  array['administrador','jefatura']
);
select public.coi_apply_optional_role_rls(
  'coi_security_health_checks',
  array['administrador','jefatura'], array['administrador','jefatura'],
  array[]::text[], array[]::text[]
);

drop function public.coi_apply_optional_role_rls(text, text[], text[], text[], text[]);

-- Sesiones requiere aislamiento por propietario, no una matriz global por rol.
do $$
declare
  v_table regclass := to_regclass('public.coi_sesiones');
  v_has_owner boolean;
begin
  if v_table is null then return; end if;
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'coi_sesiones' and column_name = 'usuario_id'
  ) into v_has_owner;
  if not v_has_owner then
    raise exception using errcode = '42703', message = 'COI_SESSIONS_SCHEMA_MISMATCH';
  end if;
  execute format('alter table %s enable row level security', v_table);
  execute format('revoke all on %s from anon, authenticated', v_table);
  execute format('grant select, insert, update on %s to authenticated', v_table);
  execute format('drop policy if exists coi_sessions_select_v2 on %s', v_table);
  execute format('drop policy if exists coi_sessions_insert_v2 on %s', v_table);
  execute format('drop policy if exists coi_sessions_update_v2 on %s', v_table);
  execute format('drop policy if exists coi_sessions_select_guard_v2 on %s', v_table);
  execute format('drop policy if exists coi_sessions_insert_guard_v2 on %s', v_table);
  execute format('drop policy if exists coi_sessions_update_guard_v2 on %s', v_table);
  execute format('drop policy if exists coi_sessions_delete_guard_v2 on %s', v_table);
  execute format('create policy coi_sessions_select_v2 on %s for select to authenticated using (usuario_id = auth.uid() or public.coi_current_role() in (''administrador'',''jefatura''))', v_table);
  execute format('create policy coi_sessions_insert_v2 on %s for insert to authenticated with check (usuario_id = auth.uid())', v_table);
  execute format('create policy coi_sessions_update_v2 on %s for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())', v_table);
  execute format('create policy coi_sessions_select_guard_v2 on %s as restrictive for select to authenticated using (usuario_id = auth.uid() or public.coi_current_role() in (''administrador'',''jefatura''))', v_table);
  execute format('create policy coi_sessions_insert_guard_v2 on %s as restrictive for insert to authenticated with check (usuario_id = auth.uid())', v_table);
  execute format('create policy coi_sessions_update_guard_v2 on %s as restrictive for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid())', v_table);
  execute format('create policy coi_sessions_delete_guard_v2 on %s as restrictive for delete to authenticated using (false)', v_table);
end;
$$;

revoke all on function public.coi_refresh_documental_state(uuid) from public, anon, authenticated;
revoke all on function public.coi_count_order_dependencies(text, uuid, text) from public, anon, authenticated;
revoke all on function public.coi_historial_enforce_order() from public, anon, authenticated;
revoke all on function public.coi_guardar_link_documental(uuid, text, jsonb) from public, anon;
revoke all on function public.coi_eliminar_link_documental(text) from public, anon;
revoke all on function public.coi_confirmar_etapa_circuito(uuid, text, text) from public, anon;
revoke all on function public.coi_eliminar_orden_integral(uuid) from public, anon;
grant execute on function public.coi_guardar_link_documental(uuid, text, jsonb) to authenticated;
grant execute on function public.coi_eliminar_link_documental(text) to authenticated;
grant execute on function public.coi_confirmar_etapa_circuito(uuid, text, text) to authenticated;
grant execute on function public.coi_eliminar_orden_integral(uuid) to authenticated;

comment on function public.coi_confirmar_etapa_circuito(uuid, text, text) is
  'Actualiza la etapa contractual y agrega su historial en un unico commit idempotente por OC y etapa.';
comment on function public.coi_eliminar_orden_integral(uuid) is
  'Elimina una OC libre de dependencias y sus estaciones asociadas en una unica transaccion administrativa.';

commit;
