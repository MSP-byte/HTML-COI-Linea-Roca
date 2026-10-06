-- COI Línea Roca · Security hardening · helper privado de auditoría
-- Fecha: 2026-10-05
-- El helper que registra UPDATE directos deja de ser invocable desde el schema
-- público de PostgREST. El trigger permanece SECURITY INVOKER y conserva la
-- semántica current_user='authenticated', pero delega la escritura a un helper
-- SECURITY DEFINER en coi_private, schema no expuesto por la API.
-- No modifica datos operativos.

begin;

create schema if not exists coi_private;
revoke all on schema coi_private from public, anon;
grant usage on schema coi_private to authenticated;

create or replace function coi_private.record_direct_order_update(
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_role text;
begin
  v_role := public.coi_current_role();
  insert into public.coi_operaciones_auditoria(
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, datos_nuevos, contexto
  )
  values(
    auth.uid(),
    nullif(auth.jwt()->>'email',''),
    v_role,
    'ACTUALIZAR_ORDEN_DIRECTO_COMPAT',
    'coi_ordenes',
    p_after->>'id',
    p_after->>'nro_oc',
    p_before,
    p_after,
    jsonb_build_object('origen','frontend_legacy_postgrest','rc','RC2')
  );
end;
$function$;

revoke all on function coi_private.record_direct_order_update(jsonb,jsonb)
  from public, anon;
grant execute on function coi_private.record_direct_order_update(jsonb,jsonb)
  to authenticated;

create or replace function public.coi_direct_order_update_audit()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  if current_user = 'authenticated' then
    perform coi_private.record_direct_order_update(to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$function$;

-- Compatibilidad: en algunos entornos la firma pública histórica ya fue
-- retirada por un hardening previo. Si todavía existe, deja de ser una RPC
-- cliente; si ya no existe, la migración sigue siendo idempotente.
do $
begin
  if to_regprocedure('public.coi_record_direct_order_update(jsonb,jsonb)') is not null then
    revoke all on function public.coi_record_direct_order_update(jsonb,jsonb)
      from public, anon, authenticated;
  end if;
end $;

commit;
