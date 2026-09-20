-- COI Linea Roca - libro mayor financiero y RPC atomicas.
-- Requiere que el preflight informe cero duplicados antes de aplicar los
-- indices unicos. Si existe un duplicado, PostgreSQL aborta sin borrar filas.

begin;

create extension if not exists pgcrypto;

create or replace function public.coi_current_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select lower(trim(p.rol))
    from public.profiles p
   where p.id = auth.uid()
     and coalesce(p.activo, false)
   limit 1
$$;

create or replace function public.coi_assert_role(p_roles text[])
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'COI_AUTH_REQUIRED';
  end if;

  v_role := public.coi_current_role();
  if v_role is null or not (v_role = any(p_roles)) then
    raise exception using
      errcode = '42501',
      message = 'COI_ROLE_REQUIRED',
      detail = format('Rol actual: %s. Roles admitidos: %s', coalesce(v_role, 'sin perfil activo'), array_to_string(p_roles, ', '));
  end if;
  return v_role;
end;
$$;

revoke all on function public.coi_current_role() from public, anon;
revoke all on function public.coi_assert_role(text[]) from public, anon;
grant execute on function public.coi_current_role() to authenticated;
grant execute on function public.coi_assert_role(text[]) to authenticated;

create table if not exists public.coi_operaciones_auditoria (
  id bigint generated always as identity primary key,
  fecha_hora timestamptz not null default clock_timestamp(),
  usuario_id uuid references auth.users(id) on delete set null,
  usuario_email text,
  rol text,
  accion text not null,
  entidad text not null,
  registro_id text,
  nro_oc text,
  idempotency_key uuid,
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  contexto jsonb not null default '{}'::jsonb
);

create table if not exists public.coi_idempotency_requests (
  idempotency_key uuid primary key,
  operacion text not null,
  solicitud jsonb not null,
  usuario_id uuid not null references auth.users(id) on delete restrict,
  creado_en timestamptz not null default clock_timestamp()
);

alter table public.coi_ordenes
  add column if not exists saldo_remanente numeric(20,2);

alter table public.coi_posiciones_oc
  add column if not exists cantidad_consumida numeric(20,6) not null default 0;
alter table public.coi_posiciones_oc
  add column if not exists monto_consumido numeric(20,2) not null default 0;
alter table public.coi_posiciones_oc
  add column if not exists cantidad_disponible numeric(20,6) not null default 0;
alter table public.coi_posiciones_oc
  add column if not exists monto_disponible numeric(20,2) not null default 0;
alter table public.coi_posiciones_oc
  add column if not exists estado text not null default 'LIBRE';
alter table public.coi_posiciones_oc
  add column if not exists cantidad_consumida_inicial numeric(20,6) not null default 0;
alter table public.coi_posiciones_oc
  add column if not exists monto_consumido_inicial numeric(20,2) not null default 0;

create table if not exists public.coi_consumos_posicion (
  id uuid primary key default gen_random_uuid(),
  posicion_id uuid not null references public.coi_posiciones_oc(id) on delete restrict,
  orden_id uuid not null references public.coi_ordenes(id) on delete restrict,
  nro_oc text not null,
  posicion text not null,
  descripcion text,
  cantidad numeric(20,6) not null check (cantidad >= 0),
  precio_unitario numeric(20,6) not null default 0 check (precio_unitario >= 0),
  monto numeric(20,2) not null check (monto >= 0),
  moneda text not null default 'ARS',
  remito text,
  mes text,
  periodo text,
  acta_nro text,
  fecha_acta date,
  observaciones text,
  estado text not null default 'CONFIRMADA' check (estado in ('CONFIRMADA', 'ANULADA')),
  idempotency_key uuid not null,
  creado_por uuid not null default auth.uid() references auth.users(id) on delete restrict,
  usuario_email text,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp(),
  anulado_en timestamptz,
  anulado_por uuid references auth.users(id) on delete restrict,
  motivo_anulacion text,
  contexto jsonb not null default '{}'::jsonb,
  unique (idempotency_key, posicion_id),
  check (cantidad > 0 or monto > 0)
);

create index if not exists coi_consumos_posicion_posicion_idx
  on public.coi_consumos_posicion (posicion_id, estado, creado_en);
create index if not exists coi_consumos_posicion_orden_idx
  on public.coi_consumos_posicion (orden_id, estado, creado_en);
