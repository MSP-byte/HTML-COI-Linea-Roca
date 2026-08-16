-- COI Linea Roca - edicion integral de OC y estacion principal en la misma
-- transaccion. Los campos se validan contra una allowlist del servidor.

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
    'justificacion_administrativa', 'link_documental_principal',
    'estado_link_documental', 'calidad_datos_estado', 'calidad_datos_score',
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

  select to_jsonb(o.*)
    into v_before
    from public.coi_ordenes o
   where o.id = p_orden_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  for v_key in select jsonb_object_keys(p_cambios) order by 1 loop
    if not (v_key = any(v_allowed)) then
      raise exception using errcode = '22023', message = 'COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD', detail = v_key;
    end if;
    if not exists (
      select 1
        from pg_attribute a
       where a.attrelid = 'public.coi_ordenes'::regclass
         and a.attname = v_key
         and a.attnum > 0
         and not a.attisdropped
    ) then
      raise exception using errcode = '42703', message = 'COI_ORDER_SCHEMA_MISMATCH', detail = v_key;
    end if;

    v_assignments := concat_ws(
      ', ',
      nullif(v_assignments, ''),
      format('%1$I = (jsonb_populate_record(null::public.coi_ordenes, $1)).%1$I', v_key)
    );
  end loop;

  if v_assignments = '' then
    return jsonb_build_object('orden', v_before, 'campos', '[]'::jsonb, 'sin_cambios', true);
  end if;

  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.coi_ordenes'::regclass
       and attname = 'actualizado_por' and attnum > 0 and not attisdropped
  ) then
    v_assignments := v_assignments || ', actualizado_por = $3';
  end if;
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.coi_ordenes'::regclass
       and attname = 'fecha_actualizacion' and attnum > 0 and not attisdropped
  ) then
    v_assignments := v_assignments || ', fecha_actualizacion = clock_timestamp()';
  end if;

  execute format(
    'update public.coi_ordenes as o set %s where o.id = $2 returning to_jsonb(o.*)',
    v_assignments
  ) using p_cambios, p_orden_id, auth.uid() into v_after;

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

create or replace function public.coi_sync_principal_station_from_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
    from public.coi_ordenes_estaciones oe
   where oe.orden_id = new.id
     and oe.es_principal is true;

  if v_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'COI_ORDER_REQUIRES_ONE_PRINCIPAL_STATION',
      detail = format('Asociaciones principales encontradas: %s', v_count);
  end if;

  update public.coi_ordenes_estaciones
     set estacion = new.estacion,
         ramal = new.ramal,
         sector = new.sector
   where orden_id = new.id
     and es_principal is true;
  return new;
end;
$$;

drop trigger if exists coi_ordenes_sync_principal_station on public.coi_ordenes;
create trigger coi_ordenes_sync_principal_station
after update of estacion, ramal, sector on public.coi_ordenes
for each row
when (
  old.estacion is distinct from new.estacion
  or old.ramal is distinct from new.ramal
  or old.sector is distinct from new.sector
)
execute function public.coi_sync_principal_station_from_order();

revoke all on function public.coi_actualizar_orden_integral(uuid, jsonb) from public, anon;
grant execute on function public.coi_actualizar_orden_integral(uuid, jsonb) to authenticated;

comment on function public.coi_actualizar_orden_integral(uuid, jsonb) is
  'Actualiza una OC y su unica estacion principal bajo el mismo commit PostgreSQL.';

commit;
