-- COI Linea Roca - backfill seguro de estacion principal para instalaciones legacy.
--
-- Contexto:
-- algunas instalaciones historicas conservan estacion/ramal/sector solamente en
-- coi_ordenes y no materializaron aun coi_ordenes_estaciones. La migracion 006
-- exige exactamente una estacion principal por OC antes de endurecer el contrato.
--
-- Regla conservadora:
-- - si una OC ya tiene asociaciones, no se elige ninguna de oficio;
-- - si una OC tiene mas de una principal, se aborta;
-- - solo se crea la principal cuando la OC no tiene NINGUNA asociacion;
-- - la estacion se copia del maestro; no se inventan ramal ni sector;
-- - las columnas legacy necesarias se agregan de forma compatible antes del backfill.

begin;

alter table public.coi_ordenes_estaciones add column if not exists nro_oc text;
alter table public.coi_ordenes_estaciones add column if not exists tipo_alcance text not null default 'General';
alter table public.coi_ordenes_estaciones add column if not exists descripcion_alcance text;
alter table public.coi_ordenes_estaciones add column if not exists estado text not null default 'Activa';

do $$
declare
  v_ambiguous uuid;
  v_missing_station uuid;
begin
  select o.id
    into v_ambiguous
    from public.coi_ordenes o
   where exists (
     select 1
       from public.coi_ordenes_estaciones oe
      where oe.orden_id = o.id
   )
     and (
       select count(*)
         from public.coi_ordenes_estaciones oe
        where oe.orden_id = o.id
          and oe.es_principal is true
     ) <> 1
   order by o.id
   limit 1;

  if v_ambiguous is not null then
    raise exception using
      errcode = '23514',
      message = 'COI_LEGACY_STATION_BACKFILL_AMBIGUOUS',
      detail = v_ambiguous::text,
      hint = 'La OC ya posee asociaciones pero no exactamente una principal; resolverla manualmente.';
  end if;

  select o.id
    into v_missing_station
    from public.coi_ordenes o
   where not exists (
     select 1 from public.coi_ordenes_estaciones oe where oe.orden_id = o.id
   )
     and nullif(regexp_replace(trim(coalesce(o.estacion, '')), '[[:space:]]+', ' ', 'g'), '') is null
   order by o.id
   limit 1;

  if v_missing_station is not null then
    raise exception using
      errcode = '23514',
      message = 'COI_LEGACY_STATION_BACKFILL_REQUIRES_STATION',
      detail = v_missing_station::text,
      hint = 'Completar estacion en coi_ordenes antes de materializar la asociacion principal.';
  end if;
end;
$$;

insert into public.coi_ordenes_estaciones (
  orden_id,
  nro_oc,
  estacion,
  ramal,
  sector,
  tipo_alcance,
  descripcion_alcance,
  es_principal,
  estado
)
select
  o.id,
  o.nro_oc,
  regexp_replace(trim(o.estacion), '[[:space:]]+', ' ', 'g'),
  nullif(regexp_replace(trim(coalesce(o.ramal, '')), '[[:space:]]+', ' ', 'g'), ''),
  nullif(regexp_replace(trim(coalesce(o.sector, '')), '[[:space:]]+', ' ', 'g'), ''),
  'Principal',
  'Estacion principal materializada desde coi_ordenes para migracion RC2',
  true,
  'Activa'
from public.coi_ordenes o
where not exists (
  select 1
    from public.coi_ordenes_estaciones oe
   where oe.orden_id = o.id
);

do $$
declare
  v_bad uuid;
begin
  select o.id
    into v_bad
    from public.coi_ordenes o
    left join public.coi_ordenes_estaciones oe
      on oe.orden_id = o.id and oe.es_principal is true
   group by o.id
  having count(oe.id) <> 1
   order by o.id
   limit 1;

  if v_bad is not null then
    raise exception using
      errcode = '23514',
      message = 'COI_ORDER_REQUIRES_ONE_PRINCIPAL_STATION',
      detail = v_bad::text;
  end if;
end;
$$;

commit;
