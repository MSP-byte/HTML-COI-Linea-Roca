-- COI Linea Roca - Timeline/Mailing Supabase-first.
--
-- Objetivos:
-- - crear el repositorio canonico de eventos Timeline/Mailing;
-- - conservar IDs legacy de texto para migrar datos de navegador sin perderlos;
-- - vincular cada evento con la identidad UUID de la OC cuando corresponda;
-- - proteger CRUD con Auth + RLS y registrar auditoria server-side;
-- - mantener nro_oc sincronizado ante una renumeracion administrativa.

begin;

create table if not exists public.coi_timeline_events (
  id text primary key,
  orden_id uuid references public.coi_ordenes(id) on delete restrict,
  nro_oc text,
  fecha date not null default current_date,
  hora time without time zone not null default '09:00'::time,
  semana text not null default '',
  expediente text not null default '',
  proveedor text not null default '',
  rubro text not null default '',
  estacion text not null default '',
  titulo text not null default '',
  tipo_evento text not null default 'Mailing',
  origen text not null default 'Mailing',
  remitente text not null default '',
  destinatarios text not null default '',
  descripcion text not null default '',
  documentos_mencionados text not null default '',
  estado text not null default 'Informativo',
  riesgo text not null default 'Bajo',
  accion_pendiente text not null default '',
  responsable_accion text not null default '',
  fecha_limite date,
  link_documental text not null default '',
  observaciones text not null default '',
  creado_por text not null default '',
  origen_carga text not null default 'Carga manual',
  oc_registrada text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp(),
  constraint coi_timeline_id_required check (nullif(btrim(id), '') is not null),
  constraint coi_timeline_title_required check (nullif(btrim(titulo), '') is not null),
  constraint coi_timeline_status_valid check (estado in (
    'Informativo', 'En revisión', 'Pendiente proveedor', 'Pendiente SOFSE',
    'Pendiente CT', 'Pendiente HSMA', 'Certificación', 'Observado',
    'Corregido', 'Cerrado'
  )),
  constraint coi_timeline_risk_valid check (riesgo in ('Bajo', 'Medio', 'Alto', 'Crítico'))
);

-- Compatibilidad forward-only con fixtures/minimos historicos donde la tabla
-- podia existir solo con id, orden_id y nro_oc.
alter table public.coi_timeline_events add column if not exists fecha date not null default current_date;
alter table public.coi_timeline_events add column if not exists hora time without time zone not null default '09:00'::time;
alter table public.coi_timeline_events add column if not exists semana text not null default '';
alter table public.coi_timeline_events add column if not exists expediente text not null default '';
alter table public.coi_timeline_events add column if not exists proveedor text not null default '';
alter table public.coi_timeline_events add column if not exists rubro text not null default '';
alter table public.coi_timeline_events add column if not exists estacion text not null default '';
alter table public.coi_timeline_events add column if not exists titulo text not null default '';
alter table public.coi_timeline_events add column if not exists tipo_evento text not null default 'Mailing';
alter table public.coi_timeline_events add column if not exists origen text not null default 'Mailing';
alter table public.coi_timeline_events add column if not exists remitente text not null default '';
alter table public.coi_timeline_events add column if not exists destinatarios text not null default '';
alter table public.coi_timeline_events add column if not exists descripcion text not null default '';
alter table public.coi_timeline_events add column if not exists documentos_mencionados text not null default '';
alter table public.coi_timeline_events add column if not exists estado text not null default 'Informativo';
alter table public.coi_timeline_events add column if not exists riesgo text not null default 'Bajo';
alter table public.coi_timeline_events add column if not exists accion_pendiente text not null default '';
alter table public.coi_timeline_events add column if not exists responsable_accion text not null default '';
alter table public.coi_timeline_events add column if not exists fecha_limite date;
alter table public.coi_timeline_events add column if not exists link_documental text not null default '';
alter table public.coi_timeline_events add column if not exists observaciones text not null default '';
alter table public.coi_timeline_events add column if not exists creado_por text not null default '';
alter table public.coi_timeline_events add column if not exists origen_carga text not null default 'Carga manual';
alter table public.coi_timeline_events add column if not exists oc_registrada text not null default '';
alter table public.coi_timeline_events add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.coi_timeline_events add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.coi_timeline_events add column if not exists creado_en timestamptz not null default clock_timestamp();
alter table public.coi_timeline_events add column if not exists actualizado_en timestamptz not null default clock_timestamp();

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.coi_timeline_events'::regclass
       and conname = 'coi_timeline_events_orden_id_fkey'
  ) then
    alter table public.coi_timeline_events
      add constraint coi_timeline_events_orden_id_fkey
      foreign key (orden_id) references public.coi_ordenes(id) on delete restrict;
  end if;
