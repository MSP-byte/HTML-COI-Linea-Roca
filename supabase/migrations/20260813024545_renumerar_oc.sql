-- COI Linea Roca
-- Renumeracion transaccional y auditable de Ordenes de Compra.
--
-- Objetivo:
-- - mantener coi_ordenes.id (UUID) como identidad inmutable;
-- - permitir corregir nro_oc solamente mediante RPC administrativa;
-- - sincronizar el nro_oc denormalizado de todas las entidades operativas;
-- - preservar backups y auditoria historica;
-- - registrar explicitamente el cambio viejo -> nuevo.
--
-- PRECONDICION:
-- Migraciones 001-006 aplicadas.

begin;

-- =========================================================================
-- 1. AJUSTE CONTROLADO DEL GUARD DE POSICIONES
-- =========================================================================
--
-- La posicion sigue teniendo identidad inmutable:
--   id
--   orden_id
--   posicion
--
-- nro_oc NO puede cambiar arbitrariamente.
-- Solamente puede sincronizarse con el nro_oc vigente de su orden padre.

create or replace function public.coi_position_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nro_oc text;
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.orden_id is distinct from old.orden_id
    or new.posicion is distinct from old.posicion
  ) then
    raise exception using
      errcode = '23514',
      message = 'COI_POSITION_IDENTITY_IMMUTABLE';
  end if;

  select o.nro_oc
    into v_nro_oc
    from public.coi_ordenes o
   where o.id = new.orden_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'COI_POSITION_ORDER_NOT_FOUND';
  end if;

  if tg_op = 'INSERT' then
    new.nro_oc := v_nro_oc;
    new.posicion := upper(trim(replace(new.posicion, ',', '.')));

    if nullif(new.posicion, '') is null then
      raise exception using
        errcode = '23514',
        message = 'COI_POSITION_NUMBER_REQUIRED';
    end if;

  else
    -- Si alguien intenta escribir manualmente otro nro_oc que no sea
    -- exactamente el nro_oc de la orden padre, se rechaza.
    if new.nro_oc is distinct from old.nro_oc
       and new.nro_oc is distinct from v_nro_oc then
      raise exception using
        errcode = '23514',
        message = 'COI_POSITION_ORDER_NUMBER_IMMUTABLE';
    end if;

    -- Autoriza exclusivamente la sincronizacion con la orden padre.
    new.nro_oc := v_nro_oc;
  end if;

  return new;
end;
$$;


