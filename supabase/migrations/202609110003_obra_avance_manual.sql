-- H12 · Avance manual de Obra
-- Campo independiente de las Actas de Medición. Sólo aplica a OCs tipo Obra.

alter table public.coi_ordenes
  add column if not exists avance_obra_pct numeric(5,2);

comment on column public.coi_ordenes.avance_obra_pct is
  'Porcentaje manual de avance físico de obra (0-100), independiente de certificaciones/actas de medición.';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'coi_ordenes_avance_obra_pct_check'
       and conrelid = 'public.coi_ordenes'::regclass
  ) then
    alter table public.coi_ordenes
      add constraint coi_ordenes_avance_obra_pct_check
      check (avance_obra_pct is null or (avance_obra_pct >= 0 and avance_obra_pct <= 100));
  end if;
end
$$;

create or replace function public.coi_actualizar_avance_obra(
  p_orden_id uuid,
  p_porcentaje numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_before jsonb;
  v_after jsonb;
  v_tipo text;
begin
  v_role := public.coi_assert_role(array[
    'administrador', 'jefatura', 'editor', 'planificacion', 'control', 'supervisor'
  ]);

  if p_orden_id is null then
    raise exception using errcode = '22023', message = 'COI_ORDER_ID_REQUIRED';
  end if;

  if p_porcentaje is not null and (p_porcentaje < 0 or p_porcentaje > 100) then
    raise exception using errcode = '22023', message = 'COI_OBRA_PROGRESS_OUT_OF_RANGE';
  end if;

  select to_jsonb(o.*), o.tipo
    into v_before, v_tipo
    from public.coi_ordenes o
   where o.id = p_orden_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'COI_ORDER_NOT_FOUND';
  end if;

  if lower(trim(coalesce(v_tipo, ''))) <> 'obra' then
    raise exception using errcode = '23514', message = 'COI_OBRA_PROGRESS_ONLY_FOR_OBRA';
  end if;

  update public.coi_ordenes o
     set avance_obra_pct = p_porcentaje,
         actualizado_por = auth.uid(),
         fecha_actualizacion = clock_timestamp()
   where o.id = p_orden_id
   returning to_jsonb(o.*) into v_after;

  insert into public.coi_operaciones_auditoria(
    usuario_id, usuario_email, rol, accion, entidad, registro_id,
    nro_oc, datos_anteriores, datos_nuevos, contexto
  ) values (
    auth.uid(), nullif(auth.jwt() ->> 'email', ''), v_role,
    'ACTUALIZAR_AVANCE_OBRA_MANUAL', 'coi_ordenes', p_orden_id::text,
    coalesce(v_after ->> 'nro_oc', v_before ->> 'nro_oc'),
    v_before, v_after,
    jsonb_build_object('campo', 'avance_obra_pct', 'origen', 'expediente_digital')
  );

  return jsonb_build_object(
    'orden', v_after,
    'avance_obra_pct', p_porcentaje,
    'sin_cambios', (v_before -> 'avance_obra_pct') is not distinct from to_jsonb(p_porcentaje)
  );
end;
$$;

revoke all on function public.coi_actualizar_avance_obra(uuid, numeric) from public;
revoke all on function public.coi_actualizar_avance_obra(uuid, numeric) from anon;
grant execute on function public.coi_actualizar_avance_obra(uuid, numeric) to authenticated;
