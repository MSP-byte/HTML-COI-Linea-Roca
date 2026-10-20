-- LECTURA SOLAMENTE, EXCLUSIVAMENTE STAGING luego de migraciones V3.
-- No usar en produccion antes de instalar las tablas V3.
WITH cartera AS (
 SELECT fuente, count(*)::int AS filas,
 count(DISTINCT id)::int AS uuid_distintos,
 count(DISTINCT clave_fuente)::int AS claves_distintas,
 count(*) FILTER (WHERE nro_oc IS NULL)::int AS sin_oc,
 count(*) FILTER (WHERE orden_id IS NOT NULL)::int AS vinculadas_contrato,
 count(*) FILTER (WHERE huella IS NULL OR huella='')::int AS huella_vacia
 FROM public.coi_v3_cartera GROUP BY fuente
), acciones AS (
 SELECT accion,count(*)::int n FROM public.coi_v3_importacion_items GROUP BY accion
), duplicadas AS (
 SELECT fuente,nro_oc,count(*)::int n FROM public.coi_v3_cartera
 WHERE nro_oc IS NOT NULL GROUP BY fuente,nro_oc HAVING count(*)>1
)
SELECT jsonb_build_object(
 'captura_utc',now(),
 'cartera_por_fuente',(SELECT coalesce(jsonb_agg(to_jsonb(cartera) ORDER BY fuente),'[]'::jsonb) FROM cartera),
 'lotes',(SELECT count(*) FROM public.coi_v3_importaciones),
 'total_declarado_lotes',(SELECT coalesce(sum(total),0) FROM public.coi_v3_importaciones),
 'items',(SELECT count(*) FROM public.coi_v3_importacion_items),
 'acciones',(SELECT coalesce(jsonb_agg(to_jsonb(acciones) ORDER BY accion),'[]'::jsonb) FROM acciones),
 'lotes_desbalanceados',(
  SELECT count(*) FROM public.coi_v3_importaciones l LEFT JOIN (
   SELECT lote_id,count(*) n FROM public.coi_v3_importacion_items GROUP BY lote_id
  ) i ON i.lote_id=l.id WHERE coalesce(i.n,0)<>l.total
 ),
 'duplicados_misma_fuente_y_oc',(SELECT coalesce(jsonb_agg(to_jsonb(duplicadas)),'[]'::jsonb) FROM duplicadas),
 'cartera_sin_item',(SELECT count(*) FROM public.coi_v3_cartera c
  WHERE NOT EXISTS (SELECT 1 FROM public.coi_v3_importacion_items i WHERE i.cartera_id=c.id)),
 'candidatos_tipo_incompatible',(SELECT count(*) FROM public.coi_v3_cartera c
  JOIN public.coi_ordenes o ON o.id=c.orden_id
  WHERE lower(btrim(o.tipo))<>CASE WHEN c.fuente='obras' THEN 'obra' ELSE 'servicio' END)
) AS reporte_staging;
