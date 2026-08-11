-- COI Linea Roca - RLS alineado con la matriz de permisos del frontend.
-- Las mutaciones financieras criticas quedan disponibles solo por RPC.

begin;

alter table public.profiles enable row level security;
alter table public.coi_ordenes enable row level security;
alter table public.coi_ordenes_estaciones enable row level security;
alter table public.coi_posiciones_oc enable row level security;
alter table public.coi_consumos_posicion enable row level security;
alter table public.coi_operaciones_auditoria enable row level security;
alter table public.coi_contract_meta enable row level security;
alter table public.coi_idempotency_requests enable row level security;

drop policy if exists coi_profiles_select on public.profiles;
create policy coi_profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.coi_current_role() in ('administrador', 'jefatura')
);

drop policy if exists coi_profiles_admin_insert on public.profiles;
create policy coi_profiles_admin_insert on public.profiles
for insert to authenticated
with check (public.coi_current_role() = 'administrador');

drop policy if exists coi_profiles_admin_update on public.profiles;
create policy coi_profiles_admin_update on public.profiles
for update to authenticated
using (public.coi_current_role() = 'administrador')
with check (public.coi_current_role() = 'administrador');

drop policy if exists coi_profiles_admin_delete on public.profiles;
create policy coi_profiles_admin_delete on public.profiles
for delete to authenticated
using (public.coi_current_role() = 'administrador');

drop policy if exists coi_ordenes_select on public.coi_ordenes;
create policy coi_ordenes_select on public.coi_ordenes
for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_ordenes_insert on public.coi_ordenes;
create policy coi_ordenes_insert on public.coi_ordenes
for insert to authenticated
with check (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor')
);

drop policy if exists coi_ordenes_update on public.coi_ordenes;
create policy coi_ordenes_update on public.coi_ordenes
for update to authenticated
using (
  public.coi_current_role() in (
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  )
)
with check (
  public.coi_current_role() in (
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  )
);

drop policy if exists coi_ordenes_delete on public.coi_ordenes;
create policy coi_ordenes_delete on public.coi_ordenes
for delete to authenticated
using (public.coi_current_role() = 'administrador');

drop policy if exists coi_ordenes_estaciones_select on public.coi_ordenes_estaciones;
create policy coi_ordenes_estaciones_select on public.coi_ordenes_estaciones
for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_ordenes_estaciones_insert on public.coi_ordenes_estaciones;
create policy coi_ordenes_estaciones_insert on public.coi_ordenes_estaciones
for insert to authenticated
with check (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor')
);

drop policy if exists coi_ordenes_estaciones_update on public.coi_ordenes_estaciones;
create policy coi_ordenes_estaciones_update on public.coi_ordenes_estaciones
for update to authenticated
using (
  public.coi_current_role() in (
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  )
)
with check (
  public.coi_current_role() in (
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  )
);

drop policy if exists coi_ordenes_estaciones_delete on public.coi_ordenes_estaciones;
create policy coi_ordenes_estaciones_delete on public.coi_ordenes_estaciones
for delete to authenticated
using (public.coi_current_role() = 'administrador');

drop policy if exists coi_posiciones_select on public.coi_posiciones_oc;
create policy coi_posiciones_select on public.coi_posiciones_oc
for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_posiciones_insert on public.coi_posiciones_oc;
create policy coi_posiciones_insert on public.coi_posiciones_oc
for insert to authenticated
with check (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor')
);

drop policy if exists coi_posiciones_update on public.coi_posiciones_oc;
create policy coi_posiciones_update on public.coi_posiciones_oc
for update to authenticated
using (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor')
)
with check (
  public.coi_current_role() in ('administrador', 'jefatura', 'editor')
);

drop policy if exists coi_consumos_select on public.coi_consumos_posicion;
create policy coi_consumos_select on public.coi_consumos_posicion
for select to authenticated
using (public.coi_current_role() is not null);

drop policy if exists coi_operaciones_auditoria_select on public.coi_operaciones_auditoria;
create policy coi_operaciones_auditoria_select on public.coi_operaciones_auditoria
for select to authenticated
using (public.coi_current_role() in ('administrador', 'jefatura'));

drop policy if exists coi_contract_meta_select on public.coi_contract_meta;
create policy coi_contract_meta_select on public.coi_contract_meta
for select to authenticated
using (public.coi_current_role() in ('administrador', 'jefatura'));

-- Las politicas restrictivas impiden que una politica permisiva antigua pueda
-- ampliar accidentalmente estos limites.
drop policy if exists coi_profiles_select_guard on public.profiles;
create policy coi_profiles_select_guard on public.profiles as restrictive
for select to authenticated
using (id = auth.uid() or public.coi_current_role() in ('administrador', 'jefatura'));
drop policy if exists coi_profiles_insert_guard on public.profiles;
create policy coi_profiles_insert_guard on public.profiles as restrictive
for insert to authenticated
with check (public.coi_current_role() = 'administrador');
drop policy if exists coi_profiles_update_guard on public.profiles;
create policy coi_profiles_update_guard on public.profiles as restrictive
for update to authenticated
using (public.coi_current_role() = 'administrador')
with check (public.coi_current_role() = 'administrador');
drop policy if exists coi_profiles_delete_guard on public.profiles;
create policy coi_profiles_delete_guard on public.profiles as restrictive
for delete to authenticated
using (public.coi_current_role() = 'administrador');