create index if not exists coi_operaciones_auditoria_registro_idx
  on public.coi_operaciones_auditoria (entidad, registro_id, fecha_hora desc);
create unique index if not exists coi_operaciones_auditoria_idempotency_uq
  on public.coi_operaciones_auditoria (accion, idempotency_key)
  where idempotency_key is not null;

-- Estos indices son el freno de emergencia ante carreras de upsert. Si el
-- preflight detecto duplicados, deben resolverse manualmente antes de seguir.
create unique index if not exists coi_ordenes_nro_oc_uq
  on public.coi_ordenes (nro_oc);
create unique index if not exists coi_posiciones_oc_orden_posicion_uq
  on public.coi_posiciones_oc (orden_id, posicion);
create unique index if not exists coi_posiciones_oc_orden_posicion_normalizada_uq
  on public.coi_posiciones_oc (orden_id, upper(trim(replace(posicion, ',', '.'))));
create unique index if not exists coi_ordenes_estacion_principal_uq
  on public.coi_ordenes_estaciones (orden_id)
  where es_principal is true;

create table if not exists public.coi_contract_meta (
  clave text primary key,
  valor jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default clock_timestamp()
);

-- Conserva cualquier consumo historico que ya estuviera materializado en la
-- posicion. Se captura una sola vez para no duplicarlo al reaplicar el script.
do $$
begin
  if not exists (
    select 1 from public.coi_contract_meta where clave = 'financial_ledger_baseline_v1'
  ) then
    update public.coi_posiciones_oc
       set cantidad_consumida_inicial = greatest(coalesce(cantidad_consumida, 0), 0),
           monto_consumido_inicial = greatest(coalesce(monto_consumido, 0), 0);

    insert into public.coi_contract_meta (clave, valor)
    values (
      'financial_ledger_baseline_v1',
      jsonb_build_object('capturado_en', clock_timestamp(), 'filas', (select count(*) from public.coi_posiciones_oc))
    );
  end if;
end;
$$;

