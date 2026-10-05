-- COI Línea Roca · Security hardening · helper privado de auditoría
-- Fecha: 2026-10-05
-- El trigger AFTER UPDATE pasa a SECURITY DEFINER para poder invocar el helper
-- interno sin exponer ese helper como RPC ejecutable por authenticated.
-- El trigger sigue derivando OLD/NEW del motor; el cliente no puede fabricar
-- datos de auditoría arbitrarios llamando coi_record_direct_order_update.
-- No modifica datos operativos.

begin;

do $$
begin
  if to_regprocedure('public.coi_direct_order_update_audit()') is not null
     and to_regprocedure('public.coi_record_direct_order_update(jsonb,jsonb)') is not null then
    alter function public.coi_direct_order_update_audit() security definer;
    alter function public.coi_direct_order_update_audit() set search_path = public, pg_temp;

    revoke all on function public.coi_record_direct_order_update(jsonb,jsonb)
      from public, anon, authenticated;
  end if;
end $$;

commit;
