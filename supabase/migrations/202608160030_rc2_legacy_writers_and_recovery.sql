-- COI Linea Roca - cierre RC2 de compatibilidad operativa.
-- 1) Reconcilia reintentos financieros con key perdida tras logout/red.
-- 2) Mantiene writers legacy del frontend bajo RLS + guardas + auditoria,
--    sin reabrir INSERT/DELETE ni permitir renumeracion directa.

begin;

-- -------------------------------------------------------------------------
-- RECUPERACION IDEMPOTENTE SERVER-SIDE
-- Si una respuesta se pierde luego del COMMIT y el navegador pierde la key,
-- una solicitud identica del mismo usuario dentro de 30 minutos devuelve el
-- ledger ya confirmado en vez de consumir saldo por segunda vez.
-- -------------------------------------------------------------------------
create or replace function public.coi_certificar_posiciones_v2(
  p_movimientos jsonb,
  p_idempotency_key uuid,
  p_contexto jsonb default '{}'::jsonb
)
returns setof public.coi_consumos_posicion
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.coi_idempotency_requests%rowtype;
  v_recovery_key uuid;
  v_role text;
begin
  v_role := public.coi_assert_role(array['administrador', 'jefatura']);
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if jsonb_typeof(p_movimientos) <> 'array' or jsonb_array_length(p_movimientos) = 0 then
    raise exception using errcode = '22023', message = 'COI_MOVEMENTS_REQUIRED';
  end if;

  select * into v_request
    from public.coi_idempotency_requests
   where idempotency_key = p_idempotency_key
   for update;

  if found and (
    v_request.usuario_id is distinct from auth.uid()
    or v_request.operacion is distinct from 'CERTIFICAR_POSICIONES'
    or v_request.solicitud is distinct from p_movimientos
  ) then
    raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_SCOPE_CONFLICT';
  end if;

  -- Si la key es nueva, buscar una confirmacion reciente de EXACTAMENTE la
  -- misma solicitud y usuario. Solo cuenta como recuperable si existe ledger
  -- confirmado para esa key; requests fallidos no bloquean un nuevo intento.
  if not found then
    select r.idempotency_key
      into v_recovery_key
      from public.coi_idempotency_requests r
     where r.usuario_id = auth.uid()
       and r.operacion = 'CERTIFICAR_POSICIONES'
       and r.solicitud = p_movimientos
       and r.idempotency_key <> p_idempotency_key
       and r.creado_en >= clock_timestamp() - interval '30 minutes'
       and exists (
         select 1
           from public.coi_consumos_posicion c
          where c.idempotency_key = r.idempotency_key
            and c.estado = 'CONFIRMADA'
       )
     order by r.creado_en desc
     limit 1;

    if v_recovery_key is not null then
      insert into public.coi_operaciones_auditoria (
        usuario_id, usuario_email, rol, accion, entidad, registro_id,
        idempotency_key, datos_nuevos, contexto
      ) values (
        auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
        'RECONCILIAR_CERTIFICACION_IDEMPOTENTE', 'coi_consumos_posicion',
        v_recovery_key::text, p_idempotency_key,
        jsonb_build_object(
          'recovered_idempotency_key', v_recovery_key,
          'requested_idempotency_key', p_idempotency_key,
          'movimientos', p_movimientos
        ),
        coalesce(p_contexto, '{}'::jsonb) || jsonb_build_object('recovery_window_minutes', 30)
      ) on conflict do nothing;

      return query
        select c.*
          from public.coi_consumos_posicion c
         where c.idempotency_key = v_recovery_key
           and c.estado = 'CONFIRMADA'
         order by c.creado_en, c.id;
      return;
    end if;
  end if;

  return query
    select * from public.coi_certificar_posiciones(
      p_movimientos, p_idempotency_key, coalesce(p_contexto, '{}'::jsonb)
    );

  select * into v_request
    from public.coi_idempotency_requests
   where idempotency_key = p_idempotency_key
   for update;
  if not found
     or v_request.usuario_id is distinct from auth.uid()
     or v_request.operacion is distinct from 'CERTIFICAR_POSICIONES'
     or v_request.solicitud is distinct from p_movimientos then
    raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_SCOPE_CONFLICT';
  end if;
end;
$$;

revoke all on function public.coi_certificar_posiciones_v2(jsonb, uuid, jsonb) from public, anon;
grant execute on function public.coi_certificar_posiciones_v2(jsonb, uuid, jsonb) to authenticated;

-- -------------------------------------------------------------------------
-- COMPATIBILIDAD CONTROLADA PARA WRITERS LEGACY DEL HTML
-- La migracion 006 habia cerrado UPDATE de tabla antes de que todos los flujos
-- ejecutivos fueran migrados. Reabrimos SOLO UPDATE, manteniendo RLS y una
-- guarda de columnas. INSERT/DELETE siguen revocados y las RPC siguen siendo
-- la via preferente/nueva.
-- -------------------------------------------------------------------------
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
    'control_terceros_estado'
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

revoke all on function public.coi_direct_order_update_guard() from public, anon;
grant execute on function public.coi_direct_order_update_guard() to authenticated;

drop trigger if exists coi_direct_order_update_guard on public.coi_ordenes;
create trigger coi_direct_order_update_guard
before update on public.coi_ordenes
for each row execute function public.coi_direct_order_update_guard();

-- Auditoria server-side de la excepcion de compatibilidad. Asi incluso un
-- update PostgREST que no ejecute el historial JS queda trazado.
create or replace function public.coi_record_direct_order_update(
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  v_role := public.coi_current_role();
  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ACTUALIZAR_ORDEN_DIRECTO_COMPAT', 'coi_ordenes', p_after ->> 'id',
    p_after ->> 'nro_oc', p_before, p_after,
    jsonb_build_object('origen', 'frontend_legacy_postgrest', 'rc', 'RC2')
  );
end;
$$;

revoke all on function public.coi_record_direct_order_update(jsonb, jsonb) from public, anon;
grant execute on function public.coi_record_direct_order_update(jsonb, jsonb) to authenticated;

create or replace function public.coi_direct_order_update_audit()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user = 'authenticated' then
    perform public.coi_record_direct_order_update(to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;

revoke all on function public.coi_direct_order_update_audit() from public, anon;
grant execute on function public.coi_direct_order_update_audit() to authenticated;

drop trigger if exists coi_direct_order_update_audit on public.coi_ordenes;
create trigger coi_direct_order_update_audit
after update on public.coi_ordenes
for each row execute function public.coi_direct_order_update_audit();

-- Reabrir solamente UPDATE para el rol PostgREST. Las politicas RLS de 004
-- siguen restringiendo los roles funcionales y la guarda anterior restringe
-- columnas/renumeracion. INSERT y DELETE permanecen revocados por 006.
grant update on public.coi_ordenes to authenticated;
revoke insert, delete on public.coi_ordenes from authenticated;

commit;
