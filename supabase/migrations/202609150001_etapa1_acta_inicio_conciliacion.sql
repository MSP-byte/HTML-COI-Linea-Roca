-- 1° ETAPA — Acta de Inicio como gate contractual server-side.
-- Versionado únicamente: no aplicar automáticamente a entornos remotos.

create or replace function public.coi_conciliar_acta_inicio_etapa(
  p_orden_id uuid,
  p_codigo text,
  p_resultado jsonb,
  p_nueva boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acta_actual date;
  v_acta_confirmacion date;
  v_estado text;
  v_orden public.coi_ordenes%rowtype;
  v_marker public.coi_historial_oc%rowtype;
  v_marker_json jsonb;
  v_historial jsonb;
  v_ultimo_conflicto public.coi_historial_oc%rowtype;
begin
  if p_codigo <> 'control_terceros_con_acta' then
    return p_resultado;
  end if;

  select * into v_orden from public.coi_ordenes where id = p_orden_id;
  if not found then return p_resultado; end if;

  v_acta_actual := v_orden.fecha_acta_inicio;
  v_acta_confirmacion := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  if not p_nueva then
    if v_acta_actual is null then
      v_estado := 'legacy_sin_fecha';
    else
      -- Un retry/reingreso histórico NO se compara contra hoy. Si existía un
      -- conflicto persistido, se compara contra la fecha de confirmación
      -- original almacenada expresamente en ese marker, nunca contra fecha_evento.
      select * into v_ultimo_conflicto
        from public.coi_historial_oc h
       where h.orden_id = p_orden_id
         and h.tipo_evento = 'Conciliación Acta de Inicio'
         and h.campo_modificado = 'fecha_acta_inicio'
       order by h.fecha_evento desc, h.id desc
       limit 1;
      if found and lower(trim(coalesce(v_ultimo_conflicto.motivo,''))) = 'conflicto'
         and v_ultimo_conflicto.valor_nuevo is not null
         and v_acta_actual::text <> v_ultimo_conflicto.valor_nuevo then
        v_estado := 'conflicto';
        v_acta_confirmacion := v_ultimo_conflicto.valor_nuevo::date;
      else
        v_estado := 'coincide';
        if found and lower(trim(coalesce(v_ultimo_conflicto.motivo,''))) = 'conflicto' then
          insert into public.coi_historial_oc(
            orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo,
            motivo,usuario_email,creado_por
          ) values (
            p_orden_id,v_orden.nro_oc,'Conciliación Acta de Inicio','fecha_acta_inicio',
            v_ultimo_conflicto.valor_anterior,v_acta_actual::text,'coincide',
            nullif(auth.jwt()->>'email',''),auth.uid()
          ) returning * into v_marker;
        end if;
      end if;
    end if;
  elsif v_acta_actual is null then
    update public.coi_ordenes
       set fecha_acta_inicio = v_acta_confirmacion
     where id = p_orden_id;
    select * into v_orden from public.coi_ordenes where id = p_orden_id;
    v_estado := 'registrada';
  elsif v_acta_actual = v_acta_confirmacion then
    v_estado := 'coincide';
  else
    v_estado := 'conflicto';
    insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo,
      motivo,usuario_email,creado_por
    ) values (
      p_orden_id,v_orden.nro_oc,'Conciliación Acta de Inicio','fecha_acta_inicio',
      v_acta_actual::text,v_acta_confirmacion::text,'conflicto',
      nullif(auth.jwt()->>'email',''),auth.uid()
    ) returning * into v_marker;
  end if;

  if v_marker.id is not null then
    v_marker_json := to_jsonb(v_marker);
    v_historial := coalesce(p_resultado->'historial','[]'::jsonb) || jsonb_build_array(v_marker_json);
    p_resultado := jsonb_set(p_resultado,'{historial}',v_historial,true);
  end if;

  return jsonb_set(
    jsonb_set(p_resultado,'{orden}',to_jsonb(v_orden),true),
    '{acta_inicio}',
    jsonb_build_object(
      'estado',v_estado,
      'valor',v_orden.fecha_acta_inicio,
      'valor_confirmacion',v_acta_confirmacion
    ),true
  );
end;
$$;

