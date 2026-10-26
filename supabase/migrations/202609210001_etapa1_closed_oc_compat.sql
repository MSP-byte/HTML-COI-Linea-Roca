-- Compatibilidad Etapa contractual ↔ H10 para OCs ya cerradas.
-- Una confirmación histórica/contractual posterior al cierre debe poder
-- escribirse en estado_documental e historial SIN reabrir estado_coi ni tocar
-- fecha_cierre_operativo/observacion_cierre, que H10 mantiene inmutables.

CREATE OR REPLACE FUNCTION public.coi_confirmar_etapa_circuito(p_orden_id uuid, p_codigo text, p_observacion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_anterior := coalesce(nullif(btrim(coalesce(v_orden.estado_documental, '')), ''), v_orden.estado_coi);

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
         estado_coi = case
           -- H10: una OC ya cerrada no se reabre al registrar/backfillear
           -- hitos contractuales. El pipeline sigue avanzando por
           -- estado_documental + historial, mientras estado_coi conserva
           -- el cierre operativo inmutable.
           when upper(btrim(coalesce(o.estado_coi, ''))) in ('CERRADA','CERRADO')
             or o.fecha_cierre_operativo is not null
             or upper(btrim(coalesce(o.estado_registro, ''))) = 'CERRADO'
           then o.estado_coi
           else v_nombre
         end,
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
$function$;

comment on function public.coi_confirmar_etapa_circuito(uuid,text,text) is
  'Writer interno del circuito contractual. En OCs ya cerradas conserva estado_coi y permite registrar el hito en estado_documental/historial sin violar H10.';

revoke all on function public.coi_confirmar_etapa_circuito(uuid,text,text) from public;
revoke all on function public.coi_confirmar_etapa_circuito(uuid,text,text) from anon;
revoke all on function public.coi_confirmar_etapa_circuito(uuid,text,text) from authenticated;
