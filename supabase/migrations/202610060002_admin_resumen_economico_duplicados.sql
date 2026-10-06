begin;

create or replace function public.coi_actualizar_resumen_economico_manual(
  p_orden_id uuid,
  p_monto_total numeric,
  p_avance_pct numeric
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
  v_ejecutado numeric;
  v_disponible numeric;
begin
  v_role := public.coi_assert_role(array['administrador']);

  if p_orden_id is null then
    raise exception using errcode='22023', message='COI_ORDER_ID_REQUIRED';
  end if;
  if p_monto_total is null or p_monto_total < 0 then
    raise exception using errcode='22023', message='COI_MANUAL_AMOUNT_INVALID';
  end if;
  if p_avance_pct is not null and (p_avance_pct < 0 or p_avance_pct > 100) then
    raise exception using errcode='22023', message='COI_MANUAL_PROGRESS_OUT_OF_RANGE';
  end if;

  select to_jsonb(o.*)
    into v_before
    from public.coi_ordenes o
   where o.id = p_orden_id
   for update;
  if not found then
    raise exception using errcode='P0002', message='COI_ORDER_NOT_FOUND';
  end if;

  update public.coi_ordenes o
     set monto_total = p_monto_total,
         avance_obra_pct = p_avance_pct,
         actualizado_por = auth.uid(),
         fecha_actualizacion = clock_timestamp()
   where o.id = p_orden_id;

  perform public.coi_sync_order_balance(p_orden_id);

  select to_jsonb(o.*)
    into v_after
    from public.coi_ordenes o
   where o.id = p_orden_id;

  if p_avance_pct is null then
    v_ejecutado := null;
    v_disponible := null;
  else
    v_ejecutado := round(p_monto_total * p_avance_pct / 100.0, 2);
    v_disponible := round(p_monto_total - v_ejecutado, 2);
  end if;

  insert into public.coi_operaciones_auditoria(
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt()->>'email',''), v_role,
    'ACTUALIZAR_RESUMEN_ECONOMICO_MANUAL', 'coi_ordenes', p_orden_id::text,
    coalesce(v_after->>'nro_oc',v_before->>'nro_oc'), v_before, v_after,
    jsonb_build_object(
      'origen','resumen_economico_manual',
      'monto_ejecutado_estimado',v_ejecutado,
      'monto_disponible_estimado',v_disponible
    )
  );

  return jsonb_build_object(
    'orden', v_after,
    'monto_total', p_monto_total,
    'avance_pct', p_avance_pct,
    'monto_ejecutado_estimado', v_ejecutado,
    'monto_disponible_estimado', v_disponible
  );
end;
$$;

revoke all on function public.coi_actualizar_resumen_economico_manual(uuid,numeric,numeric) from public, anon;
grant execute on function public.coi_actualizar_resumen_economico_manual(uuid,numeric,numeric) to authenticated;
do $grant_service_role$
begin
  if exists (select 1 from pg_roles where rolname='service_role') then
    execute 'grant execute on function public.coi_actualizar_resumen_economico_manual(uuid,numeric,numeric) to service_role';
  end if;
end
$grant_service_role$;

create or replace function public.coi_resolver_oc_duplicada(
  p_orden_duplicada_id uuid,
  p_orden_canonica_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_dup public.coi_ordenes%rowtype;
  v_canon public.coi_ordenes%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_note text;
begin
  v_role := public.coi_assert_role(array['administrador']);

  if p_orden_duplicada_id is null or p_orden_canonica_id is null
     or p_orden_duplicada_id = p_orden_canonica_id then
    raise exception using errcode='22023', message='COI_DUPLICATE_RESOLUTION_INVALID_IDS';
  end if;

  select * into v_dup
    from public.coi_ordenes
   where id = p_orden_duplicada_id
   for update;
  if not found then
    raise exception using errcode='P0002', message='COI_DUPLICATE_ORDER_NOT_FOUND';
  end if;

  select * into v_canon
    from public.coi_ordenes
   where id = p_orden_canonica_id
   for update;
  if not found then
    raise exception using errcode='P0002', message='COI_CANONICAL_ORDER_NOT_FOUND';
  end if;

  if coalesce(v_canon.estado_registro,'Activo') = 'Archivado' then
    raise exception using errcode='23514', message='COI_CANONICAL_ORDER_IS_ARCHIVED';
  end if;

  v_before := to_jsonb(v_dup);
  v_note := format(
    'Registro duplicado administrativo. OC conservada: %s.%s',
    v_canon.nro_oc,
    case when nullif(trim(coalesce(p_motivo,'')),'') is null
      then ''
      else ' Motivo: ' || trim(p_motivo)
    end
  );

  if coalesce(v_dup.estado_registro,'Activo') <> 'Archivado' then
    update public.coi_ordenes
       set estado_registro='Archivado',
           observaciones=concat_ws(E'\n',nullif(trim(coalesce(observaciones,'')),''),v_note),
           justificacion_administrativa=concat_ws(E'\n',nullif(trim(coalesce(justificacion_administrativa,'')),''),v_note),
           actualizado_por=auth.uid(),
           fecha_actualizacion=clock_timestamp()
     where id=p_orden_duplicada_id
     returning * into v_dup;

    insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,
      valor_anterior,valor_nuevo,motivo,usuario_email,creado_por,fecha_evento
    ) values (
      v_dup.id,v_dup.nro_oc,'Resolución de duplicado','estado_registro',
      coalesce(v_before->>'estado_registro','Activo'),'Archivado',
      v_note,nullif(auth.jwt()->>'email',''),auth.uid(),clock_timestamp()
    );
  end if;

  v_after := to_jsonb(v_dup);

  insert into public.coi_operaciones_auditoria(
    usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,
    datos_anteriores,datos_nuevos,contexto
  ) values (
    auth.uid(),nullif(auth.jwt()->>'email',''),v_role,
    'RESOLVER_OC_DUPLICADA','coi_ordenes',v_dup.id::text,v_dup.nro_oc,
    v_before,v_after,
    jsonb_build_object(
      'orden_canonica_id',v_canon.id,
      'orden_canonica_nro_oc',v_canon.nro_oc,
      'motivo',nullif(trim(coalesce(p_motivo,'')),'')
    )
  );

  return jsonb_build_object(
    'duplicada',v_after,
    'canonica',to_jsonb(v_canon),
    'archivada',coalesce(v_dup.estado_registro,'')='Archivado'
  );
end;
$$;

revoke all on function public.coi_resolver_oc_duplicada(uuid,uuid,text) from public, anon;
grant execute on function public.coi_resolver_oc_duplicada(uuid,uuid,text) to authenticated;
do $grant_service_role$
begin
  if exists (select 1 from pg_roles where rolname='service_role') then
    execute 'grant execute on function public.coi_resolver_oc_duplicada(uuid,uuid,text) to service_role';
  end if;
end
$grant_service_role$;

commit;
