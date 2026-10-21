-- COI V3 · alcance del respaldo: SOLO SELECT para SQL Editor bajo rol autorizado.
-- No exporta emails, rutas de objetos, claves ni contenido documental.
-- El inventario NO constituye copia de seguridad ni prueba de restaurabilidad.
WITH buckets AS (
 SELECT o.bucket_id, count(*)::int AS objetos
 FROM storage.objects o GROUP BY o.bucket_id
)
SELECT jsonb_build_object(
 'captura_utc', now(),
 'pg_version', current_setting('server_version'),
 'oc', (SELECT count(*) FROM public.coi_ordenes),
 'certificaciones', (SELECT count(*) FROM public.coi_certificaciones),
 'auth_users', (SELECT count(*) FROM auth.users),
 'profiles', (SELECT count(*) FROM public.profiles),
 'storage_buckets', (SELECT count(*) FROM storage.buckets),
 'storage_objects', (SELECT count(*) FROM storage.objects),
 'buckets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'privado',NOT b.public,'objetos',coalesce(x.objetos,0)) ORDER BY b.id),'[]'::jsonb) FROM storage.buckets b LEFT JOIN buckets x ON x.bucket_id=b.id),
 'pg_extensions', (SELECT coalesce(jsonb_agg(jsonb_build_object('nombre',extname,'version',extversion) ORDER BY extname),'[]'::jsonb) FROM pg_extension),
 'oc_fingerprint', (SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id)::text,'[]')) FROM public.coi_ordenes o),
 'cert_fingerprint', (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'[]')) FROM public.coi_certificaciones c)
) AS alcance_backup;