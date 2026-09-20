-- =====================================================================
-- H04/H05 — El rol Administrador tambien manda en PostgreSQL
-- =====================================================================
--
-- MOTIVO
--   La UI reserva las mutaciones de Unidades de Mantenimiento y de Servicios
--   Tecnicos al Administrador (esAutorizacionAdministrativaSupabaseV60), pero
--   las policies remotas solo exigen estar autenticado:
--
--     coi_um_insert_auth  : authenticated, with check auth.uid() is not null
--     coi_um_update_auth  : authenticated, using true
--     coi_st_insert_auth  : authenticated, with check auth.uid() is not null
--     coi_st_update_auth  : authenticated, using true
--
--   Es decir que un usuario con perfil «consulta» podia saltarse la UI y llamar
--   a PostgREST directamente para crear o modificar UM y ST. Una restriccion que
--   solo vive en JavaScript no es una restriccion: es una convencion.
--
-- ALCANCE
--   Se agregan policies RESTRICTIVE, que es el patron que el proyecto ya usa en
--   202608100004_rls_policies.sql para profiles y coi_ordenes. Una restrictiva
--   ESTRECHA: se combina con AND sobre las permisivas existentes, de modo que no
--   hace falta tocar —ni reescribir— las cuatro policies originales, y ninguna
--   permisiva futura puede volver a ampliar el limite por descuido.
--
--     SELECT : coi_current_role() is not null  (autenticado con perfil activo)
--     INSERT : coi_current_role() = 'administrador'
--     UPDATE : administrador en USING y en WITH CHECK
--
--   No se crea ninguna policy DELETE: el borrado fisico sigue sin ser un camino
--   disponible. UM se da de baja y ST se cancela.
--
--   Se endurecen los grants: anon pierde todo, y authenticated queda con
--   exactamente SELECT, INSERT y UPDATE. Sin DELETE, TRUNCATE, REFERENCES ni
--   TRIGGER. Los grants no reemplazan a la RLS: son la segunda capa.
--
--   No se recrean tablas, no se copian filas y no se toca ningun dato.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: cada policy se elimina por nombre antes de
--   recrearse, y los grants se declaran de forma absoluta (revoke all + grant
--   exacto), no incremental.
--
-- ESTADO REMOTO
--   Esta migracion NO fue aplicada a produccion ni a staging. Mientras eso no
--   ocurra, tests/fixtures/production_schema_contract.json documenta la
--   divergencia deliberada en «_divergencias_pendientes.policies» y en
--   «_divergencias_pendientes.grants».

-- ---------------------------------------------------------------------
-- 1) Unidades de Mantenimiento
-- ---------------------------------------------------------------------
alter table public.coi_unidades_mantenimiento enable row level security;

drop policy if exists coi_um_select_guard on public.coi_unidades_mantenimiento;
create policy coi_um_select_guard on public.coi_unidades_mantenimiento as restrictive
for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_um_insert_guard on public.coi_unidades_mantenimiento;
create policy coi_um_insert_guard on public.coi_unidades_mantenimiento as restrictive
for insert to authenticated
with check (public.coi_current_role() = 'administrador');

drop policy if exists coi_um_update_guard on public.coi_unidades_mantenimiento;
create policy coi_um_update_guard on public.coi_unidades_mantenimiento as restrictive
for update to authenticated
using (public.coi_current_role() = 'administrador')
with check (public.coi_current_role() = 'administrador');

-- ---------------------------------------------------------------------
-- 2) Servicios Tecnicos
-- ---------------------------------------------------------------------
alter table public.coi_servicios_tecnicos_um enable row level security;

drop policy if exists coi_st_select_guard on public.coi_servicios_tecnicos_um;
create policy coi_st_select_guard on public.coi_servicios_tecnicos_um as restrictive
for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_st_insert_guard on public.coi_servicios_tecnicos_um;
create policy coi_st_insert_guard on public.coi_servicios_tecnicos_um as restrictive
for insert to authenticated
with check (public.coi_current_role() = 'administrador');

drop policy if exists coi_st_update_guard on public.coi_servicios_tecnicos_um;
create policy coi_st_update_guard on public.coi_servicios_tecnicos_um as restrictive
for update to authenticated
using (public.coi_current_role() = 'administrador')
with check (public.coi_current_role() = 'administrador');

-- ---------------------------------------------------------------------
-- 3) Grants: anon fuera, authenticated con lo justo
-- ---------------------------------------------------------------------
revoke all on public.coi_unidades_mantenimiento from anon;
revoke all on public.coi_servicios_tecnicos_um from anon;

revoke all on public.coi_unidades_mantenimiento from authenticated;
revoke all on public.coi_servicios_tecnicos_um from authenticated;

grant select, insert, update on public.coi_unidades_mantenimiento to authenticated;
grant select, insert, update on public.coi_servicios_tecnicos_um to authenticated;

comment on policy coi_um_update_guard on public.coi_unidades_mantenimiento is
  'RESTRICTIVE: solo el rol administrador modifica Unidades de Mantenimiento. La UI ya lo exigia; aca deja de depender de JavaScript.';
comment on policy coi_st_update_guard on public.coi_servicios_tecnicos_um is
  'RESTRICTIVE: solo el rol administrador modifica Servicios Tecnicos. La UI ya lo exigia; aca deja de depender de JavaScript.';
