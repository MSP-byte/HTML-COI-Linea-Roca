-- COI Línea Roca · desmarcado contractual auditable
-- Rollback operativo documentado en docs/agent/ROLLBACK_202610020001_contractual_unmark.md.
-- La migración es aditiva: no borra historial ni modifica filas existentes.
begin;

drop policy if exists coi_historial_anulacion_rpc_only_v1 on public.coi_historial_oc;
create policy coi_historial_anulacion_rpc_only_v1 on public.coi_historial_oc as restrictive
for insert to authenticated
with check (
  lower(btrim(tipo_evento)) <> 'anulación circuito administrativo'
);

create or replace function public.coi_anular_etapa_circuito_v1(
  p_orden_id uuid,
  p_codigo text,
  p_motivo text default null
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
  v_target public.coi_historial_oc%rowtype;
  v_prev public.coi_historial_oc%rowtype;
  v_event public.coi_historial_oc%rowtype;
  v_codigo text := lower(trim(coalesce(p_codigo, '')));
  v_nombre text;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_historial jsonb := '[]'::jsonb;
  v_anuladas integer := 0;
  v_cerrada boolean := false;
begin
  v_role := public.coi_assert_role(array[
    'administrador','jefatura','editor','planificacion','control','supervisor'
  ]);

  if p_orden_id is null then
    raise exception using errcode='22023', message='COI_INVALID_ORDER_ID';
  end if;
  if length(coalesce(p_motivo,'')) > 3000 then
    raise exception using errcode='22001', message='COI_CIRCUIT_UNMARK_REASON_TOO_LONG';
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
    raise exception using errcode='22023', message='COI_UNKNOWN_CIRCUIT_STAGE', detail=v_codigo;
  end if;

  select * into v_order
    from public.coi_ordenes
   where id = p_orden_id
   for update;
  if not found then
    raise exception using errcode='P0002', message='COI_ORDER_NOT_FOUND';
  end if;
  v_cerrada := lower(trim(coalesce(v_order.estado_coi,''))) = 'cerrada';

  for v_target in
    select h.*
      from public.coi_historial_oc h
     where h.orden_id = p_orden_id
       and h.tipo_evento = 'Circuito administrativo'
       and h.campo_modificado = v_codigo
       and not exists (
         select 1
           from public.coi_historial_oc a
          where a.orden_id = p_orden_id
            and a.tipo_evento = 'Anulación circuito administrativo'
            and a.valor_anterior = h.id::text
       )
     order by h.fecha_evento, h.id
     for update
  loop
    insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,valor_anterior,valor_nuevo,
      motivo,usuario_email,creado_por,fecha_efectiva
    ) values (
      p_orden_id,v_order.nro_oc,'Anulación circuito administrativo',v_codigo,
      v_target.id::text,v_nombre,
      coalesce(nullif(trim(coalesce(p_motivo,'')),''),'Hito desmarcado por el operador'),
      nullif(auth.jwt()->>'email',''),auth.uid(),v_hoy
    )
    returning * into v_event;

    v_historial := v_historial || jsonb_build_array(to_jsonb(v_event));
    v_anuladas := v_anuladas + 1;
  end loop;

  if v_anuladas = 0 then
    return jsonb_build_object(
      'orden',to_jsonb(v_order),'historial','[]'::jsonb,
      'codigo',v_codigo,'nombre',v_nombre,'ya_anulada',true,'anuladas',0
    );
  end if;

  -- Última transición contractual activa: canónica o legacy.
  -- Un espejo legacy asociado a una canónica anulada tampoco puede revivirla.
  select h.* into v_prev
    from public.coi_historial_oc h
   where h.orden_id = p_orden_id
     and (
       (
         h.tipo_evento = 'Circuito administrativo'
         and not exists (
           select 1
             from public.coi_historial_oc a
            where a.orden_id = p_orden_id
              and a.tipo_evento = 'Anulación circuito administrativo'
              and a.valor_anterior = h.id::text
         )
       )
       or
       (
         h.tipo_evento = 'Cambio de estado contractual'
         and not exists (
           select 1
             from public.coi_historial_oc c
             join public.coi_historial_oc a
               on a.orden_id = c.orden_id
              and a.tipo_evento = 'Anulación circuito administrativo'
              and a.valor_anterior = c.id::text
            where c.orden_id = h.orden_id
              and c.tipo_evento = 'Circuito administrativo'
              and lower(trim(coalesce(c.valor_nuevo,''))) = lower(trim(coalesce(h.valor_nuevo,'')))
              and abs(extract(epoch from (c.fecha_evento - h.fecha_evento))) <= 5
         )
       )
     )
   order by h.fecha_evento desc, h.id desc
   limit 1;

  update public.coi_ordenes
     set estado_documental = case when v_prev.id is null then null else v_prev.valor_nuevo end,
         estado_coi = case
           when v_cerrada then v_order.estado_coi
           when v_prev.id is null then 'Pendiente de completar'
           else v_prev.valor_nuevo
         end,
         fecha_ultimo_control = clock_timestamp()
   where id = p_orden_id
   returning * into v_after;

  insert into public.coi_operaciones_auditoria(
    usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
    datos_anteriores,datos_nuevos,contexto
  ) values (
    auth.uid(),nullif(auth.jwt()->>'email',''),v_role,
    'ANULAR_ETAPA_CIRCUITO','coi_ordenes',p_orden_id::text,v_order.nro_oc,
    to_jsonb(v_order),to_jsonb(v_after),
    jsonb_build_object(
      'codigo',v_codigo,
      'anuladas',v_anuladas,
      'motivo',nullif(trim(coalesce(p_motivo,'')),''),
      'estado_restaurado',v_after.estado_documental,
      'estado_operativo_preservado',v_cerrada
    )
  );

  return jsonb_build_object(
    'orden',to_jsonb(v_after),'historial',v_historial,
    'codigo',v_codigo,'nombre',v_nombre,'ya_anulada',false,'anuladas',v_anuladas
  );
end;
$$;

revoke all on function public.coi_anular_etapa_circuito_v1(uuid,text,text) from public, anon, authenticated;
grant execute on function public.coi_anular_etapa_circuito_v1(uuid,text,text) to authenticated;

comment on function public.coi_anular_etapa_circuito_v1(uuid,text,text) is
  'Desmarca de forma auditable todos los ingresos activos de un hito contractual, restaura el último estado contractual activo y preserva el cierre operativo inmutable.';

commit;
