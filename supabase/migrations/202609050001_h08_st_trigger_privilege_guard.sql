-- =====================================================================
-- H08 — El trigger ST -> OC puede tomar locks sin abrir UPDATE de OC
-- =====================================================================
--
-- HALLAZGO DE ROLLOUT
--   Las migraciones H04/H05 ya estaban aplicadas en STAGING y PRODUCCION.
--   El smoke transaccional de H08 detecto que un Administrador autenticado no
--   podia crear un Servicio Tecnico vinculado a una OC: el trigger
--   public.coi_st_resolver_nro_oc() ejecutaba SELECT ... FOR UPDATE sobre
--   public.coi_ordenes con los privilegios del invocante y PostgreSQL exige
--   privilegio UPDATE para ese lock. authenticated no tiene UPDATE directo
--   sobre coi_ordenes por diseño: las mutaciones de OC pasan por los RPC
--   canonicos.
--
-- DECISION
--   No se concede UPDATE directo a authenticated. La funcion trigger, propiedad
--   de postgres y con cuerpo cerrado sobre objetos schema-qualified, pasa a
--   SECURITY DEFINER para poder tomar el row lock necesario conservando el
--   modelo de permisos del frontend/RPC.
--
-- SEGURIDAD
--   - search_path fijo: pg_catalog, public, pg_temp;
--   - se revoca EXECUTE directo a PUBLIC, anon y authenticated;
--   - la funcion solo puede actuar como trigger ya instalado sobre
--     coi_servicios_tecnicos_um;
--   - RLS/policies de la tabla hija siguen decidiendo quien puede INSERT/UPDATE;
--   - no se agrega ningun grant sobre coi_ordenes.
--
-- ALCANCE
--   Solo atributos de public.coi_st_resolver_nro_oc(). No modifica filas,
--   constraints, policies, grants de tablas ni otros RPC.
--
-- IDEMPOTENCIA
--   Reaplicarla deja los mismos atributos y privilegios.

alter function public.coi_st_resolver_nro_oc()
  security definer;

alter function public.coi_st_resolver_nro_oc()
  set search_path = pg_catalog, public, pg_temp;

revoke all on function public.coi_st_resolver_nro_oc()
  from public, anon, authenticated;

comment on function public.coi_st_resolver_nro_oc() is
  'Trigger SECURITY DEFINER H08: resuelve/serializa ST -> OC con row locks sobre coi_ordenes sin conceder UPDATE directo a authenticated. search_path fijo y EXECUTE directo revocado; las policies de coi_servicios_tecnicos_um siguen gobernando quien puede mutar la fila hija.';
