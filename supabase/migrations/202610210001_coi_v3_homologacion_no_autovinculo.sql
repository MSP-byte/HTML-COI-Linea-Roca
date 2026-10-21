-- COI V3 - #148. Version forward-only: impide vínculos OC automáticos.
-- El nro_oc que viene de Excel es una referencia informada, no homologación.
-- Mantiene UUID, auditoría, detección de OC ambigua y guardia por tipo.
-- Conservar una asociación ya existente sólo si el reintento es idéntico;
-- cualquier modificación de datos o nro_oc borra orden_id, sin tocar
-- registros contractuales coi_ordenes/certificaciones.
-- Desplegar y ensayar sólo en STAGING; NO es aprobación de promoción productiva.
-- COI V3: guardia server-side frente a una OC contractual de tipo incompatible.
-- La migración 202610160001 ya está aplicada en STAGING; ésta es forward-only.
-- No modifica ninguna tabla ni fila contractual.
BEGIN;
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
  -- Verificar candidato por numero y tipo, sin autorizar un vinculo contractual.
  v_orden_id:=NULL;
  IF v_oc IS NOT NULL THEN
   -- PostgreSQL no implementa min(uuid); preservar deteccion de OC ambigua.
   SELECT count(*),min(id::text)::uuid INTO v_oc_count,v_orden_id FROM public.coi_ordenes WHERE nro_oc=v_oc;
   IF v_oc_count>1 THEN RAISE EXCEPTION 'COI_V3_OC_AMBIGUOUS: %',v_oc; END IF;
   -- Una OC de Servicios nunca se vincula a una intervención de Obras (y viceversa).
   IF v_orden_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM public.coi_ordenes contrato
     WHERE contrato.id=v_orden_id
       AND lower(btrim(contrato.tipo))=CASE WHEN p_fuente='obras' THEN 'obra' ELSE 'servicio' END
   ) THEN RAISE EXCEPTION 'COI_V3_OC_TYPE_MISMATCH: %',v_oc; END IF;
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
   -- No tocar orden_id para una reimportacion byte-a-byte identica: una
   -- asociacion explicitamente aprobada se conserva si no cambia la huella.
   IF v_old.huella=v_hash THEN v_unchanged:=v_unchanged+1;v_action:='sin_cambios';
   ELSE
    UPDATE public.coi_v3_cartera
      -- El cambio de contenido invalida toda asociacion anterior:
      -- requiere nueva homologacion, sin crear un vinculo automaticamente.
      SET nro_oc=v_oc,orden_id=NULL,fila_excel=v_fila,datos=v_datos,
          huella=v_hash,actualizado_en=now(),modificado_por=v_user
      WHERE id=v_saved_id;
    v_updated:=v_updated+1;v_action:='actualizado';
   END IF;
  ELSE
   IF v_expected IS NOT NULL THEN RAISE EXCEPTION 'COI_V3_MISSING_EXPECTED_ROW: %',v_clave; END IF;
   INSERT INTO public.coi_v3_cartera
     (fuente,clave_fuente,fila_excel,nro_oc,orden_id,datos,huella,creado_por,modificado_por)
   VALUES(p_fuente,v_clave,v_fila,v_oc,NULL,v_datos,v_hash,v_user,v_user)
   RETURNING id INTO v_saved_id;
   v_new:=v_new+1;v_action:='nuevo';
  END IF;
  INSERT INTO public.coi_v3_importacion_items(lote_id,cartera_id,accion,huella_anterior,huella_nueva)
    VALUES(v_lote,v_saved_id,v_action,v_previous_hash,v_hash);
 END LOOP;
 UPDATE public.coi_v3_importaciones SET nuevos=v_new,actualizados=v_updated,sin_cambios=v_unchanged WHERE id=v_lote;
 RETURN jsonb_build_object('lote_id',v_lote,'total',v_n,'nuevos',v_new,'actualizados',v_updated,'sin_cambios',v_unchanged);
END;$$;
-- Conservar permisos: SECURITY DEFINER y acceso exclusivamente autenticado;
-- la función mantiene coi_assert_role(administrador) al comienzo.
REVOKE ALL ON FUNCTION public.coi_v3_confirmar_importacion(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.coi_v3_confirmar_importacion(text,text,jsonb) TO authenticated;
COMMIT;
