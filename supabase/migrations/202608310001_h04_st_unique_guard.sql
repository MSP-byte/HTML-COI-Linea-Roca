-- =====================================================================
-- H04 — Un Servicio Tecnico por (Unidad de Mantenimiento, N° ST canonico)
-- =====================================================================
--
-- MOTIVO
--   La capa H04 evita duplicados con una comprobacion previa en JavaScript:
--   antes de insertar busca en el modelo remoto un ST con el mismo numero para
--   esa UM. Eso da un mensaje operativo claro, pero NO es integridad: con dos
--   operadores concurrentes ambos pueden leer «no existe» y despues insertar,
--   y la unidad termina con dos Servicios Tecnicos con el mismo numero.
--
--   La autoridad ante concurrencia tiene que estar en la base. La comprobacion
--   del frontend se conserva como UX, no como garantia.
--
-- NUMERO CANONICO
--   El frontend considera el mismo ST a «ST-0001», «st0001» y «ST / 0001»: al
--   comparar quita espacios, puntos, barras y guiones y pasa a mayusculas. Un
--   UNIQUE sobre el texto literal seria mas laxo que esa comparacion, de modo
--   que dos clientes concurrentes podrian colar variantes equivalentes que la
--   UI despues tratara como la misma. Por eso la unicidad se aplica sobre la
--   representacion canonica:
--
--     upper(regexp_replace(nro_st, '[[:space:]./-]+', '', 'g'))
--
--   que es exactamente lo que hace claveST() en index.html. El valor original
--   de nro_st se conserva tal cual para mostrarlo: no se normaliza el dato, solo
--   la clave de unicidad.
--
--   Al ser una expresion, esto es un UNIQUE INDEX y no un constraint de tabla.
--   El nombre elegido lo refleja para no mentirle al contrato ni a los tests.
--
-- ALCANCE
--   Crea el indice unico. No recrea la tabla, no copia filas, no elimina ni
--   modifica datos, y no toca RLS, policies ni grants.
--
-- NULOS
--   El indice es parcial: solo cubre las filas con unidad_id y nro_st no nulos.
--   Dos ST sin numero no colisionan, que es el comportamiento buscado —nro_st es
--   nullable en el esquema aunque la UI lo exija—.
--
-- SEGURIDAD ANTE DATOS EXISTENTES
--   PRODUCCION y STAGING tienen 0 filas hoy, pero la migracion no lo asume. Si
--   encontrara equivalentes canonicos preexistentes ABORTA informando cuales
--   son, en lugar de crear el indice a la fuerza o de «arreglar» filas por su
--   cuenta: resolver esos duplicados es una decision operativa, no una
--   consecuencia silenciosa de una migracion.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: si el indice ya existe, sale sin tocar nada y sin
--   volver a recorrer la tabla.
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
      from pg_class i
      join pg_namespace n on n.oid = i.relnamespace
     where i.relname = 'coi_servicios_tecnicos_um_unidad_nro_st_uidx'
       and n.nspname = 'public'
  ) then
    return;
  end if;

  select string_agg(
           format('unidad_id=%s nro_st_canonico=%L (%s filas)', d.unidad_id, d.canonico, d.n),
           '; ' order by d.unidad_id, d.canonico
         )
    into v_duplicados
    from (
      select st.unidad_id,
             upper(regexp_replace(st.nro_st, '[[:space:]./-]+', '', 'g')) canonico,
             count(*) n
        from public.coi_servicios_tecnicos_um st
       where st.unidad_id is not null
         and st.nro_st is not null
       group by st.unidad_id,
                upper(regexp_replace(st.nro_st, '[[:space:]./-]+', '', 'g'))
      having count(*) > 1
    ) d;

  if v_duplicados is not null then
    raise exception using
      errcode = '23505',
      message = 'COI_ST_DUPLICADOS_PREEXISTENTES',
      detail = v_duplicados,
      hint = 'Resuelva los Servicios Tecnicos con numero equivalente antes de aplicar el indice unico. Esta migracion no modifica filas por su cuenta.';
  end if;

  create unique index coi_servicios_tecnicos_um_unidad_nro_st_uidx
    on public.coi_servicios_tecnicos_um (
      unidad_id,
      (upper(regexp_replace(nro_st, '[[:space:]./-]+', '', 'g')))
    )
    where unidad_id is not null and nro_st is not null;
end $$;

comment on index public.coi_servicios_tecnicos_um_unidad_nro_st_uidx is
  'Un Servicio Tecnico por Unidad de Mantenimiento y numero canonico (sin espacios, puntos, barras ni guiones, en mayusculas). Coincide con claveST() del frontend. La comprobacion previa de la UI es UX; la autoridad ante concurrencia es este indice.';
