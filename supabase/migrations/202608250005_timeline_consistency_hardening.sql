-- COI Linea Roca - consistencia concurrente y restauracion exacta del Timeline.

begin;

create index if not exists coi_timeline_page_idx
  on public.coi_timeline_events(fecha desc, hora desc, id desc);

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
   where p_before_fecha is null
      or (event.fecha, event.hora, event.id) < (p_before_fecha, p_before_hora, p_before_id)
   order by event.fecha desc, event.hora desc, event.id desc
   limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$$;

revoke all on function public.coi_timeline_list_page(date,time without time zone,text,integer)
  from public, anon;
grant execute on function public.coi_timeline_list_page(date,time without time zone,text,integer)
  to authenticated;

comment on function public.coi_timeline_list_page(date,time without time zone,text,integer) is
  'Lectura paginada estable del Timeline mediante cursor fecha/hora/id y RLS del usuario.';

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

  -- Bloquea primero todas las filas existentes del lote. Si otra sesion las
  -- actualizo mientras este cliente editaba, la comparacion posterior observa
  -- el timestamp ya confirmado y rechaza todo el lote sin sobrescribirlo.
  perform target.id
    from public.coi_timeline_events target
    join jsonb_array_elements(p_events) source
      on target.id = source.value ->> 'id'
     for update of target;

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

comment on function public.coi_timeline_upsert_events(jsonb) is
  'Upsert atomico de hasta 5000 eventos con control de version por actualizado_en.';

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

  -- La restauracion administrativa es una sustitucion exacta. El lock evita
  -- escrituras intercaladas y la transaccion revierte completa ante un error.
  lock table public.coi_timeline_events in share row exclusive mode;

  select coalesce(
           jsonb_agg(
             case when target.id is null then source.value
                  else source.value || jsonb_build_object(
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
  'Restaura exactamente un snapshot Timeline: upsert y borrado de ausentes en una sola transaccion.';

notify pgrst, 'reload schema';

commit;
