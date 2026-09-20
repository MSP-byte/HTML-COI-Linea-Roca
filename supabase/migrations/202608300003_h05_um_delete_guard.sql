-- =====================================================================
-- H05 — Defensa de trazabilidad al borrar Unidades de Mantenimiento
-- =====================================================================
--
-- MOTIVO
--   public.coi_servicios_tecnicos_um.unidad_id fue creado con
--   ON DELETE CASCADE. Si una UM se elimina por SQL privilegiado o por un
--   camino futuro, todos sus servicios tecnicos desaparecen en silencio.
--
--   H05 convierte las Unidades de Mantenimiento en dato operativo
--   Supabase-first y debe conservar el historial tecnico. La UI no necesita
--   borrado fisico: una UM fuera de uso se conserva y pasa a estado BAJA.
--
-- ALCANCE
--   Solo cambia la accion referencial de la FK existente:
--     CASCADE -> RESTRICT
--
--   No recrea tablas, no copia filas, no elimina datos y no modifica RLS.
--   Las policies actuales ya carecen de DELETE para UM y ST; esta FK agrega
--   defensa en profundidad ante caminos privilegiados ajenos a RLS.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: solo reemplaza la FK si aun no es RESTRICT.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'coi_servicios_tecnicos_um_unidad_id_fkey'
       AND conrelid = 'public.coi_servicios_tecnicos_um'::regclass
       AND confdeltype <> 'r'
  ) THEN
    ALTER TABLE public.coi_servicios_tecnicos_um
      DROP CONSTRAINT coi_servicios_tecnicos_um_unidad_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'coi_servicios_tecnicos_um_unidad_id_fkey'
       AND conrelid = 'public.coi_servicios_tecnicos_um'::regclass
  ) THEN
    ALTER TABLE public.coi_servicios_tecnicos_um
      ADD CONSTRAINT coi_servicios_tecnicos_um_unidad_id_fkey
      FOREIGN KEY (unidad_id)
      REFERENCES public.coi_unidades_mantenimiento(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON CONSTRAINT coi_servicios_tecnicos_um_unidad_id_fkey
  ON public.coi_servicios_tecnicos_um IS
  'RESTRICT: los Servicios Tecnicos son historial de la UM y no se destruyen por cascada.';
