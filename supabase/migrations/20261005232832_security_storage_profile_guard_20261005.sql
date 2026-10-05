-- COI Línea Roca · Security hardening · Storage
-- Fecha: 2026-10-05
-- El bucket coi-documentos es privado y sólo PDF. Este guard adicional impide
-- que una cuenta Supabase autenticada pero sin perfil COI activo pueda leer
-- objetos del bucket. No modifica ni borra archivos.

begin;

drop policy if exists coi_documentos_storage_select_guard on storage.objects;
create policy coi_documentos_storage_select_guard
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id = 'coi-documentos'
  and public.coi_current_role() is not null
);

commit;
