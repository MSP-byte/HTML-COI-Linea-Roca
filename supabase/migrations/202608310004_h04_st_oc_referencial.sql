-- =====================================================================
-- H04 — La OC de un Servicio Tecnico es una referencia real, no un texto
-- =====================================================================
--
-- MOTIVO
--   Hasta aca la asociacion ST -> OC se sostenia en el frontend: se leia
--   coi_ordenes, se comparaba el numero y despues se escribia el ST. Eso deja
--   tres agujeros que ninguna validacion de navegador puede cerrar:
--
--     1) NORMALIZACION. El proyecto define la identidad de una OC con
--        public.coi_normalize_order_number(): «4530-008964» y «4530008964» son
--        la misma orden. Una comparacion por texto —exacta o ilike— acepta o
--        rechaza segun como el operador haya escrito el numero.
--
--     2) CARRERA. Entre el SELECT que valida y el INSERT/UPDATE que escribe hay
--        una ventana: si la OC se elimina en el medio, queda un ST apuntando a
--        una orden que ya no existe.
--
--     3) RENUMERACION. coi_renumerar_oc actualiza coi_servicios_tecnicos_um.nro_oc
--        pero no necesariamente mueve fecha_actualizacion, de modo que un
--        formulario abierto podia despues reenviar el numero viejo y «des-renumerar»
--        el ST en silencio.
--
-- DECISION
--   Se resuelve con integridad referencial de PostgreSQL, no con un RPC:
--
--     · coi_ordenes ya tiene coi_ordenes_nro_oc_uq, un indice unico sobre la
--       columna nro_oc, que sirve como destino de una foreign key;
--     · un trigger BEFORE INSERT/UPDATE resuelve el numero entrante a la forma
--       EXACTA almacenada en coi_ordenes, usando coi_normalize_order_number;
--     · la FK con ON UPDATE CASCADE propaga las renumeraciones sola;
--     · la FK con ON DELETE RESTRICT impide borrar una OC que todavia tenga
--       Servicios Tecnicos colgando.
--
--   Trigger y FK corren dentro de la MISMA sentencia que el INSERT/UPDATE, de
--   modo que no queda ninguna ventana de carrera: no hace falta —ni conviene—
--   agregar un SECURITY DEFINER nuevo con su propia superficie de permisos.
--
--   Un numero viejo o inexistente deja de poder restaurarse: la FK lo rechaza,
--   sin depender de fecha_actualizacion, que la renumeracion historica pudo no
--   haber tocado.
--
-- CONSECUENCIA SOBRE coi_renumerar_oc
--   El RPC actualiza primero coi_ordenes y despues las tablas dependientes. Con
--   la FK, la cascada ya renumero los ST cuando llega su UPDATE explicito, de
--   modo que ese UPDATE pasa a afectar 0 filas y el contador
--   'coi_servicios_tecnicos_um' de su payload informara 0. El dato queda igual
--   de renumerado —lo hace la cascada— y de forma mas confiable. No se modifica
--   el RPC: reescribir una migracion ya desplegada seria peor que documentar
--   este efecto.
--
-- NULOS
--   nro_oc sigue siendo nullable: un ST puede no citar ninguna OC. La FK no
--   valida NULL y el trigger no interviene.
--
-- SEGURIDAD ANTE DATOS EXISTENTES
--   PRODUCCION y STAGING tienen 0 ST hoy, pero la migracion no lo asume: si
--   encontrara Servicios Tecnicos cuyo nro_oc no resuelve contra ninguna OC,
--   ABORTA informando cuales, en lugar de vaciar la columna o de crear ordenes
--   por su cuenta. Regularizar esas filas es una decision operativa.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: la funcion se reemplaza con el mismo cuerpo, el
--   trigger se recrea y la FK solo se agrega si todavia no existe.
--
-- ESTADO REMOTO
--   Esta migracion NO fue aplicada a produccion ni a staging. Mientras eso no
--   ocurra, tests/fixtures/production_schema_contract.json documenta la
--   divergencia deliberada en «_divergencias_pendientes.fk».