create or replace function public.coi_confirmar_etapa_circuito_v2(
  p_orden_id uuid,
  p_codigo text,
  p_observacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order public.coi_ordenes%rowtype;
  v_codigo text := lower(trim(coalesce(p_codigo,'')));
  v_nombre text;
  v_current text;
  v_seen boolean;
  v_gate_seen boolean;
  v_gate_legacy boolean;
  v_result jsonb;
  v_history jsonb;
  v_after public.coi_ordenes%rowtype;
begin
  v_role := public.coi_assert_role(array[
    'administrador','jefatura','editor','planificacion','control','supervisor'
  ]);

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

  select * into v_order from public.coi_ordenes where id=p_orden_id for update;
  if not found then raise exception using errcode='P0002',message='COI_ORDER_NOT_FOUND'; end if;
  v_current := coalesce(v_order.estado_documental,v_order.estado_coi);

  select exists(
    select 1 from public.coi_historial_oc h
     where h.orden_id=p_orden_id and h.tipo_evento='Circuito administrativo'
       and h.campo_modificado=v_codigo
  ) into v_seen;

  -- Gate real: la UI puede orientar, pero PostgreSQL impide saltar a ejecución/cierre.
  if v_codigo in ('ejecucion','finalizada','finalizada_actas','finalizada_saldo_remanente') then
    select exists(
      select 1 from public.coi_historial_oc h
       where h.orden_id=p_orden_id and h.tipo_evento='Circuito administrativo'
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

  if upper(trim(coalesce(v_current,'')))=upper(trim(v_nombre)) and v_seen then
    v_result := jsonb_build_object(
      'orden',to_jsonb(v_order),'historial','[]'::jsonb,
      'codigo',v_codigo,'nombre',v_nombre,'ya_confirmada',true
    );
    return public.coi_conciliar_acta_inicio_etapa(p_orden_id,v_codigo,v_result,false);
  end if;

  v_result := public.coi_confirmar_etapa_circuito(p_orden_id,v_codigo,p_observacion);
  if coalesce((v_result->>'ya_confirmada')::boolean,false) then
    with inserted as (
      insert into public.coi_historial_oc(
        orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo,
        motivo,usuario_email,creado_por
      ) values
      (p_orden_id,v_order.nro_oc,'Circuito administrativo',v_codigo,v_current,v_nombre,
       coalesce(nullif(trim(coalesce(p_observacion,'')),''),'Reingreso a etapa previamente recorrida'),
       nullif(auth.jwt()->>'email',''),auth.uid()),
      (p_orden_id,v_order.nro_oc,'Cambio de estado contractual','estado_documental',v_current,v_nombre,
       'Reingreso contractual: '||v_nombre,nullif(auth.jwt()->>'email',''),auth.uid())
      returning *
    ) select coalesce(jsonb_agg(to_jsonb(inserted.*)),'[]'::jsonb) into v_history from inserted;

    insert into public.coi_operaciones_auditoria(
      usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
      datos_anteriores,datos_nuevos,contexto
    ) values (
      auth.uid(),nullif(auth.jwt()->>'email',''),v_role,'REINGRESAR_ETAPA_CIRCUITO',
      'coi_ordenes',p_orden_id::text,v_order.nro_oc,to_jsonb(v_order),v_result->'orden',
      jsonb_build_object('codigo',v_codigo)
    );
    v_result := jsonb_set(v_result,'{historial}',v_history,true);
    v_result := jsonb_set(v_result,'{ya_confirmada}','false'::jsonb,true);
  end if;

  -- Hito ya visto => nunca es una confirmación contractual nueva a efectos de fecha.
  v_result := public.coi_conciliar_acta_inicio_etapa(p_orden_id,v_codigo,v_result,not v_seen);

  -- La mutación automática de fecha_acta_inicio queda auditada explícitamente.
  if v_codigo='control_terceros_con_acta'
     and not v_seen
     and v_order.fecha_acta_inicio is null
     and nullif(v_result#>>'{orden,fecha_acta_inicio}','') is not null then
    select * into v_after from public.coi_ordenes where id=p_orden_id;
    insert into public.coi_operaciones_auditoria(
      usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
      datos_anteriores,datos_nuevos,contexto
    ) values (
      auth.uid(),nullif(auth.jwt()->>'email',''),v_role,'REGISTRAR_FECHA_ACTA_INICIO_ETAPA1',
      'coi_ordenes',p_orden_id::text,v_order.nro_oc,to_jsonb(v_order),to_jsonb(v_after),
      jsonb_build_object('codigo',v_codigo,'origen','confirmacion_hito_8')
    );
  end if;
  return v_result;
end;
$$;

comment on function public.coi_conciliar_acta_inicio_etapa(uuid,text,jsonb,boolean) is
  'Concilia fecha_acta_inicio sin inventar fechas históricas. Los conflictos se persisten como evidencia explícita en coi_historial_oc y un retry usa la confirmación original, no la fecha de hoy.';

revoke all on function public.coi_conciliar_acta_inicio_etapa(uuid,text,jsonb,boolean) from public;
revoke all on function public.coi_conciliar_acta_inicio_etapa(uuid,text,jsonb,boolean) from anon;
revoke all on function public.coi_conciliar_acta_inicio_etapa(uuid,text,jsonb,boolean) from authenticated;
