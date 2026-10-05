-- COI Línea Roca · Security hardening · secure-by-default functions
-- Fecha: 2026-10-05
-- Funciones nuevas creadas por postgres en public no deben quedar ejecutables
-- por roles cliente salvo GRANT explícito en su migración.

begin;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