end;
$$;

create index if not exists coi_timeline_fecha_idx
  on public.coi_timeline_events(fecha desc, hora desc);
create index if not exists coi_timeline_nro_oc_idx
  on public.coi_timeline_events(nro_oc) where nro_oc is not null;
create index if not exists coi_timeline_orden_id_idx
  on public.coi_timeline_events(orden_id) where orden_id is not null;
create index if not exists coi_timeline_estado_idx
  on public.coi_timeline_events(estado);
create index if not exists coi_timeline_riesgo_idx
  on public.coi_timeline_events(riesgo);
create index if not exists coi_timeline_fecha_limite_idx
  on public.coi_timeline_events(fecha_limite) where fecha_limite is not null;

alter table public.coi_timeline_events enable row level security;

create or replace function public.coi_timeline_prepare_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.coi_ordenes%rowtype;
begin
  new.id := btrim(new.id);
  new.nro_oc := nullif(public.coi_normalize_order_number(new.nro_oc), '');
  new.semana := coalesce(nullif(btrim(new.semana), ''), to_char(new.fecha, 'IYYY-"W"IW'));

  if new.orden_id is not null then
    select * into v_order
      from public.coi_ordenes o
     where o.id = new.orden_id
     for key share;
    if not found then
      raise exception using errcode = '23503', message = 'COI_TIMELINE_ORDER_NOT_FOUND';
    end if;
    new.nro_oc := v_order.nro_oc;
    new.oc_registrada := 'SI';
  elsif new.nro_oc is not null then
    select * into v_order
      from public.coi_ordenes o
     where public.coi_normalize_order_number(o.nro_oc) = new.nro_oc
     limit 1
     for key share;
    if found then
      new.orden_id := v_order.id;
      new.nro_oc := v_order.nro_oc;
      new.oc_registrada := 'SI';
    else
      new.oc_registrada := 'NO';
    end if;
  else
    new.oc_registrada := 'GENERAL';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.creado_en := clock_timestamp();
  else
    new.created_by := old.created_by;
    new.creado_en := old.creado_en;
  end if;
  new.updated_by := auth.uid();
  new.actualizado_en := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.coi_timeline_prepare_row() from public, anon, authenticated;
drop trigger if exists coi_timeline_00_prepare_row on public.coi_timeline_events;
create trigger coi_timeline_00_prepare_row
before insert or update on public.coi_timeline_events
for each row execute function public.coi_timeline_prepare_row();

create or replace function public.coi_timeline_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.coi_timeline_events%rowtype;
  v_action text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_action := case tg_op
    when 'INSERT' then 'TIMELINE_CREAR'
    when 'UPDATE' then 'TIMELINE_ACTUALIZAR'
    else 'TIMELINE_ELIMINAR'
  end;

  insert into public.coi_operaciones_auditoria (
    usuario_id, usuario_email, rol, accion, entidad, registro_id, nro_oc,
    datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), public.coi_current_role(),
    v_action, 'coi_timeline_events', v_row.id, v_row.nro_oc,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    jsonb_build_object('origen', 'timeline_supabase_first')
  );
  return v_row;
end;
$$;