-- ---------------------------------------------------------------------
-- 1) Resolucion canonica del numero de OC entrante.
-- ---------------------------------------------------------------------
create or replace function public.coi_st_resolver_nro_oc()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_canonico text;
begin
  if new.nro_oc is null then
    return new;
  end if;

  -- En UPDATE, si el numero no cambio no hay nada que resolver: la fila ya era
  -- consistente y revalidarla solo agregaria trabajo.
  if tg_op = 'UPDATE' and new.nro_oc is not distinct from old.nro_oc then
    return new;
  end if;

  -- Se busca la orden por su forma canonica y se adopta el texto EXACTO que la
  -- orden tiene almacenado: asi el ST guarda siempre el numero vigente, escriba
  -- el operador «4530-008964» o «4530008964».
  select o.nro_oc
    into v_canonico
    from public.coi_ordenes o
   where public.coi_normalize_order_number(o.nro_oc)
       = public.coi_normalize_order_number(new.nro_oc)
   limit 1;

  if v_canonico is null then
    raise exception using
      errcode = '23503',
      message = 'COI_ST_OC_INEXISTENTE',
      detail = format('nro_oc=%L', new.nro_oc),
      hint = 'La Orden de Compra indicada no existe. Corrija el numero o deje el campo vacio.';
  end if;

  new.nro_oc := v_canonico;
  return new;
end;
$$;

drop trigger if exists coi_st_resolver_nro_oc on public.coi_servicios_tecnicos_um;
create trigger coi_st_resolver_nro_oc
  before insert or update of nro_oc on public.coi_servicios_tecnicos_um
  for each row execute function public.coi_st_resolver_nro_oc();

-- ---------------------------------------------------------------------
-- 2) La referencia deja de ser un texto suelto.
-- ---------------------------------------------------------------------
do $$
declare
  v_huerfanos text;
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'coi_servicios_tecnicos_um_nro_oc_fkey'
       and conrelid = 'public.coi_servicios_tecnicos_um'::regclass
  ) then
    return;
  end if;

  select string_agg(format('%L', st.nro_oc), '; ' order by st.nro_oc)
    into v_huerfanos
    from (
      select distinct s.nro_oc
        from public.coi_servicios_tecnicos_um s
       where s.nro_oc is not null
         and not exists (
           select 1 from public.coi_ordenes o
            where public.coi_normalize_order_number(o.nro_oc)
                = public.coi_normalize_order_number(s.nro_oc)
         )
    ) st;

  if v_huerfanos is not null then
    raise exception using
      errcode = '23503',
      message = 'COI_ST_OC_HUERFANAS_PREEXISTENTES',
      detail = v_huerfanos,
      hint = 'Regularice los Servicios Tecnicos que citan una OC inexistente antes de aplicar la integridad referencial. Esta migracion no modifica ni vacia filas.';
  end if;

  -- Se normalizan primero los valores que difieren solo en formato, para que la
  -- FK pueda crearse sobre datos ya canonicos. Solo toca filas que YA apuntan a
  -- una orden real: no inventa, no borra y no cambia a que OC pertenece un ST.
  update public.coi_servicios_tecnicos_um s
     set nro_oc = o.nro_oc
    from public.coi_ordenes o
   where s.nro_oc is not null
     and s.nro_oc <> o.nro_oc
     and public.coi_normalize_order_number(o.nro_oc)
       = public.coi_normalize_order_number(s.nro_oc);

  alter table public.coi_servicios_tecnicos_um
    add constraint coi_servicios_tecnicos_um_nro_oc_fkey
    foreign key (nro_oc)
    references public.coi_ordenes(nro_oc)
    on update cascade
    on delete restrict;
end $$;

comment on constraint coi_servicios_tecnicos_um_nro_oc_fkey
  on public.coi_servicios_tecnicos_um is
  'La OC de un Servicio Tecnico es una referencia real: ON UPDATE CASCADE sigue las renumeraciones y ON DELETE RESTRICT impide borrar una orden que todavia tiene historial tecnico asociado.';

comment on function public.coi_st_resolver_nro_oc() is
  'Resuelve el nro_oc entrante de un Servicio Tecnico a la forma exacta almacenada en coi_ordenes, comparando por coi_normalize_order_number. Corre BEFORE, en la misma sentencia que la escritura: no queda ventana de carrera entre validar y escribir.';