create or replace function public.coi_sync_order_balance(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.coi_ordenes o
     set saldo_remanente = greatest(
       coalesce(o.monto_total, 0) - coalesce((
         select sum(p.monto_consumido)
           from public.coi_posiciones_oc p
          where p.orden_id = o.id
       ), 0),
       0
     )
   where o.id = p_order_id;
end;
$$;

create or replace function public.coi_recompute_position_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cantidad_ledger numeric(20,6) := 0;
  v_monto_ledger numeric(20,2) := 0;
  v_cantidad_consumida numeric(20,6);
  v_monto_consumido numeric(20,2);
  v_completa boolean;
begin
  if tg_op = 'INSERT' then
    new.cantidad_consumida_inicial := 0;
    new.monto_consumido_inicial := 0;
  else
    new.cantidad_consumida_inicial := old.cantidad_consumida_inicial;
    new.monto_consumido_inicial := old.monto_consumido_inicial;
  end if;

  if new.id is not null then
    select coalesce(sum(c.cantidad), 0), coalesce(sum(c.monto), 0)
      into v_cantidad_ledger, v_monto_ledger
      from public.coi_consumos_posicion c
     where c.posicion_id = new.id
       and c.estado = 'CONFIRMADA';
  end if;

  v_cantidad_consumida := greatest(coalesce(new.cantidad_consumida_inicial, 0) + v_cantidad_ledger, 0);
  v_monto_consumido := greatest(coalesce(new.monto_consumido_inicial, 0) + v_monto_ledger, 0);

  if v_cantidad_consumida > coalesce(new.cantidad_total, 0) + 0.000001 then
    raise exception using errcode = '23514', message = 'COI_POSITION_QUANTITY_BELOW_CONSUMED';
  end if;
  if v_monto_consumido > coalesce(new.monto_total, 0) + 0.01 then
    raise exception using errcode = '23514', message = 'COI_POSITION_AMOUNT_BELOW_CONSUMED';
  end if;

  new.cantidad_consumida := v_cantidad_consumida;
  new.monto_consumido := v_monto_consumido;
  new.cantidad_disponible := greatest(coalesce(new.cantidad_total, 0) - v_cantidad_consumida, 0);
  new.monto_disponible := greatest(coalesce(new.monto_total, 0) - v_monto_consumido, 0);

  v_completa :=
    (coalesce(new.cantidad_total, 0) <= 0.000001 or new.cantidad_disponible <= 0.000001)
    and (coalesce(new.monto_total, 0) <= 0.01 or new.monto_disponible <= 0.01);

  new.estado := case
    when v_cantidad_consumida <= 0.000001 and v_monto_consumido <= 0.01 then 'LIBRE'
    when v_completa then 'CONSUMIDA'
    else 'PARCIAL'
  end;
  return new;
end;
$$;

drop trigger if exists coi_posiciones_oc_recompute_fields on public.coi_posiciones_oc;
create trigger coi_posiciones_oc_recompute_fields
before insert or update on public.coi_posiciones_oc
for each row execute function public.coi_recompute_position_fields();

create or replace function public.coi_sync_position_balance(p_position_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  select p.orden_id
    into v_order_id
    from public.coi_posiciones_oc p
   where p.id = p_position_id
   for update;

  if v_order_id is null then
    raise exception using errcode = 'P0002', message = 'COI_POSITION_NOT_FOUND';
  end if;

  -- El trigger recalcula los campos derivados desde el baseline y el ledger.
  update public.coi_posiciones_oc set id = id where id = p_position_id;
  perform public.coi_sync_order_balance(v_order_id);
end;
$$;

do $$
declare
  v_position record;
begin
  for v_position in select id from public.coi_posiciones_oc order by id loop
    perform public.coi_sync_position_balance(v_position.id);
  end loop;
end;
$$;

create or replace function public.coi_certificar_posiciones(
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
  v_role text;
  v_movement jsonb;
  v_position public.coi_posiciones_oc%rowtype;
  v_existing public.coi_consumos_posicion%rowtype;
  v_position_id uuid;
  v_cantidad numeric(20,6);
  v_monto numeric(20,2);
  v_ids uuid[] := '{}'::uuid[];
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_saved_request jsonb;
begin
  v_role := public.coi_assert_role(array['administrador', 'jefatura']);

  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if jsonb_typeof(p_movimientos) <> 'array' or jsonb_array_length(p_movimientos) = 0 then
    raise exception using errcode = '22023', message = 'COI_MOVEMENTS_REQUIRED';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_movimientos) item
     group by item ->> 'posicion_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'COI_DUPLICATE_POSITION_IN_BATCH';
  end if;

  insert into public.coi_idempotency_requests (
    idempotency_key, operacion, solicitud, usuario_id
  ) values (
    p_idempotency_key, 'CERTIFICAR_POSICIONES', p_movimientos, auth.uid()
  ) on conflict (idempotency_key) do nothing;

  select solicitud
    into v_saved_request
    from public.coi_idempotency_requests
   where idempotency_key = p_idempotency_key
   for update;
  if v_saved_request is distinct from p_movimientos then
    raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_CONFLICT';
  end if;

  -- Orden deterministico de locks para evitar deadlocks entre lotes concurrentes.
  for v_movement in
    select item
      from jsonb_array_elements(p_movimientos) item
     order by item ->> 'posicion_id'
  loop
    begin
      v_position_id := nullif(trim(v_movement ->> 'posicion_id'), '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'COI_INVALID_POSITION_ID';
    end;

    if v_position_id is null then
      raise exception using errcode = '22023', message = 'COI_POSITION_ID_REQUIRED';
    end if;

    select *
      into v_position
      from public.coi_posiciones_oc
     where id = v_position_id
     for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'COI_POSITION_NOT_FOUND', detail = v_position_id::text;
    end if;

    select *
      into v_existing
      from public.coi_consumos_posicion
     where idempotency_key = p_idempotency_key
       and posicion_id = v_position_id;
    if found then
      if v_existing.contexto -> 'solicitud' is distinct from v_movement then
        raise exception using errcode = '22023', message = 'COI_IDEMPOTENCY_CONFLICT', detail = v_position_id::text;
      end if;
      v_ids := array_append(v_ids, v_existing.id);
      continue;
    end if;

    perform public.coi_sync_position_balance(v_position_id);
    select * into v_position from public.coi_posiciones_oc where id = v_position_id for update;

    begin
      v_cantidad := nullif(trim(v_movement ->> 'cantidad'), '')::numeric;
      v_monto := nullif(trim(v_movement ->> 'monto'), '')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'COI_INVALID_MOVEMENT_NUMBER', detail = v_position_id::text;
    end;

    if v_cantidad is not null and v_cantidad <= 0 then
      raise exception using errcode = '22023', message = 'COI_QUANTITY_MUST_BE_POSITIVE', detail = v_position_id::text;
    end if;
    if v_monto is not null and v_monto <= 0 then
      raise exception using errcode = '22023', message = 'COI_AMOUNT_MUST_BE_POSITIVE', detail = v_position_id::text;
    end if;

    if v_cantidad is null and v_monto is null then
      v_cantidad := v_position.cantidad_disponible;
      v_monto := v_position.monto_disponible;
    elsif v_monto is null then
      v_monto := case
        when coalesce(v_position.precio_unitario, 0) > 0 then round(v_cantidad * v_position.precio_unitario, 2)
        when v_position.cantidad_disponible > 0 then round(v_position.monto_disponible * (v_cantidad / v_position.cantidad_disponible), 2)
        else 0
      end;
    elsif v_cantidad is null then
      v_cantidad := case
        when coalesce(v_position.precio_unitario, 0) > 0 then v_monto / v_position.precio_unitario
        when v_position.monto_disponible > 0 then v_position.cantidad_disponible * (v_monto / v_position.monto_disponible)
        else 0
      end;
    end if;

    if v_cantidad < 0 or v_monto < 0 or (v_cantidad <= 0 and v_monto <= 0) then
      raise exception using errcode = '23514', message = 'COI_POSITION_WITHOUT_AVAILABLE_BALANCE', detail = v_position_id::text;
    end if;
    if v_cantidad > v_position.cantidad_disponible + 0.000001 then
      raise exception using errcode = '23514', message = 'COI_QUANTITY_EXCEEDS_AVAILABLE', detail = v_position_id::text;
    end if;
    if v_monto > v_position.monto_disponible + 0.01 then
      raise exception using errcode = '23514', message = 'COI_AMOUNT_EXCEEDS_AVAILABLE', detail = v_position_id::text;
    end if;

    insert into public.coi_consumos_posicion (
      posicion_id, orden_id, nro_oc, posicion, descripcion, cantidad,
      precio_unitario, monto, moneda, remito, mes, periodo, acta_nro,
      fecha_acta, observaciones, idempotency_key, creado_por,
      usuario_email, contexto
    ) values (
      v_position.id, v_position.orden_id, v_position.nro_oc, v_position.posicion,
      v_position.descripcion, v_cantidad, coalesce(v_position.precio_unitario, 0),
      round(v_monto, 2), coalesce(nullif(v_position.moneda, ''), 'ARS'),
      coalesce(nullif(v_movement ->> 'remito', ''), v_position.remito),
      nullif(trim(v_movement ->> 'mes'), ''),
      nullif(trim(v_movement ->> 'periodo'), ''),
      nullif(trim(v_movement ->> 'acta_nro'), ''),
      nullif(trim(v_movement ->> 'fecha_acta'), '')::date,
      nullif(trim(v_movement ->> 'observaciones'), ''),
      p_idempotency_key, auth.uid(), nullif(v_email, ''),
      coalesce(p_contexto, '{}'::jsonb) || jsonb_build_object('solicitud', v_movement)
    ) returning id into v_existing.id;

    v_ids := array_append(v_ids, v_existing.id);
    perform public.coi_sync_position_balance(v_position_id);
  end loop;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    idempotency_key, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(v_email, ''), v_role, 'CERTIFICAR_POSICIONES',
    'coi_consumos_posicion', array_to_string(v_ids, ','), p_idempotency_key,
    jsonb_build_object('movimientos', p_movimientos, 'consumos_ids', to_jsonb(v_ids)),
    coalesce(p_contexto, '{}'::jsonb)
  ) on conflict do nothing;

  return query
    select c.*
      from public.coi_consumos_posicion c
     where c.id = any(v_ids)
     order by c.creado_en, c.id;
end;
$$;

create or replace function public.coi_actualizar_consumo_posicion(
  p_consumo_id uuid,
  p_cambios jsonb
)
returns public.coi_consumos_posicion
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_before public.coi_consumos_posicion%rowtype;
  v_after public.coi_consumos_posicion%rowtype;
  v_invalid text[];
begin
  v_role := public.coi_assert_role(array['administrador', 'jefatura', 'editor']);
  if p_consumo_id is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception using errcode = '22023', message = 'COI_INVALID_CONSUMPTION_UPDATE';
  end if;

  select array_agg(key order by key)
    into v_invalid
    from jsonb_object_keys(p_cambios) key
   where key <> all(array['remito', 'mes', 'periodo', 'acta_nro', 'fecha_acta', 'observaciones']);
  if coalesce(array_length(v_invalid, 1), 0) > 0 then
    raise exception using errcode = '22023', message = 'COI_IMMUTABLE_FINANCIAL_FIELDS', detail = array_to_string(v_invalid, ', ');
  end if;

  select * into v_before
    from public.coi_consumos_posicion
   where id = p_consumo_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_CONSUMPTION_NOT_FOUND';
  end if;
  if v_before.estado <> 'CONFIRMADA' then
    raise exception using errcode = '23514', message = 'COI_ANNULLED_CONSUMPTION_IMMUTABLE';
  end if;

  update public.coi_consumos_posicion
     set remito = case when p_cambios ? 'remito' then nullif(trim(p_cambios ->> 'remito'), '') else remito end,
         mes = case when p_cambios ? 'mes' then nullif(trim(p_cambios ->> 'mes'), '') else mes end,
         periodo = case when p_cambios ? 'periodo' then nullif(trim(p_cambios ->> 'periodo'), '') else periodo end,
         acta_nro = case when p_cambios ? 'acta_nro' then nullif(trim(p_cambios ->> 'acta_nro'), '') else acta_nro end,
         fecha_acta = case when p_cambios ? 'fecha_acta' then nullif(trim(p_cambios ->> 'fecha_acta'), '')::date else fecha_acta end,
         observaciones = case when p_cambios ? 'observaciones' then nullif(trim(p_cambios ->> 'observaciones'), '') else observaciones end,
         actualizado_en = clock_timestamp()
   where id = p_consumo_id
   returning * into v_after;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_anteriores, datos_nuevos
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ACTUALIZAR_METADATA_CONSUMO', 'coi_consumos_posicion', p_consumo_id::text,
    v_after.nro_oc, to_jsonb(v_before), to_jsonb(v_after)
  );
  return v_after;
end;
$$;

create or replace function public.coi_anular_consumo_posicion(
  p_consumo_id uuid,
  p_motivo text
)
returns public.coi_consumos_posicion
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_before public.coi_consumos_posicion%rowtype;
  v_after public.coi_consumos_posicion%rowtype;
begin
  v_role := public.coi_assert_role(array['administrador', 'jefatura']);
  if p_consumo_id is null or length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception using errcode = '22023', message = 'COI_ANNULMENT_REASON_REQUIRED';
  end if;

  select * into v_before
    from public.coi_consumos_posicion
   where id = p_consumo_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_CONSUMPTION_NOT_FOUND';
  end if;
  if v_before.estado = 'ANULADA' then
    return v_before;
  end if;

  perform 1 from public.coi_posiciones_oc where id = v_before.posicion_id for update;
  update public.coi_consumos_posicion
     set estado = 'ANULADA',
         anulado_en = clock_timestamp(),
         anulado_por = auth.uid(),
         motivo_anulacion = trim(p_motivo),
         actualizado_en = clock_timestamp()
   where id = p_consumo_id
   returning * into v_after;

  perform public.coi_sync_position_balance(v_after.posicion_id);
  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ANULAR_CONSUMO_POSICION', 'coi_consumos_posicion', p_consumo_id::text,
    v_after.nro_oc, to_jsonb(v_before), to_jsonb(v_after),
    jsonb_build_object('motivo', trim(p_motivo))
  );
  return v_after;
