begin;

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
  v_close_note text;
  v_old_closed boolean;
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
  v_close_note := 'Cierre administrativo excepcional por resolución de registro duplicado; no representa cierre operativo normal. ' || v_note;

  v_old_closed :=
    upper(btrim(coalesce(v_dup.estado_coi,''))) in ('CERRADA','CERRADO')
    or v_dup.fecha_cierre_operativo is not null
    or upper(btrim(coalesce(v_dup.estado_registro,''))) = 'CERRADO';

  if coalesce(v_dup.estado_registro,'Activo') <> 'Archivado' then
    if not v_old_closed then
      update public.coi_ordenes
         set estado_coi='Cerrada',
             fecha_cierre_operativo=current_date,
             observacion_cierre=v_close_note,
             observaciones=concat_ws(E'\n',nullif(trim(coalesce(observaciones,'')),''),v_note),
             justificacion_administrativa=concat_ws(E'\n',nullif(trim(coalesce(justificacion_administrativa,'')),''),v_note),
             actualizado_por=auth.uid(),
             fecha_actualizacion=clock_timestamp()
       where id=p_orden_duplicada_id
       returning * into v_dup;

      insert into public.coi_historial_oc(
        orden_id,nro_oc,tipo_evento,campo_modificado,
        valor_anterior,valor_nuevo,motivo,usuario_email,creado_por,fecha_evento,fecha_efectiva
      ) values (
        v_dup.id,v_dup.nro_oc,'Resolución de duplicado','estado_coi',
        coalesce(v_before->>'estado_coi',''),'Cerrada',
        v_close_note,nullif(auth.jwt()->>'email',''),auth.uid(),clock_timestamp(),current_date
      );
    end if;

    update public.coi_ordenes
       set estado_registro='Archivado',
           observaciones=case
             when position(v_note in coalesce(observaciones,''))>0 then observaciones
             else concat_ws(E'\n',nullif(trim(coalesce(observaciones,'')),''),v_note)
           end,
           justificacion_administrativa=case
             when position(v_note in coalesce(justificacion_administrativa,''))>0 then justificacion_administrativa
             else concat_ws(E'\n',nullif(trim(coalesce(justificacion_administrativa,'')),''),v_note)
           end,
           actualizado_por=auth.uid(),
           fecha_actualizacion=clock_timestamp()
     where id=p_orden_duplicada_id
     returning * into v_dup;

    insert into public.coi_historial_oc(
      orden_id,nro_oc,tipo_evento,campo_modificado,
      valor_anterior,valor_nuevo,motivo,usuario_email,creado_por,fecha_evento,fecha_efectiva
    ) values (
      v_dup.id,v_dup.nro_oc,'Resolución de duplicado','estado_registro',
      coalesce(v_before->>'estado_registro','Activo'),'Archivado',
      v_note,nullif(auth.jwt()->>'email',''),auth.uid(),clock_timestamp(),current_date
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
      'motivo',nullif(trim(coalesce(p_motivo,'')),''),
      'cierre_administrativo_excepcional',not v_old_closed
    )
  );

  return jsonb_build_object(
    'duplicada',v_after,
    'canonica',to_jsonb(v_canon),
    'archivada',coalesce(v_dup.estado_registro,'')='Archivado',
    'cierre_administrativo_excepcional',not v_old_closed
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
