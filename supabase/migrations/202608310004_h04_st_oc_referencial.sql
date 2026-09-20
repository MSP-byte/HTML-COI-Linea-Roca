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
-- SERIALIZACION CONTRA LA RENUMERACION — MODOS DE LOCK
--   Correr BEFORE cierra la ventana entre validar y escribir DENTRO de la misma
--   sentencia, pero no serializa contra OTRA transaccion. El trigger toma
--   entonces un ROW LOCK sobre la fila maestra de coi_ordenes ANTES de derivar o
--   copiar nro_oc, en las dos rutas de resolucion —llega orden_id, o llega
--   nro_oc y hay que resolver su UUID—. El MODO del lock depende de la
--   operacion, y esa diferencia es el nucleo de esta decision:
--
--     INSERT  ->  select ... for update            (bloqueante)
--     UPDATE  ->  select ... for update nowait     (no espera nunca)
--
--   POR QUE EL INSERT LOCKEA Y ESPERA
--     T1  insert de ST: el trigger lee coi_ordenes y ve el numero VIEJO
--     T2  coi_renumerar_oc: cambia coi_ordenes.nro_oc y sincroniza las tablas
--         dependientes. La fila de T1 TODAVIA NO EXISTE, asi que su UPDATE de
--         sincronizacion no puede alcanzarla. T2 commitea.
--     T1  commitea.
--
--   Quedaba orden_id CORRECTO y nro_oc VIEJO: la referencia tecnica sana, el
--   dato visible mintiendo, y la verificacion post-sync del RPC («ningun ST
--   puede seguir con el numero anterior») ya habia pasado. El lock bloqueante lo
--   cierra: o T1 lo gana y T2 espera —y luego alcanza el ST ya confirmado y lo
--   renumera—, o T2 lo gana y T1 relee bajo lock el numero NUEVO.
--
--   Esperar es seguro aca porque cuando el trigger pide el lock la fila ST
--   todavia no esta insertada: la renumeracion no puede estar esperandola.
--
--   POR QUE EL UPDATE **NO PUEDE** ESPERAR
--     Al actualizar una fila existente, PostgreSQL bloquea el tuple objetivo
--     (GetTupleForTrigger) ANTES de disparar el BEFORE ROW UPDATE. Cuando el
--     trigger corre, la fila ST YA ESTA LOCKEADA. Un FOR UPDATE bloqueante daria
--     el orden «fila ST -> coi_ordenes», mientras que coi_renumerar_oc toma
--     «coi_ordenes -> fila ST»: un ciclo de espera, es decir DEADLOCK entre
--     editar un ST y renumerar su OC.
--
--   POR QUE TAMPOCO ALCANZA NO LOCKEAR EN EL UPDATE
--     Se penso que bastaba con el lock que el executor ya tiene sobre la fila
--     ST, porque el UPDATE de sincronizacion del RPC se bloquea en ella. Eso es
--     cierto SOLO si el ST ya pertenecia a la orden que se renumera. En una
--     REASOCIACION no:
--
--       ST confirmado contra la OC A.
--       T1  UPDATE del ST para reasociarlo a la OC B. Queda lockeada la fila ST.
--           El trigger lee B y ve su numero viejo.
--       T2  coi_renumerar_oc sobre B. Lockea B. Para T2 ese ST todavia pertenece
--           a A —el cambio de T1 no esta confirmado—, asi que su sincronizacion
--           de B NO alcanza esa fila. T2 commitea.
--       T1  commitea: orden_id de B, nro_oc VIEJO de B.
--
--     El mismo defecto que en el INSERT, por la misma razon de fondo: durante la
--     reasociacion la fila todavia no es visible para el RPC como parte de B.
--
--   POR ESO: FOR UPDATE NOWAIT
--     NOWAIT no espera nunca, de modo que no puede participar de un ciclo de
--     espera: el deadlock queda descartado por construccion, no por un orden de
--     adquisicion que haya que sostener a mano.
--
--       A) si coi_renumerar_oc ya tiene el lock de la OC, el NOWAIT falla en el
--          acto, el UPDATE del ST aborta y libera la fila ST. No se confirma un
--          numero viejo;
--       B) si el UPDATE del ST gana el lock, la renumeracion espera la OC; el ST
--          se confirma, y despues el RPC lo ve y lo deja con el numero nuevo;
--       C) si el UPDATE lo hace la propia coi_renumerar_oc, que ya posee el lock
--          de esa OC, volver a pedirlo desde la MISMA transaccion no conflictua
--          y la sincronizacion sigue de largo.
--
--   ERROR DE CONCURRENCIA — FAIL-CLOSED
--     El caso A no se oculta ni se reintenta desde el trigger: se captura
--     lock_not_available (SQLSTATE 55P03) y se levanta COI_ST_OC_CONCURRENCIA
--     con un hint para actualizar y reintentar. Continuar sin lock seria volver
--     al defecto original; reintentar dentro del trigger esconderia una
--     renumeracion en curso que el operador tiene que ver.
--
--     Costo conocido y aceptado: FOR UPDATE tambien conflictua con el FOR KEY
--     SHARE que toman las verificaciones de FK, de modo que un alta concurrente
--     de otro ST sobre la MISMA orden puede hacer fallar una reasociacion con
--     COI_ST_OC_CONCURRENCIA. Es un falso positivo, no un dato corrupto, y la
--     ventana es la de una sentencia autocommit de PostgREST.
--
--   Sobre la ruta por numero: se localiza la orden por forma canonica, se lockea
--   por UUID —bloqueante o NOWAIT segun la operacion— y se relee su numero bajo
--   lock. Si en el medio esa orden se renumero, el numero que el operador
--   escribio ya no es el suyo y la asociacion se RECHAZA —el mismo criterio
--   fail-closed que ya regia para un numero inexistente—, en vez de asociar a
--   ciegas la orden que «solia» llamarse asi.
--
--   BORRADO CONCURRENTE. No hace falta lock para evitar huerfanos: la FK
--   orden_id -> coi_ordenes(id) se evalua en la escritura y es ON DELETE
--   RESTRICT. O el ST se confirma antes y el borrado de la orden se rechaza, o
--   el borrado gana y la escritura del ST falla por FK.
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
    -- ROW LOCK sobre la orden maestra ANTES de copiar el numero. En INSERT es
    -- bloqueante; en UPDATE es NOWAIT. Ver «MODOS DE LOCK» en la cabecera.
    if tg_op = 'INSERT' then
      select o.nro_oc into v_nro
        from public.coi_ordenes o
       where o.id = new.orden_id
         for update;
    else
      begin
        select o.nro_oc into v_nro
          from public.coi_ordenes o
         where o.id = new.orden_id
           for update nowait;
      exception when lock_not_available then
        -- Fail-closed: la orden esta siendo renumerada o modificada por otra
        -- transaccion. No se continua sin lock ni se reintenta desde el
        -- trigger: se corta y decide el operador.
        raise exception using
          errcode = '55P03',
          message = 'COI_ST_OC_CONCURRENCIA',
          detail = format('orden_id=%L', new.orden_id),
          hint = 'La Orden de Compra esta siendo modificada por otra operacion. Actualice y vuelva a intentar.';
      end;
    end if;

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
    -- Paso 1: localizar la orden por forma canonica. Sin lock todavia: aca solo
    -- se resuelve QUE fila hay que lockear.
    select o.id into v_id
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

    -- Paso 2: relectura del numero YA bajo lock, por UUID. Mismos modos que la
    -- ruta anterior: bloqueante en INSERT, NOWAIT en UPDATE.
    if tg_op = 'INSERT' then
      select o.nro_oc into v_nro
        from public.coi_ordenes o
       where o.id = v_id
         for update;
    else
      begin
        select o.nro_oc into v_nro
          from public.coi_ordenes o
         where o.id = v_id
           for update nowait;
      exception when lock_not_available then
        raise exception using
          errcode = '55P03',
          message = 'COI_ST_OC_CONCURRENCIA',
          detail = format('nro_oc=%L', new.nro_oc),
          hint = 'La Orden de Compra esta siendo modificada por otra operacion. Actualice y vuelva a intentar.';
      end;
    end if;

    -- La orden se elimino mientras se esperaba el lock.
    if v_nro is null then
      raise exception using
        errcode = '23503',
        message = 'COI_ST_OC_INEXISTENTE',
        detail = format('nro_oc=%L', new.nro_oc),
        hint = 'La Orden de Compra indicada no existe. Corrija el numero o deje el campo vacio.';
    end if;

    -- La orden se RENUMERO mientras se esperaba el lock: el numero que escribio
    -- el operador ya no identifica a esta orden. Fail-closed, igual que un
    -- numero inexistente: no se asocia a ciegas la orden que solia llamarse asi.
    if public.coi_normalize_order_number(v_nro)
       is distinct from public.coi_normalize_order_number(new.nro_oc) then
      raise exception using
        errcode = '23503',
        message = 'COI_ST_OC_INEXISTENTE',
        detail = format('nro_oc=%L', new.nro_oc),
        hint = 'La Orden de Compra indicada fue renumerada. Actualice y vuelva a intentar.';
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
  'Mantiene coherentes orden_id y nro_oc de un Servicio Tecnico: si llega el UUID fija el numero vigente de esa orden, y si llega solo el numero lo resuelve por coi_normalize_order_number y completa el UUID. Corre BEFORE, en la misma sentencia que la escritura, y toma un ROW LOCK sobre la fila de coi_ordenes antes de derivar el numero: bloqueante (for update) en INSERT, porque la fila ST todavia no existe y la sincronizacion de coi_renumerar_oc no puede alcanzarla; NOWAIT en UPDATE, porque el executor ya lockeo el tuple ST antes del trigger y esperar la orden invertiria el orden respecto del RPC (deadlock), mientras que no lockear dejaria pasar la reasociacion de un ST hacia una OC que se esta renumerando. Si el NOWAIT no consigue el lock levanta COI_ST_OC_CONCURRENCIA (55P03): fail-closed, sin reintento automatico.';
