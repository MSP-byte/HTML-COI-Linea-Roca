-- COI Línea Roca - Security Hardening V2 (2026-10-22)
-- Superficie P0: sólo RPC para cambios de orden y sin auditoría falsificable.
-- Sin cambios de datos, funciones de negocio, RLS ni contratos RPC.
-- STAGING puede no conservar el helper histórico; la migración es idempotente.
--
-- Evidencia previa:
--  * index.html usa las RPC coi_guardar_orden_integral/coi_actualizar_orden_integral.
--  * Los writers SQL de coi_ordenes accesibles por la app son SECURITY DEFINER
--    y validan rol interno; el cliente no necesita UPDATE directo.
--  * La función legacy de auditoría acepta JSON arbitrario; su EXECUTE directo
--    permite introducir eventos falsos. Al cerrar UPDATE ya no se debe invocar
--    desde un trigger de una operación cliente directa.
--
-- Rollback controlado (NO AUTOMATICO): solamente si una prueba demuestra una
-- dependencia necesaria, previa revisión de riesgo y trazabilidad:
--   GRANT UPDATE ON public.coi_ordenes TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.coi_record_direct_order_update(jsonb,jsonb)
--     TO authenticated; -- sólo si la firma existe; reabre la superficie riesgosa

BEGIN;

REVOKE UPDATE ON TABLE public.coi_ordenes FROM authenticated;

DO $coi_security$
BEGIN
  IF to_regprocedure('public.coi_record_direct_order_update(jsonb,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.coi_record_direct_order_update(jsonb,jsonb) FROM PUBLIC, anon, authenticated';
    IF has_function_privilege(
      'authenticated',
      'public.coi_record_direct_order_update(jsonb,jsonb)'::regprocedure,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'COI_SECURITY_V2_AUDIT_HELPER_EXPOSED';
    END IF;
  END IF;

  IF has_table_privilege('authenticated', 'public.coi_ordenes', 'UPDATE') THEN
    RAISE EXCEPTION 'COI_SECURITY_V2_DIRECT_ORDER_UPDATE_EXPOSED';
  END IF;
END
$coi_security$;

COMMIT;
