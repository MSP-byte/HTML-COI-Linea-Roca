-- COI Linea Roca - endurecimiento para candidato de release.
-- Cierra bypass de DML directo, completa la atomicidad de estaciones,
-- vincula la idempotencia al usuario/operacion y protege identidades maestras.
--
-- PRECONDICION: ejecutar public.coi_preflight_integridad() y exigir cero en
-- duplicados de OC/posiciones/estaciones y exactamente una estacion principal
-- por orden. Ante cualquier excepcion, PostgreSQL revierte toda la migracion.

begin;

-- -------------------------------------------------------------------------
-- Esquema canonico e integridad previa
-- -------------------------------------------------------------------------

create or replace function public.coi_normalize_order_number(p_value text)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select nullif(
    upper(
      regexp_replace(
        regexp_replace(
          trim(p_value),
          '^(O(RDEN)?[[:space:]]*(DE[[:space:]]*)?C(OMPRA)?|OC)[[:space:]]*[:#-]?[[:space:]]*',
          '',
          'i'
        ),
        '[^A-Z0-9]',
        '',
        'g'
      )
    ),
    ''
  )
$$;

do $$
declare
  v_duplicate text;
begin
  select public.coi_normalize_order_number(o.nro_oc)
    into v_duplicate
    from public.coi_ordenes o
   group by public.coi_normalize_order_number(o.nro_oc)
  having count(*) > 1
   order by 1
   limit 1;
  if v_duplicate is not null then
    raise exception using
      errcode = '23505',
      message = 'COI_DUPLICATE_CANONICAL_ORDER_NUMBER',
      detail = v_duplicate,
      hint = 'Resolver manualmente los duplicados informados por coi_preflight_integridad antes de migrar.';
  end if;
end;
$$;

create unique index if not exists coi_ordenes_nro_oc_normalizado_uq
  on public.coi_ordenes (public.coi_normalize_order_number(nro_oc));

create or replace function public.coi_order_number_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.nro_oc := public.coi_normalize_order_number(new.nro_oc);
  if new.nro_oc is null then
    raise exception using errcode = '23514', message = 'COI_ORDER_NUMBER_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists coi_ordenes_number_guard on public.coi_ordenes;
create trigger coi_ordenes_number_guard
before insert or update of nro_oc on public.coi_ordenes
for each row execute function public.coi_order_number_guard();

alter table public.coi_ordenes_estaciones
  alter column id set default gen_random_uuid();
alter table public.coi_ordenes_estaciones add column if not exists nro_oc text;
alter table public.coi_ordenes_estaciones add column if not exists tipo_alcance text not null default 'General';
alter table public.coi_ordenes_estaciones add column if not exists descripcion_alcance text;
alter table public.coi_ordenes_estaciones add column if not exists estado text not null default 'Activa';
alter table public.coi_ordenes_estaciones add column if not exists observaciones text;
alter table public.coi_ordenes_estaciones add column if not exists fecha_inicio date;
alter table public.coi_ordenes_estaciones add column if not exists fecha_fin date;
alter table public.coi_ordenes_estaciones add column if not exists creado_por uuid;
alter table public.coi_ordenes_estaciones add column if not exists actualizado_por uuid;
alter table public.coi_ordenes_estaciones add column if not exists fecha_creacion timestamptz not null default clock_timestamp();
alter table public.coi_ordenes_estaciones add column if not exists fecha_actualizacion timestamptz not null default clock_timestamp();

update public.coi_ordenes_estaciones oe
   set nro_oc = o.nro_oc
  from public.coi_ordenes o
 where o.id = oe.orden_id
   and oe.nro_oc is distinct from o.nro_oc;

do $$
declare
  v_bad_order uuid;
  v_duplicate uuid;
