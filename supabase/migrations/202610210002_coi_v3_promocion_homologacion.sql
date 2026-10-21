-- COI V3. Proceso de promoción STAGING->PRODUCCION y homologación documentada.
-- FWD-only; tablas nuevas. Nunca modificar coi_ordenes ni coi_certificaciones.
-- Orden requerido: migraciones 202610160001, 202610190001 y 202610210001.
BEGIN;
CREATE TABLE IF NOT EXISTS public.coi_v3_promociones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 proyecto_origen text NOT NULL CHECK (proyecto_origen='brmrroikctfbtzwfewan'),
 huella_snapshot text NOT NULL UNIQUE CHECK (huella_snapshot ~ '^[a-f0-9]{64}$'),
 total_carteras integer NOT NULL CHECK (total_carteras=133),
 total_lotes integer NOT NULL CHECK (total_lotes=6),
 total_items integer NOT NULL CHECK (total_items=399),
 estado text NOT NULL DEFAULT 'SIN_HOMOLOGAR' CHECK (estado='SIN_HOMOLOGAR'),
 ejecutado_por uuid NOT NULL REFERENCES auth.users(id),
 ejecutado_en timestamptz NOT NULL DEFAULT now(),
 observacion text NOT NULL DEFAULT 'Importación histórica sin vínculos contractuales'
);
CREATE TABLE IF NOT EXISTS public.coi_v3_procedencia (
 clase text NOT NULL CHECK (clase IN ('cartera','lote')),
 registro_id uuid NOT NULL,
 promocion_id uuid NOT NULL REFERENCES public.coi_v3_promociones(id) ON DELETE RESTRICT,
 usuario_origen_creador uuid,
 usuario_origen_modificador uuid,
 origen_creado_en timestamptz,
 origen_actualizado_en timestamptz,
 registrado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (clase, registro_id)
);
CREATE TABLE IF NOT EXISTS public.coi_v3_homologaciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cartera_id uuid NOT NULL REFERENCES public.coi_v3_cartera(id) ON DELETE RESTRICT,
 orden_id uuid NOT NULL REFERENCES public.coi_ordenes(id) ON DELETE RESTRICT,
 huella_cartera text NOT NULL,
 nro_oc text NOT NULL,
 referencia_documental text NOT NULL CHECK (length(btrim(referencia_documental)) BETWEEN 12 AND 1024),
 observacion text NOT NULL CHECK (length(btrim(observacion)) BETWEEN 12 AND 2000),
 aprobado_por uuid NOT NULL REFERENCES auth.users(id),
 aprobado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coi_v3_homologaciones_cartera_idx
 ON public.coi_v3_homologaciones(cartera_id,aprobado_en DESC);
CREATE INDEX IF NOT EXISTS coi_v3_procedencia_promocion_idx
 ON public.coi_v3_procedencia(promocion_id);
ALTER TABLE public.coi_v3_promociones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coi_v3_procedencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coi_v3_homologaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coi_v3_promociones,public.coi_v3_procedencia,
 public.coi_v3_homologaciones FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.coi_v3_promociones,public.coi_v3_procedencia,
 public.coi_v3_homologaciones TO authenticated;
DROP POLICY IF EXISTS coi_v3_promocion_admin_read ON public.coi_v3_promociones;
DROP POLICY IF EXISTS coi_v3_procedencia_admin_read ON public.coi_v3_procedencia;
DROP POLICY IF EXISTS coi_v3_homologaciones_admin_read ON public.coi_v3_homologaciones;
CREATE POLICY coi_v3_promocion_admin_read ON public.coi_v3_promociones
 FOR SELECT TO authenticated USING (public.coi_current_role()='administrador');
CREATE POLICY coi_v3_procedencia_admin_read ON public.coi_v3_procedencia
 FOR SELECT TO authenticated USING (public.coi_current_role()='administrador');
CREATE POLICY coi_v3_homologaciones_admin_read ON public.coi_v3_homologaciones
 FOR SELECT TO authenticated USING (public.coi_current_role()='administrador');

-- La aprobación manual requiere prueba documental real: nunca vincular por coincidencia simple.
CREATE OR REPLACE FUNCTION public.coi_v3_homologar_contrato(
 p_cartera uuid,p_orden uuid,p_huella text,p_referencia text,p_observacion text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_cartera public.coi_v3_cartera%ROWTYPE;
        v_orden public.coi_ordenes%ROWTYPE;
        v_id uuid;
BEGIN
 PERFORM public.coi_assert_role(ARRAY['administrador']);
 IF length(btrim(coalesce(p_referencia,''))) NOT BETWEEN 12 AND 1024
    OR length(btrim(coalesce(p_observacion,''))) NOT BETWEEN 12 AND 2000
    OR length(btrim(coalesce(p_huella,'')))<>32
 THEN RAISE EXCEPTION 'COI_V3_FALTA_EVIDENCIA_O_HUELLA'; END IF;
 SELECT * INTO v_cartera FROM public.coi_v3_cartera
  WHERE id=p_cartera FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COI_V3_CARTERA_NO_EXISTE'; END IF;
 IF v_cartera.huella IS DISTINCT FROM p_huella
 THEN RAISE EXCEPTION 'COI_V3_HUELLA_CAMBIADA'; END IF;
 IF v_cartera.nro_oc IS NULL THEN RAISE EXCEPTION 'COI_V3_SIN_NUMERO_OC'; END IF;
 SELECT * INTO v_orden FROM public.coi_ordenes
  WHERE id=p_orden FOR SHARE;
 IF NOT FOUND OR v_orden.nro_oc IS DISTINCT FROM v_cartera.nro_oc
 THEN RAISE EXCEPTION 'COI_V3_OC_DIFERENTE'; END IF;
 IF lower(btrim(v_orden.tipo)) <>
    CASE WHEN v_cartera.fuente='obras' THEN 'obra' ELSE 'servicio' END
 THEN RAISE EXCEPTION 'COI_V3_TIPO_INCOMPATIBLE'; END IF;
 IF v_cartera.orden_id IS NOT NULL
 THEN RAISE EXCEPTION 'COI_V3_YA_HOMOLOGADA'; END IF;
 UPDATE public.coi_v3_cartera SET orden_id=p_orden,modificado_por=auth.uid(),
   actualizado_en=now() WHERE id=p_cartera;
 INSERT INTO public.coi_v3_homologaciones
  (cartera_id,orden_id,huella_cartera,nro_oc,referencia_documental,observacion,aprobado_por)
 VALUES(p_cartera,p_orden,p_huella,v_cartera.nro_oc,btrim(p_referencia),
        btrim(p_observacion),auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.coi_v3_homologar_contrato(uuid,uuid,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.coi_v3_homologar_contrato(uuid,uuid,text,text,text)
 TO authenticated;
COMMENT ON FUNCTION public.coi_v3_homologar_contrato(uuid,uuid,text,text,text) IS
 'Homologación explícita: sólo administrador, huella vigente, mismo número/tipo y referencia documental; no asocia por coincidencia.';
COMMIT;
