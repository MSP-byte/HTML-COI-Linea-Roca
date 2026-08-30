-- =====================================================================
-- H03 — Defensa en profundidad para el borrado de OC con observaciones
-- =====================================================================
--
-- MOTIVO
--   public.coi_observaciones_oc.orden_id se creo en el baseline
--   202608090000_core_schema_baseline.sql con «on delete cascade», mientras que
--   public.coi_eliminar_orden_integral no incluye esa tabla en su lista de
--   dependencias comprobadas.
--
--   Combinacion resultante: un administrador puede eliminar una OC cuya unica
--   dependencia sean observaciones y la cascada las borra sin dejar rastro,
--   justo despues de que H03 declarase en la UI que las observaciones se
--   conservan por trazabilidad y no se borran.
--
--   Las demas dependencias de orden usan «on delete restrict» desde
--   202608100002_financial_ledger.sql y 202608100005_operational_integrity.sql
--   (coi_alertas, coi_certificaciones, coi_timeline_events, etc.): las
--   observaciones eran la excepcion, no el estandar.
--
-- ALCANCE
--   Dos capas independientes, para que ninguna dependa de la otra:
--
--     1) la FK deja de cascadear y pasa a RESTRICT, de modo que un DELETE
--        directo sobre coi_ordenes (fuera de la RPC, por SQL o por cualquier
--        camino futuro) falla en lugar de destruir observaciones;
--     2) la RPC canonica declara coi_observaciones_oc como dependencia, de modo
--        que el borrado integral la informa igual que a documentos o
--        certificaciones, con el mismo COI_ORDER_HAS_DEPENDENCIES.
--
--   No se recrea la tabla, no se copian filas y no se toca ningun dato: solo se
--   reemplaza la accion referencial en el catalogo y el cuerpo de la funcion.
--
--   La firma, el SECURITY DEFINER, el search_path, los grants, la auditoria y
--   el resto del comportamiento de la RPC se conservan EXACTAMENTE. El unico
--   cambio funcional es el elemento agregado al array de dependencias.
--
--   No se modifica 202608090000_core_schema_baseline.sql ni
--   202608160010_rc2_review_hardening.sql: ya estan mergeadas y las migraciones
--   aplicadas no se reescriben hacia atras.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: la FK solo se reemplaza si su accion todavia no es
--   RESTRICT, y «create or replace function» deja el mismo cuerpo.
--
-- ESTADO REMOTO
--   Esta migracion NO fue aplicada a produccion ni a staging. Mientras eso no
--   ocurra, tests/fixtures/production_schema_contract.json documenta la
--   divergencia deliberada en «_divergencias_pendientes».

-- ---------------------------------------------------------------------
-- 1) La FK de observaciones deja de cascadear.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'coi_observaciones_oc_orden_id_fkey'
       and conrelid = 'public.coi_observaciones_oc'::regclass
       and confdeltype <> 'r'
  ) then
    alter table public.coi_observaciones_oc
      drop constraint coi_observaciones_oc_orden_id_fkey;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'coi_observaciones_oc_orden_id_fkey'
       and conrelid = 'public.coi_observaciones_oc'::regclass
  ) then
    alter table public.coi_observaciones_oc
      add constraint coi_observaciones_oc_orden_id_fkey
      foreign key (orden_id) references public.coi_ordenes(id)
      on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) La RPC de borrado integral comprueba tambien las observaciones.
--    Cuerpo identico a 202608160010_rc2_review_hardening.sql salvo el
--    elemento agregado al array de dependencias.
-- ---------------------------------------------------------------------
create or replace function public.coi_eliminar_orden_integral(p_orden_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_before public.coi_ordenes%rowtype;
  v_dependencies jsonb := '{}'::jsonb;
  v_table text;
  v_count bigint;
  v_station_count bigint;
begin
  v_role := public.coi_assert_role(array['administrador']);
  if p_orden_id is null then
    raise exception using errcode = '22023', message = 'COI_INVALID_ORDER_ID';
  end if;

  select * into v_before
    from public.coi_ordenes o
   where o.id = p_orden_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  foreach v_table in array array[
    'coi_posiciones_oc', 'coi_consumos_posicion', 'coi_certificaciones',
    'coi_documentos_oc', 'coi_historial_oc', 'coi_links_documentales',
    'coi_auditorias_calidad', 'coi_timeline_events', 'coi_documentos_versiones',
    'coi_servicios_tecnicos_um', 'coi_observaciones_oc'
  ] loop
    v_count := public.coi_count_order_dependencies(v_table, p_orden_id, v_before.nro_oc);
    if v_count > 0 then
      v_dependencies := v_dependencies || jsonb_build_object(v_table, v_count);
    end if;
  end loop;

  if v_dependencies <> '{}'::jsonb then
    raise exception using
      errcode = '23503',
      message = 'COI_ORDER_HAS_DEPENDENCIES',
      detail = v_dependencies::text,
      hint = 'Conserve la OC para trazabilidad o elimine primero solo dependencias expresamente anulables.';
  end if;

  delete from public.coi_ordenes_estaciones oe where oe.orden_id = p_orden_id;
  get diagnostics v_station_count = row_count;

  delete from public.coi_ordenes o where o.id = p_orden_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND_DURING_DELETE';
  end if;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ELIMINAR_ORDEN_INTEGRAL', 'coi_ordenes', p_orden_id::text,
    v_before.nro_oc, to_jsonb(v_before),
    jsonb_build_object('estaciones_eliminadas', v_station_count)
  );

  return jsonb_build_object('deleted', to_jsonb(v_before), 'estaciones_eliminadas', v_station_count);
end;
$$;

revoke all on function public.coi_eliminar_orden_integral(uuid) from public, anon;
grant execute on function public.coi_eliminar_orden_integral(uuid) to authenticated;

comment on constraint coi_observaciones_oc_orden_id_fkey on public.coi_observaciones_oc is
  'RESTRICT: las observaciones son trazabilidad y no se destruyen por cascada al eliminar la OC.';
