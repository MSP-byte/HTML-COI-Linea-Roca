-- COI Linea Roca - RC2 review hardening
-- Cierre forward-only de findings de integridad detectados en PR #27.
-- No toca credenciales ni datos fuera del contrato COI.

begin;

-- -------------------------------------------------------------------------
-- 1) Los hijos modernos siempre derivan nro_oc desde la OC maestra.
--    El FOR KEY SHARE serializa escrituras concurrentes con una renumeracion,
--    que toma FOR UPDATE sobre la misma OC.
-- -------------------------------------------------------------------------
create or replace function public.coi_child_order_number_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nro_oc text;
begin
  if new.orden_id is null then
    return new;
  end if;

  select o.nro_oc
    into v_nro_oc
    from public.coi_ordenes o
   where o.id = new.orden_id
   for key share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'COI_CHILD_ORDER_NOT_FOUND',
      detail = new.orden_id::text;
  end if;

  new.nro_oc := v_nro_oc;
  return new;
end;
$$;

revoke all on function public.coi_child_order_number_guard() from public, anon, authenticated;

do $$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'coi_ordenes_estaciones',
    'coi_posiciones_oc',
    'coi_certificaciones',
    'coi_consumos_posicion',
    'coi_documentos_oc',
    'coi_links_documentales',
    'coi_observaciones_oc',
    'coi_alertas',
    'coi_historial_oc'
  ] loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'orden_id'
    ) or not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'nro_oc'
    ) then
      continue;
    end if;

    v_trigger := 'coi_' || substr(md5(v_table), 1, 12) || '_child_nro_guard';
    execute format('drop trigger if exists %I on public.%I', v_trigger, v_table);
    execute format(
      'create trigger %I before insert or update of orden_id, nro_oc on public.%I for each row execute function public.coi_child_order_number_guard()',
      v_trigger, v_table
    );
  end loop;
end;
$$;

-- -------------------------------------------------------------------------
-- 2) Antes de cambiar el nro_oc maestro, bloquear colisiones no visibles en
--    coi_ordenes: hijos huérfanos/legacy y UM sin orden_id.
-- -------------------------------------------------------------------------
create or replace function public.coi_order_number_dependency_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.nro_oc is not distinct from old.nro_oc then
    return new;
  end if;

  if
       exists (select 1 from public.coi_ordenes_estaciones x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_posiciones_oc x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_certificaciones x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_consumos_posicion x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_documentos_oc x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_links_documentales x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_observaciones_oc x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_alertas x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_historial_oc x where x.nro_oc = new.nro_oc and (x.orden_id is null or x.orden_id <> new.id))
    or exists (select 1 from public.coi_servicios_tecnicos_um x where x.nro_oc = new.nro_oc)
  then
    raise exception using
      errcode = '23505',
      message = 'COI_ORDER_NUMBER_DEPENDENCY_COLLISION',
      detail = new.nro_oc,
      hint = 'El nro_oc destino ya aparece en una tabla dependiente o legacy.';
  end if;

  return new;
end;
$$;

revoke all on function public.coi_order_number_dependency_guard() from public, anon, authenticated;
drop trigger if exists coi_order_number_dependency_guard on public.coi_ordenes;
create trigger coi_order_number_dependency_guard
before update of nro_oc on public.coi_ordenes
for each row execute function public.coi_order_number_dependency_guard();

-- -------------------------------------------------------------------------
-- 3) Borrado integral: UM legacy tambien es dependencia contractual.
-- -------------------------------------------------------------------------
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
    'coi_auditorias_calidad', 'coi_timeline_events', 'coi_documentos_versiones',
    'coi_servicios_tecnicos_um'
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

  delete from public.coi_ordenes_estaciones oe where oe.orden_id = p_orden_id;
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

  return jsonb_build_object('deleted', to_jsonb(v_before), 'estaciones_eliminadas', v_station_count);
end;
$$;

revoke all on function public.coi_eliminar_orden_integral(uuid) from public, anon;
grant execute on function public.coi_eliminar_orden_integral(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 4) Historial de renumeracion: solo puede ser escrito por la RPC SECURITY
--    DEFINER. Los inserts comunes quedan expresamente bloqueados.
-- -------------------------------------------------------------------------
drop policy if exists coi_historial_insert_v2 on public.coi_historial_oc;
create policy coi_historial_insert_v2 on public.coi_historial_oc
for insert to authenticated with check (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor')
  and (creado_por is null or creado_por = auth.uid())
  and lower(trim(tipo_evento)) not in (
    'circuito administrativo',
    'cambio de estado contractual',
    'cambio de link documental',
    'renumeracion de oc'
  )
);

