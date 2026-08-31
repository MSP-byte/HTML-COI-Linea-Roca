-- =====================================================================
-- H04 — La OC de un Servicio Tecnico es una referencia real por UUID
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
--     3) RENUMERACION. nro_oc es un identificador de NEGOCIO y es renumerable.
--        Colgar de el la relacion tecnica ata la identidad del vinculo a un
--        texto que cambia.
--
-- DECISION — LA IDENTIDAD ES coi_ordenes.id
--   La identidad maestra de una Orden de Compra en este repositorio es su UUID:
--   coi_ordenes.id. Todas las tablas modernas —coi_certificaciones,
--   coi_posiciones_oc, coi_documentos_oc, coi_alertas, coi_historial_oc…— la
--   referencian por orden_id y llevan nro_oc solo como dato denormalizado.
--   coi_servicios_tecnicos_um era la excepcion: 20260813033959 lo dice con
--   todas las letras («tabla que posee nro_oc pero no orden_id», «TABLA LEGACY
--   UM · No posee orden_id»). Esta migracion cierra esa excepcion.
--
--     · se agrega coi_servicios_tecnicos_um.orden_id uuid, NULLABLE;
--     · la FK tecnica es orden_id -> coi_ordenes(id) ON DELETE RESTRICT:
--       no se puede borrar una OC que todavia tiene historial tecnico;
--     · nro_oc SIGUE existiendo, pero como dato visible/denormalizado —lo que
--       el operador lee y escribe—, NO como referencia tecnica;
--     · un trigger BEFORE mantiene los dos campos coherentes en la misma
--       sentencia que la escritura, de modo que no queda ventana de carrera.
--
--   Renumerar una OC NO cambia su UUID. Por lo tanto una renumeracion no puede
--   mover, romper ni reasignar la relacion ST -> OC: eso ahora es estructural,
--   no una propiedad que dependa de propagar texto.
--
-- REGLAS DEL TRIGGER
--   · llega orden_id            -> se busca la OC por UUID y nro_oc se fija al
--                                  numero VIGENTE de esa orden. La identidad
--                                  tecnica tiene precedencia cuando es lo que
--                                  esta sentencia trae o cambia;
--   · cambia solo nro_oc        -> se resuelve con coi_normalize_order_number()
--                                  y se completan AMBOS campos. Asi el operador
--                                  puede mover el ST a otra OC escribiendo el
--                                  numero, y un numero que ya no existe —el de
--                                  una OC renumerada— se rechaza;
--   · los dos en NULL           -> permitido: un ST puede no citar ninguna OC;
--   · la OC no existe           -> se rechaza. Fail-closed: no se guarda una
--                                  asociacion que no se pudo verificar.
--
-- CONSECUENCIA SOBRE coi_renumerar_oc
--   El RPC sigue siendo el UNICO camino que cambia coi_ordenes.nro_oc: el RPC
--   atomico de edicion de ordenes no admite nro_oc entre sus campos permitidos,
--   y coi_order_number_guard solo normaliza el valor entrante.
--
--   El RPC actualiza primero coi_ordenes y despues las tablas dependientes, de
--   modo que cuando llega su UPDATE sobre coi_servicios_tecnicos_um el trigger
--   ya lee el numero nuevo y lo confirma. Ese UPDATE conserva su recuento real
--   —no hay ninguna cascada que se le adelante— y su verificacion post-sync
--   («ningun ST puede seguir con el numero anterior») sigue siendo una garantia
--   dura: si un ST quedara con el numero viejo, la renumeracion entera aborta.
--
--   No se modifica el RPC. Su preflight excluye a coi_servicios_tecnicos_um
--   porque la tabla no tenia orden_id; ese preflight busca filas que citen el
--   numero anterior apuntando a OTRO orden_id, y con este trigger esa
--   combinacion es inalcanzable: nro_oc se deriva siempre del orden_id de la
--   propia fila. Reescribir una migracion ya desplegada para agregar un control
--   que no puede disparar seria peor que documentarlo.
--
-- NULOS
--   nro_oc y orden_id son ambos nullable y se mueven juntos: o hay OC —y estan
--   los dos— o no la hay —y no esta ninguno—.
--
-- SEGURIDAD ANTE DATOS EXISTENTES
--   PRODUCCION y STAGING tienen 0 ST hoy, pero la migracion no lo asume: si
--   encontrara Servicios Tecnicos cuyo nro_oc no resuelve contra ninguna OC,
--   ABORTA informando cuales, en lugar de vaciar la columna, borrar filas o
--   crear ordenes por su cuenta. Regularizarlas es una decision operativa.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: la columna y el indice se agregan solo si faltan,
--   la funcion se reemplaza con el mismo cuerpo, el trigger se recrea y la FK
--   solo se agrega si todavia no existe.
--
-- ESTADO REMOTO
--   Esta migracion NO fue aplicada a produccion ni a staging. Mientras eso no
--   ocurra, tests/fixtures/production_schema_contract.json documenta las
--   divergencias deliberadas en «_divergencias_pendientes.columnas» (la columna
--   orden_id) y «_divergencias_pendientes.fk» (la FK sobre orden_id).

