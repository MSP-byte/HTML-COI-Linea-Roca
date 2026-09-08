-- H10 - atomicidad e invariantes del ciclo Cerrar / Archivar OC.
-- No agrega tablas ni columnas. Endurece INSERT y UPDATE, incluidas las RPC
-- canonicas de alta/edicion, para que el primer cierre confirmado sea
-- completo e inmutable y una OC no pueda archivarse antes de estar cerrada.

begin;

create or replace function public.coi_guard_order_lifecycle_h10()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_estado_cerrado boolean;
  v_new_estado_cerrado boolean;
  v_old_cerrado boolean;
  v_new_cerrado boolean;
  v_old_registro text;
  v_new_registro text;
  v_new_observacion text;
  v_new_estado_archivado boolean;
begin
  v_new_estado_cerrado := upper(btrim(coalesce(new.estado_coi, ''))) in ('CERRADA', 'CERRADO');
  v_new_estado_archivado := upper(btrim(coalesce(new.estado_coi, ''))) in ('ARCHIVADA', 'ARCHIVADO');
  v_new_registro := upper(btrim(coalesce(new.estado_registro, '')));
  v_new_observacion := nullif(btrim(coalesce(new.observacion_cierre, '')), '');

  -- INSERT no tiene OLD. La creación también debe respetar el ciclo H10:
  --  * no se crea una OC ya archivada (Archivar es una segunda transición);
  --  * no se crean nuevos cierres en el marcador histórico estado_registro;
  --  * si el alta ya representa un cierre, estado + fecha + motivo deben venir
  --    completos en la misma escritura.
  if tg_op = 'INSERT' then
    if v_new_estado_archivado then
      raise exception using
        errcode = 'P0001',
        message = 'COI_ARCHIVE_STATE_FIELD_FORBIDDEN',
        detail = 'el archivo se registra en estado_registro, no en estado_coi';
    end if;

    if v_new_registro = 'ARCHIVADO' then
      raise exception using
        errcode = 'P0001',
        message = 'COI_ARCHIVE_REQUIRES_CLOSED_ORDER',
        detail = 'una OC nueva debe registrarse activa; el archivo es una transicion posterior al cierre';
    end if;

    if v_new_registro = 'CERRADO' then
      raise exception using
        errcode = 'P0001',
        message = 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT',
        detail = 'los cierres nuevos se registran en estado_coi con fecha y observacion';
    end if;

    if v_new_estado_cerrado
       or new.fecha_cierre_operativo is not null
       or v_new_observacion is not null then
      if not v_new_estado_cerrado
         or new.fecha_cierre_operativo is null
         or v_new_observacion is null then
        raise exception using
          errcode = 'P0001',
          message = 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT',
          detail = 'el cierre requiere estado_coi Cerrada, fecha y observacion en la misma transaccion';
      end if;
    end if;

    return new;
  end if;

  v_old_estado_cerrado := upper(btrim(coalesce(old.estado_coi, ''))) in ('CERRADA', 'CERRADO');
  v_old_registro := upper(btrim(coalesce(old.estado_registro, '')));

  -- Archivada/Archivado es un valor legacy del eje equivocado. No se admite
  -- como nueva escritura operativa: archivar pertenece a estado_registro.
  if v_new_estado_archivado
     and upper(btrim(coalesce(new.estado_coi, ''))) is distinct from upper(btrim(coalesce(old.estado_coi, ''))) then
    raise exception using
      errcode = 'P0001',
      message = 'COI_ARCHIVE_STATE_FIELD_FORBIDDEN',
      detail = 'use estado_registro=Archivado para archivar una OC';
  end if;

  -- Si el unico marcador historico es estado_registro=Cerrado, reemplazarlo
  -- directamente por Archivado destruiria la evidencia del cierre. Exigir que
  -- el mismo UPDATE canonicalice estado_coi o que el cliente lo haga antes.
  if v_old_registro = 'CERRADO'
     and not v_old_estado_cerrado
     and old.fecha_cierre_operativo is null
     and v_new_registro = 'ARCHIVADO'
     and not v_new_estado_cerrado then
    raise exception using
      errcode = 'P0001',
      message = 'COI_LEGACY_CLOSE_REQUIRES_CANONICALIZATION',
      detail = 'preserve el cierre historico en estado_coi antes de archivar';
  end if;

  v_old_cerrado := v_old_estado_cerrado
    or old.fecha_cierre_operativo is not null
    or v_old_registro = 'CERRADO';
  v_new_cerrado := v_new_estado_cerrado
    or new.fecha_cierre_operativo is not null
    or v_new_registro = 'CERRADO';

  if tg_name = 'coi_ordenes_h10_audit_guard' then
    -- UPDATE OF dispara aun cuando se intente escribir el mismo valor: una vez
    -- cerrada, fecha y motivo pertenecen al primer cierre y no se reescriben.
    if v_old_cerrado then
      raise exception using
        errcode = 'P0001',
        message = 'COI_CLOSURE_IMMUTABLE',
        detail = 'fecha_cierre_operativo y observacion_cierre pertenecen al primer cierre confirmado';
    end if;

    if not v_new_estado_cerrado
       or new.fecha_cierre_operativo is null
       or v_new_observacion is null then
      raise exception using
        errcode = 'P0001',
        message = 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT',
        detail = 'el cierre requiere estado_coi Cerrada, fecha y observacion en la misma transaccion';
    end if;
    return new;
  end if;

  -- Nunca crear cierres nuevos en la columna historica de registro.
  if not v_old_cerrado and v_new_registro = 'CERRADO' then
    raise exception using
      errcode = 'P0001',
      message = 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT';
  end if;

  -- Archivar es una segunda transicion: exige cierre previo ya confirmado.
  if v_new_registro = 'ARCHIVADO'
     and v_old_registro <> 'ARCHIVADO'
     and not v_old_cerrado then
    raise exception using
      errcode = 'P0001',
      message = 'COI_ARCHIVE_REQUIRES_CLOSED_ORDER';
  end if;

  -- Un cierre confirmado no puede reabrirse ni perder su unico marcador.
  if v_old_cerrado and not v_new_cerrado then
    raise exception using
      errcode = 'P0001',
      message = 'COI_CLOSURE_IMMUTABLE';
  end if;
  if v_old_estado_cerrado and not v_new_estado_cerrado then
    raise exception using
      errcode = 'P0001',
      message = 'COI_CLOSURE_IMMUTABLE';
  end if;

  -- El primer cierre valido se escribe completo en un unico UPDATE.
  if not v_old_cerrado and v_new_estado_cerrado then
    if new.fecha_cierre_operativo is null
       or v_new_observacion is null then
      raise exception using
        errcode = 'P0001',
        message = 'COI_CLOSE_REQUIRES_ATOMIC_AUDIT';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists coi_ordenes_h10_insert_guard on public.coi_ordenes;
create trigger coi_ordenes_h10_insert_guard
before insert on public.coi_ordenes
for each row execute function public.coi_guard_order_lifecycle_h10();

drop trigger if exists coi_ordenes_h10_audit_guard on public.coi_ordenes;
create trigger coi_ordenes_h10_audit_guard
before update of fecha_cierre_operativo, observacion_cierre on public.coi_ordenes
for each row execute function public.coi_guard_order_lifecycle_h10();

drop trigger if exists coi_ordenes_h10_state_guard on public.coi_ordenes;
create trigger coi_ordenes_h10_state_guard
before update of estado_coi, estado_registro on public.coi_ordenes
for each row execute function public.coi_guard_order_lifecycle_h10();

comment on function public.coi_guard_order_lifecycle_h10() is
  'H10: valida altas, preserva atomicamente el primer cierre y exige cerrar antes de archivar.';

commit;
