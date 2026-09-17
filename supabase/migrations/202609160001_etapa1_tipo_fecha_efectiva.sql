-- Etapa 1/2 — fecha efectiva editable y reglas por tipo de OC.
-- fecha_evento conserva el instante real de registración/auditoría.
-- fecha_efectiva representa la fecha administrativa elegida por el usuario.

alter table public.coi_historial_oc
  add column if not exists fecha_efectiva date;

comment on column public.coi_historial_oc.fecha_efectiva is
  'Fecha administrativa efectiva del hito. NULL en registros históricos: la UI usa fecha_evento como fallback. fecha_evento permanece como timestamp de registración.';

create or replace function public.coi_confirmar_etapa_circuito_v3(
  p_orden_id uuid,
  p_codigo text,
  p_observacion text default null,
  p_fecha_efectiva date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order public.coi_ordenes%rowtype;
  v_after public.coi_ordenes%rowtype;
  v_codigo text := lower(trim(coalesce(p_codigo,'')));
  v_nombre text;
  v_current text;
  v_seen boolean;
  v_gate_seen boolean;
  v_gate_legacy boolean;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_fecha date := coalesce(p_fecha_efectiva,(now() at time zone 'America/Argentina/Buenos_Aires')::date);
  v_result jsonb;
  v_history jsonb := '[]'::jsonb;
  v_conflicto public.coi_historial_oc%rowtype;
begin
  v_role := public.coi_assert_role(array[
    'administrador','jefatura','editor','planificacion','control','supervisor'
  ]);

  if p_orden_id is null then
    raise exception using errcode='22023',message='COI_INVALID_ORDER_ID';
  end if;
  if length(coalesce(p_observacion,'')) > 3000 then
    raise exception using errcode='22001',message='COI_CIRCUIT_OBSERVATION_TOO_LONG';
  end if;
  if v_fecha > v_hoy then
    raise exception using errcode='22007',message='COI_EFFECTIVE_DATE_FUTURE',detail=v_fecha::text;
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
    raise exception using errcode='22023',message='COI_UNKNOWN_CIRCUIT_STAGE',detail=v_codigo;
  end if;

  select * into v_order
    from public.coi_ordenes
   where id=p_orden_id
   for update;
  if not found then
    raise exception using errcode='P0002',message='COI_ORDER_NOT_FOUND';
  end if;

  -- Regla de negocio: una OBRA finalizada no utiliza saldo remanente como etapa.
  if v_codigo='finalizada_saldo_remanente'
     and upper(trim(coalesce(v_order.tipo,'')))='OBRA' then
    raise exception using errcode='23514',message='COI_STAGE_NOT_APPLICABLE_TO_TYPE',detail='finalizada_saldo_remanente:OBRA';
  end if;

  v_current := coalesce(v_order.estado_documental,v_order.estado_coi);
  select exists(
    select 1 from public.coi_historial_oc h
     where h.orden_id=p_orden_id
       and h.tipo_evento='Circuito administrativo'
       and h.campo_modificado=v_codigo
  ) into v_seen;

  -- Gate real: los estados de ejecución/cierre requieren Acta de Inicio.
  if v_codigo in ('ejecucion','finalizada','finalizada_actas','finalizada_saldo_remanente') then
    select exists(
      select 1 from public.coi_historial_oc h
       where h.orden_id=p_orden_id
         and h.tipo_evento='Circuito administrativo'
         and h.campo_modificado='control_terceros_con_acta'
    ) into v_gate_seen;
    v_gate_legacy := upper(trim(coalesce(v_current,''))) in (
      'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO',
      'PLIEGO CON OC Y CONTROL DE 3° CON ACTA DE INICIO',
      'OBRA/SERVICIO EN EJECUCIÓN','OBRA/SERVICIO EN EJECUCION',
      'OBRA/SERVICIO FINALIZADA',
      'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA',
      'OBRA/SERVICIO FINALIZADA PERO CON SALDO REMANENTE'
    );
    if v_order.fecha_acta_inicio is null and not v_gate_seen and not v_gate_legacy then
      raise exception using errcode='23514',message='COI_ACTA_INICIO_REQUIRED',detail=v_codigo;
    end if;
  end if;

  -- Se conserva la lógica canónica v2/base para estado, historial y auditoría.
  v_result := public.coi_confirmar_etapa_circuito_v2(p_orden_id,v_codigo,p_observacion);

  -- Toda fila de historial creada por esta confirmación recibe la fecha efectiva.
  if jsonb_typeof(coalesce(v_result->'historial','[]'::jsonb))='array' then
    update public.coi_historial_oc h
       set fecha_efectiva=v_fecha
     where h.id in (
       select nullif(x->>'id','')::uuid
         from jsonb_array_elements(coalesce(v_result->'historial','[]'::jsonb)) x
        where nullif(x->>'id','') is not null
     );

    select coalesce(jsonb_agg(to_jsonb(h) order by h.fecha_evento,h.id),'[]'::jsonb)
      into v_history
      from public.coi_historial_oc h
     where h.id in (
       select nullif(x->>'id','')::uuid
         from jsonb_array_elements(coalesce(v_result->'historial','[]'::jsonb)) x
        where nullif(x->>'id','') is not null
     );
    v_result := jsonb_set(v_result,'{historial}',coalesce(v_history,'[]'::jsonb),true);
  end if;

  -- Hito 8: la fecha elegida es la fecha administrativa del Acta de Inicio.
  -- Si ya existe un dato contractual distinto, no se pisa: queda conflicto auditable.
  if v_codigo='control_terceros_con_acta' then
    if v_order.fecha_acta_inicio is null then
      update public.coi_ordenes
         set fecha_acta_inicio=v_fecha
       where id=p_orden_id;
    elsif v_order.fecha_acta_inicio<>v_fecha then
      insert into public.coi_historial_oc(
        orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo,
        motivo,usuario_email,creado_por,fecha_efectiva
      ) values (
        p_orden_id,v_order.nro_oc,'Conciliación Acta de Inicio','fecha_acta_inicio',
        v_order.fecha_acta_inicio::text,v_fecha::text,'conflicto',
        nullif(auth.jwt()->>'email',''),auth.uid(),v_fecha
      ) returning * into v_conflicto;
      v_result := jsonb_set(
        v_result,'{historial}',coalesce(v_result->'historial','[]'::jsonb)||jsonb_build_array(to_jsonb(v_conflicto)),true
      );
    end if;
  end if;

  select * into v_after from public.coi_ordenes where id=p_orden_id;
  v_result := jsonb_set(v_result,'{orden}',to_jsonb(v_after),true);
  v_result := jsonb_set(v_result,'{fecha_efectiva}',to_jsonb(v_fecha),true);

  insert into public.coi_operaciones_auditoria(
    usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
    datos_anteriores,datos_nuevos,contexto
  ) values (
    auth.uid(),nullif(auth.jwt()->>'email',''),v_role,
    'CONFIRMAR_ETAPA_CIRCUITO_V3','coi_ordenes',p_orden_id::text,v_order.nro_oc,
    to_jsonb(v_order),to_jsonb(v_after),
    jsonb_build_object('codigo',v_codigo,'fecha_efectiva',v_fecha,'version_rpc','v3')
  );

  return v_result;
end;
$$;

comment on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) is
  'Confirma etapas del circuito con fecha administrativa efectiva editable. Mantiene fecha_evento como timestamp de registración, aplica gate de Acta y rechaza saldo remanente para OC tipo Obra.';

revoke all on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) from public;
revoke all on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) from anon;
grant execute on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) to authenticated;
grant execute on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) to service_role;