begin
  select o.id
    into v_bad_order
    from public.coi_ordenes o
    left join public.coi_ordenes_estaciones oe
      on oe.orden_id = o.id and oe.es_principal is true
   group by o.id
  having count(oe.id) <> 1
   order by o.id
   limit 1;
  if v_bad_order is not null then
    raise exception using
      errcode = '23514',
      message = 'COI_ORDER_REQUIRES_ONE_PRINCIPAL_STATION',
      detail = v_bad_order::text,
      hint = 'Corregir la estacion principal con el procedimiento de preproduccion antes de migrar.';
  end if;

  select oe.orden_id
    into v_duplicate
    from public.coi_ordenes_estaciones oe
   group by
     oe.orden_id,
     upper(trim(coalesce(oe.estacion, ''))),
     upper(trim(coalesce(oe.sector, '')))
  having count(*) > 1
   order by oe.orden_id
   limit 1;
  if v_duplicate is not null then
    raise exception using
      errcode = '23505',
      message = 'COI_DUPLICATE_ORDER_STATION',
      detail = v_duplicate::text,
      hint = 'Resolver manualmente las asociaciones duplicadas informadas por coi_preflight_integridad.';
  end if;

  if exists (select 1 from public.coi_ordenes_estaciones where nro_oc is null) then
    raise exception using errcode = '23503', message = 'COI_STATION_ORDER_NOT_FOUND';
  end if;
end;
$$;

alter table public.coi_ordenes_estaciones alter column nro_oc set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.coi_ordenes_estaciones'::regclass
       and conname = 'coi_ordenes_estaciones_fechas_ck'
  ) then
    alter table public.coi_ordenes_estaciones
      add constraint coi_ordenes_estaciones_fechas_ck
      check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio);
  end if;
end;
$$;

create unique index if not exists coi_ordenes_estaciones_scope_uq
  on public.coi_ordenes_estaciones (
    orden_id,
    upper(trim(coalesce(estacion, ''))),
    upper(trim(coalesce(sector, '')))
  );
create index if not exists coi_ordenes_estaciones_nro_idx
  on public.coi_ordenes_estaciones (nro_oc, es_principal desc, estacion);

-- -------------------------------------------------------------------------
-- Saldos, identidades de posiciones y estaciones
-- -------------------------------------------------------------------------

create or replace function public.coi_sync_order_balance(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total numeric(20,2);
  v_consumed numeric(20,2);
begin
  select coalesce(o.monto_total, 0)
    into v_total
    from public.coi_ordenes o
   where o.id = p_order_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  select coalesce(sum(p.monto_consumido), 0)
    into v_consumed
    from public.coi_posiciones_oc p
   where p.orden_id = p_order_id;

  if v_total + 0.01 < v_consumed then
    raise exception using
      errcode = '23514',
      message = 'COI_ORDER_AMOUNT_BELOW_CONSUMED',
      detail = format('Monto OC: %s. Monto consumido: %s.', v_total, v_consumed);
  end if;

  update public.coi_ordenes
     set saldo_remanente = greatest(v_total - v_consumed, 0)
   where id = p_order_id;
end;
$$;

do $$
declare
  v_order record;
begin
  for v_order in select id from public.coi_ordenes order by id loop
    perform public.coi_sync_order_balance(v_order.id);
  end loop;
end;
$$;

create or replace function public.coi_position_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nro_oc text;
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.orden_id is distinct from old.orden_id
    or new.nro_oc is distinct from old.nro_oc
    or new.posicion is distinct from old.posicion
  ) then
    raise exception using errcode = '23514', message = 'COI_POSITION_IDENTITY_IMMUTABLE';
  end if;

  select o.nro_oc into v_nro_oc
    from public.coi_ordenes o
   where o.id = new.orden_id;
  if not found then
    raise exception using errcode = '23503', message = 'COI_POSITION_ORDER_NOT_FOUND';
  end if;

  if tg_op = 'INSERT' then
    new.nro_oc := v_nro_oc;
    new.posicion := upper(trim(replace(new.posicion, ',', '.')));
    if nullif(new.posicion, '') is null then
      raise exception using errcode = '23514', message = 'COI_POSITION_NUMBER_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists coi_posiciones_identity_guard on public.coi_posiciones_oc;
create trigger coi_posiciones_identity_guard
before insert or update on public.coi_posiciones_oc
for each row execute function public.coi_position_identity_guard();

