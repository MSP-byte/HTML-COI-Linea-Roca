-- COI Línea Roca · Security hardening · Storage
-- Fecha: 2026-10-05
-- El bucket coi-documentos es privado y sólo PDF. Este guard adicional impide
-- que una cuenta Supabase autenticada pero sin perfil COI activo pueda leer
-- objetos del bucket. No modifica ni borra archivos.
-- En PGlite/local sin el schema storage de Supabase se comporta como NO-OP.

begin;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists coi_documentos_storage_select_guard on storage.objects';
    execute $policy$
      create policy coi_documentos_storage_select_guard
      on storage.objects
      as restrictive
      for select
      to authenticated
      using (
        bucket_id = 'coi-documentos'
        and public.coi_current_role() is not null
      )
    $policy$;
  end if;
end $$;

commit;
