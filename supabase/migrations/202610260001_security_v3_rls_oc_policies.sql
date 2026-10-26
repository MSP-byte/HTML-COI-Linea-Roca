-- COI Línea Roca · Security V3 · 2026-10-26
-- Corrige políticas permissive/OR legacy de OC y estaciones asociadas.
-- Cuando coexistían las políticas *_auth y las *_guard, la expresión RLS
-- era (rol_autorizado OR auth.uid() IS NOT NULL / true).
-- No revoca GRANT ni modifica datos: sólo elimina los bypasses.
-- Antes de aplicar: verificar funciones coi_current_role() y pruebas del PR.
BEGIN;

DO $coi_rls$
DECLARE
  v_table text;
  v_command text;
  v_policy text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['coi_ordenes','coi_ordenes_estaciones']
  LOOP
    IF to_regclass(format('public.%I',v_table)) IS NULL THEN
      RAISE EXCEPTION 'COI_RLS_TABLE_MISSING: %',v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'COI_RLS_DISABLED: %',v_table;
    END IF;
    -- Se aborta atómicamente si las reglas protegidas no existen:
    -- nunca eliminar el fallback antes de confirmar las guardas.
    FOREACH v_command IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename=v_table AND cmd=v_command
          AND (
            coalesce(qual,'') LIKE '%coi_current_role()%'
            OR coalesce(with_check,'') LIKE '%coi_current_role()%'
          )
      ) THEN
        RAISE EXCEPTION 'COI_RLS_ROLE_GUARD_MISSING: %.%',v_table,v_command;
      END IF;
    END LOOP;

    FOREACH v_policy IN ARRAY ARRAY[
      v_table || '_select_auth',
      v_table || '_insert_auth',
      v_table || '_update_auth',
      v_table || '_delete_admin'
    ]
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',v_policy,v_table);
      IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename=v_table AND policyname=v_policy
      ) THEN
        RAISE EXCEPTION 'COI_RLS_LEGACY_POLICY_REMAINS: %.%',v_table,v_policy;
      END IF;
    END LOOP;
  END LOOP;
END
$coi_rls$;
COMMIT;