create or replace function public.coi_station_write_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nro_oc text;
begin
  if tg_op = 'UPDATE' and new.orden_id is distinct from old.orden_id then
    raise exception using errcode = '23514', message = 'COI_STATION_ORDER_IMMUTABLE';
  end if;

  select o.nro_oc into v_nro_oc
    from public.coi_ordenes o
   where o.id = new.orden_id;
  if not found then
    raise exception using errcode = '23503', message = 'COI_STATION_ORDER_NOT_FOUND';
  end if;

  new.nro_oc := v_nro_oc;
  new.estacion := nullif(regexp_replace(trim(coalesce(new.estacion, '')), '[[:space:]]+', ' ', 'g'), '');
  new.ramal := nullif(regexp_replace(trim(coalesce(new.ramal, '')), '[[:space:]]+', ' ', 'g'), '');
  new.sector := nullif(regexp_replace(trim(coalesce(new.sector, '')), '[[:space:]]+', ' ', 'g'), '');
  if new.estacion is null then
    raise exception using errcode = '23514', message = 'COI_STATION_REQUIRED';
  end if;
  if new.fecha_fin is not null and new.fecha_inicio is not null and new.fecha_fin < new.fecha_inicio then
    raise exception using errcode = '23514', message = 'COI_STATION_INVALID_DATE_RANGE';
  end if;

  if tg_op = 'INSERT' then
    new.creado_por := auth.uid();
    new.fecha_creacion := coalesce(new.fecha_creacion, clock_timestamp());
  else
    new.creado_por := old.creado_por;
    new.fecha_creacion := old.fecha_creacion;
  end if;
  new.actualizado_por := auth.uid();
  new.fecha_actualizacion := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists coi_ordenes_estaciones_write_guard on public.coi_ordenes_estaciones;
create trigger coi_ordenes_estaciones_write_guard
before insert or update on public.coi_ordenes_estaciones
for each row execute function public.coi_station_write_guard();

create or replace function public.coi_sync_order_from_principal_station()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.es_principal is true and (
    tg_op = 'INSERT'
    or old.es_principal is distinct from new.es_principal
    or old.estacion is distinct from new.estacion
    or old.ramal is distinct from new.ramal
    or old.sector is distinct from new.sector
  ) then
    update public.coi_ordenes
       set estacion = new.estacion,
           ramal = new.ramal,
           sector = new.sector
     where id = new.orden_id;
  end if;
  return new;
end;
$$;

drop trigger if exists coi_ordenes_estaciones_sync_order on public.coi_ordenes_estaciones;
create trigger coi_ordenes_estaciones_sync_order
after insert or update on public.coi_ordenes_estaciones
for each row execute function public.coi_sync_order_from_principal_station();

create or replace function public.coi_assert_one_principal_station()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_count integer;
begin
  if tg_table_name = 'coi_ordenes' then
    v_order_id := new.id;
  elsif tg_op = 'DELETE' then
    v_order_id := old.orden_id;
  else
    v_order_id := new.orden_id;
  end if;

  if exists (select 1 from public.coi_ordenes where id = v_order_id) then
    select count(*) into v_count
      from public.coi_ordenes_estaciones
     where orden_id = v_order_id
       and es_principal is true;
    if v_count <> 1 then
      raise exception using
        errcode = '23514',
        message = 'COI_ORDER_REQUIRES_ONE_PRINCIPAL_STATION',
        detail = format('Orden %s: estaciones principales %s.', v_order_id, v_count);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists coi_ordenes_one_principal_ck on public.coi_ordenes;
create constraint trigger coi_ordenes_one_principal_ck
after insert on public.coi_ordenes
deferrable initially deferred
for each row execute function public.coi_assert_one_principal_station();

drop trigger if exists coi_estaciones_one_principal_ck on public.coi_ordenes_estaciones;
create constraint trigger coi_estaciones_one_principal_ck
after insert or update or delete on public.coi_ordenes_estaciones
deferrable initially deferred
for each row execute function public.coi_assert_one_principal_station();

-- -------------------------------------------------------------------------
-- RPC de orden y estaciones: todas las escrituras core quedan en servidor
-- -------------------------------------------------------------------------

