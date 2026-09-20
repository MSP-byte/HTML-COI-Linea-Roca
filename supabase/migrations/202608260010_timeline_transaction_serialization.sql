-- COI Linea Roca - serializacion transaccional final del Timeline/Mailing.
-- Supabase sigue siendo la unica fuente de verdad. Esta migracion es forward-only.

begin;

-- Todos los mutadores Timeline toman el mismo advisory lock ANTES de cualquier
-- lock de OC o fila Timeline. Esto elimina el deadlock upsert <-> restore sin
-- alterar el orden OC -> Timeline necesario para convivir con renumeraciones.
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

  perform pg_advisory_xact_lock(hashtextextended('coi_timeline_mutation_v1', 0));
  perform public.coi_timeline_lock_orders(p_events);

  perform target.id
    from public.coi_timeline_events target
    join jsonb_array_elements(p_events) source
      on target.id = source.value ->> 'id'
   order by target.id
   for update of target;

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

-- Restore administrativo exacto. A diferencia del upsert interactivo, no se
-- limita a 5.000 filas: un backup generado por la propia aplicacion debe seguir
-- siendo restaurable cuando el historial supere ese volumen. Sigue siendo una
-- sola transaccion y solo administrador/jefatura pueden ejecutarla.
create or replace function public.coi_timeline_replace_events(p_events jsonb)
returns setof public.coi_timeline_events
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.coi_assert_role(array['administrador','jefatura']);

  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception using errcode='22023', message='COI_TIMELINE_EVENTS_ARRAY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('coi_timeline_mutation_v1', 0));

  -- Lock deterministico de las OC referenciadas sin el limite del helper de
  -- escritura interactiva. Se hace antes de bloquear Timeline.
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

  lock table public.coi_timeline_events in share row exclusive mode;

  insert into public.coi_timeline_events as target (
    id, orden_id, nro_oc, fecha, hora, semana, expediente, proveedor, rubro,
    estacion, titulo, tipo_evento, origen, remitente, destinatarios, descripcion,
    documentos_mencionados, estado, riesgo, accion_pendiente, responsable_accion,
    fecha_limite, link_documental, observaciones, creado_por, origen_carga,
    oc_registrada
  )
  select
    x.id, x.orden_id, x.nro_oc, x.fecha, x.hora, x.semana, x.expediente,
    x.proveedor, x.rubro, x.estacion, x.titulo, x.tipo_evento, x.origen,
    x.remitente, x.destinatarios, x.descripcion, x.documentos_mencionados,
    x.estado, x.riesgo, x.accion_pendiente, x.responsable_accion,
    x.fecha_limite, x.link_documental, x.observaciones, x.creado_por,
    x.origen_carga, x.oc_registrada
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
    oc_registrada=excluded.oc_registrada;

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

-- DELETE versionado y serializado. Si la fila cambió (o desapareció) desde que
-- fue mostrada al usuario, se rechaza en vez de borrar estado más nuevo.
create or replace function public.coi_timeline_delete_event(
  p_id text,
  p_expected_actualizado_en timestamptz
)
returns setof public.coi_timeline_events
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actualizado_en timestamptz;
begin
  perform public.coi_assert_role(array['administrador','jefatura']);

  if nullif(btrim(p_id), '') is null or p_expected_actualizado_en is null then
    raise exception using errcode='22023', message='COI_TIMELINE_DELETE_VERSION_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('coi_timeline_mutation_v1', 0));

  select event.actualizado_en
    into v_actualizado_en
    from public.coi_timeline_events event
   where event.id = btrim(p_id)
   for update;

  if not found or v_actualizado_en is distinct from p_expected_actualizado_en then
    raise exception using
      errcode='40001',
      message='COI_TIMELINE_STALE_DELETE',
      detail='El evento fue modificado o eliminado por otra sesion; actualice el Timeline antes de eliminar.';
  end if;

  return query
  delete from public.coi_timeline_events event
   where event.id = btrim(p_id)
   returning event.*;
end;
$$;

revoke all on function public.coi_timeline_delete_event(text,timestamptz) from public, anon;
grant execute on function public.coi_timeline_delete_event(text,timestamptz) to authenticated;

comment on function public.coi_timeline_upsert_events(jsonb) is
  'Upsert Timeline versionado con advisory lock comun, locks OC->Timeline y limite interactivo de 5000.';
comment on function public.coi_timeline_replace_events(jsonb) is
  'Restore administrativo atomico y sin limite artificial de 5000; serializa mutaciones y preserva orden OC->Timeline.';
comment on function public.coi_timeline_delete_event(text,timestamptz) is
  'Delete Timeline versionado, atomico y serializado; rechaza clientes desactualizados.';

notify pgrst, 'reload schema';

commit;