drop policy if exists coi_ordenes_select_guard on public.coi_ordenes;
create policy coi_ordenes_select_guard on public.coi_ordenes as restrictive
for select to authenticated using (public.coi_current_role() is not null);
drop policy if exists coi_ordenes_insert_guard on public.coi_ordenes;
create policy coi_ordenes_insert_guard on public.coi_ordenes as restrictive
for insert to authenticated
with check (public.coi_current_role() in ('administrador', 'jefatura', 'editor'));
drop policy if exists coi_ordenes_update_guard on public.coi_ordenes;
create policy coi_ordenes_update_guard on public.coi_ordenes as restrictive
for update to authenticated
using (public.coi_current_role() in ('administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'))
with check (public.coi_current_role() in ('administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'));
drop policy if exists coi_ordenes_delete_guard on public.coi_ordenes;
create policy coi_ordenes_delete_guard on public.coi_ordenes as restrictive
for delete to authenticated using (public.coi_current_role() = 'administrador');

drop policy if exists coi_ordenes_estaciones_select_guard on public.coi_ordenes_estaciones;
create policy coi_ordenes_estaciones_select_guard on public.coi_ordenes_estaciones as restrictive
for select to authenticated using (public.coi_current_role() is not null);
drop policy if exists coi_ordenes_estaciones_insert_guard on public.coi_ordenes_estaciones;
create policy coi_ordenes_estaciones_insert_guard on public.coi_ordenes_estaciones as restrictive
for insert to authenticated
with check (public.coi_current_role() in ('administrador', 'jefatura', 'editor'));
drop policy if exists coi_ordenes_estaciones_update_guard on public.coi_ordenes_estaciones;
create policy coi_ordenes_estaciones_update_guard on public.coi_ordenes_estaciones as restrictive
for update to authenticated
using (public.coi_current_role() in ('administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'))
with check (public.coi_current_role() in ('administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'));
drop policy if exists coi_ordenes_estaciones_delete_guard on public.coi_ordenes_estaciones;
create policy coi_ordenes_estaciones_delete_guard on public.coi_ordenes_estaciones as restrictive
for delete to authenticated using (public.coi_current_role() = 'administrador');

drop policy if exists coi_posiciones_select_guard on public.coi_posiciones_oc;
create policy coi_posiciones_select_guard on public.coi_posiciones_oc as restrictive
for select to authenticated using (public.coi_current_role() is not null);
drop policy if exists coi_posiciones_insert_guard on public.coi_posiciones_oc;
create policy coi_posiciones_insert_guard on public.coi_posiciones_oc as restrictive
for insert to authenticated
with check (public.coi_current_role() in ('administrador', 'jefatura', 'editor'));
drop policy if exists coi_posiciones_update_guard on public.coi_posiciones_oc;
create policy coi_posiciones_update_guard on public.coi_posiciones_oc as restrictive
for update to authenticated
using (public.coi_current_role() in ('administrador', 'jefatura', 'editor'))
with check (public.coi_current_role() in ('administrador', 'jefatura', 'editor'));
drop policy if exists coi_posiciones_delete_guard on public.coi_posiciones_oc;
create policy coi_posiciones_delete_guard on public.coi_posiciones_oc as restrictive
for delete to authenticated using (public.coi_current_role() = 'administrador');

drop policy if exists coi_consumos_select_guard on public.coi_consumos_posicion;
create policy coi_consumos_select_guard on public.coi_consumos_posicion as restrictive
for select to authenticated using (public.coi_current_role() is not null);
drop policy if exists coi_operaciones_auditoria_select_guard on public.coi_operaciones_auditoria;
create policy coi_operaciones_auditoria_select_guard on public.coi_operaciones_auditoria as restrictive
for select to authenticated
using (public.coi_current_role() in ('administrador', 'jefatura'));
drop policy if exists coi_contract_meta_select_guard on public.coi_contract_meta;
create policy coi_contract_meta_select_guard on public.coi_contract_meta as restrictive
for select to authenticated
using (public.coi_current_role() in ('administrador', 'jefatura'));

revoke all on public.profiles from anon;
revoke all on public.coi_ordenes from anon;
revoke all on public.coi_ordenes_estaciones from anon;
revoke all on public.coi_posiciones_oc from anon;
revoke all on public.coi_consumos_posicion from anon;
revoke all on public.coi_operaciones_auditoria from anon;
revoke all on public.coi_contract_meta from anon;
revoke all on public.coi_idempotency_requests from anon, authenticated;
revoke insert, update, delete on public.coi_consumos_posicion from authenticated;
revoke insert, update, delete on public.coi_operaciones_auditoria from authenticated;
revoke insert, update, delete on public.coi_contract_meta from authenticated;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.coi_ordenes to authenticated;
grant select, insert, update, delete on public.coi_ordenes_estaciones to authenticated;
grant select, insert, update on public.coi_posiciones_oc to authenticated;
grant select on public.coi_consumos_posicion to authenticated;
grant select on public.coi_operaciones_auditoria to authenticated;
grant select on public.coi_contract_meta to authenticated;

commit;
