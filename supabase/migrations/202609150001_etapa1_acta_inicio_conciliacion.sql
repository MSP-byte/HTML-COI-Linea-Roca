-- =====================================================================
-- 1° ETAPA — Conciliación de fecha_acta_inicio al confirmar el hito 8
-- =====================================================================
--
-- MOTIVO
--   El hito 8 del circuito contractual —'control_terceros_con_acta',
--   «PLIEGO CON OC Y CONTROL DE 3º CON ACTA DE INICIO»— es el gate formal
--   entre la gestión contractual y la ejecución. Confirmarlo y que
--   coi_ordenes.fecha_acta_inicio siguiera en NULL dejaba el gate registrado
--   en el historial pero invisible para todo lo que lee el campo canónico.
--
--   Al revés también: si la OC ya tiene una fecha de acta cargada por el
--   circuito legacy, confirmar el hito no puede pisarla. Esa fecha es un dato
--   contractual real y el sistema no tiene forma de saber cuál de las dos es
--   la correcta.
--
-- QUÉ HACE
--   Reemplaza el CUERPO de public.coi_confirmar_etapa_circuito_v2 conservando
--   EXACTAMENTE su firma (p_orden_id, p_codigo, p_observacion) y su
--   comportamiento actual. No se crea una RPC paralela: hacerlo habría dejado
--   dos caminos de confirmación y la atomicidad se habría perdido en el medio.
--
--   Sobre el final, y solo para el hito 8, concilia fecha_acta_inicio dentro
--   de la MISMA transacción que ya tomó el lock de la orden:
--
--     CASO A · fecha_acta_inicio IS NULL
--              -> se registra la fecha de la confirmación.
--              -> acta_inicio.estado = 'registrada'
--
--     CASO B · ya coincide con la fecha de confirmación
--              -> se conserva, no se escribe nada.
--              -> acta_inicio.estado = 'coincide'
--
--     CASO C · ya tiene OTRO valor
--              -> NO se sobrescribe. La fila queda como está.
--              -> acta_inicio.estado = 'conflicto', con ambos valores, para
--                 que la interfaz lo muestre y alguien lo resuelva.
--
--     CASO D · el hito 8 YA ESTABA confirmado y fecha_acta_inicio es NULL
--              -> NO se escribe NADA.
--              -> acta_inicio.estado = 'legacy_sin_fecha'
--
--   El caso D es el que separa las dos cosas que se venían mezclando: la
--   EVIDENCIA de que la etapa 1 terminó, y la FECHA CONTRACTUAL del acta. Que
--   el hito esté confirmado prueba lo primero; no dice nada sobre lo segundo.
--   Escribir la fecha de hoy ahí fabricaría un dato contractual falso para un
--   expediente cuya acta se firmó vaya a saber cuándo. Tampoco se infiere de
--   created_at, de updated_at ni del fecha_evento del historial: ninguno de los
--   tres es la fecha del acta, son la fecha en que alguien cargó algo.
--
--   El gate NO depende de esto: con el hito 8 confirmado la etapa 2 queda
--   habilitada igual. La fecha faltante se muestra como pendiente de
--   conciliación, no como bloqueo.
--
--   El caso C no es un error: no aborta la confirmación del hito. Es la
--   situación normal de un expediente histórico cuya acta se firmó hace meses
--   y que recién ahora se registra en el pipeline. Lo que no puede pasar es
--   que la fecha real desaparezca sin que nadie se entere.
--
-- LA FECHA DE CONFIRMACIÓN
--   Se toma del servidor, no del cliente, y se convierte al calendario del
--   operador:
--
--     (now() at time zone 'America/Argentina/Buenos_Aires')::date
--
--   fecha_acta_inicio es una columna `date` del baseline: lo que corresponde
--   es el día local. Usar now()::date en UTC correría la fecha un día para
--   toda confirmación hecha después de las 21:00 hora argentina.
--
-- NO HACE
--   No crea tablas. No crea una segunda fecha de acta. No inventa fechas para
--   los expedientes históricos. No toca coi_historial_oc ni el resto del
--   circuito. No modifica datos existentes: la única escritura posible es
--   sobre una fila cuyo fecha_acta_inicio es NULL.
--
-- IDEMPOTENCIA
--   create or replace sobre la misma firma. Reaplicarla es NO-OP.
--
-- ESTADO REMOTO
--   NO fue aplicada a PRODUCCIÓN ni a STAGING.

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
  -- Conciliación del acta de inicio (hito 8).
  v_acta_actual date;
  v_acta_confirmacion date;
  v_acta_estado text;
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
    -- p_nueva := false. El hito ya estaba confirmado: no se registra fecha.
    return public.coi_conciliar_acta_inicio_etapa(
      p_orden_id, v_codigo,
      jsonb_build_object(
        'orden', to_jsonb(v_order), 'historial', '[]'::jsonb,
        'codigo', v_codigo, 'nombre', v_nombre, 'ya_confirmada', true
      ),
      false
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

  -- p_nueva := true. Es una confirmación nueva del hito.
  return public.coi_conciliar_acta_inicio_etapa(p_orden_id, v_codigo, v_result, true);
end;
$$;

-- ---------------------------------------------------------------------
-- Helper de conciliación. Se aísla del cuerpo principal para que las dos
-- salidas de la RPC —confirmación nueva y «ya confirmada»— pasen por la misma
-- lógica y no puedan divergir.
--
-- Corre dentro de la transacción de la RPC, que ya tomó el lock de la orden.
-- ---------------------------------------------------------------------
create or replace function public.coi_conciliar_acta_inicio_etapa(
  p_orden_id uuid,
  p_codigo text,
  p_resultado jsonb,
  p_nueva boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acta_actual date;
  v_acta_confirmacion date;
  v_estado text;
  v_orden public.coi_ordenes%rowtype;
begin
  -- Solo el hito 8 es el gate. El resto del circuito no toca el acta.
  if p_codigo <> 'control_terceros_con_acta' then
    return p_resultado;
  end if;

  select * into v_orden from public.coi_ordenes where id = p_orden_id;
  if not found then return p_resultado; end if;

  v_acta_actual := v_orden.fecha_acta_inicio;
  -- Día local del operador, no UTC: la columna es `date`.
  v_acta_confirmacion := (now() at time zone 'America/Argentina/Buenos_Aires')::date;

  if v_acta_actual is null and not p_nueva then
    -- CASO D. El hito ya estaba confirmado: la evidencia del gate existe, pero
    -- la fecha del acta NO. No se escribe la de hoy ni se infiere de ninguna
    -- columna de auditoría: sería inventar un dato contractual.
    v_estado := 'legacy_sin_fecha';
  elsif v_acta_actual is null then
    update public.coi_ordenes
       set fecha_acta_inicio = v_acta_confirmacion
     where id = p_orden_id;
    select * into v_orden from public.coi_ordenes where id = p_orden_id;
    v_estado := 'registrada';
  elsif v_acta_actual = v_acta_confirmacion then
    v_estado := 'coincide';
  else
    -- No se sobrescribe. El dato existente manda hasta que alguien decida.
    v_estado := 'conflicto';
  end if;

  return jsonb_set(
    jsonb_set(p_resultado, '{orden}', to_jsonb(v_orden), true),
    '{acta_inicio}',
    jsonb_build_object(
      'estado', v_estado,
      'valor', v_orden.fecha_acta_inicio,
      'valor_confirmacion', v_acta_confirmacion
    ),
    true
  );
end;
$$;

comment on function public.coi_conciliar_acta_inicio_etapa(uuid, text, jsonb, boolean) is
  'Concilia coi_ordenes.fecha_acta_inicio al confirmar el hito 8 del circuito. Registra la fecha solo en una confirmacion NUEVA cuya fecha estaba en NULL; si ya existe otro valor lo conserva y devuelve conflicto; si el hito ya estaba confirmado y no hay fecha devuelve legacy_sin_fecha sin escribir nada. Nunca sobrescribe ni infiere fechas historicas.';

-- PERMISOS DEL HELPER
--   Es un helper INTERNO y es SECURITY DEFINER: corre con los privilegios del
--   dueño de la función. Otorgarle EXECUTE a `authenticated` habría dejado a
--   cualquier usuario logueado escribir fecha_acta_inicio sobre cualquier OC
--   salteándose por completo el coi_assert_role() de la RPC pública. El chequeo
--   de rol vive en coi_confirmar_etapa_circuito_v2, así que el helper no puede
--   ser una segunda puerta sin control.
--
--   La RPC principal lo sigue invocando sin problema: también es SECURITY
--   DEFINER y, al ejecutarse, current_user pasa a ser el dueño, que conserva
--   EXECUTE por ser propietario. Revocar a los roles de cliente no le quita
--   nada al camino autorizado.
revoke all on function public.coi_conciliar_acta_inicio_etapa(uuid, text, jsonb, boolean) from public;
revoke all on function public.coi_conciliar_acta_inicio_etapa(uuid, text, jsonb, boolean) from anon;
revoke all on function public.coi_conciliar_acta_inicio_etapa(uuid, text, jsonb, boolean) from authenticated;
