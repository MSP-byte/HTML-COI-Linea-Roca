-- =====================================================================
-- H04 / H05 — La version de una fila la pone PostgreSQL, no el navegador
-- =====================================================================
--
-- MOTIVO
--   coi_unidades_mantenimiento y coi_servicios_tecnicos_um usan
--   fecha_actualizacion para DOS cosas a la vez:
--
--     1) auditoria: cuando se modifico la fila por ultima vez;
--     2) version: es el token de concurrencia optimista (CAS). El frontend
--        manda en el WHERE del UPDATE la fecha que VIO al pintar el formulario;
--        si no matchea, el UPDATE afecta 0 filas y no se pisa nada.
--
--   Hasta aca la version NUEVA la escribia el cliente
--   (`fecha_actualizacion: new Date().toISOString()`). Eso apoya las dos
--   funciones en el reloj del navegador, que no es una fuente confiable:
--
--     · reloj atrasado  -> la fila «retrocede» en el tiempo. La auditoria
--       miente y, peor, un CAS posterior puede volver a matchear un valor de
--       version que ya se habia usado;
--     · reloj congelado -> dos ediciones consecutivas escriben la MISMA
--       version. El token deja de distinguir estados y una edicion vieja puede
--       pisar una nueva;
--     · reloj adelantado -> la fila queda en el futuro y bloquea la lectura
--       cronologica del historial.
--
--   Ademas ningun cliente puede versionar lo que NO escribe: cuando
--   coi_renumerar_oc cambia el nro_oc de un Servicio Tecnico, la modificacion
--   es server-side y no habia nadie que hiciera avanzar la version.
--
-- DECISION
--   La version la genera PostgreSQL en un trigger BEFORE UPDATE. Es la unica
--   parte del sistema que ve todas las escrituras —del frontend, de un RPC o de
--   una sentencia administrativa— y la unica cuyo reloj es comun a todos los
--   puestos.
--
--   Lo que el cliente sigue mandando es el token de CAS en el WHERE: eso NO
--   cambia y no puede cambiar, porque es justamente la version que el operador
--   vio. Lo que se le retira es decidir la version NUEVA.
--
-- FORMULA
--     new.fecha_actualizacion :=
--       greatest(clock_timestamp(),
--                coalesce(old.fecha_actualizacion, '-infinity') + interval '1 microsecond')
--
--   · clock_timestamp() —no now()/transaction_timestamp()— porque now() es
--     constante durante toda la transaccion: dos UPDATE sobre la misma fila en
--     una misma transaccion recibirian la MISMA version y el token dejaria de
--     distinguirlos;
--   · el greatest() garantiza ESTRICTAMENTE CRECIENTE aunque el reloj del
--     servidor retroceda (ajuste NTP, cambio manual): la version nunca puede
--     repetir ni retroceder respecto de la que el operador vio;
--   · +1 microsecond es el paso minimo representable: timestamptz tiene
--     resolucion de microsegundo, de modo que el incremento es el menor posible
--     y no adelanta artificialmente el reloj mas de lo necesario;
--   · coalesce a '-infinity' cubre las filas con fecha_actualizacion NULL —la
--     columna es nullable— sin caso especial: greatest() con NULL en un operando
--     tambien lo ignoraria, pero dejarlo explicito hace que la intencion no
--     dependa de esa sutileza;
--   · el tipo real de las dos columnas es timestamptz (ver
--     202608090000_core_schema_baseline.sql), y clock_timestamp() devuelve
--     timestamptz: es un INSTANTE absoluto, no una lectura de pared, asi que el
--     TimeZone de la sesion que hace el UPDATE no altera el valor almacenado ni
--     el orden entre versiones.
--
-- ALCANCE
--   Solo BEFORE UPDATE. El INSERT conserva el default `now()` del baseline: una
--   fila recien creada no tiene version anterior que superar, y cambiar el alta
--   seria tocar lo que no hace falta.
--
--   El trigger NO lleva clausula `of <columnas>`: cualquier UPDATE sobre la fila
--   avanza la version, incluido el que hace coi_renumerar_oc sobre nro_oc.
--
-- CONVIVENCIA CON coi_st_resolver_nro_oc
--   coi_servicios_tecnicos_um queda con dos triggers BEFORE. PostgreSQL los
--   dispara por orden alfabetico de nombre, de modo que
--   `coi_st_resolver_nro_oc` corre antes que `coi_st_version_servidor`: primero
--   se resuelve la asociacion a la OC y despues se sella la version de la fila
--   ya resuelta. Igual son independientes —uno escribe nro_oc/orden_id y el otro
--   fecha_actualizacion—, pero el orden queda documentado a proposito.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: la funcion se reemplaza con el mismo cuerpo y cada
--   trigger se elimina si existe y se vuelve a crear.
--
-- ESTADO REMOTO
--   Esta migracion NO fue aplicada a produccion ni a staging.
--
-- NO DESTRUCTIVA
--   No borra, no vacia y no reescribe ninguna fila existente: solo instala el
--   trigger. Las versiones actuales de las filas quedan como estan y avanzan
--   recien en su proxima modificacion.

-- ---------------------------------------------------------------------
-- 1) La funcion de versionado.
-- ---------------------------------------------------------------------
create or replace function public.coi_version_servidor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fecha_actualizacion := greatest(
    clock_timestamp(),
    coalesce(old.fecha_actualizacion, '-infinity'::timestamptz) + interval '1 microsecond'
  );
  return new;
end;
$$;

comment on function public.coi_version_servidor() is
  'Version server-side de una fila: en BEFORE UPDATE fija fecha_actualizacion en greatest(clock_timestamp(), old.fecha_actualizacion + 1 microsegundo), de modo que la version es estrictamente creciente y no depende del reloj del cliente. El token de concurrencia optimista que manda el frontend sigue viajando en el WHERE; lo que el cliente ya no decide es la version nueva.';

-- ---------------------------------------------------------------------
-- 2) Unidades de Mantenimiento.
-- ---------------------------------------------------------------------
drop trigger if exists coi_um_version_servidor on public.coi_unidades_mantenimiento;
create trigger coi_um_version_servidor
  before update on public.coi_unidades_mantenimiento
  for each row execute function public.coi_version_servidor();

-- ---------------------------------------------------------------------
-- 3) Servicios Tecnicos.
--
-- Nombrado despues de coi_st_resolver_nro_oc en orden alfabetico a proposito:
-- primero se resuelve la asociacion a la OC, despues se sella la version.
-- ---------------------------------------------------------------------
drop trigger if exists coi_st_version_servidor on public.coi_servicios_tecnicos_um;
create trigger coi_st_version_servidor
  before update on public.coi_servicios_tecnicos_um
  for each row execute function public.coi_version_servidor();
