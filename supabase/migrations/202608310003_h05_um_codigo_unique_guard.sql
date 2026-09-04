-- =====================================================================
-- H05 — Un codigo de Unidad de Mantenimiento canonico por inventario
-- =====================================================================
--
-- MOTIVO
--   El frontend busca las UM por una forma normalizada del codigo: para la UI,
--   «ASC-001», «asc001» y «ASC / 001» son la misma unidad. PostgreSQL, en
--   cambio, solo tiene el UNIQUE literal y sensible a mayusculas que creo el
--   baseline:
--
--     coi_unidades_mantenimiento_codigo_um_key UNIQUE (codigo_um)
--
--   Es decir que la base es MAS PERMISIVA que la propia interfaz: dos operadores
--   concurrentes pueden insertar variantes que pasan el UNIQUE y que despues la
--   UI trata como una sola UM, con el ST de una apareciendo bajo la otra.
--
--   Mismo criterio que 202608310001 para el numero de ST: la autoridad ante
--   concurrencia tiene que estar en la base, y tiene que comparar igual que la
--   aplicacion.
--
-- ALCANCE
--   Se AGREGA un indice unico de expresion. El constraint literal existente NO se
--   toca: sigue siendo la unicidad exacta y esta es una defensa adicional sobre
--   la forma canonica. No se recrea la tabla, no se copian filas, no se elimina
--   ni modifica ningun dato, y no se toca RLS, policies ni grants.
--
--   El valor original de codigo_um se conserva tal cual para mostrarlo: se
--   normaliza la clave de unicidad, no el dato.
--
--     upper(regexp_replace(codigo_um, '[[:space:]./-]+', '', 'g'))
--
--   que es exactamente lo que hace claveUM() en index.html.
--
-- NULOS
--   El indice es parcial sobre codigo_um is not null. En la practica la columna
--   es NOT NULL, pero declararlo parcial deja la intencion explicita y hace el
--   indice equivalente al de ST, que si necesita el filtro.
--
-- SEGURIDAD ANTE DATOS EXISTENTES
--   PRODUCCION y STAGING tienen 0 UM hoy, pero la migracion no lo asume: si
--   encontrara codigos equivalentes preexistentes ABORTA informando cuales son,
--   en lugar de crear el indice a la fuerza o de «arreglar» filas por su cuenta.
--   Resolver esos duplicados es una decision operativa.
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
     where i.relname = 'coi_unidades_mantenimiento_codigo_um_canonico_uidx'
       and n.nspname = 'public'
  ) then
    return;
  end if;

  select string_agg(
           format('codigo_um_canonico=%L (%s filas)', d.canonico, d.n),
           '; ' order by d.canonico
         )
    into v_duplicados
    from (
      select upper(regexp_replace(um.codigo_um, '[[:space:]./-]+', '', 'g')) canonico,
             count(*) n
        from public.coi_unidades_mantenimiento um
       where um.codigo_um is not null
       group by upper(regexp_replace(um.codigo_um, '[[:space:]./-]+', '', 'g'))
      having count(*) > 1
    ) d;

  if v_duplicados is not null then
    raise exception using
      errcode = '23505',
      message = 'COI_UM_CODIGO_DUPLICADO_CANONICO',
      detail = v_duplicados,
      hint = 'Resuelva las Unidades de Mantenimiento con codigo equivalente antes de aplicar el indice unico. Esta migracion no modifica filas por su cuenta.';
  end if;

  create unique index coi_unidades_mantenimiento_codigo_um_canonico_uidx
    on public.coi_unidades_mantenimiento (
      (upper(regexp_replace(codigo_um, '[[:space:]./-]+', '', 'g')))
    )
    where codigo_um is not null;
end $$;

comment on index public.coi_unidades_mantenimiento_codigo_um_canonico_uidx is
  'Un codigo de UM por inventario en su forma canonica (sin espacios, puntos, barras ni guiones, en mayusculas). Coincide con claveUM() del frontend. Se suma al UNIQUE literal del baseline, que no se modifica.';