-- ---------------------------------------------------------------------
-- 1) La columna que faltaba: la referencia tecnica por UUID.
-- ---------------------------------------------------------------------
alter table public.coi_servicios_tecnicos_um
  add column if not exists orden_id uuid;

comment on column public.coi_servicios_tecnicos_um.orden_id is
  'Identidad tecnica de la Orden de Compra asociada (coi_ordenes.id). Renumerar la OC no la altera. nro_oc es el numero visible derivado de esta referencia.';

-- El chequeo de ON DELETE RESTRICT recorre la tabla hija en cada borrado de
-- orden: sin indice seria un seq scan y un lock mas amplio del necesario.
create index if not exists coi_servicios_tecnicos_um_orden_id_idx
  on public.coi_servicios_tecnicos_um (orden_id);

-- La relacion tecnica NO cuelga del numero de negocio. Si una version anterior
-- de esta misma migracion llego a crear esa FK en algun entorno de desarrollo,
-- se retira: nro_oc queda como dato denormalizado.
alter table public.coi_servicios_tecnicos_um
  drop constraint if exists coi_servicios_tecnicos_um_nro_oc_fkey;

-- ---------------------------------------------------------------------
-- 2) Coherencia entre la referencia tecnica y el numero visible.
-- ---------------------------------------------------------------------
create or replace function public.coi_st_resolver_nro_oc()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_nro text;
  v_id  uuid;
  v_orden_cambio boolean;
  v_nro_cambio boolean;
begin
  -- En UPDATE, si ni la referencia ni el numero cambiaron no hay nada que
  -- resolver: la fila ya era coherente y revalidarla solo agregaria trabajo.
  if tg_op = 'UPDATE'
     and new.orden_id is not distinct from old.orden_id
     and new.nro_oc is not distinct from old.nro_oc then
    return new;
  end if;

  -- Cual de los dos campos trae la intencion de ESTA sentencia. Sin esta
  -- distincion la precedencia seria ambigua: si el UUID ganara siempre, un
  -- operador no podria mover el ST a otra OC escribiendo el numero —el trigger
  -- le devolveria el de la orden vieja—; y si ganara siempre el numero, un
  -- formulario abierto antes de una renumeracion podria des-renumerar el ST.
  v_orden_cambio := tg_op = 'INSERT' or new.orden_id is distinct from old.orden_id;
  v_nro_cambio := tg_op = 'INSERT' or new.nro_oc is distinct from old.nro_oc;

  -- Caso 1: manda la identidad tecnica. Cuando llega, cuando cambia, o cuando el
  -- numero se vacio pero la referencia sigue puesta: el numero visible se toma de
  -- la orden, que es la unica que sabe cual es el vigente.
  if new.orden_id is not null
     and (v_orden_cambio or not v_nro_cambio or new.nro_oc is null) then
    select o.nro_oc into v_nro
      from public.coi_ordenes o
     where o.id = new.orden_id;

    if v_nro is null then
      raise exception using
        errcode = '23503',
        message = 'COI_ST_OC_INEXISTENTE',
        detail = format('orden_id=%L', new.orden_id),
        hint = 'La Orden de Compra referenciada no existe.';
    end if;

    new.nro_oc := v_nro;
    return new;
  end if;

  -- Caso 2: lo que cambio es el numero. Se resuelve por forma canonica y se
  -- completan los dos campos: asi el vinculo queda anclado al UUID aunque el
  -- operador solo haya escrito el numero. Un numero que ya no existe —el de una
  -- OC renumerada, reenviado por un formulario viejo— se rechaza aca.
  if new.nro_oc is not null then
    select o.id, o.nro_oc into v_id, v_nro
      from public.coi_ordenes o
     where public.coi_normalize_order_number(o.nro_oc)
         = public.coi_normalize_order_number(new.nro_oc)
     limit 1;

    if v_id is null then
      raise exception using
        errcode = '23503',
        message = 'COI_ST_OC_INEXISTENTE',
        detail = format('nro_oc=%L', new.nro_oc),
        hint = 'La Orden de Compra indicada no existe. Corrija el numero o deje el campo vacio.';
    end if;

    new.orden_id := v_id;
    new.nro_oc := v_nro;
    return new;
  end if;

  -- Caso 3: ni referencia ni numero. Un ST puede no citar ninguna OC.
  return new;