create or replace function public.coi_guardar_orden_integral(
  p_orden_id uuid,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order_id uuid;
  v_existing public.coi_ordenes%rowtype;
  v_after jsonb;
  v_update jsonb;
  v_nro_oc text;
  v_key text;
  v_invalid text[];
  v_action text;
  v_found boolean := false;
begin
  v_role := public.coi_assert_role(array[
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ]);
  if jsonb_typeof(p_datos) <> 'object' then
    raise exception using errcode = '22023', message = 'COI_INVALID_ORDER_PAYLOAD';
  end if;

  select array_agg(key order by key)
    into v_invalid
    from jsonb_object_keys(p_datos) key
   where key <> all(array[
     'id_obra', 'nro_oc', 'tipo', 'tipo_trabajo', 'especialidad', 'descripcion',
     'proveedor', 'estacion', 'ramal', 'sector', 'expediente', 'monto_total',
     'moneda', 'fecha_acta_inicio', 'plazo_dias', 'fecha_vencimiento',
     'proxima_certificacion', 'fecha_recepcion_documentacion',
     'fecha_envio_planificacion', 'estado_coi', 'estado_documental',
     'estado_registro', 'observaciones', 'saldo_remanente',
     'certificable_con_saldo', 'justificacion_administrativa',
     'link_documental_principal', 'estado_link_documental',
     'calidad_datos_estado', 'calidad_datos_score', 'prioridad_operativa',
     'responsable_coi', 'fecha_ultimo_control', 'requiere_accion',
     'motivo_requiere_accion', 'estado_envio_pyc', 'fecha_cierre_operativo',
     'observacion_cierre', 'control_terceros_hasta', 'control_terceros_estado'
   ]);
  if coalesce(array_length(v_invalid, 1), 0) > 0 then
    raise exception using
      errcode = '22023',
      message = 'COI_PROTECTED_OR_UNKNOWN_ORDER_FIELD',
      detail = array_to_string(v_invalid, ', ');
  end if;

  v_nro_oc := public.coi_normalize_order_number(p_datos ->> 'nro_oc');
  if p_orden_id is not null then
    select * into v_existing
      from public.coi_ordenes o
     where o.id = p_orden_id
     for update;
    v_found := found;
  elsif v_nro_oc is not null then
    select * into v_existing
      from public.coi_ordenes o
     where public.coi_normalize_order_number(o.nro_oc) = v_nro_oc
     for update;
    v_found := found;
  end if;

  if v_found then
    if v_nro_oc is not null
       and public.coi_normalize_order_number(v_existing.nro_oc) <> v_nro_oc then
      raise exception using errcode = '23514', message = 'COI_ORDER_NUMBER_MISMATCH';
    end if;
    v_update := p_datos - 'nro_oc' - 'saldo_remanente';
    v_after := public.coi_actualizar_orden_integral(v_existing.id, v_update);
    return v_after || jsonb_build_object('accion', 'updated');
  end if;

  if p_orden_id is not null then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;
  if v_role not in ('administrador', 'jefatura', 'editor') then
    raise exception using errcode = '42501', message = 'COI_ROLE_REQUIRED: crear OC';
  end if;
  if v_nro_oc is null then
    raise exception using errcode = '23514', message = 'COI_ORDER_NUMBER_REQUIRED';
  end if;

  v_order_id := gen_random_uuid();
  insert into public.coi_ordenes (
    id, id_obra, nro_oc, tipo, tipo_trabajo, especialidad, descripcion,
    proveedor, estacion, ramal, sector, expediente, monto_total, moneda,
    fecha_acta_inicio, plazo_dias, fecha_vencimiento, proxima_certificacion,
    fecha_recepcion_documentacion, fecha_envio_planificacion, estado_coi,
    estado_documental, estado_registro, observaciones,
    certificable_con_saldo, justificacion_administrativa,
    link_documental_principal, estado_link_documental,
    calidad_datos_estado, calidad_datos_score, prioridad_operativa,
    responsable_coi, fecha_ultimo_control, requiere_accion,
    motivo_requiere_accion, estado_envio_pyc, fecha_cierre_operativo,
    observacion_cierre, control_terceros_hasta, control_terceros_estado,
    actualizado_por, fecha_actualizacion
  )
  select
    v_order_id,
    coalesce(nullif(trim(r.id_obra), ''), 'OC-' || v_nro_oc),
    v_nro_oc, r.tipo, r.tipo_trabajo, r.especialidad, r.descripcion,
    r.proveedor, coalesce(nullif(trim(r.estacion), ''), 'Sin definir'),
    r.ramal, r.sector, r.expediente, coalesce(r.monto_total, 0),
    coalesce(nullif(trim(r.moneda), ''), 'ARS'), r.fecha_acta_inicio,
    coalesce(r.plazo_dias, 0), r.fecha_vencimiento, r.proxima_certificacion,
    r.fecha_recepcion_documentacion, r.fecha_envio_planificacion,
    coalesce(nullif(trim(r.estado_coi), ''), 'Pendiente de completar'),
    r.estado_documental, coalesce(nullif(trim(r.estado_registro), ''), 'Activo'),
    r.observaciones, coalesce(r.certificable_con_saldo, false),
    r.justificacion_administrativa, r.link_documental_principal,
    r.estado_link_documental, r.calidad_datos_estado, r.calidad_datos_score,
    r.prioridad_operativa, r.responsable_coi, r.fecha_ultimo_control,
    coalesce(r.requiere_accion, false), r.motivo_requiere_accion,
    r.estado_envio_pyc, r.fecha_cierre_operativo, r.observacion_cierre,
    r.control_terceros_hasta, r.control_terceros_estado,
    auth.uid(), clock_timestamp()
  from jsonb_populate_record(null::public.coi_ordenes, p_datos - 'saldo_remanente') r;

  insert into public.coi_ordenes_estaciones (
    orden_id, nro_oc, estacion, ramal, sector, tipo_alcance,
    descripcion_alcance, es_principal, estado
  ) values (
    v_order_id, v_nro_oc,
    coalesce(nullif(trim(p_datos ->> 'estacion'), ''), 'Sin definir'),
    nullif(trim(p_datos ->> 'ramal'), ''),
    nullif(trim(p_datos ->> 'sector'), ''),
    'Principal', 'Estacion principal del contrato', true, 'Activa'
  );

  perform public.coi_sync_order_balance(v_order_id);
  select to_jsonb(o.*) into v_after from public.coi_ordenes o where o.id = v_order_id;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_nuevos
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'CREAR_ORDEN_INTEGRAL', 'coi_ordenes', v_order_id::text,
    v_nro_oc, v_after
  );

  return jsonb_build_object('orden', v_after, 'accion', 'inserted', 'sin_cambios', false);
