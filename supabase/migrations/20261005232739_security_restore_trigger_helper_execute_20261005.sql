-- COI Línea Roca · Security hardening · reconciliación helper de trigger
-- Fecha: 2026-10-05
-- coi_record_direct_order_update(jsonb,jsonb) participa del contrato del trigger
-- de auditoría de UPDATE directo. authenticated necesita EXECUTE para que una
-- actualización legítima pueda completar el trigger. public/anon siguen cerrados.
-- No modifica datos operativos.

begin;

do $$
begin
  if to_regprocedure('public.coi_record_direct_order_update(jsonb,jsonb)') is not null then
    revoke all on function public.coi_record_direct_order_update(jsonb,jsonb) from public, anon;
    grant execute on function public.coi_record_direct_order_update(jsonb,jsonb) to authenticated;
  end if;
end $$;

commit;
