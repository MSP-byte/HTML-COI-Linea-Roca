-- Reversión MANUAL de emergencia de Security V2 (restaura el código anterior).
-- ATENCIÓN: reabre la capacidad de fabricar eventos de auditoría vía RPC.
-- Requiere análisis de incidente, aprobación y control posterior.
BEGIN;
CREATE OR REPLACE FUNCTION public.coi_record_direct_order_update(p_before jsonb, p_after jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role text;
begin
  v_role:=public.coi_current_role();
  insert into public.coi_operaciones_auditoria(usuario_id,usuario_email,rol,accion,entidad,registro_id,nro_oc,datos_anteriores,datos_nuevos,contexto)
  values(auth.uid(),nullif(auth.jwt()->>'email',''),v_role,'ACTUALIZAR_ORDEN_DIRECTO_COMPAT','coi_ordenes',p_after->>'id',p_after->>'nro_oc',p_before,p_after,jsonb_build_object('origen','frontend_legacy_postgrest','rc','RC2'));
end;
$function$;
COMMIT;