end;
$$;

create or replace function public.coi_guardar_estacion_asociada(
  p_orden_id uuid,
  p_estacion_id uuid,
  p_datos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order public.coi_ordenes%rowtype;
  v_before public.coi_ordenes_estaciones%rowtype;
  v_after public.coi_ordenes_estaciones%rowtype;
  v_invalid text[];
  v_station_id uuid;
begin
  v_role := public.coi_assert_role(array[
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ]);
  if p_orden_id is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception using errcode = '22023', message = 'COI_INVALID_STATION_PAYLOAD';
  end if;
  select * into v_order from public.coi_ordenes where id = p_orden_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  select array_agg(key order by key) into v_invalid
    from jsonb_object_keys(p_datos) key
   where key <> all(array[
     'orden_id', 'nro_oc', 'estacion', 'ramal', 'sector', 'tipo_alcance',
     'descripcion_alcance', 'es_principal', 'estado', 'observaciones',
     'fecha_inicio', 'fecha_fin', 'fecha_creacion', 'fecha_actualizacion'
   ]);
  if coalesce(array_length(v_invalid, 1), 0) > 0 then
    raise exception using errcode = '22023', message = 'COI_UNKNOWN_STATION_FIELD', detail = array_to_string(v_invalid, ', ');
  end if;

  if p_estacion_id is not null then
    select * into v_before
      from public.coi_ordenes_estaciones
     where id = p_estacion_id
       and orden_id = p_orden_id
     for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'COI_STATION_NOT_FOUND';
    end if;

    update public.coi_ordenes_estaciones
       set estacion = coalesce(nullif(trim(p_datos ->> 'estacion'), ''), estacion),
           ramal = case when p_datos ? 'ramal' then nullif(trim(p_datos ->> 'ramal'), '') else ramal end,
           sector = case when p_datos ? 'sector' then nullif(trim(p_datos ->> 'sector'), '') else sector end,
           tipo_alcance = case when p_datos ? 'tipo_alcance' then coalesce(nullif(trim(p_datos ->> 'tipo_alcance'), ''), 'General') else tipo_alcance end,
           descripcion_alcance = case when p_datos ? 'descripcion_alcance' then nullif(trim(p_datos ->> 'descripcion_alcance'), '') else descripcion_alcance end,
           estado = case when p_datos ? 'estado' then coalesce(nullif(trim(p_datos ->> 'estado'), ''), 'Activa') else estado end,
           observaciones = case when p_datos ? 'observaciones' then nullif(trim(p_datos ->> 'observaciones'), '') else observaciones end,
           fecha_inicio = case when p_datos ? 'fecha_inicio' then nullif(trim(p_datos ->> 'fecha_inicio'), '')::date else fecha_inicio end,
           fecha_fin = case when p_datos ? 'fecha_fin' then nullif(trim(p_datos ->> 'fecha_fin'), '')::date else fecha_fin end
     where id = p_estacion_id
     returning * into v_after;
  else
    if v_role not in ('administrador', 'jefatura', 'editor') then
      raise exception using errcode = '42501', message = 'COI_ROLE_REQUIRED: crear estacion asociada';
    end if;
    v_station_id := gen_random_uuid();
    insert into public.coi_ordenes_estaciones (
      id, orden_id, nro_oc, estacion, ramal, sector, tipo_alcance,
      descripcion_alcance, es_principal, estado, observaciones,
      fecha_inicio, fecha_fin
    ) values (
      v_station_id, p_orden_id, v_order.nro_oc,
      nullif(trim(p_datos ->> 'estacion'), ''),
      nullif(trim(p_datos ->> 'ramal'), ''),
      nullif(trim(p_datos ->> 'sector'), ''),
      coalesce(nullif(trim(p_datos ->> 'tipo_alcance'), ''), 'General'),
      nullif(trim(p_datos ->> 'descripcion_alcance'), ''),
      false,
      coalesce(nullif(trim(p_datos ->> 'estado'), ''), 'Activa'),
      nullif(trim(p_datos ->> 'observaciones'), ''),
      nullif(trim(p_datos ->> 'fecha_inicio'), '')::date,
      nullif(trim(p_datos ->> 'fecha_fin'), '')::date
    ) returning * into v_after;
  end if;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_anteriores, datos_nuevos
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    case when p_estacion_id is null then 'CREAR_ESTACION_ASOCIADA' else 'ACTUALIZAR_ESTACION_ASOCIADA' end,
    'coi_ordenes_estaciones', v_after.id::text, v_order.nro_oc,
    case when p_estacion_id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after)
  );
  return jsonb_build_object('estacion', to_jsonb(v_after));
