-- H17 — Carga Operativa / Carga Certificación
-- Estructura diferenciada para Servicios y Obras sin romper registros históricos.

alter table public.coi_certificaciones
  add column if not exists id_obra text,
  add column if not exists proveedor text,
  add column if not exists nro_hes text,
  add column if not exists nro_if text;

comment on column public.coi_certificaciones.id_obra is 'Identificador de obra asociado a la certificación.';
comment on column public.coi_certificaciones.proveedor is 'Proveedor informado para la certificación de servicio.';
comment on column public.coi_certificaciones.nro_hes is 'Número HES asociado a la certificación.';
comment on column public.coi_certificaciones.nro_if is 'Número IF asociado a la certificación.';

-- Backfill no destructivo desde la OC vinculada cuando exista orden_id.
update public.coi_certificaciones c
set
  id_obra = coalesce(nullif(btrim(c.id_obra), ''), o.id_obra),
  proveedor = coalesce(nullif(btrim(c.proveedor), ''), o.proveedor)
from public.coi_ordenes o
where c.orden_id = o.id
  and (
    c.id_obra is null or btrim(c.id_obra) = '' or
    c.proveedor is null or btrim(c.proveedor) = ''
  );

create index if not exists coi_certificaciones_id_obra_idx
  on public.coi_certificaciones (id_obra)
  where id_obra is not null;

create index if not exists coi_certificaciones_nro_hes_idx
  on public.coi_certificaciones (nro_hes)
  where nro_hes is not null;

create index if not exists coi_certificaciones_nro_if_idx
  on public.coi_certificaciones (nro_if)
  where nro_if is not null;
