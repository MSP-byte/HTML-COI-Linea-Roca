-- COI Linea Roca
-- Fix RPC de renumeracion de OC.
--
-- Corrige tratamiento legacy de public.coi_servicios_tecnicos_um,
-- tabla que posee nro_oc pero no orden_id.
--
-- Identidad maestra:
--   coi_ordenes.id UUID
--
-- nro_oc:
--   identificador de negocio renumerable exclusivamente mediante esta RPC.

begin;

create or replace function public.coi_renumerar_oc(
  p_orden_id uuid,
  p_nuevo_nro_oc text,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_nro_anterior text;
  v_nro_nuevo text;
  v_before jsonb;
  v_after jsonb;
  v_count bigint;
  v_counts jsonb := '{}'::jsonb;
  v_motivo text;
begin

  -- ================================================================
  -- AUTORIZACION
  -- ================================================================

  v_role := public.coi_assert_role(array['administrador']);

  if p_orden_id is null then
    raise exception using
      errcode = '22023',
      message = 'COI_ORDER_ID_REQUIRED';
  end if;

  v_nro_nuevo := public.coi_normalize_order_number(p_nuevo_nro_oc);

  if v_nro_nuevo is null then
    raise exception using
      errcode = '22023',
      message = 'COI_NEW_ORDER_NUMBER_REQUIRED';
  end if;

  v_motivo := coalesce(
    nullif(trim(coalesce(p_motivo, '')), ''),
    'Correccion administrativa del numero de OC'
  );


  -- ================================================================
  -- LOCK DE LA ORDEN MAESTRA
  -- ================================================================

  select
    o.nro_oc,
    to_jsonb(o.*)
  into
    v_nro_anterior,
    v_before
  from public.coi_ordenes as o
  where o.id = p_orden_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'COI_ORDER_NOT_FOUND';
  end if;


  -- ================================================================
  -- IDEMPOTENCIA
  -- ================================================================

  if v_nro_nuevo = v_nro_anterior then
    return jsonb_build_object(
      'orden_id', p_orden_id,
      'nro_oc_anterior', v_nro_anterior,
      'nro_oc_nuevo', v_nro_nuevo,
      'sin_cambios', true
    );
  end if;


  -- ================================================================
  -- EVITAR COLISION CON OTRA OC
  -- ================================================================

  if exists (
    select 1
    from public.coi_ordenes as o
    where o.id <> p_orden_id
      and public.coi_normalize_order_number(o.nro_oc) = v_nro_nuevo
  ) then
    raise exception using
      errcode = '23505',
      message = 'COI_ORDER_NUMBER_ALREADY_EXISTS',
      detail = v_nro_nuevo;
  end if;


  -- ================================================================
  -- PREFLIGHT DE INTEGRIDAD
  --
  -- Para tablas modernas:
  -- si nro_oc anterior aparece asociado a OTRO UUID, abortamos.
  --
  -- Filas legacy con orden_id NULL pueden recuperarse por nro_oc.
  --
  -- coi_servicios_tecnicos_um queda fuera de este control porque
  -- estructuralmente no posee orden_id.
  -- ================================================================

  if
       exists (
         select 1
         from public.coi_alertas as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

    or exists (
         select 1
         from public.coi_certificaciones as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

    or exists (
         select 1
         from public.coi_consumos_posicion as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

    or exists (
         select 1
         from public.coi_documentos_oc as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

    or exists (
         select 1
         from public.coi_historial_oc as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

    or exists (
         select 1
         from public.coi_links_documentales as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

    or exists (
         select 1
         from public.coi_observaciones_oc as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

    or exists (
         select 1
         from public.coi_ordenes_estaciones as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

    or exists (
         select 1
         from public.coi_posiciones_oc as x
         where x.nro_oc = v_nro_anterior
           and x.orden_id is not null
           and x.orden_id <> p_orden_id
       )

  then
    raise exception using
      errcode = '23514',
      message = 'COI_RENUMBER_ORPHAN_REFERENCE',
      detail = v_nro_anterior,
      hint = 'Existe una referencia del nro_oc anterior asociada a otro orden_id.';
  end if;


  -- ================================================================
  -- CAMBIO DE LA ORDEN MAESTRA
  -- ================================================================

  update public.coi_ordenes as o
  set
    nro_oc = v_nro_nuevo,
    actualizado_por = auth.uid(),
    fecha_actualizacion = clock_timestamp()
  where o.id = p_orden_id;


  -- ================================================================
  -- SINCRONIZACION TABLAS UUID
  --
  -- También recuperamos registros legacy que posean:
  --   orden_id IS NULL + nro_oc anterior.
  -- ================================================================

  update public.coi_ordenes_estaciones as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_ordenes_estaciones', v_count);


  update public.coi_posiciones_oc as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_posiciones_oc', v_count);


  update public.coi_certificaciones as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_certificaciones', v_count);


  update public.coi_consumos_posicion as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_consumos_posicion', v_count);


  update public.coi_documentos_oc as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_documentos_oc', v_count);


  update public.coi_links_documentales as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_links_documentales', v_count);


  update public.coi_observaciones_oc as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_observaciones_oc', v_count);


  update public.coi_alertas as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_alertas', v_count);


  -- ================================================================
  -- TABLA LEGACY UM
  --
  -- No posee orden_id.
  -- Su vínculo contractual disponible es nro_oc.
  -- ================================================================

  update public.coi_servicios_tecnicos_um as um
  set nro_oc = v_nro_nuevo
  where um.nro_oc = v_nro_anterior;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_servicios_tecnicos_um', v_count);


  -- ================================================================
  -- HISTORIAL FUNCIONAL EXISTENTE
  --
  -- Se actualiza solamente el identificador denormalizado.
  -- No se alteran eventos ni valores históricos.
  -- ================================================================

  update public.coi_historial_oc as x
  set nro_oc = v_nro_nuevo
  where (
        x.orden_id = p_orden_id
        or (
          x.orden_id is null
          and x.nro_oc = v_nro_anterior
        )
      )
    and x.nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_historial_oc', v_count);


  -- ================================================================
  -- VERIFICACION POST-SINCRONIZACION
  -- ================================================================

  if
       exists (
         select 1
         from public.coi_ordenes_estaciones as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_posiciones_oc as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_certificaciones as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_consumos_posicion as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_documentos_oc as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_links_documentales as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_observaciones_oc as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_alertas as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_historial_oc as x
         where
              (
                x.orden_id = p_orden_id
                and x.nro_oc is distinct from v_nro_nuevo
              )
           or (
                x.orden_id is null
                and x.nro_oc = v_nro_anterior
              )
       )

    or exists (
         select 1
         from public.coi_servicios_tecnicos_um as um
         where um.nro_oc = v_nro_anterior
       )

  then
    raise exception using
      errcode = '23514',
      message = 'COI_RENUMBER_SYNC_FAILED';
  end if;


  -- ================================================================
  -- NUEVO EVENTO DE HISTORIAL
  -- ================================================================

  insert into public.coi_historial_oc (
    orden_id,
    nro_oc,
    tipo_evento,
    campo_modificado,
    valor_anterior,
    valor_nuevo,
    motivo,
    usuario_email,
    creado_por
  )
  values (
    p_orden_id,
    v_nro_nuevo,
    'Renumeracion de OC',
    'nro_oc',
    v_nro_anterior,
    v_nro_nuevo,
    v_motivo,
    nullif(auth.jwt() ->> 'email', ''),
    auth.uid()
  );


  -- ================================================================
  -- SNAPSHOT FINAL
  -- ================================================================

  select to_jsonb(o.*)
  into v_after
  from public.coi_ordenes as o
  where o.id = p_orden_id;


  -- ================================================================
  -- AUDITORIA INMUTABLE
  --
  -- No se modifican auditorias anteriores.
  -- ================================================================

  insert into public.coi_operaciones_auditoria (
    usuario_id,
    usuario_email,
    rol,
    accion,
    entidad,
    registro_id,
    nro_oc,
    datos_anteriores,
    datos_nuevos,
    contexto
  )
  values (
    auth.uid(),
    nullif(auth.jwt() ->> 'email', ''),
    v_role,
    'RENUMERAR_OC',
    'coi_ordenes',
    p_orden_id::text,
    v_nro_nuevo,
    v_before,
    v_after,
    jsonb_build_object(
      'nro_oc_anterior', v_nro_anterior,
      'nro_oc_nuevo', v_nro_nuevo,
      'motivo', v_motivo,
      'sincronizados', v_counts
    )
  );


  -- ================================================================
  -- RESULTADO
  -- ================================================================

  return jsonb_build_object(
    'orden_id', p_orden_id,
    'nro_oc_anterior', v_nro_anterior,
    'nro_oc_nuevo', v_nro_nuevo,
    'motivo', v_motivo,
    'sincronizados', v_counts,
    'orden', v_after,
    'sin_cambios', false
  );

end;
$$;


-- Reafirmamos superficie de ejecucion.

revoke all
on function public.coi_renumerar_oc(uuid, text, text)
from public, anon;

grant execute
on function public.coi_renumerar_oc(uuid, text, text)
to authenticated;


comment on function public.coi_renumerar_oc(uuid, text, text) is
'Renumeracion administrativa atomica de una OC por UUID. Sincroniza tablas modernas por orden_id y recupera relaciones legacy por nro_oc.';


commit;