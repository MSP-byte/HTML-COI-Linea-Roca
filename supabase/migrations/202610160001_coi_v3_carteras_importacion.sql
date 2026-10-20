-- COI V3 · Etapa de carteras Excel. No modifica coi_ordenes ni certificaciones.
-- Aplicar primero en STAGING. La fuente contractual permanece coi_ordenes.
CREATE TABLE IF NOT EXISTS public.coi_v3_importaciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 fuente text NOT NULL CHECK (fuente IN ('obras','servicios')),
 archivo text NOT NULL,
 creado_por uuid NOT NULL REFERENCES auth.users(id),
 creado_en timestamptz NOT NULL DEFAULT now(),
 total integer NOT NULL CHECK (total BETWEEN 1 AND 1000),
 nuevos integer NOT NULL DEFAULT 0,
 actualizados integer NOT NULL DEFAULT 0,
 sin_cambios integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.coi_v3_cartera (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 fuente text NOT NULL CHECK (fuente IN ('obras','servicios')),
 clave_fuente text NOT NULL,
 fila_excel integer NOT NULL CHECK (fila_excel BETWEEN 1 AND 5000),
 nro_oc text,
 orden_id uuid REFERENCES public.coi_ordenes(id) ON DELETE SET NULL,
 datos jsonb NOT NULL CHECK (jsonb_typeof(datos)='object'),
 huella text NOT NULL,
 creado_por uuid NOT NULL REFERENCES auth.users(id),
 modificado_por uuid NOT NULL REFERENCES auth.users(id),
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE(fuente,clave_fuente)
);
CREATE INDEX IF NOT EXISTS coi_v3_cartera_oc_idx ON public.coi_v3_cartera(nro_oc);
CREATE INDEX IF NOT EXISTS coi_v3_cartera_orden_idx ON public.coi_v3_cartera(orden_id);
CREATE TABLE IF NOT EXISTS public.coi_v3_importacion_items (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 lote_id uuid NOT NULL REFERENCES public.coi_v3_importaciones(id) ON DELETE RESTRICT,
 cartera_id uuid NOT NULL REFERENCES public.coi_v3_cartera(id) ON DELETE RESTRICT,
 accion text NOT NULL CHECK (accion IN ('nuevo','actualizado','sin_cambios')),
 huella_anterior text,
 huella_nueva text NOT NULL,
 fecha timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coi_v3_importaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coi_v3_cartera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coi_v3_importacion_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coi_v3_importaciones,public.coi_v3_cartera,public.coi_v3_importacion_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.coi_v3_importaciones,public.coi_v3_cartera,public.coi_v3_importacion_items TO authenticated;
DROP POLICY IF EXISTS coi_v3_importaciones_read ON public.coi_v3_importaciones;
DROP POLICY IF EXISTS coi_v3_cartera_read ON public.coi_v3_cartera;
DROP POLICY IF EXISTS coi_v3_items_read ON public.coi_v3_importacion_items;
CREATE POLICY coi_v3_importaciones_read ON public.coi_v3_importaciones FOR SELECT TO authenticated USING (public.coi_current_role() IS NOT NULL);
CREATE POLICY coi_v3_cartera_read ON public.coi_v3_cartera FOR SELECT TO authenticated USING (public.coi_current_role() IS NOT NULL);
CREATE POLICY coi_v3_items_read ON public.coi_v3_importacion_items FOR SELECT TO authenticated USING (public.coi_current_role() IS NOT NULL);
CREATE OR REPLACE FUNCTION public.coi_v3_confirmar_importacion(p_fuente text,p_archivo text,p_registros jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
 v_user uuid;
 v_lote uuid;
 v_n integer;
 v_reg jsonb;
 v_clave text;
 v_oc text;
 v_orden_id uuid;
 v_oc_count integer;
 v_old record;
 v_previous_hash text;
 v_datos jsonb;
 v_hash text;
 v_expected text;
 v_fila integer;
 v_new integer:=0;
 v_updated integer:=0;
 v_unchanged integer:=0;
 v_saved_id uuid;
 v_action text;
BEGIN
 PERFORM public.coi_assert_role(ARRAY['administrador']);
 v_user:=auth.uid();
 IF p_fuente NOT IN ('obras','servicios') THEN RAISE EXCEPTION 'COI_V3_INVALID_SOURCE'; END IF;
 IF length(btrim(coalesce(p_archivo,''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'COI_V3_INVALID_FILENAME'; END IF;
 IF p_registros IS NULL OR jsonb_typeof(p_registros)<>'array' THEN RAISE EXCEPTION 'COI_V3_INVALID_PAYLOAD'; END IF;
 v_n:=jsonb_array_length(p_registros);
 IF v_n NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'COI_V3_INVALID_COUNT'; END IF;
 -- Lote transaccional: cualquier conflicto revierte todo el guardado.
 INSERT INTO public.coi_v3_importaciones(fuente,archivo,creado_por,total)
 VALUES(p_fuente,btrim(p_archivo),v_user,v_n) RETURNING id INTO v_lote;
 FOR v_reg IN SELECT value FROM jsonb_array_elements(p_registros) LOOP
  IF jsonb_typeof(v_reg)<>'object' THEN RAISE EXCEPTION 'COI_V3_INVALID_ROW'; END IF;
  v_clave:=btrim(coalesce(v_reg->>'clave_fuente',''));
  v_oc:=nullif(btrim(coalesce(v_reg->>'nro_oc','')),'');
  v_fila:=(v_reg->>'fila_excel')::integer;
  v_datos:=v_reg->'datos';
  v_expected:=nullif(v_reg->>'huella_esperada','');
  IF length(v_clave) NOT BETWEEN 2 AND 120 OR v_fila NOT BETWEEN 1 AND 5000
     OR jsonb_typeof(v_datos)<>'object' OR length(v_datos::text)>30000
  THEN RAISE EXCEPTION 'COI_V3_INVALID_ROW_DATA'; END IF;
  IF v_oc IS NOT NULL AND v_oc !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'COI_V3_INVALID_OC'; END IF;
  IF p_fuente='servicios' AND (v_oc IS NULL OR v_clave <> 'oc:'||v_oc) THEN RAISE EXCEPTION 'COI_V3_SERVICIO_KEY_MISMATCH'; END IF;
  IF p_fuente='obras' AND v_clave NOT LIKE 'obra:%' THEN RAISE EXCEPTION 'COI_V3_OBRA_KEY_MISMATCH'; END IF;
  v_orden_id:=NULL;
  IF v_oc IS NOT NULL THEN
   -- PostgreSQL no implementa min(uuid); preservar deteccion de OC ambigua.
   SELECT count(*),min(id::text)::uuid INTO v_oc_count,v_orden_id FROM public.coi_ordenes WHERE nro_oc=v_oc;
   IF v_oc_count>1 THEN RAISE EXCEPTION 'COI_V3_OC_AMBIGUOUS: %',v_oc; END IF;
  END IF;
  v_hash:=md5(v_datos::text||'|'||coalesce(v_oc,''));
  v_previous_hash:=NULL;
  SELECT id,huella INTO v_old FROM public.coi_v3_cartera
    WHERE fuente=p_fuente AND clave_fuente=v_clave FOR UPDATE;
  IF FOUND THEN
   v_previous_hash:=v_old.huella;
   IF v_expected IS NULL OR v_old.huella IS DISTINCT FROM v_expected
   THEN RAISE EXCEPTION 'COI_V3_CONCURRENT_CHANGE: %',v_clave; END IF;
   v_saved_id:=v_old.id;
   IF v_old.huella=v_hash THEN v_unchanged:=v_unchanged+1;v_action:='sin_cambios';
   ELSE
    UPDATE public.coi_v3_cartera
      SET nro_oc=v_oc,orden_id=v_orden_id,fila_excel=v_fila,datos=v_datos,
          huella=v_hash,actualizado_en=now(),modificado_por=v_user
      WHERE id=v_saved_id;
    v_updated:=v_updated+1;v_action:='actualizado';
   END IF;
  ELSE
   IF v_expected IS NOT NULL THEN RAISE EXCEPTION 'COI_V3_MISSING_EXPECTED_ROW: %',v_clave; END IF;
   INSERT INTO public.coi_v3_cartera
     (fuente,clave_fuente,fila_excel,nro_oc,orden_id,datos,huella,creado_por,modificado_por)
   VALUES(p_fuente,v_clave,v_fila,v_oc,v_orden_id,v_datos,v_hash,v_user,v_user)
   RETURNING id INTO v_saved_id;
   v_new:=v_new+1;v_action:='nuevo';
  END IF;
  INSERT INTO public.coi_v3_importacion_items(lote_id,cartera_id,accion,huella_anterior,huella_nueva)
    VALUES(v_lote,v_saved_id,v_action,v_previous_hash,v_hash);
 END LOOP;
 UPDATE public.coi_v3_importaciones SET nuevos=v_new,actualizados=v_updated,sin_cambios=v_unchanged WHERE id=v_lote;
 RETURN jsonb_build_object('lote_id',v_lote,'total',v_n,'nuevos',v_new,'actualizados',v_updated,'sin_cambios',v_unchanged);
END;$$;
REVOKE ALL ON FUNCTION public.coi_v3_confirmar_importacion(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.coi_v3_confirmar_importacion(text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.coi_v3_confirmar_importacion(text,text,jsonb) IS
 'Confirma carteras Excel sin alterar coi_ordenes ni certificaciones. Requiere rol administrador y control de versión por huella.';
