-- CAMBIO 3 — Modalidad de certificación de Servicios
--
-- Problema. La proyección de próximas certificaciones necesita distinguir un
-- servicio de mantenimiento MENSUAL de uno A DEMANDA. Hasta acá no existía
-- ningún atributo canónico que lo dijera: la única vía era inferirlo del texto
-- de la descripción, que no es un dato sino una adivinanza.
--
-- Decisión. Se agrega un campo controlado en coi_ordenes. Es incremental, no
-- destructivo y compatible con los registros históricos: todo lo existente
-- queda en SIN_DEFINIR, que NO genera proyección automática. Ninguna fila
-- cambia de significado y no se toca ninguna certificación registrada.
--
-- Reaplicar esta migración es NO-OP.

alter table public.coi_ordenes
  add column if not exists modalidad_certificacion text;

comment on column public.coi_ordenes.modalidad_certificacion is
  'Modalidad de certificación del servicio: MENSUAL, A_DEMANDA o SIN_DEFINIR. '
  'Sólo MENSUAL habilita la proyección automática de próxima certificación. '
  'SIN_DEFINIR es el estado de los registros históricos y no proyecta nada.';

-- Backfill no destructivo: sólo completa lo que está vacío.
update public.coi_ordenes
   set modalidad_certificacion = 'SIN_DEFINIR'
 where modalidad_certificacion is null
    or btrim(modalidad_certificacion) = '';

alter table public.coi_ordenes
  alter column modalidad_certificacion set default 'SIN_DEFINIR';

-- El dominio se cierra recién después del backfill, para que ninguna fila
-- histórica quede fuera del check.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.coi_ordenes'::regclass
       and conname = 'coi_ordenes_modalidad_certificacion_check'
  ) then
    alter table public.coi_ordenes
      add constraint coi_ordenes_modalidad_certificacion_check
      check (
        modalidad_certificacion is null
        or modalidad_certificacion in ('MENSUAL', 'A_DEMANDA', 'SIN_DEFINIR')
      );
  end if;
end
$$;

create index if not exists coi_ordenes_modalidad_certificacion_idx
  on public.coi_ordenes (modalidad_certificacion)
  where modalidad_certificacion = 'MENSUAL';