end;
$$;

create or replace function public.coi_marcar_estacion_principal(
  p_orden_id uuid,
  p_estacion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order public.coi_ordenes%rowtype;
  v_target public.coi_ordenes_estaciones%rowtype;
begin
  v_role := public.coi_assert_role(array[
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ]);
  select * into v_order from public.coi_ordenes where id = p_orden_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND'; end if;

  perform 1 from public.coi_ordenes_estaciones
   where orden_id = p_orden_id order by id for update;
  select * into v_target
    from public.coi_ordenes_estaciones
   where id = p_estacion_id and orden_id = p_orden_id;
  if not found then raise exception using errcode = 'P0002', message = 'COI_STATION_NOT_FOUND'; end if;

  if v_target.es_principal is not true then
    update public.coi_ordenes_estaciones
       set es_principal = false
     where orden_id = p_orden_id and es_principal is true;
    update public.coi_ordenes_estaciones
       set es_principal = true
     where id = p_estacion_id
     returning * into v_target;
  end if;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_nuevos
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'MARCAR_ESTACION_PRINCIPAL', 'coi_ordenes_estaciones',
    p_estacion_id::text, v_order.nro_oc, to_jsonb(v_target)
  );
  return jsonb_build_object('estacion', to_jsonb(v_target));
end;
$$;

create or replace function public.coi_eliminar_estacion_asociada(p_estacion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_before public.coi_ordenes_estaciones%rowtype;
begin
  v_role := public.coi_assert_role(array['administrador']);
  select * into v_before
    from public.coi_ordenes_estaciones
   where id = p_estacion_id
   for update;
  if not found then raise exception using errcode = 'P0002', message = 'COI_STATION_NOT_FOUND'; end if;
  if v_before.es_principal is true then
    raise exception using errcode = '23514', message = 'COI_CANNOT_DELETE_PRINCIPAL_STATION';
  end if;

  delete from public.coi_ordenes_estaciones where id = p_estacion_id;
  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_anteriores
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ELIMINAR_ESTACION_ASOCIADA', 'coi_ordenes_estaciones',
    p_estacion_id::text, v_before.nro_oc, to_jsonb(v_before)
  );
  return jsonb_build_object('eliminada', to_jsonb(v_before));
end;
$$;

-- -------------------------------------------------------------------------
-- Idempotencia financiera ligada a operacion y usuario
-- -------------------------------------------------------------------------

