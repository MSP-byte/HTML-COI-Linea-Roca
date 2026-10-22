-- COI Línea Roca · Security Hardening V2 · 2026-10-22
-- Mitiga falsificación de auditoría mediante la RPC legacy.
-- Mantiene el writer directo de compatibilidad existente, sus grants, triggers
-- y la misma auditoría para UPDATE auténticos. No escribe datos operativos.
-- La firma antigua NO existe en algunos STAGING; en ese caso es NO-OP.
--
-- Rollback: restaurar definición anterior de la función desde el respaldo
-- de pg_get_functiondef capturado antes del despliegue. No deshabilitar triggers.
BEGIN;

DO $outer$
BEGIN
  IF to_regprocedure('public.coi_record_direct_order_update(jsonb,jsonb)') IS NOT NULL THEN
    EXECUTE $create$
      CREATE OR REPLACE FUNCTION public.coi_record_direct_order_update(
        p_before jsonb, p_after jsonb
      ) RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, pg_temp
      AS $body$
      DECLARE v_role text;
      BEGIN
        -- PostgREST invoca RPC con profundidad de trigger cero. Sólo el trigger
        -- propio del UPDATE puede registrar sus OLD/NEW. Mantiene compatibilidad
        -- con el writer legacy mientras ese flujo se migra a RPC.
        IF pg_trigger_depth() < 1 OR auth.uid() IS NULL THEN
          RAISE EXCEPTION USING errcode = '42501', message = 'COI_AUDIT_TRIGGER_ONLY';
        END IF;
        IF p_before IS NULL OR p_after IS NULL
           OR jsonb_typeof(p_before) <> 'object'
           OR jsonb_typeof(p_after) <> 'object'
           OR p_before->>'id' IS DISTINCT FROM p_after->>'id'
           OR nullif(p_before->>'id','') IS NULL THEN
          RAISE EXCEPTION USING errcode = '22023', message = 'COI_AUDIT_INVALID_TRANSITION';
        END IF;

        v_role := public.coi_current_role();
        IF v_role IS NULL THEN
          RAISE EXCEPTION USING errcode = '42501', message = 'COI_ROLE_REQUIRED';
        END IF;

        INSERT INTO public.coi_operaciones_auditoria (
          usuario_id, usuario_email, rol, accion, entidad, registro_id,
          nro_oc, datos_anteriores, datos_nuevos, contexto
        ) VALUES (
          auth.uid(), nullif(auth.jwt()->>'email',''), v_role,
          'ACTUALIZAR_ORDEN_DIRECTO_COMPAT', 'coi_ordenes', p_after->>'id',
          p_after->>'nro_oc', p_before, p_after,
          jsonb_build_object('origen','frontend_legacy_postgrest','rc','RC2')
        );
      END;
      $body$;
    $create$;

    -- El trigger legacy (SECURITY INVOKER) requiere EXECUTE del helper. El
    -- guard de pg_trigger_depth impide invocación directa, no rompe el trigger.
    REVOKE EXECUTE ON FUNCTION public.coi_record_direct_order_update(jsonb,jsonb)
      FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.coi_record_direct_order_update(jsonb,jsonb)
      TO authenticated;
  END IF;
END
$outer$;

COMMIT;