end;
$$;

create or replace function public.coi_eliminar_posicion_sin_movimientos(p_position_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_before public.coi_posiciones_oc%rowtype;
begin
  v_role := public.coi_assert_role(array['administrador']);
  select * into v_before
    from public.coi_posiciones_oc
   where id = p_position_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'COI_POSITION_NOT_FOUND';
  end if;

  if coalesce(v_before.cantidad_consumida_inicial, 0) > 0
     or coalesce(v_before.monto_consumido_inicial, 0) > 0
     or exists (select 1 from public.coi_consumos_posicion where posicion_id = p_position_id) then
    raise exception using errcode = '23503', message = 'COI_POSITION_HAS_TRACEABILITY';
  end if;

  delete from public.coi_posiciones_oc where id = p_position_id;
  perform public.coi_sync_order_balance(v_before.orden_id);
  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_anteriores
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ELIMINAR_POSICION_SIN_MOVIMIENTOS', 'coi_posiciones_oc', p_position_id::text,
    v_before.nro_oc, to_jsonb(v_before)
  );
  return jsonb_build_object('id', p_position_id, 'nro_oc', v_before.nro_oc, 'posicion', v_before.posicion);
end;
$$;

create or replace function public.coi_eliminar_posiciones_sin_movimientos(p_position_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_position public.coi_posiciones_oc%rowtype;
  v_order_id uuid;
  v_ids uuid[];
  v_order_ids uuid[] := '{}'::uuid[];
  v_before jsonb := '[]'::jsonb;
  v_deleted jsonb;
begin
  v_role := public.coi_assert_role(array['administrador']);
  select array_agg(distinct id order by id)
    into v_ids
    from unnest(coalesce(p_position_ids, '{}'::uuid[])) id
   where id is not null;
  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'COI_POSITION_IDS_REQUIRED';
  end if;

  for v_position in
    select *
      from public.coi_posiciones_oc
     where id = any(v_ids)
     order by id
     for update
  loop
    if coalesce(v_position.cantidad_consumida_inicial, 0) > 0
       or coalesce(v_position.monto_consumido_inicial, 0) > 0
       or exists (select 1 from public.coi_consumos_posicion where posicion_id = v_position.id) then
      raise exception using
        errcode = '23503',
        message = 'COI_POSITION_HAS_TRACEABILITY',
        detail = v_position.id::text;
    end if;
    v_before := v_before || jsonb_build_array(to_jsonb(v_position));
    if not (v_position.orden_id = any(v_order_ids)) then
      v_order_ids := array_append(v_order_ids, v_position.orden_id);
    end if;
  end loop;

  if jsonb_array_length(v_before) <> cardinality(v_ids) then
    raise exception using errcode = 'P0002', message = 'COI_POSITION_NOT_FOUND_IN_BATCH';
  end if;

  with removed as (
    delete from public.coi_posiciones_oc
     where id = any(v_ids)
     returning id, nro_oc, posicion
  )
  select coalesce(jsonb_agg(to_jsonb(removed) order by id), '[]'::jsonb)
    into v_deleted
    from removed;

  foreach v_order_id in array v_order_ids loop
    perform public.coi_sync_order_balance(v_order_id);
  end loop;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    datos_anteriores, datos_nuevos
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ELIMINAR_POSICIONES_SIN_MOVIMIENTOS', 'coi_posiciones_oc', array_to_string(v_ids, ','),
    v_before, v_deleted
  );
  return jsonb_build_object('deleted', v_deleted, 'count', jsonb_array_length(v_deleted));
