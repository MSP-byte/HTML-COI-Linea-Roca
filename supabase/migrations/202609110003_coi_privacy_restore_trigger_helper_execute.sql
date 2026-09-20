-- COI Línea Roca · Trigger helper permission reconciliation
-- coi_record_direct_order_update es invocada por el trigger de auditoría sobre
-- coi_ordenes. authenticated necesita EXECUTE para que el trigger pueda completar
-- una actualización legítima. anon/public continúan revocados. No modifica datos.

begin;

do $$
begin
  if to_regprocedure('public.coi_record_direct_order_update(jsonb,jsonb)') is not null then
    revoke all on function public.coi_record_direct_order_update(jsonb,jsonb) from public, anon;
    grant execute on function public.coi_record_direct_order_update(jsonb,jsonb) to authenticated;
  end if;
end $$;

commit;
