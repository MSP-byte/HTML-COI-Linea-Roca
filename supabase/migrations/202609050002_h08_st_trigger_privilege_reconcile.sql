-- =====================================================================
-- H08 — Reconciliacion idempotente del hardening ST -> OC
-- =====================================================================
--
-- STAGING recibio la primera version de H08 durante el smoke controlado previo
-- al merge. Luego el archivo 202609050001 se hizo prerequisite-safe para que los
-- tests que reproducen deliberadamente una base SIN H04 no fallen al encontrar
-- una funcion que, en ese escenario artificial, no existe.
--
-- Esta segunda migracion deja una huella explicita y comun en STAGING y
-- PRODUCCION del estado FINAL de H08. Es idempotente y solo actua si la funcion
-- creada por H04 existe.

do $h08$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'coi_st_resolver_nro_oc'
       and p.pronargs = 0
  ) then
    return;
  end if;

  execute 'alter function public.coi_st_resolver_nro_oc() security definer';
  execute 'alter function public.coi_st_resolver_nro_oc() set search_path = pg_catalog, public, pg_temp';
  execute 'revoke all on function public.coi_st_resolver_nro_oc() from public, anon, authenticated';
end
$h08$;
