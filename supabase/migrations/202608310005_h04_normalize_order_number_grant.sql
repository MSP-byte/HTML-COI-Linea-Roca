-- =====================================================================
-- H04 — El frontend puede preguntar por la identidad canonica de una OC
-- =====================================================================
--
-- MOTIVO
--   202608310004 dejo la integridad ST -> OC en la base: un trigger resuelve el
--   numero con public.coi_normalize_order_number() y una FK garantiza que la
--   orden exista. Esa es y sigue siendo la autoridad final.
--
--   Pero la capa H05 conserva una prevalidacion remota, y hace falta que siga
--   existiendo: mientras las migraciones de este PR no esten desplegadas, es la
--   unica defensa fail-closed contra asociar un ST a una OC que no existe.
--
--   El problema es que esa prevalidacion resolvia la OC con eq() e ilike() sobre
--   el texto crudo. Eso es una SEGUNDA definicion de identidad, mas estrecha que
--   la de PostgreSQL: «OC 4530008964» o «4530-00.89/64» designan la misma orden
--   para coi_normalize_order_number y para el trigger, pero eran rechazadas
--   antes de llegar a escribir. La UI decia que no a algo que la base habria
--   aceptado.
--
-- POR QUE UNA MIGRACION, Y POR QUE ESTA
--   Se busco primero una via ya expuesta que aplicara esa misma normalizacion:
--   no hay vista sobre coi_ordenes, no hay columna generada con el numero
--   normalizado, y ninguna RPC concedida a authenticated resuelve una orden por
--   su numero. PostgREST tampoco permite filtrar por una expresion de funcion.
--
--   Reimplementar la normalizacion en JavaScript seria exactamente el problema
--   que el hallazgo señala: dos definiciones que pueden separarse.
--
--   La solucion minima es dejar que el frontend consulte LA MISMA funcion. No se
--   agrega logica nueva, no se crea ninguna RPC, no se toca ninguna tabla ni
--   ninguna policy: es un unico grant sobre una funcion que ya existe.
--
-- POR QUE ES SEGURO
--   coi_normalize_order_number es «language sql», immutable y strict, NO es
--   security definer y no lee ninguna tabla: transforma texto y devuelve texto.
--   Conocer el resultado no revela ningun dato, ni siquiera si la orden existe
--   —para eso hace falta el SELECT sobre coi_ordenes, que ya esta gobernado por
--   su propia RLS—.
--
--   anon sigue revocado: solo se concede a authenticated.
--
-- ALCANCE
--   Un grant. No crea ni modifica funciones, tablas, policies ni datos.
--
-- IDEMPOTENCIA
--   Reaplicarla es un NO-OP: revoke + grant dejan siempre el mismo estado.
--
-- ESTADO REMOTO
--   Esta migracion NO fue aplicada a produccion ni a staging. Mientras eso no
--   ocurra, tests/fixtures/production_schema_contract.json documenta la
--   divergencia deliberada en «_divergencias_pendientes.grants_funciones».

revoke all on function public.coi_normalize_order_number(text) from public, anon;
grant execute on function public.coi_normalize_order_number(text) to authenticated;

comment on function public.coi_normalize_order_number(text) is
  'Identidad canonica de un numero de OC. La usan el guard de coi_ordenes, el trigger de resolucion de Servicios Tecnicos y —desde 202608310005— la prevalidacion del frontend, para que la UI no rechace lo que la base aceptaria. Pura: no lee datos y no es security definer.';