drop policy if exists coi_historial_insert_guard_v2 on public.coi_historial_oc;
create policy coi_historial_insert_guard_v2 on public.coi_historial_oc as restrictive
for insert to authenticated with check (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor')
  and (creado_por is null or creado_por = auth.uid())
  and lower(trim(tipo_evento)) not in (
    'circuito administrativo',
    'cambio de estado contractual',
    'cambio de link documental',
    'renumeracion de oc'
  )
);

-- -------------------------------------------------------------------------
-- 5) La RPC generica de edicion no administra campos resumen de links.
--    Esos campos pertenecen al circuito documental dedicado.
-- -------------------------------------------------------------------------
create or replace function public.coi_actualizar_orden_integral(
  p_orden_id uuid,
  p_cambios jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_assignments text := '';
  v_allowed constant text[] := array[
    'id_obra', 'tipo', 'tipo_trabajo', 'especialidad', 'descripcion',
    'proveedor', 'estacion', 'ramal', 'sector', 'expediente', 'monto_total',
    'moneda', 'fecha_acta_inicio', 'plazo_dias', 'fecha_vencimiento',
    'proxima_certificacion', 'fecha_recepcion_documentacion',
    'fecha_envio_planificacion', 'estado_coi', 'estado_documental',
    'estado_registro', 'observaciones', 'certificable_con_saldo',
    'justificacion_administrativa', 'calidad_datos_estado', 'calidad_datos_score',
    'prioridad_operativa', 'responsable_coi', 'fecha_ultimo_control',
    'requiere_accion', 'motivo_requiere_accion', 'estado_envio_pyc',
    'fecha_cierre_operativo', 'observacion_cierre', 'control_terceros_hasta',
    'control_terceros_estado'
  ];
begin
  v_role := public.coi_assert_role(array[
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ]);

  if p_orden_id is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception using errcode = '22023', message = 'COI_INVALID_ORDER_UPDATE';
  end if;

  select to_jsonb(o.*) into v_before
    from public.coi_ordenes o where o.id = p_orden_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  for v_key in select jsonb_object_keys(p_cambios) order by 1 loop
    if not (v_key = any(v_allowed)) then
      raise exception using errcode = '22023', message = 'COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD', detail = v_key;
    end if;
    if not exists (
      select 1 from pg_attribute a
       where a.attrelid = 'public.coi_ordenes'::regclass
         and a.attname = v_key and a.attnum > 0 and not a.attisdropped
    ) then
      raise exception using errcode = '42703', message = 'COI_ORDER_SCHEMA_MISMATCH', detail = v_key;
    end if;
    v_assignments := concat_ws(', ', nullif(v_assignments, ''),
      format('%1$I = (jsonb_populate_record(null::public.coi_ordenes, $1)).%1$I', v_key));
  end loop;

  if v_assignments = '' then
    return jsonb_build_object('orden', v_before, 'campos', '[]'::jsonb, 'sin_cambios', true);
  end if;

  if exists (select 1 from pg_attribute where attrelid = 'public.coi_ordenes'::regclass and attname = 'actualizado_por' and attnum > 0 and not attisdropped) then
    v_assignments := v_assignments || ', actualizado_por = $3';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.coi_ordenes'::regclass and attname = 'fecha_actualizacion' and attnum > 0 and not attisdropped) then
    v_assignments := v_assignments || ', fecha_actualizacion = clock_timestamp()';
  end if;

  execute format('update public.coi_ordenes as o set %s where o.id = $2 returning to_jsonb(o.*)', v_assignments)
    using p_cambios, p_orden_id, auth.uid() into v_after;

  perform public.coi_sync_order_balance(p_orden_id);
  select to_jsonb(o.*) into v_after from public.coi_ordenes o where o.id = p_orden_id;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ACTUALIZAR_ORDEN_INTEGRAL', 'coi_ordenes', p_orden_id::text,
    coalesce(v_after ->> 'nro_oc', v_before ->> 'nro_oc'), v_before, v_after,
    jsonb_build_object('campos', (select jsonb_agg(key order by key) from jsonb_object_keys(p_cambios) key))
  );

  return jsonb_build_object(
    'orden', v_after,
    'campos', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(p_cambios) key),
    'sin_cambios', false
  );
end;
$$;

revoke all on function public.coi_actualizar_orden_integral(uuid, jsonb) from public, anon;
grant execute on function public.coi_actualizar_orden_integral(uuid, jsonb) to authenticated;

commit;
