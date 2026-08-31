-- =====================================================================
-- H04 — Un Servicio Tecnico por (Unidad de Mantenimiento, N° ST)
-- =====================================================================
--
-- MOTIVO
--   La capa H04 evita duplicados con una comprobacion previa en JavaScript:
--   antes de insertar busca en el modelo remoto un ST con el mismo nro_st para
--   esa UM. Eso da un mensaje operativo claro, pero NO es integridad: con dos
--   operadores concurrentes ambos pueden leer «no existe» y despues insertar,
--   y la unidad termina con dos Servicios Tecnicos con el mismo numero.
--
--   La autoridad ante concurrencia tiene que estar en la base. La comprobacion
--   del frontend se conserva como UX, no como garantia.
--
-- ALCANCE
--   Agrega UNIQUE (unidad_id, nro_st). No recrea la tabla, no copia filas, no
--   elimina ni modifica datos, y no toca RLS, policies ni grants: las policies
--   siguen siendo SELECT/INSERT/UPDATE para authenticated, sin DELETE.
--
-- NULOS
--   unidad_id y nro_st son nullable y en Postgres los NULL se consideran
--   distintos entre si dentro de un UNIQUE: dos filas sin nro_st no colisionan.
--   Es el comportamiento buscado —el numero de ST no es obligatorio a nivel de
--   esquema, aunque la UI lo exija— y por eso la busqueda de duplicados solo
--   mira las filas que tienen ambos valores.
--
-- SEGURIDAD ANTE DATOS EXISTENTES
--   PRODUCCION y STAGING tienen 0 filas hoy, pero la migracion no lo asume. Si
--   encontrara duplicados preexistentes ABORTA informando cuales son, en lugar
--   de crear el constraint a la fuerza o de «arreglar» filas por su cuenta:
--   resolver esos duplicados es una decision operativa, no una consecuencia
--   silenciosa de una migracion.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: si el constraint ya existe, sale sin tocar nada y
--   sin volver a recorrer la tabla.
--
-- ESTADO REMOTO
--   Esta migracion NO fue aplicada a produccion ni a staging. Mientras eso no
--   ocurra, tests/fixtures/production_schema_contract.json documenta la
--   divergencia deliberada en «_divergencias_pendientes.unique».

do $$
declare
  v_duplicados text;
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'coi_servicios_tecnicos_um_unidad_nro_st_key'
       and conrelid = 'public.coi_servicios_tecnicos_um'::regclass
  ) then
    return;
  end if;

  select string_agg(
           format('unidad_id=%s nro_st=%L (%s filas)', d.unidad_id, d.nro_st, d.n),
           '; ' order by d.unidad_id, d.nro_st
         )
    into v_duplicados
    from (
      select st.unidad_id, st.nro_st, count(*) n
        from public.coi_servicios_tecnicos_um st
       where st.unidad_id is not null
         and st.nro_st is not null
       group by st.unidad_id, st.nro_st
      having count(*) > 1
    ) d;

  if v_duplicados is not null then
    raise exception using
      errcode = '23505',
      message = 'COI_ST_DUPLICADOS_PREEXISTENTES',
      detail = v_duplicados,
      hint = 'Resuelva los Servicios Tecnicos duplicados antes de aplicar el UNIQUE. Esta migracion no modifica filas por su cuenta.';
  end if;

  alter table public.coi_servicios_tecnicos_um
    add constraint coi_servicios_tecnicos_um_unidad_nro_st_key
    unique (unidad_id, nro_st);
end $$;

comment on constraint coi_servicios_tecnicos_um_unidad_nro_st_key
  on public.coi_servicios_tecnicos_um is
  'Un Servicio Tecnico por Unidad de Mantenimiento y numero de ST. La comprobacion previa del frontend es UX; la autoridad ante concurrencia es esta.';