end;
$$;

drop trigger if exists coi_st_resolver_nro_oc on public.coi_servicios_tecnicos_um;
create trigger coi_st_resolver_nro_oc
  before insert or update of nro_oc, orden_id on public.coi_servicios_tecnicos_um
  for each row execute function public.coi_st_resolver_nro_oc();

-- ---------------------------------------------------------------------
-- 3) Backfill y foreign key sobre la identidad tecnica.
-- ---------------------------------------------------------------------
do $$
declare
  v_huerfanos text;
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'coi_servicios_tecnicos_um_orden_id_fkey'
       and conrelid = 'public.coi_servicios_tecnicos_um'::regclass
  ) then
    return;
  end if;

  -- PREFLIGHT. Todo ST que cite una OC tiene que poder resolverla. Si alguno no
  -- resuelve, la migracion ABORTA: no se vacia la columna ni se borra la fila.
  select string_agg(format('%L', st.nro_oc), '; ' order by st.nro_oc)
    into v_huerfanos
    from (
      select distinct s.nro_oc
        from public.coi_servicios_tecnicos_um s
       where s.nro_oc is not null
         and s.orden_id is null
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

  -- BACKFILL. Se completa orden_id de las filas que ya citaban una OC real. El
  -- trigger, al ver la referencia, deja nro_oc en la forma vigente de la orden.
  -- Solo toca filas que YA apuntaban a una orden existente: no inventa, no
  -- borra y no cambia a que OC pertenece un ST.
  update public.coi_servicios_tecnicos_um s
     set orden_id = o.id
    from public.coi_ordenes o
   where s.orden_id is null
     and s.nro_oc is not null
     and public.coi_normalize_order_number(o.nro_oc)
       = public.coi_normalize_order_number(s.nro_oc);

  alter table public.coi_servicios_tecnicos_um
    add constraint coi_servicios_tecnicos_um_orden_id_fkey
    foreign key (orden_id)
    references public.coi_ordenes(id)
    on delete restrict;
end $$;

comment on constraint coi_servicios_tecnicos_um_orden_id_fkey
  on public.coi_servicios_tecnicos_um is
  'La OC de un Servicio Tecnico es una referencia real por UUID: ON DELETE RESTRICT impide borrar una orden que todavia tiene historial tecnico asociado. Renumerar la OC no altera esta referencia.';

comment on function public.coi_st_resolver_nro_oc() is
  'Mantiene coherentes orden_id y nro_oc de un Servicio Tecnico: si llega el UUID fija el numero vigente de esa orden, y si llega solo el numero lo resuelve por coi_normalize_order_number y completa el UUID. Corre BEFORE, en la misma sentencia que la escritura: no queda ventana de carrera entre validar y escribir.';
