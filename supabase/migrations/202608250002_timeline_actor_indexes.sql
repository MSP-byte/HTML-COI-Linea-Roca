-- COI Linea Roca - indices de actores para FKs del Timeline/Mailing.

begin;

create index if not exists coi_timeline_created_by_idx
  on public.coi_timeline_events(created_by) where created_by is not null;

create index if not exists coi_timeline_updated_by_idx
  on public.coi_timeline_events(updated_by) where updated_by is not null;

commit;
