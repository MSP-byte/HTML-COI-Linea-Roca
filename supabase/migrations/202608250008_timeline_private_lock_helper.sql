-- COI Linea Roca - aislar el helper privilegiado fuera del esquema expuesto.

begin;

create schema if not exists coi_private;
revoke all on schema coi_private from public, anon, authenticated;
grant usage on schema coi_private to authenticated;

create or replace function coi_private.coi_timeline_lock_orders(p_events jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.coi_assert_role(array[
    'administrador','jefatura','editor','planificacion','control','supervisor'
  ]);

  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception using errcode='22023', message='COI_TIMELINE_EVENTS_ARRAY_REQUIRED';
  end if;

  perform orders.id
    from public.coi_ordenes orders
   where orders.id in (
     select nullif(source.value ->> 'orden_id', '')::uuid
       from jsonb_array_elements(p_events) source
      where nullif(source.value ->> 'orden_id', '') is not null
   )
      or nullif(upper(regexp_replace(regexp_replace(
           trim(orders.nro_oc),
           '^(O(RDEN)?[[:space:]]*(DE[[:space:]]*)?C(OMPRA)?|OC)[[:space:]]*[:#-]?[[:space:]]*',
           '', 'i'
         ), '[^A-Z0-9]', '', 'g')), '') in (
        select nullif(upper(regexp_replace(regexp_replace(
                 trim(source.value ->> 'nro_oc'),
                 '^(O(RDEN)?[[:space:]]*(DE[[:space:]]*)?C(OMPRA)?|OC)[[:space:]]*[:#-]?[[:space:]]*',
                 '', 'i'
               ), '[^A-Z0-9]', '', 'g')), '')
          from jsonb_array_elements(p_events) source
         where nullif(source.value ->> 'orden_id', '') is null
      )
   order by orders.id
   for key share of orders;
end;
$$;

revoke all on function coi_private.coi_timeline_lock_orders(jsonb)
  from public, anon;
grant execute on function coi_private.coi_timeline_lock_orders(jsonb)
  to authenticated;

comment on function coi_private.coi_timeline_lock_orders(jsonb) is
  'Helper no expuesto que valida rol y toma locks ordenados de OC.';

-- La firma publica queda como wrapper INVOKER para compatibilidad con la 007.
-- No eleva privilegios ni queda señalada como RPC SECURITY DEFINER expuesta.
create or replace function public.coi_timeline_lock_orders(p_events jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform coi_private.coi_timeline_lock_orders(p_events);
end;
$$;

revoke all on function public.coi_timeline_lock_orders(jsonb)
  from public, anon;
grant execute on function public.coi_timeline_lock_orders(jsonb)
  to authenticated;

comment on function public.coi_timeline_lock_orders(jsonb) is
  'Wrapper invoker de compatibilidad para el helper privado de locks Timeline.';

notify pgrst, 'reload schema';

commit;
