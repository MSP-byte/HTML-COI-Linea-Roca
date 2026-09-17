-- Hardening final Etapa 1/2: fecha efectiva y writer canónico v3.
-- Incremental sobre 202609160001; seguro para staging ya migrado y producción.

alter table public.coi_historial_oc add column if not exists fecha_efectiva date;

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
  v_event public.coi_historial_oc%rowtype;
  v_event_before date;
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

  -- Edición idempotente de la confirmación vigente: cambia fecha_efectiva,
  -- pero fecha_evento permanece como evidencia inmutable de registración.
  if upper(trim(coalesce(v_current,'')))=upper(trim(v_nombre)) and v_seen then
    select * into v_event
      from public.coi_historial_oc h
     where h.orden_id=p_orden_id
       and h.tipo_evento='Circuito administrativo'
       and h.campo_modificado=v_codigo
     order by h.fecha_evento desc,h.id desc
     limit 1
     for update;

    v_event_before := v_event.fecha_efectiva;
    update public.coi_historial_oc
       set fecha_efectiva=v_fecha
     where id=v_event.id
     returning * into v_event;

    v_history := jsonb_build_array(to_jsonb(v_event));
    v_result := jsonb_build_object(
      'orden',to_jsonb(v_order),'historial',v_history,
      'codigo',v_codigo,'nombre',v_nombre,'ya_confirmada',true
    );

    if v_event_before is distinct from v_fecha then
      insert into public.coi_operaciones_auditoria(
        usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
        datos_anteriores,datos_nuevos,contexto
      ) values (
        auth.uid(),nullif(auth.jwt()->>'email',''),v_role,
        'EDITAR_FECHA_EFECTIVA_CIRCUITO','coi_historial_oc',v_event.id::text,v_order.nro_oc,
        jsonb_build_object('fecha_efectiva',v_event_before),
        jsonb_build_object('fecha_efectiva',v_fecha),
        jsonb_build_object('codigo',v_codigo)
      );
    end if;
  else
    -- v3 usa directamente el writer base. No delega en v2 y por lo tanto
    -- nunca ejecuta una conciliación de Acta contra la fecha de hoy.
    v_result := public.coi_confirmar_etapa_circuito(p_orden_id,v_codigo,p_observacion);

    if coalesce((v_result->>'ya_confirmada')::boolean,false) then
      -- Reingreso a una etapa ya recorrida: evento nuevo, con su propia fecha efectiva.
      with inserted as (
        insert into public.coi_historial_oc(
          orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo,
          motivo,usuario_email,creado_por,fecha_efectiva
        ) values
        (p_orden_id,v_order.nro_oc,'Circuito administrativo',v_codigo,v_current,v_nombre,
         coalesce(nullif(trim(coalesce(p_observacion,'')),''),'Reingreso a etapa previamente recorrida'),
         nullif(auth.jwt()->>'email',''),auth.uid(),v_fecha),
        (p_orden_id,v_order.nro_oc,'Cambio de estado contractual','estado_documental',v_current,v_nombre,
         'Reingreso contractual: '||v_nombre,nullif(auth.jwt()->>'email',''),auth.uid(),v_fecha)
        returning *
      )
      select coalesce(jsonb_agg(to_jsonb(inserted.*) order by inserted.fecha_evento,inserted.id),'[]'::jsonb)
        into v_history
        from inserted;

      insert into public.coi_operaciones_auditoria(
        usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
        datos_anteriores,datos_nuevos,contexto
      ) values (
        auth.uid(),nullif(auth.jwt()->>'email',''),v_role,'REINGRESAR_ETAPA_CIRCUITO',
        'coi_ordenes',p_orden_id::text,v_order.nro_oc,to_jsonb(v_order),v_result->'orden',
        jsonb_build_object('codigo',v_codigo,'fecha_efectiva',v_fecha)
      );
      v_result := jsonb_set(v_result,'{historial}',v_history,true);
      v_result := jsonb_set(v_result,'{ya_confirmada}','false'::jsonb,true);
    else
      -- Primera confirmación: completa fecha_efectiva sólo en las filas creadas
      -- por esta llamada, sin tocar fecha_evento.
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
  end if;

  -- Hito 8: la fecha seleccionada gobierna la conciliación del Acta.
  if v_codigo='control_terceros_con_acta' then
    if v_order.fecha_acta_inicio is null then
      update public.coi_ordenes
         set fecha_acta_inicio=v_fecha
       where id=p_orden_id;
      v_result := jsonb_set(
        v_result,'{acta_inicio}',
        jsonb_build_object('estado','registrada','valor',v_fecha,'valor_confirmacion',v_fecha),true
      );

      select * into v_after from public.coi_ordenes where id=p_orden_id;
      insert into public.coi_operaciones_auditoria(
        usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
        datos_anteriores,datos_nuevos,contexto
      ) values (
        auth.uid(),nullif(auth.jwt()->>'email',''),v_role,'REGISTRAR_FECHA_ACTA_INICIO_ETAPA1',
        'coi_ordenes',p_orden_id::text,v_order.nro_oc,to_jsonb(v_order),to_jsonb(v_after),
        jsonb_build_object('codigo',v_codigo,'origen','confirmacion_hito_8','fecha_efectiva',v_fecha)
      );
    elsif v_order.fecha_acta_inicio=v_fecha then
      v_result := jsonb_set(
        v_result,'{acta_inicio}',
        jsonb_build_object('estado','coincide','valor',v_order.fecha_acta_inicio,'valor_confirmacion',v_fecha),true
      );
    else
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
      v_result := jsonb_set(
        v_result,'{acta_inicio}',
        jsonb_build_object('estado','conflicto','valor',v_order.fecha_acta_inicio,'valor_confirmacion',v_fecha),true
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
  'Writer contractual canónico con fecha administrativa efectiva auditable. No delega en v2; fecha_evento permanece inmutable.';

-- Un único writer de cliente: v3. v2/base quedan sólo como implementación interna del owner.
revoke all on function public.coi_confirmar_etapa_circuito_v2(uuid,text,text) from public;
revoke all on function public.coi_confirmar_etapa_circuito_v2(uuid,text,text) from anon;
revoke all on function public.coi_confirmar_etapa_circuito_v2(uuid,text,text) from authenticated;
revoke all on function public.coi_confirmar_etapa_circuito(uuid,text,text) from public;
revoke all on function public.coi_confirmar_etapa_circuito(uuid,text,text) from anon;
revoke all on function public.coi_confirmar_etapa_circuito(uuid,text,text) from authenticated;

revoke all on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) from public;
revoke all on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) from anon;
grant execute on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname='service_role') then
    execute 'grant execute on function public.coi_confirmar_etapa_circuito_v3(uuid,text,text,date) to service_role';
  end if;
end;
$$;