create or replace function public.coi_certificar_posiciones_v2(
  p_movimientos jsonb,
  p_idempotency_key uuid,
  p_contexto jsonb default '{}'::jsonb
)
returns setof public.coi_consumos_posicion
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.coi_idempotency_requests%rowtype;
begin
  perform public.coi_assert_role(array['administrador', 'jefatura']);
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  select * into v_request
    from public.coi_idempotency_requests
   where idempotency_key = p_idempotency_key
   for update;
  if found and (
    v_request.usuario_id is distinct from auth.uid()
    or v_request.operacion is distinct from 'CERTIFICAR_POSICIONES'
    or v_request.solicitud is distinct from p_movimientos
  ) then
    raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_SCOPE_CONFLICT';
  end if;

  return query
    select * from public.coi_certificar_posiciones(
      p_movimientos, p_idempotency_key, coalesce(p_contexto, '{}'::jsonb)
    );

  select * into v_request
    from public.coi_idempotency_requests
   where idempotency_key = p_idempotency_key
   for update;
  if not found
     or v_request.usuario_id is distinct from auth.uid()
     or v_request.operacion is distinct from 'CERTIFICAR_POSICIONES'
     or v_request.solicitud is distinct from p_movimientos then
    raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_SCOPE_CONFLICT';
  end if;
end;
$$;

-- -------------------------------------------------------------------------
-- Circuito: reintento inmediato no-op, reingreso historico trazado
-- -------------------------------------------------------------------------

create or replace function public.coi_confirmar_etapa_circuito_v2(
  p_orden_id uuid,
  p_codigo text,
  p_observacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_order public.coi_ordenes%rowtype;
  v_codigo text := lower(trim(coalesce(p_codigo, '')));
  v_nombre text;
  v_current text;
  v_seen boolean;
  v_result jsonb;
  v_history jsonb;
begin
  v_role := public.coi_assert_role(array[
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ]);
  v_nombre := case v_codigo
    when 'pliegos_preparacion' then 'PLIEGOS EN PREPARACIÓN'
    when 'pliegos_terminado_sin_solped' then 'PLIEGOS TERMINADO SIN SOLPED'
    when 'solped_sin_expediente' then 'PLIEGO CON SOLPED SIN EXPTE'
    when 'pliego_con_oc' then 'PLIEGO CON OC'
    when 'pliego_con_expediente' then 'PLIEGO CON EXPTE'
    when 'oc_sin_control_terceros' then 'PLIEGO CON EXPTE Y CON OC EMITIDA, PERO SIN CONTROL DE 3'
    when 'control_terceros_sin_acta' then 'PLIEGO CON OC CON CONTROL DE 3º SIN ACTA DE INICIO'
    when 'control_terceros_con_acta' then 'PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO'
    when 'ejecucion' then 'OBRA/SERVICIO EN EJECUCIÓN'
    when 'cancelada_suspendida' then 'OBRA/SERVICIO CANCELADA O SUSPENDIDA'
    when 'finalizada' then 'OBRA/SERVICIO FINALIZADA'
    when 'finalizada_actas' then 'OBRA/SERV. FINALIZADA CON ACTA PROVISORIA Y DEFINITIVA'
    when 'finalizada_saldo_remanente' then 'OBRA/SERVICIO FINALIZADA PERO CON SALDO REMANENTE'
    else null
  end;
  if v_nombre is null then
    raise exception using errcode = '22023', message = 'COI_UNKNOWN_CIRCUIT_STAGE', detail = v_codigo;
  end if;

  select * into v_order from public.coi_ordenes where id = p_orden_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND'; end if;
  v_current := coalesce(v_order.estado_documental, v_order.estado_coi);
  select exists (
    select 1 from public.coi_historial_oc h
     where h.orden_id = p_orden_id
       and h.tipo_evento = 'Circuito administrativo'
       and h.campo_modificado = v_codigo
  ) into v_seen;

  if upper(trim(coalesce(v_current, ''))) = upper(trim(v_nombre)) and v_seen then
    return jsonb_build_object(
      'orden', to_jsonb(v_order), 'historial', '[]'::jsonb,
      'codigo', v_codigo, 'nombre', v_nombre, 'ya_confirmada', true
    );
  end if;

  v_result := public.coi_confirmar_etapa_circuito(p_orden_id, v_codigo, p_observacion);
  if coalesce((v_result ->> 'ya_confirmada')::boolean, false) then
    with inserted as (
      insert into public.coi_historial_oc (
        orden_id, nro_oc, tipo_evento, campo_modificado, valor_anterior,
        valor_nuevo, motivo, usuario_email, creado_por
      ) values
      (
        p_orden_id, v_order.nro_oc, 'Circuito administrativo', v_codigo,
        v_current, v_nombre,
        coalesce(nullif(trim(coalesce(p_observacion, '')), ''), 'Reingreso a etapa previamente recorrida'),
        nullif(auth.jwt() ->> 'email', ''), auth.uid()
      ),
      (
        p_orden_id, v_order.nro_oc, 'Cambio de estado contractual', 'estado_documental',
        v_current, v_nombre, 'Reingreso contractual: ' || v_nombre,
        nullif(auth.jwt() ->> 'email', ''), auth.uid()
      ) returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted.*)), '[]'::jsonb)
      into v_history from inserted;

    insert into public.coi_operaciones_auditoria (
      usuario_id, usuario_email, rol, accion, entidad, registro_id,
      nro_oc, datos_anteriores, datos_nuevos, contexto
    ) values (
      auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
      'REINGRESAR_ETAPA_CIRCUITO', 'coi_ordenes', p_orden_id::text,
      v_order.nro_oc, to_jsonb(v_order), v_result -> 'orden',
      jsonb_build_object('codigo', v_codigo)
    );
    v_result := jsonb_set(v_result, '{historial}', v_history, true);
    v_result := jsonb_set(v_result, '{ya_confirmada}', 'false'::jsonb, true);
  end if;
  return v_result;