end;
$$;

revoke all on function public.coi_certificar_posiciones(jsonb, uuid, jsonb) from public, anon;
revoke all on function public.coi_actualizar_consumo_posicion(uuid, jsonb) from public, anon;
revoke all on function public.coi_anular_consumo_posicion(uuid, text) from public, anon;
revoke all on function public.coi_eliminar_posicion_sin_movimientos(uuid) from public, anon;
revoke all on function public.coi_eliminar_posiciones_sin_movimientos(uuid[]) from public, anon;
grant execute on function public.coi_certificar_posiciones(jsonb, uuid, jsonb) to authenticated;
grant execute on function public.coi_actualizar_consumo_posicion(uuid, jsonb) to authenticated;
grant execute on function public.coi_anular_consumo_posicion(uuid, text) to authenticated;
grant execute on function public.coi_eliminar_posicion_sin_movimientos(uuid) to authenticated;
grant execute on function public.coi_eliminar_posiciones_sin_movimientos(uuid[]) to authenticated;

comment on table public.coi_consumos_posicion is
  'Libro mayor inmutable de consumos financieros. Las correcciones se realizan por metadatos o anulacion, nunca por DELETE.';
comment on function public.coi_certificar_posiciones(jsonb, uuid, jsonb) is
  'Certifica una o mas posiciones en una unica transaccion con locks e idempotencia.';

commit;
