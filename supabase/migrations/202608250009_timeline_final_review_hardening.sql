-- COI Linea Roca - cierre final de concurrencia, paginacion y locks del Timeline.
-- Esta migracion redefine las RPC finales sin modificar datos existentes.

begin;

-- 1) El helper privilegiado debe aplicar por si mismo el mismo limite del RPC
-- publico. Asi una llamada directa no puede usarlo para bloquear lotes enormes.
create or replace function coi_private.coi_timeline_lock_orders(p_events jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.coi_assert_role(array[
    'administrador','jefatura','editor','planificacion','control','supervisor'
  ]);

  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception using errcode='22023', message='COI_TIMELINE_EVENTS_ARRAY_REQUIRED';
  end if;
  if jsonb_array_length(p_events) > 5000 then
    raise exception using errcode='54000', message='COI_TIMELINE_BATCH_LIMIT_5000';
  end if;

  perform orders.id
    from public.coi_ordenes orders
   where orders.id in (
     select nullif(source.value ->> 'orden_id', '')::uuid
       from jsonb_array_elements(p_events) source
      where nullif(source.value ->> 'orden_id', '') is not null
   )
      or nullif(upper(regexp_replace(regexp_replace(
           trim(orders.nro_oc),
           '^(O(RDEN)?[[:space:]]*(DE[[:space:]]*)?C(OMPRA)?|OC)[[:space:]]*[:#-]?[[:space:]]*',
           '', 'i'
         ), '[^A-Z0-9]', '', 'g')), '') in (
        select nullif(upper(regexp_replace(regexp_replace(
                 trim(source.value ->> 'nro_oc'),
                 '^(O(RDEN)?[[:space:]]*(DE[[:space:]]*)?C(OMPRA)?|OC)[[:space:]]*[:#-]?[[:space:]]*',
                 '', 'i'
               ), '[^A-Z0-9]', '', 'g')), '')
          from jsonb_array_elements(p_events) source
         where nullif(source.value ->> 'orden_id', '') is null
      )
   order by orders.id
   for key share of orders;
end;
$$;

revoke all on function coi_private.coi_timeline_lock_orders(jsonb)
  from public, anon;
grant execute on function coi_private.coi_timeline_lock_orders(jsonb)
  to authenticated;

create or replace function public.coi_timeline_lock_orders(p_events jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception using errcode='22023', message='COI_TIMELINE_EVENTS_ARRAY_REQUIRED';
  end if;
  if jsonb_array_length(p_events) > 5000 then
    raise exception using errcode='54000', message='COI_TIMELINE_BATCH_LIMIT_5000';
  end if;
  perform coi_private.coi_timeline_lock_orders(p_events);
end;
$$;

revoke all on function public.coi_timeline_lock_orders(jsonb)
  from public, anon;
grant execute on function public.coi_timeline_lock_orders(jsonb)
  to authenticated;

-- 2) La paginacion usa una clave inmutable. fecha/hora siguen siendo parametros
-- por compatibilidad con el frontend, pero ya no participan del cursor.
create index if not exists coi_timeline_id_desc_idx
  on public.coi_timeline_events(id desc);

create or replace function public.coi_timeline_list_page(
  p_before_fecha date default null,
  p_before_hora time without time zone default null,
  p_before_id text default null,
  p_limit integer default 1000
)
returns setof public.coi_timeline_events
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select event.*
    from public.coi_timeline_events event
   where p_before_id is null
      or event.id < p_before_id
   order by event.id desc
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$$;

revoke all on function public.coi_timeline_list_page(date,time without time zone,text,integer)
  from public, anon;
grant execute on function public.coi_timeline_list_page(date,time without time zone,text,integer)
  to authenticated;

comment on function public.coi_timeline_list_page(date,time without time zone,text,integer) is
  'Lectura paginada por ID inmutable; fecha/hora quedan solo por compatibilidad de firma.';

-- 3) Un update versionado cuyo ID ya fue borrado debe fallar en vez de
-- recrear silenciosamente el registro como un INSERT nuevo.
create or replace function public.coi_timeline_upsert_events(p_events jsonb)
returns setof public.coi_timeline_events
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_conflict_id text;
begin
  perform public.coi_assert_role(array[
    'administrador','jefatura','editor','planificacion','control','supervisor'
  ]);

  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception using errcode='22023', message='COI_TIMELINE_EVENTS_ARRAY_REQUIRED';
  end if;
  if jsonb_array_length(p_events) > 5000 then
    raise exception using errcode='54000', message='COI_TIMELINE_BATCH_LIMIT_5000';
  end if;

  -- Orden global de locks: primero OC, luego Timeline.
  perform public.coi_timeline_lock_orders(p_events);

  perform target.id
    from public.coi_timeline_events target
    join jsonb_array_elements(p_events) source
      on target.id = source.value ->> 'id'
   order by target.id
   for update of target;

  -- Si el cliente trae version previa, la fila debe seguir existiendo.
  select source.value ->> 'id'
    into v_conflict_id
    from jsonb_array_elements(p_events) source
   where nullif(source.value ->> 'expected_actualizado_en', '') is not null
     and not exists (
       select 1
         from public.coi_timeline_events target
        where target.id = source.value ->> 'id'
     )
   limit 1;

  if v_conflict_id is not null then
    raise exception using
      errcode='40001',
      message='COI_TIMELINE_STALE_WRITE',
      detail='El evento ' || v_conflict_id || ' ya no existe; actualice el Timeline antes de guardar.';
  end if;

  select target.id
    into v_conflict_id
    from public.coi_timeline_events target
    join jsonb_array_elements(p_events) source
      on target.id = source.value ->> 'id'
   where nullif(source.value ->> 'expected_actualizado_en', '') is null
      or target.actualizado_en is distinct from
         (source.value ->> 'expected_actualizado_en')::timestamptz
   limit 1;

  if v_conflict_id is not null then
    raise exception using
      errcode='40001',
      message='COI_TIMELINE_STALE_WRITE',
      detail='El evento ' || v_conflict_id || ' fue modificado por otra sesion.';
  end if;

  return query
  insert into public.coi_timeline_events as target (
    id, orden_id, nro_oc, fecha, hora, semana, expediente, proveedor, rubro,
    estacion, titulo, tipo_evento, origen, remitente, destinatarios, descripcion,
    documentos_mencionados, estado, riesgo, accion_pendiente, responsable_accion,
    fecha_limite, link_documental, observaciones, creado_por, origen_carga,
    oc_registrada
  )
  select
    x.id, x.orden_id, x.nro_oc, coalesce(x.fecha,current_date), coalesce(x.hora,'09:00'::time),
    coalesce(x.semana,''), coalesce(x.expediente,''), coalesce(x.proveedor,''),
    coalesce(x.rubro,''), coalesce(x.estacion,''), coalesce(x.titulo,''),
    coalesce(x.tipo_evento,'Mailing'), coalesce(x.origen,'Mailing'),
    coalesce(x.remitente,''), coalesce(x.destinatarios,''), coalesce(x.descripcion,''),
    coalesce(x.documentos_mencionados,''), coalesce(x.estado,'Informativo'),
    coalesce(x.riesgo,'Bajo'), coalesce(x.accion_pendiente,''),
    coalesce(x.responsable_accion,''), x.fecha_limite, coalesce(x.link_documental,''),
    coalesce(x.observaciones,''), coalesce(x.creado_por,''),
    coalesce(x.origen_carga,'Carga manual'), coalesce(x.oc_registrada,'')
  from jsonb_to_recordset(p_events) as x (
    id text, orden_id uuid, nro_oc text, fecha date, hora time, semana text,
    expediente text, proveedor text, rubro text, estacion text, titulo text,
    tipo_evento text, origen text, remitente text, destinatarios text,
    descripcion text, documentos_mencionados text, estado text, riesgo text,
    accion_pendiente text, responsable_accion text, fecha_limite date,
    link_documental text, observaciones text, creado_por text, origen_carga text,
    oc_registrada text
  )
  on conflict (id) do update set
    orden_id=excluded.orden_id,
    nro_oc=excluded.nro_oc,
    fecha=excluded.fecha,
    hora=excluded.hora,
    semana=excluded.semana,
    expediente=excluded.expediente,
    proveedor=excluded.proveedor,
    rubro=excluded.rubro,
    estacion=excluded.estacion,
    titulo=excluded.titulo,
    tipo_evento=excluded.tipo_evento,
    origen=excluded.origen,
    remitente=excluded.remitente,
    destinatarios=excluded.destinatarios,
    descripcion=excluded.descripcion,
    documentos_mencionados=excluded.documentos_mencionados,
    estado=excluded.estado,
    riesgo=excluded.riesgo,
    accion_pendiente=excluded.accion_pendiente,
    responsable_accion=excluded.responsable_accion,
    fecha_limite=excluded.fecha_limite,
    link_documental=excluded.link_documental,
    observaciones=excluded.observaciones,
    creado_por=excluded.creado_por,
    origen_carga=excluded.origen_carga,
    oc_registrada=excluded.oc_registrada
  returning target.*;
