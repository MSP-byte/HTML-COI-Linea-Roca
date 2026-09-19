-- CAMBIO 3 (review) — permitir modalidad_certificacion en el alta/upsert
--
-- 202609170004 habilitó la columna en coi_actualizar_orden_integral y en el
-- guard de UPDATE directo, pero NO en coi_guardar_orden_integral, que es el
-- contrato de alta y de carga masiva. Como normalizarOrdenParaSupabase() emite
-- siempre la clave —incluido SIN_DEFINIR para las OC sin modalidad explícita—,
-- todo alta pasaba a rechazarse con COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD.
--
-- Se redefine la función con su cuerpo vigente y tres diferencias mínimas:
-- la clave se acepta en la allowlist y la columna se escribe en el INSERT,
-- con SIN_DEFINIR por defecto. La rama de actualización sigue delegando en
-- coi_actualizar_orden_integral, que ya la conocía.
--
-- Ningún guard se debilita: los campos protegidos y desconocidos se siguen
-- rechazando, los roles exigidos no cambian y los grants se reafirman
-- idénticos. Reaplicar esta migración es NO-OP.

begin;

create or replace function public.coi_guardar_orden_integral(
  p_orden_id uuid,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order_id uuid;
  v_existing public.coi_ordenes%rowtype;
  v_after jsonb;
  v_update jsonb;
  v_nro_oc text;
  v_key text;
  v_invalid text[];
  v_action text;
  v_found boolean := false;
begin
  v_role := public.coi_assert_role(array[
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ]);
  if jsonb_typeof(p_datos) <> 'object' then
    raise exception using errcode = '22023', message = 'COI_INVALID_ORDER_PAYLOAD';
  end if;

  select array_agg(key order by key)
    into v_invalid
    from jsonb_object_keys(p_datos) key
   where key <> all(array[
     'id_obra', 'nro_oc', 'tipo', 'tipo_trabajo', 'especialidad', 'descripcion',
     'proveedor', 'estacion', 'ramal', 'sector', 'expediente', 'monto_total',
     'moneda', 'fecha_acta_inicio', 'plazo_dias', 'fecha_vencimiento',
     'proxima_certificacion', 'fecha_recepcion_documentacion',
     'fecha_envio_planificacion', 'estado_coi', 'estado_documental',
     'estado_registro', 'observaciones', 'saldo_remanente',
     'certificable_con_saldo', 'justificacion_administrativa',
     'link_documental_principal', 'estado_link_documental',
     'calidad_datos_estado', 'calidad_datos_score', 'prioridad_operativa',
     'responsable_coi', 'fecha_ultimo_control', 'requiere_accion',
     'motivo_requiere_accion', 'estado_envio_pyc', 'fecha_cierre_operativo',
     'observacion_cierre', 'control_terceros_hasta', 'control_terceros_estado',
     'modalidad_certificacion'
   ]);
  if coalesce(array_length(v_invalid, 1), 0) > 0 then
    raise exception using
      errcode = '22023',
      message = 'COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD',
      detail = array_to_string(v_invalid, ', ');
  end if;

  v_nro_oc := public.coi_normalize_order_number(p_datos ->> 'nro_oc');
  if p_orden_id is not null then
    select * into v_existing
      from public.coi_ordenes o
     where o.id = p_orden_id
     for update;
    v_found := found;
  elsif v_nro_oc is not null then
    select * into v_existing
      from public.coi_ordenes o
     where public.coi_normalize_order_number(o.nro_oc) = v_nro_oc
     for update;
    v_found := found;
  end if;

  if v_found then
    if v_nro_oc is not null
       and public.coi_normalize_order_number(v_existing.nro_oc) <> v_nro_oc then
      raise exception using errcode = '23514', message = 'COI_ORDER_NUMBER_MISMATCH';
    end if;
    v_update := p_datos - 'nro_oc' - 'saldo_remanente';
    v_after := public.coi_actualizar_orden_integral(v_existing.id, v_update);
    return v_after || jsonb_build_object('accion', 'updated');
  end if;

  if p_orden_id is not null then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;
  if v_role not in ('administrador', 'jefatura', 'editor') then
    raise exception using errcode = '42501', message = 'COI_ROLE_REQUIRED: crear OC';
  end if;
  if v_nro_oc is null then
    raise exception using errcode = '23514', message = 'COI_ORDER_NUMBER_REQUIRED';
  end if;

  v_order_id := gen_random_uuid();
  insert into public.coi_ordenes (
    id, id_obra, nro_oc, tipo, tipo_trabajo, especialidad, descripcion,
    proveedor, estacion, ramal, sector, expediente, monto_total, moneda,
    fecha_acta_inicio, plazo_dias, fecha_vencimiento, proxima_certificacion,
    fecha_recepcion_documentacion, fecha_envio_planificacion, estado_coi,
    estado_documental, estado_registro, observaciones,
    certificable_con_saldo, justificacion_administrativa,
    link_documental_principal, estado_link_documental,
    calidad_datos_estado, calidad_datos_score, prioridad_operativa,
    responsable_coi, fecha_ultimo_control, requiere_accion,
    motivo_requiere_accion, estado_envio_pyc, fecha_cierre_operativo,
    observacion_cierre, control_terceros_hasta, control_terceros_estado,
    modalidad_certificacion,
    actualizado_por, fecha_actualizacion
  )
  select
    v_order_id,
    coalesce(nullif(trim(r.id_obra), ''), 'OC-' || v_nro_oc),
    v_nro_oc, r.tipo, r.tipo_trabajo, r.especialidad, r.descripcion,
    r.proveedor, coalesce(nullif(trim(r.estacion), ''), 'Sin definir'),
    r.ramal, r.sector, r.expediente, coalesce(r.monto_total, 0),
    coalesce(nullif(trim(r.moneda), ''), 'ARS'), r.fecha_acta_inicio,
    coalesce(r.plazo_dias, 0), r.fecha_vencimiento, r.proxima_certificacion,
    r.fecha_recepcion_documentacion, r.fecha_envio_planificacion,
    coalesce(nullif(trim(r.estado_coi), ''), 'Pendiente de completar'),
    r.estado_documental, coalesce(nullif(trim(r.estado_registro), ''), 'Activo'),
    r.observaciones, coalesce(r.certificable_con_saldo, false),
    r.justificacion_administrativa, r.link_documental_principal,
    r.estado_link_documental, r.calidad_datos_estado, r.calidad_datos_score,
    r.prioridad_operativa, r.responsable_coi, r.fecha_ultimo_control,
    coalesce(r.requiere_accion, false), r.motivo_requiere_accion,
    r.estado_envio_pyc, r.fecha_cierre_operativo, r.observacion_cierre,
    r.control_terceros_hasta, r.control_terceros_estado,
    coalesce(nullif(trim(r.modalidad_certificacion), ''), 'SIN_DEFINIR'),
    auth.uid(), clock_timestamp()
  from jsonb_populate_record(null::public.coi_ordenes, p_datos - 'saldo_remanente') r;

  insert into public.coi_ordenes_estaciones (
    orden_id, nro_oc, estacion, ramal, sector, tipo_alcance,
    descripcion_alcance, es_principal, estado
  ) values (
    v_order_id, v_nro_oc,
    coalesce(nullif(trim(p_datos ->> 'estacion'), ''), 'Sin definir'),
    nullif(trim(p_datos ->> 'ramal'), ''),
    nullif(trim(p_datos ->> 'sector'), ''),
    'Principal', 'Estacion principal del contrato', true, 'Activa'
  );

  perform public.coi_sync_order_balance(v_order_id);
  select to_jsonb(o.*) into v_after from public.coi_ordenes o where o.id = v_order_id;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_nuevos
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'CREAR_ORDEN_INTEGRAL', 'coi_ordenes', v_order_id::text,
    v_nro_oc, v_after
  );

  return jsonb_build_object('orden', v_after, 'accion', 'inserted', 'sin_cambios', false);
end;
$$;

-- Se reafirman los privilegios tal como estaban: anon sigue sin ejecutar.
revoke all on function public.coi_guardar_orden_integral(uuid, jsonb) from public, anon;
grant execute on function public.coi_guardar_orden_integral(uuid, jsonb) to authenticated;

commit;