-- =========================================================================
-- 2. RPC ADMINISTRATIVA DE RENUMERACION
-- =========================================================================

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

  -- -----------------------------------------------------------------------
  -- AUTORIZACION
  -- -----------------------------------------------------------------------

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


  -- -----------------------------------------------------------------------
  -- LOCK DE LA ORDEN MAESTRA
  -- -----------------------------------------------------------------------

  select
    o.nro_oc,
    to_jsonb(o.*)
    into
      v_nro_anterior,
      v_before
  from public.coi_ordenes o
  where o.id = p_orden_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'COI_ORDER_NOT_FOUND';
  end if;


  -- Idempotencia natural.
  if v_nro_nuevo = v_nro_anterior then
    return jsonb_build_object(
      'orden_id', p_orden_id,
      'nro_oc_anterior', v_nro_anterior,
      'nro_oc_nuevo', v_nro_nuevo,
      'sin_cambios', true
    );
  end if;


  -- -----------------------------------------------------------------------
  -- EVITAR COLISION CON OTRA OC
  -- -----------------------------------------------------------------------

  if exists (
    select 1
      from public.coi_ordenes o
     where o.id <> p_orden_id
       and public.coi_normalize_order_number(o.nro_oc) = v_nro_nuevo
  ) then
    raise exception using
      errcode = '23505',
      message = 'COI_ORDER_NUMBER_ALREADY_EXISTS',
      detail = v_nro_nuevo;
  end if;


  -- -----------------------------------------------------------------------
  -- PREFLIGHT DE REFERENCIAS
  -- -----------------------------------------------------------------------
  --
  -- Si aparece el mismo nro_oc asociado a otro UUID o sin UUID,
  -- detenemos toda la operacion. No corregimos inconsistencias de oficio.

  if
       exists (
         select 1 from public.coi_alertas
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_certificaciones
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_consumos_posicion
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_documentos_oc
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_historial_oc
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_links_documentales
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_observaciones_oc
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_ordenes_estaciones
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_posiciones_oc
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
    or exists (
         select 1 from public.coi_servicios_tecnicos_um
          where nro_oc = v_nro_anterior
            and orden_id is distinct from p_orden_id
       )
  then
    raise exception using
      errcode = '23514',
      message = 'COI_RENUMBER_ORPHAN_REFERENCE',
      detail = v_nro_anterior,
      hint = 'Existe al menos una referencia operativa del nro_oc asociada a otro orden_id o sin orden_id.';
  end if;


  -- -----------------------------------------------------------------------
  -- CAMBIO DE LA ORDEN MAESTRA
  -- -----------------------------------------------------------------------

  update public.coi_ordenes
     set nro_oc = v_nro_nuevo,
         actualizado_por = auth.uid(),
         fecha_actualizacion = clock_timestamp()
   where id = p_orden_id;


  -- -----------------------------------------------------------------------
  -- SINCRONIZACION DE TABLAS OPERATIVAS
  -- -----------------------------------------------------------------------

  update public.coi_ordenes_estaciones
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_ordenes_estaciones', v_count);


  update public.coi_posiciones_oc
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_posiciones_oc', v_count);


  update public.coi_certificaciones
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_certificaciones', v_count);


  update public.coi_consumos_posicion
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_consumos_posicion', v_count);


  update public.coi_documentos_oc
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_documentos_oc', v_count);


  update public.coi_links_documentales
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_links_documentales', v_count);


  update public.coi_observaciones_oc
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_observaciones_oc', v_count);


  update public.coi_alertas
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_alertas', v_count);


  update public.coi_servicios_tecnicos_um
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_servicios_tecnicos_um', v_count);


  -- Historial:
  -- sincronizamos solamente el identificador denormalizado nro_oc.
  -- Los eventos, fechas, valores anteriores/nuevos y motivos NO se alteran.

  update public.coi_historial_oc
     set nro_oc = v_nro_nuevo
   where orden_id = p_orden_id
     and nro_oc is distinct from v_nro_nuevo;

  get diagnostics v_count = row_count;
  v_counts := v_counts ||
    jsonb_build_object('coi_historial_oc', v_count);


  -- -----------------------------------------------------------------------
  -- VERIFICACION POST-SINCRONIZACION
  -- -----------------------------------------------------------------------

  if
       exists (
         select 1 from public.coi_ordenes_estaciones
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_posiciones_oc
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_certificaciones
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_consumos_posicion
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_documentos_oc
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_links_documentales
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_observaciones_oc
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_alertas
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_servicios_tecnicos_um
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
    or exists (
         select 1 from public.coi_historial_oc
          where orden_id = p_orden_id
            and nro_oc is distinct from v_nro_nuevo
       )
  then
    raise exception using
      errcode = '23514',
      message = 'COI_RENUMBER_SYNC_FAILED';
  end if;


  -- -----------------------------------------------------------------------
  -- REGISTRO EN HISTORIAL FUNCIONAL
  -- -----------------------------------------------------------------------

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
  ) values (
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


  -- -----------------------------------------------------------------------
  -- AUDITORIA INMUTABLE
  -- -----------------------------------------------------------------------
  --
  -- NO se modifican operaciones de auditoria anteriores.
  -- Se agrega un nuevo evento con old/new.

  select to_jsonb(o.*)
    into v_after
    from public.coi_ordenes o
   where o.id = p_orden_id;


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
  ) values (
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


  -- -----------------------------------------------------------------------
  -- RESULTADO RPC
  -- -----------------------------------------------------------------------

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


-- =========================================================================
-- 3. PERMISOS
-- =========================================================================

revoke all
on function public.coi_renumerar_oc(uuid, text, text)
from public, anon;

grant execute
on function public.coi_renumerar_oc(uuid, text, text)
to authenticated;


comment on function public.coi_renumerar_oc(uuid, text, text) is
  'Renumeracion administrativa atomica de una OC preservando su UUID y sincronizando referencias operativas.';


commit;