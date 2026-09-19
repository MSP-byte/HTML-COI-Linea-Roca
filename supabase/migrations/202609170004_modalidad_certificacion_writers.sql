-- CAMBIO 3 (review) — permitir modalidad_certificacion en los writers canónicos
--
-- La migración 202609170003 agregó la columna, pero los dos contratos
-- server-side que protegen coi_ordenes seguían sin conocerla:
--
--   coi_actualizar_orden_integral  -> COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD
--   coi_direct_order_update_guard  -> COI_DIRECT_ORDER_FIELD_NOT_ALLOWED
--
-- Con lo cual el editor V60 no podía persistir el valor: la columna existía y
-- era inescribible. Acá se redefinen ambas funciones con su cuerpo vigente y
-- UNA sola diferencia: 'modalidad_certificacion' se suma a v_allowed.
--
-- No se debilita ningún guard. Los campos protegidos y desconocidos siguen
-- rechazándose igual, los roles exigidos no cambian y los grants se
-- reafirman idénticos. Reaplicar esta migración es NO-OP.

begin;

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
    'control_terceros_estado', 'modalidad_certificacion'
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


create or replace function public.coi_direct_order_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_key text;
  v_changed text[];
  v_allowed constant text[] := array[
    'id_obra', 'tipo', 'tipo_trabajo', 'especialidad', 'descripcion',
    'proveedor', 'estacion', 'ramal', 'sector', 'expediente', 'monto_total',
    'moneda', 'fecha_acta_inicio', 'plazo_dias', 'fecha_vencimiento',
    'proxima_certificacion', 'fecha_recepcion_documentacion',
    'fecha_envio_planificacion', 'estado_coi', 'estado_documental',
    'estado_registro', 'observaciones', 'certificable_con_saldo',
    'justificacion_administrativa', 'link_documental_principal',
    'estado_link_documental', 'calidad_datos_estado', 'calidad_datos_score',
    'prioridad_operativa', 'responsable_coi', 'fecha_ultimo_control',
    'requiere_accion', 'motivo_requiere_accion', 'estado_envio_pyc',
    'fecha_cierre_operativo', 'observacion_cierre', 'control_terceros_hasta',
    'control_terceros_estado', 'modalidad_certificacion'
  ];
begin
  -- Las RPC SECURITY DEFINER y triggers internos ejecutan con el rol dueño y
  -- no son el writer PostgREST legacy que esta guarda debe contener.
  if current_user <> 'authenticated' then
    return new;
  end if;

  v_role := public.coi_current_role();
  if v_role is null or v_role not in (
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ) then
    raise exception using errcode = '42501', message = 'COI_ROLE_REQUIRED';
  end if;

  select coalesce(array_agg(n.key order by n.key), '{}'::text[])
    into v_changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
   where n.value is distinct from o.value;

  if old.id is distinct from new.id then
    raise exception using errcode = '42501', message = 'COI_ORDER_IDENTITY_IMMUTABLE';
  end if;

  if old.nro_oc is distinct from new.nro_oc then
    raise exception using
      errcode = '42501',
      message = 'COI_RENUMBER_REQUIRES_RPC',
      hint = 'Use public.coi_renumerar_oc para cambiar nro_oc con sincronizacion y auditoria.';
  end if;

  foreach v_key in array v_changed loop
    if v_key in ('id', 'nro_oc', 'saldo_remanente', 'actualizado_por', 'fecha_actualizacion') then
      continue;
    end if;
    if not (v_key = any(v_allowed)) then
      raise exception using
        errcode = '42501',
        message = 'COI_DIRECT_ORDER_FIELD_NOT_ALLOWED',
        detail = v_key;
    end if;
  end loop;

  if (
       old.link_documental_principal is distinct from new.link_documental_principal
    or old.estado_link_documental is distinct from new.estado_link_documental
  ) and v_role not in ('administrador', 'jefatura', 'editor') then
    raise exception using
      errcode = '42501',
      message = 'COI_LINK_ROLE_REQUIRED';
  end if;

  return new;
end;
$$;

-- Se reafirman los privilegios tal como estaban: anon sigue sin ejecutar.
revoke all on function public.coi_actualizar_orden_integral(uuid, jsonb) from public, anon;
grant execute on function public.coi_actualizar_orden_integral(uuid, jsonb) to authenticated;
revoke all on function public.coi_direct_order_update_guard() from public, anon;
grant execute on function public.coi_direct_order_update_guard() to authenticated;

commit;
