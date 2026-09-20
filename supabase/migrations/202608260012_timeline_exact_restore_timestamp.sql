-- COI Linea Roca - restore exacto del timestamp funcional del Timeline.
-- Forward-only. Supabase permanece como unica fuente de verdad.
--
-- Objetivos:
-- 1) conservar actualizado_en de un snapshot validado durante el restore administrativo;
-- 2) mantener actualizado_en server-side para altas/ediciones normales;
-- 3) conservar la serializacion y el orden de locks definidos en 010/011;
-- 4) permitir restores atomicos de backups completos sin limite artificial de 5.000 filas.

begin;

create or replace function public.coi_timeline_prepare_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.coi_ordenes%rowtype;
  v_exact_restore boolean := coalesce(current_setting('coi.timeline_exact_restore', true), '') = 'on';
begin
  new.id := btrim(new.id);
  new.nro_oc := nullif(public.coi_normalize_order_number(new.nro_oc), '');
  new.semana := coalesce(nullif(btrim(new.semana), ''), to_char(new.fecha, 'IYYY-"W"IW'));

  if new.orden_id is not null then
    select * into v_order
      from public.coi_ordenes o
     where o.id = new.orden_id
     for key share;
    if not found then
      raise exception using errcode = '23503', message = 'COI_TIMELINE_ORDER_NOT_FOUND';
    end if;
    new.nro_oc := v_order.nro_oc;
    new.oc_registrada := 'SI';
  elsif new.nro_oc is not null then
    select * into v_order
      from public.coi_ordenes o
     where public.coi_normalize_order_number(o.nro_oc) = new.nro_oc
     limit 1
     for key share;
    if found then
      new.orden_id := v_order.id;
      new.nro_oc := v_order.nro_oc;
      new.oc_registrada := 'SI';
    else
      new.oc_registrada := 'NO';
    end if;
  else
    new.oc_registrada := 'GENERAL';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.creado_en := clock_timestamp();
  else
    new.created_by := old.created_by;
    new.creado_en := old.creado_en;
  end if;

  new.updated_by := auth.uid();
  if v_exact_restore then
    if new.actualizado_en is null then
      raise exception using errcode='22023', message='COI_TIMELINE_RESTORE_TIMESTAMP_REQUIRED';
    end if;
    -- Durante el RPC administrativo de restore, el timestamp pertenece al
    -- snapshot validado y debe sobrevivir exactamente. Ningun mutador normal
    -- activa esta bandera transaccional.
    new.actualizado_en := new.actualizado_en;
  else
    new.actualizado_en := clock_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.coi_timeline_prepare_row() from public, anon, authenticated;

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

  if exists (
    select 1
      from jsonb_array_elements(p_events) source
     where nullif(source.value ->> 'actualizado_en', '') is null
        or (source.value ->> 'actualizado_en') !~ '^\\d{4}-\\d{2}-\\d{2}T'
  ) then
    raise exception using errcode='22023', message='COI_TIMELINE_RESTORE_TIMESTAMP_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('coi_timeline_mutation_v1', 0));

  -- Mantener el orden global OC -> Timeline usado por todos los mutadores.
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

  -- Solo este RPC habilita al trigger a aceptar actualizado_en del snapshot.
  perform set_config('coi.timeline_exact_restore', 'on', true);

  insert into public.coi_timeline_events as target (
    id, orden_id, nro_oc, fecha, hora, semana, expediente, proveedor, rubro,
    estacion, titulo, tipo_evento, origen, remitente, destinatarios, descripcion,
    documentos_mencionados, estado, riesgo, accion_pendiente, responsable_accion,
    fecha_limite, link_documental, observaciones, creado_por, origen_carga,
    oc_registrada, actualizado_en
  )
  select
    x.id,
    x.orden_id,
    coalesce(x.nro_oc,''),
    coalesce(x.fecha,current_date),
    coalesce(x.hora,'09:00'::time),
    coalesce(x.semana,''),
    coalesce(x.expediente,''),
    coalesce(x.proveedor,''),
    coalesce(x.rubro,''),
    coalesce(x.estacion,''),
    coalesce(x.titulo,''),
    coalesce(x.tipo_evento,'Mailing'),
    coalesce(x.origen,'Mailing'),
    coalesce(x.remitente,''),
    coalesce(x.destinatarios,''),
    coalesce(x.descripcion,''),
    coalesce(x.documentos_mencionados,''),
    coalesce(x.estado,'Informativo'),
    coalesce(x.riesgo,'Bajo'),
    coalesce(x.accion_pendiente,''),
    coalesce(x.responsable_accion,''),
    x.fecha_limite,
    coalesce(x.link_documental,''),
    coalesce(x.observaciones,''),
    coalesce(x.creado_por,''),
    coalesce(x.origen_carga,'Carga manual'),
    coalesce(x.oc_registrada,''),
    x.actualizado_en
  from jsonb_to_recordset(p_events) as x (
    id text, orden_id uuid, nro_oc text, fecha date, hora time, semana text,
    expediente text, proveedor text, rubro text, estacion text, titulo text,
    tipo_evento text, origen text, remitente text, destinatarios text,
    descripcion text, documentos_mencionados text, estado text, riesgo text,
    accion_pendiente text, responsable_accion text, fecha_limite date,
    link_documental text, observaciones text, creado_por text, origen_carga text,
    oc_registrada text, actualizado_en timestamptz
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
    oc_registrada=excluded.oc_registrada,
    actualizado_en=excluded.actualizado_en;

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
  'Restore Timeline atomico y serializado; preserva actualizado_en del snapshot validado y no limita backups completos a 5000 filas.';

notify pgrst, 'reload schema';

commit;