end;
$$;

-- -------------------------------------------------------------------------
-- Privilegios: lectura por RLS; escrituras core exclusivamente por RPC
-- -------------------------------------------------------------------------

revoke insert, update, delete on public.coi_ordenes from authenticated;
revoke insert, update, delete on public.coi_ordenes_estaciones from authenticated;

revoke all on function public.coi_certificar_posiciones(jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.coi_confirmar_etapa_circuito(uuid, text, text) from public, anon, authenticated;

revoke all on function public.coi_normalize_order_number(text) from public, anon, authenticated;
revoke all on function public.coi_order_number_guard() from public, anon, authenticated;
revoke all on function public.coi_sync_order_balance(uuid) from public, anon, authenticated;
revoke all on function public.coi_sync_position_balance(uuid) from public, anon, authenticated;
revoke all on function public.coi_recompute_position_fields() from public, anon, authenticated;
revoke all on function public.coi_position_identity_guard() from public, anon, authenticated;
revoke all on function public.coi_sync_principal_station_from_order() from public, anon, authenticated;
revoke all on function public.coi_station_write_guard() from public, anon, authenticated;
revoke all on function public.coi_sync_order_from_principal_station() from public, anon, authenticated;
revoke all on function public.coi_assert_one_principal_station() from public, anon, authenticated;

revoke all on function public.coi_guardar_orden_integral(uuid, jsonb) from public, anon;
revoke all on function public.coi_guardar_estacion_asociada(uuid, uuid, jsonb) from public, anon;
revoke all on function public.coi_marcar_estacion_principal(uuid, uuid) from public, anon;
revoke all on function public.coi_eliminar_estacion_asociada(uuid) from public, anon;
revoke all on function public.coi_certificar_posiciones_v2(jsonb, uuid, jsonb) from public, anon;
revoke all on function public.coi_confirmar_etapa_circuito_v2(uuid, text, text) from public, anon;

grant execute on function public.coi_guardar_orden_integral(uuid, jsonb) to authenticated;
grant execute on function public.coi_guardar_estacion_asociada(uuid, uuid, jsonb) to authenticated;
grant execute on function public.coi_marcar_estacion_principal(uuid, uuid) to authenticated;
grant execute on function public.coi_eliminar_estacion_asociada(uuid) to authenticated;
grant execute on function public.coi_certificar_posiciones_v2(jsonb, uuid, jsonb) to authenticated;
grant execute on function public.coi_confirmar_etapa_circuito_v2(uuid, text, text) to authenticated;

comment on function public.coi_guardar_orden_integral(uuid, jsonb) is
  'Crea una OC con su estacion principal o actualiza una OC existente en una sola transaccion.';
comment on function public.coi_certificar_posiciones_v2(jsonb, uuid, jsonb) is
  'Certificacion atomica con idempotencia ligada a usuario, operacion y solicitud.';
comment on function public.coi_confirmar_etapa_circuito_v2(uuid, text, text) is
  'Circuito idempotente para reintentos inmediatos y trazable para reingresos historicos.';

commit;