end;
$$;

revoke all on function public.coi_timeline_upsert_events(jsonb) from public, anon;
grant execute on function public.coi_timeline_upsert_events(jsonb) to authenticated;

-- 4) Restore exacto: mismo orden de locks que el renumber (OC -> Timeline).
-- Ademas ignora cualquier expected_actualizado_en proveniente del backup y
-- construye la version esperada bajo el lock actual de la tabla.
create or replace function public.coi_timeline_replace_events(p_events jsonb)
returns setof public.coi_timeline_events
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_events jsonb;
begin
  perform public.coi_assert_role(array['administrador','jefatura']);

  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception using errcode='22023', message='COI_TIMELINE_EVENTS_ARRAY_REQUIRED';
  end if;
  if jsonb_array_length(p_events) > 5000 then
    raise exception using errcode='54000', message='COI_TIMELINE_BATCH_LIMIT_5000';
  end if;

  -- Mantener el mismo orden global que upsert y renumber: OC antes de Timeline.
  perform public.coi_timeline_lock_orders(p_events);
  lock table public.coi_timeline_events in share row exclusive mode;

  select coalesce(
           jsonb_agg(
             case when target.id is null then source.value - 'expected_actualizado_en'
                  else (source.value - 'expected_actualizado_en') || jsonb_build_object(
                    'expected_actualizado_en', target.actualizado_en
                  )
             end
           ),
           '[]'::jsonb
         )
    into v_events
    from jsonb_array_elements(p_events) source
    left join public.coi_timeline_events target
      on target.id = source.value ->> 'id';

  perform * from public.coi_timeline_upsert_events(v_events);

  delete from public.coi_timeline_events target
   where not exists (
     select 1
       from jsonb_array_elements(p_events) source
      where source.value ->> 'id' = target.id
   );

  return query
  select event.*
    from public.coi_timeline_events event
   order by event.fecha desc, event.hora desc, event.id desc;
end;
$$;

revoke all on function public.coi_timeline_replace_events(jsonb) from public, anon;
grant execute on function public.coi_timeline_replace_events(jsonb) to authenticated;

comment on function public.coi_timeline_replace_events(jsonb) is
  'Restore exacto con orden de locks OC->Timeline y versionado construido bajo lock.';

notify pgrst, 'reload schema';

commit;
