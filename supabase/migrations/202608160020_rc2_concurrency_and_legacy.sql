-- COI Linea Roca - RC2 follow-up de revision
-- Cierra concurrencia financiera, canonicalizacion historica y alias legacy.

begin;

-- -------------------------------------------------------------------------
-- 1) Serializar lotes financieros por OC antes de bloquear posiciones.
--    La RPC inserta/valida la solicitud idempotente antes de tomar locks de
--    posiciones. Este trigger adquiere advisory locks transaccionales en
--    orden deterministico, evitando el ciclo posicion A -> orden -> posicion B.
-- -------------------------------------------------------------------------
create or replace function public.coi_lock_financial_batch_orders()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  if upper(trim(coalesce(new.operacion, ''))) <> 'CERTIFICAR_POSICIONES' then
    return new;
  end if;

  if jsonb_typeof(new.solicitud) <> 'array' then
    raise exception using errcode = '22023', message = 'COI_INVALID_IDEMPOTENCY_REQUEST';
  end if;

  for v_order_id in
    select distinct p.orden_id
      from jsonb_array_elements(new.solicitud) item
      join public.coi_posiciones_oc p
        on p.id = nullif(trim(item ->> 'posicion_id'), '')::uuid
     where p.orden_id is not null
     order by p.orden_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_order_id::text, 7262026));
  end loop;

  return new;
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'COI_INVALID_POSITION_ID';
end;
$$;

revoke all on function public.coi_lock_financial_batch_orders() from public, anon, authenticated;
drop trigger if exists coi_idempotency_lock_financial_orders on public.coi_idempotency_requests;
create trigger coi_idempotency_lock_financial_orders
before insert on public.coi_idempotency_requests
for each row execute function public.coi_lock_financial_batch_orders();

-- -------------------------------------------------------------------------
-- 2) Canonicalizar numeros historicos ya soportados por la normalizacion.
--    Cada cambio mantiene sincronizadas todas las copias denormalizadas.
--    Una colision u orfandad aborta toda la migracion: nunca se fusionan OCs.
-- -------------------------------------------------------------------------
do $$
declare
  v_order record;
  v_new text;
begin
  for v_order in
    select o.id, o.nro_oc
      from public.coi_ordenes o
     where o.nro_oc is distinct from public.coi_normalize_order_number(o.nro_oc)
     order by o.id
     for update
  loop
    v_new := public.coi_normalize_order_number(v_order.nro_oc);
    if v_new is null then
      raise exception using
        errcode = '23514',
        message = 'COI_NONCANONICAL_ORDER_NUMBER_NOT_NORMALIZABLE',
        detail = coalesce(v_order.nro_oc, '<null>');
    end if;

    if exists (
      select 1 from public.coi_ordenes o
       where o.id <> v_order.id
         and public.coi_normalize_order_number(o.nro_oc) = v_new
    ) then
      raise exception using
        errcode = '23505',
        message = 'COI_CANONICALIZATION_COLLISION',
        detail = v_new;
    end if;

    -- El guard de dependencias instalado por 202608160010 valida el destino.
    update public.coi_ordenes
       set nro_oc = v_new,
           fecha_actualizacion = clock_timestamp()
     where id = v_order.id;

    update public.coi_ordenes_estaciones x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_posiciones_oc x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_certificaciones x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_consumos_posicion x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_documentos_oc x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_links_documentales x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_observaciones_oc x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_alertas x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_historial_oc x set nro_oc = v_new
     where x.orden_id = v_order.id or (x.orden_id is null and x.nro_oc = v_order.nro_oc);
    update public.coi_servicios_tecnicos_um x set nro_oc = v_new
     where x.nro_oc = v_order.nro_oc;
  end loop;
end;
$$;

-- -------------------------------------------------------------------------
-- 3) El estado legacy enviada_pyc representa la misma etapa operativa que
--    finalizada_saldo_remanente. Canonicalizamos solamente el codigo tecnico
--    del evento; no se altera fecha, usuario, motivo ni valores historicos.
-- -------------------------------------------------------------------------
update public.coi_historial_oc
   set campo_modificado = 'finalizada_saldo_remanente'
 where tipo_evento = 'Circuito administrativo'
   and campo_modificado = 'enviada_pyc';

commit;
