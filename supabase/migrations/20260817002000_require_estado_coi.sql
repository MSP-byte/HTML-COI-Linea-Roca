-- RC2 hotfix - guardrail defensivo para Estado COI.
--
-- El smoke productivo detectó que un editor legacy podía enviar estado_coi nulo
-- al guardar un campo no relacionado. Todas las OCs actuales poseen estado COI
-- válido; esta restricción hace fail-closed cualquier regresión futura.

begin;

alter table public.coi_ordenes
  add constraint coi_ordenes_estado_coi_required
  check (estado_coi is not null and btrim(estado_coi) <> '')
  not valid;

alter table public.coi_ordenes
  validate constraint coi_ordenes_estado_coi_required;

commit;