revoke all on function public.coi_timeline_audit_row() from public, anon, authenticated;
drop trigger if exists coi_timeline_90_audit_row on public.coi_timeline_events;
create trigger coi_timeline_90_audit_row
after insert or update or delete on public.coi_timeline_events
for each row execute function public.coi_timeline_audit_row();

create or replace function public.coi_timeline_sync_order_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.nro_oc is distinct from old.nro_oc then
    update public.coi_timeline_events
       set nro_oc = new.nro_oc
     where orden_id = new.id
       and nro_oc is distinct from new.nro_oc;
  end if;
  return new;
end;
$$;

revoke all on function public.coi_timeline_sync_order_number() from public, anon, authenticated;
drop trigger if exists coi_timeline_sync_order_number on public.coi_ordenes;
create trigger coi_timeline_sync_order_number
after update of nro_oc on public.coi_ordenes
for each row execute function public.coi_timeline_sync_order_number();

-- Contrato de roles equivalente al definido para las tablas operativas RC2.
revoke all on public.coi_timeline_events from anon, authenticated;
grant select, insert, update, delete on public.coi_timeline_events to authenticated;

drop policy if exists coi_timeline_select_v1 on public.coi_timeline_events;
create policy coi_timeline_select_v1 on public.coi_timeline_events
for select to authenticated
using (public.coi_current_role() in (
  'administrador','jefatura','editor','planificacion','control','supervisor',
  'inspector','consulta','invitado','contratista'
));
drop policy if exists coi_timeline_select_guard_v1 on public.coi_timeline_events;
create policy coi_timeline_select_guard_v1 on public.coi_timeline_events as restrictive
for select to authenticated
using (public.coi_current_role() in (
  'administrador','jefatura','editor','planificacion','control','supervisor',
  'inspector','consulta','invitado','contratista'
));

drop policy if exists coi_timeline_insert_v1 on public.coi_timeline_events;
create policy coi_timeline_insert_v1 on public.coi_timeline_events
for insert to authenticated
with check (public.coi_current_role() in (
  'administrador','jefatura','editor','planificacion','control','supervisor'
));
drop policy if exists coi_timeline_insert_guard_v1 on public.coi_timeline_events;
create policy coi_timeline_insert_guard_v1 on public.coi_timeline_events as restrictive
for insert to authenticated
with check (public.coi_current_role() in (
  'administrador','jefatura','editor','planificacion','control','supervisor'
));

drop policy if exists coi_timeline_update_v1 on public.coi_timeline_events;
create policy coi_timeline_update_v1 on public.coi_timeline_events
for update to authenticated
using (public.coi_current_role() in (
  'administrador','jefatura','editor','planificacion','control','supervisor'
))
with check (public.coi_current_role() in (
  'administrador','jefatura','editor','planificacion','control','supervisor'
));
drop policy if exists coi_timeline_update_guard_v1 on public.coi_timeline_events;
create policy coi_timeline_update_guard_v1 on public.coi_timeline_events as restrictive
for update to authenticated
using (public.coi_current_role() in (
  'administrador','jefatura','editor','planificacion','control','supervisor'
))
with check (public.coi_current_role() in (
  'administrador','jefatura','editor','planificacion','control','supervisor'
));

drop policy if exists coi_timeline_delete_v1 on public.coi_timeline_events;
create policy coi_timeline_delete_v1 on public.coi_timeline_events
for delete to authenticated
using (public.coi_current_role() in ('administrador','jefatura'));
drop policy if exists coi_timeline_delete_guard_v1 on public.coi_timeline_events;
create policy coi_timeline_delete_guard_v1 on public.coi_timeline_events as restrictive
for delete to authenticated
using (public.coi_current_role() in ('administrador','jefatura'));

comment on table public.coi_timeline_events is
  'Fuente unica de verdad para Timeline COI y registro de mailings operativos.';
comment on column public.coi_timeline_events.id is
  'Identidad estable de texto; conserva IDs legacy migrados desde navegador.';
comment on column public.coi_timeline_events.orden_id is
  'Identidad tecnica UUID de la OC, cuando el evento esta asociado a una orden.';

notify pgrst, 'reload schema';

commit;
